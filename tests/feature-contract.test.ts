import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { METADATA_V2_FEATURE_ORDER, normalizePostText, parseTimeInput, preprocessMetadata, type MetadataPreprocessInput } from "../src/contracts"

interface ContractCase {
  readonly name: string
  readonly input: MetadataPreprocessInput & { readonly text: string }
  readonly normalizedText: string
  readonly vector: readonly number[]
}

// Written by virality/scripts/train_multitask_teacher_model.py --write-contract-fixture,
// from the same functions that built the training table.
const fixture = JSON.parse(readFileSync(new URL("../fixtures/feature-contract-v2.json", import.meta.url), "utf8")) as {
  readonly contract: number
  readonly features: readonly string[]
  readonly referenceTime: string
  readonly cases: readonly ContractCase[]
}

describe("feature contract v2 matches the Python trainer", () => {
  it("uses the trainer's feature order", () => {
    expect(fixture.contract).toBe(2)
    expect([...METADATA_V2_FEATURE_ORDER]).toEqual(fixture.features)
  })

  for (const contractCase of fixture.cases) {
    it(contractCase.name, () => {
      const result = preprocessMetadata(contractCase.input, new Date(fixture.referenceTime))
      expect(result.normalizedText).toBe(contractCase.normalizedText)
      expect(result.vector).toHaveLength(contractCase.vector.length)
      result.vector.forEach((value, index) => {
        expect(value, METADATA_V2_FEATURE_ORDER[index]).toBeCloseTo(contractCase.vector[index]!, 9)
      })
    })
  }

  it("treats a missing author as unknown, not as zero followers", () => {
    const missing = preprocessMetadata({ text: "hello" }).features
    const empty = preprocessMetadata({ text: "hello", authorFollowers: 0 }).features
    expect(missing.author_known).toBe(0)
    expect(empty.author_known).toBe(1)
  })

  it("reads time in UTC with Monday as weekday 0", () => {
    const monday = preprocessMetadata({ text: "x", createdAt: "2026-09-21T00:00:00+02:00" }).features
    // 22:00 UTC on Sunday.
    expect(monday.weekday_sin).toBeCloseTo(Math.sin((2 * Math.PI * 6) / 7), 9)
    expect(monday.hour_sin).toBeCloseTo(Math.sin((2 * Math.PI * 22) / 24), 9)
  })

  it("parses X's legacy timestamp format", () => {
    expect(parseTimeInput("Sun Apr 03 23:48:02 +0000 2022")?.toISOString()).toBe("2022-04-03T23:48:02.000Z")
    expect(parseTimeInput("Sun Apr 03 23:48:02 +0200 2022")?.toISOString()).toBe("2022-04-03T21:48:02.000Z")
  })

  it("keeps a placeholder already produced by page extraction", () => {
    expect(normalizePostText("read this  [link]  now")).toBe("read this [link] now")
  })
})
