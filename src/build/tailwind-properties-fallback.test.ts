import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { compile } from "tailwindcss";
import { describe, expect, it, vi } from "vitest";
import {
  gateFallbackSelector,
  gateTailwindPropertiesFallback,
  isTailwindPropertiesFallbackCondition,
  TAILWIND_PROPERTIES_FALLBACK_CONDITION,
  TAILWIND_PROPERTY_FALLBACK_ATTRIBUTE,
  tailwindPropertiesFallbackPlugin,
} from "./tailwind-properties-fallback";

type Warn = { warn: (message: string) => void };
type TransformHook = (this: Warn, code: string, id: string) => { code: string; map: null } | null;
type BundleOutput = { type: "asset"; fileName: string; source: string | Uint8Array } | { type: "chunk"; fileName: string; code: string };
type GenerateBundleHook = (this: Warn, options: unknown, bundle: Record<string, BundleOutput>) => void;
type BuildStartHook = () => void;

const A = `[${TAILWIND_PROPERTY_FALLBACK_ATTRIBUTE}]`;
const EVERY_ELEMENT = `${A},${A} *,${A}::before,${A} ::before,${A}::after,${A} ::after,${A}::backdrop,${A} ::backdrop`;

const MINIFIED_CONDITION =
  "(((-webkit-hyphens:none)) and (not (margin-trim:inline))) or ((-moz-orient:inline) and (not (color:rgb(from red r g b))))";

const PROPERTIES = [
  "@property --tw-translate-x{syntax:\"*\";inherits:false;initial-value:0}",
  "@property --tw-content{syntax:\"*\";inherits:false;initial-value:\"\"}",
  "@property --tw-shadow{syntax:\"*\";inherits:false;initial-value:0 0 #0000}",
].join("");

const FALLBACK = `@supports ${TAILWIND_PROPERTIES_FALLBACK_CONDITION} {\n    *, ::before, ::after, ::backdrop {\n      --tw-translate-x: 0;\n      --tw-content: "";\n      --tw-shadow: 0 0 #0000;\n    }\n  }`;

const GATED = `${EVERY_ELEMENT}{--tw-translate-x: 0;--tw-content: "";--tw-shadow: 0 0 #0000}`;

const BEFORE = [
  "/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */",
  "@layer properties;",
  `/* @supports ${TAILWIND_PROPERTIES_FALLBACK_CONDITION} { * { --tw-x: 0 } } */`,
  ".before\\:content-\\[\\'\\'\\]::before { --tw-content: ''; content: var(--tw-content); }",
  `.quoted::after { content: "@supports ${TAILWIND_PROPERTIES_FALLBACK_CONDITION} {"; }`,
  "@supports (color: color-mix(in lab, red, red)) { .bg-red\\/50 { background-color: color-mix(in oklab, red 50%, transparent); } }",
  "@supports ((-webkit-hyphens: none)) { .hyphens { -webkit-hyphens: none; } }",
  "@layer properties {\n  ",
].join("\n");

const AFTER = `\n}\n.shadow { box-shadow: var(--tw-shadow); }\n${PROPERTIES}`;

function plugin() {
  const instance = tailwindPropertiesFallbackPlugin();
  return {
    transform: instance.transform as unknown as TransformHook,
    generateBundle: instance.generateBundle as unknown as GenerateBundleHook,
    buildStart: instance.buildStart as unknown as BuildStartHook,
  };
}

function replacedBlock(before: string, after: string): { removed: string; inserted: string } {
  const start = before.indexOf("@supports ((-webkit-hyphens");
  let depth = 0;
  let end = before.indexOf("{", start);
  for (; end < before.length; end += 1) {
    if (before[end] === "{") depth += 1;
    if (before[end] === "}" && --depth === 0) break;
  }
  end += 1;
  const tail = before.length - end;
  expect(after.slice(0, start)).toBe(before.slice(0, start));
  expect(after.slice(after.length - tail)).toBe(before.slice(end));
  return { removed: before.slice(start, end), inserted: after.slice(start, after.length - tail) };
}

function installedTailwindConditions(): string[] {
  const require = createRequire(import.meta.url);
  const dist = dirname(require.resolve("tailwindcss"));
  const source = readFileSync(join(dist, "lib.mjs"), "utf8");
  return [...source.matchAll(/"([^"\\]*margin-trim[^"\\]*)"/g)].map((match) => match[1]);
}

function indexHtmlHead(): string {
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
  const start = html.indexOf("<head>");
  return html.slice(start, html.indexOf("</head>", start));
}

function gateScript(): string {
  const scripts = [...indexHtmlHead().matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((match) => match[1]);
  const gates = scripts.filter((script) => script.includes(TAILWIND_PROPERTY_FALLBACK_ATTRIBUTE));
  expect(gates).toHaveLength(1);
  return gates[0];
}

function runGate(globals: Record<string, unknown>) {
  const setAttribute = vi.fn();
  runInNewContext(gateScript(), { ...globals, document: { documentElement: { setAttribute } } });
  return setAttribute;
}

describe("gateTailwindPropertiesFallback", () => {
  it("moves the fallback behind the root attribute and leaves neighbouring rules byte for byte", () => {
    const result = gateTailwindPropertiesFallback(BEFORE + FALLBACK + AFTER);
    expect(result).toEqual({ code: BEFORE + GATED + AFTER, gated: 1, retained: [] });
  });

  it("matches the minified condition that the CSS minifier writes", () => {
    const block = `@supports ${MINIFIED_CONDITION}{*,:before,:after,::backdrop{--tw-translate-x:0;--tw-content:"";--tw-shadow:0 0 #0000}}`;
    const css = `@layer properties{${block}}.a{color:red}${PROPERTIES}`;
    expect(gateTailwindPropertiesFallback(css)).toEqual({
      code: `@layer properties{${EVERY_ELEMENT}{--tw-translate-x:0;--tw-content:"";--tw-shadow:0 0 #0000}}.a{color:red}${PROPERTIES}`,
      gated: 1,
      retained: [],
    });
  });

  it("keeps the @supports fallback for variables without @property and for selectors it cannot scope", () => {
    const block = `@supports ${MINIFIED_CONDITION}{:root,:host{--tw-unregistered-root:1}*,:before{--tw-translate-x:0;--tw-unregistered:initial}}`;
    expect(gateTailwindPropertiesFallback(`${block}${PROPERTIES}`)).toEqual({
      code: `${A},${A} *,${A}::before,${A} ::before{--tw-translate-x:0}@supports ${MINIFIED_CONDITION}{:root,:host{--tw-unregistered-root:1}*,:before{--tw-unregistered:initial}}${PROPERTIES}`,
      gated: 1,
      retained: ["--tw-unregistered-root", "--tw-unregistered"],
    });
  });

  it("scopes a :root rule to the attribute and leaves a :host rule in place", () => {
    const root = `@supports ${MINIFIED_CONDITION}{:root{--tw-shadow:0 0 #0000}}`;
    expect(gateTailwindPropertiesFallback(`${root}${PROPERTIES}`).code).toBe(`${A}{--tw-shadow:0 0 #0000}${PROPERTIES}`);
    const host = `@supports ${MINIFIED_CONDITION}{:root,:host{--tw-shadow:0 0 #0000}}`;
    expect(gateTailwindPropertiesFallback(`${host}${PROPERTIES}`)).toEqual({
      code: `${host}${PROPERTIES}`,
      gated: 0,
      retained: ["--tw-shadow"],
    });
  });

  it("keeps the whole block when no @property rule shares its stylesheet", () => {
    const css = `@supports ${MINIFIED_CONDITION}{*{--tw-translate-x:0}}`;
    expect(gateTailwindPropertiesFallback(css)).toEqual({ code: css, gated: 0, retained: ["--tw-translate-x"] });
  });

  it("leaves a block with an unexpected shape untouched", () => {
    const nested = `@supports ${MINIFIED_CONDITION}{@media print{*{--tw-translate-x:0}}}`;
    const stray = `@supports ${MINIFIED_CONDITION}{*{--tw-shadow:0 0 #0000}stray}`;
    const css = `${nested}${stray}${PROPERTIES}`;
    expect(gateTailwindPropertiesFallback(css)).toEqual({
      code: css,
      gated: 0,
      retained: ["--tw-translate-x", "--tw-shadow"],
    });
  });

  it("keeps declarations it cannot name and reads escaped quotes inside strings", () => {
    const block = `@supports ${MINIFIED_CONDITION}{*{--tw-content:"a\\"}b";--tw-translate-x:0;stray-token}}`;
    expect(gateTailwindPropertiesFallback(`${block}${PROPERTIES}`)).toEqual({
      code: `${A},${A} *{--tw-content:"a\\"}b";--tw-translate-x:0}@supports ${MINIFIED_CONDITION}{*{stray-token}}${PROPERTIES}`,
      gated: 1,
      retained: ["stray-token"],
    });
  });

  it("ignores other @supports rules, statements and unterminated input", () => {
    const css = [
      "@supports (display: grid) { .grid { display: grid; } }",
      `@supports ${MINIFIED_CONDITION};`,
      `@SUPPORTS not (${TAILWIND_PROPERTIES_FALLBACK_CONDITION}) { .x { color: red; } }`,
      `.unterminated { content: "x`,
    ].join("\n");
    expect(gateTailwindPropertiesFallback(css)).toEqual({ code: css, gated: 0, retained: [] });
    expect(gateTailwindPropertiesFallback(`@supports ${MINIFIED_CONDITION}`).gated).toBe(0);
    expect(gateTailwindPropertiesFallback(`@supports ${MINIFIED_CONDITION}{*{--a:0}`).gated).toBe(0);
    expect(gateTailwindPropertiesFallback(`/* @supports ${MINIFIED_CONDITION}{} `).gated).toBe(0);
    expect(gateTailwindPropertiesFallback(".a { color: red }").code).toBe(".a { color: red }");
  });

  it("compares conditions without regard to whitespace, parentheses or case", () => {
    expect(isTailwindPropertiesFallbackCondition(` ${MINIFIED_CONDITION.toUpperCase()} `)).toBe(true);
    expect(isTailwindPropertiesFallbackCondition("((-webkit-hyphens: none) and (not (margin-trim: inline)))")).toBe(false);
  });

  it("scopes every selector Tailwind uses and refuses the rest", () => {
    expect(gateFallbackSelector("*, ::before, ::after, ::backdrop")).toBe(EVERY_ELEMENT);
    expect(gateFallbackSelector("*,:before,:after,::backdrop")).toBe(EVERY_ELEMENT);
    expect(gateFallbackSelector(":before, ::BEFORE")).toBe(`${A}::before,${A} ::before`);
    expect(gateFallbackSelector(":root")).toBe(A);
    expect(gateFallbackSelector(":host")).toBeNull();
    expect(gateFallbackSelector("*, .x")).toBeNull();
  });
});

describe("installed tailwindcss", () => {
  it("still emits the @supports condition the plugin matches", () => {
    const conditions = installedTailwindConditions();
    expect(conditions).toEqual([TAILWIND_PROPERTIES_FALLBACK_CONDITION]);
    expect(isTailwindPropertiesFallbackCondition(conditions[0])).toBe(true);
  });

  it("produces a fallback whose every variable is registered, and the plugin gates exactly that block", async () => {
    const compiler = await compile("@tailwind utilities;");
    const css = compiler.build([
      "translate-x-[3px]",
      "rotate-45",
      "scale-[1.02]",
      "border",
      "shadow-[0_0_1px_red]",
      "ring-[3px]",
      "blur-[2px]",
      "backdrop-blur-[4px]",
      "bg-linear-to-r",
      "before:content-['']",
      "duration-[150ms]",
    ]);
    const registered = [...css.matchAll(/@property (--[\w-]+)/g)].map((match) => match[1]);
    expect(registered.length).toBeGreaterThan(20);

    const result = gateTailwindPropertiesFallback(css);
    expect(result.gated).toBe(1);
    expect(result.retained).toEqual([]);

    const { removed, inserted } = replacedBlock(css, result.code);
    expect(removed.startsWith(`@supports ${TAILWIND_PROPERTIES_FALLBACK_CONDITION} {`)).toBe(true);
    expect(removed.endsWith("}")).toBe(true);
    expect(inserted.startsWith(`${EVERY_ELEMENT}{`)).toBe(true);
    const names = (text: string) => [...text.matchAll(/(--[\w-]+):/g)].map((match) => match[1]);
    expect(names(inserted)).toEqual(names(removed));
    expect(new Set(names(inserted))).toEqual(new Set(registered));

    expect(result.code).not.toContain("margin-trim");
    expect([...result.code.matchAll(/@property (--[\w-]+)/g)].map((match) => match[1])).toEqual(registered);
    const layers = [...result.code.matchAll(/@layer properties \{([\s\S]*?)\n\}/g)].map((match) => match[1].trim());
    expect(layers).toEqual([inserted]);
  });
});

describe("runtime gate in index.html", () => {
  it("sets the attribute only when the engine has no CSSPropertyRule", () => {
    const missing = runGate({});
    expect(missing).toHaveBeenCalledWith(TAILWIND_PROPERTY_FALLBACK_ATTRIBUTE, "");
    expect(runGate({ CSSPropertyRule: class {} })).not.toHaveBeenCalled();
  });

  it("runs from the head before any stylesheet or module script", () => {
    const head = indexHtmlHead();
    const gate = head.indexOf(TAILWIND_PROPERTY_FALLBACK_ATTRIBUTE);
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(head.indexOf('<link rel="stylesheet"'));
    expect(head.slice(0, gate)).not.toMatch(/<script[^>]*type="module"/);
  });
});

describe("tailwindPropertiesFallbackPlugin", () => {
  const css = BEFORE + FALLBACK + AFTER;

  it("gates stylesheet modules during transform and skips everything else", () => {
    const hooks = plugin();
    const context = { warn: vi.fn() };
    expect(hooks.transform.call(context, css, "/app/src/styles/globals.css")).toEqual({ code: BEFORE + GATED + AFTER, map: null });
    expect(hooks.transform.call(context, css, "/app/src/styles/globals.css?direct")).toEqual({ code: BEFORE + GATED + AFTER, map: null });
    expect(hooks.transform.call(context, css, "/app/src/styles/globals.css?raw")).toBeNull();
    expect(hooks.transform.call(context, css, "/app/src/styles/globals.css?url")).toBeNull();
    expect(hooks.transform.call(context, css, "/app/src/main.tsx")).toBeNull();
    expect(hooks.transform.call(context, ".a { color: red }", "/app/src/other.css")).toBeNull();
    expect(context.warn).not.toHaveBeenCalled();
  });

  it("warns when a fallback has to stay for unregistered variables", () => {
    const hooks = plugin();
    const context = { warn: vi.fn() };
    const kept = `@supports ${MINIFIED_CONDITION}{*{--tw-unregistered:0}}`;
    expect(hooks.transform.call(context, kept, "/app/a.css")).toBeNull();
    expect(context.warn).toHaveBeenCalledWith(expect.stringContaining("--tw-unregistered"));
  });

  it("gates emitted CSS assets and leaves chunks and other assets alone", () => {
    const hooks = plugin();
    const context = { warn: vi.fn() };
    const bundle: Record<string, BundleOutput> = {
      "index.css": { type: "asset", fileName: "assets/index.css", source: css },
      "bytes.css": { type: "asset", fileName: "assets/bytes.css", source: new TextEncoder().encode(css) },
      "plain.css": { type: "asset", fileName: "assets/plain.css", source: ".a{color:red}" },
      "index.js": { type: "chunk", fileName: "assets/index.js", code: css },
      "data.json": { type: "asset", fileName: "assets/data.json", source: css },
    };
    hooks.buildStart();
    hooks.generateBundle.call(context, {}, bundle);
    expect(bundle["index.css"]).toMatchObject({ source: BEFORE + GATED + AFTER });
    expect(bundle["bytes.css"]).toMatchObject({ source: BEFORE + GATED + AFTER });
    expect(bundle["plain.css"]).toMatchObject({ source: ".a{color:red}" });
    expect(bundle["index.js"]).toMatchObject({ code: css });
    expect(bundle["data.json"]).toMatchObject({ source: css });
    expect(context.warn).not.toHaveBeenCalled();
  });

  it("does not warn when the transform already gated the block", () => {
    const hooks = plugin();
    const context = { warn: vi.fn() };
    hooks.buildStart();
    const transformed = hooks.transform.call(context, css, "/app/src/styles/globals.css");
    hooks.generateBundle.call(context, {}, {
      "index.css": { type: "asset", fileName: "assets/index.css", source: transformed?.code ?? "" },
    });
    expect(context.warn).not.toHaveBeenCalled();
  });

  it("warns when Tailwind output ships but no fallback block matched", () => {
    const hooks = plugin();
    const context = { warn: vi.fn() };
    const changed = `@supports (not (margin-trim: inline)){*{--tw-shadow:0 0 #0000}}${PROPERTIES}`;
    hooks.buildStart();
    hooks.generateBundle.call(context, {}, {
      "index.css": { type: "asset", fileName: "assets/index.css", source: changed },
    });
    expect(context.warn).toHaveBeenCalledWith(expect.stringContaining("TAILWIND_PROPERTIES_FALLBACK_CONDITION"));
  });
});
