import type { ComposerFoundEvent, ScheduledTaskCancel, ScanScheduler } from "./dom-detection.js"
import { createUnavailableScoreTextResult, type ScoreTextResult } from "./inference-runtime.js"
import { analyzeComposerHints, mapScoreTextResultToLabel, type ComposerHint, type ScoreLabelSummary } from "./score-mapping.js"
import { createScoringGuardrails, createTextScoringCacheKey } from "./scoring-guardrails.js"
import { applyScoreboarTheme, createMeter, meterForScore, reveal, setMeter } from "./ui-theme.js"
import { markXAutolinks } from "./x-autolink.js"

export const SCOREBOAR_COMPOSER_PANEL_ATTRIBUTE = "data-scoreboar-composer-panel" as const
export const SCOREBOAR_COMPOSER_PANEL_STATE_ATTRIBUTE = "data-scoreboar-composer-panel-state" as const
export const SCOREBOAR_COMPOSER_STYLE_ATTRIBUTE = "data-scoreboar-composer-style" as const
const SCOREBOAR_COMPOSER_CONTROLS_BOUND_ATTRIBUTE = "data-scoreboar-composer-controls-bound" as const
const SCOREBOAR_COMPOSER_DRAGGED_ATTRIBUTE = "data-scoreboar-composer-dragged" as const
const SCOREBOAR_COMPOSER_AUTHOR_UNKNOWN_ATTRIBUTE = "data-scoreboar-composer-author-unknown" as const

export type ComposerPanelState = "empty" | "pending" | "ready" | "unavailable"

export interface ComposerScorer {
  readonly scoreComposer: (text: string, metadata: Record<string, unknown>) => Promise<ScoreTextResult | null | undefined>
}

export interface ComposerHintControllerOptions {
  readonly document: Document
  readonly scorer?: ComposerScorer
  /** The signed-in author's stats when X has already loaded them, so a draft is scored for its own audience. */
  readonly viewerMetadata?: () => Record<string, unknown> | null
  /** Clock for the time a draft would go out; tests pin it. */
  readonly now?: () => Date
  readonly debounceMs?: number
  readonly scheduler?: ScanScheduler
  readonly scoringConcurrency?: number
  readonly scoringCacheSize?: number
}

export interface ComposerScoreRequest {
  readonly text: string
  readonly metadata: Record<string, unknown>
}

/**
 * What a draft is scored with: the inputs its post will have once published.
 * The text gets the https:// X's linkifier gives bare domains, and every fact
 * the page shows is sent as a known value (no attachment is "no photo, no
 * video", a plain draft is "not a quote"), just as the feed reads the post.
 * It goes out now, or at the time X shows for a scheduled draft.
 */
export const composerScoreRequest = (
  event: ComposerFoundEvent,
  viewerMetadata: Record<string, unknown> | null | undefined,
  now: Date,
): ComposerScoreRequest => ({
  text: markXAutolinks(event.text),
  metadata: {
    source: "composer",
    createdAt: event.scheduledAt ?? now.toISOString(),
    ...(event.hasMedia === undefined ? {} : { hasMedia: event.hasMedia }),
    ...(event.hasPhoto === undefined || event.hasPhoto === null ? {} : { hasPhoto: event.hasPhoto }),
    ...(event.hasVideo === undefined || event.hasVideo === null ? {} : { hasVideo: event.hasVideo }),
    ...(event.isQuote === undefined ? {} : { isQuote: event.isQuote }),
    ...(event.hasCard === undefined ? {} : { hasCard: event.hasCard }),
    ...(viewerMetadata ?? {}),
  },
})

const DEFAULT_COMPOSER_DEBOUNCE_MS = 450

const COMPOSER_PANEL_CSS = `
.scoreboar-composer-panel {
  align-items: center;
  border-radius: 999rem;
  box-sizing: border-box;
  color: var(--sb-muted);
  display: flex;
  font-size: 0.8125rem;
  line-height: 1.25;
  gap: 0.5rem;
  margin: 0 !important;
  max-inline-size: min(100%, 30rem);
  padding: 0.25rem 0.25rem 0.25rem 0.75rem !important;
  position: absolute;
  z-index: 2147483647;
}
@media (prefers-reduced-motion: no-preference) {
  .scoreboar-composer-panel {
    transition: box-shadow 150ms ease;
  }
}
.scoreboar-composer-panel[data-scoreboar-composer-placement="dialog"] {
  left: var(--scoreboar-composer-left, 5.5rem);
  max-inline-size: min(calc(100vw - 7rem), 34rem);
  position: fixed;
  top: var(--scoreboar-composer-top, 2.75rem);
}
.scoreboar-composer-panel[data-scoreboar-composer-placement="inline"] {
  inset-block-start: -2.25rem;
  inset-inline-start: 0;
}
.scoreboar-composer-panel[hidden] {
  display: none;
}
.scoreboar-composer-panel[data-scoreboar-composer-panel-collapsed="true"] .scoreboar-composer-panel__hints {
  display: none;
}
.scoreboar-composer-panel__score {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  gap: 0.5rem;
  min-block-size: 1.75rem;
}
.scoreboar-composer-panel__score .scoreboar-meter {
  color: var(--sb-text);
}
.scoreboar-composer-panel__value {
  color: var(--sb-text);
  font-family: var(--sb-caps);
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}
.scoreboar-composer-panel[data-scoreboar-composer-panel-state="unavailable"] .scoreboar-composer-panel__value {
  color: var(--sb-muted);
}
.scoreboar-composer-panel__flag {
  color: var(--sb-danger);
  font: 500 0.75rem/1 var(--sb-caps);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.scoreboar-composer-panel__flag:empty {
  display: none;
}
.scoreboar-composer-panel__hints {
  border-inline-start: 1px solid var(--sb-line);
  display: inline-flex;
  list-style: none;
  margin: 0;
  min-width: 0;
  padding: 0 0 0 0.5rem;
}
.scoreboar-composer-panel__hint {
  color: var(--sb-text);
  max-inline-size: min(22rem, 48vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scoreboar-composer-panel__actions {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
}
.scoreboar-composer-panel__action {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 999rem;
  color: var(--sb-muted);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 0.9375rem;
  block-size: 1.75rem;
  inline-size: 1.75rem;
  justify-content: center;
  padding: 0;
  pointer-events: auto;
  transition: background-color 150ms ease, color 150ms ease;
}
.scoreboar-composer-panel__action:hover {
  background: var(--sb-pill-off);
  color: var(--sb-text);
}
.scoreboar-composer-panel__action:focus-visible {
  outline: 2px solid var(--sb-focus);
  outline-offset: 1px;
}
.scoreboar-composer-panel__drag {
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.scoreboar-composer-panel__drag:active {
  cursor: grabbing;
}
@media (max-width: 560px) {
  .scoreboar-composer-panel[data-scoreboar-composer-placement="dialog"] {
    left: 0.75rem;
    max-inline-size: calc(100vw - 1.5rem);
    top: 4.5rem;
  }
  .scoreboar-composer-panel__hint {
    max-inline-size: 12rem;
  }
}
`.trim()

const defaultComposerScheduler: ScanScheduler = (callback, delayMs) => {
  const timeoutId = globalThis.setTimeout(callback, delayMs)
  return () => globalThis.clearTimeout(timeoutId)
}

const ensureComposerStyles = (document: Document) => {
  applyScoreboarTheme(document)
  if (document.querySelector(`style[${SCOREBOAR_COMPOSER_STYLE_ATTRIBUTE}="true"]`)) {
    return
  }

  const style = document.createElement("style")
  style.setAttribute(SCOREBOAR_COMPOSER_STYLE_ATTRIBUTE, "true")
  style.textContent = COMPOSER_PANEL_CSS
  document.head?.append(style)
}

const fallbackComposerResult = (text: string): ScoreTextResult => createUnavailableScoreTextResult(
  { text, metadata: { source: "composer" } },
  "missing_local_onnx_artifact",
  "Local Scoreboar ONNX artifact is not packaged yet; composer text stays on-device.",
)

const createPanelElement = (document: Document): HTMLElement => {
  const panel = document.createElement("aside")
  panel.className = "scoreboar-composer-panel sb-slab"
  panel.setAttribute(SCOREBOAR_COMPOSER_PANEL_ATTRIBUTE, "true")
  panel.setAttribute("role", "status")
  panel.setAttribute("aria-live", "polite")

  const score = document.createElement("div")
  score.className = "scoreboar-composer-panel__score"

  const value = document.createElement("span")
  value.className = "scoreboar-composer-panel__value"
  const flag = document.createElement("span")
  flag.className = "scoreboar-composer-panel__flag"
  score.append(createMeter(document), value, flag)

  const hints = document.createElement("ul")
  hints.className = "scoreboar-composer-panel__hints"

  const actions = document.createElement("div")
  actions.className = "scoreboar-composer-panel__actions"

  const drag = document.createElement("button")
  drag.type = "button"
  drag.className = "scoreboar-composer-panel__action scoreboar-composer-panel__drag"
  drag.setAttribute("data-scoreboar-composer-drag-handle", "true")
  drag.setAttribute("aria-label", "Move Scoreboar composer hints")
  drag.setAttribute("title", "Drag Scoreboar composer hints")
  drag.textContent = "⋮⋮"

  const minimize = document.createElement("button")
  minimize.type = "button"
  minimize.className = "scoreboar-composer-panel__action"
  minimize.setAttribute("data-scoreboar-composer-action", "minimize")
  minimize.setAttribute("aria-label", "Minimize Scoreboar composer hints")
  minimize.setAttribute("aria-expanded", "false")
  minimize.textContent = "–"

  const close = document.createElement("button")
  close.type = "button"
  close.className = "scoreboar-composer-panel__action"
  close.setAttribute("data-scoreboar-composer-action", "close")
  close.setAttribute("aria-label", "Close Scoreboar composer hints")
  close.textContent = "×"

  actions.append(drag, minimize, close)

  panel.append(score, hints, actions)
  return panel
}

const findOrCreatePanel = (composerElement: Element, document: Document): HTMLElement => {
  const host = composerElement.closest<HTMLElement>('[role="dialog"]') ?? composerElement.parentElement
  const existing = host?.querySelector<HTMLElement>(`[${SCOREBOAR_COMPOSER_PANEL_ATTRIBUTE}="true"]`)
  if (existing) {
    return existing
  }

  const panel = createPanelElement(document)
  if (composerElement.parentElement && "style" in composerElement.parentElement) {
    const currentPosition = composerElement.parentElement.style.position
    if (!currentPosition) {
      composerElement.parentElement.style.position = "relative"
    }
  }
  if (host && "style" in host) {
    const currentPosition = host.style.position
    if (!currentPosition) {
      host.style.position = "relative"
    }
  }
  ;(host ?? composerElement.parentElement ?? document.body)?.append(panel)
  return panel
}

const positionPanel = (panel: HTMLElement, composerElement: Element) => {
  if (panel.getAttribute(SCOREBOAR_COMPOSER_DRAGGED_ATTRIBUTE) === "true") return
  const view = panel.ownerDocument.defaultView
  const dialog = composerElement.closest<HTMLElement>('[role="dialog"]')
  if (!view || !dialog) {
    panel.setAttribute("data-scoreboar-composer-placement", "inline")
    panel.style.removeProperty("--scoreboar-composer-left")
    panel.style.removeProperty("--scoreboar-composer-top")
    return
  }

  const rect = dialog.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    panel.setAttribute("data-scoreboar-composer-placement", "inline")
    return
  }
  panel.setAttribute("data-scoreboar-composer-placement", "dialog")
  if (!panel.hasAttribute("data-scoreboar-composer-panel-collapsed")) {
    panel.setAttribute("data-scoreboar-composer-panel-collapsed", "true")
  }
  const panelWidth = Math.min(544, Math.max(260, rect.width - 112))
  const left = Math.max(8, Math.min(rect.left + 88, view.innerWidth - panelWidth - 8))
  const top = Math.max(8, Math.min(rect.top + 44, view.innerHeight - 48))
  panel.style.setProperty("--scoreboar-composer-left", `${Math.round(left)}px`)
  panel.style.setProperty("--scoreboar-composer-top", `${Math.round(top)}px`)
}

/** What the pill says: a calibrated percentile from v8, a bare score from older models. */
const composerScoreText = (summary: ScoreLabelSummary): string => {
  if (summary.status !== "scored") return "No score"
  return summary.odds ? `Beats ${summary.interestingScore}%` : `${summary.interestingScore}%`
}

const composerFlag = (summary: ScoreLabelSummary): string => {
  if (summary.status !== "scored") return ""
  const id = summary.insight?.id
  return id === "slop" ? "slop" : id === "clickbait" ? "bait" : id === "rage" ? "rage" : ""
}

const setPanelState = (
  panel: HTMLElement,
  state: ComposerPanelState,
  valueText: string,
  hints: readonly ComposerHint[],
  summary?: ScoreLabelSummary,
) => {
  panel.hidden = state === "empty"
  panel.setAttribute(SCOREBOAR_COMPOSER_PANEL_STATE_ATTRIBUTE, state)
  const label = state === "ready" && summary?.status === "scored" && summary.odds
    ? `Scoreboar: this draft beats ${summary.interestingScore}% of ordinary posts for an account this size`
    : `Scoreboar: ${valueText}`
  panel.setAttribute("aria-label", label)

  const value = panel.querySelector<HTMLElement>(".scoreboar-composer-panel__value")
  if (value) {
    const changed = value.textContent !== valueText
    value.textContent = valueText
    // Scoring shimmers like the x11 chat thinking; a new score lands with its reveal.
    value.classList.toggle("sb-shimmer", state === "pending")
    if (changed && state === "ready") reveal(value)
  }
  const flag = panel.querySelector<HTMLElement>(".scoreboar-composer-panel__flag")
  if (flag) flag.textContent = summary ? composerFlag(summary) : ""
  const meter = panel.querySelector(".scoreboar-meter")
  if (meter) {
    if (state === "pending") {
      setMeter(meter, 0, "pending")
    } else {
      const { level, tone } = meterForScore(summary?.status === "scored" ? summary.interestingScore : null)
      setMeter(meter, level, tone)
    }
  }

  const hintList = panel.querySelector<HTMLElement>(".scoreboar-composer-panel__hints")
  if (hintList) {
    hintList.replaceChildren(...hints.slice(0, 1).map((hint) => {
      const item = panel.ownerDocument.createElement("li")
      item.className = "scoreboar-composer-panel__hint"
      item.textContent = hint.message
      // Next to the score and controls the pill has room for only part of a hint, so hovering shows all of it.
      // Screen readers already get the whole text: the ellipsis is CSS only.
      item.title = hint.message
      item.setAttribute("data-scoreboar-composer-hint-id", hint.id)
      return item
    }))
  }
}

const bindPanelControls = (panel: HTMLElement, composerElement: Element, key: string, dismissedComposerKeys: WeakMap<Element, string>) => {
  if (panel.getAttribute(SCOREBOAR_COMPOSER_CONTROLS_BOUND_ATTRIBUTE) === "true") {
    return
  }

  panel.setAttribute(SCOREBOAR_COMPOSER_CONTROLS_BOUND_ATTRIBUTE, "true")
  panel.querySelector<HTMLElement>('[data-scoreboar-composer-drag-handle="true"]')?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    panel.setAttribute(SCOREBOAR_COMPOSER_DRAGGED_ATTRIBUTE, "true")
    panel.setPointerCapture?.(event.pointerId)
    const view = panel.ownerDocument.defaultView
    const rect = panel.getBoundingClientRect()
    const offsetX = event.clientX - rect.left
    const offsetY = event.clientY - rect.top
    const movePanel = (moveEvent: PointerEvent) => {
      const maxLeft = Math.max(8, (view?.innerWidth ?? 1024) - rect.width - 8)
      const maxTop = Math.max(8, (view?.innerHeight ?? 768) - rect.height - 8)
      const nextLeft = Math.max(8, Math.min(moveEvent.clientX - offsetX, maxLeft))
      const nextTop = Math.max(8, Math.min(moveEvent.clientY - offsetY, maxTop))
      panel.setAttribute("data-scoreboar-composer-placement", "dialog")
      panel.style.setProperty("--scoreboar-composer-left", `${Math.round(nextLeft)}px`)
      panel.style.setProperty("--scoreboar-composer-top", `${Math.round(nextTop)}px`)
    }
    const stopDrag = () => {
      view?.removeEventListener("pointermove", movePanel)
      view?.removeEventListener("pointerup", stopDrag)
      view?.removeEventListener("pointercancel", stopDrag)
    }
    view?.addEventListener("pointermove", movePanel)
    view?.addEventListener("pointerup", stopDrag)
    view?.addEventListener("pointercancel", stopDrag)
  })
  panel.querySelector<HTMLElement>('[data-scoreboar-composer-action="minimize"]')?.addEventListener("click", () => {
    const nextCollapsed = panel.getAttribute("data-scoreboar-composer-panel-collapsed") === "true" ? "false" : "true"
    panel.setAttribute("data-scoreboar-composer-panel-collapsed", nextCollapsed)
    panel.querySelector<HTMLElement>('[data-scoreboar-composer-action="minimize"]')?.setAttribute("aria-expanded", String(nextCollapsed !== "true"))
  })
  panel.querySelector<HTMLElement>('[data-scoreboar-composer-action="close"]')?.addEventListener("click", () => {
    dismissedComposerKeys.set(composerElement, key)
    panel.hidden = true
  })
}

export const createComposerHintController = (options: ComposerHintControllerOptions) => {
  const { document, scorer } = options
  const debounceMs = options.debounceMs ?? DEFAULT_COMPOSER_DEBOUNCE_MS
  const scheduler = options.scheduler ?? defaultComposerScheduler
  const now = options.now ?? (() => new Date())
  // One token per scoring run: a slower run for an earlier draft, attachment or author never overwrites a newer one.
  const latestComposerRuns = new WeakMap<Element, object>()
  const pendingComposerTasks = new Map<Element, ScheduledTaskCancel>()
  // A stopped controller never touches the page again, even for a run already in flight.
  let disposed = false
  const dismissedComposerKeys = new WeakMap<Element, string>()
  // The last draft seen in each open composer, so it can be rescored when the author's stats arrive.
  const lastComposerEvents = new Map<Element, ComposerFoundEvent>()
  const scoringGuardrails = createScoringGuardrails<ComposerScoreRequest, ScoreTextResult | null | undefined>({
    concurrency: options.scoringConcurrency,
    cacheSize: options.scoringCacheSize,
    keyFor: (request) => createTextScoringCacheKey(request.text, request.metadata),
  })

  const hintsFor = (event: ComposerFoundEvent) => analyzeComposerHints(event.text, { hasMedia: event.hasMedia === true })

  /** Scores the draft as it stands now: viewer stats and the clock are read when the run starts, not when the text last changed. */
  const scoreDraft = (event: ComposerFoundEvent, panel: HTMLElement, activeHints: readonly ComposerHint[]) => {
    const run = {}
    latestComposerRuns.set(event.element, run)
    void (async () => {
      const viewer = options.viewerMetadata?.()
      const scoreRequest = composerScoreRequest(event, viewer, now())
      const result = await (scorer
        ? scoringGuardrails.score(scoreRequest, (request) => scorer.scoreComposer(request.text, request.metadata))
        : Promise.resolve(null)) ?? fallbackComposerResult(event.text)
      if (disposed || latestComposerRuns.get(event.element) !== run) {
        return
      }

      const summary = mapScoreTextResultToLabel(result)
      setPanelState(panel, summary.status === "scored" ? "ready" : "unavailable", composerScoreText(summary), activeHints, summary)
      // The published post is scored with its author's stats; say so when this draft could not be.
      const authorUnknown = options.viewerMetadata !== undefined && !viewer
      panel.toggleAttribute(SCOREBOAR_COMPOSER_AUTHOR_UNKNOWN_ATTRIBUTE, authorUnknown)
      if (authorUnknown) {
        panel.setAttribute("title", "Scored without your account's stats, which X has not loaded yet. The score may change once you post.")
      } else {
        panel.removeAttribute("title")
      }
    })().catch(() => {
      if (disposed || latestComposerRuns.get(event.element) !== run) {
        return
      }
      const result = fallbackComposerResult(event.text)
      const summary = mapScoreTextResultToLabel(result)
      setPanelState(panel, "unavailable", composerScoreText(summary), activeHints, summary)
    })
  }

  const renderComposerHints = (event: ComposerFoundEvent): void => {
    if (disposed) return
    ensureComposerStyles(document)
    for (const element of lastComposerEvents.keys()) {
      if (!element.isConnected) lastComposerEvents.delete(element)
    }
    for (const [element, cancel] of pendingComposerTasks) {
      if (element.isConnected) continue
      cancel()
      pendingComposerTasks.delete(element)
    }
    lastComposerEvents.set(event.element, event)
    // Anything still in flight is for an older state of this draft.
    latestComposerRuns.set(event.element, {})

    const panel = findOrCreatePanel(event.element, document)
    positionPanel(panel, event.element)
    bindPanelControls(panel, event.element, event.key, dismissedComposerKeys)
    const hintResult = hintsFor(event)
    pendingComposerTasks.get(event.element)?.()
    pendingComposerTasks.delete(event.element)

    if (hintResult.status === "empty") {
      setPanelState(panel, "empty", "Scoreboar composer hints hidden", [])
      return
    }

    if (dismissedComposerKeys.get(event.element) === event.key) {
      panel.hidden = true
      return
    }

    setPanelState(panel, "pending", "Scoring", hintResult.activeHints)

    const run = () => {
      pendingComposerTasks.delete(event.element)
      scoreDraft(event, panel, hintResult.activeHints)
    }

    const cancel = scheduler(run, debounceMs)
    if (cancel) {
      pendingComposerTasks.set(event.element, cancel)
    } else {
      run()
    }
  }

  /**
   * Rescore every open draft with what is known now, such as the signed-in
   * author's stats arriving after the last keystroke. The current number stays
   * on screen until the new one lands; an unchanged input is a cache hit.
   */
  const refresh = (): void => {
    if (disposed) return
    for (const [element, event] of lastComposerEvents) {
      if (!element.isConnected) {
        lastComposerEvents.delete(element)
        continue
      }
      // A debounced run is about to read the fresh state anyway.
      if (pendingComposerTasks.has(element)) continue
      if (dismissedComposerKeys.get(element) === event.key) continue
      const hintResult = hintsFor(event)
      if (hintResult.status === "empty") continue
      scoreDraft(event, findOrCreatePanel(element, document), hintResult.activeHints)
    }
  }

  /** Stop for good: forget every draft, cancel waiting runs, and drop results still in flight. */
  const dispose = (): void => {
    disposed = true
    for (const cancel of pendingComposerTasks.values()) cancel()
    pendingComposerTasks.clear()
    lastComposerEvents.clear()
  }

  return { renderComposerHints, refresh, dispose }
}
