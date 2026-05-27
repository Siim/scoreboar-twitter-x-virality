export interface ByteLevelBpeTokenizerJson {
  readonly model: {
    readonly vocab: Record<string, number>
    readonly merges: readonly (string | readonly [string, string])[]
  }
  readonly post_processor?: {
    readonly special_tokens?: Record<string, { readonly ids: readonly number[] }>
  }
}

export interface EncodedTextInput {
  readonly inputIds: readonly number[]
  readonly attentionMask: readonly number[]
}

export interface ByteLevelBpeTokenizer {
  readonly encode: (text: string, maxLength: number) => EncodedTextInput
}

const TOKEN_PATTERN = /'(?:[sdmt]|ll|ve|re)| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu

const bytesToUnicode = (): readonly string[] => {
  const bytes: number[] = []
  for (let code = 33; code <= 126; code += 1) bytes.push(code)
  for (let code = 161; code <= 172; code += 1) bytes.push(code)
  for (let code = 174; code <= 255; code += 1) bytes.push(code)

  const chars = [...bytes]
  let extra = 0
  for (let code = 0; code <= 255; code += 1) {
    if (!bytes.includes(code)) {
      bytes.push(code)
      chars.push(256 + extra)
      extra += 1
    }
  }

  const byteEncoder: string[] = []
  bytes.forEach((byte, index) => {
    byteEncoder[byte] = String.fromCodePoint(chars[index])
  })
  return byteEncoder
}

const BYTE_ENCODER = bytesToUnicode()

const byteLevelToken = (token: string): string => {
  const bytes = new TextEncoder().encode(token.normalize("NFC"))
  return [...bytes].map((byte) => BYTE_ENCODER[byte]).join("")
}

const mergeRankKey = (left: string, right: string): string => `${left}\u0000${right}`

const parseMerge = (merge: string | readonly [string, string]): readonly [string, string] | null => {
  if (typeof merge !== "string") {
    return merge[0] && merge[1] ? [merge[0], merge[1]] : null
  }

  const [left, right] = merge.split(" ")
  return left && right ? [left, right] : null
}

export const createByteLevelBpeTokenizer = (tokenizerJson: ByteLevelBpeTokenizerJson): ByteLevelBpeTokenizer => {
  const vocab = tokenizerJson.model.vocab
  const ranks = new Map<string, number>()
  tokenizerJson.model.merges.forEach((merge, rank) => {
    const pair = parseMerge(merge)
    if (pair) {
      ranks.set(mergeRankKey(pair[0], pair[1]), rank)
    }
  })
  const cache = new Map<string, readonly string[]>()
  const clsId = tokenizerJson.post_processor?.special_tokens?.["[CLS]"]?.ids[0] ?? vocab["[CLS]"] ?? 50281
  const sepId = tokenizerJson.post_processor?.special_tokens?.["[SEP]"]?.ids[0] ?? vocab["[SEP]"] ?? 50282
  const padId = tokenizerJson.post_processor?.special_tokens?.["[PAD]"]?.ids[0] ?? vocab["[PAD]"] ?? 50283
  const fallbackId = tokenizerJson.post_processor?.special_tokens?.["[UNK]"]?.ids[0] ?? vocab["[UNK]"] ?? padId

  const bpe = (token: string): readonly string[] => {
    const cached = cache.get(token)
    if (cached) return cached

    let word = [...token]
    if (word.length <= 1) {
      cache.set(token, word)
      return word
    }

    while (word.length > 1) {
      let bestIndex = -1
      let bestRank = Number.POSITIVE_INFINITY
      for (let index = 0; index < word.length - 1; index += 1) {
        const rank = ranks.get(mergeRankKey(word[index], word[index + 1]))
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank
          bestIndex = index
        }
      }

      if (bestIndex < 0) break
      word = [
        ...word.slice(0, bestIndex),
        `${word[bestIndex]}${word[bestIndex + 1]}`,
        ...word.slice(bestIndex + 2),
      ]
    }

    cache.set(token, word)
    return word
  }

  return {
    encode: (text, maxLength) => {
      const tokenIds: number[] = [clsId]
      const matches = text.match(TOKEN_PATTERN) ?? []
      for (const match of matches) {
        for (const piece of bpe(byteLevelToken(match))) {
          tokenIds.push(vocab[piece] ?? fallbackId)
          if (tokenIds.length >= maxLength - 1) break
        }
        if (tokenIds.length >= maxLength - 1) break
      }
      tokenIds.push(sepId)

      const inputIds = tokenIds.slice(0, maxLength)
      const attentionMask = inputIds.map(() => 1)
      while (inputIds.length < maxLength) {
        inputIds.push(padId)
        attentionMask.push(0)
      }

      return { inputIds, attentionMask }
    },
  }
}
