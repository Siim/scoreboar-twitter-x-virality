import type { BooleanScores, NumericScores, ScoreProbabilities, ScoreTextResult } from "./inference-runtime.js"

export const SCORE_LABEL_ORDER = ["Very Low", "Low", "Medium", "High", "Very High"] as const

export type InterestingnessTag = (typeof SCORE_LABEL_ORDER)[number]

export type ScoreClassName = "very_low" | "low" | "medium" | "high" | "very_high"

export type ScoreStabilityTier = "solid" | "approx" | "uncertain"

export interface ScoreStability {
  readonly tier: ScoreStabilityTier
  readonly score: number
  readonly label: string
  readonly reasons: readonly string[]
}

export interface InterestingnessScoreLabel {
  readonly status: "scored"
  readonly interestingScore: number
  readonly tag: InterestingnessTag
  readonly insight: ScoreInsight | null
  readonly labelText: string
  readonly confidence: number
  readonly stability: ScoreStability
}

export interface UnavailableScoreLabel {
  readonly status: "unavailable"
  readonly interestingScore: null
  readonly tag: null
  readonly insight: null
  readonly labelText: "Score unavailable"
  readonly confidence: null
  readonly reason?: ScoreTextResult["reason"]
}

export type ScoreLabelSummary = InterestingnessScoreLabel | UnavailableScoreLabel

export type ScoreInsightId =
  | "slop"
  | "clickbait"
  | "rage"
  | "needs_context"
  | "clear_takeaway"
  | "hook"
  | "shareable"
  | "novel"
  | "urgent"
  | "authentic"
  | "debate"

export interface ScoreInsight {
  readonly id: ScoreInsightId
  readonly label: string
  readonly value: number
}

export interface ComposerHint {
  readonly id: "hook_clarity" | "length" | "specificity" | "cta" | "media_cue"
  readonly label: string
  readonly message: string
  readonly active: boolean
}

export interface ComposerHintResult {
  readonly status: "empty" | "ready"
  readonly activeHints: readonly ComposerHint[]
  readonly allHints: readonly ComposerHint[]
}

const SCORE_CLASS_ALIASES: Readonly<Record<ScoreClassName, readonly string[]>> = {
  very_low: ["very_low", "veryLow", "Very Low", "VERY_LOW", "class_0", "0"],
  low: ["low", "Low", "LOW", "class_1", "1"],
  medium: ["medium", "Medium", "MEDIUM", "class_2", "2"],
  high: ["high", "High", "HIGH", "class_3", "3"],
  very_high: ["very_high", "veryHigh", "Very High", "VERY_HIGH", "class_4", "4"],
}

const CLASS_NAMES: readonly ScoreClassName[] = ["very_low", "low", "medium", "high", "very_high"]

const SCORE_INSIGHT_EMOJI: Readonly<Record<ScoreInsightId, string>> = {
  slop: "🤖",
  clickbait: "🎣",
  rage: "🧨",
  needs_context: "🧩",
  clear_takeaway: "💡",
  hook: "🎯",
  shareable: "📣",
  novel: "✨",
  urgent: "⏰",
  authentic: "🫡",
  debate: "🍿",
}

const scoreEmojiForInterestingScore = (interestingScore: number, insight?: ScoreInsight | null): string => {
  if (interestingScore >= 70) {
    if (insight?.id === "hook") return interestingScore >= 92 ? "🚀" : "🎯"
    if (insight?.id === "shareable") return interestingScore >= 92 ? "🚀" : "📣"
    if (insight?.id === "novel") return interestingScore >= 92 ? "🚀" : "✨"
    if (insight?.id === "authentic") return interestingScore >= 92 ? "🚀" : "🫡"
    if (insight?.id === "debate") return interestingScore >= 92 ? "🚀" : "🍿"
    if (insight?.id === "urgent") return interestingScore >= 92 ? "🚀" : "⚡"
  }

  if (interestingScore >= 55 && interestingScore < 70) {
    if (insight?.id === "clear_takeaway") return "💡"
    if (insight?.id === "authentic") return "🫡"
    if (insight?.id === "debate") return "🤔"
  }

  if (interestingScore < 12) return "🥶"
  if (interestingScore < 22) return "😱"
  if (interestingScore < 35) return "😨"
  if (interestingScore < 47) return "🥱"
  if (interestingScore < 60) return "🙂"
  if (interestingScore < 70) return "😎"
  if (interestingScore < 82) return "🤯"
  if (interestingScore < 92) return "🔥"
  return "🚀"
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const roundScore = (value: number): number => Math.round(clamp(value, 0, 100))

const roundMetric = (value: number): number => Math.round(clamp(value, 0, 1) * 1000) / 1000

const paddedPercentScore = (score: number): string => `${String(score).padStart(3, " ")}%`

const probabilityForClass = (probabilities: ScoreProbabilities, className: ScoreClassName): number => {
  for (const alias of SCORE_CLASS_ALIASES[className]) {
    const value = probabilities[alias]
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value
    }
  }

  return 0
}

const tagForScore = (interestingScore: number): InterestingnessTag => {
  if (interestingScore < 20) return "Very Low"
  if (interestingScore < 40) return "Low"
  if (interestingScore < 60) return "Medium"
  if (interestingScore < 80) return "High"
  return "Very High"
}

const entropyConfidence = (probabilities: readonly number[]): number => {
  const entropy = probabilities.reduce((sum, probability) => {
    return probability > 0 ? sum - probability * Math.log(probability) : sum
  }, 0)
  return clamp(1 - entropy / Math.log(CLASS_NAMES.length), 0, 1)
}

const metadataCompleteness = (metadataVector?: readonly number[]): number => {
  if (!metadataVector || metadataVector.length === 0) return 0.5
  const hasTiming = metadataVector.slice(1, 5).some((value) => Number.isFinite(value) && Math.abs(value) > 0.01)
  const hasAuthorScale = metadataVector.slice(5, 9).some((value) => Number.isFinite(value) && Math.abs(value) > 0.01)
  return clamp(0.45 + (hasTiming ? 0.25 : 0) + (hasAuthorScale ? 0.3 : 0), 0, 1)
}

const nearestBoundaryStability = (interestingScore: number): number => {
  const nearestDistance = Math.min(...[20, 40, 60, 80].map((boundary) => Math.abs(boundary - interestingScore)))
  return clamp(nearestDistance / 10, 0, 1)
}

const scoreStabilityTier = (score: number): ScoreStabilityTier => {
  if (score >= 72) return "solid"
  if (score >= 52) return "approx"
  return "uncertain"
}

const stabilityLabel = (tier: ScoreStabilityTier): string => {
  if (tier === "solid") return "solid"
  if (tier === "approx") return "approx"
  return "uncertain"
}

const buildScoreStability = (
  normalized: readonly number[],
  interestingScore: number,
  classScore: number,
  options: { readonly numericScores?: NumericScores; readonly metadataVector?: readonly number[] },
): ScoreStability => {
  const sorted = [...normalized].sort((left, right) => right - left)
  const top = sorted[0] ?? 0
  const runnerUp = sorted[1] ?? 0
  const margin = Math.max(0, top - runnerUp)
  const marginSignal = clamp(margin / 0.35, 0, 1)
  const spreadSignal = entropyConfidence(normalized)
  const viralityScore = options.numericScores?.virality_score
  const hasNumericVirality = typeof viralityScore === "number" && Number.isFinite(viralityScore)
  const agreementSignal = hasNumericVirality ? clamp(1 - Math.abs(clamp(viralityScore, 0, 1) - classScore) / 0.35, 0, 1) : 0.62
  const boundarySignal = nearestBoundaryStability(interestingScore)
  const metadataSignal = metadataCompleteness(options.metadataVector)
  const score = roundScore(
    100 * (
      0.3 * spreadSignal
      + 0.25 * marginSignal
      + 0.2 * agreementSignal
      + 0.15 * boundarySignal
      + 0.1 * metadataSignal
    ),
  )
  const tier = scoreStabilityTier(score)
  const reasons: string[] = []

  if (margin < 0.1) reasons.push("close buckets")
  if (spreadSignal < 0.35) reasons.push("mixed model odds")
  if (hasNumericVirality && agreementSignal < 0.45) reasons.push("class/score disagree")
  if (boundarySignal < 0.35) reasons.push("near bucket edge")
  if (metadataSignal < 0.7) reasons.push("limited metadata")
  if (reasons.length === 0) reasons.push("heads agree")

  return {
    tier,
    score,
    label: stabilityLabel(tier),
    reasons,
  }
}

const scoreSignalValue = (value: number | boolean | undefined): number => {
  if (typeof value === "boolean") {
    return value ? 1 : 0
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(value, 0, 1)
  }
  return 0
}

const numericSignalValue = (scores: NumericScores, key: keyof NumericScores): number => {
  const value = scores[key]
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, 0, 1) : 0
}

export const pickScoreInsight = (
  booleanScores: BooleanScores = {},
  numericScores: NumericScores = {},
): ScoreInsight | null => {
  const booleanCandidates: readonly ScoreInsight[] = [
    { id: "slop", label: "slop", value: scoreSignalValue(booleanScores.is_ai_slop) },
    { id: "clickbait", label: "clickbait", value: scoreSignalValue(booleanScores.is_clickbait) },
    { id: "rage", label: "rage", value: scoreSignalValue(booleanScores.is_rage_bait) },
    { id: "needs_context", label: "needs context", value: scoreSignalValue(booleanScores.needs_context) },
    { id: "clear_takeaway", label: "clear", value: scoreSignalValue(booleanScores.has_clear_takeaway) },
  ]
  const numericCandidates: readonly ScoreInsight[] = [
    { id: "hook", label: "hook", value: numericSignalValue(numericScores, "hook_quality") },
    { id: "shareable", label: "share", value: numericSignalValue(numericScores, "shareability_score") },
    { id: "novel", label: "novel", value: numericSignalValue(numericScores, "novelty_score") },
    { id: "urgent", label: "urgent", value: numericSignalValue(numericScores, "urgency_level") },
    { id: "authentic", label: "auth", value: numericSignalValue(numericScores, "authenticity_score") },
    { id: "debate", label: "debate", value: numericSignalValue(numericScores, "conversation_potential") },
  ]

  const [bestBoolean] = [...booleanCandidates]
    .filter((candidate) => candidate.value >= 0.62)
    .sort((left, right) => right.value - left.value)
  if (bestBoolean) {
    return bestBoolean
  }

  const [bestNumeric] = [...numericCandidates]
    .filter((candidate) => candidate.value >= 0.62)
    .sort((left, right) => right.value - left.value)

  return bestNumeric ?? null
}

export const mapProbabilitiesToInterestingness = (
  probabilities: ScoreProbabilities,
  options: { readonly booleanScores?: BooleanScores; readonly numericScores?: NumericScores; readonly metadataVector?: readonly number[] } = {},
): InterestingnessScoreLabel => {
  const classProbabilities = CLASS_NAMES.map((className) => probabilityForClass(probabilities, className))
  const total = classProbabilities.reduce((sum, value) => sum + value, 0)
  const normalized = total > 0 ? classProbabilities.map((value) => value / total) : [0, 0, 1, 0, 0]
  const weightedClassIndex = normalized.reduce((sum, probability, index) => sum + probability * index, 0)
  const classScore = weightedClassIndex / (CLASS_NAMES.length - 1)
  const numericVirality = options.numericScores?.virality_score
  const scoreSource = typeof numericVirality === "number" && Number.isFinite(numericVirality) ? clamp(numericVirality, 0, 1) : classScore
  const interestingScore = roundScore(scoreSource * 100)
  const tag = tagForScore(interestingScore)
  const confidence = roundMetric(Math.max(...normalized))
  const stability = buildScoreStability(normalized, interestingScore, classScore, options)

  return {
    status: "scored",
    interestingScore,
    tag,
    insight: pickScoreInsight(options.booleanScores, options.numericScores),
    labelText: `${interestingScore} · ${tag}`,
    confidence,
    stability,
  }
}

export const mapScoreTextResultToLabel = (result: ScoreTextResult): ScoreLabelSummary => {
  if (result.status !== "scored") {
    return {
      status: "unavailable",
      interestingScore: null,
      tag: null,
      insight: null,
      labelText: "Score unavailable",
      confidence: null,
      reason: result.reason,
    }
  }

  return mapProbabilitiesToInterestingness(result.probabilities, {
    booleanScores: result.booleanScores,
    numericScores: result.numericScores,
    metadataVector: result.metadataVector,
  })
}

export const formatScoreStability = (stability: ScoreStability): string => {
  const reason = stability.reasons[0]
  return reason ? `${stability.label} ${stability.score}/100 · ${reason}` : `${stability.label} ${stability.score}/100`
}

export const emojiForScoreLabelSummary = (summary: ScoreLabelSummary): string => {
  if (summary.status === "unavailable") return "🫥"
  if (summary.stability.tier === "uncertain") return "🤔"
  if (summary.insight?.id === "slop" || summary.insight?.id === "clickbait" || summary.insight?.id === "rage") {
    return SCORE_INSIGHT_EMOJI[summary.insight.id]
  }
  if (summary.insight?.id === "needs_context") return SCORE_INSIGHT_EMOJI.needs_context
  return scoreEmojiForInterestingScore(summary.interestingScore, summary.insight)
}

export const formatScoreInsight = (insight: ScoreInsight): string => {
  return `${SCORE_INSIGHT_EMOJI[insight.id]} ${insight.label}`
}

export const formatCompactScoreInsight = (insight: ScoreInsight): string => insight.label

export const formatScoreLabelSummary = (summary: ScoreLabelSummary): string => {
  if (summary.status === "unavailable") {
    return "—"
  }

  const scoreText = paddedPercentScore(summary.interestingScore)
  const scorePrefix = emojiForScoreLabelSummary(summary)
  if (summary.stability.tier === "uncertain") {
    return `${scorePrefix} ${scoreText} · rough read`
  }
  if (!summary.insight) return `${scorePrefix} ${scoreText}`
  const insightText = SCORE_INSIGHT_EMOJI[summary.insight.id] === scorePrefix ? formatCompactScoreInsight(summary.insight) : formatScoreInsight(summary.insight)
  return `${scorePrefix} ${scoreText} · ${insightText}`
}

const wordCount = (text: string): number => text.trim().split(/\s+/u).filter(Boolean).length

const hasSpecificity = (text: string): boolean => {
  return /\b\d+(?:[.,]\d+)?%?\b/u.test(text) || /\b(today|tomorrow|this week|because|how|why|when|where|who)\b/iu.test(text)
}

const hasCallToAction = (text: string): boolean => {
  return /\b(reply|comment|share|follow|try|read|watch|join|tell me|what do you think|should we|click|save)\b/iu.test(text)
}

export const analyzeComposerHints = (text: string, options: { readonly hasMedia?: boolean } = {}): ComposerHintResult => {
  const trimmed = text.trim()
  const isEmpty = trimmed.length === 0
  const words = wordCount(trimmed)
  const startsWithHook = /^(how|why|what|when|where|who|stop|start|the|this|i|we|you|new|today|breaking)\b/iu.test(trimmed)
  const hasQuestionOrClaim = /[?!]/u.test(trimmed) || /\b(is|are|can|will|should|turns out|here's|here is)\b/iu.test(trimmed)

  const allHints: readonly ComposerHint[] = [
    {
      id: "hook_clarity",
      label: "Sharpen hook",
      message: "Open with a clear question, claim, or tension.",
      active: !isEmpty && (!startsWithHook || !hasQuestionOrClaim),
    },
    {
      id: "length",
      label: "Tighten length",
      message: "Keep the post compact enough to scan quickly.",
      active: !isEmpty && (words < 4 || words > 45 || trimmed.length > 240),
    },
    {
      id: "specificity",
      label: "Add specifics",
      message: "Add a concrete number, timeframe, audience, or reason.",
      active: !isEmpty && !hasSpecificity(trimmed),
    },
    {
      id: "cta",
      label: "Add CTA",
      message: "Invite replies, shares, or a concrete next action.",
      active: !isEmpty && !hasCallToAction(trimmed),
    },
    {
      id: "media_cue",
      label: "Consider media",
      message: "Add or reference an image/video when it clarifies the point.",
      active: !isEmpty && options.hasMedia !== true && /\b(show|look|chart|graph|image|video|demo|screenshot|visual)\b/iu.test(trimmed),
    },
  ]

  return {
    status: isEmpty ? "empty" : "ready",
    activeHints: allHints.filter((hint) => hint.active),
    allHints,
  }
}
