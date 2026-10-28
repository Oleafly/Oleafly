// Typst math previews, rendered by the host as SVG. Kept apart from
// math-render.ts, which pulls in KaTeX, so the source editor's startup
// paths (Typst paste, the Typst host, the math tooltip) don't load it.
import { editorMessage } from "./messages";

export const MAX_EXPRESSION_INPUT = 8_192;

export type TypstMathOutcome =
  | { status: "rendered"; svg: string }
  | { status: "failed"; message: string };

export interface TypstMathHost {
  render(source: string): Promise<TypstMathOutcome>;
  typstVersion(): string | null;
}

export interface TypstMathTheme {
  color: string;
  size: number;
}

export interface PaintTypstMathOptions {
  delay?: number;
  owner?: object;
  errorClass?: string;
  onPaint?(outcome: TypstMathOutcome): void;
}

const TYPST_CACHE_ENTRIES = 160;
const TYPST_CACHE_BYTES = 4 * 1024 * 1024;
const TYPST_MAX_SVG = 2 * 1024 * 1024;
const TYPST_FALLBACK_COLOR = "#808080";
const TYPST_FALLBACK_SIZE = 11;
const TYPST_COLOR = /^#[\da-f]{6}$/iu;
const RGB_FUNCTION = /^rgba?\((.*)\)$/isu;
const RGB_CHANNELS = /^\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/u;
const RGB_ALPHA = /^(?:\s*[,/]\s*([\d.]+%?))?\s*$/u;

let typstMathHost: TypstMathHost | null = null;
const typstCache = new Map<string, { outcome: TypstMathOutcome; bytes: number }>();
let typstCacheBytes = 0;
const typstInflight = new Map<string, Promise<TypstMathOutcome>>();
const lastTypstPaint = new WeakMap<object, string>();

export function setTypstMathHost(host: TypstMathHost | null): void {
  typstMathHost = host;
}

export function typstMathVersion(): string | null {
  return typstMathHost?.typstVersion() ?? null;
}

function typstThemeSize(size: number): number {
  return Number.isFinite(size) ? Math.min(36, Math.max(6, Math.round(size * 2) / 2)) : TYPST_FALLBACK_SIZE;
}

export function typstMathSnippet(body: string, theme: TypstMathTheme): string {
  const color = TYPST_COLOR.test(theme.color) ? theme.color.toLowerCase() : TYPST_FALLBACK_COLOR;
  return `#set text(fill: rgb("${color}"), size: ${typstThemeSize(theme.size)}pt)\n$${body}$`;
}

function typstCacheKey(body: string, theme: TypstMathTheme): string {
  return [typstMathVersion() ?? "", theme.color, typstThemeSize(theme.size), body].join("\u0000");
}

function readTypstCache(key: string): TypstMathOutcome | null {
  const cached = typstCache.get(key);
  if (!cached) return null;
  typstCache.delete(key);
  typstCache.set(key, cached);
  return cached.outcome;
}

function writeTypstCache(key: string, outcome: TypstMathOutcome): void {
  const bytes = (key.length + (outcome.status === "rendered" ? outcome.svg.length : outcome.message.length)) * 2;
  const previous = typstCache.get(key);
  if (previous) typstCacheBytes -= previous.bytes;
  typstCache.delete(key);
  typstCache.set(key, { outcome, bytes });
  typstCacheBytes += bytes;
  while (typstCache.size > TYPST_CACHE_ENTRIES || typstCacheBytes > TYPST_CACHE_BYTES) {
    const oldest = typstCache.keys().next().value;
    if (oldest === undefined) break;
    typstCacheBytes -= typstCache.get(oldest)?.bytes ?? 0;
    typstCache.delete(oldest);
  }
}

function precheckTypstBody(body: string): TypstMathOutcome | null {
  if (body.length > MAX_EXPRESSION_INPUT) {
    return { status: "failed", message: editorMessage("math.tooLong", { characters: body.length }) };
  }
  if (!body.trim()) return { status: "failed", message: editorMessage("math.empty") };
  if (!typstMathHost) return { status: "failed", message: editorMessage("math.typstUnavailable") };
  return null;
}

export function cachedTypstMath(body: string, theme: TypstMathTheme): TypstMathOutcome | null {
  return precheckTypstBody(body) ?? readTypstCache(typstCacheKey(body, theme));
}

export function renderTypstMath(body: string, theme: TypstMathTheme): Promise<TypstMathOutcome> {
  const early = cachedTypstMath(body, theme);
  if (early) return Promise.resolve(early);
  const host = typstMathHost as TypstMathHost;
  const key = typstCacheKey(body, theme);
  const pending = typstInflight.get(key);
  if (pending) return pending;
  const request = host
    .render(typstMathSnippet(body, theme))
    .then((outcome): TypstMathOutcome => {
      const checked: TypstMathOutcome =
        outcome.status === "rendered" && outcome.svg.length > TYPST_MAX_SVG
          ? { status: "failed", message: editorMessage("math.outputTooLarge") }
          : outcome;
      writeTypstCache(key, checked);
      return checked;
    })
    .catch(
      (error: unknown): TypstMathOutcome => ({
        status: "failed",
        message: (error instanceof Error ? error.message : String(error)) || editorMessage("math.notRendered"),
      }),
    )
    .finally(() => {
      typstInflight.delete(key);
    });
  typstInflight.set(key, request);
  return request;
}

function typstImageUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function typstImage(source: string, body: string): HTMLImageElement {
  const image = document.createElement("img");
  image.className = "ofl-typst-math";
  image.src = source;
  image.alt = body.trim();
  image.draggable = false;
  return image;
}

function paintTypstOutcome(
  output: HTMLElement,
  body: string,
  outcome: TypstMathOutcome,
  errorClass: string,
): void {
  output.classList.toggle("is-error", outcome.status === "failed");
  if (outcome.status === "rendered") {
    output.replaceChildren(typstImage(typstImageUrl(outcome.svg), body));
    return;
  }
  const error = document.createElement("span");
  error.className = errorClass;
  error.setAttribute("role", "status");
  error.textContent = outcome.message || editorMessage("math.notRendered");
  output.replaceChildren(error);
}

function paintTypstPending(output: HTMLElement, body: string, owner: object | undefined): void {
  const previous = owner ? lastTypstPaint.get(owner) : undefined;
  if (previous) {
    const stale = typstImage(previous, body);
    stale.classList.add("is-stale");
    output.replaceChildren(stale);
    return;
  }
  const loading = document.createElement("span");
  loading.className = "math-preview-loading";
  loading.textContent = editorMessage("math.previewing");
  output.replaceChildren(loading);
}

export function paintTypstMath(
  output: HTMLElement,
  body: string,
  theme: TypstMathTheme,
  options: PaintTypstMathOptions = {},
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const apply = (outcome: TypstMathOutcome) => {
    if (cancelled) return;
    paintTypstOutcome(output, body, outcome, options.errorClass ?? "math-preview-error");
    if (outcome.status === "rendered" && options.owner) {
      lastTypstPaint.set(options.owner, typstImageUrl(outcome.svg));
    }
    options.onPaint?.(outcome);
  };
  const cancel = () => {
    cancelled = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const cached = cachedTypstMath(body, theme);
  if (cached) {
    apply(cached);
  } else {
    paintTypstPending(output, body, options.owner);
    timer = setTimeout(() => {
      timer = null;
      if (cancelled) return;
      void renderTypstMath(body, theme).then(apply);
    }, options.delay ?? 0);
  }
  return cancel;
}

function hexByte(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function canvasColor(color: string): string | null {
  if (typeof document === "undefined" || /jsdom/iu.test(globalThis.navigator?.userAgent ?? "")) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.fillStyle = "#000000";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  if (alpha === 0) return null;
  return `#${hexByte(red)}${hexByte(green)}${hexByte(blue)}`;
}

function rgbFunctionParts(value: string): { channels: string[]; alpha: string | undefined } | null {
  const inner = RGB_FUNCTION.exec(value)?.[1];
  if (inner === undefined) return null;
  const channels = RGB_CHANNELS.exec(inner);
  if (!channels) return null;
  const alpha = RGB_ALPHA.exec(inner.slice(channels[0].length));
  if (!alpha) return null;
  return { channels: channels.slice(1, 4), alpha: alpha[1] };
}

export function cssColorToHex(color: string): string | null {
  const value = color.trim();
  if (TYPST_COLOR.test(value)) return value.toLowerCase();
  const short = /^#([\da-f])([\da-f])([\da-f])$/iu.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  const rgb = rgbFunctionParts(value);
  if (rgb) {
    if (rgb.alpha !== undefined && Number.parseFloat(rgb.alpha) === 0) return null;
    return `#${rgb.channels.map((channel) => hexByte(Number(channel))).join("")}`;
  }
  return value ? canvasColor(value) : null;
}

export function typstMathTheme(element: HTMLElement): TypstMathTheme {
  const style = typeof getComputedStyle === "function" ? getComputedStyle(element) : null;
  const pixels = Number.parseFloat(style?.fontSize ?? "");
  return {
    color: cssColorToHex(style?.color ?? "") ?? TYPST_FALLBACK_COLOR,
    size: Number.isFinite(pixels) && pixels > 0 ? typstThemeSize(pixels * 0.75) : TYPST_FALLBACK_SIZE,
  };
}
