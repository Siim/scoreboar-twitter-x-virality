import type { ScanScheduler, TweetFoundEvent } from "./dom-detection.js"
import { type ScoreTextResult, createUnavailableScoreTextResult } from "./inference-runtime.js"
import { type ScoreLabelSummary, mapScoreTextResultToLabel } from "./score-mapping.js"
import { createScoringGuardrails, createTextScoringCacheKey } from "./scoring-guardrails.js"
import { applyScoreboarTheme, createMeter, meterForScore, reveal, setMeter } from "./ui-theme.js"

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
  /** Timer for giving up on a cut-short post whose full text never arrives; tests pin it. */
  readonly scheduler?: ScanScheduler
}

export interface FeedBadgeScoreRequest {
  readonly text: string
  readonly metadata: Record<string, unknown>
}

// Long enough for X's own response about the post to arrive after it renders.
const TRUNCATED_TEXT_WAIT_MS = 3_000

/** What a post is scored with: everything the page and X's responses say about it. */
export const tweetScoreRequest = (event: TweetFoundEvent): FeedBadgeScoreRequest => ({
  text: event.text,
  metadata: {
    tweetId: event.tweetId ?? null,
    hasMedia: event.hasMedia,
    hasPhoto: event.mediaFacts?.hasPhoto ?? null,
    hasVideo: event.mediaFacts?.hasVideo ?? null,
    hasCard: event.mediaFacts?.hasCard ?? null,
    isQuote: event.isQuote ?? null,
    createdAt: event.createdAtMetadata?.createdAt ?? null,
    createdAtSource: event.createdAtMetadata?.createdAtSource ?? "defaulted",
    authorHandle: event.authorMetadata.authorHandle,
    authorFollowers: event.authorMetadata.authorFollowers,
    authorFollowing: event.authorMetadata.authorFollowing,
    authorTweets: event.authorMetadata.authorTweets,
    authorVerified: event.authorMetadata.authorVerified,
    authorVerifiedType: event.authorMetadata.authorVerifiedType ?? null,
    authorCreatedAt: event.authorMetadata.authorCreatedAt ?? null,
    authorFavourites: event.authorMetadata.authorFavourites ?? null,
    authorMetadataSource: event.authorMetadata.authorMetadataSource,
    source: "tweet",
  },
})

// The meter carries the pending and unavailable states; only a score is text.
const BADGE_TEXT_BY_STATE: Readonly<Record<FeedBadgeState, string>> = {
  pending: "",
  scored: "Score ready",
  unavailable: "",
}

const BADGE_CSS = `
.scoreboar-feed-badge {
  align-items: center;
  border-radius: 0.5rem !important;
  box-sizing: border-box;
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 auto !important;
  font: 600 0.75rem/1 var(--sb-mono);
  gap: 0.375rem;
  height: 1.5rem !important;
  margin: 0.25rem 0 !important;
  max-inline-size: 8rem;
  min-block-size: 0 !important;
  min-inline-size: 0 !important;
  padding: 0 0.5rem !important;
  pointer-events: auto;
  position: relative;
  vertical-align: middle;
  white-space: nowrap;
  width: auto !important;
}
.scoreboar-feed-badge[data-scoreboar-feed-badge-placement="top-tools"] {
  margin-inline-end: 0.375rem !important;
}
.scoreboar-feed-badge[data-scoreboar-feed-badge-placement="fallback"] {
  margin: 0.375rem 0 0 auto !important;
}
.scoreboar-feed-badge__value {
  font-variant-numeric: tabular-nums;
}
.scoreboar-feed-badge__value:empty {
  display: none;
}
.scoreboar-feed-badge__flag {
  color: var(--sb-danger);
  font: 500 0.6875rem/1 var(--sb-caps);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.scoreboar-feed-badge[data-sb-ink="true"] .scoreboar-feed-badge__flag {
  color: inherit;
}
.scoreboar-feed-badge__flag:empty {
  display: none;
}
.scoreboar-feed-badge[data-scoreboar-feed-badge-state="unavailable"] {
  opacity: 0.45;
}
.scoreboar-feed-badge__details {
  border-radius: 1rem;
  box-sizing: border-box;
  display: none;
  font-size: 0.8125rem;
  inline-size: 18.75rem;
  left: var(--scoreboar-popover-left, 0px);
  line-height: 1.4;
  padding: 1.125rem;
  position: fixed;
  top: var(--scoreboar-popover-top, 0px);
  user-select: text;
  white-space: normal;
  z-index: 2147483647;
}
.scoreboar-feed-badge__details[data-scoreboar-feed-details-open="true"] {
  display: grid;
  gap: 0.75rem;
}
@media (prefers-reduced-motion: no-preference) {
  .scoreboar-feed-badge__details[data-scoreboar-feed-details-open="true"] {
    animation: sb-popover-rise 200ms var(--sb-ease);
  }
}
@keyframes sb-popover-rise {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
.scoreboar-feed-badge__eyebrow {
  color: var(--sb-muted);
  font-size: 0.75rem;
}
.scoreboar-feed-badge__headline {
  font-size: 1.625rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.1;
  margin-top: -0.375rem;
}
.scoreboar-feed-badge__headline span {
  color: var(--sb-muted);
  font-size: 1rem;
  font-weight: 400;
  letter-spacing: 0;
}
.scoreboar-feed-badge__scale {
  display: grid;
  gap: 0.375rem;
  grid-template-columns: repeat(5, 1fr);
}
.scoreboar-feed-badge__scale-step {
  background: var(--sb-pill-off);
  block-size: 0.625rem;
  border-radius: 999px;
}
.scoreboar-feed-badge__scale-step[data-on="true"] {
  background: var(--sb-text);
}
@media (prefers-reduced-motion: no-preference) {
  .scoreboar-feed-badge__details[data-scoreboar-feed-details-open="true"] .scoreboar-feed-badge__scale-step[data-on="true"] {
    animation: sb-step-fill 320ms var(--sb-ease) both;
    animation-delay: calc(var(--sb-index, 0) * 60ms);
  }
}
@keyframes sb-step-fill {
  from { background: var(--sb-pill-off); }
  to { background: var(--sb-text); }
}
.scoreboar-feed-badge__facts {
  color: var(--sb-muted);
  display: grid;
  font-size: 0.75rem;
  gap: 0.25rem;
}
.scoreboar-feed-badge__facts b {
  color: var(--sb-text);
  font-family: var(--sb-mono);
  font-weight: 600;
}
.scoreboar-feed-badge__details-list {
  border-top: 1px solid var(--sb-line);
  display: grid;
  gap: 0.625rem;
  margin: 0;
  padding-top: 0.875rem;
}
.scoreboar-feed-badge__details-row {
  align-items: baseline;
  column-gap: 0.75rem;
  display: grid;
  grid-template-columns: 4.25rem 1fr;
}
.scoreboar-feed-badge__details-label {
  color: var(--sb-muted);
  font-size: 0.75rem;
}
.scoreboar-feed-badge__details-value {
  margin: 0;
  min-width: 0;
}
.scoreboar-feed-badge__signals {
  display: grid;
  gap: 0.5rem;
}
.scoreboar-feed-badge__signal {
  align-items: baseline;
  column-gap: 0.5rem;
  display: grid;
  grid-template-columns: 1fr auto;
  row-gap: 0.25rem;
}
.scoreboar-feed-badge__signal-value {
  font-family: var(--sb-mono);
  font-size: 0.75rem;
  font-weight: 600;
}
.scoreboar-feed-badge__signal-value span {
  color: var(--sb-muted);
  font-weight: 400;
}
.scoreboar-feed-badge__signal-bar {
  background: var(--sb-text);
  block-size: 0.25rem;
  border-radius: 999px;
  grid-column: 1 / -1;
  transform-origin: left;
}
@media (prefers-reduced-motion: no-preference) {
  .scoreboar-feed-badge__details[data-scoreboar-feed-details-open="true"] .scoreboar-feed-badge__signal-bar {
    animation: sb-bar-grow 420ms var(--sb-ease) both;
    animation-delay: calc(120ms + var(--sb-index, 0) * 50ms);
  }
}
@keyframes sb-bar-grow {
  from { transform: scaleX(0); }
  to { transform: none; }
}
.scoreboar-feed-badge__details-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}
.scoreboar-feed-badge__details-chip {
  border-radius: 0.375rem;
  font: 500 0.6875rem/1.5rem var(--sb-caps);
  letter-spacing: 0.05em;
  padding: 0 0.5rem;
  text-transform: uppercase;
  white-space: nowrap;
}
.scoreboar-feed-badge__details-chip[data-scoreboar-chip-tone="danger"] {
  color: var(--sb-danger);
}
.scoreboar-feed-badge__details-footer {
  color: var(--sb-muted);
  font-size: 0.6875rem;
}
`.trim()

const ensureBadgeStyles = (document: Document) => {
  applyScoreboarTheme(document)
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
  badge.className = "scoreboar-feed-badge sb-key"
  badge.setAttribute(SCOREBOAR_BADGE_ATTRIBUTE, "true")
  badge.setAttribute("aria-live", "polite")
  badge.setAttribute("aria-label", BADGE_TEXT_BY_STATE.pending)
  badge.setAttribute("role", "button")
  badge.setAttribute("tabindex", "0")
  badge.setAttribute("aria-expanded", "false")

  const meter = createMeter(document)
  meter.classList.add("scoreboar-feed-badge__meter")

  const value = document.createElement("span")
  value.className = "scoreboar-feed-badge__value"

  const flag = document.createElement("span")
  flag.className = "scoreboar-feed-badge__flag"

  const details = document.createElement("div")
  details.className = "scoreboar-feed-badge__details sb-slab"
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
    const popoverWidth = 300
    const viewportWidth = document.defaultView?.innerWidth ?? 1024
    const viewportHeight = document.defaultView?.innerHeight ?? 768
    const triggerCenter = rect.left + rect.width / 2
    const left = Math.max(8, Math.min(triggerCenter - 28, viewportWidth - popoverWidth - 8))
    // Below the badge when it fits, otherwise above it (measured once open).
    const height = details.offsetHeight || 380
    const below = rect.bottom + 8
    const top = below + height <= viewportHeight - 8 || rect.top - 8 - height < 8
      ? Math.max(8, Math.min(below, viewportHeight - height - 8))
      : rect.top - 8 - height
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

  badge.append(meter, value, flag)
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

const setBadge = (badge: HTMLElement, state: FeedBadgeState, label: string, unavailableReason?: string) => {
  badge.setAttribute(SCOREBOAR_BADGE_STATE_ATTRIBUTE, state)
  const accessibleLabel = state === "unavailable"
    ? unavailableReason ?? "Scoreboar score unavailable: the on-device model is not loaded"
    : state === "pending"
      ? "Scoreboar is scoring this post"
      : `Scoreboar: beats ${label}% of ordinary posts for an account this size`
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

const formatMultiple = (value: number | undefined): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null
  return value >= 10 ? `${Math.round(value)}×` : `${value.toFixed(1)}×`
}

/** Calibrated odds, stated plainly: no merged "medium–high" ranges. */
const oddsText = (summary: ScoreLabelSummary): string | null => {
  if (summary.status !== "scored" || !summary.odds) return null
  return `top 20%: ${Math.round(summary.odds.top * 100)}% · bottom 20%: ${Math.round(summary.odds.bottom * 100)}%`
}

const expectedText = (summary: ScoreLabelSummary): string | null => {
  if (summary.status !== "scored") return null
  const engagement = formatMultiple(summary.engagementMultiple)
  const reach = formatMultiple(summary.reachMultiple)
  if (!engagement || !reach) return null
  return `${engagement} engagement · ${reach} views`
}

/** Older models without calibrated odds: the single most likely fifth, never a merged range. */
const mostLikelyText = (classOdds: readonly ProbabilityEntry[]): string => {
  const [winner] = classOdds
  return winner ? winner.label : "unavailable"
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
    ["slop", result.booleanScores?.is_ai_slop],
    ["bait", result.booleanScores?.is_clickbait],
    ["rage", result.booleanScores?.is_rage_bait],
    // Not "needs context": posts it flags do better than average (v8 test set,
    // 53rd vs 45th percentile), so it is no red flag.
  ]

  return warnings
    .map(([label, value]) => {
      const percent = scorePercent(value)
      return percent !== null && percent >= 50 ? `${label} ${percent}%` : null
    })
    .filter((entry): entry is string => entry !== null)
}

const FIFTH_NAMES = ["very_low", "low", "medium", "high", "very_high"] as const

const fifthChances = (result: ScoreTextResult): readonly number[] => {
  const raw = FIFTH_NAMES.map((name) => {
    const value = result.probabilities[name]
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0
  })
  const total = raw.reduce((sum, value) => sum + value, 0)
  return total > 0 ? raw.map((value) => value / total) : raw
}

const redFlag = (summary: ScoreLabelSummary): string => {
  if (summary.status !== "scored") return ""
  const id = summary.insight?.id
  return id === "slop" ? "slop" : id === "clickbait" ? "bait" : id === "rage" ? "rage" : ""
}

/** Teacher signals worth showing, strongest first, on the draft scorer's x/10 scale. */
const signalEntries = (result: ScoreTextResult): readonly { readonly label: string; readonly value: number }[] => {
  const signals: readonly [string, number | undefined][] = [
    ["Opening line", result.numericScores.hook_quality],
    ["Shareable", result.numericScores.shareability_score],
    ["New angle", result.numericScores.novelty_score],
    ["Draws replies", result.numericScores.conversation_potential],
    ["Sounds like a person", result.numericScores.authenticity_score],
  ]
  return signals
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0.4)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([label, value]) => ({ label, value: Math.round(Math.min(1, Math.max(0, value)) * 100) / 10 }))
}

const setBadgeDetails = (
  badge: HTMLElement,
  summary: ScoreLabelSummary,
  result: ScoreTextResult,
) => {
  const detailsId = badge.getAttribute("aria-controls")
  const details = detailsId ? badge.ownerDocument.getElementById(detailsId) : null
  if (!details) return
  const document = badge.ownerDocument
  const element = (tag: string, className = "", text?: string) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  details.replaceChildren(element("div", "scoreboar-feed-badge__eyebrow", "Scoreboar expects"))

  const headline = element("div", "scoreboar-feed-badge__headline")
  if (summary.status === "scored" && summary.odds) {
    headline.append(`Beats ${summary.interestingScore}% `, element("span", "", "of posts"))
  } else if (summary.status === "scored") {
    headline.append(`${summary.interestingScore}% `, element("span", "", "score"))
  } else {
    headline.append("No score ", element("span", "", "right now"))
  }
  details.append(headline)

  if (summary.status === "scored") {
    const level = Math.min(5, Math.floor(summary.interestingScore / 20) + 1)
    const scale = element("div", "scoreboar-feed-badge__scale")
    scale.setAttribute("role", "img")
    scale.setAttribute("aria-label", `${level} of 5`)
    for (let step = 0; step < 5; step += 1) {
      const pill = element("span", "scoreboar-feed-badge__scale-step")
      pill.setAttribute("data-on", String(step < level))
      pill.style.setProperty("--sb-index", String(step))
      scale.append(pill)
    }
    details.append(scale)

    const facts = element("div", "scoreboar-feed-badge__facts")
    if (summary.odds) {
      facts.append(element("div", "", "Against ordinary posts from accounts this size."))
      const chances = fifthChances(result)
      const odds = element("div")
      odds.append("Top fifth ", element("b", "", `${Math.round((chances[4] ?? 0) * 100)}%`), " · Bottom fifth ", element("b", "", `${Math.round((chances[0] ?? 0) * 100)}%`))
      facts.append(odds)
      const engagement = formatMultiple(summary.engagementMultiple)
      const reach = formatMultiple(summary.reachMultiple)
      if (engagement && reach) {
        const multiples = element("div")
        multiples.append("About ", element("b", "", engagement), " the usual engagement, ", element("b", "", reach), " the usual views")
        facts.append(multiples)
      }
    } else {
      facts.append(element("div", "", `Most likely ${mostLikelyText(probabilityEntries(result))}`))
    }
    details.append(facts)
  }

  const list = element("dl", "scoreboar-feed-badge__details-list")
  const appendRow = (label: string, value: string | HTMLElement) => {
    const row = element("div", "scoreboar-feed-badge__details-row")
    const description = element("dd", "scoreboar-feed-badge__details-value")
    description.append(value)
    row.append(element("dt", "scoreboar-feed-badge__details-label", label), description)
    list.append(row)
  }

  const signals = signalEntries(result)
  const signalList = element("div", "scoreboar-feed-badge__signals")
  signals.forEach(({ label, value }, index) => {
    const signal = element("div", "scoreboar-feed-badge__signal")
    const amount = element("span", "scoreboar-feed-badge__signal-value", value.toFixed(1))
    amount.append(element("span", "", "/10"))
    const bar = element("span", "scoreboar-feed-badge__signal-bar")
    bar.style.inlineSize = `${value * 10}%`
    bar.style.setProperty("--sb-index", String(index))
    signal.append(element("span", "", label), amount, bar)
    signalList.append(signal)
  })
  appendRow("Signals", signals.length > 0 ? signalList : "none stand out")

  const flags = warningEntries(result)
  const flagChips = element("span", "scoreboar-feed-badge__details-chips")
  for (const flag of flags) {
    const chip = element("span", "scoreboar-feed-badge__details-chip sb-key", flag)
    chip.setAttribute("data-scoreboar-chip-tone", "danger")
    flagChips.append(chip)
  }
  appendRow("Red flags", flags.length > 0 ? flagChips : "none")
  details.append(list)

  const footer = [result.model.version ? `Scoreboar ${result.model.version} on device` : "Scoreboar on device"]
  if (summary.status === "scored") footer.push(`${summary.stability.score}% sure within one fifth`)
  details.append(element("div", "scoreboar-feed-badge__details-footer", footer.join(" · ")))
}

const scoredBadgeText = (summary: ScoreLabelSummary): string => {
  return summary.status === "unavailable" ? "" : String(summary.interestingScore)
}

export const createFeedBadgeController = (options: FeedBadgeControllerOptions) => {
  const { document, scorer } = options
  // One token per render: a slower score for an earlier reading of the post never overwrites a newer one.
  const latestTweetRenders = new WeakMap<Element, object>()
  const scoringGuardrails = createScoringGuardrails<FeedBadgeScoreRequest, ScoreTextResult | null | undefined>({
    concurrency: options.scoringConcurrency,
    cacheSize: options.scoringCacheSize,
    keyFor: (request) => createTextScoringCacheKey(request.text, request.metadata),
  })
  const scheduleTimer: ScanScheduler = options.scheduler ?? ((callback, delayMs) => {
    const timeoutId = globalThis.setTimeout(callback, delayMs)
    return () => globalThis.clearTimeout(timeoutId)
  })

  const renderTweetBadge = async (event: TweetFoundEvent): Promise<void> => {
    ensureBadgeStyles(document)
    const render = {}
    latestTweetRenders.set(event.root, render)

    const badge = findOrCreateBadge(event.root, document)
    setBadge(badge, "pending", BADGE_TEXT_BY_STATE.pending)
    const pendingMeter = badge.querySelector(".scoreboar-meter")
    if (pendingMeter) setMeter(pendingMeter, 0, "pending")

    if (event.textTruncated === true) {
      // The timeline shows only the start of a long post. Its draft was scored whole, so a
      // score of the prefix would be a different post's; wait for X's response with the full text.
      scheduleTimer(() => {
        if (latestTweetRenders.get(event.root) !== render) return
        setBadge(badge, "unavailable", "", "Scoreboar has only the start of this long post, so it is not scored")
        const meter = badge.querySelector(".scoreboar-meter")
        const { level, tone } = meterForScore(null)
        if (meter) setMeter(meter, level, tone)
        const flag = badge.querySelector<HTMLElement>(".scoreboar-feed-badge__flag")
        if (flag) flag.textContent = ""
        badge.setAttribute("data-sb-ink", "false")
      }, TRUNCATED_TEXT_WAIT_MS)
      return
    }

    const scoreRequest = tweetScoreRequest(event)
    const result = await (scorer
      ? scoringGuardrails.score(scoreRequest, (request) => scorer.scoreTweet(request.text, request.metadata))
      : Promise.resolve(null)) ?? fallbackResult(event.text)
    if (latestTweetRenders.get(event.root) !== render) {
      return
    }

    const summary = mapScoreTextResultToLabel(result)
    const state: FeedBadgeState = summary.status === "scored" ? "scored" : "unavailable"
    ensureBadgeStyles(document)
    setBadge(badge, state, scoredBadgeText(summary))
    const { level, tone } = meterForScore(summary.status === "scored" ? summary.interestingScore : null)
    const meter = badge.querySelector(".scoreboar-meter")
    if (meter) setMeter(meter, level, tone)
    const flag = badge.querySelector<HTMLElement>(".scoreboar-feed-badge__flag")
    if (flag) flag.textContent = redFlag(summary)
    // A top-fifth post gets the ink key, like a primary action in x11.social.
    badge.setAttribute("data-sb-ink", String(level === 5))
    if (state === "scored") reveal(badge.querySelector(".scoreboar-feed-badge__value"))
    setBadgeDetails(badge, summary, result)
  }

  return { renderTweetBadge }
}
