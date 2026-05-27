import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const reportPath = join(root, "reports", "model-feasibility.md");
const benchmarkJsonPath = join(root, "reports", "model-wasm-benchmark.json");
const evidenceDir = join(root, ".sisyphus", "evidence");
const benchEvidencePath = join(evidenceDir, "task-6-wasm-bench.txt");
const fallbackEvidencePath = join(evidenceDir, "task-6-wasm-fallback.txt");
const benchmarkPagePath = join(root, "benchmarks", "wasm", "onnx-wasm-benchmark.html");
const benchmarkScriptPath = join(root, "benchmarks", "wasm", "onnx-wasm-benchmark.mjs");
const ortDist = join(root, "node_modules", "onnxruntime-web", "dist");
const ortModulePath = join(ortDist, "ort.wasm.min.mjs");
const wasmFilePath = join(ortDist, "ort-wasm-simd-threaded.wasm");
const sourceCheckpointPath = join(root, "model", "v5-source", "model.pt");
const t4Blocker = "T4 blocker: full-v5 ONNX export is blocked because local ModernBERT base files are missing while Hugging Face downloads are disabled; artifacts/model/v5-full.onnx does not exist yet.";
const onnxCandidates = [
  { kind: "packaged_dist", path: join(root, "dist", "extension", "assets", "model", "v5-full.onnx") },
  { kind: "source_artifact", path: join(root, "artifacts", "model", "v5-full.onnx") },
  { kind: "packaged_source", path: join(root, "extension", "assets", "model", "v5-full.onnx") }
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function sizeOrUnavailable(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return "unavailable";
  }
}

async function findOnnxCandidate() {
  const checked = [];
  for (const candidate of onnxCandidates) {
    const present = await exists(candidate.path);
    checked.push({ ...candidate, relative_path: relative(root, candidate.path), exists: present });
    if (present) {
      return { selected: { ...candidate, relative_path: relative(root, candidate.path) }, checked };
    }
  }
  return { selected: null, checked };
}

function markdownValue(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) {
    return JSON.stringify(value, null, 0);
  }
  return String(value);
}

function markdownTable(rows) {
  return [
    "| Field | Value |",
    "| --- | --- |",
    ...rows.map(([key, value]) => `| ${key} | \`${markdownValue(value).replaceAll("\n", "<br>")}\` |`)
  ].join("\n");
}

async function upsertReportSections(result) {
  let report = "# Scoreboar v5 ONNX feasibility report\n\nStatus: **unknown**\n";
  if (await exists(reportPath)) {
    report = await readFile(reportPath, "utf8");
  }
  const benchmarkSection = [
    "## Browser/WASM benchmark status",
    markdownTable([
      ["status", result.status],
      ["command", "npm run model:bench:wasm"],
      ["benchmark_backend", "browser_onnxruntime_web_wasm"],
      ["packaged_onnx_path", "dist/extension/assets/model/v5-full.onnx"],
      ["source_onnx_path", "artifacts/model/v5-full.onnx"],
      ["selected_onnx_path", result.selected_onnx_path ?? "unavailable"],
      ["selected_onnx_kind", result.selected_onnx_kind ?? "unavailable"],
      ["model_size_bytes", result.model_size_bytes ?? "unavailable"],
      ["source_checkpoint_size_bytes", result.source_checkpoint_size_bytes ?? "unavailable"],
      ["cold_load_ms", result.cold_load_ms ?? "unavailable"],
      ["warm_inference_avg_ms", result.warm_inference_avg_ms ?? "unavailable"],
      ["warm_inference_min_ms", result.warm_inference_min_ms ?? "unavailable"],
      ["warm_inference_max_ms", result.warm_inference_max_ms ?? "unavailable"],
      ["memory_estimate", result.memory_estimate ?? "unavailable"],
      ["wasm_runtime_asset", result.wasm_runtime_asset ?? "node_modules/onnxruntime-web/dist/ort.wasm.min.mjs"],
      ["checked_onnx_paths", result.checked_onnx_paths],
      ["blocker", result.blocker ?? "none"]
    ]),
    ""
  ].join("\n");
  const fallbackSection = [
    "## WebGPU-disabled/WASM-fallback status",
    markdownTable([
      ["status", result.fallback_status],
      ["webgpu_disabled", result.webgpu_disabled],
      ["execution_provider", result.execution_provider ?? "wasm"],
      ["note", result.fallback_note]
    ]),
    ""
  ].join("\n");
  report = upsertSection(report, "## Browser/WASM benchmark status", benchmarkSection);
  report = upsertSection(report, "## WebGPU-disabled/WASM-fallback status", fallbackSection);
  await writeFile(reportPath, report.endsWith("\n") ? report : `${report}\n`, "utf8");
}

function upsertSection(markdown, heading, replacement) {
  const start = markdown.indexOf(heading);
  if (start === -1) {
    const candidateScan = markdown.indexOf("## Candidate scan");
    if (candidateScan === -1) {
      return `${markdown.trimEnd()}\n\n${replacement}\n`;
    }
    return `${markdown.slice(0, candidateScan).trimEnd()}\n\n${replacement}\n${markdown.slice(candidateScan)}`;
  }
  const next = markdown.indexOf("\n## ", start + heading.length);
  if (next === -1) {
    return `${markdown.slice(0, start).trimEnd()}\n\n${replacement}\n`;
  }
  return `${markdown.slice(0, start).trimEnd()}\n\n${replacement}\n${markdown.slice(next + 1)}`;
}

async function writeArtifacts(result) {
  const exitCode = 0;
  const commandOutput = JSON.stringify(result, null, 2);
  await mkdir(join(root, "reports"), { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(benchmarkJsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await upsertReportSections(result);
  await writeFile(
    benchEvidencePath,
    [
      "Scoreboar Task 6 browser/WASM ONNX benchmark evidence",
      `timestamp=${result.timestamp}`,
      "command=npm run model:bench:wasm",
      `exit_code=${exitCode}`,
      `status=${result.status}`,
      `selected_onnx_path=${result.selected_onnx_path ?? "unavailable"}`,
      `model_size_bytes=${result.model_size_bytes ?? "unavailable"}`,
      `source_checkpoint_size_bytes=${result.source_checkpoint_size_bytes ?? "unavailable"}`,
      `cold_load_ms=${result.cold_load_ms ?? "unavailable"}`,
      `warm_inference_avg_ms=${result.warm_inference_avg_ms ?? "unavailable"}`,
      `fallback_status=${result.fallback_status}`,
      `blocker=${result.blocker ?? "none"}`,
      `report=reports/model-feasibility.md`,
      `json_report=reports/model-wasm-benchmark.json`,
      `checked_onnx_paths=${JSON.stringify(result.checked_onnx_paths)}`,
      "command_output_begin",
      commandOutput,
      "command_output_end",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    fallbackEvidencePath,
    [
      "Scoreboar Task 6 WebGPU-disabled/WASM-fallback evidence",
      `timestamp=${result.timestamp}`,
      "command=npm run model:bench:wasm",
      `exit_code=${exitCode}`,
      `status=${result.fallback_status}`,
      `webgpu_disabled=${result.webgpu_disabled}`,
      `execution_provider=${result.execution_provider ?? "wasm"}`,
      `note=${result.fallback_note}`,
      "command_output_begin",
      commandOutput,
      "command_output_end",
      ""
    ].join("\n"),
    "utf8"
  );
}

function contentType(path) {
  const extension = extname(path);
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".mjs" || extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".wasm") return "application/wasm";
  if (extension === ".onnx") return "application/octet-stream";
  return "application/octet-stream";
}

async function serveFile(response, filePath) {
  try {
    await stat(filePath);
    response.writeHead(200, { "content-type": contentType(filePath), "cache-control": "no-store" });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  }
}

async function startLocalServer(onnxPath) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/benchmarks/wasm/onnx-wasm-benchmark.html") {
      void serveFile(response, benchmarkPagePath);
      return;
    }
    if (url.pathname === "/benchmarks/wasm/onnx-wasm-benchmark.mjs") {
      void serveFile(response, benchmarkScriptPath);
      return;
    }
    if (url.pathname === "/model/v5-full.onnx") {
      void serveFile(response, onnxPath);
      return;
    }
    if (url.pathname.startsWith("/ort/")) {
      void serveFile(response, join(ortDist, url.pathname.slice("/ort/".length)));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, port: address.port };
}

async function benchmarkInBrowser(selected) {
  const { server, port } = await startLocalServer(selected.path);
  let browser;
  try {
    browser = await chromium.launch({ args: ["--disable-features=WebGPU", "--disable-webgpu"] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/benchmarks/wasm/onnx-wasm-benchmark.html`);
    await page.waitForFunction(() => typeof globalThis.runScoreboarWasmBenchmark === "function");
    return await page.evaluate(
      async (config) => globalThis.runScoreboarWasmBenchmark(config),
      { modelPath: "/model/v5-full.onnx", ortModulePath: "/ort/ort.wasm.min.mjs", iterations: 5 }
    );
  } finally {
    if (browser) {
      await browser.close();
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const timestamp = new Date().toISOString();
  const { selected, checked } = await findOnnxCandidate();
  const sourceCheckpointSize = await sizeOrUnavailable(sourceCheckpointPath);
  const base = {
    timestamp,
    command: "npm run model:bench:wasm",
    checked_onnx_paths: checked.map(({ kind, relative_path, exists }) => ({ kind, path: relative_path, exists })),
    source_checkpoint_size_bytes: sourceCheckpointSize,
    benchmark_page: "benchmarks/wasm/onnx-wasm-benchmark.html",
    wasm_runtime_asset: "node_modules/onnxruntime-web/dist/ort.wasm.min.mjs",
    webgpu_disabled: true
  };

  if (!selected) {
    const result = {
      ...base,
      status: "blocked_missing_onnx",
      fallback_status: "blocked_missing_onnx",
      execution_provider: "wasm",
      blocker: t4Blocker,
      fallback_note: "WASM fallback is blocked by the missing ONNX artifact from T4, not by browser setup. The local Playwright/ORT harness is present and will run once artifacts/model/v5-full.onnx or a packaged copy exists."
    };
    await writeArtifacts(result);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (!(await exists(ortModulePath)) || !(await exists(wasmFilePath))) {
    const result = {
      ...base,
      status: "blocked_missing_local_onnxruntime_web_assets",
      fallback_status: "blocked_missing_local_runtime_assets",
      selected_onnx_path: selected.relative_path,
      selected_onnx_kind: selected.kind,
      model_size_bytes: await sizeOrUnavailable(selected.path),
      execution_provider: "wasm",
      blocker: "Local onnxruntime-web dist assets are missing; install dependencies with npm install before benchmarking.",
      fallback_note: "WASM fallback could not start because local runtime assets are missing. No CDN fallback is allowed."
    };
    await writeArtifacts(result);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  try {
    const measured = await benchmarkInBrowser(selected);
    const result = {
      ...base,
      ...measured,
      selected_onnx_path: selected.relative_path,
      selected_onnx_kind: selected.kind,
      model_size_bytes: await sizeOrUnavailable(selected.path),
      fallback_status: "wasm_fallback_benchmarked",
      fallback_note: "Chromium was launched with WebGPU disabled and ONNX Runtime Web was forced to the local WASM execution provider."
    };
    await writeArtifacts(result);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    const result = {
      ...base,
      status: "blocked_browser_wasm_benchmark_exception",
      fallback_status: "blocked_wasm_benchmark_exception",
      selected_onnx_path: selected.relative_path,
      selected_onnx_kind: selected.kind,
      model_size_bytes: await sizeOrUnavailable(selected.path),
      execution_provider: "wasm",
      blocker: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error),
      fallback_note: "WASM fallback was attempted locally with WebGPU disabled, but browser benchmarking raised an exception."
    };
    await writeArtifacts(result);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
}

process.exitCode = await main();
