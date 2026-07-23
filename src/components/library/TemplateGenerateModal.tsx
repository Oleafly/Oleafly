import { useEffect, useState } from "react";
import { Code2, Loader2, Sparkles, X } from "lucide-react";
import { modalCoordinator } from "@oleafly/templates";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { notifyError, toast } from "@/lib/toast";
import {
  compileGeneratedTemplate,
  generateTemplateSource,
  saveGeneratedTemplate,
  type ParsedTemplate,
} from "@/features/template-generate";

type View = "code" | "preview";

export function TemplateGenerateModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [parsed, setParsed] = useState<ParsedTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("code");
  const [compiling, setCompiling] = useState(false);
  const [previewPng, setPreviewPng] = useState<string | null>(null);
  const [compileLog, setCompileLog] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDescription("");
    setGenerating(false);
    setParsed(null);
    setError(null);
    setView("code");
    setCompiling(false);
    setPreviewPng(null);
    setCompileLog("");
    setSaving(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = modalCoordinator.add(document.activeElement as HTMLElement | null);
    return () => {
      modalCoordinator.remove(id)?.focus();
    };
  }, [open]);

  if (!open) return null;

  const generate = async () => {
    if (generating || !description.trim()) return;
    setGenerating(true);
    setError(null);
    setParsed(null);
    setPreviewPng(null);
    setCompileLog("");
    try {
      const result = await generateTemplateSource(description.trim());
      setParsed(result);
      setView("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const compile = async () => {
    if (!parsed || compiling) return;
    setCompiling(true);
    setPreviewPng(null);
    setCompileLog("");
    try {
      const result = await compileGeneratedTemplate(parsed);
      setPreviewPng(result.png);
      setCompileLog(result.log);
      setView("preview");
    } catch (e) {
      notifyError("compile the template", e, "Couldn't compile the template.");
    } finally {
      setCompiling(false);
    }
  };

  const save = async () => {
    if (!parsed || saving) return;
    setSaving(true);
    try {
      await saveGeneratedTemplate(parsed);
      toast.success("Saved to your template gallery.");
      onSaved();
      onClose();
    } catch (e) {
      notifyError("save the template", e, "Couldn't save the template.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="generate-template-title"
      data-testid="template-generate-modal"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[min(80vh,640px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 id="generate-template-title" className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="size-4" /> Generate a template with AI
          </h2>
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
          <div className="flex gap-2">
            <Textarea
              autoFocus
              data-testid="template-generate-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the document, e.g. a two-column workshop paper with an abstract and numbered sections"
              rows={2}
              className="min-w-0 flex-1 resize-none text-sm"
            />
            <Button
              data-testid="template-generate-run"
              disabled={generating || !description.trim()}
              onClick={() => void generate()}
            >
              {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {generating ? "Generating…" : "Generate"}
            </Button>
          </div>

          {error && <div className="text-sm text-destructive">{error}</div>}

          {parsed && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 rounded-lg border bg-background p-0.5">
                  <button
                    type="button"
                    data-testid="template-generate-view-code"
                    onClick={() => setView("code")}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      view === "code" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    Code
                  </button>
                  <button
                    type="button"
                    data-testid="template-generate-view-preview"
                    onClick={() => setView("preview")}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      view === "preview" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    Preview
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {parsed.engine === "xetex" && (
                    <Button variant="secondary" size="sm" disabled={compiling} onClick={() => void compile()}>
                      {compiling ? <Loader2 className="size-3.5 animate-spin" /> : <Code2 className="size-3.5" />}
                      {compiling ? "Compiling…" : "Compile"}
                    </Button>
                  )}
                  <Button
                    data-testid="template-generate-save"
                    size="sm"
                    disabled={saving}
                    onClick={() => void save()}
                  >
                    {saving ? "Saving…" : "Save as template"}
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/20">
                {view === "code" ? (
                  <pre className="whitespace-pre-wrap p-3 font-mono text-xs">{parsed.source}</pre>
                ) : previewPng ? (
                  <div className="flex h-full items-center justify-center p-3">
                    <img src={previewPng} alt="Compiled preview" className="max-h-full max-w-full rounded border bg-white shadow-sm" />
                  </div>
                ) : compileLog ? (
                  <pre className="whitespace-pre-wrap p-3 font-mono text-xs text-muted-foreground">{compileLog}</pre>
                ) : (
                  <div className="flex h-full items-center justify-center p-3 text-center text-sm text-muted-foreground">
                    {parsed.engine === "xetex"
                      ? "Click Compile to see a preview."
                      : "Preview isn't available for this engine yet."}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
