import { readFile } from "node:fs/promises";

const manifestPath = new URL("../dist/manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const allowedMatches = ["https://x.com/*", "https://twitter.com/*"];
const expectedCsp = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';";
const expectedIcons = {
  16: "extension/assets/icons/icon-16.png",
  32: "extension/assets/icons/icon-32.png",
  48: "extension/assets/icons/icon-48.png",
  128: "extension/assets/icons/icon-128.png",
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sameStringSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((entry) => actual.includes(entry))
  );
}

assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(sameStringSet(manifest.host_permissions, allowedMatches), "host_permissions must be limited to x.com and twitter.com");
assert(!JSON.stringify(manifest).includes("<all_urls>"), "manifest must not include <all_urls>");
assert(
  manifest.content_security_policy?.extension_pages === expectedCsp,
  `content_security_policy.extension_pages must equal ${expectedCsp}`
);
assert(JSON.stringify(manifest.icons) === JSON.stringify(expectedIcons), "manifest must define Scoreboar extension icons");
assert(JSON.stringify(manifest.action?.default_icon) === JSON.stringify(expectedIcons), "manifest action must define Scoreboar toolbar icons");
assert(manifest.action?.default_popup === "extension/popup.html", "manifest action must define the Scoreboar on/off popup");

const contentScripts = manifest.content_scripts ?? [];
assert(contentScripts.length > 0, "manifest must define content_scripts");
for (const script of contentScripts) {
  assert(sameStringSet(script.matches, allowedMatches), "content script matches must be limited to x.com and twitter.com");
}

assert(!JSON.stringify(manifest.web_accessible_resources ?? []).includes("scoreboar-mascot"), "manifest must not expose mascot assets while mascot UI is disabled");

console.info("manifest assertions passed");
