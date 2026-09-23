import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import express from "express"
import * as ort from "onnxruntime-node"
import { preprocessMetadata, type MetadataPreprocessInput } from "../../src/contracts.js"
import {
  SCOREBOAR_V5_VIRALITY_TEMPERATURE,
  V5_BOOLEAN_SCORE_NAMES,
  V5_NUMERIC_SCORE_NAMES,
  type BooleanScores,
  type NumericScores,
  type ScoreProbabilities,
  type ScoreTextInput,
  type ScoreTextResult,
} from "../../src/inference-runtime.js"
import { createByteLevelBpeTokenizer, type ByteLevelBpeTokenizerJson } from "../../src/local-tokenizer.js"

const port = Number.parseInt(process.env.PORT ?? "8787", 10)
const modelPath = process.env.SCOREBOAR_MODEL_PATH ?? resolve("../../artifacts/model/v5-full.onnx")
const tokenizerPath = process.env.SCOREBOAR_TOKENIZER_PATH ?? resolve("../../model/v5-source/tokenizer/tokenizer.json")
const maxLength = Number.parseInt(process.env.SCOREBOAR_MAX_LENGTH ?? "192", 10)

interface ScoreRequestBody {
  readonly text?: unknown
  readonly metadata?: MetadataPreprocessInput
}

const softmax = (values: readonly number[], temperature = 1): readonly number[] => {
  const scaled = values.map((value) => value / temperature)
  const max = Math.max(...scaled)
  const exps = scaled.map((value) => Math.exp(value - max))
  const total = exps.reduce((sum, value) => sum + value, 0)
  return exps.map((value) => value / total)
}

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value))

const tensorNumbers = (tensor: ort.Tensor): readonly number[] => {
  if (!(tensor.data instanceof Float32Array)) {
    throw new Error(`Expected float32 ONNX output, received ${tensor.type}`)
  }
  return [...tensor.data]
}

const probabilitiesFromLogits = (logits: readonly number[]): ScoreProbabilities => {
  const [veryLow, low, medium, high, veryHigh] = softmax(logits, SCOREBOAR_V5_VIRALITY_TEMPERATURE)
  return { very_low: veryLow, low, medium, high, very_high: veryHigh }
}

const confidenceFromProbabilities = (probabilities: ScoreProbabilities): number => {
  return Math.max(...Object.values(probabilities).filter((value) => Number.isFinite(value)))
}

const numericScoresFromTensor = (tensor: ort.Tensor): NumericScores => {
  const values = tensorNumbers(tensor)
  return Object.fromEntries(V5_NUMERIC_SCORE_NAMES.map((name, index) => [name, values[index] ?? 0] as const)) as NumericScores
}

const booleanScoresFromTensor = (tensor: ort.Tensor): BooleanScores => {
  const values = tensorNumbers(tensor)
  return Object.fromEntries(V5_BOOLEAN_SCORE_NAMES.map((name, index) => [name, sigmoid(values[index] ?? 0)] as const)) as BooleanScores
}

const createScoreboarApiRunner = async () => {
  const tokenizerJson = JSON.parse(await readFile(tokenizerPath, "utf8")) as ByteLevelBpeTokenizerJson
  const tokenizer = createByteLevelBpeTokenizer(tokenizerJson)
  const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["cpu"] })

  return async (input: ScoreTextInput): Promise<ScoreTextResult> => {
    const metadataVector = preprocessMetadata({ text: input.text, ...input.metadata }).vector
    const encoded = tokenizer.encode(input.text, maxLength)
    const outputs = await session.run({
      input_ids: new ort.Tensor("int64", BigInt64Array.from(encoded.inputIds.map(BigInt)), [1, maxLength]),
      attention_mask: new ort.Tensor("int64", BigInt64Array.from(encoded.attentionMask.map(BigInt)), [1, maxLength]),
      metadata: new ort.Tensor("float32", Float32Array.from(metadataVector), [1, metadataVector.length]),
    })

    const viralityLogits = outputs.virality_logits
    const numericScores = outputs.numeric_scores
    const booleanLogits = outputs.boolean_logits
    if (!viralityLogits || !numericScores || !booleanLogits) {
      throw new Error("ONNX output is missing expected Scoreboar tensors")
    }

    const probabilities = probabilitiesFromLogits(tensorNumbers(viralityLogits).slice(0, 5))
    return {
      status: "scored",
      label: "scored",
      confidence: confidenceFromProbabilities(probabilities),
      probabilities,
      numericScores: numericScoresFromTensor(numericScores),
      booleanScores: booleanScoresFromTensor(booleanLogits),
      message: "Scored locally with Scoreboar ONNX through the example API.",
      model: {
        provider: "local-onnx",
        path: "extension/assets/model/v5-full.onnx",
        available: true,
      },
      metadataVector,
    }
  }
}

const app = express()
app.use(express.json({ limit: "64kb" }))

const score = await createScoreboarApiRunner()

app.get("/health", (_request, response) => {
  response.json({ ok: true, modelPath, tokenizerPath })
})

app.post("/score", async (request, response, next) => {
  try {
    const body = request.body as ScoreRequestBody
    if (typeof body.text !== "string" || body.text.trim().length === 0) {
      response.status(400).json({ error: "Expected JSON body with non-empty string field: text" })
      return
    }

    response.json(await score({ text: body.text, metadata: body.metadata }))
  } catch (error) {
    next(error)
  }
})

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error)
  response.status(500).json({ error: message })
})

app.listen(port, () => {
  console.info(`Scoreboar ONNX API listening on http://localhost:${port}`)
})
