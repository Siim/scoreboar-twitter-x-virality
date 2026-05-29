import { describe, expect, it } from "vitest"
import { extractXAuthorStatsFromGraphql, extractXTweetTextsFromGraphql } from "../src/x-author-metadata"

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
      authorMetadataSource: "loaded-x-response",
    }])
  })
})

describe("X tweet text extraction", () => {
  it("extracts the longest loaded tweet text from GraphQL results", () => {
    const payload = {
      data: {
        tweet_results: {
          result: {
            rest_id: "2060333451543290334",
            legacy: {
              id_str: "2060333451543290334",
              full_text: "truncated visible text",
            },
            note_tweet: {
              note_tweet_results: {
                result: {
                  text: "truncated visible text with the full ending own life easier?",
                },
              },
            },
          },
        },
      },
    }

    expect(extractXTweetTextsFromGraphql(payload)).toEqual([
      {
        tweetId: "2060333451543290334",
        text: "truncated visible text with the full ending own life easier?",
        textSource: "loaded-x-response",
      },
    ])
  })

  it("extracts text from wrapped TweetWithVisibilityResults-style nodes", () => {
    const payload = {
      data: {
        tweetResult: {
          result: {
            __typename: "TweetWithVisibilityResults",
            tweet: {
              rest_id: "12345",
              legacy: {
                id_str: "12345",
                full_text: "wrapped standard tweet full text",
              },
            },
          },
        },
      },
    }

    expect(extractXTweetTextsFromGraphql(payload)).toEqual([
      {
        tweetId: "12345",
        text: "wrapped standard tweet full text",
        textSource: "loaded-x-response",
      },
    ])
  })
})
