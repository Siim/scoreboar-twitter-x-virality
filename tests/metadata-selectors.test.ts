import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import {
  X_COMPOSER_SELECTOR,
  X_SELECTORS,
  X_TWEET_MEDIA_SELECTOR,
  extractComposerText,
  extractTweetId,
  extractTweetMediaFacts,
  extractTweetText,
  extractTweetAuthorMetadata,
  extractSerializedAuthorMetadata,
  extractViewerHandle,
  splitTrailingPostLink,
  stripReplyMentionPrefix,
  tweetHasMedia,
  tweetIsQuote,
  tweetTextTruncated,
} from "../src/contracts"
import { describeTweetRoot } from "../src/dom-detection"

const queryRoot = (matches: Record<string, string | null>) => ({
  querySelector: (selector: string) => {
    if (!(selector in matches)) {
      return null
    }

    const textContent = matches[selector]
    return textContent === null ? null : { textContent }
  },
})

describe("selectors contract", () => {
  it("selectors centralize X tweet, text, composer, and media contracts", () => {
    expect(X_SELECTORS.tweetRoot).toBe('article[data-testid="tweet"]')
    expect(X_SELECTORS.tweetText).toBe('[data-testid="tweetText"]')
    expect(X_COMPOSER_SELECTOR).toContain('[data-testid="tweetTextarea_0"]')
    expect(X_COMPOSER_SELECTOR).toContain('div[role="textbox"][contenteditable="true"]')
    expect(X_TWEET_MEDIA_SELECTOR).toContain('[data-testid="tweetPhoto"]')
    expect(X_TWEET_MEDIA_SELECTOR).toContain('[data-testid="videoPlayer"]')
  })

  it("selectors extract composer fixture text through centralized fallback", () => {
    const root = queryRoot({ [X_COMPOSER_SELECTOR]: "Local draft only" })

    expect(extractComposerText(root)).toBe("Local draft only")
  })

  it("selectors return deterministic empty composer text and media presence", () => {
    const emptyRoot = queryRoot({})
    const mediaRoot = queryRoot({ [X_TWEET_MEDIA_SELECTOR]: "" })

    expect(extractComposerText(emptyRoot)).toBe("")
    expect(tweetHasMedia(emptyRoot)).toBe(false)
    expect(tweetHasMedia(mediaRoot)).toBe(true)
  })

  it("extracts same-page author metadata without probing", () => {
    const dom = new JSDOM()
    const article = dom.window.document.createElement("article")
    article.innerHTML = `
      <a href="/nikitaboar">@nikitaboar</a>
      <span aria-label="Verified account">Verified</span>
      <div hidden>12.4K Followers 321 Following 777 Posts</div>
      <div data-testid="tweetText">same page metadata fixture</div>
    `

    expect(extractTweetAuthorMetadata(article)).toEqual({
      authorHandle: "nikitaboar",
      authorFollowers: 12400,
      authorFollowing: 321,
      authorTweets: 777,
      authorVerified: true,
      authorVerifiedType: null,
      authorCreatedAt: null,
      authorFavourites: null,
      authorMetadataSource: "same-page-dom",
    })
  })

  it("defaults author metadata when not visible in same-page DOM", () => {
    const dom = new JSDOM()
    const article = dom.window.document.createElement("article")
    article.innerHTML = '<div data-testid="tweetText">plain tweet</div>'

    expect(extractTweetAuthorMetadata(article)).toEqual({
      authorHandle: null,
      authorFollowers: null,
      authorFollowing: null,
      authorTweets: null,
      authorVerified: null,
      authorVerifiedType: null,
      authorCreatedAt: null,
      authorFavourites: null,
      authorMetadataSource: "defaulted",
    })
  })

  it("extracts author stats from same-page serialized X state when present", () => {
    const dom = new JSDOM(`
      <article>
        <a href="/serialboar">@serialboar</a>
        <div data-testid="tweetText">serialized state fixture</div>
      </article>
      <script>
        window.__INITIAL_STATE__={"entities":{"users":{"entities":{"1":{"followers_count":1286,"friends_count":1192,"statuses_count":3127,"screen_name":"serialboar","is_blue_verified":true,"verified":false}}}}};
      </script>
    `)
    const article = dom.window.document.querySelector("article")
    expect(article).not.toBeNull()

    expect(extractTweetAuthorMetadata(article!)).toEqual({
      authorHandle: "serialboar",
      authorFollowers: 1286,
      authorFollowing: 1192,
      authorTweets: 3127,
      authorVerified: true,
      authorVerifiedType: null,
      authorCreatedAt: null,
      authorFavourites: null,
      authorMetadataSource: "same-page-dom",
    })
  })

  it("prioritizes X author chrome over quoted or embedded links", () => {
    const dom = new JSDOM(`
      <article>
        <div data-testid="UserAvatar-Container-real_author"></div>
        <div data-testid="User-Name">
          <a href="/real_author">Real Author</a>
          <a href="/real_author">@real_author</a>
        </div>
        <div data-testid="tweetText">Check this quote</div>
        <div role="link"><a href="/quoted_author">@quoted_author</a></div>
        <a href="/mentioned_first">embedded card</a>
      </article>
    `)
    const article = dom.window.document.querySelector("article")
    expect(article).not.toBeNull()

    expect(extractTweetAuthorMetadata(article!).authorHandle).toBe("real_author")
  })
})

describe("reading posts the way the model was trained", () => {
  const article = (html: string) => {
    const dom = new JSDOM(`<article data-testid="tweet">${html}</article>`)
    return dom.window.document.querySelector("article")!
  }

  it("keeps emoji, line breaks and one placeholder per link", () => {
    const root = article(`
      <div data-testid="tweetText"><span>shipped it </span><img alt="🚀" src="x.svg"><span>
second line </span><a href="https://t.co/abc"><span>https://</span>github.com/x/y…</a><span> via </span><a href="/boar">@boar</a></div>
    `)
    // An unpadded URL-shaped stand-in: the contract's URL rule makes it [link], as it does the t.co in API text.
    expect(extractTweetText(root)).toBe("shipped it 🚀\nsecond line https://link via @boar")
  })

  it("counts media on the post, not in the quoted post, and not link cards", () => {
    const own = article(`<div data-testid="tweetPhoto"></div><div data-testid="card.wrapper"></div>`)
    expect(extractTweetMediaFacts(own)).toEqual({ hasMedia: true, hasPhoto: true, hasVideo: false, hasCard: true })

    const quoted = article(`
      <div data-testid="User-Name"><a href="/me">me</a></div>
      <div role="link"><div data-testid="User-Name"><a href="/them">them</a></div><div data-testid="videoPlayer"></div></div>
    `)
    expect(extractTweetMediaFacts(quoted)).toEqual({ hasMedia: false, hasPhoto: false, hasVideo: false, hasCard: false })
    expect(tweetIsQuote(quoted)).toBe(true)
  })

  it("finds the post id from its own timestamp link", () => {
    const root = article(`<a href="/boar/status/2101070651281047607"><time datetime="2026-09-18T22:07:33.000Z">Sep 18</time></a>`)
    expect(extractTweetId(root)).toBe("2101070651281047607")
  })
})

describe("the post body as training and the draft read it", () => {
  const article = (html: string) => new JSDOM(`<article data-testid="tweet">${html}</article>`).window.document.querySelector("article")!
  const card = (href: string) => `<div data-testid="card.wrapper"><a href="${href}"><img alt="" src="c.jpg"></a><a href="${href}">From example.com</a></div>`

  it("puts back the trailing URL X hides behind the post's link card", () => {
    expect(describeTweetRoot(article(`<div data-testid="tweetText">I wrote up everything we learned in 6 months</div>${card("https://t.co/abc")}`)).text)
      .toBe("I wrote up everything we learned in 6 months https://link")
    // The break before the URL survives when the page kept it.
    expect(extractTweetText(article(`<div data-testid="tweetText">A list:\n</div>${card("https://t.co/abc")}`))).toBe("A list:\nhttps://link")
    // A link-only post reads as the draft did: just the link.
    expect(describeTweetRoot(article(card("https://t.co/abc"))).text).toBe("https://link")
  })

  it("leaves the text alone when the card's URL is shown, for polls, and for a quoted post's card", () => {
    const shown = article(`<div data-testid="tweetText">See <a href="https://t.co/abc">example.com/a</a> for more</div>${card("https://t.co/abc")}`)
    expect(extractTweetText(shown)).toBe("See https://link for more")
    const poll = article(`<div data-testid="tweetText">Tabs or spaces?</div><div data-testid="card.wrapper"><div data-testid="cardPoll">Tabs</div></div>`)
    expect(extractTweetText(poll)).toBe("Tabs or spaces?")
    const quotedCard = article(`<div data-testid="tweetText">This</div><div role="link"><div data-testid="User-Name">them</div>${card("https://t.co/q")}</div>`)
    expect(extractTweetText(quotedCard)).toBe("This")
  })

  it("reads a quote with no words of its own as empty, not as the quoted post", () => {
    const quoteOnly = article(`<div data-testid="User-Name"><a href="/me">me</a></div><div role="link"><div data-testid="User-Name">them</div><div data-testid="tweetText">their words</div></div>`)
    expect(extractTweetText(quoteOnly)).toBe("")
  })

  it("flags a long post the timeline cut short", () => {
    expect(tweetTextTruncated(article(`<div data-testid="tweetText">Start of a long post</div><button data-testid="tweet-text-show-more-link">Show more</button>`))).toBe(true)
    expect(tweetTextTruncated(article(`<div data-testid="tweetText">Short</div><div role="link"><div data-testid="User-Name">q</div><button data-testid="tweet-text-show-more-link">Show more</button></div>`))).toBe(false)
  })

  it("counts a video item as video whichever way X nests its player", () => {
    expect(extractTweetMediaFacts(article(`<div data-testid="videoPlayer"><div data-testid="tweetPhoto"><video></video></div></div>`))).toMatchObject({ hasPhoto: false, hasVideo: true })
    expect(extractTweetMediaFacts(article(`<div data-testid="tweetPhoto"><div data-testid="videoPlayer"><video></video></div></div>`))).toMatchObject({ hasPhoto: false, hasVideo: true })
  })

  it("reads the author's stats from the author's chrome, not the post body or a quoted post", () => {
    const root = article(`
      <div data-testid="UserAvatar-Container-plainboar"></div>
      <div data-testid="tweetText">We just hit 10K followers! Thanks @bigaccount</div>
      <div role="link"><div data-testid="User-Name">Big <svg aria-label="Verified account"></svg></div></div>`)
    expect(extractTweetAuthorMetadata(root)).toMatchObject({ authorHandle: "plainboar", authorFollowers: null, authorVerified: null })
  })
})

describe("the signed-in account", () => {
  const doc = (html: string) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document

  it("comes from page structure, whatever the display name says", () => {
    const expanded = `<button data-testid="SideNav_AccountSwitcher_Button"><div data-testid="UserAvatar-Container-janedoe"></div><span>Jane | eng @acme</span><span>@janedoe</span></button>`
    expect(extractViewerHandle(doc(expanded))).toBe("janedoe")
    // Collapsed side nav: only the avatar, plus the Profile tab.
    expect(extractViewerHandle(doc(`<button data-testid="SideNav_AccountSwitcher_Button"><div data-testid="UserAvatar-Container-janedoe"></div></button>`))).toBe("janedoe")
    expect(extractViewerHandle(doc(`<nav><a data-testid="AppTabBar_Profile_Link" href="/janedoe">Profile</a></nav>`))).toBe("janedoe")
    // The narrow layout's profile button.
    expect(extractViewerHandle(doc(`<a data-testid="DashButton_ProfileIcon_Link" href="/janedoe"><div data-testid="UserAvatar-Container-janedoe"></div></a>`))).toBe("janedoe")
    // Text only: the handle line, not the first "@" in the name.
    expect(extractViewerHandle(doc(`<button data-testid="SideNav_AccountSwitcher_Button"><span>Siim ceo@acme</span><span>@siimh</span></button>`))).toBe("siimh")
    expect(extractViewerHandle(doc(`<nav><a data-testid="AppTabBar_Profile_Link" href="/home">Home</a></nav>`))).toBeNull()
  })

  it("its serialized stats come from its own user object", () => {
    const state = {
      settings: { remote: { settings: { screen_name: "Ada_Builds" } } },
      entities: { users: { entities: {
        7: { screen_name: "someone", followers_count: 99999, created_at: "Mon Jan 01 00:00:00 +0000 2010", favourites_count: 5 },
        42: { screen_name: "Ada_Builds", followers_count: 812, friends_count: 301, statuses_count: 4120, favourites_count: 9800, created_at: "Sun Apr 03 23:48:02 +0000 2022", is_blue_verified: true, verified: false, description: "{ braces } in \"quotes\"" },
      } } },
    }
    const document = doc(`<script>window.__INITIAL_STATE__=${JSON.stringify(state)};</script>`)
    expect(extractSerializedAuthorMetadata(document, "ada_builds")).toEqual({
      authorFollowers: 812,
      authorFollowing: 301,
      authorTweets: 4120,
      authorVerified: true,
      authorVerifiedType: null,
      authorCreatedAt: "Sun Apr 03 23:48:02 +0000 2022",
      authorFavourites: 9800,
    })
  })
})

describe("draft text rules X applies when it posts", () => {
  it("a trailing post link is the quote, not text", () => {
    expect(splitTrailingPostLink("Look https://x.com/a/status/123?s=20")).toEqual({ text: "Look", quotesPost: true })
    expect(splitTrailingPostLink("Look\nhttps://twitter.com/a/status/123/photo/1 ")).toEqual({ text: "Look", quotesPost: true })
    expect(splitTrailingPostLink("Look x.com/a/status/123")).toEqual({ text: "Look", quotesPost: true })
    expect(splitTrailingPostLink("See https://x.com/a/status/123 first")).toEqual({ text: "See https://x.com/a/status/123 first", quotesPost: false })
    expect(splitTrailingPostLink("Follow https://x.com/a")).toEqual({ text: "Follow https://x.com/a", quotesPost: false })
    expect(splitTrailingPostLink("on fox.com/a/status/1")).toEqual({ text: "on fox.com/a/status/1", quotesPost: false })
  })

  it("a reply's leading mentions go to Replying to", () => {
    expect(stripReplyMentionPrefix("@grok @alice is this true?")).toBe("is this true?")
    expect(stripReplyMentionPrefix("@alice, hi")).toBe("@alice, hi")
    expect(stripReplyMentionPrefix("hi @alice")).toBe("hi @alice")
    expect(stripReplyMentionPrefix("@a_very_long_handle_x hi")).toBe("@a_very_long_handle_x hi")
  })
})
