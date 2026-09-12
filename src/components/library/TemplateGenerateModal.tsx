import { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  ArrowRight,
  Bookmark,
  BookmarkX,
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
  deleteGeneratedTemplate,
  generateTemplateAvailable,
  generateTemplateSource,
  saveGeneratedTemplate,
  type ParsedTemplate,
} from "@/features/template-generate";

type Phase = "prompt" | "loading" | "result";
type View = "preview" | "code";

const ENGINE_LABELS: Record<ParsedTemplate["engine"], string> = {
  xetex: "TECTONIC",
  typst: "TYPST",
  markdown: "PANDOC",
};

function SkeletonPage({ dim }: Readonly<{ dim?: boolean }>) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 items-stretch justify-center rounded-xl bg-zinc-200 p-8 transition-opacity duration-300",
        dim ? "opacity-60" : "opacity-100",
      )}
    >
      <div className="skeleton-shimmer flex w-full max-w-md flex-col gap-3 rounded-sm bg-white p-8 shadow-sm">
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
}: Readonly<{
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}>) {
  const { t } = useTranslation(["common", "library"]);
  const examples = [
    t(($) => $.library.generate.examples.workshopPaper),
    t(($) => $.library.generate.examples.resume),
    t(($) => $.library.generate.examples.coverLetter),
    t(($) => $.library.generate.examples.newsletter),
    t(($) => $.library.generate.examples.poster),
  ];
  const steps = [
    t(($) => $.library.generate.steps.understanding),
    t(($) => $.library.generate.steps.layout),
    t(($) => $.library.generate.steps.drafting),
    t(($) => $.library.generate.steps.rendering),
  ];
  const [phase, setPhase] = useState<Phase>("prompt");
  const [description, setDescription] = useState("");
  const [runPrompt, setRunPrompt] = useState("");
  const [loadingStep, setLoadingStep] = useState(0);
  const [parsed, setParsed] = useState<ParsedTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("preview");
  const [previewPng, setPreviewPng] = useState<string | null>(null);
  const [_compileLog, setCompileLog] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [using, setUsing] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [modelGroups, setModelGroups] = useState<ModelSelectorGroup[]>([]);
  const [genProvider, setGenProvider] = useState("");
  const [genModel, setGenModel] = useState("");
  const runSeqRef = useRef(0);
  const stepTimersRef = useRef<number[]>([]);

  const clearStepTimers = useCallback(() => {
    for (const id of stepTimersRef.current) window.clearTimeout(id);
    stepTimersRef.current = [];
  }, []);

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
  }, [open, clearStepTimers]);

  useEffect(() => {
    if (!open) return;
    const id = modalCoordinator.add(document.activeElement as HTMLElement | null);
    return () => {
      modalCoordinator.remove(id)?.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => () => clearStepTimers(), [clearStepTimers]);

  if (!open) return null;

  const compilePreview = async (
    result: Awaited<ReturnType<typeof generateTemplateSource>>,
  ): Promise<{ png: string | null; log: string }> => {
    try {
      const compiled = await compileGeneratedTemplate(result);
      return { png: compiled.png, log: compiled.log };
    } catch (e) {
      return { png: null, log: e instanceof Error ? e.message : String(e) };
    }
  };

  const reportGenerateFailure = (e: unknown) => {
    clearStepTimers();
    setPhase("prompt");
    const raw = e instanceof Error ? e.message : String(e);
    const hint = friendlyHint(raw, undefined, "settings");
    setError(hint ?? raw);
  };

  const startLoadingSteps = (live: () => boolean) => {
    stepTimersRef.current = [
      window.setTimeout(() => live() && setLoadingStep((s) => Math.max(s, 1)), 1_100),
      window.setTimeout(() => live() && setLoadingStep((s) => Math.max(s, 2)), 2_600),
    ];
  };

  const generate = async (prompt: string) => {
    const text = prompt.trim();
    if (!text || phase === "loading") return;
    const seq = ++runSeqRef.current;
    const live = () => runSeqRef.current === seq;
    setError(null);
    if (!(await generateTemplateAvailable())) {
      if (live()) setError(t(($) => $.library.generate.noProvider));
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
    startLoadingSteps(live);
    try {
      const result = await generateTemplateSource(
        text,
        genProvider && genModel ? { providerId: genProvider, modelId: genModel } : undefined,
      );
      if (!live()) return;
      clearStepTimers();
      setLoadingStep(3);
      const { png, log } = await compilePreview(result);
      if (!live()) return;
      setParsed(result);
      setPreviewPng(png);
      setCompileLog(log);
      setView(png ? "preview" : "code");
      setPhase("result");
    } catch (e) {
      if (live()) reportGenerateFailure(e);
    }
  };

  const unsave = async () => {
    if (!parsed || saving) return;
    setSaving(true);
    try {
      await deleteGeneratedTemplate(parsed.slug);
      setSaved(false);
      toast.success(t(($) => $.library.generate.removedToast, { name: parsed.name }));
      onSaved();
    } catch (e) {
      notifyError("remove the template", e, t(($) => $.library.generate.removeFailed));
    } finally {
      setSaving(false);
    }
  };

  const save = async (): Promise<boolean> => {
    if (!parsed || saving) return saved;
    if (saved) return true;
    setSaving(true);
    try {
      await saveGeneratedTemplate(parsed, previewPng);
      setSaved(true);
      toast.success(t(($) => $.library.generate.savedToast, { name: parsed.name }));
      onSaved();
      return true;
    } catch (e) {
      notifyError("save the template", e, t(($) => $.library.generate.saveFailed));
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
            {t(($) => $.library.generate.title)}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t(($) => $.library.generate.subtitle)}
          </p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={onClose}
        aria-label={t(($) => $.common.actions.close)}
      >
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
                placeholder={t(($) => $.library.generate.promptPlaceholder)}
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
                  {t(($) => $.library.generate.run)}
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
              <p className="text-sm font-medium text-muted-foreground">
                {t(($) => $.library.generate.examplesTitle)}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2.5">
                {examples.map((example) => (
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
                <Trans
                  ns="library"
                  i18nKey={($) => $.library.generate.note}
                  components={{ useTemplate: <span className="font-semibold text-foreground" /> }}
                />
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
              <p className="flex items-center gap-2.5 text-lg font-medium">
                <Loader2 className="size-5 animate-spin text-primary" />
                <span className="ai-shimmer !text-lg">{t(($) => $.library.generate.loading)}</span>
              </p>
              <div className="rounded-xl border px-4 py-3 text-sm italic text-muted-foreground">
                {t(($) => $.library.generate.quotedPrompt, { prompt: runPrompt })}
              </div>
              <ol className="flex flex-col gap-3.5">
                {steps.map((label, i) => {
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
                    {t(($) => $.library.generate.viewPreview)}
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
                    {t(($) => $.library.generate.viewSource)}
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {view === "code" ? (
                    <pre className="h-full overflow-auto whitespace-pre-wrap rounded-xl border bg-background p-4 font-mono text-xs leading-relaxed text-muted-foreground">
                      {parsed.source}
                    </pre>
                  ) : null}
                  {view !== "code" && (previewPng ? (
                    <div className="flex h-full items-start justify-center overflow-auto rounded-xl bg-zinc-200 p-6">
                      <img
                        src={previewPng}
                        alt={t(($) => $.library.generate.previewAlt)}
                        className="max-w-full rounded-sm bg-white shadow-md"
                      />
                    </div>
                  ) : (
                    <div className="relative h-full">
                      <SkeletonPage dim />
                      <p className="absolute inset-x-0 bottom-4 mx-auto w-fit rounded-full bg-black/70 px-3.5 py-1.5 text-xs text-white backdrop-blur-sm">
                        {parsed.engine === "xetex"
                          ? t(($) => $.library.generate.compileFailed)
                          : t(($) => $.library.generate.previewUnsupported)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
                    <Sparkles className="size-3.5" /> {t(($) => $.library.generate.badge)}
                  </span>
                  <span className="rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {ENGINE_LABELS[parsed.engine]}
                  </span>
                </div>
                <h3 className="text-2xl font-semibold leading-tight">{parsed.name}</h3>
                {parsed.engine === "xetex" && !previewPng && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
                    {t(($) => $.library.generate.compileWarning)}
                  </div>
                )}
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
                    {parsed.description || t(($) => $.library.generate.noDescription)}
                  </p>
                )}
                {parsed.tags.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {t(($) => $.library.generate.includes)}
                    </p>
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
                    <p className="text-sm text-muted-foreground">
                      {t(($) => $.library.generate.category)}
                    </p>
                    <p className="mt-0.5 text-base font-medium">{parsed.category}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t(($) => $.library.generate.engine)}
                    </p>
                    <p className="mt-0.5 text-base font-medium">{ENGINE_LABELS[parsed.engine]}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingDescription((v) => !v)}
                  className="flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                  {t(($) => $.library.generate.editDescription)}
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
                {t(($) => $.library.generate.regenerate)}
              </Button>
              <div className="flex items-center gap-3">
                {saved ? (
                  <Button
                    variant="outline"
                    className="group"
                    disabled={saving}
                    onClick={() => void unsave()}
                  >
                    <Check className="size-4 text-emerald-500 group-hover:hidden" />
                    <BookmarkX className="hidden size-4 text-destructive group-hover:block" />
                    <span className="group-hover:hidden">{t(($) => $.library.generate.saved)}</span>
                    <span className="hidden group-hover:inline">
                      {t(($) => $.library.generate.unsave)}
                    </span>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    data-testid="template-generate-save"
                    disabled={saving}
                    onClick={() => void save()}
                  >
                    {saving ? <Loader2 className="size-4 animate-spin" /> : <Bookmark className="size-4" />}
                    {t(($) => $.library.generate.save)}
                  </Button>
                )}
                <Button disabled={using || saving} onClick={() => void applyTemplate()}>
                  {t(($) => $.library.generate.use)}
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
