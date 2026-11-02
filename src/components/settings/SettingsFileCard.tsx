import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ChevronRight, X } from "lucide-react";
import { Cloud, Download, HardDrive, Upload } from "@/components/icons/pack";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cloudSettingsDownload } from "@/lib/cloud";
import { cloudProviderName } from "@/lib/cloud-providers";
import { readCloudSettings } from "@/lib/cloud-settings";
import { decodeAppError, describeError } from "@/lib/app-error";
import { useCloudStore } from "@/store/cloud";
import { highlightSnippet } from "@/components/settings/snippet";
import { useCatalogUpdates } from "@/i18n/use-catalog-updates";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Spinner } from "@/components/ui/spinner";
import { textToBase64 } from "@/lib/base64";
import { logError } from "@/lib/log";
import { pickSavePath } from "@/lib/native-file-dialog";
import { basename } from "@/lib/path-utils";
import type { ConfigPreferences, SettingsPlan } from "@/lib/settings-file/schema";
import {
  SETTINGS_FILE_NAME,
  applySettingsPlan,
  buildSettingsDocument,
  onConfigPreferencesSaved,
  readConfigPreferences,
  readLocalSnapshot,
  readSettingsFile,
  serializeSettingsDocument,
  watchSettingsSources,
  type SettingsFileProblem,
} from "@/lib/settings-file/transfer";
import type { SettingIssue } from "@/lib/settings-file/values";
import {
  SET_THEME_PREFERENCE_EVENT,
  TOGGLE_THEME_EVENT,
  getStoredPreference,
  isThemePreference,
  requestThemePreference,
  type ThemePreference,
} from "@/lib/theme";
import { THEME_CUSTOMIZATION_CHANGED_EVENT } from "@/lib/theme-customization";
import { pickSettingsFile } from "@/lib/settings-file/native";
import { writeBytesFile } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const SHOWN_PROBLEMS = 6;
const SHOWN_IGNORED = 5;

type Translate = TFunction<["settingsFile", "common", "settings"]>;

interface PendingImport {
  name: string;
  plan: SettingsPlan;
  changed: number;
  ignored: string[];
  stamp?: string;
}

interface ImportProblem {
  name: string;
  reason: "notJson" | "notSettings" | "invalid";
  problems: SettingsFileProblem[];
}

function settingsJson(config: ConfigPreferences | null, theme: ThemePreference): string {
  return serializeSettingsDocument(buildSettingsDocument(readLocalSnapshot(config, theme)));
}

function quoted(values: readonly (string | number)[]): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

function issueText(t: Translate, issue: SettingIssue): string {
  switch (issue.kind) {
    case "boolean":
      return t(($) => $.settingsFile.valueErrors.boolean);
    case "oneOf":
      return t(($) => $.settingsFile.valueErrors.oneOf, { values: quoted(issue.values) });
    case "range":
      return t(($) => $.settingsFile.valueErrors.range, { min: issue.min, max: issue.max });
    case "wholeRange":
      return issue.step > 1
        ? t(($) => $.settingsFile.valueErrors.wholeRangeStep, { min: issue.min, max: issue.max, step: issue.step })
        : t(($) => $.settingsFile.valueErrors.wholeRange, { min: issue.min, max: issue.max });
    case "hexColor":
      return t(($) => $.settingsFile.valueErrors.hexColor);
    case "hexColorOrEmpty":
      return t(($) => $.settingsFile.valueErrors.hexColorOrEmpty);
    case "text":
      return t(($) => $.settingsFile.valueErrors.text, { max: issue.max });
    case "list":
      return t(($) => $.settingsFile.valueErrors.list, { max: issue.max });
    case "listItem":
      return t(($) => $.settingsFile.valueErrors.listItem);
    case "duplicate":
      return t(($) => $.settingsFile.valueErrors.duplicate);
    case "object":
      return t(($) => $.settingsFile.valueErrors.object);
    case "unknownKey":
      return t(($) => $.settingsFile.valueErrors.unknownKey);
    case "dictionaryLocale":
      return t(($) => $.settingsFile.valueErrors.dictionaryLocale);
    case "shortcut":
      return t(($) => $.settingsFile.valueErrors.shortcut);
    case "editorKey":
      return t(($) => $.settingsFile.valueErrors.editorKey);
    case "reservedShortcut":
      return t(($) => $.settings.shortcuts.error.reserved, {
        shortcut: t(($) => $.settings.shortcuts.reserved[issue.action]),
      });
    case "detail":
      return issue.message;
  }
}

function reasonText(t: Translate, reason: ImportProblem["reason"]): string {
  if (reason === "notJson") return t(($) => $.settingsFile.error.notJson);
  if (reason === "notSettings") return t(($) => $.settingsFile.error.notSettings);
  return t(($) => $.settingsFile.error.invalid);
}

function ProblemNotice({
  problem,
  onDismiss,
}: Readonly<{ problem: ImportProblem; onDismiss: () => void }>) {
  const { t } = useTranslation(["settingsFile", "common", "settings"]);
  const hidden = problem.problems.length - SHOWN_PROBLEMS;
  return (
    <div role="alert" data-testid="settings-file-problem" className="relative space-y-2 border-t bg-destructive/5 p-3 pr-11 text-xs">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t(($) => $.common.actions.close)}
        data-testid="settings-file-problem-close"
        className="absolute right-2 top-2 size-7"
        onClick={onDismiss}
      >
        <X aria-hidden className="size-3.5" />
      </Button>
      <p className="font-medium text-destructive">{t(($) => $.settingsFile.error.title, { name: problem.name })}</p>
      <p className="text-muted-foreground">{reasonText(t, problem.reason)}</p>
      {problem.problems.length > 0 && (
        <ul className="list-disc space-y-1 pl-4 marker:text-muted-foreground">
          {problem.problems.slice(0, SHOWN_PROBLEMS).map(({ path, issue }) => (
            <li key={path} className="break-words">
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem] text-foreground">{path}</code>{" "}
              <span className="text-muted-foreground">{issueText(t, issue)}</span>
            </li>
          ))}
          {hidden > 0 && (
            <li className="text-muted-foreground">{t(($) => $.settingsFile.error.more, { count: hidden })}</li>
          )}
        </ul>
      )}
    </div>
  );
}

const THEME = {
  get preference() {
    return getStoredPreference();
  },
  setPreference: (preference: ThemePreference) => requestThemePreference(preference),
};

function SettingsJsonView() {
  const { t } = useTranslation(["settingsFile", "common"]);
  const [json, setJson] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let config: ConfigPreferences | null = null;
    let preference = getStoredPreference();
    const render = () => {
      frame = 0;
      if (cancelled) return;
      try {
        setJson(settingsJson(config, preference));
      } catch (error) {
        void logError("show settings json", error);
        setFailed(true);
      }
    };
    const schedule = () => {
      if (!cancelled && frame === 0) frame = window.requestAnimationFrame(render);
    };
    const onThemeRequest = (event: Event) => {
      const requested = event instanceof CustomEvent ? event.detail : null;
      preference = isThemePreference(requested) ? requested : getStoredPreference();
      schedule();
    };
    const onThemeToggle = () =>
      window.requestAnimationFrame(() => {
        preference = getStoredPreference();
        schedule();
      });
    const loadConfig = () =>
      void readConfigPreferences().then((loaded) => {
        config = loaded;
        schedule();
      });
    loadConfig();
    const unsubscribe = [onConfigPreferencesSaved(loadConfig), watchSettingsSources(schedule)];
    window.addEventListener(THEME_CUSTOMIZATION_CHANGED_EVENT, schedule);
    window.addEventListener(SET_THEME_PREFERENCE_EVENT, onThemeRequest);
    window.addEventListener(TOGGLE_THEME_EVENT, onThemeToggle);
    return () => {
      cancelled = true;
      if (frame !== 0) window.cancelAnimationFrame(frame);
      for (const stop of unsubscribe) stop();
      window.removeEventListener(THEME_CUSTOMIZATION_CHANGED_EVENT, schedule);
      window.removeEventListener(SET_THEME_PREFERENCE_EVENT, onThemeRequest);
      window.removeEventListener(TOGGLE_THEME_EVENT, onThemeToggle);
    };
  }, []);

  const highlighted = useMemo(() => highlightSnippet(json ?? "", "json"), [json]);

  if (failed) {
    return <p className="border-t p-3 text-xs text-destructive">{t(($) => $.settingsFile.view.failed)}</p>;
  }
  if (json === null) {
    return (
      <p className="flex items-center gap-2 border-t p-3 text-xs text-muted-foreground">
        <Spinner size="sm" />
        {t(($) => $.settingsFile.view.loading)}
      </p>
    );
  }
  return (
    <div id="settings-file-json" className="space-y-2 border-t p-3">
      <p className="text-xs text-muted-foreground">{t(($) => $.settingsFile.view.summary)}</p>
      <CodeBlock code={json} data-testid="settings-file-json" preClassName="max-h-96 p-2.5 pr-10">
        <code>{highlighted}</code>
      </CodeBlock>
    </div>
  );
}

export default function SettingsFileCard() {
  const { t } = useTranslation(["settingsFile", "common"]);
  useCatalogUpdates("settingsFile");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [problem, setProblem] = useState<ImportProblem | null>(null);
  const [viewOpen, setViewOpen] = useState(false);

  const exportSettings = async () => {
    setBusy(true);
    try {
      const destination = await pickSavePath({
        defaultPath: SETTINGS_FILE_NAME,
        filters: [{ name: t(($) => $.settingsFile.dialog.filterName), extensions: ["json"] }],
      });
      if (!destination) return;
      const json = settingsJson(await readConfigPreferences(), getStoredPreference());
      await writeBytesFile(destination, textToBase64(json));
      toast.success(t(($) => $.settingsFile.toast.exported, { name: basename(destination) || destination }));
    } catch (error) {
      void logError("export settings", error);
      toast.error(t(($) => $.settingsFile.toast.exportFailed));
    } finally {
      setBusy(false);
    }
  };

  const importSettings = async () => {
    setProblem(null);
    setBusy(true);
    try {
      const picked = await pickSettingsFile(
        t(($) => $.settingsFile.dialog.pickTitle),
        t(($) => $.settingsFile.dialog.filterName),
      );
      if (!picked) return;
      const result = readSettingsFile(
        picked.text,
        readLocalSnapshot(await readConfigPreferences(), getStoredPreference()),
      );
      if (!result.ok) {
        setProblem({ name: picked.name, reason: result.reason, problems: result.reason === "invalid" ? result.problems : [] });
        return;
      }
      if (result.changed.length === 0) {
        toast.info(t(($) => $.settingsFile.toast.unchanged, { name: picked.name }));
        return;
      }
      setPending({ name: picked.name, plan: result.plan, changed: result.changed.length, ignored: result.ignored });
    } catch (error) {
      void logError("import settings", error);
      toast.error(t(($) => $.settingsFile.toast.readFailed));
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = useCallback(() => {
    if (!pending) return;
    const { plan, stamp } = pending;
    setPending(null);
    const cloud = useCloudStore.getState();
    const apply =
      stamp === undefined
        ? applySettingsPlan(plan, THEME)
        : cloud.whileApplyingSettings(async () => {
            await applySettingsPlan(plan, THEME);
            await cloud.settingsImported(stamp);
          });
    apply.then(
      () => toast.success(t(($) => $.settingsFile.toast.imported)),
      (error: unknown) => {
        void logError("apply imported settings", error);
        toast.error(t(($) => $.settingsFile.toast.applyFailed));
      },
    );
  }, [pending, t]);

  const importFromCloud = useCallback(async () => {
    const cloud = useCloudStore.getState();
    if (cloud.status === "unknown") await cloud.refresh();
    if (useCloudStore.getState().status !== "connected") {
      cloud.requestSettingsImport();
      useCloudStore.getState().requestNav("data-cloud");
      return;
    }
    setProblem(null);
    setBusy(true);
    const provider = cloudProviderName(useCloudStore.getState().state?.provider);
    try {
      const { values, stamp } = await cloudSettingsDownload();
      if (!values) {
        toast.info(t(($) => $.settingsFile.toast.cloudEmpty, { provider }));
        return;
      }
      const result = readCloudSettings(
        values,
        readLocalSnapshot(await readConfigPreferences(), getStoredPreference()),
      );
      if (!result.ok) {
        toast.error(t(($) => $.settingsFile.toast.cloudUnreadable, { provider }));
        return;
      }
      const name = t(($) => $.settingsFile.cloudSource, { provider });
      if (result.changed.length === 0) {
        await cloud.settingsImported(stamp);
        toast.info(t(($) => $.settingsFile.toast.unchanged, { name }));
        return;
      }
      setPending({ name, plan: result.plan, changed: result.changed.length, ignored: result.ignored, stamp });
    } catch (error) {
      void logError("import settings from cloud", error);
      toast.error(
        decodeAppError(error) ? describeError(error) : t(($) => $.settingsFile.toast.cloudLoadFailed, { provider }),
      );
    } finally {
      setBusy(false);
    }
  }, [t]);

  const settingsImport = useCloudStore((s) => s.settingsImport);
  useEffect(() => {
    if (settingsImport === "resume" && useCloudStore.getState().takeSettingsImport()) {
      void importFromCloud();
    }
  }, [settingsImport, importFromCloud]);

  const confirmDescription = useMemo(() => {
    if (!pending) return "";
    const parts = [
      pending.stamp === undefined
        ? t(($) => $.settingsFile.confirm.description, { name: pending.name })
        : t(($) => $.settingsFile.confirm.cloudDescription, {
            provider: cloudProviderName(useCloudStore.getState().state?.provider),
          }),
      t(($) => $.settingsFile.confirm.changes, { count: pending.changed }),
    ];
    if (pending.ignored.length > 0) {
      const shown = pending.ignored.slice(0, SHOWN_IGNORED).join(", ");
      const hidden = pending.ignored.length - SHOWN_IGNORED;
      const more = hidden > 0 ? ` ${t(($) => $.settingsFile.error.more, { count: hidden })}` : "";
      parts.push(`${t(($) => $.settingsFile.confirm.ignored)} ${shown}${more}`);
    }
    return parts.join(" ");
  }, [pending, t]);

  return (
    <section
      aria-labelledby="settings-file-title"
      data-testid="settings-file"
      className="select-none overflow-hidden rounded-lg border bg-card"
    >
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <h3 id="settings-file-title" className="text-sm font-medium">
            {t(($) => $.settingsFile.title)}
          </h3>
          <p className="text-xs text-muted-foreground">{t(($) => $.settingsFile.description)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            data-testid="settings-file-export"
            onClick={() => void exportSettings()}
          >
            <Download aria-hidden className="size-3.5" />
            {t(($) => $.settingsFile.export)}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="secondary" size="sm" disabled={busy} data-testid="settings-file-import">
                <Upload aria-hidden className="size-3.5" />
                {t(($) => $.settingsFile.import)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[100]">
              <DropdownMenuItem data-testid="settings-file-import-local" onSelect={() => void importSettings()}>
                <HardDrive aria-hidden className="size-4" />
                {t(($) => $.settingsFile.importFromLocal)}
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="settings-file-import-cloud" onSelect={() => void importFromCloud()}>
                <Cloud aria-hidden className="size-4" />
                {t(($) => $.settingsFile.importFromCloud)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {problem && <ProblemNotice problem={problem} onDismiss={() => setProblem(null)} />}
      <div className="border-t">
        <button
          type="button"
          aria-expanded={viewOpen}
          aria-controls={viewOpen ? "settings-file-json" : undefined}
          data-testid="settings-file-view"
          onClick={() => setViewOpen((open) => !open)}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/40 focus-visible:bg-accent/60"
        >
          <span className="min-w-0 flex-1 font-medium">{t(($) => $.settingsFile.view.label)}</span>
          <ChevronRight
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground motion-safe:transition-transform",
              viewOpen && "rotate-90",
            )}
          />
        </button>
        {viewOpen && <SettingsJsonView />}
      </div>
      <ConfirmationDialog
        open={pending !== null}
        title={t(($) => $.settingsFile.confirm.title)}
        description={confirmDescription}
        confirmLabel={t(($) => $.settingsFile.confirm.action)}
        onConfirm={confirmImport}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
