import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import {
  V5_METADATA_FEATURE_ORDER,
  X_COMPOSER_SELECTOR,
  X_SELECTORS,
  X_TWEET_MEDIA_SELECTOR,
  extractComposerText,
  extractTextFeatures,
  extractTweetAuthorMetadata,
  preprocessMetadata,
  tweetHasMedia,
} from "../src/contracts"

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

describe("metadata preprocessing contract", () => {
  it("metadata uses the v5 feature order", () => {
    expect(V5_METADATA_FEATURE_ORDER).toEqual([
      "has_media",
      "created_at_hour_sin",
      "created_at_hour_cos",
      "created_at_day_sin",
      "created_at_day_cos",
      "log_author_followers",
      "log_author_following",
      "log_author_tweets",
      "author_verified",
      "hashtag_count",
      "mention_count",
      "url_count",
    ])
  })

  it("metadata defaults empty text and absent author values deterministically", () => {
    const result = preprocessMetadata()

    expect(result.textFeatures).toEqual({ hashtagCount: 0, mentionCount: 0, urlCount: 0 })
    expect(result.vector).toHaveLength(V5_METADATA_FEATURE_ORDER.length)
    expect(result.features).toMatchObject({
      has_media: 0,
      created_at_hour_sin: 0,
      created_at_hour_cos: 1,
      created_at_day_sin: 0,
      created_at_day_cos: 1,
      log_author_followers: 0,
      log_author_following: 0,
      log_author_tweets: 0,
      author_verified: 0,
      hashtag_count: 0,
      mention_count: 0,
      url_count: 0,
    })
  })

  it("metadata counts hashtags mentions and URLs with clipping transforms", () => {
    const result = preprocessMetadata({
      text: "Ship it #AI #build with @ada @boar https://x.example/post www.example.test",
      hasMedia: true,
      createdAtHour: 30,
      createdAtDay: 9,
      authorFollowers: 100,
      authorFollowing: -5,
      authorTweets: 0,
      authorVerified: true,
    })

    expect(result.textFeatures).toEqual({ hashtagCount: 2, mentionCount: 2, urlCount: 2 })
    expect(result.features.has_media).toBe(1)
    expect(result.features.author_verified).toBe(1)
    expect(result.features.hashtag_count).toBe(0.1)
    expect(result.features.mention_count).toBe(0.1)
    expect(result.features.url_count).toBe(0.1)
    expect(result.features.created_at_hour_sin).toBeCloseTo(Math.sin((2 * Math.PI * 23) / 24))
    expect(result.features.created_at_day_cos).toBeCloseTo(Math.cos((2 * Math.PI * 6) / 7))
    expect(result.features.log_author_followers).toBeCloseTo(Math.log1p(100) / 20)
    expect(result.features.log_author_following).toBe(0)
  })

  it("metadata handles non-English text and emoji without throwing", () => {
    const text = "Привет мир #новости こんにちは #東京 🚀 @user https://example.com/路径"

    expect(() => extractTextFeatures(text)).not.toThrow()
    expect(preprocessMetadata({ text }).textFeatures).toEqual({
      hashtagCount: 2,
      mentionCount: 1,
      urlCount: 1,
    })
  })
})
