import type { ReactNode } from "react";
import { Check, Copy } from "lucide-react";
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

function highlightJsonSnippet(source: string, push: PushSnippetToken) {
  // Keys, strings, numbers, booleans/null, punctuation.
  const re =
    /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?)\b|(\b(?:true|false|null)\b)|([{}[\],:])|(\s+)|([^\s"{}[\],:]+)/g;
  for (const m of source.matchAll(re)) {
    if (m[1] !== undefined && m[2] !== undefined) {
      push("text-sky-700 dark:text-sky-300", m[1]);
      push("text-muted-foreground", m[2]);
    } else if (m[1] !== undefined) {
      push("text-emerald-700 dark:text-emerald-400", m[1]);
    } else if (m[3] !== undefined) {
      push("text-amber-700 dark:text-amber-400", m[3]);
    } else if (m[4] !== undefined) {
      push("text-violet-700 dark:text-violet-400", m[4]);
    } else if (m[5] !== undefined) {
      push("text-muted-foreground", m[5]);
    } else if (m[6] !== undefined) {
      push(null, m[6]);
    } else if (m[7] !== undefined) {
      push(null, m[7]);
    }
  }
}

function highlightTomlSnippet(source: string, push: PushSnippetToken) {
  const re =
    /(\[[^\]]+\])|([A-Za-z_][\w.]*)(\s*=\s*)|("(?:\\.|[^"\\])*")|([{}=,])|(\s+)|([^\s[\]"={}]+)/g;
  for (const m of source.matchAll(re)) {
    if (m[1] !== undefined) {
      push("text-sky-700 dark:text-sky-300", m[1]);
    } else if (m[2] !== undefined) {
      push("text-sky-700 dark:text-sky-300", m[2]);
      push("text-muted-foreground", m[3] ?? "");
    } else if (m[4] !== undefined) {
      push("text-emerald-700 dark:text-emerald-400", m[4]);
    } else if (m[5] !== undefined) {
      push("text-muted-foreground", m[5]);
    } else if (m[6] !== undefined) {
      push(null, m[6]);
    } else if (m[7] !== undefined) {
      push(null, m[7]);
    }
  }
}

function highlightShellSnippet(source: string, push: PushSnippetToken) {
  // shell: flag, quoted string, bare token
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

// Avoids pulling in a full syntax-highlighter dependency for these small snippets.
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
