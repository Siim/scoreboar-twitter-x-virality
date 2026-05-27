import type { ComposerFoundEvent, ScheduledTaskCancel, ScanScheduler } from "./dom-detection.js"
import { createUnavailableScoreTextResult, type ScoreTextResult } from "./inference-runtime.js"
import { analyzeComposerHints, formatScoreLabelSummary, mapScoreTextResultToLabel, type ComposerHint } from "./score-mapping.js"
import { createScoringGuardrails, createTextScoringCacheKey } from "./scoring-guardrails.js"

export const SCOREBOAR_COMPOSER_PANEL_ATTRIBUTE = "data-scoreboar-composer-panel" as const
export const SCOREBOAR_COMPOSER_PANEL_STATE_ATTRIBUTE = "data-scoreboar-composer-panel-state" as const
export const SCOREBOAR_COMPOSER_STYLE_ATTRIBUTE = "data-scoreboar-composer-style" as const
const SCOREBOAR_COMPOSER_CONTROLS_BOUND_ATTRIBUTE = "data-scoreboar-composer-controls-bound" as const
const SCOREBOAR_COMPOSER_DRAGGED_ATTRIBUTE = "data-scoreboar-composer-dragged" as const

export type ComposerPanelState = "empty" | "pending" | "ready" | "unavailable"

export interface ComposerScorer {
  readonly scoreComposer: (text: string, metadata: Record<string, unknown>) => Promise<ScoreTextResult | null | undefined>
}

export interface ComposerHintControllerOptions {
  readonly document: Document
  readonly scorer?: ComposerScorer
  readonly debounceMs?: number
  readonly scheduler?: ScanScheduler
  readonly scoringConcurrency?: number
  readonly scoringCacheSize?: number
}

interface ComposerScoreRequest {
  readonly text: string
  readonly metadata: Record<string, unknown>
}

const DEFAULT_COMPOSER_DEBOUNCE_MS = 450

const COMPOSER_PANEL_CSS = `
.scoreboar-composer-panel {
  --scoreboar-composer-ink: rgb(83 100 113);
  --scoreboar-composer-ink-strong: rgb(15 20 25);
  --scoreboar-composer-accent: rgb(29 155 240);
  align-items: center;
  background: rgb(255 255 255 / 0.94) !important;
  border: 1px solid rgb(207 217 222 / 0.72) !important;
  border-radius: 999rem;
  box-shadow: 0 0.375rem 1.25rem rgb(15 20 25 / 0.16) !important;
  color: var(--scoreboar-composer-ink);
  display: flex;
  flex-wrap: nowrap;
  font: 500 0.8125rem/1.25 TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  gap: 0.35rem;
  margin: 0 !important;
  max-inline-size: min(100%, 30rem);
  min-inline-size: 0;
  overflow: hidden;
  padding: 0.25rem 0.35rem 0.25rem 0.45rem !important;
  position: absolute;
  z-index: 2147483647;
}
.scoreboar-composer-panel[data-scoreboar-composer-placement="dialog"] {
  left: var(--scoreboar-composer-left, 5.5rem);
  max-inline-size: min(calc(100vw - 7rem), 34rem);
  position: fixed;
  top: var(--scoreboar-composer-top, 2.75rem);
}
.scoreboar-composer-panel[data-scoreboar-composer-placement="inline"] {
  inset-block-start: -2rem;
  inset-inline-start: 0;
}
.scoreboar-composer-panel[data-scoreboar-composer-placement="dialog"][data-scoreboar-composer-panel-collapsed="true"] .scoreboar-composer-panel__hints {
  display: none;
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
  gap: 0.3rem;
  min-block-size: 2rem;
}
.scoreboar-composer-panel__prefix {
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
.scoreboar-composer-panel__hints {
  display: inline-flex;
  flex: 1 1 auto;
  gap: 0.25rem;
  list-style: none;
  margin: 0;
  min-inline-size: 0;
  overflow: hidden;
  padding: 0;
}
.scoreboar-composer-panel__value {
  font-variant-numeric: tabular-nums;
  white-space: pre;
}
.scoreboar-composer-panel__hint {
  align-items: center;
  color: var(--scoreboar-composer-ink-strong);
  display: inline-flex;
  flex: 1 1 auto;
  gap: 0.25rem;
  max-inline-size: min(26rem, 52vw);
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scoreboar-composer-panel__hint::before {
  color: var(--scoreboar-composer-accent);
  content: "💭";
  font-size: 0.75rem;
}
.scoreboar-composer-panel__actions {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  gap: 0.125rem;
}
.scoreboar-composer-panel__action {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 999rem;
  color: var(--scoreboar-composer-ink);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  block-size: 1.25rem;
  inline-size: 1.25rem;
  justify-content: center;
  padding: 0;
  pointer-events: auto;
}
.scoreboar-composer-panel__drag {
  color: var(--scoreboar-composer-ink);
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.scoreboar-composer-panel__drag:active {
  cursor: grabbing;
}
.scoreboar-composer-panel__action:hover {
  background: rgb(29 155 240 / 0.12);
  color: rgb(29 155 240);
}
.scoreboar-composer-panel[data-scoreboar-composer-panel-state="pending"] {
  --scoreboar-composer-accent: rgb(100 116 139);
}
.scoreboar-composer-panel[data-scoreboar-composer-panel-state="ready"] {
  --scoreboar-composer-accent: rgb(5 150 105);
}
.scoreboar-composer-panel[data-scoreboar-composer-panel-state="unavailable"] {
  --scoreboar-composer-accent: rgb(83 100 113);
}
@media (prefers-color-scheme: dark) {
  .scoreboar-composer-panel {
    --scoreboar-composer-ink: rgb(113 118 123);
    --scoreboar-composer-ink-strong: rgb(231 233 234);
    background: rgb(0 0 0 / 0.86) !important;
    border-color: rgb(47 51 54 / 0.9) !important;
  }
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
  panel.className = "scoreboar-composer-panel"
  panel.setAttribute(SCOREBOAR_COMPOSER_PANEL_ATTRIBUTE, "true")
  panel.setAttribute("role", "status")
  panel.setAttribute("aria-live", "polite")

  const score = document.createElement("div")
  score.className = "scoreboar-composer-panel__score"

  const prefix = document.createElement("span")
  prefix.className = "scoreboar-composer-panel__prefix"
  prefix.setAttribute("aria-hidden", "true")
  prefix.textContent = "S"

  const value = document.createElement("span")
  value.className = "scoreboar-composer-panel__value"
  score.append(prefix, value)

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

const composerPanelValueText = (panel: HTMLElement, state: ComposerPanelState, valueText: string): string => {
  if (panel.getAttribute("data-scoreboar-composer-placement") !== "dialog") {
    return valueText
  }
  if (state === "pending") return "Scoring…"
  if (state === "unavailable") return "—"
  return valueText
    .replace(/[🎯📣✨🫡🍿⚡🤯🔥🚀🙂😎🥱😨😱🥶🤔🫥]\s*/gu, "")
    .replace(/\s+·\s+rough read/iu, " · rough")
    .trim()
}

const setPanelState = (panel: HTMLElement, state: ComposerPanelState, valueText: string, hints: readonly ComposerHint[]) => {
  panel.hidden = state === "empty"
  panel.setAttribute(SCOREBOAR_COMPOSER_PANEL_STATE_ATTRIBUTE, state)
  const displayText = composerPanelValueText(panel, state, valueText)
  const visibleHintText = hints.slice(0, 1).map((hint) => hint.message).join(" ")
  panel.setAttribute("aria-label", visibleHintText ? `${displayText}. ${visibleHintText}` : displayText)

  const value = panel.querySelector<HTMLElement>(".scoreboar-composer-panel__value")
  if (value) {
    value.textContent = displayText
  }

  const hintList = panel.querySelector<HTMLElement>(".scoreboar-composer-panel__hints")
  if (hintList) {
    hintList.replaceChildren(...hints.slice(0, 1).map((hint) => {
      const item = panel.ownerDocument.createElement("li")
      item.className = "scoreboar-composer-panel__hint"
      item.textContent = hint.message
      item.title = hint.message
      item.setAttribute("aria-label", hint.message)
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
  const latestComposerKeys = new WeakMap<Element, string>()
  const pendingComposerTasks = new WeakMap<Element, ScheduledTaskCancel>()
  const dismissedComposerKeys = new WeakMap<Element, string>()
  const scoringGuardrails = createScoringGuardrails<ComposerScoreRequest, ScoreTextResult | null | undefined>({
    concurrency: options.scoringConcurrency,
    cacheSize: options.scoringCacheSize,
    keyFor: (request) => createTextScoringCacheKey(request.text, request.metadata),
  })

  const renderComposerHints = (event: ComposerFoundEvent): void => {
    ensureComposerStyles(document)
    latestComposerKeys.set(event.element, event.key)

    const panel = findOrCreatePanel(event.element, document)
    positionPanel(panel, event.element)
    bindPanelControls(panel, event.element, event.key, dismissedComposerKeys)
    const hintResult = analyzeComposerHints(event.text)
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

    setPanelState(panel, "pending", "Scoring…", hintResult.activeHints)

    const run = () => {
      pendingComposerTasks.delete(event.element)
      void (async () => {
        const scoreRequest = {
          text: event.text,
          metadata: {
            source: "composer",
            cacheKey: event.key,
            createdAtHour: event.createdAtHour,
            createdAtDay: event.createdAtDay,
          },
        }
        const result = await (scorer
          ? scoringGuardrails.score(scoreRequest, (request) => scorer.scoreComposer(request.text, request.metadata))
          : Promise.resolve(null)) ?? fallbackComposerResult(event.text)
        if (latestComposerKeys.get(event.element) !== event.key) {
          return
        }

        const summary = mapScoreTextResultToLabel(result)
        setPanelState(panel, summary.status === "scored" ? "ready" : "unavailable", formatScoreLabelSummary(summary), hintResult.activeHints)
      })().catch(() => {
        if (latestComposerKeys.get(event.element) !== event.key) {
          return
        }
        const result = fallbackComposerResult(event.text)
        const summary = mapScoreTextResultToLabel(result)
        setPanelState(panel, "unavailable", formatScoreLabelSummary(summary), hintResult.activeHints)
      })
    }

    const cancel = scheduler(run, debounceMs)
    if (cancel) {
      pendingComposerTasks.set(event.element, cancel)
    } else {
      run()
    }
  }

  return { renderComposerHints }
}
