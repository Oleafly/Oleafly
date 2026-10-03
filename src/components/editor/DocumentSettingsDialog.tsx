import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isolateHistory } from "@codemirror/commands";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState, LoadingState } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/ui/section-heading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getEditorView } from "@/components/editor/cm/controller";
import { FontFamilyPicker, type FontFamilies } from "@/components/editor/FontFamilyPicker";
import {
  documentSettingsProvider,
  type DocumentSettingsProvider,
  type ProviderContext,
} from "@/components/editor/document-settings-providers";
import {
  AddVariantButton,
  TypstVariantsList,
  VariantsAlert,
  useTypstVariantsDraft,
} from "@/components/typst-variants/TypstVariantsEditor";
import {
  applySettingEdits,
  type DocumentSettingChanges,
  type DocumentSettingState,
} from "@/features/document-settings";
import { logError } from "@/lib/log";
import { readOnlyEditMessage } from "@/lib/read-only-files";
import { readFileContent } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { typstProjectFonts } from "@/lib/typst-options";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";

const DEFAULT_OPTION = "__default__";

type SettingsFields = Record<string, DocumentSettingState>;

type LoadState =
  | { status: "loading" }
  | { status: "ready"; fields: SettingsFields; notices: readonly string[] }
  | { status: "error"; message: string };

function providerContext(): ProviderContext {
  const { engine, engineLoaded } = useFilesStore.getState();
  return engineLoaded && engine ? { engineId: engine.id, texFlavor: engine.tex_flavor ?? null } : {};
}

function readMainText(): Promise<string> {
  const files = useFilesStore.getState();
  const view = getEditorView();
  if (view && files.activePath === files.mainDoc) return Promise.resolve(view.state.doc.toString());
  const loaded = files.files[files.mainDoc]?.content;
  if (typeof loaded === "string") return Promise.resolve(loaded);
  if (!files.projectId) return Promise.reject(new Error("no project"));
  return readFileContent(files.projectId, files.mainDoc);
}

async function writeMainText(
  provider: DocumentSettingsProvider,
  context: ProviderContext,
  changes: DocumentSettingChanges<string>,
): Promise<boolean> {
  const files = useFilesStore.getState();
  const { projectId, mainDoc } = files;
  if (!projectId) return false;
  const text = await readMainText();
  const edits = await provider.edits(text, changes, context);
  if (edits.length === 0) return false;
  const view = getEditorView();
  if (view && useFilesStore.getState().activePath === mainDoc && view.state.doc.toString() === text) {
    view.dispatch({ changes: edits, annotations: isolateHistory.of("full") });
    return true;
  }
  const next = applySettingEdits(text, edits);
  const loaded = files.files[mainDoc]?.content;
  if (loaded !== undefined && useFilesStore.getState().setContent(mainDoc, next)) {
    await useFilesStore.getState().saveFile(mainDoc);
  } else {
    await useFilesStore.getState().writeProjectFile(projectId, mainDoc, next);
  }
  return true;
}

function initialValue(state: DocumentSettingState): string {
  if (state.status === "set") return state.value;
  if (state.status === "locked") return state.source;
  return "";
}

function initialValues(fields: SettingsFields): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, state] of Object.entries(fields)) {
    values[key] = initialValue(state);
  }
  return values;
}

function pendingChanges(fields: SettingsFields, values: Record<string, string>): DocumentSettingChanges<string> {
  const changes: DocumentSettingChanges<string> = {};
  for (const [key, state] of Object.entries(fields)) {
    if (state.status === "locked") continue;
    const value = (values[key] ?? "").trim();
    const initial = state.status === "set" ? state.value : "";
    if (value !== initial) changes[key] = value === "" ? null : value;
  }
  return changes;
}

export function DocumentSettingsDialog({ onClose }: Readonly<{ onClose: () => void }>) {
  const { t } = useTranslation(["editor"]);
  const mainDoc = useFilesStore((state) => state.mainDoc);
  const projectId = useFilesStore((state) => state.projectId);
  const [{ provider, context }] = useState(() => {
    const current = providerContext();
    return { context: current, provider: documentSettingsProvider(current.engineId, useFilesStore.getState().mainDoc) };
  });
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fonts, setFonts] = useState<FontFamilies>({ status: "idle" });
  const live = useRef(true);
  const variants = useTypstVariantsDraft(projectId, provider.id === "typst" && !!projectId);

  useEffect(() => {
    live.current = true;
    const load = async () => {
      if (!provider.file.test(useFilesStore.getState().mainDoc)) {
        setState({ status: "error", message: provider.noMainFile() });
        return;
      }
      try {
        const text = await readMainText();
        const read = await provider.read(text, context);
        if (!live.current) return;
        if (read.status === "error") {
          setState({ status: "error", message: read.message });
          return;
        }
        setState({ status: "ready", fields: read.fields, notices: read.notices });
        setValues(initialValues(read.fields));
      } catch (cause) {
        void logError("read document settings", cause);
        if (live.current) setState({ status: "error", message: t(($) => $.editor.typstSettings.readFailed) });
      }
    };
    void load();
    return () => {
      live.current = false;
    };
  }, [context, provider, t]);

  const loadFonts = useCallback(() => {
    if (fonts.status !== "idle" || !projectId) return;
    setFonts({ status: "loading" });
    typstProjectFonts(projectId).then(
      (list) => {
        if (live.current) setFonts({ status: "ready", families: list.families });
      },
      (cause: unknown) => {
        void logError("list fonts for document settings", cause);
        if (live.current) setFonts({ status: "error" });
      },
    );
  }, [fonts.status, projectId]);

  const fields = state.status === "ready" ? state.fields : null;
  const changes = useMemo(() => (fields && values ? pendingChanges(fields, values) : {}), [fields, values]);
  const invalid = useMemo(() => {
    const keys = new Set<string>();
    for (const [key, value] of Object.entries(changes)) {
      if (value !== null && value !== undefined && !provider.validate(key, value)) keys.add(key);
    }
    return keys;
  }, [changes, provider]);
  const settingsChanged = Object.keys(changes).length > 0;
  const variantsChanged = provider.id === "typst" && variants.dirty;
  const changed = settingsChanged || variantsChanged;

  const apply = async () => {
    if (!changed || invalid.size > 0 || busy) return;
    if (settingsChanged) {
      const readOnly = readOnlyEditMessage(mainDoc);
      if (readOnly) {
        setError(readOnly);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      let updated = false;
      if (variantsChanged) {
        if (!(await variants.save())) return;
        updated = true;
      }
      if (settingsChanged) updated = (await writeMainText(provider, context, changes)) || updated;
      if (!live.current) return;
      if (updated) toast.success(t(($) => $.editor.typstSettings.applied));
      onClose();
    } catch (cause) {
      void logError("write document settings", cause);
      if (live.current) setError(t(($) => $.editor.typstSettings.saveFailed));
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const setValue = (key: string, value: string) => {
    setError(null);
    setValues((current) => (current ? { ...current, [key]: value } : current));
  };

  const field = (key: string) => {
    const fieldState = fields?.[key];
    if (!fieldState || !values) return null;
    const id = `document-setting-${key}`;
    const label = provider.label(key);
    const locked = fieldState.status === "locked";
    const options = provider.selectOptions[key];
    const value = values[key] ?? "";
    const showInvalid = invalid.has(key);
    let control: ReactNode;
    if (options && !locked) {
      const choices = value && !options.includes(value) ? [...options, value] : options;
      control = (
        <Select value={value || DEFAULT_OPTION} onValueChange={(next) => setValue(key, next === DEFAULT_OPTION ? "" : next)}>
          <SelectTrigger id={id} aria-label={label} className="h-8 w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            <SelectItem value={DEFAULT_OPTION}>{t(($) => $.editor.typstSettings.options.default)}</SelectItem>
            {choices.map((option) => (
              <SelectItem key={option} value={option}>{provider.option(key, option)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    } else if (key === provider.fontField && !locked) {
      control = (
        <FontFamilyPicker
          id={id}
          label={label}
          value={value}
          placeholder={provider.placeholder(key)}
          invalid={showInvalid}
          fonts={fonts}
          sources={provider.fontSources}
          onLoad={loadFonts}
          onChange={(next) => setValue(key, next)}
        />
      );
    } else {
      control = (
        <Input
          id={id}
          value={value}
          disabled={locked}
          aria-invalid={showInvalid || undefined}
          placeholder={locked ? undefined : provider.placeholder(key)}
          className={cn("h-8 text-sm", locked && "font-mono text-xs", showInvalid && "border-destructive")}
          onChange={(event) => setValue(key, event.target.value)}
        />
      );
    }
    return (
      <div key={key} className="grid gap-1.5 sm:grid-cols-[10rem_1fr] sm:items-start sm:gap-3">
        <label htmlFor={id} className="pt-1.5 text-sm text-muted-foreground">{label}</label>
        <div className="min-w-0 space-y-1">
          {control}
          {fieldState.status === "locked" && (
            <p className="text-xs text-muted-foreground">{provider.locked(fieldState)}</p>
          )}
          {showInvalid && <p className="text-xs text-destructive">{provider.invalid(key)}</p>}
        </div>
      </div>
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid="document-settings-dialog"
        data-engine={provider.id}
        className="flex max-h-[min(46rem,90dvh)] max-w-2xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted">
              <SlidersHorizontal aria-hidden className="size-4" />
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-sm leading-tight">{t(($) => $.editor.typstSettings.title)}</DialogTitle>
              <DialogDescription className="text-xs">{provider.description(mainDoc)}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {state.status === "loading" && <LoadingState label={t(($) => $.editor.typstSettings.loading)} />}
          {state.status === "error" && <ErrorState message={state.message} />}
          {state.status === "ready" && state.notices.map((notice) => (
            <p key={notice} className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {notice}
            </p>
          ))}
          {fields && values && provider.sections.map((section) => (
            <section key={section.id} className="space-y-3">
              <SectionHeading>{t(($) => $.editor.typstSettings.sections[section.id])}</SectionHeading>
              {section.fields.map(field)}
            </section>
          ))}
          {fields && provider.id === "typst" && (
            <section data-testid="document-settings-variants" className="space-y-3">
              <SectionHeading>{t(($) => $.editor.typstVariants.title)}</SectionHeading>
              <p className="text-xs text-muted-foreground">{t(($) => $.editor.typstVariants.intro)}</p>
              <TypstVariantsList variants={variants} className="rounded-md border" />
              <VariantsAlert variants={variants} />
              <AddVariantButton variants={variants} />
            </section>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3">
          <div className="min-w-0 flex-1">
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>{t(($) => $.editor.typstSettings.cancel)}</Button>
          <Button type="button" size="sm" disabled={!changed || invalid.size > 0 || busy} onClick={() => void apply()}>
            {t(($) => $.editor.typstSettings.apply)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
