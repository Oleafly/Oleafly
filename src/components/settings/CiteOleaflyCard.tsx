import { Trans, useTranslation } from "react-i18next";
import { ExternalLink, Quote } from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  OLEAFLY_REPOSITORY_URL,
  oleaflyBibtex,
  oleaflyBibtexTokens,
  type BibtexTokenKind,
} from "@/lib/cite-oleafly";
import { CodeBlock } from "@/components/ui/code-block";
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
  const bibtex = oleaflyBibtex(version);
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
      <CodeBlock code={bibtex} data-testid="cite-oleafly-bibtex" preClassName="overflow-x-auto">
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
      </CodeBlock>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
