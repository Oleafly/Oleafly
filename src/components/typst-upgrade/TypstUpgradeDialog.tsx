import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider, useTranslation } from "react-i18next";
import { ArrowUpCircle } from "lucide-react";
import { create } from "zustand";
import { i18n } from "@/i18n";
import { ModalShell } from "@/components/ui/modal-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/empty";
import { SectionHeading } from "@/components/ui/section-heading";
import { decodeAppError, describeError } from "@/lib/app-error";
import { compileOfflineForEngine } from "@/lib/document-engine";
import { logError } from "@/lib/log";
import { openProjectLocation } from "@/lib/open-location";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { engineSwitchToastKey, useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { openTypstVersionSettings, useTypstToolchainStore } from "@/store/typst-toolchain";
import { activeTypstVariant } from "@/store/typst-variant";
import {
  typstUpgradeCheck,
  type TypstUpgradeFinding,
  type TypstUpgradeReport,
  type TypstUpgradeRun,
} from "./api";
import { newerInstalledTypstVersions, projectTypstVersion } from "./versions";

const TITLE_ID = "typst-upgrade-title";
const DESCRIPTION_ID = "typst-upgrade-description";

type CheckState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly version: string }
  | { readonly status: "ready"; readonly version: string; readonly report: TypstUpgradeReport }
  | { readonly status: "error"; readonly message: string };

function RunSummary({ run, label }: Readonly<{ run: TypstUpgradeRun; label: string }>) {
  const { t } = useTranslation(["shell"]);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-md border p-3" data-testid={`typst-upgrade-run-${run.version}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{label}</span>
        <Badge variant={run.ok ? "success" : "destructive"} size="sm">
          {run.ok ? t(($) => $.shell.typstUpgrade.built) : t(($) => $.shell.typstUpgrade.failed)}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {run.pages === null
          ? t(($) => $.shell.typstUpgrade.pagesUnknown)
          : t(($) => $.shell.typstUpgrade.pages, { count: run.pages })}
      </p>
      <p className="text-xs text-muted-foreground">
        {t(($) => $.shell.typstUpgrade.errors, { count: run.errors })}
        {", "}
        {t(($) => $.shell.typstUpgrade.warnings, { count: run.warnings })}
      </p>
    </div>
  );
}

function FindingRow({
  finding,
  onOpen,
}: Readonly<{ finding: TypstUpgradeFinding; onOpen: (finding: TypstUpgradeFinding) => void }>) {
  const { t } = useTranslation(["shell"]);
  const location =
    finding.file && finding.line !== null
      ? t(($) => $.shell.typstUpgrade.location, { file: finding.file, line: finding.line })
      : finding.file;
  return (
    <li>
      <button
        type="button"
        disabled={!finding.file}
        onClick={() => onOpen(finding)}
        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
      >
        <Badge variant={finding.kind === "error" ? "destructive" : "warning"} size="sm" className="mt-0.5 shrink-0">
          {finding.kind === "error" ? t(($) => $.shell.typstUpgrade.error) : t(($) => $.shell.typstUpgrade.warning)}
        </Badge>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="break-words text-xs">{finding.message}</span>
          {location && <span className="truncate font-mono text-[11px] text-muted-foreground">{location}</span>}
        </span>
      </button>
    </li>
  );
}

function keyedFindings(findings: readonly TypstUpgradeFinding[]) {
  const seen = new Map<string, number>();
  return findings.map((finding) => {
    const base = `${finding.kind}:${finding.file}:${finding.line}:${finding.message}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return { key: `${base}#${occurrence}`, finding };
  });
}

function FindingList({
  title,
  findings,
  onOpen,
}: Readonly<{ title: string; findings: readonly TypstUpgradeFinding[]; onOpen: (finding: TypstUpgradeFinding) => void }>) {
  if (findings.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <SectionHeading>{title}</SectionHeading>
      <ul className="flex flex-col">
        {keyedFindings(findings).map(({ key, finding }) => (
          <FindingRow key={key} finding={finding} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

function ReportView({
  report,
  onOpen,
}: Readonly<{ report: TypstUpgradeReport; onOpen: (finding: TypstUpgradeFinding) => void }>) {
  const { t } = useTranslation(["shell"]);
  const { current, candidate } = report;
  const pagesKnown = current.pages !== null && candidate.pages !== null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <RunSummary run={current} label={t(($) => $.shell.typstUpgrade.current, { version: current.version })} />
        <RunSummary run={candidate} label={t(($) => $.shell.typstUpgrade.candidate, { version: candidate.version })} />
      </div>
      {pagesKnown && (
        <p className="text-xs">
          {current.pages === candidate.pages
            ? t(($) => $.shell.typstUpgrade.pageSame, { pages: current.pages ?? 0 })
            : t(($) => $.shell.typstUpgrade.pageChange, { from: current.pages ?? 0, to: candidate.pages ?? 0 })}
        </p>
      )}
      {[current, candidate]
        .filter((run) => run.failure)
        .map((run) => (
          <div key={run.version} className="flex flex-col gap-1">
            <p className="text-xs text-destructive">
              {t(($) => $.shell.typstUpgrade.buildFailed, { version: run.version })}
            </p>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[11px]">
              {run.failure}
            </pre>
          </div>
        ))}
      <FindingList
        title={t(($) => $.shell.typstUpgrade.added, { version: candidate.version })}
        findings={report.added}
        onOpen={onOpen}
      />
      <FindingList
        title={t(($) => $.shell.typstUpgrade.removed, { version: candidate.version })}
        findings={report.removed}
        onOpen={onOpen}
      />
      {report.added.length === 0 && report.removed.length === 0 && (
        <p className="text-xs text-muted-foreground">{t(($) => $.shell.typstUpgrade.noChanges)}</p>
      )}
      {report.unchanged > 0 && (
        <p className="text-xs text-muted-foreground">
          {t(($) => $.shell.typstUpgrade.unchanged, { count: report.unchanged })}
        </p>
      )}
    </div>
  );
}

export function TypstUpgradeDialog({
  open,
  onClose,
  initialVersion = null,
}: Readonly<{ open: boolean; onClose: () => void; initialVersion?: string | null }>) {
  const { t } = useTranslation(["shell"]);
  const projectId = useFilesStore((state) => state.projectId);
  const engine = useFilesStore((state) => state.engine);
  const status = useTypstToolchainStore((state) => state.status);
  const ensureLoaded = useTypstToolchainStore((state) => state.ensureLoaded);
  const currentVersion = projectTypstVersion(engine, status);
  const choices = useMemo(() => newerInstalledTypstVersions(status, currentVersion), [status, currentVersion]);
  const [picked, setPicked] = useState<string | null>(initialVersion);
  const [state, setState] = useState<CheckState>({ status: "idle" });
  const [switching, setSwitching] = useState(false);
  const request = useRef(0);
  const version = picked && choices.includes(picked) ? picked : (choices[0] ?? null);

  useEffect(() => {
    if (open) setPicked(initialVersion);
  }, [open, initialVersion]);

  useEffect(() => {
    if (open) void ensureLoaded();
  }, [open, ensureLoaded]);

  const runCheck = useCallback(() => {
    if (!open || !projectId || !version) return;
    const current = ++request.current;
    setState({ status: "loading", version });
    const files = useFilesStore.getState();
    typstUpgradeCheck({
      projectId,
      mainDoc: resolveEffectiveMainDoc().mainDoc,
      version,
      offline: compileOfflineForEngine(files.engine, useSettingsStore.getState().offline).offline,
      typstVariant: activeTypstVariant(projectId, files.engine),
    }).then(
      (report) => {
        if (current === request.current) setState({ status: "ready", version, report });
      },
      (error: unknown) => {
        if (current === request.current) setState({ status: "error", message: describeError(error) });
      },
    );
    return () => {
      request.current += 1;
    };
  }, [open, projectId, version]);

  useEffect(runCheck, [runCheck]);

  const openFinding = (finding: TypstUpgradeFinding) => {
    if (!finding.file) return;
    onClose();
    if (useSettingsStore.getState().settingsOpen) useSettingsStore.getState().setSettingsOpen(false);
    void openProjectLocation(
      { path: finding.file, line: finding.line ?? undefined, column: finding.column ?? undefined },
      { pdfView: "editor" },
    );
  };

  const switchVersion = async () => {
    if (!projectId || state.status !== "ready") return;
    const target = state.version;
    setSwitching(true);
    try {
      await useFilesStore.getState().setTypstVersion(target);
      toast.success(t(($) => $.shell.typstUpgrade.switched, { version: target }));
      onClose();
    } catch (error) {
      void logError("switch Typst version", error);
      toast.errorUnique(
        engineSwitchToastKey(projectId),
        decodeAppError(error) ? describeError(error) : t(($) => $.shell.typstUpgrade.switchFailed),
      );
    } finally {
      setSwitching(false);
    }
  };

  const renderBody = () => {
    if (!version) {
      if (!status) return <LoadingState label={t(($) => $.shell.typstUpgrade.compareWith)} />;
      return (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">{t(($) => $.shell.typstUpgrade.noNewer)}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              onClose();
              openTypstVersionSettings();
            }}
          >
            {t(($) => $.shell.typstUpgrade.openSettings)}
          </Button>
        </div>
      );
    }
    if (state.status === "error") {
      return (
        <ErrorState message={`${t(($) => $.shell.typstUpgrade.checkFailed)} ${state.message}`}>
          <Button type="button" size="sm" variant="outline" onClick={() => runCheck()}>
            {t(($) => $.shell.typstUpgrade.runAgain)}
          </Button>
        </ErrorState>
      );
    }
    if (state.status === "ready" && state.version === version) {
      return <ReportView report={state.report} onOpen={openFinding} />;
    }
    return (
      <LoadingState
        label={t(($) => $.shell.typstUpgrade.running, { current: currentVersion ?? "", candidate: version })}
      />
    );
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      closeLabel={t(($) => $.shell.typstUpgrade.close)}
      align="top"
      portal
      labelledBy={TITLE_ID}
      describedBy={DESCRIPTION_ID}
      testId="typst-upgrade-dialog"
      className="flex max-h-[80vh] w-[36rem] max-w-[92vw] flex-col"
    >
      <div className="flex items-start gap-3 border-b px-4 py-3">
        <ArrowUpCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-1">
          <span id={TITLE_ID} className="text-sm font-semibold">
            {t(($) => $.shell.typstUpgrade.title)}
          </span>
          <p id={DESCRIPTION_ID} className="text-xs text-muted-foreground">
            {t(($) => $.shell.typstUpgrade.description)}
          </p>
        </div>
      </div>
      {choices.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
          <span className="mr-1 text-xs text-muted-foreground">{t(($) => $.shell.typstUpgrade.compareWith)}</span>
          {choices.map((choice) => (
            <Button
              key={choice}
              type="button"
              size="xs"
              variant={choice === version ? "secondary" : "ghost"}
              aria-pressed={choice === version}
              className={cn(choice === version && "font-semibold")}
              onClick={() => setPicked(choice)}
            >
              {choice}
            </Button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{renderBody()}</div>
      <div className="flex items-center justify-end gap-2 border-t px-4 py-2.5">
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t(($) => $.shell.typstUpgrade.close)}
        </Button>
        {state.status === "ready" && version && (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => runCheck()}>
              {t(($) => $.shell.typstUpgrade.runAgain)}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={switching || state.version !== version}
              onClick={() => void switchVersion()}
              data-modal-initial-focus
            >
              {t(($) => $.shell.typstUpgrade.switch, { version: state.version })}
            </Button>
          </>
        )}
      </div>
    </ModalShell>
  );
}

const useUpgradeDialog = create<{
  open: boolean;
  version: string | null;
  show: (version: string | null) => void;
  hide: () => void;
}>((set) => ({
  open: false,
  version: null,
  show: (version) => set({ open: true, version }),
  hide: () => set({ open: false }),
}));

function TypstUpgradeDialogHost() {
  const open = useUpgradeDialog((state) => state.open);
  const version = useUpgradeDialog((state) => state.version);
  const hide = useUpgradeDialog((state) => state.hide);
  return <TypstUpgradeDialog open={open} onClose={hide} initialVersion={version} />;
}

let root: Root | null = null;

export function showTypstUpgradeDialog(version: string | null = null): void {
  if (!root) {
    const container = document.createElement("div");
    container.dataset.typstUpgrade = "";
    document.body.append(container);
    root = createRoot(container);
    root.render(
      <I18nextProvider i18n={i18n}>
        <TypstUpgradeDialogHost />
      </I18nextProvider>,
    );
  }
  useUpgradeDialog.getState().show(version);
}
