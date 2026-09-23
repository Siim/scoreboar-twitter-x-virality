import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import { extractTweetText, normalizePostText } from "../src/contracts"
import { markXAutolinks } from "../src/x-autolink"

// A typed draft, the API text X stores for the post (what training read), and
// the post as the timeline renders it must all normalize to the same text.
const TCO = "https://t.co/AbCdE12345"

const renderedText = (typed: string, linked: string) => {
  const [before, after] = typed.split(linked) as [string, string]
  const html = `${before}<a href="${TCO}" rel="noopener noreferrer nofollow" target="_blank"><span style="display:none">https://</span>${linked}</a>${after}`
  const article = new JSDOM(`<article data-testid="tweet"><div data-testid="tweetText">${html}</div></article>`).window.document.querySelector("article")!
  return extractTweetText(article)
}

describe("bare domains X links when it posts", () => {
  const linked: Array<readonly [string, string]> = [
    ["Built this over the weekend: x11.social\nTell me what you think", "x11.social"],
    ["Try it: cursor.com/cli", "cursor.com/cli"],
    ["cursor.com is where I live", "cursor.com"],
    ["Sign up at waitlist.app, it's free.", "waitlist.app"],
    ["More at docs.example.com.", "docs.example.com"],
    ["(details at blog.example.com/post-1).", "blog.example.com/post-1"],
    ["x11.social's launch went well", "x11.social"],
    ["try user.github.io today", "user.github.io"],
    ["twitch.tv is where I stream", "twitch.tv"],
    ["news on bbc.co.uk tonight", "bbc.co.uk"],
    ["see x.ai/grok for more", "x.ai/grok"],
  ]

  it("reads the same on the draft, in the API text and on the page", () => {
    for (const [typed, domain] of linked) {
      const api = normalizePostText(typed.replace(domain, TCO))
      expect({ typed, text: normalizePostText(markXAutolinks(typed)) }).toEqual({ typed, text: api })
      expect({ typed, text: normalizePostText(renderedText(typed, domain)) }).toEqual({ typed, text: api })
    }
  })

  it("leaves alone what X leaves as text", () => {
    for (const typed of ["mail me at hi@x11.social", "#NewsOne.com is live", "$foo.com", "grok on x.ai is fun", "cursor.sh rocks", "see readme.md and main.py", "Node.js and Next.js", "7 a.m. e.g. i.e.", "v1.2.3 and 3.14", "wait...what"]) {
      expect(markXAutolinks(typed)).toBe(typed)
    }
  })

  it("does not touch links that already have a scheme", () => {
    const typed = "https://example.com/a.b.com?x=foo.com and www.site.com"
    expect(markXAutolinks(typed)).toBe(typed)
  })

  it("keeps a trailing link when the draft has media: the stand-in is not a t.co link", () => {
    const typed = "New build is up: x11.social"
    expect(normalizePostText(markXAutolinks(typed), { hasMedia: true })).toBe("New build is up: [link]")
    expect(normalizePostText(renderedText(typed, "x11.social"), { hasMedia: true })).toBe("New build is up: [link]")
  })
})
