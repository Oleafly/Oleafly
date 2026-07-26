import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bookmark,
  Check,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { modalCoordinator } from "@oleafly/templates";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { cn, modKey } from "@/lib/utils";
import { notifyError, toast } from "@/lib/toast";
import { friendlyHint } from "@/components/ai/chat-parts";
import { ModelSelector, type ModelSelectorGroup } from "@/components/ai/ModelSelector";
import { enabledModels } from "@/lib/ai-model-state";
import { mergeCustomProviders } from "@/lib/ai-providers";
import { getConfig, type AppConfig } from "@/lib/tauri";
import {
  compileGeneratedTemplate,
  generateTemplateAvailable,
  generateTemplateSource,
  saveGeneratedTemplate,
  type ParsedTemplate,
} from "@/features/template-generate";

type Phase = "prompt" | "loading" | "result";
type View = "preview" | "code";

const EXAMPLES = [
  "A two-column workshop paper with an abstract and numbered sections",
  "A one-page ATS-friendly software engineer resume",
  "A formal cover letter with a sender address block",
  "A two-column company newsletter with a masthead",
  "A conference research poster with a title band",
];

const STEPS = [
  "Understanding your description",
  "Choosing a document class & layout",
  "Drafting sections and styles",
  "Rendering a live preview",
];

const ENGINE_LABELS: Record<ParsedTemplate["engine"], string> = {
  xetex: "TECTONIC",
  typst: "TYPST",
  markdown: "PANDOC",
};

function SkeletonPage({ dim }: { dim?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 items-stretch justify-center rounded-xl bg-zinc-200 p-8 transition-opacity duration-300",
        dim ? "opacity-60" : "opacity-100",
      )}
    >
      <div className="flex w-full max-w-md animate-pulse flex-col gap-3 rounded-sm bg-white p-8 shadow-sm">
        <div className="mx-auto mt-4 h-3 w-1/2 rounded bg-zinc-200" />
        <div className="mx-auto h-2.5 w-1/3 rounded bg-zinc-100" />
        <div className="mt-6 h-2 w-full rounded bg-zinc-100" />
        <div className="h-2 w-11/12 rounded bg-zinc-100" />
        <div className="h-2 w-4/5 rounded bg-zinc-100" />
        <div className="mt-4 h-2.5 w-1/4 rounded bg-zinc-200" />
        <div className="h-2 w-full rounded bg-zinc-100" />
        <div className="h-2 w-11/12 rounded bg-zinc-100" />
      </div>
    </div>
  );
}

export function TemplateGenerateModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("prompt");
  const [description, setDescription] = useState("");
  const [runPrompt, setRunPrompt] = useState("");
  const [loadingStep, setLoadingStep] = useState(0);
  const [parsed, setParsed] = useState<ParsedTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("preview");
  const [previewPng, setPreviewPng] = useState<string | null>(null);
  const [, setCompileLog] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [using, setUsing] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [modelGroups, setModelGroups] = useState<ModelSelectorGroup[]>([]);
  const [genProvider, setGenProvider] = useState("");
  const [genModel, setGenModel] = useState("");
  const runSeqRef = useRef(0);
  const stepTimersRef = useRef<number[]>([]);

  const clearStepTimers = () => {
    for (const id of stepTimersRef.current) window.clearTimeout(id);
    stepTimersRef.current = [];
  };

  useEffect(() => {
    if (!open) return;
    setPhase("prompt");
    setDescription("");
    setRunPrompt("");
    setLoadingStep(0);
    setParsed(null);
    setError(null);
    setView("preview");
    setPreviewPng(null);
    setCompileLog("");
    setSaving(false);
    setSaved(false);
    setUsing(false);
    setEditingDescription(false);
    runSeqRef.current += 1;
    clearStepTimers();
    void getConfig()
      .then((cfg: AppConfig) => {
        const allProviders = mergeCustomProviders(cfg.ai_custom_providers ?? []);
        const configured = allProviders.filter((p) => {
          if ((cfg.ai_keys?.[p.id] ?? "").trim().length > 0) return true;
          return Boolean(cfg.ai_custom_providers?.find((c) => c.id === p.id)?.keyOptional);
        });
        const groups: ModelSelectorGroup[] = configured.map((p) => {
          const stored = cfg.ai_provider_models?.[p.id];
          const models = stored?.length
            ? enabledModels(stored).map((m) => ({ id: m.id, name: m.name }))
            : p.models.map((m) => ({ id: m.id, name: m.name }));
          return { id: p.id, name: p.name, models };
        }).filter((g) => g.models.length > 0);
        setModelGroups(groups);
        const active = groups.find((g) => g.id === cfg.ai_provider);
        const provider = active ?? groups[0];
        if (!provider) return;
        const model =
          provider.models.find((m) => m.id === cfg.ai_model) ?? provider.models[0];
        setGenProvider(provider.id);
        setGenModel(model.id);
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = modalCoordinator.add(document.activeElement as HTMLElement | null);
    return () => {
      modalCoordinator.remove(id)?.focus();
    };
  }, [open]);

  useEffect(() => () => clearStepTimers(), []);

  if (!open) return null;

  const generate = async (prompt: string) => {
    const text = prompt.trim();
    if (!text || phase === "loading") return;
    const seq = ++runSeqRef.current;
    const live = () => runSeqRef.current === seq;
    setError(null);
    if (!(await generateTemplateAvailable())) {
      if (live()) {
        setError("Connect an AI provider in Settings, AI Assistant, before generating templates.");
      }
      return;
    }
    if (!live()) return;
    setRunPrompt(text);
    setPhase("loading");
    setLoadingStep(0);
    setParsed(null);
    setPreviewPng(null);
    setCompileLog("");
    setSaved(false);
    setEditingDescription(false);
    clearStepTimers();
    stepTimersRef.current = [
      window.setTimeout(() => live() && setLoadingStep((s) => Math.max(s, 1)), 1_100),
      window.setTimeout(() => live() && setLoadingStep((s) => Math.max(s, 2)), 2_600),
    ];
    try {
      const result = await generateTemplateSource(
        text,
        genProvider && genModel ? { providerId: genProvider, modelId: genModel } : undefined,
      );
      if (!live()) return;
      clearStepTimers();
      setLoadingStep(3);
      let png: string | null = null;
      let log = "";
      try {
        const compiled = await compileGeneratedTemplate(result);
        png = compiled.png;
        log = compiled.log;
      } catch (e) {
        log = e instanceof Error ? e.message : String(e);
      }
      if (!live()) return;
      setParsed(result);
      setPreviewPng(png);
      setCompileLog(log);
      setView(png ? "preview" : "code");
      setPhase("result");
    } catch (e) {
      if (!live()) return;
      clearStepTimers();
      setPhase("prompt");
      const raw = e instanceof Error ? e.message : String(e);
      const hint = friendlyHint(raw)?.replaceAll(
        "from the model menu above",
        "in Settings, AI Assistant",
      );
      setError(hint ?? raw);
    }
  };

  const save = async (): Promise<boolean> => {
    if (!parsed || saving) return saved;
    if (saved) return true;
    setSaving(true);
    try {
      await saveGeneratedTemplate(parsed);
      setSaved(true);
      toast.success(`Saved "${parsed.name}" to your library`);
      onSaved();
      return true;
    } catch (e) {
      notifyError("save the template", e, "Couldn't save the template.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = async () => {
    if (!parsed || using) return;
    setUsing(true);
    try {
      const ok = await save();
      if (!ok) return;
      const id = parsed.slug;
      onClose();
      window.dispatchEvent(new CustomEvent("oleafly:use-template", { detail: { id } }));
    } finally {
      setUsing(false);
    }
  };

  const header = (
    <div className="flex items-center justify-between border-b px-5 py-3.5">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Sparkles className="size-5" />
        </span>
        <div>
          <h2 id="generate-template-title" className="text-base font-semibold leading-tight">
            Generate a template with AI
          </h2>
          <p className="text-xs text-muted-foreground">
            Describe a document and preview it before you use it
          </p>
        </div>
      </div>
      <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close">
        <X className="size-4" />
      </Button>
    </div>
  );

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
      <div className="flex h-[min(88vh,820px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none">
        {header}

        {phase === "prompt" && (
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
            <div className="rounded-xl border-2 border-primary/60 bg-background p-4 focus-within:border-primary">
              <Textarea
                autoFocus
                data-testid="template-generate-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void generate(description);
                  }
                }}
                placeholder="Describe the document, e.g. a two-column workshop paper with an abstract and numbered sections"
                rows={6}
                className="min-h-32 w-full resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0"
              />
              <div className="mt-3 flex items-center justify-end gap-2">
                {modelGroups.length > 0 && (
                  <ModelSelector
                    providerId={genProvider}
                    modelId={genModel}
                    groups={modelGroups}
                    contentClassName="z-[100]"
                    onChange={(providerId, modelId) => {
                      setGenProvider(providerId);
                      setGenModel(modelId);
                    }}
                  />
                )}
                <Button
                  data-testid="template-generate-run"
                  disabled={!description.trim()}
                  onClick={() => void generate(description)}
                >
                  <Wand2 className="size-4" />
                  Generate
                  <span className="inline-flex items-center gap-1">
                    <Kbd className="h-4 min-w-4 bg-primary-foreground/20 px-1 text-[10px] text-primary-foreground">
                      {modKey}
                    </Kbd>
                    <Kbd className="h-4 min-w-4 bg-primary-foreground/20 px-1 text-[10px] text-primary-foreground">
                      {"\u21B5"}
                    </Kbd>
                  </span>
                </Button>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div>
              <p className="text-sm font-medium text-muted-foreground">Try one of these</p>
              <div className="mt-2.5 flex flex-wrap gap-2.5">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setDescription(example)}
                    className={cn(
                      "rounded-full border px-4 py-2 text-sm transition-colors",
                      description === example
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                    )}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-auto flex items-start gap-3 rounded-xl border border-dashed p-4 text-sm leading-relaxed text-muted-foreground">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                <Sparkles className="size-4" />
              </span>
              <p>
                AI drafts a starting layout: engine, document class, sections and styles. You'll
                get a live preview to review first. Choosing{" "}
                <span className="font-semibold text-foreground">Use this template</span>{" "}
                automatically saves it to your library so you can reuse it later.
              </p>
            </div>
          </div>
        )}

        {phase === "loading" && (
          <div className="flex min-h-0 flex-1 gap-8 overflow-hidden p-6">
            <div className="min-h-0 w-1/2 shrink-0">
              <SkeletonPage />
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-5 pr-4">
              <p className="flex items-center gap-2.5 text-lg font-medium text-primary">
                <Loader2 className="size-5 animate-spin" />
                Generating your template...
              </p>
              <div className="rounded-xl border px-4 py-3 text-sm italic text-muted-foreground">
                "{runPrompt}"
              </div>
              <ol className="flex flex-col gap-3.5">
                {STEPS.map((label, i) => {
                  const done = i < loadingStep || (loadingStep >= 3 && i < 3);
                  const active = i === loadingStep;
                  return (
                    <li key={label} className="flex items-center gap-3 text-base">
                      {done ? (
                        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="size-4" />
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "flex size-7 items-center justify-center rounded-full border text-sm tabular-nums",
                            active
                              ? "border-primary text-primary"
                              : "border-muted-foreground/30 text-muted-foreground",
                          )}
                        >
                          {i + 1}
                        </span>
                      )}
                      <span className={done || active ? "text-foreground" : "text-muted-foreground"}>
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        )}

        {phase === "result" && parsed && (
          <>
            <div className="flex min-h-0 flex-1 gap-8 overflow-hidden p-6">
              <div className="flex min-h-0 w-1/2 shrink-0 flex-col gap-3">
                <div className="flex w-fit items-center gap-1 rounded-lg border bg-background p-0.5">
                  <button
                    type="button"
                    data-testid="template-generate-view-preview"
                    onClick={() => setView("preview")}
                    className={cn(
                      "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                      view === "preview"
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    data-testid="template-generate-view-code"
                    onClick={() => setView("code")}
                    className={cn(
                      "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                      view === "code"
                        ? "bg-accent text-accent-foreground ring-1 ring-border"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Source
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {view === "code" ? (
                    <pre className="h-full overflow-auto whitespace-pre-wrap rounded-xl border bg-background p-4 font-mono text-xs leading-relaxed text-muted-foreground">
                      {parsed.source}
                    </pre>
                  ) : previewPng ? (
                    <div className="flex h-full items-start justify-center overflow-auto rounded-xl bg-zinc-200 p-6">
                      <img
                        src={previewPng}
                        alt="Compiled preview of the generated template"
                        className="max-w-full rounded-sm bg-white shadow-md"
                      />
                    </div>
                  ) : (
                    <div className="relative h-full">
                      <SkeletonPage dim />
                      <p className="absolute inset-x-0 bottom-4 mx-auto w-fit rounded-full bg-black/70 px-3.5 py-1.5 text-xs text-white backdrop-blur-sm">
                        {parsed.engine === "xetex"
                          ? "Preview unavailable, check the Source tab"
                          : "Live preview isn't available for this engine yet"}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
                    <Sparkles className="size-3.5" /> AI Generated
                  </span>
                  <span className="rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {ENGINE_LABELS[parsed.engine]}
                  </span>
                </div>
                <h3 className="text-2xl font-semibold leading-tight">{parsed.name}</h3>
                {editingDescription ? (
                  <Textarea
                    autoFocus
                    value={parsed.description}
                    rows={3}
                    onChange={(e) =>
                      setParsed((p) => (p ? { ...p, description: e.target.value } : p))
                    }
                    onBlur={() => setEditingDescription(false)}
                    className="text-sm"
                  />
                ) : (
                  <p className="text-base leading-relaxed text-muted-foreground">
                    {parsed.description || "No description yet."}
                  </p>
                )}
                {parsed.tags.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Includes</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {parsed.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md bg-muted px-3 py-1.5 text-sm text-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4 rounded-xl border p-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Category</p>
                    <p className="mt-0.5 text-base font-medium">{parsed.category}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Engine</p>
                    <p className="mt-0.5 text-base font-medium">{ENGINE_LABELS[parsed.engine]}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingDescription((v) => !v)}
                  className="flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                  Edit description
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <Button
                variant="outline"
                disabled={phase !== "result"}
                onClick={() => void generate(runPrompt || description)}
              >
                <RefreshCw className="size-4" />
                Regenerate
              </Button>
              <div className="flex items-center gap-3">
                {saved ? (
                  <span className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground">
                    <Check className="size-4 text-emerald-500" />
                    Saved
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    data-testid="template-generate-save"
                    disabled={saving}
                    onClick={() => void save()}
                  >
                    {saving ? <Loader2 className="size-4 animate-spin" /> : <Bookmark className="size-4" />}
                    Save template
                  </Button>
                )}
                <Button disabled={using || saving} onClick={() => void applyTemplate()}>
                  Use this template
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
