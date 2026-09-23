import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import {
  METADATA_V2_FEATURE_ORDER,
  createComposerHintController,
  createFeedBadgeController,
  createScoreboarDomDetector,
  enrichTweetEvent,
  extractXAuthorStatsFromGraphql,
  extractXTweetFactsFromGraphql,
  preprocessMetadata,
  readViewerAuthorMetadata,
  type ComposerFoundEvent,
  type ScoreTextResult,
  type TweetFoundEvent,
  type XAuthorStats,
  type XTweetFacts,
} from "../src/index"

// A draft and the post it becomes must reach the model as the same input. Each
// case below renders the draft the way x.com's composer holds it and the
// published post the way x.com's timeline shows it, runs both through the
// extension's own reading and request building, and compares what the model
// would see. Only the clock differs: a draft is scored before it is posted.

const TIME_FEATURES = new Set(["hour_sin", "hour_cos", "weekday_sin", "weekday_cos"])
const POSTED_AT = "2026-09-23T12:10:00.000Z"
const DRAFTED_AT = new Date("2026-09-23T12:08:00.000Z")
const VIEWER = "ada_builds"
const POST_ID = "1839000000000000001"

const INITIAL_STATE = JSON.stringify({
  optimist: [],
  // settings.screen_name comes before the user entity, and another user sits next to it.
  settings: { local: {}, remote: { settings: { screen_name: VIEWER, language: "en" } } },
  session: { user_id: "42", country: "EE" },
  entities: {
    users: {
      entities: {
        7: { id_str: "7", screen_name: "someone", followers_count: 99999, created_at: "Mon Jan 01 00:00:00 +0000 2010", favourites_count: 5 },
        42: {
          id_str: "42",
          name: "Ada | building @x11social",
          screen_name: VIEWER,
          followers_count: 812,
          friends_count: 301,
          statuses_count: 4120,
          favourites_count: 9800,
          created_at: "Sun Apr 03 23:48:02 +0000 2022",
          verified: false,
          is_blue_verified: true,
          description: "ships {things} daily",
        },
      },
    },
  },
})

const pageChrome = `
  <header role="banner"><nav>
    <a data-testid="AppTabBar_Profile_Link" href="/${VIEWER}">Profile</a>
    <button data-testid="SideNav_AccountSwitcher_Button">
      <div data-testid="UserAvatar-Container-${VIEWER}"><img src="https://pbs.twimg.com/profile_images/1/a.jpg"></div>
      <span>Ada | building @x11social</span><span>@${VIEWER}</span>
    </button>
  </nav></header>`
const bootstrap = `<script>window.__INITIAL_STATE__=${INITIAL_STATE};window.__META_DATA__={"env":"prod"};</script>`

const escapeHtml = (value: string) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;")

/** Draft.js: one [data-block] per line, an empty line holds a <br>. */
const draftBlocks = (draft: string) => draft.split("\n").map((line, index) => {
  const inner = line
    ? `<span data-offset-key="k${index}-0-0"><span data-text="true">${escapeHtml(line)}</span></span>`
    : `<span data-offset-key="k${index}-0-0"><br data-text="true"></span>`
  return `<div data-block="true" data-editor="ed" data-offset-key="k${index}-0-0"><div class="public-DraftStyleDefault-block" data-offset-key="k${index}-0-0">${inner}</div></div>`
}).join("")

const editor = (draft: string) => `
  <div data-testid="tweetTextarea_0_label"><div class="DraftEditor-root"><div class="DraftEditor-editorContainer">
    <div data-testid="tweetTextarea_0" role="textbox" contenteditable="true" class="public-DraftEditor-content"><div data-contents="true">${draftBlocks(draft)}</div></div>
  </div></div></div>`
const toolbar = `<div><div data-testid="toolBar"><nav role="navigation"><input data-testid="fileInput" type="file"><button data-testid="createPollButton">Poll</button></nav><button data-testid="tweetButtonInline">Post</button></div></div>`
const timelinePostWithPhoto = `
  <article data-testid="tweet"><div data-testid="UserAvatar-Container-someone"></div>
    <div data-testid="User-Name"><a href="/someone">Someone</a><a href="/someone/status/5"><time datetime="2026-09-22T10:00:00.000Z">1d</time></a></div>
    <div data-testid="tweetText">Timeline post</div><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/t.jpg"></div></article>`

const quotedPostPreview = `
  <div role="link" tabindex="0">
    <div data-testid="UserAvatar-Container-someone"></div>
    <div data-testid="User-Name"><span>Someone</span><span>@someone</span><time datetime="2026-09-20T10:00:00.000Z">Sep 20</time></div>
    <div data-testid="tweetText">The chart everyone is sharing</div>
    <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/q.jpg"></div>
  </div>`

interface ComposerExtras {
  readonly attachments?: string
  readonly quoted?: string
  readonly poll?: string
}

/** The Home composer: the viewer's avatar, the editor, then attachments or a quote preview, then the toolbar; the timeline below. */
const composerPage = (draft: string, extras: ComposerExtras = {}) => `<!doctype html><body>${pageChrome}
  <main role="main"><div data-testid="primaryColumn">
    <div class="composer-row"><div data-testid="UserAvatar-Container-${VIEWER}"></div><div class="composer-col">
      ${editor(draft)}${extras.attachments ?? ""}${extras.quoted ?? ""}${extras.poll ?? ""}${toolbar}
    </div></div>
    <section aria-label="Timeline">${timelinePostWithPhoto}</section>
  </div></main>${bootstrap}</body>`

/** The reply dialog: the post being replied to above the editor. */
const replyDialogPage = (draft: string) => `<!doctype html><body>${pageChrome}<main role="main"></main>
  <div id="layers"><div role="dialog" aria-modal="true">
    ${timelinePostWithPhoto}
    <div class="composer-row"><div data-testid="UserAvatar-Container-${VIEWER}"></div><div class="composer-col">${editor(draft)}</div></div>
    ${toolbar}
  </div></div>${bootstrap}</body>`

interface PostExtras {
  readonly media?: string
  readonly card?: string
  readonly quoted?: string
  readonly replyingTo?: string
}

/** The published post as the timeline renders it. */
const postPage = (tweetTextHtml: string, extras: PostExtras = {}) => `<!doctype html><body>${pageChrome}<main role="main"><section>
  <article data-testid="tweet" tabindex="0">
    <div data-testid="Tweet-User-Avatar"><div data-testid="UserAvatar-Container-${VIEWER}"><a href="/${VIEWER}"></a></div></div>
    <div data-testid="User-Name">
      <a href="/${VIEWER}"><span>Ada | building @x11social</span><svg aria-label="Verified account" data-testid="icon-verified"></svg></a>
      <a href="/${VIEWER}"><span>@${VIEWER}</span></a>
      <a href="/${VIEWER}/status/${POST_ID}"><time datetime="${POSTED_AT}">1m</time></a>
    </div>
    ${extras.replyingTo ? `<div>Replying to <a href="/${extras.replyingTo}">@${extras.replyingTo}</a></div>` : ""}
    ${tweetTextHtml ? `<div data-testid="tweetText" lang="en">${tweetTextHtml}</div>` : ""}
    ${extras.media ?? ""}${extras.card ?? ""}${extras.quoted ?? ""}
    <div role="group"><button data-testid="reply"></button><button data-testid="like"></button></div>
  </article>
</section></main>${bootstrap}</body>`

const tcoLink = (id: string, display: string) => `<a href="https://t.co/${id}" rel="noopener noreferrer nofollow" target="_blank" role="link"><span aria-hidden="true" style="display:none">https://</span>${display}</a>`
const linkCard = (id: string) => `<div data-testid="card.wrapper"><div><a href="https://t.co/${id}" role="link"><img src="https://pbs.twimg.com/card_img/1/c.jpg" alt=""></a></div><a href="https://t.co/${id}" role="link"><span>From example.com</span></a></div>`
const pollCard = `<div data-testid="card.wrapper"><div data-testid="cardPoll"><div>Yes</div><div>No</div><span>12 votes</span></div></div>`

const scored = (): ScoreTextResult => ({
  status: "scored",
  label: "scored",
  confidence: 0.5,
  probabilities: { very_low: 0.2, low: 0.2, medium: 0.2, high: 0.2, very_high: 0.2 },
  numericScores: {},
  booleanScores: {},
  message: "parity fixture",
  model: { provider: "local-onnx", path: "extension/assets/model/scoreboar-v8.onnx", version: "v8", available: true },
  metadataVector: [],
})

const flush = async () => {
  for (let index = 0; index < 6; index += 1) await new Promise<void>((resolve) => queueMicrotask(resolve))
}

interface ModelInput {
  readonly text: string
  readonly metadata: Record<string, unknown>
}

/** The composer path, end to end: detector event, viewer lookup, request building, the scorer call. */
const scoreDraft = async (html: string, statsByHandle: ReadonlyMap<string, XAuthorStats> = new Map()): Promise<ModelInput & { readonly event: ComposerFoundEvent }> => {
  const dom = new JSDOM(html, { url: "https://x.com/home" })
  const document = dom.window.document
  const seen: ModelInput[] = []
  const events: ComposerFoundEvent[] = []
  const controller = createComposerHintController({
    document,
    debounceMs: 0,
    scheduler: (callback) => {
      callback()
      return undefined
    },
    now: () => DRAFTED_AT,
    viewerMetadata: () => readViewerAuthorMetadata(document, null, statsByHandle),
    scorer: {
      scoreComposer: async (text, metadata) => {
        seen.push({ text, metadata })
        return scored()
      },
    },
  })
  createScoreboarDomDetector({
    root: document,
    onComposerFound: (event) => {
      events.push(event)
      controller.renderComposerHints(event)
    },
  }).scan()
  await flush()
  expect(seen).toHaveLength(1)
  return { ...seen[0]!, event: events[0]! }
}

/** The feed path, end to end: detector event, X's facts and author stats merged, request building, the scorer call. */
const scorePost = async (
  html: string,
  factsById: ReadonlyMap<string, XTweetFacts> = new Map(),
  statsByHandle: ReadonlyMap<string, XAuthorStats> = new Map(),
): Promise<ModelInput> => {
  const dom = new JSDOM(html, { url: `https://x.com/${VIEWER}/status/${POST_ID}` })
  const document = dom.window.document
  const seen: ModelInput[] = []
  const controller = createFeedBadgeController({
    document,
    scorer: {
      scoreTweet: async (text, metadata) => {
        seen.push({ text, metadata })
        return scored()
      },
    },
  })
  const rendered: Promise<void>[] = []
  createScoreboarDomDetector({
    root: document,
    onTweetFound: (event: TweetFoundEvent) => {
      rendered.push(controller.renderTweetBadge(enrichTweetEvent(event, factsById, statsByHandle)))
    },
  }).scan()
  await Promise.all(rendered)
  expect(seen).toHaveLength(1)
  return seen[0]!
}

const modelView = ({ text, metadata }: ModelInput) => {
  const { normalizedText, features } = preprocessMetadata({ ...metadata, text })
  const nonTime = Object.fromEntries(METADATA_V2_FEATURE_ORDER.filter((name) => !TIME_FEATURES.has(name)).map((name) => [name, features[name]]))
  return { normalizedText, features: nonTime }
}

const expectSameModelInput = (draft: ModelInput, post: ModelInput) => {
  expect(modelView(draft)).toEqual(modelView(post))
}

/** A CreateTweet response for the published post, as the page listener captures it. */
const createTweetPayload = (legacy: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  data: {
    create_tweet: {
      tweet_results: {
        result: {
          __typename: "Tweet",
          rest_id: POST_ID,
          core: {
            user_results: {
              result: {
                __typename: "User",
                rest_id: "42",
                core: { screen_name: VIEWER, name: "Ada | building @x11social", created_at: "Sun Apr 03 23:48:02 +0000 2022" },
                is_blue_verified: true,
                legacy: { followers_count: 813, friends_count: 301, statuses_count: 4121, favourites_count: 9801, verified: false },
              },
            },
          },
          legacy: { created_at: "Wed Sep 23 12:10:00 +0000 2026", is_quote_status: false, entities: { urls: [] }, ...legacy },
          ...extra,
        },
      },
    },
  },
})

const capture = (payload: unknown) => ({
  facts: new Map(extractXTweetFactsFromGraphql(payload).map((facts) => [facts.tweetId, facts] as const)),
  stats: new Map(extractXAuthorStatsFromGraphql(payload).map((stats) => [stats.authorHandle.toLowerCase(), stats] as const)),
})

const codePoints = (text: string, needle: string) => Array.from(text.slice(0, text.indexOf(needle))).length

describe("a draft is scored with the inputs its published post will have", () => {
  it("plain multi-line text with an emoji, author read from the page bootstrap", async () => {
    const draft = await scoreDraft(composerPage("Shipping the composer fix today 🚀\n\nIt reads drafts the way X posts them."))
    const post = await scorePost(postPage(`Shipping the composer fix today <img alt="🚀" src="https://abs-0.twimg.com/emoji/v2/svg/1f680.svg">\n\nIt reads drafts the way X posts them.`))
    expectSameModelInput(draft, post)
    // The timeline photo under the Home composer is not the draft's.
    expect(draft.metadata).toMatchObject({ hasMedia: false, hasPhoto: false, hasVideo: false, isQuote: false, hasCard: false })
    expect(draft.metadata).toMatchObject({ authorFollowers: 812, authorCreatedAt: "Sun Apr 03 23:48:02 +0000 2022", authorFavourites: 9800, authorVerified: true })
    expect(modelView(draft).features).toMatchObject({ author_known: 1, author_details_known: 1, line_breaks: 0.1 })
  })

  it("an attached photo", async () => {
    const attachments = `<div data-testid="attachments"><div role="group"><div style="background-image:url(blob:https://x.com/p1)"></div><img alt="" src="blob:https://x.com/p1"><button aria-label="Remove media"></button></div></div>`
    const draft = await scoreDraft(composerPage("New office, who dis", { attachments }))
    const post = await scorePost(postPage("New office, who dis", { media: `<div data-testid="tweetPhoto"><img alt="Image" src="https://pbs.twimg.com/media/o.jpg"></div>` }))
    expectSameModelInput(draft, post)
    expect(modelView(draft).features).toMatchObject({ has_media: 1, has_photo: 1, has_video: 0 })
  })

  it("an attached video", async () => {
    const attachments = `<div data-testid="attachments"><div role="group"><video src="blob:https://x.com/v1" poster="blob:https://x.com/v1p"></video></div></div>`
    const draft = await scoreDraft(composerPage("30 seconds of the new editor", { attachments }))
    const post = await scorePost(postPage("30 seconds of the new editor", { media: `<div data-testid="tweetPhoto"><div data-testid="videoPlayer"><video poster="https://pbs.twimg.com/ext_tw_video_thumb/1/v.jpg"></video></div></div>` }))
    expectSameModelInput(draft, post)
    expect(modelView(draft).features).toMatchObject({ has_media: 1, has_photo: 0, has_video: 1 })
  })

  it("quote-composing: the quoted post and its photo belong to the quoted post", async () => {
    const draft = await scoreDraft(composerPage("This is the chart that matters", { quoted: quotedPostPreview }))
    const post = await scorePost(postPage("This is the chart that matters", { quoted: quotedPostPreview }))
    expectSameModelInput(draft, post)
    expect(modelView(draft).features).toMatchObject({ is_quote: 1, has_media: 0, has_link: 0 })
  })

  it("quote-composing with the quoted post inside the attachments strip, its photo in a strip of its own", async () => {
    const quotedWithStrip = `
      <div role="link" tabindex="0">
        <div data-testid="User-Name"><span>Someone</span><span>@someone</span></div>
        <div data-testid="tweetText">The chart everyone is sharing</div>
        <div data-testid="attachments"><div role="group"><img src="https://pbs.twimg.com/media/q.jpg"></div></div>
      </div>`
    const draft = await scoreDraft(composerPage("This is the chart that matters", { attachments: `<div data-testid="attachments">${quotedWithStrip}</div>` }))
    const post = await scorePost(postPage("This is the chart that matters", { quoted: quotedPostPreview }))
    expectSameModelInput(draft, post)
    expect(modelView(draft).features).toMatchObject({ is_quote: 1, has_media: 0, has_photo: 0, has_link: 0 })
  })

  it("quote-composing with a photo of the draft's own in the same strip wrapper as the quote preview", async () => {
    // The preview here is a plain block, not X's post link: its extent comes from what the draft itself holds.
    const plainPreview = `
      <div class="quote-preview">
        <div data-testid="User-Name"><span>Someone</span><span>@someone</span></div>
        <div data-testid="tweetText">The chart everyone is sharing</div>
        <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/q.jpg"></div>
      </div>`
    const attachments = `<div data-testid="attachments"><div><div role="group"><img alt="" src="blob:https://x.com/p3"></div>${plainPreview}</div></div>`
    const draft = await scoreDraft(composerPage("Our numbers next to theirs", { attachments }))
    const post = await scorePost(postPage("Our numbers next to theirs", {
      media: `<div data-testid="tweetPhoto"><img alt="Image" src="https://pbs.twimg.com/media/own.jpg"></div>`,
      quoted: quotedPostPreview,
    }))
    expectSameModelInput(draft, post)
    expect(modelView(draft).features).toMatchObject({ is_quote: 1, has_media: 1, has_photo: 1, has_video: 0 })
  })

  it("a pasted post link at the end becomes the quote and leaves the text", async () => {
    const draft = await scoreDraft(composerPage("This is the thread to read https://x.com/someone/status/1838123456789012345?s=46&t=abc"))
    const post = await scorePost(postPage("This is the thread to read", { quoted: quotedPostPreview }))
    expectSameModelInput(draft, post)
    expect(draft.event.isQuote).toBe(true)
    expect(modelView(draft)).toMatchObject({ normalizedText: "This is the thread to read", features: { is_quote: 1, has_link: 0 } })
  })

  it("a link that becomes a card: X hides the trailing URL from the post body", async () => {
    const draft = await scoreDraft(composerPage("Read the write-up https://example.com/posts/composer-parity"))
    const post = await scorePost(postPage("Read the write-up", { card: linkCard("card123") }))
    expectSameModelInput(draft, post)
    expect(modelView(post)).toMatchObject({ normalizedText: "Read the write-up [link]", features: { has_link: 1 } })
  })

  it("a link card on its own line, once X's response for the post has arrived", async () => {
    const draftText = "Read the write-up\n\nhttps://example.com/posts/composer-parity"
    const fullText = "Read the write-up\n\nhttps://t.co/card123"
    const { facts, stats } = capture(createTweetPayload(
      {
        full_text: fullText,
        display_text_range: [0, 17],
        entities: { urls: [{ url: "https://t.co/card123", expanded_url: "https://example.com/posts/composer-parity", indices: [codePoints(fullText, "https://t.co"), fullText.length] }] },
      },
      { card: { rest_id: "card://1", legacy: { name: "summary_large_image", url: "https://t.co/card123", binding_values: [{ key: "card_url", value: { string_value: "https://t.co/card123", type: "STRING" } }] } } },
    ))
    const draft = await scoreDraft(composerPage(draftText), stats)
    const post = await scorePost(postPage("Read the write-up", { card: linkCard("card123") }), facts, stats)
    expectSameModelInput(draft, post)
    expect(modelView(post).normalizedText).toBe("Read the write-up\n\n[link]")
    // Both read the author from CreateTweet's user object now, not the older page bootstrap.
    expect(draft.metadata).toMatchObject({ authorFollowers: 813, authorFavourites: 9801 })
    expect(post.metadata).toMatchObject({ authorFollowers: 813, authorFavourites: 9801 })
  })

  it("a photo post once X's response has arrived: the media link is not text", async () => {
    const attachments = `<div data-testid="attachments"><div role="group"><img alt="" src="blob:https://x.com/p2"></div></div>`
    const fullText = "Shipping it &amp; sleeping https://t.co/media1"
    const { facts, stats } = capture(createTweetPayload({
      full_text: fullText,
      display_text_range: [0, 22],
      extended_entities: { media: [{ type: "photo", url: "https://t.co/media1" }] },
    }))
    const draft = await scoreDraft(composerPage("Shipping it & sleeping", { attachments }), stats)
    const post = await scorePost(postPage("Shipping it &amp; sleeping", { media: `<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/s.jpg"></div>` }), facts, stats)
    expectSameModelInput(draft, post)
    expect(modelView(post).normalizedText).toBe("Shipping it & sleeping")
  })

  it("a bare domain X links when it posts", async () => {
    const draft = await scoreDraft(composerPage("Built this over the weekend: x11.social\nTell me what you think"))
    const post = await scorePost(postPage(`Built this over the weekend: ${tcoLink("dom1", "x11.social")}\nTell me what you think`))
    expectSameModelInput(draft, post)
    expect(modelView(draft).features.has_link).toBe(1)
  })

  it("a link inside brackets followed by punctuation", async () => {
    const draft = await scoreDraft(composerPage("More in the docs (https://example.com/docs). Worth it."))
    const post = await scorePost(postPage(`More in the docs (${tcoLink("doc1", "example.com/docs")}). Worth it.`))
    expectSameModelInput(draft, post)
    expect(modelView(post).normalizedText).toBe("More in the docs ([link] Worth it.")
  })

  it("a reply's leading mention joins X's Replying-to line", async () => {
    const draft = await scoreDraft(replyDialogPage("@grok is this true?"))
    const post = await scorePost(postPage("is this true?", { replyingTo: "someone" }))
    expectSameModelInput(draft, post)
    expect(modelView(draft).features.mention_count).toBe(0)
  })

  it("a poll is a card on the published post", async () => {
    const poll = `<div class="poll-editor"><input name="Choice1" value="Yes"><input name="Choice2" value="No"><select data-testid="selectPollDays"></select><button data-testid="removePollButton">Remove poll</button></div>`
    const draft = await scoreDraft(composerPage("Tabs or spaces?", { poll }))
    const post = await scorePost(postPage("Tabs or spaces?", { card: pollCard }))
    expectSameModelInput(draft, post)
    expect(modelView(draft)).toMatchObject({ normalizedText: "Tabs or spaces?", features: { has_link: 1 } })
  })

  it("the same author fields on both sides, from the bootstrap and after CreateTweet", async () => {
    const authorFields = (metadata: Record<string, unknown>) => Object.fromEntries(Object.entries(metadata).filter(([key]) => key.startsWith("author") && key !== "authorMetadataSource"))
    const draft = await scoreDraft(composerPage("gm"))
    const post = await scorePost(postPage("gm"))
    expect(authorFields(draft.metadata)).toEqual(authorFields(post.metadata))

    const { facts, stats } = capture(createTweetPayload({ full_text: "gm", display_text_range: [0, 2] }))
    const draftAfter = await scoreDraft(composerPage("gm"), stats)
    const postAfter = await scorePost(postPage("gm"), facts, stats)
    expect(authorFields(draftAfter.metadata)).toEqual(authorFields(postAfter.metadata))
    expect(draftAfter.metadata.authorFollowers).toBe(813)
  })
})
