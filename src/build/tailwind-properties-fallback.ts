import type { Plugin } from "vite";

export const TAILWIND_PROPERTIES_FALLBACK_CONDITION =
  "((-webkit-hyphens: none) and (not (margin-trim: inline))) or ((-moz-orient: inline) and (not (color:rgb(from red r g b))))";

export const TAILWIND_PROPERTY_FALLBACK_ATTRIBUTE = "data-tw-property-fallback";

export interface FallbackGateResult {
  code: string;
  gated: number;
  retained: string[];
}

interface FallbackRule {
  selector: string;
  declarations: string[];
}

const SUPPORTS = "@supports";
const CSS_MODULE = /\.css(?:$|[?#])/;
const NON_STYLE_QUERY = /[?&](?:raw|url)(?:$|[&=])/;
const PROPERTY_RULE = /@property\s+(--[\w-]+)/g;
const CUSTOM_DECLARATION = /(--[\w-]+)\s*:/g;
const GATE = `[${TAILWIND_PROPERTY_FALLBACK_ATTRIBUTE}]`;
const SCOPED_SELECTORS: Record<string, string[]> = {
  "*": [GATE, `${GATE} *`],
  ":root": [GATE],
  "::before": [`${GATE}::before`, `${GATE} ::before`],
  ":before": [`${GATE}::before`, `${GATE} ::before`],
  "::after": [`${GATE}::after`, `${GATE} ::after`],
  ":after": [`${GATE}::after`, `${GATE} ::after`],
  "::backdrop": [`${GATE}::backdrop`, `${GATE} ::backdrop`],
};

function conditionFingerprint(condition: string): string {
  return condition.replace(/[\s()]/g, "").toLowerCase();
}

const FALLBACK_FINGERPRINT = conditionFingerprint(TAILWIND_PROPERTIES_FALLBACK_CONDITION);

export function isTailwindPropertiesFallbackCondition(condition: string): boolean {
  return conditionFingerprint(condition) === FALLBACK_FINGERPRINT;
}

export function gateFallbackSelector(selector: string): string | null {
  const scoped: string[] = [];
  for (const part of selector.split(",")) {
    const mapped = SCOPED_SELECTORS[part.trim().toLowerCase()];
    if (!mapped) return null;
    for (const entry of mapped) if (!scoped.includes(entry)) scoped.push(entry);
  }
  return scoped.join(",");
}

function skipStringOrComment(css: string, index: number): number {
  const char = css[index];
  if (char === "\\") return Math.min(index + 2, css.length);
  if (char === "/" && css[index + 1] === "*") {
    const close = css.indexOf("*/", index + 2);
    return close === -1 ? css.length : close + 2;
  }
  if (char !== '"' && char !== "'") return index;
  let cursor = index + 1;
  while (cursor < css.length && css[cursor] !== char) {
    cursor += css[cursor] === "\\" ? 2 : 1;
  }
  return Math.min(cursor + 1, css.length);
}

function findCodeChar(css: string, from: number, targets: string): number {
  let index = from;
  while (index < css.length) {
    const skipped = skipStringOrComment(css, index);
    if (skipped !== index) {
      index = skipped;
      continue;
    }
    if (targets.includes(css[index])) return index;
    index += 1;
  }
  return -1;
}

function blockEnd(css: string, open: number): number {
  let depth = 0;
  let index = open;
  while (index < css.length) {
    const skipped = skipStringOrComment(css, index);
    if (skipped !== index) {
      index = skipped;
      continue;
    }
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  return -1;
}

function splitDeclarations(body: string): string[] {
  const declarations: string[] = [];
  let start = 0;
  for (;;) {
    const semicolon = findCodeChar(body, start, ";");
    const end = semicolon === -1 ? body.length : semicolon;
    const declaration = body.slice(start, end).trim();
    if (declaration) declarations.push(declaration);
    if (semicolon === -1) return declarations;
    start = semicolon + 1;
  }
}

function parseRules(body: string): FallbackRule[] | null {
  const rules: FallbackRule[] = [];
  let cursor = 0;
  for (;;) {
    const open = findCodeChar(body, cursor, "{};@");
    if (open === -1) {
      return body.slice(cursor).replace(/\/\*[\s\S]*?\*\//g, "").trim() ? null : rules;
    }
    if (body[open] !== "{") return null;
    const end = blockEnd(body, open);
    if (end === -1) return null;
    const inner = body.slice(open + 1, end - 1);
    if (findCodeChar(inner, 0, "{}@") !== -1) return null;
    rules.push({ selector: body.slice(cursor, open).trim(), declarations: splitDeclarations(inner) });
    cursor = end;
  }
}

function propertyName(declaration: string): string {
  const colon = declaration.indexOf(":");
  return colon === -1 ? declaration : declaration.slice(0, colon).trim();
}

function registeredProperties(css: string): Set<string> {
  return new Set([...css.matchAll(PROPERTY_RULE)].map((match) => match[1]));
}

function rewriteBlock(
  prelude: string,
  body: string,
  registered: Set<string>,
): { replacement: string | null; retained: string[] } {
  const rules = parseRules(body);
  if (!rules) {
    return { replacement: null, retained: [...body.matchAll(CUSTOM_DECLARATION)].map((match) => match[1]) };
  }
  const gatedRules: string[] = [];
  const keptRules: string[] = [];
  const retained: string[] = [];
  for (const rule of rules) {
    const scoped = gateFallbackSelector(rule.selector);
    const movable = scoped === null ? [] : rule.declarations.filter((declaration) => registered.has(propertyName(declaration)));
    const staying = rule.declarations.filter((declaration) => !movable.includes(declaration));
    if (movable.length > 0) gatedRules.push(`${scoped}{${movable.join(";")}}`);
    if (staying.length > 0) {
      keptRules.push(`${rule.selector}{${staying.join(";")}}`);
      retained.push(...staying.map(propertyName));
    }
  }
  if (gatedRules.length === 0) return { replacement: null, retained };
  const kept = keptRules.length > 0 ? `${SUPPORTS}${prelude}{${keptRules.join("")}}` : "";
  return { replacement: gatedRules.join("") + kept, retained };
}

export function gateTailwindPropertiesFallback(css: string): FallbackGateResult {
  if (!css.includes(SUPPORTS)) return { code: css, gated: 0, retained: [] };
  const registered = registeredProperties(css);
  const retained: string[] = [];
  let gated = 0;
  let output = "";
  let copied = 0;
  let index = 0;
  while (index < css.length) {
    const skipped = skipStringOrComment(css, index);
    if (skipped !== index) {
      index = skipped;
      continue;
    }
    if (css[index] !== "@" || css.slice(index, index + SUPPORTS.length).toLowerCase() !== SUPPORTS) {
      index += 1;
      continue;
    }
    const preludeStart = index + SUPPORTS.length;
    const open = findCodeChar(css, preludeStart, "{;");
    const prelude = open === -1 ? "" : css.slice(preludeStart, open);
    const end = open !== -1 && css[open] === "{" ? blockEnd(css, open) : -1;
    if (end === -1 || !isTailwindPropertiesFallbackCondition(prelude)) {
      index = preludeStart;
      continue;
    }
    const rewrite = rewriteBlock(prelude, css.slice(open + 1, end - 1), registered);
    retained.push(...rewrite.retained);
    if (rewrite.replacement !== null) {
      gated += 1;
      output += css.slice(copied, index) + rewrite.replacement;
      copied = end;
    }
    index = end;
  }
  return { code: copied === 0 ? css : output + css.slice(copied), gated, retained };
}

function isStyleModule(id: string): boolean {
  return CSS_MODULE.test(id) && !NON_STYLE_QUERY.test(id);
}

export function tailwindPropertiesFallbackPlugin(): Plugin {
  let gatedInBuild = 0;
  return {
    name: "gate-tailwind-properties-fallback",
    buildStart() {
      gatedInBuild = 0;
    },
    transform(code, id) {
      if (!isStyleModule(id)) return null;
      const result = gateTailwindPropertiesFallback(code);
      gatedInBuild += result.gated;
      if (result.retained.length > 0) {
        this.warn(`kept Tailwind's @supports fallback for properties without @property: ${result.retained.join(", ")}`);
      }
      return result.code === code ? null : { code: result.code, map: null };
    },
    generateBundle(_options, bundle) {
      let tailwindOutput = false;
      for (const output of Object.values(bundle)) {
        if (output.type !== "asset" || !output.fileName.endsWith(".css")) continue;
        const source = typeof output.source === "string" ? output.source : new TextDecoder().decode(output.source);
        tailwindOutput ||= source.includes("@property --tw-");
        const result = gateTailwindPropertiesFallback(source);
        gatedInBuild += result.gated;
        if (result.code !== source) output.source = result.code;
      }
      if (tailwindOutput && gatedInBuild === 0) {
        this.warn(
          "Tailwind @property output was emitted but no @supports fallback block was gated; check TAILWIND_PROPERTIES_FALLBACK_CONDITION against the installed tailwindcss",
        );
      }
    },
  };
}
