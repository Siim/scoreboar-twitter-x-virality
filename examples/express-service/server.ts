import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import express from "express"
import * as ort from "onnxruntime-node"
import {
  FEATURE_CONTRACT_VERSION,
  METADATA_V2_FEATURE_ORDER,
  authorBlockForModel,
  parseTimeInput,
  preprocessMetadata,
  type MetadataPreprocessInput,
  type MetadataV2FeatureMap,
} from "../../src/contracts.js"
import {
  BOOLEAN_SCORE_NAMES,
  NUMERIC_SCORE_NAMES,
  SCOREBOAR_MAX_TOKENS,
  SCOREBOAR_MODEL_VERSION,
  type BooleanScores,
  type NumericScores,
  type PerformancePrediction,
  type ScoreProbabilities,
} from "../../src/inference-runtime.js"
import { createByteLevelBpeTokenizer, type ByteLevelBpeTokenizerJson } from "../../src/local-tokenizer.js"

// npm runs scripts from this folder, so the defaults are the files
// `npm run download:model` puts in the repo's artifacts/model/.
const modelDir = resolve("../../artifacts/model")
const modelPath = process.env.SCOREBOAR_MODEL_PATH ?? resolve(modelDir, `scoreboar-${SCOREBOAR_MODEL_VERSION}.onnx`)
const modelInfoPath = process.env.SCOREBOAR_MODEL_INFO_PATH ?? resolve(modelDir, `scoreboar-${SCOREBOAR_MODEL_VERSION}.json`)
const tokenizerPath = process.env.SCOREBOAR_TOKENIZER_PATH ?? resolve(modelDir, "tokenizer.json")
const port = Number.parseInt(process.env.PORT ?? "8787", 10)
// Loopback unless asked otherwise: the example has no auth.
const host = process.env.HOST ?? "127.0.0.1"
const threads = Number.parseInt(process.env.SCOREBOAR_ONNX_THREADS ?? "", 10)
const MAX_BATCH = 64

const FIFTHS = ["very_low", "low", "medium", "high", "very_high"] as const
// The categorical heads are not in the response, so they are never copied out.
const OUTPUTS = ["performance", "outcomes", "virality_logits", "numeric_scores", "boolean_logits"] as const

export interface ScoreResponse {
  readonly status: "scored"
  readonly model: {
    readonly version: typeof SCOREBOAR_MODEL_VERSION
    readonly featureContract: typeof FEATURE_CONTRACT_VERSION
  }
  /** Field names follow the extension's PerformancePrediction, so its helpers read this as is. */
  readonly performance: PerformancePrediction & {
    /** Calibrated chance of landing in the top fifth of ordinary posts. */
    readonly topFifth: number
    /** Calibrated chance of landing in the bottom fifth. */
    readonly bottomFifth: number
  }
  readonly probabilities: ScoreProbabilities
  readonly numericScores: NumericScores
  readonly booleanScores: BooleanScores
  /** What the model read, for checking a request did what was meant. */
  readonly input: {
    readonly normalizedText: string
    readonly tokens: number
    readonly features: MetadataV2FeatureMap
    /** False when the author fields were incomplete and left out (see scorePosts). */
    readonly authorUsed: boolean
  }
}

interface PostInput {
  readonly text: string
  readonly metadata: MetadataPreprocessInput
}

interface ModelInfo {
  readonly model_version?: unknown
  readonly feature_contract?: unknown
  readonly max_length?: unknown
  readonly metadata_features?: unknown
}

class RequestError extends Error {
  readonly status = 400
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Request metadata. Same camelCase fields the extension sends, checked
// strictly: a misspelt or snake_case key would otherwise be dropped, and the
// post scored as if that fact were unknown, with no sign anything was wrong.
// ---------------------------------------------------------------------------

type FieldKind = "boolean" | "count" | "time" | "string" | "strings"

// Typed against the contract, so a field added there fails to compile here.
const METADATA_FIELDS: Readonly<Record<Exclude<keyof MetadataPreprocessInput, "text">, FieldKind>> = {
  createdAt: "time",
  hasMedia: "boolean",
  hasPhoto: "boolean",
  hasVideo: "boolean",
  isQuote: "boolean",
  hasCard: "boolean",
  mediaUrls: "strings",
  authorFollowers: "count",
  authorFollowing: "count",
  authorTweets: "count",
  authorFavourites: "count",
  authorVerified: "boolean",
  authorVerifiedType: "string",
  authorCreatedAt: "time",
}

// Extension payloads carry these too; they do not reach the model.
const IGNORED_FIELDS = new Set(["source", "url"])

const KIND_DESCRIPTIONS: Readonly<Record<FieldKind, string>> = {
  boolean: "true, false or null",
  count: "a number or null",
  time: "an ISO date, epoch milliseconds, X's created_at string or null",
  string: "a string or null",
  strings: "an array of strings or null",
}

const fitsKind = (value: unknown, kind: FieldKind): boolean => {
  switch (kind) {
    case "boolean":
      return typeof value === "boolean"
    case "count":
      return typeof value === "number" && Number.isFinite(value)
    case "time":
      // An unreadable date would silently become "time unknown".
      return (typeof value === "string" || typeof value === "number") && parseTimeInput(value) !== null
    case "string":
      return typeof value === "string"
    case "strings":
      return Array.isArray(value) && value.every((item) => typeof item === "string")
  }
}

const readMetadata = (value: unknown, where: string): MetadataPreprocessInput => {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) throw new RequestError(`${where} must be an object`)

  const metadata: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value)) {
    if (IGNORED_FIELDS.has(key)) continue
    if (!Object.hasOwn(METADATA_FIELDS, key)) {
      throw new RequestError(`${where}.${key} is not a metadata field. Known fields: ${Object.keys(METADATA_FIELDS).join(", ")}`)
    }
    const kind = METADATA_FIELDS[key as keyof typeof METADATA_FIELDS]
    if (field !== null && !fitsKind(field, kind)) {
      throw new RequestError(`${where}.${key} must be ${KIND_DESCRIPTIONS[kind]}`)
    }
    metadata[key] = field
  }
  return metadata as MetadataPreprocessInput
}

const readPost = (value: unknown, where: string): PostInput => {
  if (!isRecord(value)) throw new RequestError(`${where} must be an object`)
  if (typeof value.text !== "string" || value.text.trim().length === 0) {
    throw new RequestError(`${where}.text must be a non-empty string`)
  }
  return { text: value.text, metadata: readMetadata(value.metadata, `${where}.metadata`) }
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/**
 * The ONNX file cannot say which metadata layout it was trained on, and a
 * model paired with the wrong contract still returns numbers, only wrong ones.
 * Its JSON sidecar can, so the service refuses to start on any mismatch.
 */
const assertModelMatchesCode = (info: ModelInfo): void => {
  const problems: string[] = []
  if (info.model_version !== SCOREBOAR_MODEL_VERSION) {
    problems.push(`model version ${String(info.model_version)}, code expects ${SCOREBOAR_MODEL_VERSION}`)
  }
  if (info.feature_contract !== FEATURE_CONTRACT_VERSION) {
    problems.push(`feature contract ${String(info.feature_contract)}, code has ${FEATURE_CONTRACT_VERSION}`)
  }
  if (info.max_length !== SCOREBOAR_MAX_TOKENS) {
    problems.push(`trained on ${String(info.max_length)} tokens, code uses ${SCOREBOAR_MAX_TOKENS}`)
  }
  if (JSON.stringify(info.metadata_features) !== JSON.stringify(METADATA_V2_FEATURE_ORDER)) {
    problems.push("metadata features differ from src/contracts.ts")
  }
  if (problems.length > 0) {
    throw new Error(`${modelInfoPath} does not match this code: ${problems.join("; ")}`)
  }
}

// virality_logits and boolean_logits come out of the graph already divided by
// their fitted temperatures (scoreboar-v8.json, calibration), so no scaling here.
const softmax = (values: readonly number[]): number[] => {
  const max = Math.max(...values)
  const exps = values.map((value) => Math.exp(value - max))
  const total = exps.reduce((sum, value) => sum + value, 0)
  return exps.map((value) => value / total)
}

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value))

/** Splits a [batch, n] (or [batch]) float32 output into one array per post. */
const rowsOf = (outputs: ort.InferenceSession.OnnxValueMapType, name: string, batch: number): number[][] => {
  const data = outputs[name]?.data
  if (!(data instanceof Float32Array)) {
    throw new Error(`ONNX output ${name} is missing or not float32`)
  }
  const width = data.length / batch
  return Array.from({ length: batch }, (_, row) => [...data.subarray(row * width, (row + 1) * width)])
}

const createScorer = async () => {
  assertModelMatchesCode(JSON.parse(await readFile(modelInfoPath, "utf8")) as ModelInfo)
  const tokenizer = createByteLevelBpeTokenizer(JSON.parse(await readFile(tokenizerPath, "utf8")) as ByteLevelBpeTokenizerJson)
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    ...(Number.isFinite(threads) && threads > 0 ? { intraOpNumThreads: threads } : {}),
  })
  const missing = OUTPUTS.filter((name) => !session.outputNames.includes(name))
  if (missing.length > 0) {
    throw new Error(`${modelPath} has no ${missing.join(", ")} output; it is not a Scoreboar ${SCOREBOAR_MODEL_VERSION} model`)
  }

  const run = async (posts: readonly PostInput[]): Promise<ScoreResponse[]> => {
    const batch = posts.length
    // The same preparation the extension runs, text normalization included.
    // Tokenizing the raw text instead would feed the model inputs it never saw.
    // The author goes in whole or not at all, as in the extension: v8 reads
    // counts without the join date and likes-given count as an old viral post
    // and scores it tens of points too high, while no author scores normally.
    const prepared = posts.map((post) => {
      const {
        authorFollowers, authorFollowing, authorTweets, authorFavourites,
        authorVerified, authorVerifiedType, authorCreatedAt, ...rest
      } = post.metadata
      const joined = parseTimeInput(authorCreatedAt)
      const author = authorBlockForModel({
        authorFollowers, authorFollowing, authorTweets, authorFavourites,
        authorVerified, authorVerifiedType, authorCreatedAt: joined ? joined.toISOString() : null,
      })
      return { ...preprocessMetadata({ ...rest, ...(author ?? {}), text: post.text }), authorUsed: author !== null }
    })
    // Unpadded: the model's answer does not depend on padding, and a typical
    // post is about 45 tokens against the 128 cap. A batch pads only to its
    // longest post, with those positions masked out.
    const encoded = prepared.map((item) => tokenizer.encode(item.normalizedText, SCOREBOAR_MAX_TOKENS, { pad: false }))
    const width = Math.max(...encoded.map((row) => row.inputIds.length))
    const featureCount = METADATA_V2_FEATURE_ORDER.length

    const inputIds = new BigInt64Array(batch * width).fill(BigInt(tokenizer.padId))
    const attentionMask = new BigInt64Array(batch * width)
    const metadata = new Float32Array(batch * featureCount)
    encoded.forEach((row, index) => {
      row.inputIds.forEach((id, position) => {
        inputIds[index * width + position] = BigInt(id)
        attentionMask[index * width + position] = BigInt(row.attentionMask[position] ?? 0)
      })
      metadata.set(prepared[index].vector, index * featureCount)
    })

    const outputs = await session.run(
      {
        input_ids: new ort.Tensor("int64", inputIds, [batch, width]),
        attention_mask: new ort.Tensor("int64", attentionMask, [batch, width]),
        metadata: new ort.Tensor("float32", metadata, [batch, featureCount]),
      },
      [...OUTPUTS],
    )
    const percentiles = rowsOf(outputs, "performance", batch)
    // [standardized performance, log engagement residual, log views residual],
    // each against what the author's reach alone predicts.
    const outcomes = rowsOf(outputs, "outcomes", batch)
    const viralityLogits = rowsOf(outputs, "virality_logits", batch)
    const numericScores = rowsOf(outputs, "numeric_scores", batch)
    const booleanLogits = rowsOf(outputs, "boolean_logits", batch)

    return prepared.map((item, row) => {
      const fifths = softmax(viralityLogits[row])
      const [, engagementResidual = 0, viewsResidual = 0] = outcomes[row]
      return {
        status: "scored",
        model: { version: SCOREBOAR_MODEL_VERSION, featureContract: FEATURE_CONTRACT_VERSION },
        performance: {
          percentile: percentiles[row][0] ?? 0.5,
          topFifth: fifths[4] ?? 0,
          bottomFifth: fifths[0] ?? 0,
          engagementMultiple: Math.exp(engagementResidual),
          reachMultiple: Math.exp(viewsResidual),
        },
        probabilities: Object.fromEntries(FIFTHS.map((name, index) => [name, fifths[index] ?? 0])),
        numericScores: Object.fromEntries(NUMERIC_SCORE_NAMES.map((name, index) => [name, numericScores[row][index] ?? 0])),
        booleanScores: Object.fromEntries(BOOLEAN_SCORE_NAMES.map((name, index) => [name, sigmoid(booleanLogits[row][index] ?? 0)])),
        input: {
          normalizedText: item.normalizedText,
          tokens: encoded[row].inputIds.length,
          features: item.features,
          authorUsed: item.authorUsed,
        },
      }
    })
  }

  // onnxruntime-node has taken the whole process down when two run() calls
  // overlapped on one session (seen on linux/arm64), so runs take turns. The queue swallows each
  // failure so one bad run does not fail every later one; the caller still
  // gets the rejection.
  let queue: Promise<unknown> = Promise.resolve()
  return (posts: readonly PostInput[]): Promise<ScoreResponse[]> => {
    const result = queue.then(() => run(posts))
    queue = result.catch(() => undefined)
    return result
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const score = await createScorer()

const app = express()
// X allows 25,000 characters in a long post, and a batch can hold MAX_BATCH of them.
app.use(express.json({ limit: "2mb" }))

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    model: { version: SCOREBOAR_MODEL_VERSION, featureContract: FEATURE_CONTRACT_VERSION, maxTokens: SCOREBOAR_MAX_TOKENS },
  })
})

app.post("/score", async (request, response) => {
  const post = readPost(request.body, "body")
  const [result] = await score([post])
  response.json(result)
})

app.post("/score/batch", async (request, response) => {
  const body: unknown = request.body
  if (!isRecord(body) || !Array.isArray(body.posts) || body.posts.length === 0) {
    throw new RequestError("Expected JSON body { posts: [{ text, metadata }, ...] } with at least one post")
  }
  if (body.posts.length > MAX_BATCH) {
    throw new RequestError(`At most ${MAX_BATCH} posts per batch, got ${body.posts.length}`)
  }
  const posts = body.posts.map((post: unknown, index: number) => readPost(post, `posts[${index}]`))
  response.json({ results: await score(posts) })
})

// Express 5 sends a handler's rejection here. Request errors, including
// body-parser's (bad JSON, too large), carry a 4xx status; anything else is ours.
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const status = (error as { status?: unknown } | null)?.status
  const code = typeof status === "number" && status >= 400 && status < 500 ? status : 500
  if (code === 500) console.error("[scoreboar] scoring failed:", error)
  response.status(code).json({ error: error instanceof Error ? error.message : String(error) })
})

app.listen(port, host, () => {
  console.info(`Scoreboar ${SCOREBOAR_MODEL_VERSION} API listening on http://${host}:${port}`)
  console.info(`  model     ${modelPath}`)
  console.info(`  tokenizer ${tokenizerPath}`)
})
