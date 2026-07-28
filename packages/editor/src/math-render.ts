import katex from "katex";
import "katex/dist/katex.min.css";
import type { MathExpression } from "./math-source";

export interface MathRenderResult {
  status: "ready" | "error";
  html: string;
  message?: string;
}

export interface MountedMathPreview {
  destroy(): void;
}

export interface MountMathPreviewOptions {
  expression: MathExpression;
  identity: string;
  isCurrent(): boolean;
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
      .slice(0, 180) || "This expression is incomplete or unsupported."
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

  for (const element of [...template.content.querySelectorAll("*")]) {
    const tag = element.localName.toLowerCase();
    if (!SAFE_KATEX_ELEMENTS.has(tag)) {
      element.replaceWith(document.createTextNode(element.textContent ?? ""));
      continue;
    }
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
  return template.innerHTML;
}

export function renderMathExpression(
  body: string,
  display: boolean,
): MathRenderResult {
  if (body.length > MAX_EXPRESSION_INPUT) {
    return {
      status: "error",
      html: "",
      message: `Expression is too long to preview (${body.length.toLocaleString()} characters).`,
    };
  }
  if (!body.trim()) {
    return {
      status: "error",
      html: "",
      message: "Add a math expression to show a preview.",
    };
  }

  const key = cacheKey(body, display);
  const cached = readCached(key);
  if (cached) return cached;

  let result: MathRenderResult;
  try {
    const rendered = katex.renderToString(body, {
      displayMode: display,
      output: "htmlAndMathml",
      throwOnError: true,
      strict: "error",
      trust: false,
      maxExpand: 200,
      maxSize: 10,
      globalGroup: false,
    });
    if (rendered.length > MAX_RENDERED_OUTPUT) {
      result = {
        status: "error",
        html: "",
        message: "Preview output exceeded the safe rendering limit.",
      };
    } else {
      const sanitized = sanitizeKatexHtml(rendered);
      result = sanitized
        ? { status: "ready", html: sanitized }
        : {
            status: "error",
            html: "",
            message: "A safe preview could not be produced.",
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

function previewErrorMessage(expression: MathExpression): string {
  return expression.status === "incomplete"
    ? `Missing closing ${expression.delimiter === "\\(" ? "\\)" : expression.delimiter === "\\[" ? "\\]" : expression.delimiter}.`
    : "This expression could not be rendered.";
}

function applyPreviewResult(
  container: HTMLElement,
  expression: MathExpression,
  result: MathRenderResult,
) {
  container.replaceChildren();
  if (result.status === "ready") {
    container.classList.remove("is-error");
    container.removeAttribute("aria-label");
    // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized KaTeX is the only accepted producer.
    container.innerHTML = result.html;
    return;
  }

  container.classList.add("is-error");
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

  if (!visibilityObserver) {
    visibilityObserver = new IntersectionObserver(
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
  }

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
    `${expression.display ? "Display" : "Inline"} math preview`,
  );

  const output = document.createElement("span");
  output.className = "math-preview-output";
  output.setAttribute("aria-live", "polite");
  const loading = document.createElement("span");
  loading.className = "math-preview-loading";
  loading.textContent = "Previewing…";
  output.append(loading);
  host.append(output);

  let destroyed = false;
  const paint = () => {
    if (
      destroyed ||
      !options.isCurrent() ||
      host.dataset.mathPreviewIdentity !== options.identity
    ) {
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
    applyPreviewResult(output, expression, result);
  };
  const stopObserving = observePreviewVisibility(host, paint);

  return {
    destroy() {
      destroyed = true;
      stopObserving();
    },
  };
}
