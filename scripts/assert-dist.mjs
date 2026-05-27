import { access, readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const dist = join(root, "dist");

const requiredFiles = [
  "manifest.json",
  "extension/content-script.js",
  "extension/service-worker.js",
  "extension/popup.html",
  "extension/popup.js",
  "extension/offscreen.html",
  "extension/offscreen.js",
  "extension/assets/README.md",
  "extension/assets/icons/icon-16.png",
  "extension/assets/icons/icon-32.png",
  "extension/assets/icons/icon-48.png",
  "extension/assets/icons/icon-128.png",
  "extension/assets/runtime/ort.wasm.min.js",
];

const requiredDirectories = [
  "extension/assets/model",
  "extension/assets/runtime",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertFile(path) {
  const absolutePath = join(dist, path);
  const info = await stat(absolutePath);
  assert(info.isFile(), `${path} must be a file`);
  assert(info.size > 0, `${path} must not be empty`);
}

async function assertDirectory(path) {
  const absolutePath = join(dist, path);
  const info = await stat(absolutePath);
  assert(info.isDirectory(), `${path} must be a directory`);
  await readdir(absolutePath);
}

await access(dist);

for (const file of requiredFiles) {
  await assertFile(file);
}

for (const directory of requiredDirectories) {
  await assertDirectory(directory);
}

const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
const contentScriptFiles = manifest.content_scripts?.flatMap((entry) => entry.js ?? []) ?? [];
assert(contentScriptFiles.includes("extension/content-script.js"), "manifest must reference extension/content-script.js");

for (const script of contentScriptFiles) {
  await assertFile(script);
}

const contentScript = await readFile(join(dist, "extension/content-script.js"), "utf8");
assert(!/^\s*import\s/m.test(contentScript), "content script bundle must not contain ESM imports");
assert(!/^\s*export\s/m.test(contentScript), "content script bundle must not contain ESM exports");
assert(contentScript.includes("createScoringGuardrails"), "content script must include scoring guardrails");
assert(contentScript.includes("createFeedBadgeController"), "content script must include feed badge UI");
assert(contentScript.includes("createComposerHintController"), "content script must include composer hint UI");

await assertFile("extension/assets/model/v5-full.onnx");
await assertFile("extension/assets/tokenizer/tokenizer.json");

console.info(`dist assertions passed for ${relative(root, dist)}`);
