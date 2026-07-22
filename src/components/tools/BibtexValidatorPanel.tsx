import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { parseBib, validateBib } from "@/lib/latex-tools";

const SAMPLE = `@article{einstein1905,
  author  = {Einstein, Albert},
  title   = {On the Electrodynamics of Moving Bodies},
  journal = {Annalen der Physik},
  year    = {1905}
}`;

const LEVEL_CLASS: Record<"error" | "warning" | "ok", string> = {
  error: "border-l-destructive",
  warning: "border-l-amber-500",
  ok: "border-l-emerald-500",
};

export function BibtexValidatorPanel() {
  const [input, setInput] = useState("");
  const result = useMemo(() => {
    if (!input.trim()) return null;
    const { entries, parseErrors } = parseBib(input);
    return { entries, parseErrors, findings: validateBib(entries) };
  }, [input]);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col border-r">
        <div className="flex items-center justify-between border-b px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>BibTeX input</span>
          <span>{result ? `${result.entries.length} entries` : "0 entries"}</span>
        </div>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`${SAMPLE}\n\nPaste your full .bib file here...`}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-xs focus-visible:ring-0"
        />
        <div className="flex items-center gap-2 border-t px-4 py-2">
          <Button variant="ghost" size="sm" onClick={() => setInput(SAMPLE)}>
            Sample
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setInput("")}>
            Clear
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b px-4 py-2 text-xs font-medium text-muted-foreground">
          Validation results
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!result && (
            <p className="text-sm text-muted-foreground">
              Paste your .bib file to validate it instantly.
            </p>
          )}
          {result?.parseErrors.map((e) => (
            <div key={e} className="mb-2 rounded-md border-l-2 border-l-destructive bg-muted/30 px-3 py-2 text-sm">
              <strong className="text-xs font-semibold uppercase tracking-wide">Parse problem</strong>
              <p className="mt-1 text-muted-foreground">{e}</p>
            </div>
          ))}
          {result?.findings.map((f) => (
            <div
              key={f.key + f.type}
              className={`mb-2 rounded-md border-l-2 bg-muted/30 px-3 py-2 text-sm ${LEVEL_CLASS[f.level]}`}
            >
              <strong className="font-mono text-xs">
                @{f.type}
                {"{"}
                {f.key}
                {"}"}
              </strong>
              {f.messages.length === 0 ? (
                <p className="mt-1 text-emerald-600 dark:text-emerald-400">Looks good</p>
              ) : (
                f.messages.map((m) => (
                  <p key={m} className="mt-1 text-muted-foreground">
                    {m}
                  </p>
                ))
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
