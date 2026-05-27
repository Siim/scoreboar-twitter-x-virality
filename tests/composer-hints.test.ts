import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import {
  SCOREBOAR_COMPOSER_PANEL_ATTRIBUTE,
  SCOREBOAR_COMPOSER_PANEL_STATE_ATTRIBUTE,
  X_SELECTORS,
  createComposerHintController,
  createScoreboarDomDetector,
  type ScoreTextResult,
} from "../src/index"

const fixture = (name: string) => readFileSync(resolve("fixtures", name), "utf8")

const panelSelector = `[${SCOREBOAR_COMPOSER_PANEL_ATTRIBUTE}="true"]`

const flushPromises = () => new Promise<void>((resolveFlush) => queueMicrotask(resolveFlush))

const scoredResult = (text: string, highProbability: number): ScoreTextResult => ({
  status: "scored",
  label: "scored",
  confidence: highProbability,
  probabilities: { high: highProbability, medium: 1 - highProbability },
  numericScores: { hook_quality: 0.91 },
  booleanScores: {},
  message: "deterministic composer fixture score",
  model: {
    provider: "local-onnx",
    path: "extension/assets/model/v5-full.onnx",
    available: true,
  },
  metadataVector: [text.length],
})

describe("composer hint UI", () => {
  it("hides composer hints deterministically for an empty fixture composer", () => {
    const dom = new JSDOM(fixture("composer.html"))
    const controller = createComposerHintController({ document: dom.window.document })
    const detector = createScoreboarDomDetector({
      root: dom.window.document,
      onComposerFound: (event) => controller.renderComposerHints(event),
    })

    detector.scan()

    const composer = dom.window.document.querySelector<HTMLElement>(X_SELECTORS.composerPrimary)
    const panel = dom.window.document.querySelector<HTMLElement>(panelSelector)
    expect(composer?.textContent).toBe("")
    expect(panel).not.toBeNull()
    expect(panel?.hidden).toBe(true)
    expect(panel?.getAttribute(SCOREBOAR_COMPOSER_PANEL_STATE_ATTRIBUTE)).toBe("empty")
    expect(panel?.querySelectorAll("[data-scoreboar-composer-hint-id]")).toHaveLength(0)
  })

  it("renders unavailable score and deterministic hints after debounced local composer typing", async () => {
    const dom = new JSDOM(fixture("composer.html"))
    const queuedTasks: Array<() => void> = []
    const controller = createComposerHintController({
      document: dom.window.document,
      debounceMs: 25,
      scheduler: (callback) => {
        queuedTasks.push(callback)
        return () => undefined
      },
    })
    const detector = createScoreboarDomDetector({
      root: dom.window.document,
      onComposerFound: (event) => controller.renderComposerHints(event),
    })
    const composer = dom.window.document.querySelector<HTMLElement>(X_SELECTORS.composerPrimary)
    const originalText = "nice update"

    expect(composer).not.toBeNull()
    composer!.textContent = originalText
    detector.scan()

    const pendingPanel = dom.window.document.querySelector<HTMLElement>(panelSelector)
    expect(pendingPanel?.hidden).toBe(false)
    expect(pendingPanel?.getAttribute(SCOREBOAR_COMPOSER_PANEL_STATE_ATTRIBUTE)).toBe("pending")
    expect(queuedTasks).toHaveLength(1)

    queuedTasks.shift()?.()
    await flushPromises()

    const panel = dom.window.document.querySelector<HTMLElement>(panelSelector)
    const hintIds = [...dom.window.document.querySelectorAll<HTMLElement>("[data-scoreboar-composer-hint-id]")].map((hint) => {
      return hint.getAttribute("data-scoreboar-composer-hint-id")
    })
    expect(panel?.getAttribute(SCOREBOAR_COMPOSER_PANEL_STATE_ATTRIBUTE)).toBe("unavailable")
    expect(panel?.textContent).toContain("S—")
    expect(panel?.textContent).toContain("Open with a clear question, claim, or tension.")
    expect(hintIds.length).toBeGreaterThanOrEqual(1)
    expect(hintIds).toContain("hook_clarity")
    expect(composer?.textContent).toBe(originalText)
  })

  it("renders composer score in the same percent insight format as feed badges", async () => {
    const dom = new JSDOM(fixture("composer.html"))
    const seenMetadata: Record<string, unknown>[] = []
    const controller = createComposerHintController({
      document: dom.window.document,
      debounceMs: 0,
      scheduler: (callback) => {
        callback()
        return undefined
      },
      scorer: {
        scoreComposer: async (text, metadata) => {
          seenMetadata.push(metadata)
          return scoredResult(text, 1)
        },
      },
    })
    const detector = createScoreboarDomDetector({
      root: dom.window.document,
      onComposerFound: (event) => controller.renderComposerHints(event),
    })
    const composer = dom.window.document.querySelector<HTMLElement>(X_SELECTORS.composerPrimary)
    expect(composer).not.toBeNull()

    composer!.textContent = "This hook should score clearly"
    detector.scan()
    await flushPromises()
    await flushPromises()
    await flushPromises()

    const panel = dom.window.document.querySelector<HTMLElement>(panelSelector)
    expect(panel?.getAttribute(SCOREBOAR_COMPOSER_PANEL_STATE_ATTRIBUTE)).toBe("ready")
    expect(panel?.querySelector(".scoreboar-composer-panel__value")?.textContent).toBe("🎯  75% · hook")
    expect(typeof seenMetadata[0]?.createdAtHour).toBe("number")
    expect(typeof seenMetadata[0]?.createdAtDay).toBe("number")
    expect(panel?.querySelector("img.scoreboar-boar")).toBeNull()
  })

  it("lets the composer chip minimize and close until the text changes", async () => {
    const dom = new JSDOM(fixture("composer.html"))
    const controller = createComposerHintController({
      document: dom.window.document,
      debounceMs: 0,
      scheduler: (callback) => {
        callback()
        return undefined
      },
    })
    const detector = createScoreboarDomDetector({
      root: dom.window.document,
      onComposerFound: (event) => controller.renderComposerHints(event),
    })
    const composer = dom.window.document.querySelector<HTMLElement>(X_SELECTORS.composerPrimary)
    expect(composer).not.toBeNull()

    composer!.textContent = "this is a test"
    detector.scan()
    await flushPromises()

    const panel = dom.window.document.querySelector<HTMLElement>(panelSelector)
    expect(panel).not.toBeNull()
    expect(panel?.hidden).toBe(false)
    expect(composer?.parentElement?.style.position).toBe("relative")

    panel?.querySelector<HTMLElement>('[data-scoreboar-composer-action="minimize"]')?.click()
    expect(panel?.getAttribute("data-scoreboar-composer-panel-collapsed")).toBe("true")

    panel?.querySelector<HTMLElement>('[data-scoreboar-composer-action="close"]')?.click()
    expect(panel?.hidden).toBe(true)

    detector.scan()
    await flushPromises()
    expect(panel?.hidden).toBe(true)

    composer!.textContent = "this is a different test"
    detector.scan()
    await flushPromises()
    expect(panel?.hidden).toBe(false)
  })

  it("places modal composer hints near the dialog chrome instead of over typed text", async () => {
    const dom = new JSDOM(`
      <div role="dialog" aria-label="Post composer">
        <button aria-label="Close">×</button>
        <div data-testid="tweetTextarea_0" role="textbox" contenteditable="true">modal text</div>
      </div>
    `, { pretendToBeVisual: true })
    const dialog = dom.window.document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    dialog!.getBoundingClientRect = () => ({
      x: 20,
      y: 12,
      left: 20,
      top: 12,
      right: 620,
      bottom: 612,
      width: 600,
      height: 600,
      toJSON: () => ({}),
    })
    const controller = createComposerHintController({
      document: dom.window.document,
      debounceMs: 0,
      scheduler: (callback) => {
        callback()
        return undefined
      },
    })
    const detector = createScoreboarDomDetector({
      root: dom.window.document,
      onComposerFound: (event) => controller.renderComposerHints(event),
    })

    detector.scan()
    await flushPromises()

    const panel = dom.window.document.querySelector<HTMLElement>(panelSelector)
    expect(panel?.parentElement).toBe(dialog)
    expect(panel?.getAttribute("data-scoreboar-composer-placement")).toBe("dialog")
    expect(panel?.style.getPropertyValue("--scoreboar-composer-left")).toBe("108px")
    expect(panel?.style.getPropertyValue("--scoreboar-composer-top")).toBe("56px")
  })

  it("lets users drag the modal composer hint panel away from content", async () => {
    const dom = new JSDOM(`
      <div role="dialog" aria-label="Post composer">
        <button aria-label="Close">×</button>
        <div data-testid="tweetTextarea_0" role="textbox" contenteditable="true">drag me</div>
      </div>
    `, { pretendToBeVisual: true })
    const dialog = dom.window.document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    dialog!.getBoundingClientRect = () => ({
      x: 20,
      y: 12,
      left: 20,
      top: 12,
      right: 620,
      bottom: 612,
      width: 600,
      height: 600,
      toJSON: () => ({}),
    })
    const controller = createComposerHintController({
      document: dom.window.document,
      debounceMs: 0,
      scheduler: (callback) => {
        callback()
        return undefined
      },
    })
    const detector = createScoreboarDomDetector({
      root: dom.window.document,
      onComposerFound: (event) => controller.renderComposerHints(event),
    })

    detector.scan()
    await flushPromises()

    const panel = dom.window.document.querySelector<HTMLElement>(panelSelector)
    const handle = panel?.querySelector<HTMLElement>('[data-scoreboar-composer-drag-handle="true"]')
    expect(panel).not.toBeNull()
    expect(handle).not.toBeNull()
    panel!.getBoundingClientRect = () => ({
      x: 108,
      y: 56,
      left: 108,
      top: 56,
      right: 408,
      bottom: 96,
      width: 300,
      height: 40,
      toJSON: () => ({}),
    })

    handle!.dispatchEvent(new dom.window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 118, clientY: 66, pointerId: 1 }))
    dom.window.dispatchEvent(new dom.window.PointerEvent("pointermove", { bubbles: true, clientX: 260, clientY: 150, pointerId: 1 }))
    dom.window.dispatchEvent(new dom.window.PointerEvent("pointerup", { bubbles: true, pointerId: 1 }))

    expect(panel?.getAttribute("data-scoreboar-composer-dragged")).toBe("true")
    expect(panel?.style.getPropertyValue("--scoreboar-composer-left")).toBe("250px")
    expect(panel?.style.getPropertyValue("--scoreboar-composer-top")).toBe("140px")
  })
})
