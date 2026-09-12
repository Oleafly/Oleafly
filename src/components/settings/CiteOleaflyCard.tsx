import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Check, Copy, ExternalLink, Quote } from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  OLEAFLY_REPOSITORY_URL,
  oleaflyBibtex,
  oleaflyBibtexTokens,
  type BibtexTokenKind,
} from "@/lib/cite-oleafly";
import { cn } from "@/lib/utils";

const TOKEN_CLASS: Record<BibtexTokenKind, string> = {
  entry: "text-rose-600 dark:text-rose-400",
  key: "text-violet-600 dark:text-violet-400",
  field: "text-sky-700 dark:text-sky-300",
  punctuation: "text-muted-foreground",
  value: "text-foreground",
};

export function CiteOleaflyCard({ version }: { readonly version: string }) {
  const { t } = useTranslation(["common", "settings"]);
  const [copied, setCopied] = useState(false);
  const bibtex = oleaflyBibtex(version);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bibtex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section
      aria-labelledby="cite-oleafly-heading"
      data-testid="cite-oleafly-card"
      className="space-y-2.5 rounded-md border p-4"
    >
      <div className="flex items-start gap-2.5">
        <Quote aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h3 id="cite-oleafly-heading" className="text-sm font-semibold">
            {t(($) => $.settings.cite.title)}
          </h3>
          <p className="mt-1 max-w-[42rem] text-xs leading-relaxed text-muted-foreground">
            <Trans
              ns="settings"
              i18nKey={($) => $.settings.cite.description}
              components={{ citeKey: <code className="font-mono" /> }}
            />
          </p>
        </div>
      </div>
      <pre
        data-testid="cite-oleafly-bibtex"
        className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed"
      >
        {oleaflyBibtexTokens(version).map((line, lineIndex, lines) => (
          <span key={line.map((token) => token.text).join("")}>
            {line.map((token) => (
              <span key={`${token.kind}:${token.text}`} className={cn(TOKEN_CLASS[token.kind])}>
                {token.text}
              </span>
            ))}
            {lineIndex < lines.length - 1 ? "\n" : ""}
          </span>
        ))}
      </pre>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied
            ? t(($) => $.common.actions.copied)
            : t(($) => $.settings.cite.copyBibtex)}
        </button>
        <button
          type="button"
          onClick={() => void openExternal(OLEAFLY_REPOSITORY_URL)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {t(($) => $.settings.cite.apa)}
          <ExternalLink className="size-3" />
        </button>
      </div>
    </section>
  );
}
