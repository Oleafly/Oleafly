import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { GeneratedPreview, TemplatesKit } from "./types";

/** Inline AI template generator panel for the gallery footer. */
export function GenerateTemplate({
  kit,
  generate,
  onSaved,
  logError,
}: {
  kit: TemplatesKit;
  generate: (description: string) => Promise<GeneratedPreview>;
  onSaved: () => void;
  logError: (scope: string, e: unknown) => void;
}) {
  const { Button } = kit;
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GeneratedPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const run = async () => {
    if (busy || !description.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setSaved(false);
    try {
      setResult(await generate(description.trim()));
    } catch (e) {
      logError("template-generate", e);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!result || saved) return;
    try {
      await result.save();
      setSaved(true);
      onSaved();
    } catch (e) {
      logError("template-generate", e);
      setError(String(e));
    }
  };

  return (
    <div data-testid="template-generate-card" className="mt-6 rounded-md border bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Sparkles className="size-3.5" /> Generate with AI
      </div>
      <div className="flex gap-2">
        <textarea
          data-testid="template-generate-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the document, e.g. a two-column workshop paper with an abstract and numbered sections"
          rows={2}
          className="min-w-0 flex-1 resize-none rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <Button
          size="sm"
          data-testid="template-generate-run"
          disabled={busy || !description.trim()}
          onClick={() => void run()}
        >
          {busy ? "Generating..." : "Generate"}
        </Button>
      </div>
      {error && <div className="mt-2 text-[11px] text-destructive">{error}</div>}
      {result && (
        <div className="mt-3 flex items-start gap-3">
          {result.previewPng ? (
            <img
              src={result.previewPng}
              alt={`Preview of ${result.name}`}
              className="w-28 rounded border bg-white shadow-sm"
            />
          ) : (
            <div className="flex w-28 items-center justify-center rounded border bg-background p-2 text-center text-[10px] text-muted-foreground">
              Preview after first compile
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">{result.name}</div>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                data-testid="template-generate-save"
                disabled={saved}
                onClick={() => void save()}
              >
                {saved ? "Saved to gallery" : "Save as template"}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run()}>
                Retry
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
