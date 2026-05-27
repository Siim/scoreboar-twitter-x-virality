import type { TweetFoundEvent } from "./dom-detection.js"
import { type ScoreTextResult, createUnavailableScoreTextResult } from "./inference-runtime.js"
import { emojiForScoreLabelSummary, type ScoreLabelSummary, formatCompactScoreInsight, formatScoreInsight, mapScoreTextResultToLabel } from "./score-mapping.js"
import { createScoringGuardrails, createTextScoringCacheKey } from "./scoring-guardrails.js"

export const SCOREBOAR_BADGE_ATTRIBUTE = "data-scoreboar-feed-badge" as const
export const SCOREBOAR_BADGE_STATE_ATTRIBUTE = "data-scoreboar-feed-badge-state" as const
export const SCOREBOAR_BADGE_STYLE_ATTRIBUTE = "data-scoreboar-feed-badge-style" as const

export type FeedBadgeState = "pending" | "scored" | "unavailable"

export interface FeedBadgeScorer {
  readonly scoreTweet: (text: string, metadata: Record<string, unknown>) => Promise<ScoreTextResult | null | undefined>
}

export interface FeedBadgeControllerOptions {
  readonly document: Document
  readonly scorer?: FeedBadgeScorer
  readonly scoringConcurrency?: number
  readonly scoringCacheSize?: number
}

interface FeedBadgeScoreRequest {
  readonly text: string
  readonly metadata: Record<string, unknown>
}

const BADGE_TEXT_BY_STATE: Readonly<Record<FeedBadgeState, string>> = {
  pending: "…",
  scored: "Score ready",
  unavailable: "—",
}

const BADGE_CSS = `
.scoreboar-feed-badge {
  --scoreboar-badge-ink: rgb(83 100 113);
  --scoreboar-badge-ink-strong: rgb(15 20 25);
  --scoreboar-badge-accent: rgb(29 155 240);
  align-items: center;
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  box-sizing: border-box;
  color: var(--scoreboar-badge-ink);
  cursor: default;
  display: inline-flex;
  flex: 0 0 auto !important;
  font: 500 0.8125rem/1.25 TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  gap: 0.3rem;
  height: 2rem !important;
  letter-spacing: 0;
  margin: 0 !important;
  max-inline-size: 10rem;
  min-block-size: 0 !important;
  min-inline-size: 0 !important;
  overflow: hidden;
  padding: 0 !important;
  pointer-events: auto;
  position: relative;
  white-space: nowrap;
  vertical-align: top;
  width: auto !important;
}
.scoreboar-feed-badge:focus-visible {
  border-radius: 999px !important;
  outline: 2px solid rgb(29 155 240 / 0.55);
  outline-offset: 2px;
}
.scoreboar-feed-badge[data-scoreboar-feed-badge-open="true"] {
  overflow: visible;
}
.scoreboar-feed-badge[data-scoreboar-feed-badge-placement="top-tools"] {
  margin-inline-end: 0.375rem !important;
}
.scoreboar-feed-badge__details {
  background: rgb(255 255 255 / 0.98);
  border: 1px solid rgb(207 217 222 / 0.85);
  border-radius: 0.75rem;
  box-shadow: 0 0.75rem 2rem rgb(15 20 25 / 0.18);
  color: rgb(15 20 25);
  display: none;
  font: 500 0.75rem/1.35 TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  inline-size: 16.5rem;
  padding: 0.75rem;
  position: fixed;
  right: auto;
  top: var(--scoreboar-popover-top, 0px);
  left: var(--scoreboar-popover-left, 0px);
  user-select: text;
  white-space: normal;
  z-index: 2147483647;
}
.scoreboar-feed-badge__details::before {
  background: inherit;
  border-block-start: 1px solid rgb(207 217 222 / 0.85);
  border-inline-start: 1px solid rgb(207 217 222 / 0.85);
  block-size: 0.625rem;
  content: "";
  inline-size: 0.625rem;
  inset-block-start: -0.375rem;
  inset-inline-start: var(--scoreboar-popover-arrow-left, 1rem);
  position: absolute;
  transform: rotate(45deg);
}
.scoreboar-feed-badge__details[data-scoreboar-feed-details-open="true"] {
  display: grid;
  gap: 0.5rem;
}
.scoreboar-feed-badge__details-title {
  color: inherit;
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-weight: 800;
}
.scoreboar-feed-badge__details-kicker {
  color: rgb(83 100 113);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.scoreboar-feed-badge__details-list {
  display: grid;
  gap: 0.375rem;
  margin: 0;
}
.scoreboar-feed-badge__details-row {
  align-items: start;
  display: grid;
  column-gap: 0.375rem;
  grid-template-columns: 4.75rem 1fr;
  min-block-size: 1.375rem;
}
.scoreboar-feed-badge__details-label {
  color: rgb(83 100 113);
  font-weight: 700;
  line-height: 1.375rem;
}
.scoreboar-feed-badge__details-value {
  align-items: center;
  color: rgb(15 20 25);
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  font-weight: 700;
  line-height: 1;
  margin: 0;
  min-width: 0;
}
.scoreboar-feed-badge__details-chips {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.scoreboar-feed-badge__details-chip {
  align-items: center;
  background: rgb(15 20 25 / 0.06);
  border: 1px solid rgb(15 20 25 / 0.08);
  border-radius: 999px;
  color: rgb(15 20 25);
  display: inline-flex;
  font-size: 0.6875rem;
  font-weight: 700;
  line-height: 1;
  min-block-size: 1.25rem;
  padding: 0 0.375rem;
  white-space: nowrap;
}
.scoreboar-feed-badge__details-chip + .scoreboar-feed-badge__details-chip::before {
  content: none;
}
.scoreboar-feed-badge__details-chip[data-scoreboar-chip-tone="danger"] {
  background: rgb(244 63 94 / 0.12);
  border-color: rgb(244 63 94 / 0.18);
  color: rgb(190 18 60);
}
.scoreboar-feed-badge__details-chip[data-scoreboar-chip-tone="good"] {
  background: rgb(5 150 105 / 0.12);
  border-color: rgb(5 150 105 / 0.18);
  color: rgb(4 120 87);
}
.scoreboar-feed-badge[data-scoreboar-feed-badge-placement="fallback"] {
  margin: 0.375rem 0 0 auto !important;
}
.scoreboar-feed-badge__prefix {
  align-items: center;
  background: #050505;
  border-radius: 0.3125rem;
  color: #fff;
  display: inline-flex;
  flex: 0 0 auto;
  font-size: 0.75rem;
  font-weight: 900;
  block-size: 1.125rem;
  inline-size: 1.125rem;
  justify-content: center;
  letter-spacing: -0.04em;
  line-height: 1;
}
.scoreboar-feed-badge__value {
  color: inherit;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
}
.scoreboar-feed-badge[data-scoreboar-feed-badge-state="scored"] .scoreboar-feed-badge__value {
  color: var(--scoreboar-badge-ink-strong);
  font-weight: 700;
}
.scoreboar-feed-badge[data-scoreboar-feed-badge-state="pending"] {
  --scoreboar-badge-accent: rgb(100 116 139);
}
.scoreboar-feed-badge[data-scoreboar-feed-badge-state="scored"] {
  --scoreboar-badge-accent: rgb(5 150 105);
}
.scoreboar-feed-badge[data-scoreboar-feed-badge-state="unavailable"] {
  --scoreboar-badge-accent: rgb(83 100 113);
  opacity: 0.48;
}
@media (prefers-color-scheme: dark) {
  .scoreboar-feed-badge {
    --scoreboar-badge-ink: rgb(113 118 123);
    --scoreboar-badge-ink-strong: rgb(231 233 234);
  }
  .scoreboar-feed-badge__details {
    background: rgb(0 0 0 / 0.92);
    border-color: rgb(47 51 54 / 0.95);
    color: rgb(231 233 234);
  }
  .scoreboar-feed-badge__details::before {
    border-color: rgb(47 51 54 / 0.95);
  }
  .scoreboar-feed-badge__details-row {
    color: rgb(113 118 123);
  }
  .scoreboar-feed-badge__details-kicker,
  .scoreboar-feed-badge__details-label {
    color: rgb(113 118 123);
  }
  .scoreboar-feed-badge__details-value,
  .scoreboar-feed-badge__details-chip {
    color: rgb(231 233 234);
  }
  .scoreboar-feed-badge__details-chip {
    background: rgb(231 233 234 / 0.08);
    border-color: rgb(231 233 234 / 0.1);
  }
  .scoreboar-feed-badge__details-chip[data-scoreboar-chip-tone="danger"] {
    background: rgb(251 113 133 / 0.13);
    border-color: rgb(251 113 133 / 0.18);
    color: rgb(251 113 133);
  }
  .scoreboar-feed-badge__details-chip[data-scoreboar-chip-tone="good"] {
    background: rgb(52 211 153 / 0.12);
    border-color: rgb(52 211 153 / 0.18);
    color: rgb(52 211 153);
  }
}
`.trim()

const ensureBadgeStyles = (document: Document) => {
  if (document.querySelector(`style[${SCOREBOAR_BADGE_STYLE_ATTRIBUTE}="true"]`)) {
    return
  }

  const style = document.createElement("style")
  style.setAttribute(SCOREBOAR_BADGE_STYLE_ATTRIBUTE, "true")
  style.textContent = BADGE_CSS
  document.head?.append(style)
}

const fallbackResult = (text: string): ScoreTextResult => createUnavailableScoreTextResult(
  { text, metadata: { source: "tweet" } },
  "missing_local_onnx_artifact",
  "Local Scoreboar ONNX artifact is not packaged yet; no text leaves the extension.",
)

const createBadgeElement = (document: Document): HTMLElement => {
  const badge = document.createElement("div")
  badge.className = "scoreboar-feed-badge"
  badge.setAttribute(SCOREBOAR_BADGE_ATTRIBUTE, "true")
  badge.setAttribute("aria-live", "polite")
  badge.setAttribute("aria-label", BADGE_TEXT_BY_STATE.pending)
  badge.setAttribute("role", "button")
  badge.setAttribute("tabindex", "0")
  badge.setAttribute("aria-expanded", "false")

  const prefix = document.createElement("span")
  prefix.className = "scoreboar-feed-badge__prefix"
  prefix.setAttribute("aria-hidden", "true")
  prefix.textContent = "S"

  const value = document.createElement("span")
  value.className = "scoreboar-feed-badge__value"

  const details = document.createElement("div")
  details.className = "scoreboar-feed-badge__details"
  const detailsId = `scoreboar-feed-details-${Math.random().toString(36).slice(2)}`
  details.id = detailsId
  details.setAttribute("role", "dialog")
  details.setAttribute("aria-label", "Scoreboar details")
  badge.setAttribute("aria-controls", detailsId)
  document.body?.append(details)
  let closeTimer: number | null = null

  const clearCloseTimer = () => {
    if (closeTimer !== null) {
      document.defaultView?.clearTimeout(closeTimer)
      closeTimer = null
    }
  }

  const closeDetails = () => {
    clearCloseTimer()
    badge.setAttribute("data-scoreboar-feed-badge-open", "false")
    badge.setAttribute("aria-expanded", "false")
    details.setAttribute("data-scoreboar-feed-details-open", "false")
  }

  const scheduleCloseDetails = () => {
    clearCloseTimer()
    closeTimer = document.defaultView?.setTimeout(closeDetails, 180) ?? null
  }

  const positionDetails = () => {
    const rect = badge.getBoundingClientRect()
    const popoverWidth = 264
    const viewportWidth = document.defaultView?.innerWidth ?? 1024
    const viewportHeight = document.defaultView?.innerHeight ?? 768
    const triggerCenter = rect.left + rect.width / 2
    const left = Math.max(8, Math.min(triggerCenter - 28, viewportWidth - popoverWidth - 8))
    const top = Math.max(8, Math.min(rect.bottom + 8, viewportHeight - 8))
    const arrowLeft = Math.max(12, Math.min(triggerCenter - left - 5, popoverWidth - 20))
    details.style.setProperty("--scoreboar-popover-left", `${left}px`)
    details.style.setProperty("--scoreboar-popover-top", `${top}px`)
    details.style.setProperty("--scoreboar-popover-arrow-left", `${arrowLeft}px`)
  }

  const setDetailsOpen = (nextOpen: boolean) => {
    clearCloseTimer()
    document.querySelectorAll<HTMLElement>(".scoreboar-feed-badge__details").forEach((openDetails) => {
      if (openDetails !== details) {
        openDetails.setAttribute("data-scoreboar-feed-details-open", "false")
      }
    })
    document.querySelectorAll<HTMLElement>(`[${SCOREBOAR_BADGE_ATTRIBUTE}="true"]`).forEach((openBadge) => {
      if (openBadge !== badge) {
        openBadge.setAttribute("data-scoreboar-feed-badge-open", "false")
        openBadge.setAttribute("aria-expanded", "false")
      }
    })
    badge.setAttribute("data-scoreboar-feed-badge-open", String(nextOpen))
    badge.setAttribute("aria-expanded", String(nextOpen))
    details.setAttribute("data-scoreboar-feed-details-open", String(nextOpen))
    if (nextOpen) {
      positionDetails()
    }
  }

  badge.addEventListener("mouseenter", () => setDetailsOpen(true))
  badge.addEventListener("mouseleave", scheduleCloseDetails)
  details.addEventListener("mouseenter", clearCloseTimer)
  details.addEventListener("mouseleave", scheduleCloseDetails)
  badge.addEventListener("focus", () => setDetailsOpen(true))
  badge.addEventListener("blur", scheduleCloseDetails)
  badge.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    const isOpen = badge.getAttribute("data-scoreboar-feed-badge-open") === "true"
    setDetailsOpen(!isOpen)
  })
  badge.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDetails()
      badge.focus()
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      const isOpen = badge.getAttribute("data-scoreboar-feed-badge-open") === "true"
      setDetailsOpen(!isOpen)
    }
  })

  document.defaultView?.addEventListener("scroll", closeDetails, { passive: true })
  document.defaultView?.addEventListener("resize", closeDetails)

  badge.append(prefix, value)
  return badge
}

const findTopToolTarget = (tweetRoot: Element): Element | null => {
  const selectors = [
    '[aria-label*="Grok" i]',
    '[data-testid*="grok" i]',
    'a[href*="/i/grok"]',
    '[aria-label="More"]',
    '[data-testid="caret"]',
  ]

  for (const selector of selectors) {
    const target = tweetRoot.querySelector(selector)
    if (target && !target.closest(`[${SCOREBOAR_BADGE_ATTRIBUTE}="true"]`)) {
      return target.closest("button, a, [role='button']") ?? target
    }
  }

  return null
}

const findOrCreateBadge = (tweetRoot: Element, document: Document): HTMLElement => {
  const existing = tweetRoot.querySelector<HTMLElement>(`[${SCOREBOAR_BADGE_ATTRIBUTE}="true"]`)
  if (existing) {
    return existing
  }

  const badge = createBadgeElement(document)
  const topToolTarget = findTopToolTarget(tweetRoot)
  if (topToolTarget?.parentElement) {
    badge.setAttribute("data-scoreboar-feed-badge-placement", "top-tools")
    topToolTarget.insertAdjacentElement("beforebegin", badge)
  } else {
    badge.setAttribute("data-scoreboar-feed-badge-placement", "fallback")
    tweetRoot.append(badge)
  }
  return badge
}

const setBadge = (badge: HTMLElement, state: FeedBadgeState, label: string) => {
  badge.setAttribute(SCOREBOAR_BADGE_STATE_ATTRIBUTE, state)
  const accessibleLabel = state === "unavailable" ? "Scoreboar score unavailable: local ONNX model is not packaged yet" : `Scoreboar ${label}`
  badge.setAttribute("aria-label", accessibleLabel)
  badge.setAttribute("title", accessibleLabel)
  const value = badge.querySelector<HTMLElement>(".scoreboar-feed-badge__value")
  if (value) {
    value.textContent = label
  }
}

const scorePercent = (value: number | boolean | undefined): number | null => {
  if (typeof value === "boolean") return value ? 100 : 0
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.round(Math.min(1, Math.max(0, value)) * 100)
}

const formatPercent = (value: number | boolean | undefined): string | null => {
  const percent = scorePercent(value)
  return percent === null ? null : `${percent}%`
}

interface ProbabilityEntry {
  readonly name: string
  readonly value: number
  readonly label: string
  readonly rank: number | null
}

const probabilityEntries = (result: ScoreTextResult): readonly ProbabilityEntry[] => {
  const labels: Readonly<Record<string, { readonly name: string; readonly rank: number }>> = {
    very_low: { name: "very low", rank: 0 },
    low: { name: "low", rank: 1 },
    medium: { name: "medium", rank: 2 },
    high: { name: "high", rank: 3 },
    very_high: { name: "very high", rank: 4 },
  }

  return Object.entries(result.probabilities)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
    .map(([name, value]) => {
      const label = labels[name]
      const displayName = label?.name ?? name.replace(/_/gu, " ")
      return { name: displayName, value, label: `${displayName} ${Math.round(value * 100)}%`, rank: label?.rank ?? null }
    })
    .sort((left, right) => right.value - left.value)
    .slice(0, 3)
}

const winningClassText = (classOdds: readonly ProbabilityEntry[]): string => {
  const [winner, runnerUp] = classOdds
  if (!winner) return "unavailable"
  const topIsStrong = winner.value >= 0.7 || !runnerUp || winner.value - runnerUp.value >= 0.35
  if (topIsStrong) return winner.label

  if (winner.rank !== null && runnerUp.rank !== null && Math.abs(winner.rank - runnerUp.rank) === 1) {
    const [lower, higher] = [winner, runnerUp].sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0))
    return `${lower.name}–${higher.name} · ${Math.round((winner.value + runnerUp.value) * 100)}% range`
  }

  return `mixed · ${winner.name}/${runnerUp.name} · ${Math.round((winner.value + runnerUp.value) * 100)}% range`
}

const reliabilityChips = (summary: ScoreLabelSummary): readonly string[] => {
  if (summary.status === "unavailable") return ["unavailable"]
  if (summary.stability.tier === "solid") return ["solid estimate"]
  if (summary.stability.tier === "approx") return ["approx estimate"]
  return ["rough estimate"]
}

const detailsTitleText = (summary: ScoreLabelSummary): string => {
  if (summary.status === "unavailable") return "Score unavailable"
  const scoreText = `${String(summary.interestingScore).padStart(3, " ")}%`
  const prefix = emojiForScoreLabelSummary(summary)
  return `${prefix} ${scoreText}`
}

const compactSignalEntries = (result: ScoreTextResult): readonly string[] => {
  const signals: readonly [string, number | undefined][] = [
    ["hook", result.numericScores.hook_quality],
    ["share", result.numericScores.shareability_score],
    ["novel", result.numericScores.novelty_score],
    ["debate", result.numericScores.conversation_potential],
    ["auth", result.numericScores.authenticity_score],
  ]

  return signals
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value) && value >= 0.4)
    .sort((left, right) => (right[1] ?? 0) - (left[1] ?? 0))
    .slice(0, 5)
    .map(([label, value]) => {
      const percent = formatPercent(value)
      return percent ? `${label} ${percent}` : null
    })
    .filter((entry): entry is string => entry !== null)
}

const warningEntries = (result: ScoreTextResult): readonly string[] => {
  const warnings: readonly [string, number | boolean | undefined][] = [
    ["🤖 slop", result.booleanScores?.is_ai_slop],
    ["🎣 bait", result.booleanScores?.is_clickbait],
    ["🧨 rage", result.booleanScores?.is_rage_bait],
    ["🧩 needs context", result.booleanScores?.needs_context],
  ]

  return warnings
    .map(([label, value]) => {
      const percent = scorePercent(value)
      return percent !== null && percent >= 50 ? `${label} ${percent}%` : null
    })
    .filter((entry): entry is string => entry !== null)
}

const setBadgeDetails = (
  badge: HTMLElement,
  summary: ScoreLabelSummary,
  result: ScoreTextResult,
) => {
  const detailsId = badge.getAttribute("aria-controls")
  const details = detailsId ? badge.ownerDocument.getElementById(detailsId) : null
  if (!details) return

  const topSignals = compactSignalEntries(result)
  const warnings = warningEntries(result)
  const classOdds = probabilityEntries(result)

  details.replaceChildren()
  const title = badge.ownerDocument.createElement("div")
  title.className = "scoreboar-feed-badge__details-title"
  title.textContent = detailsTitleText(summary)

  const kicker = badge.ownerDocument.createElement("div")
  kicker.className = "scoreboar-feed-badge__details-kicker"
  kicker.textContent = "Local v5 ONNX"

  const list = badge.ownerDocument.createElement("dl")
  list.className = "scoreboar-feed-badge__details-list"

  const appendRow = (label: string, value: string | HTMLElement) => {
    const row = badge.ownerDocument.createElement("div")
    row.className = "scoreboar-feed-badge__details-row"
    const term = badge.ownerDocument.createElement("dt")
    term.className = "scoreboar-feed-badge__details-label"
    term.textContent = `${label}: `
    const description = badge.ownerDocument.createElement("dd")
    description.className = "scoreboar-feed-badge__details-value"
    if (typeof value === "string") {
      const chips = badge.ownerDocument.createElement("span")
      chips.className = "scoreboar-feed-badge__details-chips"
      const chip = badge.ownerDocument.createElement("span")
      chip.className = "scoreboar-feed-badge__details-chip"
      chip.textContent = value
      chips.append(chip)
      description.append(chips)
    } else {
      description.append(value)
    }
    row.append(term, description)
    list.append(row)
  }

  const createChips = (
    entries: readonly string[],
    toneFor: (entry: string) => string | null = () => null,
    emptyText = "unavailable",
  ): HTMLElement => {
    const chips = badge.ownerDocument.createElement("span")
    chips.className = "scoreboar-feed-badge__details-chips"
    if (entries.length > 0) {
      for (const signal of entries) {
        const chip = badge.ownerDocument.createElement("span")
        chip.className = "scoreboar-feed-badge__details-chip"
        const tone = toneFor(signal)
        if (tone) {
          chip.setAttribute("data-scoreboar-chip-tone", tone)
        }
        chip.textContent = signal
        chips.append(chip)
      }
    } else {
      chips.textContent = emptyText
    }
    return chips
  }

  const signalChips = createChips(topSignals, () => null, "no strong signals")
  const warningChips = createChips(warnings, (entry) => /^(🤖|🎣|🧨)/u.test(entry) ? "danger" : null, "no strong flags")

  if (summary.status === "scored" && summary.insight?.id && ["slop", "clickbait", "rage"].includes(summary.insight.id)) {
    const chip = badge.ownerDocument.createElement("span")
    chip.className = "scoreboar-feed-badge__details-chip"
    chip.setAttribute("data-scoreboar-chip-tone", "danger")
    chip.textContent = `🚩 top: ${formatScoreInsight(summary.insight)}`
    warningChips.prepend(chip)
  }

  const modelStats = badge.ownerDocument.createElement("span")
  modelStats.className = "scoreboar-feed-badge__details-chips"
  for (const stat of reliabilityChips(summary)) {
      const chip = badge.ownerDocument.createElement("span")
      chip.className = "scoreboar-feed-badge__details-chip"
      chip.textContent = stat
      modelStats.append(chip)
  }

  appendRow("Reliability", modelStats)
  if (summary.status === "scored") {
    appendRow("Style", summary.stability.tier === "uncertain" ? "rough read" : summary.insight ? formatCompactScoreInsight(summary.insight) : "balanced")
  }
  appendRow("Likely range", winningClassText(classOdds))
  appendRow("Red flags", warningChips)
  appendRow("Signals", signalChips)
  details.append(title, kicker, list)
}

const scoredBadgeText = (summary: ScoreLabelSummary): string => {
  if (summary.status === "unavailable") {
    return "—"
  }

  const scoreText = `${String(summary.interestingScore).padStart(3, " ")}%`
  return `${emojiForScoreLabelSummary(summary)} ${scoreText}`
}

export const createFeedBadgeController = (options: FeedBadgeControllerOptions) => {
  const { document, scorer } = options
  const latestTweetKeys = new WeakMap<Element, string>()
  const scoringGuardrails = createScoringGuardrails<FeedBadgeScoreRequest, ScoreTextResult | null | undefined>({
    concurrency: options.scoringConcurrency,
    cacheSize: options.scoringCacheSize,
    keyFor: (request) => createTextScoringCacheKey(request.text, request.metadata),
  })

  const renderTweetBadge = async (event: TweetFoundEvent): Promise<void> => {
    ensureBadgeStyles(document)
    latestTweetKeys.set(event.root, event.key)

    const badge = findOrCreateBadge(event.root, document)
    setBadge(badge, "pending", BADGE_TEXT_BY_STATE.pending)

    const scoreRequest = {
      text: event.text,
      metadata: {
        cacheKey: event.key,
        hasMedia: event.hasMedia,
        createdAtHour: event.createdAtMetadata?.createdAtHour ?? null,
        createdAtDay: event.createdAtMetadata?.createdAtDay ?? null,
        createdAtSource: event.createdAtMetadata?.createdAtSource ?? "defaulted",
        authorHandle: event.authorMetadata.authorHandle,
        authorFollowers: event.authorMetadata.authorFollowers,
        authorFollowing: event.authorMetadata.authorFollowing,
        authorTweets: event.authorMetadata.authorTweets,
        authorVerified: event.authorMetadata.authorVerified,
        authorMetadataSource: event.authorMetadata.authorMetadataSource,
        source: "tweet",
      },
    }
    const result = await (scorer
      ? scoringGuardrails.score(scoreRequest, (request) => scorer.scoreTweet(request.text, request.metadata))
      : Promise.resolve(null)) ?? fallbackResult(event.text)
    if (latestTweetKeys.get(event.root) !== event.key) {
      return
    }

    const summary = mapScoreTextResultToLabel(result)
    const state: FeedBadgeState = summary.status === "scored" ? "scored" : "unavailable"
    setBadge(badge, state, scoredBadgeText(summary))
    setBadgeDetails(badge, summary, result)
  }

  return { renderTweetBadge }
}
