import { describe, expect, it } from "vitest"
import {
  extractXAuthorStatsFromGraphql,
  extractXTweetFactsFromGraphql,
  extractXViewerFromGraphql,
  extractXViewerFromInitialState,
  applyTweetFacts,
  mergeAuthorMetadata,
  mergeTweetFacts,
} from "../src/x-author-metadata"

describe("x author metadata extraction", () => {
  it("extracts author stats from loaded HomeTimeline-style user results", () => {
    const payload = {
      data: {
        home: {
          home_timeline_urt: {
            instructions: [{
              entries: [{
                content: {
                  itemContent: {
                    tweet_results: {
                      result: {
                        core: {
                          user_results: {
                            result: {
                              core: { screen_name: "LinusEkenstam" },
                              is_blue_verified: true,
                              legacy: {
                                followers_count: 245000,
                                friends_count: 1234,
                                statuses_count: 9876,
                                verified: false,
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              }],
            }],
          },
        },
      },
    }

    expect(extractXAuthorStatsFromGraphql(payload)).toEqual([{
      authorHandle: "LinusEkenstam",
      authorFollowers: 245000,
      authorFollowing: 1234,
      authorTweets: 9876,
      authorVerified: true,
      authorVerifiedType: null,
      authorCreatedAt: null,
      authorFavourites: null,
      authorMetadataSource: "loaded-x-response",
    }])
  })

  it("deduplicates by handle and ignores objects without count signals", () => {
    const payload = {
      users: [
        { core: { screen_name: "NoCounts" }, legacy: {} },
        { core: { screen_name: "boar" }, legacy: { followers_count: 10, friends_count: 2, statuses_count: 3, verified: false }, is_blue_verified: false },
        { core: { screen_name: "boar" }, legacy: { followers_count: 11, friends_count: 2, statuses_count: 3, verified: false }, is_blue_verified: false },
      ],
    }

    expect(extractXAuthorStatsFromGraphql(payload)).toEqual([{
      authorHandle: "boar",
      authorFollowers: 11,
      authorFollowing: 2,
      authorTweets: 3,
      authorVerified: false,
      authorVerifiedType: null,
      authorCreatedAt: null,
      authorFavourites: null,
      authorMetadataSource: "loaded-x-response",
    }])
  })
})

describe("x tweet facts extraction", () => {
  it("reads media types, quote status, time and card from loaded tweet results", () => {
    const payload = {
      data: { home: { instructions: [{ entries: [{ content: { itemContent: { tweet_results: { result: {
        __typename: "TweetWithVisibilityResults",
        tweet: {
          rest_id: "2101070651281047607",
          core: { user_results: { result: { core: { screen_name: "boar", created_at: "Sun Apr 03 23:48:02 +0000 2022" }, legacy: { followers_count: 10, favourites_count: 99, verified_type: "Business" } } } },
          legacy: {
            created_at: "Fri Sep 18 22:07:33 +0000 2026",
            full_text: "look https://t.co/x",
            display_text_range: [0, 4],
            is_quote_status: true,
            extended_entities: { media: [{ type: "photo", url: "https://t.co/x" }, { type: "video", url: "https://t.co/x" }] },
          },
          card: { rest_id: "card" },
        },
      } } } } }] }] } },
    }

    expect(extractXTweetFactsFromGraphql(payload)).toEqual([{
      tweetId: "2101070651281047607",
      authorHandle: "boar",
      createdAt: "Fri Sep 18 22:07:33 +0000 2026",
      isQuote: true,
      mediaTypes: ["photo", "video"],
      hasCard: true,
      text: "look",
      textIsFullNote: false,
    }])
    expect(extractXAuthorStatsFromGraphql(payload)[0]).toMatchObject({
      authorHandle: "boar",
      authorCreatedAt: "Sun Apr 03 23:48:02 +0000 2022",
      authorFavourites: 99,
      authorVerifiedType: "Business",
    })
  })
})

describe("x tweet facts text: the post as x.com shows it, whole", () => {
  const tweet = (legacy: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    rest_id: "1",
    core: { user_results: { result: { core: { screen_name: "boar" }, legacy: { followers_count: 1 } } } },
    legacy: { created_at: "Fri Sep 18 22:07:33 +0000 2026", entities: { urls: [] }, ...legacy },
    ...extra,
  })
  const textOf = (result: unknown) => extractXTweetFactsFromGraphql({ data: { tweet_results: { result } } })[0]?.text

  it("keeps a trailing card link X hides from the body, with the line break before it", () => {
    const fullText = "A list:\n\nhttps://t.co/card"
    expect(textOf(tweet(
      { full_text: fullText, display_text_range: [0, 7], entities: { urls: [{ url: "https://t.co/card", expanded_url: "https://example.com", indices: [9, 26] }] } },
      { card: { legacy: { url: "https://t.co/card", binding_values: [{ key: "card_url", value: { string_value: "https://t.co/card" } }] } } },
    ))).toBe("A list:\n\nhttps://link")
  })

  it("drops reply mentions and media links, and counts characters unescaped", () => {
    const fullText = "@alice @bob Tom &amp; Jerry https://t.co/media"
    expect(textOf(tweet({
      full_text: fullText,
      display_text_range: [12, 23],
      extended_entities: { media: [{ type: "photo", url: "https://t.co/media" }] },
    }))).toBe("Tom & Jerry")
  })

  it("drops a pasted post link X turned into the quote", () => {
    const fullText = "This one https://t.co/quote"
    expect(textOf(tweet(
      { full_text: fullText, is_quote_status: true, quoted_status_id_str: "99", entities: { urls: [{ url: "https://t.co/quote", expanded_url: "https://x.com/them/status/99", indices: [9, 27] }] } },
    ))).toBe("This one")
  })

  it("prefers a long post's full note over the timeline preview", () => {
    expect(textOf(tweet(
      { full_text: "@alice Start of a long…", display_text_range: [7, 23] },
      { note_tweet: { note_tweet_results: { result: { text: "@alice Start of a long post that goes on https://t.co/link" } } } },
    ))).toBe("Start of a long post that goes on https://link")
  })

  it("drops a pasted post link X turned into the quote from a long post's note", () => {
    const note = `${"A long post. ".repeat(30).trim()} https://t.co/quote`
    const preview = `${note.slice(0, 270)}… https://t.co/note`
    const facts = extractXTweetFactsFromGraphql({ data: { tweet_results: { result: tweet(
      {
        full_text: preview,
        is_quote_status: true,
        quoted_status_id_str: "99",
        display_text_range: [0, 271],
        // The preview's own entities: only the link to the whole note, never the quote link near the end.
        entities: { urls: [{ url: "https://t.co/note", expanded_url: "https://x.com/i/web/status/1", indices: [272, 289] }] },
      },
      { note_tweet: { note_tweet_results: { result: {
        text: note,
        entity_set: { urls: [{ url: "https://t.co/quote", expanded_url: "https://x.com/them/status/99", indices: [note.length - 18, note.length] }] },
      } } } },
    ) } } })[0]
    expect(facts).toMatchObject({ isQuote: true, textIsFullNote: true })
    expect(facts?.text).toBe("A long post. ".repeat(30).trim())
  })

  it("keeps a timeline preview cut short unless the whole note came with the response", () => {
    const facts = (withNote: boolean) => extractXTweetFactsFromGraphql({ data: { tweet_results: { result: tweet(
      { full_text: "Start of a long…" },
      withNote ? { note_tweet: { note_tweet_results: { result: { text: "Start of a long post, whole" } } } } : {},
    ) } } })[0]
    const event = {
      root: {} as Element,
      text: "Start of a long",
      key: "Start of a long",
      previousKey: null,
      changed: false,
      tweetId: "1",
      hasMedia: false,
      textTruncated: true,
      authorMetadata: { authorHandle: null, authorFollowers: null, authorFollowing: null, authorTweets: null, authorVerified: null, authorMetadataSource: "defaulted" as const },
    }
    expect(applyTweetFacts(event, facts(true))).toMatchObject({ text: "Start of a long post, whole", textTruncated: false })
    expect(applyTweetFacts(event, facts(false)).textTruncated).toBe(true)
  })

  it("keeps a long post's whole note when a later reading carries only the preview", () => {
    const whole = tweet({ full_text: "Start of a long…" }, { note_tweet: { note_tweet_results: { result: { text: "Start of a long post, whole" } } } })
    const preview = tweet({ full_text: "Start of a long…", extended_entities: { media: [{ type: "photo", url: "https://t.co/p" }] } })
    const factsOf = (result: unknown) => extractXTweetFactsFromGraphql({ data: { tweet_results: { result } } })[0]!

    // The same post twice in one response, the note first.
    expect(extractXTweetFactsFromGraphql({ data: { a: { result: whole }, b: { result: preview } } })).toEqual([
      expect.objectContaining({ text: "Start of a long post, whole", textIsFullNote: true, mediaTypes: ["photo"] }),
    ])
    // Across responses: the later reading's other facts, the note's text.
    expect(mergeTweetFacts(factsOf(whole), factsOf(preview))).toMatchObject({ text: "Start of a long post, whole", textIsFullNote: true, mediaTypes: ["photo"] })
    expect(mergeTweetFacts(factsOf(preview), factsOf(whole))).toEqual(factsOf(whole))
    expect(mergeTweetFacts(factsOf(preview), { ...factsOf(preview), text: null })).toMatchObject({ text: "Start of a long…", textIsFullNote: false })
    expect(mergeTweetFacts(undefined, factsOf(preview))).toEqual(factsOf(preview))
  })
})

describe("the signed-in account from X's own data", () => {
  it("reads the page bootstrap's session user", () => {
    const state = {
      session: { user_id: "42" },
      entities: { users: { entities: { 42: { screen_name: "ada", followers_count: 812, friends_count: 3, statuses_count: 9, favourites_count: 7, created_at: "Sun Apr 03 23:48:02 +0000 2022", is_blue_verified: true, verified_type: "Business" } } } },
    }
    expect(extractXViewerFromInitialState(state)).toEqual({
      authorHandle: "ada",
      authorFollowers: 812,
      authorFollowing: 3,
      authorTweets: 9,
      authorVerified: true,
      authorVerifiedType: "Business",
      authorCreatedAt: "Sun Apr 03 23:48:02 +0000 2022",
      authorFavourites: 7,
      authorMetadataSource: "loaded-x-response",
    })
    expect(extractXViewerFromInitialState({ session: {} })).toBeNull()
  })

  it("reads the Viewer query and the author of a just-created post", () => {
    const user = { core: { screen_name: "ada", created_at: "Sun Apr 03 23:48:02 +0000 2022" }, legacy: { followers_count: 813 } }
    expect(extractXViewerFromGraphql({ data: { viewer: { user_results: { result: user } } } })?.authorFollowers).toBe(813)
    expect(extractXViewerFromGraphql({ data: { create_tweet: { tweet_results: { result: { rest_id: "1", core: { user_results: { result: user } } } } } } })?.authorHandle).toBe("ada")
    expect(extractXViewerFromGraphql({ data: { home: {} } })).toBeNull()
  })

  it("merges loaded stats over what the page shows, field by field", () => {
    const cached = { authorHandle: "Ada", authorFollowers: 813, authorFollowing: null, authorTweets: 9, authorVerified: true, authorMetadataSource: "loaded-x-response" as const }
    const dom = { authorHandle: "ada", authorFollowers: 800, authorFollowing: 300, authorTweets: null, authorVerified: false, authorCreatedAt: "Sun Apr 03 23:48:02 +0000 2022", authorMetadataSource: "same-page-dom" as const }
    expect(mergeAuthorMetadata("ada", cached, dom)).toEqual({
      authorHandle: "Ada",
      authorFollowers: 813,
      authorFollowing: 300,
      authorTweets: 9,
      authorVerified: true,
      authorVerifiedType: null,
      authorCreatedAt: "Sun Apr 03 23:48:02 +0000 2022",
      authorFavourites: null,
      authorMetadataSource: "loaded-x-response",
    })
    expect(mergeAuthorMetadata("ada", undefined, dom).authorMetadataSource).toBe("same-page-dom")
    expect(mergeAuthorMetadata("ada", undefined, null).authorMetadataSource).toBe("defaulted")
  })
})
