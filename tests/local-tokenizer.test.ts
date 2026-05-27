import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { createByteLevelBpeTokenizer, type ByteLevelBpeTokenizerJson } from "../src/local-tokenizer"

const tokenizerPath = resolve("model/v5-source/tokenizer/tokenizer.json")
const describeIfTokenizer = existsSync(tokenizerPath) ? describe : describe.skip

describeIfTokenizer("local ByteLevel BPE tokenizer", () => {
  const tokenizerJson = JSON.parse(readFileSync(tokenizerPath, "utf8")) as ByteLevelBpeTokenizerJson
  const tokenizer = createByteLevelBpeTokenizer(tokenizerJson)

  it.each([
    {
      text: "hello world",
      inputIds: [50281, 25521, 1533, 50282, 50283, 50283, 50283, 50283],
      attentionMask: [1, 1, 1, 1, 0, 0, 0, 0],
    },
    {
      text: "this is a test",
      inputIds: [50281, 2520, 310, 247, 1071, 50282, 50283, 50283],
      attentionMask: [1, 1, 1, 1, 1, 1, 0, 0],
    },
    {
      text: "Wild result: a simple hook rewrite doubled replies overnight. Here are the before/after notes.",
      inputIds: [50281, 37633, 906, 27, 247, 2969, 10584, 24813],
      attentionMask: [1, 1, 1, 1, 1, 1, 1, 1],
    },
  ])("matches Python AutoTokenizer prefix for %#", ({ text, inputIds, attentionMask }) => {
    const encoded = tokenizer.encode(text, 32)
    expect(encoded.inputIds.slice(0, inputIds.length)).toEqual(inputIds)
    expect(encoded.attentionMask.slice(0, attentionMask.length)).toEqual(attentionMask)
  })
})
