import { preprocessMetadata } from "../src/contracts.js"
import {
  SCOREBOAR_LOCAL_ONNX_PATH,
  SCOREBOAR_V5_VIRALITY_TEMPERATURE,
  V5_BOOLEAN_SCORE_NAMES,
  V5_NUMERIC_SCORE_NAMES,
  createScoreTextResponse,
  createUnavailableScoreTextResult,
  isScoreTextOffscreenMessage,
  type BooleanScores,
  type LocalModelRunner,
  type NumericScores,
  type ScoreProbabilities,
  type ScoreTextInput,
  type ScoreTextResult,
} from "../src/inference-runtime.js"
import { createByteLevelBpeTokenizer, type ByteLevelBpeTokenizerJson } from "../src/local-tokenizer.js"

type ChromeSendResponse = (response?: unknown) => void

type ChromeRuntimeLike = {
  readonly getURL?: (path: string) => string
  readonly onMessage?: {
    readonly addListener: (
      listener: (message: unknown, sender: unknown, sendResponse: ChromeSendResponse) => boolean | void,
    ) => void
  }
}

const chromeApi = (globalThis as { chrome?: { readonly runtime?: ChromeRuntimeLike } }).chrome

interface OrtTensor<T extends string = string> {
  readonly type: T
  readonly data: Float32Array | BigInt64Array
  readonly dims: readonly number[]
}

interface OrtInferenceSession {
  readonly run: (feeds: Record<string, OrtTensor>) => Promise<Record<string, OrtTensor<"float32">>>
}

interface OrtApi {
  readonly env: {
    readonly wasm: {
      wasmPaths?: string
      numThreads?: number
    }
  }
  readonly Tensor: new <T extends string>(type: T, data: OrtTensor<T>["data"], dims: readonly number[]) => OrtTensor<T>
  readonly InferenceSession: {
    readonly create: (model: string, options: { readonly executionProviders: readonly string[] }) => Promise<OrtInferenceSession>
  }
}

const getExtensionUrl = (path: string): string => chromeApi?.runtime?.getURL?.(path) ?? path

const getOrt = (): OrtApi | null => {
  const candidate = (globalThis as { ort?: OrtApi }).ort
  return candidate ?? null
}

const softmax = (values: readonly number[], temperature = 1): readonly number[] => {
  const scaled = values.map((value) => value / temperature)
  const max = Math.max(...scaled)
  const exps = scaled.map((value) => Math.exp(value - max))
  const total = exps.reduce((sum, value) => sum + value, 0)
  return exps.map((value) => value / total)
}

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value))

const tensorNumbers = (tensor: OrtTensor<"float32">): readonly number[] => [...tensor.data as Float32Array]

const probabilitiesFromLogits = (logits: readonly number[]): ScoreProbabilities => {
  const [veryLow, low, medium, high, veryHigh] = softmax(logits, SCOREBOAR_V5_VIRALITY_TEMPERATURE)
  return { very_low: veryLow, low, medium, high, very_high: veryHigh }
}

const confidenceFromProbabilities = (probabilities: ScoreProbabilities): number => {
  return Math.max(...Object.values(probabilities).filter((value) => typeof value === "number" && Number.isFinite(value)))
}

const numericScoresFromTensor = (tensor: OrtTensor<"float32">): NumericScores => {
  const values = tensorNumbers(tensor)
  const entries = V5_NUMERIC_SCORE_NAMES.map((name, index) => [name, values[index] ?? 0] as const)
  return Object.fromEntries(entries) as NumericScores
}

const booleanScoresFromTensor = (tensor: OrtTensor<"float32">): BooleanScores => {
  const values = tensorNumbers(tensor)
  const entries = V5_BOOLEAN_SCORE_NAMES.map((name, index) => [name, sigmoid(values[index] ?? 0)] as const)
  return Object.fromEntries(entries) as BooleanScores
}

const createBrowserOnnxRunner = async (): Promise<LocalModelRunner> => {
  const ort = getOrt()
  if (!ort) {
    throw new Error("ONNX Runtime Web global is unavailable")
  }
  ort.env.wasm.wasmPaths = getExtensionUrl("extension/assets/runtime/")
  ort.env.wasm.numThreads = 1

  const tokenizerResponse = await fetch(getExtensionUrl("extension/assets/tokenizer/tokenizer.json"))
  if (!tokenizerResponse.ok) {
    throw new Error(`Tokenizer asset failed to load: ${tokenizerResponse.status}`)
  }
  const tokenizerJson = await tokenizerResponse.json() as ByteLevelBpeTokenizerJson
  const tokenizer = createByteLevelBpeTokenizer(tokenizerJson)
  const session = await ort.InferenceSession.create(getExtensionUrl(SCOREBOAR_LOCAL_ONNX_PATH), { executionProviders: ["wasm"] })

  return {
    score: async (input: ScoreTextInput, metadataVector: readonly number[]): Promise<ScoreTextResult> => {
      const maxLength = 192
      const encoded = tokenizer.encode(input.text, maxLength)
      const feeds = {
        input_ids: new ort.Tensor("int64", BigInt64Array.from(encoded.inputIds.map(BigInt)), [1, maxLength]),
        attention_mask: new ort.Tensor("int64", BigInt64Array.from(encoded.attentionMask.map(BigInt)), [1, maxLength]),
        metadata: new ort.Tensor("float32", Float32Array.from(metadataVector), [1, metadataVector.length]),
      }
      const outputs = await session.run(feeds)
      const viralityLogits = outputs.virality_logits
      const numericScores = outputs.numeric_scores
      const booleanLogits = outputs.boolean_logits
      if (!viralityLogits || !numericScores || !booleanLogits) {
        throw new Error("ONNX output is missing expected v5 tensors")
      }

      const probabilities = probabilitiesFromLogits(tensorNumbers(viralityLogits).slice(0, 5))

      return {
        status: "scored",
        label: "scored",
        confidence: confidenceFromProbabilities(probabilities),
        probabilities,
        numericScores: numericScoresFromTensor(numericScores),
        booleanScores: booleanScoresFromTensor(booleanLogits),
        message: "Scored locally with packaged Scoreboar v5 ONNX.",
        model: {
          provider: "local-onnx",
          path: SCOREBOAR_LOCAL_ONNX_PATH,
          available: true,
        },
        metadataVector,
      }
    },
  }
}

let runnerPromise: Promise<LocalModelRunner> | null = null

const getRunner = (): Promise<LocalModelRunner> => {
  runnerPromise ??= createBrowserOnnxRunner()
  return runnerPromise
}

chromeApi?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  if (!isScoreTextOffscreenMessage(message)) {
    return false
  }

  void (async () => {
    const metadataVector = preprocessMetadata({ text: message.payload.text, ...message.payload.metadata }).vector
    try {
      const runner = await getRunner()
      sendResponse(createScoreTextResponse(await runner.score(message.payload, metadataVector), message.requestId))
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      const unavailable = createUnavailableScoreTextResult(
        message.payload,
        "runtime_error",
        `Local Scoreboar ONNX inference failed in the offscreen document: ${detail}`,
      )
      sendResponse(createScoreTextResponse(unavailable, message.requestId))
    }
  })()
  return true
})
