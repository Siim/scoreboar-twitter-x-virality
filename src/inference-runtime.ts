import { type MetadataPreprocessInput, preprocessMetadata } from "./contracts.js"
import {
  createScoringGuardrails,
  createTextScoringCacheKey,
  type ScoreboarScoringGuardrailController,
} from "./scoring-guardrails.js"

export const SCOREBOAR_SCORE_TEXT_MESSAGE = "scoreboar.scoreText" as const
export const SCOREBOAR_SCORE_TEXT_OFFSCREEN_MESSAGE = "scoreboar.scoreText.offscreen" as const
export const SCOREBOAR_SCORE_TEXT_RESPONSE_MESSAGE = "scoreboar.scoreText.response" as const

export const SCOREBOAR_LOCAL_ONNX_PATH = "extension/assets/model/v5-full.onnx" as const
export const SCOREBOAR_V5_VIRALITY_TEMPERATURE = 1.325 as const

export const V5_NUMERIC_SCORE_NAMES = [
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
] as const

export const V5_BOOLEAN_SCORE_NAMES = [
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

export type V5NumericScoreName = (typeof V5_NUMERIC_SCORE_NAMES)[number]
export type V5BooleanScoreName = (typeof V5_BOOLEAN_SCORE_NAMES)[number]

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
export type NumericScores = Readonly<Partial<Record<V5NumericScoreName, number>>>
export type BooleanScores = Readonly<Partial<Record<V5BooleanScoreName, number | boolean>>>

export interface ScoreTextResult {
  readonly status: ScoreboarScoreStatus
  readonly label: ScoreboarScoreLabel
  readonly confidence: number | null
  readonly probabilities: ScoreProbabilities
  readonly numericScores: NumericScores
  readonly booleanScores?: BooleanScores
  readonly reason?: ScoreboarUnavailableReason
  readonly message: string
  readonly model: {
    readonly provider: "local-onnx"
    readonly path: typeof SCOREBOAR_LOCAL_ONNX_PATH
    readonly available: boolean
  }
  readonly metadataVector: readonly number[]
}

export interface LocalModelRunner {
  readonly score: (input: ScoreTextInput, metadataVector: readonly number[]) => Promise<ScoreTextResult>
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
  const metadataVector = preprocessMetadata({ text: input.text, ...input.metadata }).vector

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

  const metadataVector = preprocessMetadata({ text: input.text, ...input.metadata }).vector

  if (options.runner && options.modelAvailable === true) {
    try {
      return await options.runner.score(input, metadataVector)
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
