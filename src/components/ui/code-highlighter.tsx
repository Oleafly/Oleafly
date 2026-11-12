import { memo, useEffect, useState, type ReactNode } from "react";
import type { Language, StreamParser } from "@codemirror/language";
import type { tags } from "@lezer/highlight";
import { cn } from "@/lib/utils";
import { RenderCache } from "./render-cache";

const MAX_HIGHLIGHT_LENGTH = 50_000;
const MAX_CACHED_BLOCKS = 300;
const MAX_CACHED_BLOCK_CHARS = 2_000_000;

type ParserLoader = () => Promise<StreamParser<unknown>>;

const clike = () => import("@codemirror/legacy-modes/mode/clike");
const javascriptModes = () => import("@codemirror/legacy-modes/mode/javascript");
const cssModes = () => import("@codemirror/legacy-modes/mode/css");
const xmlModes = () => import("@codemirror/legacy-modes/mode/xml");

const parserLoaders: Record<string, ParserLoader> = {
  c: () => clike().then(({ c }) => c),
  cpp: () => clike().then(({ cpp }) => cpp),
  csharp: () => clike().then(({ csharp }) => csharp),
  css: () => cssModes().then(({ css }) => css),
  diff: () => import("@codemirror/legacy-modes/mode/diff").then(({ diff }) => diff),
  dockerfile: () => import("@codemirror/legacy-modes/mode/dockerfile").then(({ dockerFile }) => dockerFile),
  fortran: () => import("@codemirror/legacy-modes/mode/fortran").then(({ fortran }) => fortran),
  go: () => import("@codemirror/legacy-modes/mode/go").then(({ go }) => go),
  haskell: () => import("@codemirror/legacy-modes/mode/haskell").then(({ haskell }) => haskell),
  html: () => xmlModes().then(({ html }) => html),
  java: () => clike().then(({ java }) => java),
  javascript: () => javascriptModes().then(({ javascript }) => javascript),
  json: () => javascriptModes().then(({ json }) => json),
  julia: () => import("@codemirror/legacy-modes/mode/julia").then(({ julia }) => julia),
  kotlin: () => clike().then(({ kotlin }) => kotlin),
  latex: () => import("@codemirror/legacy-modes/mode/stex").then(({ stex }) => stex),
  lua: () => import("@codemirror/legacy-modes/mode/lua").then(({ lua }) => lua),
  mathematica: () => import("@codemirror/legacy-modes/mode/mathematica").then(({ mathematica }) => mathematica),
  octave: () => import("@codemirror/legacy-modes/mode/octave").then(({ octave }) => octave),
  perl: () => import("@codemirror/legacy-modes/mode/perl").then(({ perl }) => perl),
  powershell: () => import("@codemirror/legacy-modes/mode/powershell").then(({ powerShell }) => powerShell),
  python: () => import("@codemirror/legacy-modes/mode/python").then(({ python }) => python),
  r: () => import("@codemirror/legacy-modes/mode/r").then(({ r }) => r),
  ruby: () => import("@codemirror/legacy-modes/mode/ruby").then(({ ruby }) => ruby),
  rust: () => import("@codemirror/legacy-modes/mode/rust").then(({ rust }) => rust),
  sas: () => import("@codemirror/legacy-modes/mode/sas").then(({ sas }) => sas),
  sass: () => import("@codemirror/legacy-modes/mode/sass").then(({ sass }) => sass),
  scala: () => clike().then(({ scala }) => scala),
  scss: () => cssModes().then(({ sCSS }) => sCSS),
  shell: () => import("@codemirror/legacy-modes/mode/shell").then(({ shell }) => shell),
  sql: () => import("@codemirror/legacy-modes/mode/sql").then(({ standardSQL }) => standardSQL),
  swift: () => import("@codemirror/legacy-modes/mode/swift").then(({ swift }) => swift),
  toml: () => import("@codemirror/legacy-modes/mode/toml").then(({ toml }) => toml),
  typescript: () => javascriptModes().then(({ typescript }) => typescript),
  xml: () => xmlModes().then(({ xml }) => xml),
  yaml: () => import("@codemirror/legacy-modes/mode/yaml").then(({ yaml }) => yaml),
};

const aliases: Record<string, string> = {
  bash: "shell",
  "c++": "cpp",
  cc: "cpp",
  cjs: "javascript",
  console: "shell",
  cs: "csharp",
  cxx: "cpp",
  docker: "dockerfile",
  f90: "fortran",
  golang: "go",
  h: "c",
  hpp: "cpp",
  hs: "haskell",
  ipython: "python",
  jl: "julia",
  js: "javascript",
  jsx: "javascript",
  kt: "kotlin",
  m: "octave",
  matlab: "octave",
  mjs: "javascript",
  mysql: "sql",
  node: "javascript",
  patch: "diff",
  pl: "perl",
  postgres: "sql",
  postgresql: "sql",
  ps1: "powershell",
  py: "python",
  python3: "python",
  rb: "ruby",
  rs: "rust",
  rscript: "r",
  sh: "shell",
  sqlite: "sql",
  svg: "xml",
  tex: "latex",
  ts: "typescript",
  tsx: "typescript",
  wolfram: "mathematica",
  yml: "yaml",
  zsh: "shell",
};

export const HIGHLIGHT_LANGUAGES: readonly string[] = Object.keys(parserLoaders);

const languageCache = new Map<string, Promise<Language | null>>();
const loadedLanguages = new Map<string, Language>();
let lezer: typeof import("@lezer/highlight") | null = null;
const highlightCache = new RenderCache<ReactNode[]>(MAX_CACHED_BLOCKS, MAX_CACHED_BLOCK_CHARS);

export function highlightLanguageName(language: string): string | undefined {
  const normalized = language.toLowerCase();
  const name = Object.hasOwn(aliases, normalized) ? aliases[normalized] : normalized;
  return Object.hasOwn(parserLoaders, name) ? name : undefined;
}

export function loadHighlightLanguage(language: string): Promise<Language | null> {
  const name = highlightLanguageName(language);
  if (!name) return Promise.resolve(null);
  const cached = languageCache.get(name);
  if (cached) return cached;
  const pending = Promise.all([
    import("@codemirror/language"),
    import("@lezer/highlight"),
    parserLoaders[name](),
  ])
    .then(([{ StreamLanguage }, lezerHighlight, parser]) => {
      const language = StreamLanguage.define({
        ...parser,
        tokenTable: { ...legacyTokenTags(lezerHighlight.tags), ...parser.tokenTable },
      });
      lezer = lezerHighlight;
      loadedLanguages.set(name, language);
      return language;
    })
    .catch(() => null);
  languageCache.set(name, pending);
  return pending;
}

export function legacyTokenTags(t: typeof tags) {
  return {
    attribute: t.attributeName,
    builtin: t.standard(t.variableName),
    def: t.definition(t.variableName),
    error: t.invalid,
    header: t.heading,
    property: t.propertyName,
    qualifier: t.modifier,
    "string-2": t.special(t.string),
    tag: t.tagName,
    type: t.typeName,
    variable: t.variableName,
    "variable-2": t.special(t.variableName),
  };
}

export interface TokenSpan {
  readonly from: number;
  readonly to: number;
  readonly classes: string;
}

export function tokenSpans(language: string, text: string): TokenSpan[] | null {
  const name = highlightLanguageName(language);
  const loaded = name ? loadedLanguages.get(name) : undefined;
  if (!loaded || !lezer) return null;
  if (text.length > MAX_HIGHLIGHT_LENGTH) return [];
  const spans: TokenSpan[] = [];
  let position = 0;
  lezer.highlightCode(
    text,
    loaded.parser.parse(text),
    lezer.classHighlighter,
    (piece, classes) => {
      if (classes) spans.push({ from: position, to: position + piece.length, classes });
      position += piece.length;
    },
    () => {
      position += 1;
    },
  );
  return spans;
}

async function highlight(source: string, languageName: string) {
  await loadHighlightLanguage(languageName);
  const spans = tokenSpans(languageName, source);
  if (!spans) return null;
  const nodes: ReactNode[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.from > at) nodes.push(source.slice(at, span.from));
    nodes.push(
      <span key={span.from} className={span.classes}>
        {source.slice(span.from, span.to)}
      </span>,
    );
    at = span.to;
  }
  if (at < source.length) nodes.push(source.slice(at));
  return nodes;
}

function highlightKeyFor(language: string | undefined, source: string) {
  return `${language ?? ""} ${source}`;
}

export function clearHighlightCache(): void {
  highlightCache.clear();
}

export function isHighlightCached(language: string | undefined, source: string): boolean {
  return highlightCache.has(highlightKeyFor(language, source));
}

export const HighlightedCode = memo(function HighlightedCode({
  className,
  language,
  source,
}: {
  className?: string;
  language?: string;
  source: string;
}) {
  const highlightKey = highlightKeyFor(language, source);
  const [highlighted, setHighlighted] = useState<{
    key: string;
    nodes: ReactNode[];
  } | null>(null);
  const cachedNodes = highlightCache.get(highlightKey);

  useEffect(() => {
    if (!language || source.length > MAX_HIGHLIGHT_LENGTH) return;
    if (highlightCache.has(highlightKey)) return;
    let current = true;
    const timer = window.setTimeout(() => {
      void highlight(source, language).then(
        (nodes) => {
          if (!nodes) return;
          highlightCache.set(highlightKey, nodes, source.length + 1);
          if (current) setHighlighted({ key: highlightKey, nodes });
        },
        () => undefined,
      );
    }, 0);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [highlightKey, language, source]);

  const nodes =
    cachedNodes ?? (highlighted?.key === highlightKey ? highlighted.nodes : null);

  return (
    <code className={cn("code-tokens font-mono", className)} data-language={language}>
      {nodes ? <span>{nodes}</span> : source}
    </code>
  );
});
