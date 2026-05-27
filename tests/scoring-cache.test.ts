import { describe, expect, it } from "vitest"
import { createScoringGuardrails, createTextScoringCacheKey } from "../src/scoring-guardrails"

interface CacheFixtureInput {
  readonly text: string
  readonly metadata: Record<string, unknown>
}

describe("scoring cache guardrails", () => {
  it("scores duplicate text/key once and reuses the cached result", async () => {
    const guardrails = createScoringGuardrails<CacheFixtureInput, { readonly score: number }>({
      concurrency: 2,
      keyFor: (input) => createTextScoringCacheKey(input.text, input.metadata),
    })
    const input = {
      text: "Duplicate local scoring text",
      metadata: { source: "tweet", cacheKey: "tweet-fixture-1" },
    }
    const cachedValue = { score: 91 }
    let scoreCalls = 0

    const first = guardrails.score(input, async () => {
      scoreCalls += 1
      return cachedValue
    })
    const duplicate = guardrails.score({ ...input }, async () => {
      scoreCalls += 1
      return { score: 12 }
    })

    await expect(Promise.all([first, duplicate])).resolves.toEqual([cachedValue, cachedValue])
    expect(scoreCalls).toBe(1)

    await expect(guardrails.score(input, async () => {
      scoreCalls += 1
      return { score: 1 }
    })).resolves.toBe(cachedValue)
    expect(scoreCalls).toBe(1)
  })

  it("does not keep failed scorer promises cached", async () => {
    const guardrails = createScoringGuardrails<CacheFixtureInput, { readonly score: number }>({
      keyFor: (input) => createTextScoringCacheKey(input.text, input.metadata),
    })
    const input = {
      text: "Retry local scoring text",
      metadata: { source: "tweet", cacheKey: "tweet-fixture-retry" },
    }
    let calls = 0

    await expect(guardrails.score(input, async () => {
      calls += 1
      throw new Error("first scoring failure")
    })).rejects.toThrow("first scoring failure")

    await expect(guardrails.score(input, async () => {
      calls += 1
      return { score: 77 }
    })).resolves.toEqual({ score: 77 })
    expect(calls).toBe(2)
  })

  it("converts synchronous scorer throws into rejected promises and clears the cache", async () => {
    const guardrails = createScoringGuardrails<CacheFixtureInput, { readonly score: number }>({
      keyFor: (input) => createTextScoringCacheKey(input.text, input.metadata),
    })
    const input = {
      text: "Synchronous failure text",
      metadata: { source: "tweet", cacheKey: "tweet-fixture-sync-failure" },
    }
    let calls = 0

    await expect(guardrails.score(input, () => {
      calls += 1
      throw new Error("sync scoring failure")
    })).rejects.toThrow("sync scoring failure")

    await expect(guardrails.score(input, async () => {
      calls += 1
      return { score: 88 }
    })).resolves.toEqual({ score: 88 })
    expect(calls).toBe(2)
  })

  it("does not create a secondary unhandled rejection when a queued scorer rejects", async () => {
    const guardrails = createScoringGuardrails<CacheFixtureInput, { readonly score: number }>({
      keyFor: (input) => createTextScoringCacheKey(input.text, input.metadata),
    })
    const input = {
      text: "Extension context invalidated text",
      metadata: { source: "tweet", cacheKey: "tweet-fixture-invalidated" },
    }
    const unhandled: unknown[] = []
    const listener = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", listener)

    try {
      await expect(guardrails.score(input, async () => {
        throw new Error("Extension context invalidated.")
      })).rejects.toThrow("Extension context invalidated")
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", listener)
    }
  })
})
