// @vitest-environment jsdom
import { afterAll, describe, expect, it, vi } from "vitest"

// The content script as it runs on x.com: turned off and on from the popup
// while X keeps sending the signed-in author's stats.

type StorageListener = (changes: Record<string, { readonly newValue?: unknown }>, areaName: string) => void

const VIEWER = "siimh"
const panelSelector = '[data-scoreboar-composer-panel="true"]'

const viewerStats = (followers: number) => ({
  authorHandle: VIEWER,
  authorFollowers: followers,
  authorFollowing: 1,
  authorTweets: 1,
  authorVerified: false,
  authorCreatedAt: "Sun Apr 03 23:48:02 +0000 2022",
  authorFavourites: 1,
  authorMetadataSource: "loaded-x-response",
})

const scoredResponse = (percentile: number) => ({
  type: "scoreboar.scoreText.response",
  payload: {
    status: "scored",
    label: "scored",
    confidence: 0.5,
    probabilities: { very_low: 0.2, low: 0.2, medium: 0.2, high: 0.2, very_high: 0.2 },
    numericScores: {},
    booleanScores: {},
    performance: { percentile, engagementMultiple: 1, reachMultiple: 1 },
    model: { provider: "local-onnx", path: "", version: "v8", available: true },
  },
})

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const panels = () => [...document.querySelectorAll<HTMLElement>(panelSelector)].map((panel) => ({
  visible: !panel.hidden,
  value: panel.querySelector(".scoreboar-composer-panel__value")?.textContent ?? "",
}))

const sendStats = async (followers: number) => {
  window.postMessage({ type: "scoreboar.authorMetadataBatch", payload: [viewerStats(followers)] }, "*")
  // The message, a debounce's worth, and any rescore it starts.
  await sleep(600)
}

afterAll(() => {
  vi.restoreAllMocks()
})

describe("content script on and off", () => {
  it("a stopped Scoreboar never puts a pill back, and a restarted one rescores only the current draft", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined)
    document.body.innerHTML = `
      <nav><div data-testid="SideNav_AccountSwitcher_Button"><div data-testid="UserAvatar-Container-${VIEWER}"></div><span>@${VIEWER}</span></div></nav>
      <main><div>
        <div class="composer"><div data-testid="tweetTextarea_0" role="textbox" contenteditable="true"><div data-block="true"><span data-text="true">hello world draft</span></div></div></div>
        <div data-testid="toolBar"></div>
      </div></main>`

    const scored: string[] = []
    let setEnabled: StorageListener | null = null
    ;(globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: "scoreboar-test",
        sendMessage: async (message: { payload: { text: string } }) => {
          scored.push(message.payload.text)
          return scoredResponse(message.payload.text.startsWith("hello") ? 0.11 : 0.77)
        },
      },
      storage: {
        local: { get: async (defaults: Record<string, unknown>) => defaults },
        onChanged: { addListener: (listener: StorageListener) => { setEnabled = listener } },
      },
    }

    await import("../extension/content-script")
    await vi.waitFor(() => expect(panels()).toEqual([{ visible: true, value: "Beats 11%" }]), { timeout: 3000 })
    expect(scored).toEqual(["hello world draft"])

    // Off: the pill goes, and the viewer's stats arriving later do not bring it back or score anything.
    setEnabled!({ scoreboarEnabled: { newValue: false } }, "local")
    expect(panels()).toEqual([])
    await sendStats(90)
    expect(panels()).toEqual([])
    expect(scored).toEqual(["hello world draft"])

    // On again, and the draft is edited before its first score.
    setEnabled!({ scoreboarEnabled: { newValue: true } }, "local")
    document.querySelector('[data-text="true"]')!.textContent = "a completely different newer draft"
    await vi.waitFor(() => expect(panels()).toEqual([{ visible: true, value: "Beats 77%" }]), { timeout: 3000 })
    expect(scored).toEqual(["hello world draft", "a completely different newer draft"])

    // New stats rescore the draft once, as it stands now, and nothing the stopped run remembered.
    await sendStats(95)
    expect(scored).toEqual(["hello world draft", "a completely different newer draft", "a completely different newer draft"])
    expect(panels()).toEqual([{ visible: true, value: "Beats 77%" }])
  }, 15_000)
})
