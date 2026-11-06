import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Copy } from "@/components/icons/pack";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useCopyStatus } from "@/components/ui/use-copy-status";

export function CopyTextButton({ text, testId }: Readonly<{ text: string; testId?: string }>) {
  const { t } = useTranslation(["common", "settings"]);
  const { copied, copy } = useCopyStatus();
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      data-testid={testId}
      disabled={!text}
      onClick={() => void copy(text)}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? t(($) => $.common.actions.copied) : t(($) => $.common.actions.copy)}
    </Button>
  );
}

export type SnippetLang = "json" | "shell" | "toml";

type PushSnippetToken = (cls: string | null, text: string) => void;

const KEY_TEXT = "text-sky-700 dark:text-sky-300";
const STRING_TEXT = "text-emerald-700 dark:text-emerald-400";
const NUMBER_TEXT = "text-amber-700 dark:text-amber-400";
const LITERAL_TEXT = "text-violet-700 dark:text-violet-400";
const PUNCTUATION_TEXT = "text-muted-foreground";
const JSON_PUNCTUATION: ReadonlySet<string> = new Set(["{", "}", "[", "]", ",", ":"]);
const TOML_PUNCTUATION: ReadonlySet<string> = new Set(["{", "}", "=", ","]);
const TOML_WORD_STOP: ReadonlySet<string> = new Set(["[", "]", '"', "=", "{", "}", ","]);
const JSON_NUMBER = /^-?\d+(?:\.\d+)?$/;
const BARE_KEY = /^[A-Za-z_][\w.]*$/;

function isSpace(char: string): boolean {
  return char === " " || char === "\n" || char === "\t" || char === "\r";
}

function runEnd(source: string, start: number, stops: (char: string) => boolean): number {
  let index = start;
  while (index < source.length && !stops(source[index])) index += 1;
  return index;
}

function stringEnd(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") index += 2;
    else if (source[index] === '"') return index + 1;
    else index += 1;
  }
  return source.length;
}

function spaceEnd(source: string, start: number): number {
  return runEnd(source, start, (char) => !isSpace(char));
}

function jsonWordClass(word: string): string | null {
  if (JSON_NUMBER.test(word)) return NUMBER_TEXT;
  return word === "true" || word === "false" || word === "null" ? LITERAL_TEXT : null;
}

function highlightJsonSnippet(source: string, push: PushSnippetToken) {
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    let end: number;
    if (char === '"') {
      end = stringEnd(source, index);
      const colon = spaceEnd(source, end);
      if (source[colon] === ":") {
        push(KEY_TEXT, source.slice(index, end));
        push(PUNCTUATION_TEXT, source.slice(end, colon + 1));
        end = colon + 1;
      } else {
        push(STRING_TEXT, source.slice(index, end));
      }
    } else if (JSON_PUNCTUATION.has(char)) {
      end = index + 1;
      push(PUNCTUATION_TEXT, char);
    } else if (isSpace(char)) {
      end = spaceEnd(source, index);
      push(null, source.slice(index, end));
    } else {
      end = runEnd(source, index, (next) => isSpace(next) || next === '"' || JSON_PUNCTUATION.has(next));
      const word = source.slice(index, end);
      push(jsonWordClass(word), word);
    }
    index = end;
  }
}

function pushTomlWord(source: string, index: number, push: PushSnippetToken): number {
  const end = runEnd(source, index, (next) => isSpace(next) || TOML_WORD_STOP.has(next));
  const word = source.slice(index, end);
  const equals = spaceEnd(source, end);
  if (BARE_KEY.test(word) && source[equals] === "=") {
    const valueStart = spaceEnd(source, equals + 1);
    push(KEY_TEXT, word);
    push(PUNCTUATION_TEXT, source.slice(end, valueStart));
    return valueStart;
  }
  push(null, word);
  return end;
}

function highlightTomlSnippet(source: string, push: PushSnippetToken) {
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const close = char === "[" ? source.indexOf("]", index + 1) : -1;
    if (close > index + 1) {
      push(KEY_TEXT, source.slice(index, close + 1));
      index = close + 1;
    } else if (char === '"') {
      const end = stringEnd(source, index);
      push(STRING_TEXT, source.slice(index, end));
      index = end;
    } else if (TOML_PUNCTUATION.has(char) || char === "[" || char === "]") {
      push(TOML_PUNCTUATION.has(char) ? PUNCTUATION_TEXT : null, char);
      index += 1;
    } else if (isSpace(char)) {
      const end = spaceEnd(source, index);
      push(null, source.slice(index, end));
      index = end;
    } else {
      index = pushTomlWord(source, index, push);
    }
  }
}

function highlightShellSnippet(source: string, push: PushSnippetToken) {
  const re = /("(?:\\.|[^"\\])*")|(--?[\w-]+)|(\s+)|([^\s"]+)/g;
  let first = true;
  for (const m of source.matchAll(re)) {
    if (m[1] !== undefined) {
      push("text-emerald-700 dark:text-emerald-400", m[1]);
    } else if (m[2] !== undefined) {
      push("text-violet-700 dark:text-violet-400", m[2]);
    } else if (m[3] !== undefined) {
      push(null, m[3]);
    } else if (m[4] !== undefined) {
      push(first ? "text-sky-700 dark:text-sky-300 font-medium" : null, m[4]);
      first = false;
    }
  }
}

export function highlightSnippet(source: string, lang: SnippetLang): ReactNode[] {
  const out: ReactNode[] = [];
  let key = 0;
  const push: PushSnippetToken = (cls, text) => {
    if (!text) return;
    out.push(
      cls ? (
        <span key={key++} className={cls}>
          {text}
        </span>
      ) : (
        <span key={key++}>{text}</span>
      ),
    );
  };

  if (lang === "json") highlightJsonSnippet(source, push);
  else if (lang === "toml") highlightTomlSnippet(source, push);
  else highlightShellSnippet(source, push);
  return out;
}
