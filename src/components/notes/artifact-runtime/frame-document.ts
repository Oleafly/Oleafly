import { frameSealScript } from "./frame-seal";

const FRAME_SCRIPTS = "'unsafe-inline' 'unsafe-eval'";
const FRAME_POLICY_REST =
  "style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; worker-src blob:; form-action 'none'; base-uri 'none'; frame-src 'none'";
const RUNTIME_ADDRESS = /^(?:oleafly-artifact:\/\/localhost|http:\/\/oleafly-artifact\.localhost)\/runtime\/[0-9a-f]{64}\.js$/u;

function checkedRuntime(url: string): string {
  if (!RUNTIME_ADDRESS.test(url)) throw new TypeError(`Unexpected artifact runtime address: ${url}`);
  return url;
}

export function framePolicy(runtime: string | null): string {
  const scripts = runtime === null ? FRAME_SCRIPTS : `${FRAME_SCRIPTS} ${checkedRuntime(runtime)}`;
  return `default-src 'none'; script-src ${scripts}; ${FRAME_POLICY_REST}`;
}

export const FRAME_POLICY = framePolicy(null);
export const STATIC_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; form-action 'none'; base-uri 'none'";

export type FrameTheme = "dark" | "light";

export type FrameLibrary = "tailwind" | "react" | "react-dom" | "babel" | "d3" | "chart" | "papaparse" | "lodash" | "recharts";

export const LIBRARY_GLOBALS: Readonly<Record<FrameLibrary, readonly string[]>> = {
  tailwind: ["tailwind"],
  react: ["React"],
  "react-dom": ["React", "ReactDOM"],
  babel: ["React", "ReactDOM", "Babel"],
  d3: ["d3"],
  chart: ["Chart"],
  papaparse: ["Papa"],
  lodash: ["_"],
  recharts: ["React", "Recharts"],
};

export interface FrameMessages {
  unknownImport: string;
  compileError: string;
  runtimeError: string;
  noComponent: string;
  loadFailed: string;
}

export interface FrameOptions {
  theme: FrameTheme;
  channel: string;
  parentOrigin: string;
  messages: FrameMessages;
}

export interface PreparedHtml {
  document: Document;
  libraries: FrameLibrary[];
  removed: string[];
  scripts: boolean;
}

export function framePrelude(channel: string, parentOrigin: string): string {
  return `(() => {
"use strict";
const channel = ${JSON.stringify(channel)};
const port = (() => {
  try {
    const link = new MessageChannel();
    window.parent.postMessage({ channel, type: "port" }, ${inlineJson(parentOrigin)}, [link.port2]);
    return link.port1;
  } catch (error) {
    return null;
  }
})();
const send = (message) => { try { port.postMessage(Object.assign({ channel }, message)); } catch (error) {} };
${frameSealScript()}
let queued = false;
const measure = () => {
  queued = false;
  const root = document.documentElement;
  const body = document.body;
  const height = Math.max(root.getBoundingClientRect().height, body ? body.scrollHeight : 0);
  send({ type: "size", height: Math.ceil(height) });
};
const schedule = () => { if (queued) return; queued = true; setTimeout(measure, 16); };
const observe = () => {
  try {
    const observer = new ResizeObserver(schedule);
    observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
  } catch (error) {}
  schedule();
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe, { once: true });
else observe();
window.addEventListener("load", schedule);
setInterval(() => send({ type: "beat" }), 1000);
send({ type: "beat" });
if (port) port.onmessage = (event) => {
  const data = event.data;
  if (!data || data.channel !== channel || data.type !== "theme") return;
  const dark = data.theme === "dark";
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  root.dataset.theme = dark ? "dark" : "light";
};
})();`;
}

export function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", String.raw`\u003c`)
    .replaceAll("\u2028", String.raw`\u2028`)
    .replaceAll("\u2029", String.raw`\u2029`);
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function baseStyle(theme: FrameTheme): string {
  const foreground = theme === "dark" ? "#e4e4e7" : "#18181b";
  return `:root{color-scheme:${theme}}:where(html){font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}:where(body){margin:0;padding:12px;color:${foreground};background:transparent;line-height:1.5}`;
}

function headStart(options: FrameOptions, runtime: string | null): string {
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(framePolicy(runtime))}">`,
    `<script>${framePrelude(options.channel, options.parentOrigin)}</script>`,
    `<style>${baseStyle(options.theme)}</style>`,
  ].join("");
}

export function runtimeScript(runtime: string): string {
  return `<script src="${escapeAttribute(checkedRuntime(runtime))}"></script>`;
}

function withRuntime(code: string, messages: FrameMessages): string {
  return `<script>if (typeof __oleaflyArtifact === "undefined") {
const show = () => { const notice = document.createElement("p"); notice.setAttribute("role", "alert"); notice.dataset.artifactError = ""; notice.textContent = ${inlineJson(messages.loadFailed)}; document.body.prepend(notice); };
if (document.body) show(); else document.addEventListener("DOMContentLoaded", show, { once: true });
} else { ${code} }</script>`;
}

const REMOTE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//iu;

function isInline(url: string): boolean {
  return /^(?:data|blob):/iu.test(url.trim()) || url.trim().startsWith("#");
}

function urlParts(url: string): { host: string; segments: string[] } | null {
  try {
    const parsed = new URL(url.trim(), "https://local.invalid/");
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return {
      host: parsed.hostname.toLowerCase(),
      segments: parsed.pathname.toLowerCase().split("/").filter(Boolean),
    };
  } catch {
    return null;
  }
}

function packageName(segment: string): string {
  const at = segment.lastIndexOf("@");
  return at > 0 ? segment.slice(0, at) : segment;
}

const FILE_PATTERNS: [FrameLibrary, RegExp][] = [
  ["react-dom", /^react-dom(?:\.[a-z]+)*\.js$/u],
  ["react", /^react(?:\.(?:production|development|min|profiling))+\.js$/u],
  ["babel", /^babel(?:\.min)?\.js$/u],
  ["d3", /^d3(?:\.v\d+)?(?:\.min)?\.js$/u],
  ["chart", /^chart(?:\.umd)?(?:\.min)?\.js$/u],
  ["papaparse", /^papaparse(?:\.min)?\.js$/u],
  ["lodash", /^lodash(?:\.core)?(?:\.min)?\.js$/u],
  ["recharts", /^recharts(?:\.min)?\.js$/u],
];

const PACKAGE_NAMES: Record<string, FrameLibrary> = {
  "react-dom": "react-dom",
  react: "react",
  "babel-standalone": "babel",
  d3: "d3",
  "chart.js": "chart",
  papaparse: "papaparse",
  lodash: "lodash",
  "lodash.js": "lodash",
  recharts: "recharts",
};

export function libraryFor(url: string): FrameLibrary | undefined {
  const parts = urlParts(url);
  if (!parts || !REMOTE.test(url.trim())) return undefined;
  const { host, segments } = parts;
  if (host === "cdn.tailwindcss.com") return "tailwind";
  if (host === "d3js.org") return "d3";
  const names = segments.map(packageName);
  for (let index = 0; index < names.length; index += 1) {
    if (names[index] === "@tailwindcss" && names[index + 1] === "browser") return "tailwind";
    if (names[index] === "@babel" && names[index + 1] === "standalone") return "babel";
  }
  const file = segments.at(-1) ?? "";
  for (const [library, pattern] of FILE_PATTERNS) if (pattern.test(file)) return library;
  const named = names.find((name) => Object.hasOwn(PACKAGE_NAMES, name));
  return named ? PACKAGE_NAMES[named] : undefined;
}

const MEDIA_ATTRIBUTES = ["src", "poster", "data", "background"];
const REMOVED_ELEMENTS = "iframe, frame, frameset, object, embed, portal, fencedframe, base, applet, noscript";
const SHADOW_ROOT_ATTRIBUTES = ["shadowrootmode", "shadowroot", "shadowrootdelegatesfocus", "shadowrootclonable", "shadowrootserializable"];
const LOAD_CHANGES = `${REMOVED_ELEMENTS}, meta[http-equiv], template[shadowrootmode], template[shadowroot]`;
const CSS_URL_START = /@import|url\(/giu;
const CSS_SPACE = /\s*/uy;
const CSS_URL_OPEN = /url\(/iuy;
const IMPORT_TARGET = /[^"')\s;]+/uy;
const REMOTE_TARGET = /(?:https?:)?\/\/[^"')\s]+/iuy;

function remember(removed: Set<string>, url: string): void {
  const trimmed = url.trim();
  if (trimmed) removed.add(trimmed);
}

function stripSrcset(element: Element, removed: Set<string>): void {
  const srcset = element.getAttribute("srcset");
  if (srcset === null) return;
  for (const candidate of srcset.split(",")) {
    const url = candidate.trim().split(/\s+/u)[0] ?? "";
    if (url && !isInline(url)) remember(removed, url);
  }
  element.removeAttribute("srcset");
}

interface CssTarget {
  url: string;
  end: number;
}

function afterSpace(text: string, at: number): number {
  CSS_SPACE.lastIndex = at;
  CSS_SPACE.exec(text);
  return CSS_SPACE.lastIndex;
}

function quotedTarget(pattern: RegExp, text: string, at: number): CssTarget | null {
  const start = text[at] === '"' || text[at] === "'" ? at + 1 : at;
  pattern.lastIndex = start;
  const url = pattern.exec(text)?.[0];
  return url === undefined ? null : { url, end: start + url.length };
}

function importTarget(text: string, at: number): CssTarget | null {
  const start = afterSpace(text, at);
  if (start === at) return null;
  CSS_URL_OPEN.lastIndex = start;
  const opened = CSS_URL_OPEN.exec(text);
  const inner = opened ? quotedTarget(IMPORT_TARGET, text, afterSpace(text, start + opened[0].length)) : null;
  return inner ?? quotedTarget(IMPORT_TARGET, text, start);
}

export function cssUrlTargets(text: string): string[] {
  const urls: string[] = [];
  CSS_URL_START.lastIndex = 0;
  let start = CSS_URL_START.exec(text);
  while (start !== null) {
    const after = start.index + start[0].length;
    const target = start[0].startsWith("@") ? importTarget(text, after) : quotedTarget(REMOTE_TARGET, text, afterSpace(text, after));
    if (target) urls.push(target.url);
    CSS_URL_START.lastIndex = target ? target.end : start.index + 1;
    start = CSS_URL_START.exec(text);
  }
  return urls;
}

function cssUrls(text: string, removed: Set<string>): void {
  for (const url of cssUrlTargets(text)) {
    if (!isInline(url)) remember(removed, url);
  }
}

const BABEL_SCRIPTS = 'script[type="text/babel"], script[type="text/jsx"], script[type="text/tsx"]';
const DATA_SCRIPT_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "importmap",
  "text/plain",
  "text/template",
  "text/x-template",
]);
const SCRIPT_URL = /(?:^|[\s;,])javascript:/u;

function isDataScript(script: Element): boolean {
  const type = script.getAttribute("type");
  if (type === null) return false;
  const end = type.indexOf(";");
  return DATA_SCRIPT_TYPES.has((end < 0 ? type : type.slice(0, end)).trim().toLowerCase());
}

function urlText(value: string): string {
  let text = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13) continue;
    text += code < 32 ? " " : char;
  }
  return text.toLowerCase();
}

export function runsScripts(document: Document): boolean {
  for (const script of document.querySelectorAll("script")) {
    if (!isDataScript(script)) return true;
  }
  for (const element of document.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) {
      if (/^on/iu.test(name)) return true;
      if (SCRIPT_URL.test(urlText(element.getAttribute(name) ?? ""))) return true;
    }
  }
  return false;
}

function swapLibraryScripts(document: Document, libraries: Set<FrameLibrary>, removed: Set<string>): void {
  for (const script of document.querySelectorAll("script[src]")) {
    const src = script.getAttribute("src") ?? "";
    const library = libraryFor(src);
    if (library) libraries.add(library);
    else if (!isInline(src)) remember(removed, src);
    script.remove();
  }
}

function removeEmbeds(document: Document, removed: Set<string>): void {
  for (const element of document.querySelectorAll(REMOVED_ELEMENTS)) {
    const url = element.getAttribute("src") ?? element.getAttribute("data") ?? element.getAttribute("href");
    if (url && !isInline(url)) remember(removed, url);
    element.remove();
  }
}

function disarmLoadChanges(document: Document): void {
  for (const meta of document.querySelectorAll("meta[http-equiv]")) meta.remove();
  for (const template of document.querySelectorAll("template")) {
    for (const name of SHADOW_ROOT_ATTRIBUTES) template.removeAttribute(name);
  }
}

function removeRemoteLink(link: Element, removed: Set<string>): void {
  const href = link.getAttribute("href") ?? "";
  if (!href || isInline(href)) return;
  const library = /stylesheet/iu.test(link.getAttribute("rel") ?? "") ? undefined : libraryFor(href);
  if (!library) remember(removed, href);
  link.remove();
}

function stripMediaSources(element: Element, removed: Set<string>): void {
  stripSrcset(element, removed);
  for (const name of MEDIA_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value === null || isInline(value) || (name === "data" && element.tagName !== "OBJECT")) continue;
    remember(removed, value);
    element.removeAttribute(name);
  }
}

function collectStyleUrls(document: Document, removed: Set<string>): void {
  for (const style of document.querySelectorAll("style")) cssUrls(style.textContent ?? "", removed);
  for (const element of document.querySelectorAll("[style]")) cssUrls(element.getAttribute("style") ?? "", removed);
}

export function prepareHtml(source: string): PreparedHtml {
  const document = new DOMParser().parseFromString(source, "text/html");
  const libraries = new Set<FrameLibrary>();
  const removed = new Set<string>();
  swapLibraryScripts(document, libraries, removed);
  removeEmbeds(document, removed);
  disarmLoadChanges(document);
  for (const link of document.querySelectorAll("link")) removeRemoteLink(link, removed);
  for (const element of document.querySelectorAll("[src], [poster], [data], [background], [srcset]")) stripMediaSources(element, removed);
  collectStyleUrls(document, removed);
  if (document.querySelector(BABEL_SCRIPTS)) libraries.add("babel");
  const scripts = libraries.size > 0 || runsScripts(document) || changesWhenLoaded(document);
  return { document, libraries: [...libraries], removed: [...removed], scripts };
}

function changesWhenLoaded(document: Document): boolean {
  const html = `<!doctype html><html><head>${document.head.innerHTML}</head>${document.body.outerHTML}</html>`;
  const loaded = new DOMParser().parseFromString(html, "text/html");
  return runsScripts(loaded) || loaded.querySelector(LOAD_CHANGES) !== null;
}

function shellOpen(document: Document): string {
  const shell = document.documentElement.cloneNode(false) as HTMLElement;
  const html = shell.outerHTML;
  return html.slice(0, html.lastIndexOf("</html>"));
}

function themed(document: Document, theme: FrameTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  if (!root.getAttribute("lang")) root.setAttribute("lang", "en");
}

export function globalsFor(libraries: readonly FrameLibrary[]): string[] {
  return [...new Set(libraries.flatMap((library) => LIBRARY_GLOBALS[library]))];
}

function babelStart(prepared: PreparedHtml, messages: FrameMessages): string {
  if (!prepared.libraries.includes("babel")) return "";
  return `document.addEventListener("DOMContentLoaded", () => __oleaflyArtifact.runScripts(${inlineJson(messages)}), { once: true });`;
}

function libraryBoot(prepared: PreparedHtml, globals: readonly string[], messages: FrameMessages, runtime: string): string {
  const start = `__oleaflyArtifact.expose(${inlineJson(globals)});${babelStart(prepared, messages)}`;
  return `${runtimeScript(runtime)}${withRuntime(start, messages)}`;
}

export function htmlFrameDocument(prepared: PreparedHtml, options: FrameOptions, runtime: string | null): string {
  const { document } = prepared;
  themed(document, options.theme);
  const globals = globalsFor(prepared.libraries);
  const loaded = globals.length > 0 ? runtime : null;
  const boot = loaded === null ? "" : libraryBoot(prepared, globals, options.messages, loaded);
  return `<!doctype html>${shellOpen(document)}<head>${headStart(options, loaded)}${boot}${document.head.innerHTML}</head>${document.body.outerHTML}</html>`;
}

export function reactFrameDocument(code: string, options: FrameOptions, runtime: string): string {
  const darkClass = options.theme === "dark" ? ' class="dark"' : "";
  const start = `__oleaflyArtifact.runReact(${inlineJson(code)}, ${inlineJson(options.messages)});`;
  return `<!doctype html><html lang="en" data-theme="${options.theme}"${darkClass} style="color-scheme:${options.theme}"><head>${headStart(options, runtime)}<style>:where(body){padding:0}</style>${runtimeScript(runtime)}</head><body><div id="root"></div>${withRuntime(start, options.messages)}</body></html>`;
}

export function staticFrameDocument(cleanHtml: string, theme: FrameTheme): string {
  return `<!doctype html><html lang="en" data-theme="${theme}" style="color-scheme:${theme}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeAttribute(STATIC_POLICY)}"><style>${baseStyle(theme)}</style></head><body>${cleanHtml}</body></html>`;
}

export function frameChannel(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface FrameSize {
  type: "size";
  height: number;
}

export type FrameMessage = { type: "beat" } | FrameSize;

function onChannel(data: unknown, channel: string): Record<string, unknown> | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  return record.channel === channel ? record : null;
}

export function isPortOffer(data: unknown, channel: string): boolean {
  return onChannel(data, channel)?.type === "port";
}

export function readFrameMessage(data: unknown, channel: string): FrameMessage | null {
  const record = onChannel(data, channel);
  if (record === null) return null;
  if (record.type === "beat") return { type: "beat" };
  if (record.type === "size" && typeof record.height === "number" && Number.isFinite(record.height) && record.height >= 0)
    return { type: "size", height: record.height };
  return null;
}
