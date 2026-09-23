import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import {
  SCOREBOAR_COMPOSER_PROCESSED_ATTRIBUTE,
  SCOREBOAR_TWEET_PROCESSED_ATTRIBUTE,
  X_SELECTORS,
  createScoreboarDomDetector,
  type ComposerFoundEvent,
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

describe("composer context: what the draft's post will carry", () => {
  const editor = (n: number, text: string) => `<div data-testid="tweetTextarea_${n}_label"><div data-testid="tweetTextarea_${n}" role="textbox" contenteditable="true"><div data-contents="true">${
    text.split("\n").map((line) => `<div data-block="true"><div>${line ? `<span data-text="true">${line}</span>` : "<br>"}</div></div>`).join("")
  }</div></div></div>`
  const toolbar = `<div><div data-testid="toolBar"><input data-testid="fileInput" type="file"><button data-testid="tweetButtonInline">Post</button></div></div>`
  const photoStrip = `<div data-testid="attachments"><div role="group"><img alt="" src="blob:https://x.com/p"></div></div>`
  const videoStrip = `<div data-testid="attachments"><div role="group"><video src="blob:https://x.com/v"></video><img alt="" src="blob:https://x.com/poster"></div></div>`
  const feedPost = (media: string) => `<article data-testid="tweet"><div data-testid="User-Name"><a href="/someone">Someone</a></div><div data-testid="tweetText">feed</div>${media}</article>`
  const quotedPost = `<div role="link" tabindex="0"><div data-testid="User-Name"><span>Quoted</span></div><div data-testid="tweetText">quoted</div><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/q.jpg"></div></div>`
  // A quoted post whose media sits in an attachments strip of its own; as X's post link, or as a plain block.
  const quotedPostBody = `<div><div data-testid="User-Name"><span>Quoted</span></div></div><div data-testid="tweetText">quoted</div><div data-testid="attachments"><div role="group"><img src="https://pbs.twimg.com/media/q.jpg"></div></div>`
  const quotedPostWithStrip = `<div role="link" tabindex="0">${quotedPostBody}</div>`
  const plainQuotedPostWithStrip = `<div class="quote">${quotedPostBody}</div>`

  const collect = (html: string, url = "https://x.com/home") => {
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url })
    const events: ComposerFoundEvent[] = []
    const detector = createScoreboarDomDetector({ root: dom.window.document, onComposerFound: (event) => events.push(event) })
    return { dom, document: dom.window.document, events, detector }
  }
  const media = (event: ComposerFoundEvent | undefined) => event && { hasMedia: event.hasMedia, hasPhoto: event.hasPhoto, hasVideo: event.hasVideo }

  it("rescores when media is attached, swapped or removed after typing", () => {
    const { document, events, detector } = collect(`<main><div class="col">${editor(0, "Launch day")}<div id="strip"></div>${toolbar}</div></main>`)
    detector.scan()
    expect(media(events.at(-1))).toEqual({ hasMedia: false, hasPhoto: false, hasVideo: false })

    document.getElementById("strip")!.innerHTML = photoStrip
    detector.scan()
    expect(events).toHaveLength(2)
    expect(events[1]?.text).toBe("Launch day")
    expect(media(events[1])).toEqual({ hasMedia: true, hasPhoto: true, hasVideo: false })

    // A video's poster frame is not a photo.
    document.getElementById("strip")!.innerHTML = videoStrip
    detector.scan()
    expect(media(events.at(-1))).toEqual({ hasMedia: true, hasPhoto: false, hasVideo: true })

    document.getElementById("strip")!.innerHTML = ""
    detector.scan()
    expect(media(events.at(-1))).toEqual({ hasMedia: false, hasPhoto: false, hasVideo: false })
    expect(events).toHaveLength(4)
  })

  it("an upload still in progress is media of no known type yet", () => {
    const { events, detector } = collect(`<main><div>${editor(0, "one sec")}<div data-testid="attachments"><div role="progressbar" aria-valuenow="40"></div></div>${toolbar}</div></main>`)
    detector.scan()
    expect(media(events[0])).toEqual({ hasMedia: true, hasPhoto: null, hasVideo: null })
  })

  it("never counts media that is not the draft's", () => {
    const layouts: Record<string, string> = {
      "home composer above a photo and a video timeline": `<main><div>${editor(0, "a")}${toolbar}</div><section>${feedPost('<div data-testid="tweetPhoto"><img src="p.jpg"></div>')}${feedPost('<div data-testid="videoPlayer"><video></video></div>')}</section></main>`,
      "inline reply under a focal post with a video": `<main>${feedPost('<div data-testid="videoPlayer"><video></video></div>')}<div>${editor(0, "a")}${toolbar}</div></main>`,
      "reply dialog whose parent post has a photo": `<div role="dialog">${feedPost('<div data-testid="tweetPhoto"><img src="p.jpg"></div>')}<div>${editor(0, "a")}</div>${toolbar}</div>`,
      "quote dialog with a photo in the quoted post": `<div role="dialog"><div>${editor(0, "a")}${quotedPost}${toolbar}</div></div>`,
      "quote preview inside the attachments strip": `<div role="dialog"><div>${editor(0, "a")}<div data-testid="attachments">${quotedPost}</div>${toolbar}</div></div>`,
      "quote preview whose photo has a strip of its own": `<div role="dialog"><div>${editor(0, "a")}${quotedPostWithStrip}${toolbar}</div></div>`,
      "quote preview with a strip of its own, inside the attachments strip": `<div role="dialog"><div>${editor(0, "a")}<div data-testid="attachments">${quotedPostWithStrip}</div>${toolbar}</div></div>`,
      "plain quote block with a strip of its own": `<div role="dialog"><div>${editor(0, "a")}${plainQuotedPostWithStrip}${toolbar}</div></div>`,
      "plain quote block with a strip of its own, inside the attachments strip": `<div role="dialog"><div>${editor(0, "a")}<div data-testid="attachments"><div>${plainQuotedPostWithStrip}</div></div>${toolbar}</div></div>`,
      "quoted video playing, with its own progress bar": `<div role="dialog"><div>${editor(0, "a")}<div role="link"><div data-testid="User-Name">Quoted</div><div data-testid="attachments"><div data-testid="videoPlayer"><video src="blob:https://x.com/stream"></video><div role="progressbar"></div></div></div></div>${toolbar}</div></div>`,
      "link card preview in the attachments strip": `<div role="dialog"><div>${editor(0, "a")}<div data-testid="attachments"><div data-testid="card.wrapper"><img src="https://pbs.twimg.com/card_img/1.jpg"></div></div>${toolbar}</div></div>`,
      "text box with no toolbar next to a photo post": `<main>${feedPost('<div data-testid="tweetPhoto"><img src="p.jpg"></div>')}<div>${editor(0, "a")}<button>Reply</button></div>${feedPost('<div data-testid="attachments"><img src="x.jpg"></div>')}</main>`,
    }
    for (const [name, html] of Object.entries(layouts)) {
      const { events, detector } = collect(html)
      detector.scan()
      expect({ name, ...media(events[0]) }).toEqual({ name, hasMedia: false, hasPhoto: false, hasVideo: false })
    }
  })

  it("keeps the draft's own media when a quote preview shares its strip wrapper", () => {
    const shared = (own: string, quote: string) => `<div role="dialog"><div>${editor(0, "a")}<div data-testid="attachments"><div><div role="group">${own}</div>${quote}</div></div>${toolbar}</div></div>`
    const photo = `<img alt="" src="blob:https://x.com/p">`
    const video = `<video src="blob:https://x.com/v"></video><img alt="" src="blob:https://x.com/poster">`
    const cases: Array<[string, string, ReturnType<typeof media>]> = [
      ["photo next to X's quote link", shared(photo, quotedPost), { hasMedia: true, hasPhoto: true, hasVideo: false }],
      ["photo next to a plain quote block", shared(photo, `<div class="quote"><div data-testid="User-Name">Quoted</div><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/q.jpg"></div></div>`), { hasMedia: true, hasPhoto: true, hasVideo: false }],
      ["photo next to a plain quote block with a strip of its own", shared(photo, plainQuotedPostWithStrip), { hasMedia: true, hasPhoto: true, hasVideo: false }],
      ["video next to a plain quote block with a photo", shared(video, plainQuotedPostWithStrip), { hasMedia: true, hasPhoto: false, hasVideo: true }],
      ["upload in progress next to a plain quote block", shared(`<div role="progressbar" aria-valuenow="40"></div>`, plainQuotedPostWithStrip), { hasMedia: true, hasPhoto: null, hasVideo: null }],
    ]
    for (const [name, html, expected] of cases) {
      const { events, detector } = collect(html)
      detector.scan()
      expect({ name, isQuote: events[0]?.isQuote, ...media(events[0]) }).toEqual({ name, isQuote: true, ...expected })
    }
  })

  it("a poll on a quoted post is not the draft's card", () => {
    const quotedPoll = (wrapper: string) => `${wrapper}<div data-testid="User-Name">Pollster</div><div data-testid="tweetText">Tabs or spaces?</div><div data-testid="card.wrapper"><div data-testid="cardPoll"><div data-testid="pollChoice-0">Tabs</div><div data-testid="pollChoice-1">Spaces</div></div></div></div>`
    for (const quote of [quotedPoll('<div role="link" tabindex="0">'), quotedPoll('<div class="quote">')]) {
      const { events, detector } = collect(`<div role="dialog"><div>${editor(0, "This.")}${quote}${toolbar}</div></div>`)
      detector.scan()
      expect(events[0]).toMatchObject({ isQuote: true, hasCard: false, hasMedia: false })
    }
  })

  it("reads each thread post's own attachments", () => {
    const { events, detector } = collect(`<div role="dialog"><div>${editor(0, "first")}${photoStrip}</div><div>${editor(1, "second")}</div>${toolbar}</div>`)
    detector.scan()
    expect(events.map((event) => [event.text, event.hasPhoto])).toEqual([["first", true], ["second", false]])
  })

  it("knows a quote from X's preview or from a trailing post link, and says so either way", () => {
    const plain = collect(`<div role="dialog"><div>${editor(0, "Shipping tonight")}${toolbar}</div></div>`)
    plain.detector.scan()
    expect(plain.events[0]?.isQuote).toBe(false)

    const preview = collect(`<div role="dialog"><div>${editor(0, "This.")}${quotedPost}${toolbar}</div></div>`)
    preview.detector.scan()
    expect(preview.events[0]).toMatchObject({ text: "This.", isQuote: true, hasMedia: false })

    const pasted = collect(`<main><div>${editor(0, "Look https://x.com/a/status/123?s=20")}${toolbar}</div></main>`)
    pasted.detector.scan()
    expect(pasted.events[0]).toMatchObject({ text: "Look", isQuote: true })

    // Deleting the link is an edit: it rescored, and the draft is no longer a quote.
    const block = pasted.document.querySelector('[data-text="true"]')!
    block.textContent = "Look"
    pasted.detector.scan()
    expect(pasted.events).toHaveLength(2)
    expect(pasted.events[1]).toMatchObject({ text: "Look", isQuote: false })
    expect(pasted.events[1]?.key).not.toBe(pasted.events[0]?.key)

    const onlyLink = collect(`<main><div>${editor(0, "https://twitter.com/a/status/123")}${toolbar}</div></main>`)
    onlyLink.detector.scan()
    expect(onlyLink.events[0]).toMatchObject({ text: "", isQuote: true })
  })

  it("a poll is a card, and adding one to typed text rescores", () => {
    const { document, events, detector } = collect(`<main><div>${editor(0, "Tabs or spaces?")}<div id="poll"></div>${toolbar}</div></main>`)
    detector.scan()
    expect(events[0]?.hasCard).toBe(false)
    document.getElementById("poll")!.innerHTML = `<input name="Choice1"><input name="Choice2"><select data-testid="selectPollDays"></select>`
    detector.scan()
    expect(events).toHaveLength(2)
    expect(events[1]?.hasCard).toBe(true)
  })

  it("a line-break edit rescores; a trailing space does not", () => {
    const { document, events, detector } = collect(`<main><div>${editor(0, "")}${toolbar}</div></main>`)
    detector.scan()
    events.length = 0
    // The same editor element, its Draft.js blocks rewritten the way typing does.
    const contents = document.querySelector("[data-contents]")!
    const type = (text: string) => {
      contents.innerHTML = text.split("\n").map((line) => `<div data-block="true"><div>${line ? `<span data-text="true">${line}</span>` : "<br>"}</div></div>`).join("")
      detector.scan()
    }
    type("A. B")
    type("A.\nB")
    type("A.\n\nB")
    type("A.\n\nB ")
    expect(events.map((event) => event.text)).toEqual(["A. B", "A.\nB", "A.\n\nB"])
  })

  it("drops a reply's leading mentions, which X moves into Replying to", () => {
    const replyDialog = collect(`<div role="dialog">${feedPost("")}<div>${editor(0, "@grok @alice is this true?")}</div>${toolbar}</div>`)
    replyDialog.detector.scan()
    expect(replyDialog.events[0]).toMatchObject({ text: "is this true?", isReply: true })

    const newPost = collect(`<div role="dialog"><div>${editor(0, "@grok is this true?")}${toolbar}</div></div>`)
    newPost.detector.scan()
    expect(newPost.events[0]).toMatchObject({ text: "@grok is this true?", isReply: false })

    const quote = collect(`<div role="dialog"><div>${editor(0, "@grok is this true?")}${quotedPost}${toolbar}</div></div>`)
    quote.detector.scan()
    expect(quote.events[0]?.text).toBe("@grok is this true?")

    const inlineReply = collect(`<main>${feedPost("")}<div>${editor(0, "@bob agreed")}${toolbar}</div></main>`, "https://x.com/bob/status/123")
    inlineReply.detector.scan()
    expect(inlineReply.events[0]?.text).toBe("agreed")

    const comma = collect(`<main><div>${editor(0, "@alice, hi")}${toolbar}</div></main>`, "https://x.com/bob/status/123")
    comma.detector.scan()
    expect(comma.events[0]?.text).toBe("@alice, hi")

    const thread = collect(`<div role="dialog"><div>${editor(0, "one")}</div><div>${editor(1, "@alice two")}</div>${toolbar}</div>`)
    thread.detector.scan()
    expect(thread.events.map((event) => event.text)).toEqual(["one", "two"])
  })

  it("a scheduled draft goes out at the time X shows", () => {
    const { events, detector } = collect(`<div role="dialog"><div><span>Will send on Tue, Sep 29, 2026 at 9:05 PM</span></div><div>${editor(0, "later")}${toolbar}</div></div>`)
    detector.scan()
    expect(events[0]?.scheduledAt).toBe(new Date(2026, 8, 29, 21, 5).toISOString())
  })
})
