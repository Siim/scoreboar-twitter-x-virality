import { type MetadataPreprocessInput, preprocessMetadata } from "./contracts.js"
import {
  createScoringGuardrails,
  createTextScoringCacheKey,
  type ScoreboarScoringGuardrailController,
} from "./scoring-guardrails.js"

export const SCOREBOAR_SCORE_TEXT_MESSAGE = "scoreboar.scoreText" as const
export const SCOREBOAR_SCORE_TEXT_OFFSCREEN_MESSAGE = "scoreboar.scoreText.offscreen" as const
export const SCOREBOAR_SCORE_TEXT_RESPONSE_MESSAGE = "scoreboar.scoreText.response" as const

export const SCOREBOAR_MODEL_VERSION = "v8" as const
export const SCOREBOAR_LOCAL_ONNX_PATH = "extension/assets/model/scoreboar-v8.onnx" as const
export const SCOREBOAR_MODEL_METADATA_PATH = "extension/assets/model/scoreboar-v8.json" as const
/** Longest token sequence the model was trained on; longer posts keep their opening. */
export const SCOREBOAR_MAX_TOKENS = 128 as const

export const NUMERIC_SCORE_NAMES = [
  "virality_score",
  "hook_quality",
  "clarity_score",
  "novelty_score",
  "emotional_intensity",
  "controversy_level",
  "shareability_score",
  "conversation_potential",
  "authenticity_score",
  "urgency_level",
  "call_to_action_strength",
  "trend_alignment",
  "expected_performance",
] as const

export const BOOLEAN_SCORE_NAMES = [
  "is_rage_bait",
  "is_clickbait",
  "is_ai_slop",
  "needs_context",
  "has_clear_takeaway",
] as const

export type ScoreboarScoreStatus = "unavailable" | "scored"
export type ScoreboarScoreLabel = "model_unavailable" | "needs_local_model" | "scored"
export type ScoreboarUnavailableReason =
  | "disabled_by_environment"
  | "missing_local_onnx_artifact"
  | "local_model_not_initialized"
  | "runtime_error"

export type NumericScoreName = (typeof NUMERIC_SCORE_NAMES)[number]
export type BooleanScoreName = (typeof BOOLEAN_SCORE_NAMES)[number]

export interface ScoreTextMetadata extends MetadataPreprocessInput {
  readonly source?: "composer" | "tweet" | "fixture" | "unknown"
  readonly url?: string
}

export interface ScoreTextInput {
  readonly text: string
  readonly metadata?: ScoreTextMetadata
}

export interface ScoreTextPayload extends ScoreTextInput {}

export interface ScoreTextRequestMessage {
  readonly type: typeof SCOREBOAR_SCORE_TEXT_MESSAGE
  readonly requestId?: string
  readonly payload: ScoreTextPayload
}

export interface ScoreTextOffscreenMessage {
  readonly type: typeof SCOREBOAR_SCORE_TEXT_OFFSCREEN_MESSAGE
  readonly requestId?: string
  readonly payload: ScoreTextPayload
}

export interface ScoreTextResponseMessage {
  readonly type: typeof SCOREBOAR_SCORE_TEXT_RESPONSE_MESSAGE
  readonly requestId?: string
  readonly payload: ScoreTextResult
}

export type ScoreboarRuntimeMessage =
  | ScoreTextRequestMessage
  | ScoreTextOffscreenMessage
  | ScoreTextResponseMessage

export type ScoreProbabilities = Readonly<Record<string, number>>
export type NumericScores = Readonly<Partial<Record<NumericScoreName, number>>>
export type BooleanScores = Readonly<Partial<Record<BooleanScoreName, number | boolean>>>

/**
 * What the model predicts about how a post will do, all calibrated on
 * ordinary posts it never trained on.
 */
export interface PerformancePrediction {
  /** 0-1: rank against ordinary posts, after accounting for the author's reach. 0.7 = beats 70%. */
  readonly percentile: number
  /** Predicted engagement as a multiple of what this account's reach alone predicts. */
  readonly engagementMultiple: number
  /** Predicted views as a multiple of what this account's reach alone predicts. */
  readonly reachMultiple: number
}

export interface ScoreTextResult {
  readonly status: ScoreboarScoreStatus
  readonly label: ScoreboarScoreLabel
  readonly confidence: number | null
  /** Calibrated chance of landing in each fifth of ordinary posts' performance (very_low..very_high). */
  readonly probabilities: ScoreProbabilities
  readonly performance?: PerformancePrediction | null
  readonly numericScores: NumericScores
  readonly booleanScores?: BooleanScores
  readonly reason?: ScoreboarUnavailableReason
  readonly message: string
  readonly model: {
    readonly provider: "local-onnx"
    readonly path: typeof SCOREBOAR_LOCAL_ONNX_PATH
    readonly version: typeof SCOREBOAR_MODEL_VERSION
    readonly available: boolean
  }
  readonly metadataVector: readonly number[]
}

export interface LocalModelRunner {
  /** `normalizedText` is the contract-normalized text the model reads; runners fall back to the raw text. */
  readonly score: (input: ScoreTextInput, metadataVector: readonly number[], normalizedText?: string) => Promise<ScoreTextResult>
}

export interface ScoreTextOptions {
  readonly disableModel?: boolean
  readonly modelAvailable?: boolean
  readonly runner?: LocalModelRunner
}

export interface HandleScoreTextOptions extends ScoreTextOptions {
  readonly scoringGuardrails?: ScoreboarScoringGuardrailController<ScoreTextPayload, ScoreTextResult> | false
}

const defaultScoreTextGuardrails = createScoringGuardrails<ScoreTextPayload, ScoreTextResult>({
  keyFor: (payload) => createTextScoringCacheKey(payload.text, payload.metadata as object | undefined),
})

const processEnv = (): Record<string, string | undefined> | undefined => {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
}

const envDisablesModel = (): boolean => {
  const value = processEnv()?.SCOREBOAR_DISABLE_MODEL
  return value === "1" || value === "true" || value === "yes"
}

export const createUnavailableScoreTextResult = (
  input: ScoreTextInput,
  reason: ScoreboarUnavailableReason,
  message: string,
): ScoreTextResult => {
  const metadataVector = preprocessMetadata({ ...input.metadata, text: input.text }).vector

  return {
    status: "unavailable",
    label: "model_unavailable",
    confidence: null,
    probabilities: {},
    numericScores: {},
    reason,
    message,
    model: {
      provider: "local-onnx",
      path: SCOREBOAR_LOCAL_ONNX_PATH,
      version: SCOREBOAR_MODEL_VERSION,
      available: false,
    },
    metadataVector,
  }
}

export const scoreText = async (
  input: ScoreTextInput,
  options: ScoreTextOptions = {},
): Promise<ScoreTextResult> => {
  if (options.disableModel === true || envDisablesModel()) {
    return createUnavailableScoreTextResult(
      input,
      "disabled_by_environment",
      "Local Scoreboar inference is disabled by SCOREBOAR_DISABLE_MODEL.",
    )
  }

  const { vector: metadataVector, normalizedText } = preprocessMetadata({ ...input.metadata, text: input.text })

  if (options.runner && options.modelAvailable === true) {
    try {
      return await options.runner.score(input, metadataVector, normalizedText)
    } catch {
      return createUnavailableScoreTextResult(
        input,
        "runtime_error",
        "Local Scoreboar inference failed before producing a score.",
      )
    }
  }

  return createUnavailableScoreTextResult(
    input,
    options.modelAvailable === true ? "local_model_not_initialized" : "missing_local_onnx_artifact",
    "Local Scoreboar ONNX artifact is not packaged yet; no text leaves the extension.",
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null
}

export const isScoreTextRequestMessage = (message: unknown): message is ScoreTextRequestMessage => {
  if (!isRecord(message) || message.type !== SCOREBOAR_SCORE_TEXT_MESSAGE || !isRecord(message.payload)) {
    return false
  }

  return typeof message.payload.text === "string"
}

export const isScoreTextOffscreenMessage = (message: unknown): message is ScoreTextOffscreenMessage => {
  if (!isRecord(message) || message.type !== SCOREBOAR_SCORE_TEXT_OFFSCREEN_MESSAGE || !isRecord(message.payload)) {
    return false
  }

  return typeof message.payload.text === "string"
}

export const createScoreTextRequest = (
  payload: ScoreTextPayload,
  requestId?: string,
): ScoreTextRequestMessage => ({
  type: SCOREBOAR_SCORE_TEXT_MESSAGE,
  requestId,
  payload,
})

export const createScoreTextOffscreenRequest = (
  payload: ScoreTextPayload,
  requestId?: string,
): ScoreTextOffscreenMessage => ({
  type: SCOREBOAR_SCORE_TEXT_OFFSCREEN_MESSAGE,
  requestId,
  payload,
})

export const createScoreTextResponse = (
  payload: ScoreTextResult,
  requestId?: string,
): ScoreTextResponseMessage => ({
  type: SCOREBOAR_SCORE_TEXT_RESPONSE_MESSAGE,
  requestId,
  payload,
})

export const handleScoreTextMessage = async (
  message: unknown,
  options: HandleScoreTextOptions = {},
): Promise<ScoreTextResponseMessage | null> => {
  if (!isScoreTextRequestMessage(message) && !isScoreTextOffscreenMessage(message)) {
    return null
  }

  const guardrails = options.scoringGuardrails === false ? null : options.scoringGuardrails ?? defaultScoreTextGuardrails
  const result = guardrails
    ? await guardrails.score(message.payload, (payload) => scoreText(payload, options))
    : await scoreText(message.payload, options)
  return createScoreTextResponse(result, message.requestId)
}
