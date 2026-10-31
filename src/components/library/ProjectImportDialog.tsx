import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import { ChoiceCard } from "@/components/library/ChoiceCard";
import { CHOICE_ART } from "@/components/library/choice-art";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { announceSavedTemplate, saveProjectTemplate } from "@/features/custom-templates";
import { i18n } from "@/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { pickOpenPath } from "@/lib/native-file-dialog";
import {
  IMPORT_FILE_SOURCES,
  cloneRepository,
  importPickerOptions,
  importArxivPaper,
  importFileKind,
  importForgeRepository,
  importSelectedFile,
  importTargetsForKind,
  type ProjectImportFileKind,
} from "@/features/project-import";
import { cancelRepositoryImport } from "@/lib/forge";
import type { ForgeAccount, ForgeRepo } from "@/lib/tauri";
import { useForgeAccountsStore } from "@/store/forge-accounts";
import { useSettingsStore } from "@/store/settings";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { notifyError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { basename } from "@/lib/path-utils";
import { Spinner } from "@/components/ui/spinner";
import { useFilesStore } from "@/store/files";

const OverleafImportView = lazy(() =>
  import("@/components/library/overleaf/OverleafImportView").then((module) => ({
    default: module.OverleafImportView,
  })),
);

const GitImportView = lazy(() =>
  import("@/components/library/GitImportView").then((module) => ({
    default: module.GitImportView,
  })),
);

type ImportView = "sources" | "git" | "target" | "arxiv" | "overleaf";

const VIEW_WIDTH: Record<ImportView, string> = {
  sources: "max-w-3xl",
  overleaf: "h-[min(48rem,calc(100dvh-2rem))] max-w-5xl",
  git: "max-w-xl",
  target: "max-w-xl",
  arxiv: "max-w-xl",
};

const SOURCE_ART: Record<ProjectImportFileKind, string> = {
  project: CHOICE_ART.importArchive,
  word: CHOICE_ART.importWord,
  markdown: CHOICE_ART.importMarkdown,
  html: CHOICE_ART.importHtml,
  typst: CHOICE_ART.importTypst,
};

async function keepImportAsTemplate(previousProjectId: string | null): Promise<void> {
  const { projectId, projectName } = useFilesStore.getState();
  if (!projectId || projectId === previousProjectId) return;
  const name = projectName.trim() || basename(projectId);
  try {
    const templateId = await saveProjectTemplate(projectId, name);
    announceSavedTemplate(templateId, name);
  } catch (error) {
    notifyError(
      "save the import as a template",
      error,
      i18n.t(($) => $.library.customTemplates.saveFailed),
    );
  }
}

export function ProjectImportDialog({
  open,
  onClose,
  onImported,
  initialView = "sources",
}: Readonly<{
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
  initialView?: "sources" | "arxiv" | "overleaf" | "git";
}>) {
  const { t } = useTranslation(["library", "common"]);
  const sourceCopy: Record<ProjectImportFileKind, { title: string; description: string }> = {
    project: {
      title: t(($) => $.library.import.sources.project.title),
      description: t(($) => $.library.import.sources.project.description),
    },
    word: {
      title: t(($) => $.library.import.sources.word.title),
      description: t(($) => $.library.import.sources.word.description),
    },
    markdown: {
      title: t(($) => $.library.import.sources.markdown.title),
      description: t(($) => $.library.import.sources.markdown.description),
    },
    html: {
      title: t(($) => $.library.import.sources.html.title),
      description: t(($) => $.library.import.sources.html.description),
    },
    typst: {
      title: t(($) => $.library.import.sources.typst.title),
      description: t(($) => $.library.import.sources.typst.description),
    },
  };
  const gitAccounts = useForgeAccountsStore((state) => state.accounts.length);
  const [view, setView] = useState<ImportView>(
    initialView,
  );
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [arxivId, setArxivId] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyKind, setBusyKind] = useState<ProjectImportFileKind | null>(null);
  const busyRef = useRef(false);
  const [cancellable, setCancellable] = useState(false);
  const cancellableRef = useRef(false);
  const cancelledRef = useRef(false);
  const sessionRef = useRef(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [alsoTemplate, setAlsoTemplate] = useState(false);
  const alsoTemplateId = useId();

  useEffect(() => {
    sessionRef.current += 1;
    setView(initialView);
    setPendingPath(null);
    setErrorMessage(null);
    setAlsoTemplate(false);
    if (!open) setArxivId("");
    return () => { sessionRef.current += 1; };
  }, [open, initialView]);

  useEffect(() => {
    if (open) void useForgeAccountsStore.getState().ensureLoaded();
  }, [open]);

  const reportError = (error: unknown) => {
    const detail = error instanceof Error || typeof error === "string" ? describeError(error) : t(($) => $.library.import.failed);
    setErrorMessage(detail);
    void logError("project import", error);
  };

  const cancelImport = () => {
    if (!busyRef.current || !cancellableRef.current || cancelledRef.current) return;
    cancelledRef.current = true;
    void cancelRepositoryImport().catch((error: unknown) => {
      void logError("cancel repository import", error);
    });
  };

  const runImport = async (work: () => Promise<boolean>, options: { cancellable?: boolean } = {}) => {
    if (busyRef.current) return;
    busyRef.current = true;
    cancellableRef.current = options.cancellable === true;
    cancelledRef.current = false;
    setCancellable(cancellableRef.current);
    setBusy(true);
    setErrorMessage(null);
    const keepAsTemplate = alsoTemplate;
    const before = useFilesStore.getState().projectId;
    try {
      const imported = await work();
      if (imported === false) {
        setErrorMessage(t(($) => $.library.import.converterUnavailable));
      } else {
        onImported?.();
        onClose();
        if (keepAsTemplate) void keepImportAsTemplate(before);
      }
    } catch (error) {
      if (!cancelledRef.current) reportError(error);
    } finally {
      busyRef.current = false;
      cancellableRef.current = false;
      cancelledRef.current = false;
      setCancellable(false);
      setBusy(false);
    }
  };

  const importFile = async (kind: ProjectImportFileKind) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setBusyKind(kind);
    setErrorMessage(null);
    const session = sessionRef.current;
    let selection: string | null = null;
    try {
      const picked = await pickOpenPath(importPickerOptions(kind));
      if (session !== sessionRef.current || typeof picked !== "string") return;
      selection = picked;
      const fileKind = importFileKind(picked);
      if (!fileKind) throw new Error(t(($) => $.library.import.supportedTypes));
      if (importTargetsForKind(fileKind).length > 1) {
        setPendingPath(picked);
        setView("target");
        selection = null;
      }
    } catch (error) {
      reportError(error);
      selection = null;
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (!selection) setBusyKind(null);
    }
    if (selection) {
      await runImport(() => importSelectedFile(selection));
      setBusyKind(null);
    }
  };

  const importWithTarget = async (target: "latex" | "markdown" | "typst") => {
    if (pendingPath) await runImport(() => importSelectedFile(pendingPath, target));
  };

  const importFromArxiv = async () => {
    if (arxivId.trim()) await runImport(() => importArxivPaper(arxivId));
  };

  const importRepository = async (account: ForgeAccount, repository: ForgeRepo) => {
    await runImport(
      async () => {
        await importForgeRepository(account.base, repository);
        return true;
      },
      { cancellable: true },
    );
  };

  const cloneByAddress = async (url: string) => {
    await runImport(
      async () => {
        await cloneRepository(url);
        return true;
      },
      { cancellable: true },
    );
  };

  const openGitHostingSettings = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("integrations");
    settings.setSettingsScrollTarget("git-hosting");
    settings.setSettingsOpen(true);
    onClose();
  };

  const viewTitles: Record<ImportView, string> = {
    sources: t(($) => $.library.import.title),
    git: t(($) => $.library.import.gitTitle),
    target: t(($) => $.library.import.targetTitle),
    arxiv: t(($) => $.library.import.arxivTitle),
    overleaf: t(($) => $.library.import.overleaf.title),
  };
  const viewDescriptions: Record<ImportView, string> = {
    sources: t(($) => $.library.import.description),
    git: t(($) => $.library.import.gitDescription),
    target: t(($) => $.library.import.targetDescription),
    arxiv: t(($) => $.library.import.arxivDescription),
    overleaf: t(($) => $.library.import.overleaf.description),
  };

  const renderBody = () => {
    if (view === "overleaf") {
      return (
            <Suspense
              fallback={
                <output className="flex flex-1 items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Spinner />
                </output>
              }
            >
              <OverleafImportView
                onDone={onClose}
                onOpenProject={(projectId) => {
                  onClose();
                  void useFilesStore.getState().openProject(projectId);
                }}
              />
            </Suspense>
      );
    }
    if (view === "target") {
      return (
            <div className="grid gap-2">
              <p className="select-text break-all text-xs text-muted-foreground">{pendingPath && basename(pendingPath)}</p>
              {importTargetsForKind(importFileKind(pendingPath ?? "") ?? "word").map(
                (target) => (
                  <button
                    key={target.target}
                    type="button"
                    disabled={busy}
                    data-testid={`project-import-target-${target.target}`}
                    onClick={() => void importWithTarget(target.target)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors",
                      "hover:border-primary/40 hover:bg-accent focus-visible:border-primary disabled:opacity-60",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">
                        {target.label}
                      </span>
                      {target.recommended ? (
                        <span className="block text-xs text-muted-foreground">
                          {t(($) => $.library.import.recommended)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ),
              )}
            </div>
      );
    }
    if (view === "arxiv") {
      return (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  aria-label={t(($) => $.library.import.arxivInputLabel)}
                  disabled={busy}
                  data-testid="project-import-arxiv-id"
                  value={arxivId}
                  placeholder={t(($) => $.library.import.arxivPlaceholder)}
                  onChange={(event) => setArxivId(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void importFromArxiv();
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || arxivId.trim() === ""}
                  onClick={() => void importFromArxiv()}
                >
                  {busy ? (
                    <Spinner size="sm" />
                  ) : null}
                  {t(($) => $.library.import.importAction)}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t(($) => $.library.import.arxivHint)}
              </p>
            </div>
      );
    }
    if (view === "sources") {
      return (
            <div className="space-y-5">
              <section className="space-y-2">
                <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.library.import.localHeading)}
                </h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  {IMPORT_FILE_SOURCES.map((source) => (
                    <ChoiceCard
                      key={source.kind}
                      image={SOURCE_ART[source.kind]}
                      title={sourceCopy[source.kind].title}
                      description={sourceCopy[source.kind].description}
                      testId={`project-import-${source.kind}`}
                      compact
                      disabled={busy}
                      busy={busy && busyKind === source.kind}
                      onClick={() => void importFile(source.kind)}
                    />
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.library.import.cloudHeading)}
                </h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <ChoiceCard
                    image={CHOICE_ART.importArxiv}
                    title={t(($) => $.library.import.arxivPaper)}
                    description={t(($) => $.library.import.arxivCardDescription)}
                    testId="project-import-arxiv"
                    compact
                    disabled={busy}
                    onClick={() => setView("arxiv")}
                  />
                  <ChoiceCard
                    image={CHOICE_ART.importGithub}
                    title={t(($) => $.library.import.git)}
                    description={
                      gitAccounts > 0
                        ? t(($) => $.library.import.gitConnected)
                        : t(($) => $.library.import.gitDisconnected)
                    }
                    testId="project-import-git"
                    compact
                    disabled={busy}
                    onClick={() => setView("git")}
                  />
                  <ChoiceCard
                    image={CHOICE_ART.importOverleaf}
                    title={"Overleaf"}
                    description={t(($) => $.library.import.overleaf.cardDescription)}
                    testId="project-import-overleaf"
                    compact
                    disabled={busy}
                    onClick={() => setView("overleaf")}
                  />
                </div>
              </section>

              <div className="flex items-start gap-2.5">
                <Checkbox
                  id={alsoTemplateId}
                  data-testid="project-import-also-template"
                  checked={alsoTemplate}
                  disabled={busy}
                  onCheckedChange={(checked) => setAlsoTemplate(checked === true)}
                  className="mt-0.5"
                />
                <label htmlFor={alsoTemplateId} className="min-w-0 cursor-pointer">
                  <span className="block text-sm font-medium text-foreground">
                    {t(($) => $.library.customTemplates.alsoSaveAsTemplate)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(($) => $.library.customTemplates.alsoSaveHint)}
                  </span>
                </label>
              </div>
            </div>
      );
    }
    return (
            <Suspense
              fallback={
                <output className="flex flex-1 items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Spinner />
                </output>
              }
            >
              <GitImportView
                busy={busy}
                onImport={(account, repository) => void importRepository(account, repository)}
                onClone={(url) => void cloneByAddress(url)}
                onOpenSettings={openGitHostingSettings}
              />
            </Suspense>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        if (!busyRef.current) {
          onClose();
        } else if (cancellableRef.current) {
          cancelImport();
          onClose();
        }
      }}
    >
      <DialogContent
        data-testid="project-import-dialog"
        className={cn(
          "flex max-h-[calc(100dvh-2rem)] flex-col gap-4 overflow-hidden",
          VIEW_WIDTH[view],
        )}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {view !== "sources" ? (
              <button
                type="button"
                aria-label={t(($) => $.library.import.back)}
                data-testid="project-import-back"
                disabled={busy}
                onClick={() => { setView("sources"); setErrorMessage(null); setPendingPath(null); }}
                className="rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
              </button>
            ) : null}
            {viewTitles[view]}
          </DialogTitle>
          <DialogDescription>
            {viewDescriptions[view]}
          </DialogDescription>
        </DialogHeader>

        {errorMessage && <p role="alert" className="shrink-0 select-text rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{errorMessage}</p>}
        {busy && (
          <div className="flex shrink-0 items-center justify-between gap-2">
            <output className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />{t(($) => $.library.import.importing)}</output>
            {cancellable ? (
              <Button type="button" size="sm" variant="ghost" data-testid="project-import-cancel" onClick={cancelImport}>
                {t(($) => $.common.actions.cancel)}
              </Button>
            ) : null}
          </div>
        )}
        <div
          className={cn(
            "-mx-6 -mb-6 min-h-0 px-6 pb-6",
            view === "overleaf" ? "flex flex-1 flex-col overflow-hidden" : "overflow-y-auto",
          )}
        >
          {renderBody()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
