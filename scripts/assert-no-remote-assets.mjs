import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const dist = join(root, "dist");
const allowedRemoteLiterals = new Set([
  "https://x.com/*",
  "https://twitter.com/*",
  "https://web.dev/cross-origin-isolation-guide/",
]);
const forbiddenPatterns = [
  { name: "all urls", regex: /<all_urls>/i },
  { name: "cdn reference", regex: /\b(?:cdn|unpkg|jsdelivr|cdnjs)\b/i },
  { name: "remote model/runtime/script URL", regex: /https?:\/\/[^\s"'`<>]+/gi }
];
const textExtensions = new Set([".html", ".js", ".mjs", ".json", ".md", ".txt", ".css"]);

function extensionFor(file) {
  const lastDot = file.lastIndexOf(".");
  return lastDot < 0 ? "" : file.slice(lastDot);
}

async function listFiles(directory) {
  const entries = await readdir(directory);
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry);
    const info = await stat(path);
    if (info.isDirectory()) {
      files.push(...await listFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

const failures = [];
for (const file of await listFiles(dist)) {
  if (file.endsWith(join("extension", "assets", "tokenizer", "tokenizer.json"))) {
    continue;
  }
  if (file.includes(join("extension", "assets", "runtime", "ort-wasm"))) {
    continue;
  }
  if (!textExtensions.has(extensionFor(file))) {
    continue;
  }
  const text = await readFile(file, "utf8");
  for (const pattern of forbiddenPatterns) {
    const matches = text.match(pattern.regex) ?? [];
    for (const match of matches) {
      if (pattern.name === "remote model/runtime/script URL" && allowedRemoteLiterals.has(match)) {
        continue;
      }
      failures.push(`${relative(root, file)}: forbidden ${pattern.name}: ${match}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Remote asset assertion failed:\n${failures.join("\n")}`);
}

console.info("no remote asset assertions passed");
