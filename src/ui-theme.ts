// The x11.social look, carried onto x.com: raised keys and slabs (shared with
// Bilanss and VoxConvo), DM Sans text, Geist Mono figures, Oswald capitals, and
// the five-pill score scale from the x11 draft scorer. Motion is the x11 chat's:
// a band of light while work is in progress, a 260ms reveal when a result
// lands, keys that travel down onto their edge. Nothing moves under Reduce
// motion.
//
// X's own theme (Light, Dim, Lights out) decides light or dark, since it is
// independent of the OS colour scheme: X Light takes x11's light tokens, Dim
// and Lights out take x11's midnight tokens.

export const SCOREBOAR_THEME_ATTRIBUTE = "data-scoreboar-theme" as const
export const SCOREBOAR_THEME_STYLE_ATTRIBUTE = "data-scoreboar-theme-style" as const

export type ScoreboarTheme = "light" | "dark"

/** Level 0 is "not scored"; 1-5 are the fifths of ordinary posts. */
export type MeterLevel = 0 | 1 | 2 | 3 | 4 | 5

export type MeterTone = "pending" | "low" | "mid" | "high" | "off"

export const FONT_FAMILIES = {
  sans: "Scoreboar DM Sans",
  mono: "Scoreboar Geist Mono",
  caps: "Scoreboar Oswald",
} as const

const LATIN_EXT =
  "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF"

const FONT_FACES = [
  { family: FONT_FAMILIES.sans, file: "extension/assets/fonts/dm-sans-latin-wght-normal.woff2", weight: "100 1000" },
  { family: FONT_FAMILIES.sans, file: "extension/assets/fonts/dm-sans-latin-ext-wght-normal.woff2", weight: "100 1000", unicodeRange: LATIN_EXT },
  { family: FONT_FAMILIES.mono, file: "extension/assets/fonts/geist-mono-latin-wght-normal.woff2", weight: "100 900" },
  { family: FONT_FAMILIES.caps, file: "extension/assets/fonts/oswald-latin-wght-normal.woff2", weight: "200 700" },
  { family: FONT_FAMILIES.caps, file: "extension/assets/fonts/oswald-latin-ext-wght-normal.woff2", weight: "200 700", unicodeRange: LATIN_EXT },
] as const

const THEME_CSS = `
:root, :root[data-scoreboar-theme="light"] {
  --sb-page: hsl(0 0% 100%);
  --sb-card: hsl(0 0% 100%);
  --sb-text: hsl(0 0% 3.9%);
  --sb-muted: hsl(0 0% 45.1%);
  --sb-line: hsl(0 0% 89.8%);
  --sb-pill-off: hsl(0 0% 3.9% / 0.1);
  --sb-danger: hsl(0 62% 46%);
  --sb-edge-ink-base: hsl(0 0% 34%);
  --sb-edge-lite: 0 2px 0 hsl(0 0% 12% / 0.16), 0 4px 8px -4px hsl(0 0% 12% / 0.32);
  --sb-edge-ink: inset 0 1px 0 hsl(0 0% 100% / 0.16), 0 3px 0 var(--sb-edge-ink-base), 0 6px 12px -5px hsl(0 0% 20% / 0.6);
  --sb-elev-float: 0 2px 0 hsl(0 0% 12% / 0.08), 0 24px 48px -28px hsl(0 0% 12% / 0.45);
  --sb-well: inset 0 1px 2px hsl(0 0% 12% / 0.12);
  --sb-key-lite-top: hsl(0 0% 100%);
  --sb-key-lite-bottom: hsl(0 0% 97%);
  --sb-key-ink-top: hsl(0 0% 19%);
  --sb-key-ink-bottom: hsl(0 0% 9%);
  --sb-on-ink: hsl(0 0% 100%);
  --sb-focus: hsl(0 0% 3.9% / 0.5);
  --sb-sans: "${FONT_FAMILIES.sans}", "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --sb-mono: "${FONT_FAMILIES.mono}", "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --sb-caps: "${FONT_FAMILIES.caps}", "Oswald", "Arial Narrow", sans-serif;
  --sb-ease: cubic-bezier(0.16, 1, 0.3, 1);
}
:root[data-scoreboar-theme="dark"] {
  --sb-page: hsl(234 35% 6%);
  --sb-card: hsl(236 33% 8%);
  --sb-text: hsl(60 30% 96%);
  --sb-muted: hsl(226 38% 78%);
  --sb-line: hsl(240 20% 18%);
  --sb-pill-off: hsl(60 30% 96% / 0.14);
  --sb-danger: hsl(0 72% 66%);
  --sb-edge-ink-base: #7d808c;
  --sb-edge-lite: inset 0 1px 0 hsl(0 0% 100% / 0.1), 0 2px 0 #000, 0 4px 8px -4px hsl(0 0% 0% / 0.6);
  --sb-edge-ink: inset 0 1px 0 #fff, 0 3px 0 var(--sb-edge-ink-base), 0 6px 12px -5px hsl(0 0% 0% / 0.55);
  --sb-elev-float: inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 2px 0 hsl(0 0% 0% / 0.85), 0 24px 48px -24px hsl(0 0% 0% / 0.9);
  --sb-well: inset 0 1px 2px hsl(0 0% 0% / 0.6);
  --sb-key-lite-top: #2a2c33;
  --sb-key-lite-bottom: #222429;
  --sb-key-ink-top: #fffdf8;
  --sb-key-ink-bottom: #e6e3de;
  --sb-on-ink: hsl(234 35% 6%);
  --sb-focus: hsl(60 30% 96% / 0.5);
}

/* Keys: a light key rests on its edge; an ink key stands on its own plinth. */
.sb-key {
  background-image: linear-gradient(180deg, var(--sb-key-lite-top), var(--sb-key-lite-bottom));
  border: 1px solid var(--sb-line);
  box-shadow: var(--sb-edge-lite);
  color: var(--sb-text);
}
.sb-key[data-sb-ink="true"] {
  background-image: linear-gradient(180deg, var(--sb-key-ink-top), var(--sb-key-ink-bottom));
  border-color: transparent;
  box-shadow: var(--sb-edge-ink);
  color: var(--sb-on-ink);
}
@media (prefers-reduced-motion: no-preference) {
  .sb-key { transition: transform 120ms ease-out, box-shadow 120ms ease-out, filter 150ms ease; }
  .sb-key:active { box-shadow: none; transform: translateY(2px); }
  .sb-key[data-sb-ink="true"]:active { box-shadow: inset 0 1px 2px hsl(0 0% 0% / 0.4); transform: translateY(3px); }
}
.sb-key:hover { filter: brightness(1.04); }
.sb-key[data-sb-ink="true"]:hover { filter: brightness(1.12); }
.sb-key:focus-visible { outline: 2px solid var(--sb-focus); outline-offset: 2px; }

.sb-slab {
  background: var(--sb-card);
  border: 1px solid var(--sb-line);
  box-shadow: var(--sb-elev-float);
  color: var(--sb-text);
  font-family: var(--sb-sans);
}
.sb-caps {
  font-family: var(--sb-caps);
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* The five-pill score scale, as on the x11 draft scorer. */
.scoreboar-meter {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  gap: 2px;
}
.scoreboar-meter__bar {
  background: var(--sb-pill-off);
  block-size: 6px;
  border-radius: 999px;
  display: block;
  inline-size: 5px;
}
.scoreboar-meter__bar[data-on="true"] { background: currentColor; }
.scoreboar-meter[data-tone="low"] .scoreboar-meter__bar[data-on="true"] { opacity: 0.55; }
@media (prefers-reduced-motion: no-preference) {
  .scoreboar-meter__bar { transition: background-color 200ms var(--sb-ease), opacity 200ms var(--sb-ease); }
  .scoreboar-meter__bar[data-on="true"] { transition-delay: calc(var(--sb-index, 0) * 45ms); }
  /* Working: the chat's band of light passes through the pills. */
  .scoreboar-meter[data-tone="pending"] .scoreboar-meter__bar {
    animation: sb-pill-sweep 1.4s linear infinite;
    animation-delay: calc(var(--sb-index, 0) * 110ms);
  }
}
@keyframes sb-pill-sweep {
  0%, 60%, 100% { background: var(--sb-pill-off); }
  30% { background: var(--sb-muted); }
}

/* A result landing: the x11 chat's reveal. */
@media (prefers-reduced-motion: no-preference) {
  .sb-reveal { animation: sb-reveal 260ms var(--sb-ease); }
}
@keyframes sb-reveal {
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: none; }
}

/* Working text: the x11 chat's thinking shimmer. */
.sb-shimmer {
  background-image: linear-gradient(100deg, var(--sb-muted) 0%, var(--sb-muted) 38%, var(--sb-text) 50%, var(--sb-muted) 62%, var(--sb-muted) 100%);
  background-size: 220% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
@media (prefers-reduced-motion: no-preference) {
  .sb-shimmer { animation: sb-shimmer 2.2s linear infinite; }
}
@media (prefers-reduced-motion: reduce) {
  .sb-shimmer { background-image: none; color: var(--sb-muted); }
}
@keyframes sb-shimmer {
  from { background-position: 120% 0; }
  to { background-position: -120% 0; }
}
`.trim()

const luminance = (color: string): number | null => {
  const match = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/u.exec(color)
  if (!match) return null
  if (match[4] !== undefined && Number(match[4]) === 0) return null
  return (0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])) / 255
}

/** X paints its theme on <body>: white (Light), #15202B (Dim) or black (Lights out). */
export const detectXTheme = (document: Document): ScoreboarTheme => {
  const view = document.defaultView
  const body = document.body
  if (!view || !body) return "light"
  const value = luminance(view.getComputedStyle(body).backgroundColor)
  return value !== null && value <= 0.5 ? "dark" : "light"
}

let fontsRequested = false

/**
 * The fonts ship with the extension (OFL, web accessible). Their bytes are
 * fetched by the extension and handed to the FontFace API, so x.com's font-src
 * policy never sees a request; the private family names keep them from
 * leaking into X's own text. Without them the system stack takes over.
 */
const registerFonts = (document: Document) => {
  if (fontsRequested) return
  fontsRequested = true
  const runtime = (globalThis as { chrome?: { runtime?: { getURL?: (path: string) => string } } }).chrome?.runtime
  const FontFaceCtor = (document.defaultView as (Window & { FontFace?: typeof FontFace }) | null)?.FontFace
  if (!runtime?.getURL || !FontFaceCtor || !document.fonts) return
  for (const face of FONT_FACES) {
    void fetch(runtime.getURL(face.file))
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
      .then((bytes) => new FontFaceCtor(face.family, bytes, {
        weight: face.weight,
        style: "normal",
        display: "swap",
        ...("unicodeRange" in face ? { unicodeRange: face.unicodeRange } : {}),
      }).load())
      .then((loaded) => document.fonts.add(loaded))
      .catch(() => undefined)
  }
}

/** Idempotent: styles and fonts once, and the theme attribute kept current. */
export const applyScoreboarTheme = (document: Document): ScoreboarTheme => {
  if (!document.querySelector(`style[${SCOREBOAR_THEME_STYLE_ATTRIBUTE}="true"]`)) {
    const style = document.createElement("style")
    style.setAttribute(SCOREBOAR_THEME_STYLE_ATTRIBUTE, "true")
    style.textContent = THEME_CSS
    document.head?.append(style)
  }
  registerFonts(document)
  const theme = detectXTheme(document)
  if (document.documentElement.getAttribute(SCOREBOAR_THEME_ATTRIBUTE) !== theme) {
    document.documentElement.setAttribute(SCOREBOAR_THEME_ATTRIBUTE, theme)
  }
  return theme
}

export const createMeter = (document: Document): HTMLElement => {
  const meter = document.createElement("span")
  meter.className = "scoreboar-meter"
  meter.setAttribute("aria-hidden", "true")
  for (let index = 0; index < 5; index += 1) {
    const bar = document.createElement("span")
    bar.className = "scoreboar-meter__bar"
    bar.style.setProperty("--sb-index", String(index))
    meter.append(bar)
  }
  setMeter(meter, 0, "pending")
  return meter
}

export const setMeter = (meter: Element, level: MeterLevel, tone: MeterTone) => {
  meter.setAttribute("data-tone", tone)
  meter.setAttribute("data-level", String(level))
  meter.querySelectorAll(".scoreboar-meter__bar").forEach((bar, index) => {
    bar.setAttribute("data-on", String(index < level))
  })
}

/** 0-100 score to its fifth and how loudly to draw it. */
export const meterForScore = (score: number | null): { readonly level: MeterLevel; readonly tone: MeterTone } => {
  if (score === null || !Number.isFinite(score)) return { level: 0, tone: "off" }
  const level = Math.min(5, Math.max(1, Math.floor(score / 20) + 1)) as MeterLevel
  return { level, tone: level >= 4 ? "high" : level === 3 ? "mid" : "low" }
}

/** Replays the reveal on an element whose content just changed. */
export const reveal = (element: Element | null) => {
  if (!element) return
  element.classList.remove("sb-reveal")
  void (element as HTMLElement).offsetWidth
  element.classList.add("sb-reveal")
}
