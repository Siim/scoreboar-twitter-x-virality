import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");

async function loadManifestConfig() {
  const source = await readFile(join(root, "manifest.config.ts"), "utf8");
  const expression = source
    .replace(/^export const manifestConfig = /m, "return ")
    .replace(/\s+as const;\s+export default manifestConfig;\s*$/m, ";");

  return Function(expression)();
}

async function copyModule(sourcePath, targetPath) {
  const source = await readFile(join(root, sourcePath), "utf8");
  await mkdir(dirname(join(dist, targetPath)), { recursive: true });
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
    fileName: sourcePath,
  }).outputText;
  await writeFile(join(dist, targetPath), output, "utf8");
}

async function copyClassicBundle(sourcePaths, targetPath) {
  await mkdir(dirname(join(dist, targetPath)), { recursive: true });
  const chunks = [];

  for (const sourcePath of sourcePaths) {
    const source = await readFile(join(root, sourcePath), "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        isolatedModules: true,
      },
      fileName: sourcePath,
    }).outputText
      .replace(/^import\s+[^;]+;\s*/gm, "")
      .replace(/^export\s+/gm, "")
      .replace(/^export\s*\{[^}]+\};?\s*/gm, "");
    chunks.push(`// ${sourcePath}\n${output}`);
  }

  await writeFile(join(dist, targetPath), chunks.join("\n"), "utf8");
}

async function copyStatic(sourcePath, targetPath) {
  const source = await readFile(join(root, sourcePath), "utf8");
  await mkdir(dirname(join(dist, targetPath)), { recursive: true });
  await writeFile(join(dist, targetPath), source, "utf8");
}

async function copyAssetIfExists(sourcePath, targetPath) {
  const source = join(root, sourcePath);
  try {
    const info = await stat(source);
    if (!info.isFile()) return false;
  } catch {
    return false;
  }

  await mkdir(dirname(join(dist, targetPath)), { recursive: true });
  await copyFile(source, join(dist, targetPath));
  return true;
}

async function copyRuntimeWasmAssets() {
  const runtimeSource = join(root, "node_modules", "onnxruntime-web", "dist");
  const runtimeTarget = join(dist, "extension", "assets", "runtime");
  await mkdir(runtimeTarget, { recursive: true });
  await copyFile(join(runtimeSource, "ort.wasm.min.js"), join(runtimeTarget, "ort.wasm.min.js"));
  for (const entry of await readdir(runtimeSource)) {
    if (entry.endsWith(".wasm") || /^ort-wasm.*\.mjs$/.test(entry)) {
      await copyFile(join(runtimeSource, entry), join(runtimeTarget, entry));
    }
  }
}

async function main() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(join(dist, "extension", "assets", "runtime"), { recursive: true });
  await mkdir(join(dist, "extension", "assets", "model"), { recursive: true });
  await mkdir(join(dist, "extension", "assets", "tokenizer"), { recursive: true });
  await mkdir(join(dist, "extension", "assets", "icons"), { recursive: true });

  const manifest = await loadManifestConfig();
  await writeFile(join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await copyModule("src/contracts.ts", "src/contracts.js");
  await copyModule("src/dom-detection.ts", "src/dom-detection.js");
  await copyModule("src/scoring-guardrails.ts", "src/scoring-guardrails.js");
  await copyModule("src/x-author-metadata.ts", "src/x-author-metadata.js");
  await copyModule("src/local-tokenizer.ts", "src/local-tokenizer.js");
  await copyModule("src/composer-hints.ts", "src/composer-hints.js");
  await copyModule("src/feed-badges.ts", "src/feed-badges.js");
  await copyModule("src/inference-runtime.ts", "src/inference-runtime.js");
  await copyModule("src/score-mapping.ts", "src/score-mapping.js");
  await copyModule("extension/service-worker.ts", "extension/service-worker.js");
  await copyStatic("extension/popup.html", "extension/popup.html");
  await copyStatic("extension/popup.js", "extension/popup.js");
  await copyClassicBundle([
    "src/x-author-metadata.ts",
    "extension/page-listener.ts"
  ], "extension/page-listener.js");
  await copyClassicBundle([
    "src/contracts.ts",
    "src/dom-detection.ts",
    "src/scoring-guardrails.ts",
    "src/inference-runtime.ts",
    "src/score-mapping.ts",
    "src/composer-hints.ts",
    "src/feed-badges.ts",
    "extension/content-script.ts"
  ], "extension/content-script.js");
  await copyModule("extension/offscreen.ts", "extension/offscreen.js");
  await copyStatic("extension/offscreen.html", "extension/offscreen.html");
  await copyRuntimeWasmAssets();
  await copyAssetIfExists("extension/assets/icons/icon-16.png", "extension/assets/icons/icon-16.png");
  await copyAssetIfExists("extension/assets/icons/icon-32.png", "extension/assets/icons/icon-32.png");
  await copyAssetIfExists("extension/assets/icons/icon-48.png", "extension/assets/icons/icon-48.png");
  await copyAssetIfExists("extension/assets/icons/icon-128.png", "extension/assets/icons/icon-128.png");
  await copyAssetIfExists("artifacts/model/v5-full.onnx", "extension/assets/model/v5-full.onnx");
  await copyAssetIfExists("model/v5-source/tokenizer/tokenizer.json", "extension/assets/tokenizer/tokenizer.json");
  await writeFile(
    join(dist, "extension", "assets", "README.md"),
    [
      "# Local extension assets",
      "",
      "ONNX Runtime Web WASM, tokenizer, and model files are packaged under this directory tree when local artifacts exist.",
      "Do not load runtime, model, worker, or script assets from CDNs or remote URLs.",
      "Do not commit generated dist assets; rebuild locally with npm run build.",
      ""
    ].join("\n"),
    "utf8"
  );
}

await main();
