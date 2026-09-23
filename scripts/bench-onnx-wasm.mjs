// Measures the packaged model the way the extension runs it: ONNX Runtime Web,
// WASM execution provider, unpadded input of a typical post length, in a
// cross-origin-isolated Chromium page (so threaded runs are real).
//
//   npm run model:bench:wasm [-- path/to/model.onnx]
//
// Writes reports/model-wasm-benchmark.json.
import { chromium } from "@playwright/test"
import { createServer } from "node:http"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(fileURLToPath(new URL("..", import.meta.url)))
const modelPath = process.argv[2] ?? join(root, "artifacts", "model", "scoreboar-v8.onnx")
const metadata = JSON.parse(await readFile(modelPath.replace(/\.onnx$/u, ".json"), "utf8").catch(() => "{}"))
const metadataWidth = metadata.metadata_features?.length ?? 22
const tokens = 48 // a typical post, [CLS] and [SEP] included
const types = { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm" }
const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" }

const server = createServer(async (request, response) => {
  try {
    if (request.url === "/") {
      response.writeHead(200, { ...isolation, "Content-Type": "text/html" })
      response.end("<!doctype html><title>Scoreboar WASM benchmark</title>")
      return
    }
    const file = request.url === "/model.onnx"
      ? modelPath
      : join(root, "node_modules", "onnxruntime-web", "dist", request.url.replace(/^\/ort\//u, ""))
    const body = await readFile(file)
    response.writeHead(200, { ...isolation, "Content-Type": types[extname(file)] ?? "application/octet-stream" })
    response.end(body)
  } catch {
    response.writeHead(404, isolation)
    response.end()
  }
}).listen(0)
const origin = `http://127.0.0.1:${server.address().port}`

// SCOREBOAR_CHROMIUM_PATH points at a specific Chromium when Playwright's own build is not installed.
const browser = await chromium.launch({ executablePath: process.env.SCOREBOAR_CHROMIUM_PATH || undefined })
const page = await browser.newPage()
await page.goto(origin)
const runs = []
for (const threads of [1, 4]) {
  runs.push(await page.evaluate(async ({ threads, tokens, metadataWidth }) => {
    const ort = await import("/ort/ort.wasm.min.mjs")
    ort.env.wasm.wasmPaths = "/ort/"
    ort.env.wasm.numThreads = threads
    const loadStart = performance.now()
    const session = await ort.InferenceSession.create("/model.onnx", { executionProviders: ["wasm"] })
    const loadMs = performance.now() - loadStart
    const feeds = {
      input_ids: new ort.Tensor("int64", BigInt64Array.from({ length: tokens }, (_, index) => BigInt(1000 + index)), [1, tokens]),
      attention_mask: new ort.Tensor("int64", new BigInt64Array(tokens).fill(1n), [1, tokens]),
      metadata: new ort.Tensor("float32", new Float32Array(metadataWidth), [1, metadataWidth]),
    }
    await session.run(feeds)
    const times = []
    for (let index = 0; index < 10; index += 1) {
      const start = performance.now()
      await session.run(feeds)
      times.push(performance.now() - start)
    }
    await session.release()
    return {
      threads,
      crossOriginIsolated,
      loadMs: Math.round(loadMs),
      meanMs: Math.round(times.reduce((sum, value) => sum + value, 0) / times.length),
      minMs: Math.round(Math.min(...times)),
    }
  }, { threads, tokens, metadataWidth }))
}
await browser.close()
server.close()

const report = {
  timestamp: new Date().toISOString(),
  model: modelPath.replace(`${root}/`, ""),
  modelVersion: metadata.model_version ?? null,
  executionProvider: "wasm",
  tokens,
  runs,
}
await mkdir(join(root, "reports"), { recursive: true })
await writeFile(join(root, "reports", "model-wasm-benchmark.json"), `${JSON.stringify(report, null, 2)}\n`)
console.info(JSON.stringify(report, null, 2))
