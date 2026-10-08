import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/empty";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { setTypstProjectOptions, typstProjectOptions } from "@/lib/typst-options";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useTypstVariantStore } from "@/store/typst-variant";
import {
  draftFromVariants,
  draftId,
  draftProblem,
  newVariantName,
  selectionAfterSave,
  variantsFromDraft,
  type DraftProblem,
  type DraftVariant,
} from "./variants-draft";

export type VariantsLoad =
  | { readonly status: "loading" }
  | { readonly status: "ready" }
  | { readonly status: "error"; readonly message: string };

export interface TypstVariantsDraft {
  readonly load: VariantsLoad;
  readonly draft: readonly DraftVariant[];
  readonly problem: DraftProblem | null;
  readonly saveError: string | null;
  readonly dirty: boolean;
  reload: () => void;
  save: () => Promise<boolean>;
  add: () => void;
  change: (next: DraftVariant) => void;
  remove: (id: number) => void;
}

export function useTypstVariantsDraft(projectId: string | null, enabled: boolean): TypstVariantsDraft {
  const { t } = useTranslation(["editor"]);
  const [load, setLoad] = useState<VariantsLoad>({ status: "loading" });
  const [draft, setDraft] = useState<DraftVariant[]>([]);
  const [saved, setSaved] = useState("{}");
  const [problem, setProblem] = useState<DraftProblem | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const request = useRef(0);

  const reload = useCallback(() => {
    if (!projectId) return;
    const current = ++request.current;
    setLoad({ status: "loading" });
    setProblem(null);
    setSaveError(null);
    typstProjectOptions(projectId).then(
      (options) => {
        if (current !== request.current) return;
        const next = draftFromVariants(options.variants);
        setDraft(next);
        setSaved(JSON.stringify(variantsFromDraft(next)));
        setLoad({ status: "ready" });
      },
      (error_: unknown) => {
        if (current === request.current) setLoad({ status: "error", message: describeError(error_) });
      },
    );
  }, [projectId]);

  useEffect(() => {
    if (!enabled) return;
    reload();
    return () => {
      request.current += 1;
    };
  }, [enabled, reload]);

  const dirty = useMemo(
    () => load.status === "ready" && JSON.stringify(variantsFromDraft(draft)) !== saved,
    [draft, load.status, saved],
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (!projectId) return false;
    const found = draftProblem(draft);
    setProblem(found);
    if (found) return false;
    setSaveError(null);
    try {
      const variants = variantsFromDraft(draft);
      await setTypstProjectOptions(projectId, { variants });
      const selection = useTypstVariantStore.getState();
      selection.select(projectId, selectionAfterSave(draft, selection.selections[projectId] ?? null));
      await useFilesStore.getState().refreshEngine();
      setSaved(JSON.stringify(variants));
      return true;
    } catch (error) {
      void logError("save Typst variants", error);
      setSaveError(describeError(error) || t(($) => $.editor.typstVariants.saveFailed));
      return false;
    }
  }, [draft, projectId, t]);

  const add = useCallback(() => {
    setProblem(null);
    setDraft((current) => [
      ...current,
      {
        id: draftId(),
        original: null,
        name: newVariantName(current, (number) => t(($) => $.editor.typstVariants.defaultName, { number })),
        inputs: [{ id: draftId(), key: "", value: "" }],
      },
    ]);
  }, [t]);

  const change = useCallback((next: DraftVariant) => {
    setProblem(null);
    setDraft((current) => current.map((candidate) => (candidate.id === next.id ? next : candidate)));
  }, []);

  const remove = useCallback((id: number) => {
    setProblem(null);
    setDraft((current) => current.filter((candidate) => candidate.id !== id));
  }, []);

  return { load, draft, problem, saveError, dirty, reload, save, add, change, remove };
}

function VariantCard({
  variant,
  onChange,
  onRemove,
}: Readonly<{
  variant: DraftVariant;
  onChange: (next: DraftVariant) => void;
  onRemove: () => void;
}>) {
  const { t } = useTranslation(["editor"]);
  const update = (id: number, field: "key" | "value", text: string) =>
    onChange({
      ...variant,
      inputs: variant.inputs.map((input) => (input.id === id ? { ...input, [field]: text } : input)),
    });
  return (
    <section data-testid="typst-variant-card" className="flex flex-col gap-2 border-b px-3 py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <Input
          value={variant.name}
          onChange={(event) => onChange({ ...variant, name: event.target.value })}
          aria-label={t(($) => $.editor.typstVariants.name)}
          maxLength={64}
          className="h-8 flex-1 text-sm font-medium"
        />
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-label={t(($) => $.editor.typstVariants.removeAria, { name: variant.name })}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" />
          {t(($) => $.editor.typstVariants.remove)}
        </Button>
      </div>
      {variant.inputs.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t(($) => $.editor.typstVariants.noInputs)}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {variant.inputs.map((input) => (
            <div key={input.id} className="flex items-center gap-1.5">
              <Input
                value={input.key}
                onChange={(event) => update(input.id, "key", event.target.value)}
                placeholder={t(($) => $.editor.typstVariants.key)}
                aria-label={t(($) => $.editor.typstVariants.key)}
                maxLength={256}
                className="h-7 w-40 font-mono text-xs"
              />
              <span aria-hidden="true" className="text-xs text-muted-foreground">
                =
              </span>
              <Input
                value={input.value}
                onChange={(event) => update(input.id, "value", event.target.value)}
                placeholder={t(($) => $.editor.typstVariants.value)}
                aria-label={t(($) => $.editor.typstVariants.value)}
                maxLength={4096}
                className="h-7 flex-1 font-mono text-xs"
              />
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="w-6 px-0"
                aria-label={t(($) => $.editor.typstVariants.removeInput)}
                onClick={() =>
                  onChange({ ...variant, inputs: variant.inputs.filter((candidate) => candidate.id !== input.id) })
                }
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() =>
            onChange({ ...variant, inputs: [...variant.inputs, { id: draftId(), key: "", value: "" }] })
          }
        >
          <Plus aria-hidden="true" />
          {t(($) => $.editor.typstVariants.addInput)}
        </Button>
      </div>
    </section>
  );
}

export function TypstVariantsList({
  variants,
  className,
}: Readonly<{ variants: TypstVariantsDraft; className?: string }>) {
  const { t } = useTranslation(["common", "editor"]);
  const { load, draft } = variants;
  return (
    <div className={cn(className)}>
      {load.status === "loading" && <LoadingState className="p-3" label={t(($) => $.editor.typstVariants.loading)} />}
      {load.status === "error" && (
        <ErrorState className="p-3" message={load.message}>
          <Button type="button" size="sm" variant="outline" onClick={variants.reload}>
            {t(($) => $.common.actions.retry)}
          </Button>
        </ErrorState>
      )}
      {load.status === "ready" &&
        (draft.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">{t(($) => $.editor.typstVariants.empty)}</p>
        ) : (
          draft.map((variant) => (
            <VariantCard
              key={variant.id}
              variant={variant}
              onChange={variants.change}
              onRemove={() => variants.remove(variant.id)}
            />
          ))
        ))}
    </div>
  );
}

export function AddVariantButton({ variants }: Readonly<{ variants: TypstVariantsDraft }>) {
  const { t } = useTranslation(["editor"]);
  return (
    <Button type="button" size="sm" variant="outline" disabled={variants.load.status !== "ready"} onClick={variants.add}>
      <Plus aria-hidden="true" />
      {t(($) => $.editor.typstVariants.add)}
    </Button>
  );
}

export function VariantsAlert({
  variants,
  className,
}: Readonly<{ variants: TypstVariantsDraft; className?: string }>) {
  const { t } = useTranslation(["editor"]);
  const problem = variants.problem;
  const text = problem ? t(($) => $.editor.typstVariants[problem]) : variants.saveError;
  if (!text) return null;
  return (
    <p role="alert" className={cn("select-text text-xs text-destructive", className)}>
      {text}
    </p>
  );
}
