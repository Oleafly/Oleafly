import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CodeField } from "@/components/tools/CodeField";
import { bibtexLanguage } from "@/components/editor/cm/bibtex";
import { parseBib, validateBib } from "@/lib/latex-tools";
import { useSettingsStore } from "@/store/settings";

const SAMPLE = `@article{einstein1905,
  author  = {Einstein, Albert},
  title   = {On the Electrodynamics of Moving Bodies},
  journal = {Annalen der Physik},
  year    = {1905}
}`;

const EXAMPLES: { label: string; hint: string; bib: string }[] = [
  { label: "Valid entry", hint: "all required fields present", bib: SAMPLE },
  {
    label: "Missing field",
    hint: "flags a required field",
    bib: `@article{turing1950,
  author = {Turing, Alan},
  title  = {Computing Machinery and Intelligence}
}`,
  },
  {
    label: "Duplicate keys",
    hint: "flags a repeated citation key",
    bib: `@article{shannon1948,
  author  = {Shannon, Claude},
  title   = {A Mathematical Theory of Communication},
  journal = {Bell System Technical Journal},
  year    = {1948}
}

@book{shannon1948,
  author    = {Shannon, Claude},
  title     = {A Mathematical Theory of Communication},
  publisher = {University of Illinois Press},
  year      = {1949}
}`,
  },
];

const LEVEL_CLASS: Record<"error" | "warning" | "ok", string> = {
  error: "border-l-destructive",
  warning: "border-l-amber-500",
  ok: "border-l-emerald-500",
};

export function BibtexValidatorPanel() {
  const editorTheme = useSettingsStore((s) => s.editorTheme);
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
        <CodeField
          value={input}
          onChange={setInput}
          language={bibtexLanguage}
          themeId={editorTheme}
          placeholder="Paste your full .bib file here…"
          testId="bibtex-code-field"
          className="min-h-0 flex-1 overflow-auto text-xs [&_.cm-editor]:h-full"
        />
        <div className="border-t px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground">
              EXAMPLES
            </div>
            <Button variant="ghost" size="sm" onClick={() => setInput("")}>
              Clear
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <Button
                key={ex.label}
                variant="outline"
                size="sm"
                title={ex.hint}
                onClick={() => setInput(ex.bib)}
              >
                {ex.label}
              </Button>
            ))}
          </div>
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
