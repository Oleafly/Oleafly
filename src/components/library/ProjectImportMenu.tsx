import { lazy, Suspense, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { pickOpenPath } from "@/lib/native-file-dialog";
import {
  IMPORT_FILE_SOURCES,
  importForgeRepository,
  importPickerOptions,
  importSelectedFile,
  importTargetsForKind,
  type ProjectImportFileKind,
} from "@/features/project-import";
import type { ForgeAccount, ForgeRepo } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { notifyError } from "@/lib/toast";
import { ProjectImportDialog } from "./ProjectImportDialog";
import { OpenLinkDialogSlot, useCollabLibraryKit } from "@/components/collab/CollabSlots";
import { Spinner } from "@/components/ui/spinner";

const GitRepoMenuItems = lazy(() =>
  import("./GitRepoMenuItems").then((module) => ({ default: module.GitRepoMenuItems })),
);

export function ProjectImportMenu({
  align = "end",
  onImportSelected,
  trigger,
  triggerTooltip,
}: Readonly<{
  align?: "start" | "center" | "end";
  onImportSelected?: () => void;
  trigger: (busy: boolean) => ReactElement;
  triggerTooltip?: ReactNode;
}>) {
  const { t } = useTranslation(["library"]);
  const sourceLabels: Record<ProjectImportFileKind, string> = {
    project: t(($) => $.library.import.sources.project.title),
    word: t(($) => $.library.import.sources.word.title),
    markdown: t(($) => $.library.import.sources.markdown.title),
    html: t(($) => $.library.import.sources.html.title),
    typst: t(($) => $.library.import.sources.typst.title),
  };
  const [open, setOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [arxivOpen, setArxivOpen] = useState(false);
  const [sharedLinkOpen, setSharedLinkOpen] = useState(false);
  const collab = useCollabLibraryKit();
  const [overleafOpen, setOverleafOpen] = useState(false);
  const [gitDialogOpen, setGitDialogOpen] = useState(false);

  const importFile = async (
    kind: ProjectImportFileKind,
    target?: "latex" | "markdown" | "typst",
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const selection = await pickOpenPath(importPickerOptions(kind));
      if (typeof selection !== "string") return;
      if (await importSelectedFile(selection, target)) onImportSelected?.();
    } catch (error) {
      notifyError("import", error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const importRepository = async (account: ForgeAccount, repository: ForgeRepo) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await importForgeRepository(account.base, repository);
      onImportSelected?.();
    } catch (error) {
      notifyError("import Git repository", error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const openGitHostingSettings = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("integrations");
    settings.setSettingsScrollTarget("git-hosting");
    settings.setSettingsOpen(true);
    onImportSelected?.();
  };

  return (
    <>
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen && busyRef.current) return;
        setOpen(nextOpen);
        if (!nextOpen) setGitOpen(false);
      }}
    >
      {triggerTooltip ? (
        <Tooltip label={triggerTooltip}>
          <DropdownMenuTrigger asChild>{trigger(busy)}</DropdownMenuTrigger>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>{trigger(busy)}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent align={align} className="min-w-56">
        <DropdownMenuLabel>{t(($) => $.library.import.menu.local)}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void importFile("project")}>
          {t(($) => $.library.import.menu.project)}
        </DropdownMenuItem>
        {IMPORT_FILE_SOURCES.filter((source) => source.kind !== "project").map(({ kind }) => {
          const targets = importTargetsForKind(kind);
          return (
            <DropdownMenuSub key={kind}>
              <DropdownMenuSubTrigger data-testid={`import-kind-${kind}`}>
                {sourceLabels[kind]}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {targets.map((target) => (
                  <DropdownMenuItem
                    key={target.target}
                    data-testid={`import-target-${kind}-${target.target}`}
                    onSelect={() => void importFile(kind, target.target)}
                  >
                    {target.recommended
                      ? t(($) => $.library.import.targetRecommended, { label: target.label })
                      : target.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
        <DropdownMenuLabel>{t(($) => $.library.import.menu.cloud)}</DropdownMenuLabel>
        <DropdownMenuItem data-testid="import-arxiv" onSelect={() => setArxivOpen(true)}>{t(($) => $.library.import.arxivPaper)}</DropdownMenuItem>
        <DropdownMenuItem data-testid="import-overleaf" onSelect={() => setOverleafOpen(true)}>{"Overleaf"}</DropdownMenuItem>
        {collab ? (
          <DropdownMenuItem data-testid="import-shared-link" onSelect={() => setSharedLinkOpen(true)}>
            {collab.openLink}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSub open={gitOpen} onOpenChange={setGitOpen}>
          <DropdownMenuSubTrigger data-testid="import-git">
            {t(($) => $.library.import.menu.git)}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 min-w-64 overflow-y-auto">
            {gitOpen ? (
              <Suspense
                fallback={
                  <DropdownMenuItem disabled>
                    <Spinner size="sm" />
                  </DropdownMenuItem>
                }
              >
                <GitRepoMenuItems
                  onImport={(account, repository) => void importRepository(account, repository)}
                  onMore={() => setGitDialogOpen(true)}
                  onClone={() => setGitDialogOpen(true)}
                  onOpenSettings={openGitHostingSettings}
                />
              </Suspense>
            ) : null}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
    <ProjectImportDialog open={arxivOpen} initialView="arxiv" onClose={() => setArxivOpen(false)} onImported={onImportSelected} />
    <ProjectImportDialog open={overleafOpen} initialView="overleaf" onClose={() => setOverleafOpen(false)} onImported={onImportSelected} />
    <ProjectImportDialog open={gitDialogOpen} initialView="git" onClose={() => setGitDialogOpen(false)} onImported={onImportSelected} />
    <OpenLinkDialogSlot open={sharedLinkOpen} onClose={() => setSharedLinkOpen(false)} />
    </>
  );
}
