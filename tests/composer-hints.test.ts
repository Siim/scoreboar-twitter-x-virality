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
  readViewerAuthorMetadata,
  type ScoreTextResult,
  type XAuthorStats,
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
    path: "extension/assets/model/scoreboar-v8.onnx",
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
    expect(panel?.querySelector(".scoreboar-composer-panel__value")?.textContent).toBe("No score")
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
    expect(panel?.querySelector(".scoreboar-composer-panel__value")?.textContent).toBe("75%")
    expect(panel?.querySelector(".scoreboar-meter")?.getAttribute("data-level")).toBe("4")
    expect(Number.isFinite(Date.parse(String(seenMetadata[0]?.createdAt)))).toBe(true)
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

  it("shows the whole hint on hover, since the pill cuts it short", async () => {
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
    const shownHint = () => dom.window.document.querySelector<HTMLElement>(".scoreboar-composer-panel__hint")

    composer!.textContent = "nice update"
    detector.scan()
    await flushPromises()

    // A hint that does not fit stays on its line and ends in an ellipsis.
    const css = dom.window.document.querySelector("style[data-scoreboar-composer-style='true']")?.textContent ?? ""
    expect(css).toMatch(/\.scoreboar-composer-panel__hint \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/u)
    expect(shownHint()?.textContent).toBe("Open with a clear question, claim, or tension.")
    expect(shownHint()?.title).toBe("Open with a clear question, claim, or tension.")

    // A different hint brings its own full text.
    composer!.textContent = "Why is this chart so wild?"
    detector.scan()
    await flushPromises()
    expect(shownHint()?.getAttribute("data-scoreboar-composer-hint-id")).toBe("media_cue")
    expect(shownHint()?.title).toBe("Add or reference an image/video when it clarifies the point.")
    expect(shownHint()?.textContent).toBe(shownHint()?.title)
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

describe("composer scoring inputs", () => {
  const toolbar = `<div><div data-testid="toolBar"><button>Post</button></div></div>`
  const page = (script: string, extra = "") => new JSDOM(`<!doctype html><body>
    <nav><button data-testid="SideNav_AccountSwitcher_Button"><div data-testid="UserAvatar-Container-ada"></div></button></nav>
    <main><div><div data-testid="tweetTextarea_0" role="textbox" contenteditable="true"></div>${extra}${toolbar}</div></main>
    <script>${script}</script></body>`)
  const bootstrap = (user: Record<string, unknown>) => `window.__INITIAL_STATE__=${JSON.stringify({ session: { user_id: "1" }, entities: { users: { entities: { 1: { screen_name: "ada", ...user } } } } })};`
  const immediate = (callback: () => void) => {
    callback()
    return undefined
  }

  const setup = (dom: JSDOM, statsByHandle: Map<string, XAuthorStats>, scoreComposer: (text: string, metadata: Record<string, unknown>) => Promise<ScoreTextResult>) => {
    const document = dom.window.document
    const controller = createComposerHintController({
      document,
      debounceMs: 0,
      scheduler: immediate,
      now: () => new Date("2026-09-23T12:00:00.000Z"),
      viewerMetadata: () => readViewerAuthorMetadata(document, null, statsByHandle),
      scorer: { scoreComposer },
    })
    const detector = createScoreboarDomDetector({ root: document, onComposerFound: (event) => controller.renderComposerHints(event) })
    const composer = document.querySelector<HTMLElement>(X_SELECTORS.composerPrimary)!
    return { document, controller, detector, composer }
  }

  it("scores the draft for its author from the page bootstrap before any X response is captured", async () => {
    const seen: Record<string, unknown>[] = []
    const { detector, composer } = setup(
      page(bootstrap({ followers_count: 812, friends_count: 3, statuses_count: 9, favourites_count: 7, created_at: "Sun Apr 03 23:48:02 +0000 2022" })),
      new Map(),
      async (text, metadata) => {
        seen.push(metadata)
        return scoredResult(text, 0.5)
      },
    )
    composer.textContent = "Launch day"
    detector.scan()
    await flushPromises()
    expect(seen[0]).toMatchObject({
      authorHandle: "ada",
      authorFollowers: 812,
      authorCreatedAt: "Sun Apr 03 23:48:02 +0000 2022",
      authorFavourites: 7,
      createdAt: "2026-09-23T12:00:00.000Z",
      hasMedia: false,
      hasPhoto: false,
      hasVideo: false,
      isQuote: false,
      hasCard: false,
    })
  })

  it("sends no author at all rather than counts without the account's age", async () => {
    const seen: Record<string, unknown>[] = []
    const { detector, composer } = setup(page(bootstrap({ followers_count: 812 })), new Map(), async (text, metadata) => {
      seen.push(metadata)
      return scoredResult(text, 0.5)
    })
    composer.textContent = "Launch day"
    detector.scan()
    await flushPromises()
    expect(Object.keys(seen[0] ?? {}).filter((key) => key.startsWith("author"))).toEqual([])
  })

  it("rescores an open draft when the author's stats arrive, keeping the current number up meanwhile", async () => {
    const seen: Record<string, unknown>[] = []
    const statsByHandle = new Map<string, XAuthorStats>()
    let release: (() => void) | null = null
    const { document, controller, detector, composer } = setup(page(""), statsByHandle, async (text, metadata) => {
      seen.push(metadata)
      if (seen.length === 2) await new Promise<void>((resolve) => { release = resolve })
      return scoredResult(text, seen.length === 1 ? 0 : 1)
    })
    composer.textContent = "Launch day"
    detector.scan()
    for (let tick = 0; tick < 6; tick += 1) await flushPromises()
    expect(seen[0]?.authorFollowers).toBeUndefined()
    const panel = document.querySelector<HTMLElement>(panelSelector)!
    const shownBefore = panel.querySelector(".scoreboar-composer-panel__value")?.textContent
    expect(shownBefore).toMatch(/%$/u)

    // Unchanged author: a cache hit, no second model call.
    controller.refresh()
    await flushPromises()
    expect(seen).toHaveLength(1)

    statsByHandle.set("ada", {
      authorHandle: "ada",
      authorFollowers: 813,
      authorFollowing: 3,
      authorTweets: 9,
      authorVerified: false,
      authorCreatedAt: "Sun Apr 03 23:48:02 +0000 2022",
      authorFavourites: 7,
      authorMetadataSource: "loaded-x-response",
    })
    controller.refresh()
    await flushPromises()
    expect(seen).toHaveLength(2)
    expect(seen[1]).toMatchObject({ authorFollowers: 813, authorCreatedAt: "Sun Apr 03 23:48:02 +0000 2022" })
    expect(panel.getAttribute(SCOREBOAR_COMPOSER_PANEL_STATE_ATTRIBUTE)).toBe("ready")
    expect(panel.querySelector(".scoreboar-composer-panel__value")?.textContent).toBe(shownBefore)
    release!()
    for (let tick = 0; tick < 6; tick += 1) await flushPromises()
    const shownAfter = panel.querySelector(".scoreboar-composer-panel__value")?.textContent
    expect(shownAfter).toMatch(/%$/u)
    expect(shownAfter).not.toBe(shownBefore)
  })

  it("says on the pill itself, next to the score, when a draft was scored without the account's stats", async () => {
    const statsByHandle = new Map<string, XAuthorStats>()
    const { document, controller, detector, composer } = setup(page(""), statsByHandle, async (text, metadata) => {
      return scoredResult(text, metadata.authorFollowers === undefined ? 0.2 : 0.6)
    })
    composer.textContent = "Launch day"
    detector.scan()
    for (let tick = 0; tick < 6; tick += 1) await flushPromises()
    const panel = document.querySelector<HTMLElement>(panelSelector)!
    const note = panel.querySelector<HTMLElement>(".scoreboar-composer-panel__note")
    expect(panel.getAttribute(SCOREBOAR_COMPOSER_PANEL_STATE_ATTRIBUTE)).toBe("ready")
    expect(note?.textContent).toBe("no account stats")
    expect(note?.previousElementSibling?.className).toContain("scoreboar-composer-panel__value")
    expect(panel.querySelector(".scoreboar-composer-panel__value")?.textContent).toMatch(/%$/u)
    expect(panel.getAttribute("aria-label")).toMatch(/, scored without your account's stats$/u)

    statsByHandle.set("ada", {
      authorHandle: "ada",
      authorFollowers: 813,
      authorFollowing: 3,
      authorTweets: 9,
      authorVerified: false,
      authorCreatedAt: "Sun Apr 03 23:48:02 +0000 2022",
      authorFavourites: 7,
      authorMetadataSource: "loaded-x-response",
    })
    controller.refresh()
    for (let tick = 0; tick < 6; tick += 1) await flushPromises()
    expect(note?.textContent).toBe("")
    expect(panel.getAttribute("aria-label")).not.toMatch(/without your account's stats/u)
  })

  it("never lets a slower score for the draft before an attachment overwrite the newer one", async () => {
    const resolvers: Array<() => void> = []
    const seen: Record<string, unknown>[] = []
    const dom = page("", `<div id="strip"></div>`)
    const { document, detector, composer } = setup(dom, new Map(), async (text, metadata) => {
      seen.push(metadata)
      const probability = metadata.hasPhoto === true ? 0.9 : 0.1
      await new Promise<void>((resolve) => resolvers.push(resolve))
      return scoredResult(text, probability)
    })
    composer.textContent = "Launch day"
    detector.scan()
    document.getElementById("strip")!.innerHTML = `<div data-testid="attachments"><img src="blob:https://x.com/p"></div>`
    detector.scan()
    expect(seen.map((metadata) => metadata.hasPhoto)).toEqual([false, true])
    resolvers[1]!()
    await flushPromises()
    await flushPromises()
    const panel = document.querySelector<HTMLElement>(panelSelector)!
    const newest = panel.querySelector(".scoreboar-composer-panel__value")?.textContent
    resolvers[0]!()
    await flushPromises()
    await flushPromises()
    expect(panel.querySelector(".scoreboar-composer-panel__value")?.textContent).toBe(newest)
  })

  it("scores a bare domain as the link X will make of it", async () => {
    const texts: string[] = []
    const { detector, composer } = setup(page(""), new Map(), async (text) => {
      texts.push(text)
      return scoredResult(text, 0.5)
    })
    composer.textContent = "Built this: x11.social"
    detector.scan()
    await flushPromises()
    expect(texts).toEqual(["Built this: https://x11.social"])
  })
})
