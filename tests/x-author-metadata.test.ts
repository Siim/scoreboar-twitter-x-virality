import { describe, expect, it } from "vitest"
import { extractXAuthorStatsFromGraphql } from "../src/x-author-metadata"

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
