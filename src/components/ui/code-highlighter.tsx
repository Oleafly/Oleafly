import { useEffect, useState, type ReactNode } from "react";
import type { Language, StreamParser } from "@codemirror/language";
import { cn } from "@/lib/utils";

const MAX_HIGHLIGHT_LENGTH = 50_000;

type ParserLoader = () => Promise<StreamParser<unknown>>;

const parserLoaders: Record<string, ParserLoader> = {
  c: () => import("@codemirror/legacy-modes/mode/clike").then(({ c }) => c),
  cpp: () => import("@codemirror/legacy-modes/mode/clike").then(({ cpp }) => cpp),
  csharp: () => import("@codemirror/legacy-modes/mode/clike").then(({ csharp }) => csharp),
  css: () => import("@codemirror/legacy-modes/mode/css").then(({ css }) => css),
  diff: () => import("@codemirror/legacy-modes/mode/diff").then(({ diff }) => diff),
  go: () => import("@codemirror/legacy-modes/mode/go").then(({ go }) => go),
  html: () => import("@codemirror/legacy-modes/mode/xml").then(({ html }) => html),
  java: () => import("@codemirror/legacy-modes/mode/clike").then(({ java }) => java),
  javascript: () =>
    import("@codemirror/legacy-modes/mode/javascript").then(({ javascript }) => javascript),
  json: () => import("@codemirror/legacy-modes/mode/javascript").then(({ json }) => json),
  kotlin: () => import("@codemirror/legacy-modes/mode/clike").then(({ kotlin }) => kotlin),
  latex: () => import("@codemirror/legacy-modes/mode/stex").then(({ stex }) => stex),
  python: () => import("@codemirror/legacy-modes/mode/python").then(({ python }) => python),
  ruby: () => import("@codemirror/legacy-modes/mode/ruby").then(({ ruby }) => ruby),
  rust: () => import("@codemirror/legacy-modes/mode/rust").then(({ rust }) => rust),
  sass: () => import("@codemirror/legacy-modes/mode/sass").then(({ sass }) => sass),
  shell: () => import("@codemirror/legacy-modes/mode/shell").then(({ shell }) => shell),
  sql: () => import("@codemirror/legacy-modes/mode/sql").then(({ standardSQL }) => standardSQL),
  toml: () => import("@codemirror/legacy-modes/mode/toml").then(({ toml }) => toml),
  typescript: () =>
    import("@codemirror/legacy-modes/mode/javascript").then(({ typescript }) => typescript),
  xml: () => import("@codemirror/legacy-modes/mode/xml").then(({ xml }) => xml),
  yaml: () => import("@codemirror/legacy-modes/mode/yaml").then(({ yaml }) => yaml),
};

const aliases: Record<string, string> = {
  bash: "shell",
  cjs: "javascript",
  cs: "csharp",
  h: "c",
  hpp: "cpp",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  patch: "diff",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "sass",
  sh: "shell",
  tex: "latex",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
  zsh: "shell",
};

const languageCache = new Map<string, Promise<Language | null>>();

function loadLanguage(language: string) {
  const normalized = language.toLowerCase();
  const name = aliases[normalized] ?? normalized;
  const cached = languageCache.get(name);
  if (cached) return cached;
  const parserLoader = parserLoaders[name];
  if (!parserLoader) return Promise.resolve(null);
  const pending = Promise.all([import("@codemirror/language"), parserLoader()]).then(
    ([{ StreamLanguage }, parser]) => StreamLanguage.define(parser),
  );
  languageCache.set(name, pending);
  return pending;
}

const tokenColors: Record<string, string> = {
  "tok-atom": "text-[var(--cm-number)]",
  "tok-bool": "text-[var(--cm-number)]",
  "tok-bracket": "text-[var(--cm-bracket)]",
  "tok-comment": "text-[var(--cm-comment)] italic",
  "tok-heading": "text-[var(--cm-meta)]",
  "tok-keyword": "text-[var(--cm-keyword)]",
  "tok-labelName": "text-[var(--cm-meta)]",
  "tok-link": "text-[var(--cm-string)] underline",
  "tok-meta": "text-[var(--cm-meta)]",
  "tok-number": "text-[var(--cm-number)]",
  "tok-operator": "text-[var(--cm-operator)]",
  "tok-propertyName": "text-[var(--cm-variable)]",
  "tok-string": "text-[var(--cm-string)]",
  "tok-string2": "text-[var(--cm-string)]",
  "tok-tagName": "text-[var(--cm-tag)]",
  "tok-typeName": "text-[var(--cm-tag)]",
  "tok-variableName": "text-[var(--cm-variable)]",
};

function styledTokenClasses(classes: string) {
  return cn(
    classes,
    classes.split(" ").map((className) => tokenColors[className]),
  );
}

async function highlight(source: string, languageName: string) {
  const language = await loadLanguage(languageName);
  if (!language) return null;
  const { classHighlighter, highlightCode } = await import("@lezer/highlight");
  const nodes: ReactNode[] = [];
  let key = 0;
  highlightCode(
    source,
    language.parser.parse(source),
    classHighlighter,
    (text, classes) => {
      nodes.push(
        classes ? (
          <span key={key++} className={styledTokenClasses(classes)}>
            {text}
          </span>
        ) : (
          text
        ),
      );
    },
    () => nodes.push("\n"),
  );
  return nodes;
}

export function HighlightedCode({
  className,
  language,
  source,
}: {
  className?: string;
  language?: string;
  source: string;
}) {
  const [highlighted, setHighlighted] = useState<ReactNode[] | null>(null);

  useEffect(() => {
    setHighlighted(null);
    if (!language || source.length > MAX_HIGHLIGHT_LENGTH) return;
    let current = true;
    const timer = window.setTimeout(() => {
      void highlight(source, language).then(
        (nodes) => {
          if (current && nodes) setHighlighted(nodes);
        },
        () => undefined,
      );
    }, 0);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [language, source]);

  return (
    <code className={cn("font-mono", className)} data-language={language}>
      {highlighted ?? source}
    </code>
  );
}
