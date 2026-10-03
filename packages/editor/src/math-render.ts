import katex from "katex";
import "katex/dist/katex.min.css";
import type { MathExpression } from "./math-source";
import { editorMessage } from "./messages";

export interface MathRenderResult {
  status: "ready" | "error";
  html: string;
  message?: string;
}

export interface MountedMathPreview {
  destroy(): void;
}

export type MathPreviewErrorDisplay = "message" | "hidden";

export interface MountMathPreviewOptions {
  expression: MathExpression;
  identity: string;
  isCurrent(): boolean;
  eager?: boolean;
  errorDisplay?: MathPreviewErrorDisplay;
  onPaint?(result: MathRenderResult): void;
  typstTheme?(): TypstMathTheme;
}

const MAX_EXPRESSION_INPUT = 8_192;
const MAX_RENDERED_OUTPUT = 256_000;
const MAX_CACHE_ENTRIES = 160;
const MAX_CACHE_BYTES = 2 * 1024 * 1024;

const SAFE_KATEX_ELEMENTS = new Set([
  "annotation",
  "g",
  "line",
  "math",
  "menclose",
  "mfrac",
  "mglyph",
  "mi",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mroot",
  "mrow",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msubsup",
  "msup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
  "path",
  "polyline",
  "rect",
  "semantics",
  "span",
  "svg",
]);

const SAFE_KATEX_ATTRIBUTES = new Set([
  "accent",
  "accentunder",
  "align",
  "aria-hidden",
  "class",
  "columnalign",
  "columnlines",
  "columnspacing",
  "d",
  "depth",
  "display",
  "encoding",
  "equalcolumns",
  "equalrows",
  "fence",
  "fill",
  "frame",
  "framespacing",
  "height",
  "linethickness",
  "lspace",
  "mathbackground",
  "mathcolor",
  "mathsize",
  "mathvariant",
  "preserveaspectratio",
  "rowalign",
  "rowlines",
  "rowspacing",
  "rspace",
  "scriptlevel",
  "separator",
  "stretchy",
  "stroke",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-width",
  "style",
  "viewbox",
  "voffset",
  "width",
  "x",
  "x1",
  "x2",
  "xmlns",
  "y",
  "y1",
  "y2",
]);

const SAFE_STYLE_PROPERTIES = new Set([
  "background-color",
  "border-bottom-style",
  "border-bottom-width",
  "border-color",
  "border-right-style",
  "border-right-width",
  "border-top-style",
  "border-top-width",
  "color",
  "height",
  "margin-left",
  "margin-right",
  "min-width",
  "padding-left",
  "position",
  "top",
  "transform",
  "vertical-align",
  "width",
]);

/**
 * The part of KaTeX's macro context (MacroContextInterface) that the preview
 * macros use. KaTeX types a function macro's argument as a plain object.
 */
interface MacroContext {
  future(): { text: string };
  popToken(): { text: string };
  consumeArg(delimiters?: string[]): unknown;
}

type PreviewMacro = string | ((context: object) => string);

// \label{key}, or cleveref's \label[type]{key}. Labels belong to the LaTeX
// build, so the preview reads past the label and renders nothing for it.
function dropLabel(context: object): string {
  const macro = context as MacroContext;
  if (macro.future().text === "[") {
    macro.popToken();
    macro.consumeArg(["]"]);
  }
  macro.consumeArg();
  return "";
}

// \ref{key}, \eqref{key} and the like. The preview cannot know the number, so
// it shows the placeholder LaTeX itself prints for an unresolved reference.
function unresolvedReference(placeholder: string): PreviewMacro {
  return (context) => {
    const macro = context as MacroContext;
    if (macro.future().text === "*") macro.popToken();
    macro.consumeArg();
    return String.raw`\text{${placeholder}}`;
  };
}

/**
 * Macros for LaTeX commands KaTeX lacks. Build a new map for every render:
 * KaTeX writes \gdef definitions (including the ones behind \tag and
 * \nonumber) into the map it gets, so a shared map would leak them from one
 * preview into the next.
 */
function previewMacros(): Record<string, PreviewMacro> {
  const reference = unresolvedReference("??");
  return {
    "\\label": dropLabel,
    "\\ref": reference,
    "\\pageref": reference,
    "\\autoref": reference,
    "\\nameref": reference,
    "\\cref": reference,
    "\\Cref": reference,
    "\\eqref": unresolvedReference("(??)"),
    // Only valid inside multline, which renders as gather below.
    "\\shoveleft": "#1",
    "\\shoveright": "#1",
  };
}

// KaTeX has no multline. gather gives each of its lines a centred row, which
// is close enough for a preview.
const MULTLINE = /\\(begin|end)\{multline(\*?)\}/gu;

function katexSource(body: string): string {
  return body.replace(MULTLINE, String.raw`\$1{gather$2}`);
}

const renderCache = new Map<
  string,
  { result: MathRenderResult; bytes: number }
>();
let renderCacheBytes = 0;
const visibilityCallbacks = new Map<Element, () => void>();
let visibilityObserver: IntersectionObserver | null = null;

function cacheKey(body: string, display: boolean): string {
  return `${display ? "display" : "inline"}\0${body}`;
}

function readCached(key: string): MathRenderResult | null {
  const cached = renderCache.get(key);
  if (!cached) return null;
  renderCache.delete(key);
  renderCache.set(key, cached);
  return cached.result;
}

function writeCached(key: string, result: MathRenderResult) {
  const bytes =
    key.length * 2 +
    result.html.length * 2 +
    (result.message?.length ?? 0) * 2;
  const previous = renderCache.get(key);
  if (previous) renderCacheBytes -= previous.bytes;
  renderCache.delete(key);
  renderCache.set(key, { result, bytes });
  renderCacheBytes += bytes;

  while (
    renderCache.size > MAX_CACHE_ENTRIES ||
    renderCacheBytes > MAX_CACHE_BYTES
  ) {
    const oldest = renderCache.entries().next().value as
      | [string, { result: MathRenderResult; bytes: number }]
      | undefined;
    if (!oldest) break;
    renderCache.delete(oldest[0]);
    renderCacheBytes -= oldest[1].bytes;
  }
}

function conciseKatexError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return (
    raw
      .replace(/^KaTeX parse error:\s*/iu, "")
      .replace(/^ParseError:\s*/iu, "")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 180) || editorMessage("math.unsupported")
  );
}

function sanitizeStyle(style: string): string {
  if (/url\s*\(|expression\s*\(|@import/iu.test(style)) return "";
  return style
    .split(";")
    .map((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon < 1) return "";
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      if (!SAFE_STYLE_PROPERTIES.has(property)) return "";
      if (!/^[\w\s.,%()#+*/-]+$/u.test(value)) return "";
      return `${property}:${value}`;
    })
    .filter(Boolean)
    .join(";");
}

/**
 * KaTeX already emits a closed, local DOM tree when trust is disabled. This
 * second boundary retains only the tags and attributes KaTeX needs, strips all
 * URL-bearing/event attributes, and never accepts application-authored HTML.
 */
function sanitizeKatexHtml(html: string): string {
  if (typeof document === "undefined") return "";
  const template = document.createElement("template");
  template.innerHTML = html;

  for (const element of template.content.querySelectorAll("*")) {
    const tag = element.localName.toLowerCase();
    if (!SAFE_KATEX_ELEMENTS.has(tag)) {
      element.replaceWith(document.createTextNode(element.textContent ?? ""));
      continue;
    }
    sanitizeKatexAttributes(element);
  }
  return template.innerHTML;
}

function sanitizeKatexAttributes(element: Element): void {
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase();
    if (!SAFE_KATEX_ATTRIBUTES.has(name) || name.startsWith("on")) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if (name === "style") {
      const safeStyle = sanitizeStyle(attribute.value);
      if (safeStyle) element.setAttribute("style", safeStyle);
      else element.removeAttribute("style");
    }
  }
}

export function renderMathExpression(
  body: string,
  display: boolean,
): MathRenderResult {
  if (body.length > MAX_EXPRESSION_INPUT) {
    return {
      status: "error",
      html: "",
      message: editorMessage("math.tooLong", { characters: body.length }),
    };
  }
  if (!body.trim()) {
    return {
      status: "error",
      html: "",
      message: editorMessage("math.empty"),
    };
  }

  const key = cacheKey(body, display);
  const cached = readCached(key);
  if (cached) return cached;

  let result: MathRenderResult;
  try {
    const rendered = katex.renderToString(katexSource(body), {
      displayMode: display,
      output: "htmlAndMathml",
      throwOnError: true,
      strict: "error",
      trust: false,
      maxExpand: 200,
      maxSize: 10,
      globalGroup: false,
      macros: previewMacros(),
    });
    if (rendered.length > MAX_RENDERED_OUTPUT) {
      result = {
        status: "error",
        html: "",
        message: editorMessage("math.outputTooLarge"),
      };
    } else {
      const sanitized = sanitizeKatexHtml(rendered);
      result = sanitized
        ? { status: "ready", html: sanitized }
        : {
            status: "error",
            html: "",
            message: editorMessage("math.unsafeOutput"),
          };
    }
  } catch (error) {
    result = {
      status: "error",
      html: "",
      message: conciseKatexError(error),
    };
  }

  writeCached(key, result);
  return result;
}

const ENVIRONMENT_SOURCE = /^\\begin\{([^{}]+)\}([\s\S]*)\\end\{\1\}$/u;
const NEEDS_ALIGNMENT = /(?:^|[^\\])(?:&|\\\\)/u;
const NUMBERED_ENVIRONMENTS = new Set(["equation", "align", "gather", "alignat", "flalign", "multline", "eqnarray"]);

function unnumbered(source: string): string {
  const environment = ENVIRONMENT_SOURCE.exec(source);
  if (!environment || !NUMBERED_ENVIRONMENTS.has(environment[1])) return source;
  return String.raw`\begin{${environment[1]}*}${environment[2]}\end{${environment[1]}*}`;
}

/**
 * Renders LaTeX math source for a preview: a whole environment block such as
 * `\begin{align}...\end{align}`, or a bare body. The preview cannot know the
 * real equation numbers, so numbered environments render without them. An
 * environment KaTeX lacks (eqnarray, flalign, displaymath, math) falls back to
 * its body, wrapped in `aligned` when the body has rows or columns.
 */
export function renderMathSource(source: string, display: boolean): MathRenderResult {
  const direct = renderMathExpression(unnumbered(source), display);
  if (direct.status === "ready") return direct;
  const environment = ENVIRONMENT_SOURCE.exec(source);
  const body = environment?.[2].trim();
  if (!body) return direct;
  const wrapped = NEEDS_ALIGNMENT.test(body) ? String.raw`\begin{aligned}${body}\end{aligned}` : body;
  const fallback = renderMathExpression(wrapped, display);
  return fallback.status === "ready" ? fallback : direct;
}

function closingDelimiter(delimiter: MathExpression["delimiter"]): string {
  if (delimiter === String.raw`\(`) return String.raw`\)`;
  if (delimiter === String.raw`\[`) return String.raw`\]`;
  return delimiter;
}

function previewErrorMessage(expression: MathExpression): string {
  return expression.status === "incomplete"
    ? editorMessage("math.missingClosing", {
        delimiter: closingDelimiter(expression.delimiter),
      })
    : editorMessage("math.notRendered");
}

function applyPreviewResult(
  host: HTMLElement,
  container: HTMLElement,
  expression: MathExpression,
  result: MathRenderResult,
  errorDisplay: MathPreviewErrorDisplay,
) {
  container.replaceChildren();
  if (result.status === "ready") {
    host.hidden = false;
    container.classList.remove("is-error");
    container.removeAttribute("aria-label");
    container.innerHTML = result.html;
    return;
  }

  container.classList.add("is-error");
  if (errorDisplay === "hidden") {
    host.hidden = true;
    return;
  }
  const error = document.createElement("span");
  error.className = "math-preview-error";
  error.setAttribute("role", "status");
  error.textContent = result.message ?? previewErrorMessage(expression);
  container.append(error);
}

function observePreviewVisibility(
  element: HTMLElement,
  onVisible: () => void,
): () => void {
  if (typeof IntersectionObserver !== "function") {
    const timer = setTimeout(onVisible, 0);
    return () => clearTimeout(timer);
  }

  visibilityObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = visibilityCallbacks.get(entry.target);
        visibilityCallbacks.delete(entry.target);
        visibilityObserver?.unobserve(entry.target);
        callback?.();
      }
      if (visibilityCallbacks.size === 0) {
        visibilityObserver?.disconnect();
        visibilityObserver = null;
      }
    },
    { rootMargin: "240px" },
  );

  visibilityCallbacks.set(element, onVisible);
  visibilityObserver.observe(element);
  return () => {
    visibilityCallbacks.delete(element);
    visibilityObserver?.unobserve(element);
    if (visibilityCallbacks.size === 0) {
      visibilityObserver?.disconnect();
      visibilityObserver = null;
    }
  };
}

/**
 * Mounts a lazily rendered, accessible preview. IntersectionObserver prevents
 * offscreen KaTeX work. The caller-provided identity guard makes delayed
 * observer callbacks harmless after a document/revision change.
 */
export function mountMathPreview(
  host: HTMLElement,
  options: MountMathPreviewOptions,
): MountedMathPreview {
  const { expression } = options;
  host.classList.add(
    "math-preview",
    expression.display ? "is-display" : "is-inline",
  );
  host.dataset.mathPreviewIdentity = options.identity;
  host.setAttribute("contenteditable", "false");
  host.setAttribute(
    "aria-label",
    `${expression.display ? "Display" : "Inline"} math preview: ${
      expression.body.length > 240
        ? `${expression.body.slice(0, 239)}…`
        : expression.body
    }`,
  );

  const output = document.createElement("span");
  output.className = "math-preview-output";
  output.setAttribute("aria-live", "polite");
  const loading = document.createElement("span");
  loading.className = "math-preview-loading";
  loading.textContent = editorMessage("math.previewing");
  output.append(loading);
  host.append(output);

  let destroyed = false;
  let cancelTypst = () => {};
  const paint = () => {
    if (
      destroyed ||
      !options.isCurrent() ||
      host.dataset.mathPreviewIdentity !== options.identity
    ) {
      return;
    }
    if (options.typstTheme && expression.status === "complete") {
      cancelTypst = paintTypstMath(output, expression.body, options.typstTheme(), {
        onPaint: (outcome) => {
          if (destroyed) return;
          const failed = outcome.status === "failed";
          host.hidden = failed && options.errorDisplay === "hidden";
          options.onPaint?.(
            failed
              ? { status: "error", html: "", message: outcome.message }
              : { status: "ready", html: "" },
          );
        },
      });
      return;
    }
    const result =
      expression.status === "incomplete"
        ? {
            status: "error" as const,
            html: "",
            message: previewErrorMessage(expression),
          }
        : renderMathExpression(expression.body, expression.display);
    if (
      destroyed ||
      !options.isCurrent() ||
      host.dataset.mathPreviewIdentity !== options.identity
    ) {
      return;
    }
    applyPreviewResult(
      host,
      output,
      expression,
      result,
      options.errorDisplay ?? "message",
    );
    options.onPaint?.(result);
  };
  let stopObserving = () => {};
  if (options.eager) {
    paint();
  } else {
    stopObserving = observePreviewVisibility(host, paint);
  }

  return {
    destroy() {
      destroyed = true;
      cancelTypst();
      stopObserving();
    },
  };
}

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
    return cancel;
  }
  paintTypstPending(output, body, options.owner);
  timer = setTimeout(() => {
    timer = null;
    if (cancelled) return;
    void renderTypstMath(body, theme).then(apply);
  }, options.delay ?? 0);
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

export function cssColorToHex(color: string): string | null {
  const value = color.trim();
  if (TYPST_COLOR.test(value)) return value.toLowerCase();
  const short = /^#([\da-f])([\da-f])([\da-f])$/iu.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/iu.exec(value);
  if (rgb) {
    if (rgb[4] !== undefined && Number.parseFloat(rgb[4]) === 0) return null;
    return `#${hexByte(Number(rgb[1]))}${hexByte(Number(rgb[2]))}${hexByte(Number(rgb[3]))}`;
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
