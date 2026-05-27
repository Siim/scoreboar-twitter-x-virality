import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import {
  SCOREBOAR_COMPOSER_PROCESSED_ATTRIBUTE,
  SCOREBOAR_TWEET_PROCESSED_ATTRIBUTE,
  X_SELECTORS,
  createScoreboarDomDetector,
} from "../src/index"

const fixture = (name: string) => readFileSync(resolve("fixtures", name), "utf8")

const flushMutationObserver = () => new Promise<void>((resolveFlush) => queueMicrotask(resolveFlush))

describe("dom-observer tweet and composer detection", () => {
  it("detects initial fixture tweets and one added tweet exactly once through a throttled observer", async () => {
    const dom = new JSDOM(fixture("timeline.html"))
    const tweetTexts: string[] = []
    const queuedScans: Array<() => void> = []
    const detector = createScoreboarDomDetector({
      root: dom.window.document,
      MutationObserverCtor: dom.window.MutationObserver,
      throttleMs: 25,
      scheduler: (callback) => {
        queuedScans.push(callback)
        return () => undefined
      },
      onTweetFound: ({ root, text }) => {
        expect(root.getAttribute(SCOREBOAR_TWEET_PROCESSED_ATTRIBUTE)).toBe("true")
        tweetTexts.push(text)
      },
    })

    detector.observe()
    detector.scan()

    expect(tweetTexts).toHaveLength(3)

    const addedTweet = dom.window.document.createElement("article")
    addedTweet.setAttribute("data-testid", "tweet")
    addedTweet.innerHTML = `<div data-testid="tweetText">Observer-added local tweet should be detected once.</div>`
    dom.window.document.querySelector("main")?.append(addedTweet)
    await flushMutationObserver()
    await flushMutationObserver()

    expect(queuedScans).toHaveLength(1)
    queuedScans.shift()?.()
    detector.scan()

    expect(tweetTexts).toEqual([
      "Shipping a tiny extension harness before feature work keeps regressions visible.",
      "Fixture-first tests make selector changes deliberate instead of accidental.",
      "This static timeline is deterministic and never calls a live social network.",
      "Observer-added local tweet should be detected once.",
    ])
    expect(dom.window.document.querySelectorAll(X_SELECTORS.tweetRoot)).toHaveLength(4)

    detector.disconnect()
  })

  it("detects primary and fallback composer candidates without duplicate callbacks", () => {
    const primaryDom = new JSDOM(fixture("composer.html"))
    const fallbackDom = new JSDOM(`<main><div role="textbox" contenteditable="true">Fallback draft</div></main>`)
    const composerTexts: string[] = []

    const primaryDetector = createScoreboarDomDetector({
      root: primaryDom.window.document,
      onComposerFound: ({ element, text }) => {
        expect(element.getAttribute(SCOREBOAR_COMPOSER_PROCESSED_ATTRIBUTE)).toBe("true")
        composerTexts.push(text)
      },
    })
    const fallbackDetector = createScoreboarDomDetector({
      root: fallbackDom.window.document,
      onComposerFound: ({ element, text }) => {
        expect(element.getAttribute(SCOREBOAR_COMPOSER_PROCESSED_ATTRIBUTE)).toBe("true")
        composerTexts.push(text)
      },
    })

    primaryDetector.scan()
    primaryDetector.scan()
    fallbackDetector.scan()
    fallbackDetector.scan()

    expect(composerTexts).toEqual(["", "Fallback draft"])
  })
})
