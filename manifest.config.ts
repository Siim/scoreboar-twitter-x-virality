export const manifestConfig = {
  manifest_version: 3,
  name: "Scoreboar",
  version: "0.0.0",
  description: "Local-first scoring helper for X posts.",
  host_permissions: ["https://x.com/*", "https://twitter.com/*"],
  permissions: ["storage", "offscreen"],
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  },
  // Cross-origin isolation gives the offscreen document SharedArrayBuffer, so
  // ONNX Runtime can score on several threads instead of one.
  cross_origin_embedder_policy: { value: "require-corp" },
  cross_origin_opener_policy: { value: "same-origin" },
  action: {
    default_title: "Scoreboar",
    default_popup: "extension/popup.html",
    default_icon: {
      16: "extension/assets/icons/icon-16.png",
      32: "extension/assets/icons/icon-32.png",
      48: "extension/assets/icons/icon-48.png",
      128: "extension/assets/icons/icon-128.png"
    }
  },
  icons: {
    16: "extension/assets/icons/icon-16.png",
    32: "extension/assets/icons/icon-32.png",
    48: "extension/assets/icons/icon-48.png",
    128: "extension/assets/icons/icon-128.png"
  },
  background: {
    service_worker: "extension/service-worker.js",
    type: "module"
  },
  // The family's fonts (OFL). The content script fetches them from the
  // extension and registers them with the FontFace API.
  web_accessible_resources: [
    {
      resources: ["extension/assets/fonts/*.woff2"],
      matches: ["https://x.com/*", "https://twitter.com/*"]
    }
  ],
  content_scripts: [
    {
      matches: ["https://x.com/*", "https://twitter.com/*"],
      js: ["extension/page-listener.js"],
      run_at: "document_start",
      world: "MAIN"
    },
    {
      matches: ["https://x.com/*", "https://twitter.com/*"],
      js: ["extension/content-script.js"],
      run_at: "document_idle"
    }
  ]
} as const;

export default manifestConfig;
