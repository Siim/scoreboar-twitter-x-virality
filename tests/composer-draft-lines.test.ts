import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import { describeComposer, readComposerDraft } from "../src/index"

// The model counts a draft's line breaks and reads its spacing, so a draft
// must come back with every line and blank line it shows, whatever editor X
// runs. Each case holds the same three paragraphs, "p1", "p2" and "p3", with a
// blank line between each, the way one kind of editor draws them.

const EXPECTED = "p1\n\np2\n\np3"
const PARAGRAPHS = ["p1", "", "p2", "", "p3"]

/** Draft.js, X's editor: a [data-block] per line; an empty line holds a <br>. */
const draftJs = (lines: readonly string[]) => `<div data-contents="true">${lines.map((line, index) => {
  const leaf = line
    ? `<span data-offset-key="k${index}-0-0"><span data-text="true">${line}</span></span>`
    : `<span data-offset-key="k${index}-0-0"><br data-text="true"></span>`
  return `<div data-block="true" data-editor="ed" data-offset-key="k${index}-0-0"><div class="public-DraftStyleDefault-block" data-offset-key="k${index}-0-0">${leaf}</div></div>`
}).join("")}</div>`

/** A plain contenteditable: a <div> per line, an empty line is <div><br></div>. */
const divLines = (lines: readonly string[]) => lines.map((line) => `<div>${line || "<br>"}</div>`).join("")

/** Lexical or ProseMirror: a <p> per paragraph, an empty one holds a <br>. */
const paragraphs = (lines: readonly string[]) => lines.map((line) => `<p dir="ltr">${line ? `<span data-lexical-text="true">${line}</span>` : "<br>"}</p>`).join("")

/** Line breaks inside one block: Shift+Enter in most editors. */
const brLines = (lines: readonly string[]) => `<div>${lines.join("<br>")}</div>`

const EDITORS = {
  "Draft.js blocks with an empty block between paragraphs": draftJs,
  "a plain contenteditable with <div> lines": divLines,
  "<p> paragraphs": paragraphs,
  "<br><br> inside one block": brLines,
} as const

const composerIn = (inner: string, url = "https://x.com/home") => {
  const dom = new JSDOM(`<!doctype html><body><main><div data-testid="tweetTextarea_0" role="textbox" contenteditable="true">${inner}</div></main></body>`, { url })
  return dom.window.document.querySelector('[data-testid="tweetTextarea_0"]')!
}

describe("readComposerDraft keeps every line, whatever editor X uses", () => {
  for (const [name, render] of Object.entries(EDITORS)) {
    it(`reads ${name}`, () => {
      expect(readComposerDraft(composerIn(render(PARAGRAPHS)))).toBe(EXPECTED)
    })

    it(`drops a reply's leading @mention from ${name}, as X does`, () => {
      const lines = ["@bob p1", ...PARAGRAPHS.slice(1)]
      const composer = composerIn(render(lines), "https://x.com/bob/status/1839000000000000001")
      expect(readComposerDraft(composer)).toBe(`@bob ${EXPECTED}`)
      const described = describeComposer(composer)
      expect(described.isReply).toBe(true)
      expect(described.text).toBe(EXPECTED)
    })
  }

  it("reads Chrome's own contenteditable, whose first line is bare text before the <div> lines", () => {
    expect(readComposerDraft(composerIn(`p1<div><br></div><div>p2</div><div><br></div><div>p3</div>`))).toBe(EXPECTED)
  })

  it("reads Draft.js markup the same without its [data-block] marks", () => {
    const withMarks = composerIn(draftJs(PARAGRAPHS))
    const withoutMarks = composerIn(draftJs(PARAGRAPHS).replace(/ data-block="true"/gu, ""))
    expect(readComposerDraft(withoutMarks)).toBe(readComposerDraft(withMarks))
  })

  it("counts an empty block as one empty line, and a block's closing <br> as none", () => {
    expect(readComposerDraft(composerIn(`<p>p1</p><p></p><p>p2</p><div></div><div>p3<br></div>`))).toBe(EXPECTED)
    expect(readComposerDraft(composerIn(`<div>p1<br><br>p2<br><br>p3<br></div>`))).toBe(EXPECTED)
  })

  it("keeps a single line break a single line break", () => {
    expect(readComposerDraft(composerIn(divLines(["p1", "p2"])))).toBe("p1\np2")
    expect(readComposerDraft(composerIn(paragraphs(["p1", "p2"])))).toBe("p1\np2")
    expect(readComposerDraft(composerIn(brLines(["p1", "p2"])))).toBe("p1\np2")
  })

  it("ignores the markup's whitespace between blocks and the caret's zero-width space", () => {
    const markup = `\n  <div>p1</div>\n  <div><br></div>\n  <div>p2</div>\n  <div>﻿<br></div>\n  <div>p3﻿</div>\n`
    expect(readComposerDraft(composerIn(markup))).toBe(EXPECTED)
  })

  it("reads emoji and links inside a line as the feed reads them", () => {
    const line = `<p>ship it <img alt="🚀" src="https://abs-0.twimg.com/emoji/v2/svg/1f680.svg"> <a href="https://x11.social/">x11.social</a></p><p><br></p><p>p2</p>`
    expect(readComposerDraft(composerIn(line))).toBe("ship it 🚀 https://link\n\np2")
  })

  it("still reads a one-line draft with no blocks at all", () => {
    expect(readComposerDraft(composerIn("Fallback draft"))).toBe("Fallback draft")
  })
})
