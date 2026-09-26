import { useTranslation } from "react-i18next";
import { ChevronDown, FileText, Files } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { FileIcon } from "@/components/files/fileIcon";
import {
  compactDocumentPath,
  documentKindLabel,
  isLinkedHome,
  mainDocumentMissing,
  otherDocuments,
} from "@/lib/main-document";
import { toast } from "@/lib/toast";
import { logError } from "@/lib/log";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { chooseMainDocument, useMainDocumentStore } from "@/store/main-document";

const LINK_BUTTON =
  "shrink-0 rounded border border-transparent px-1 py-0.5 font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground focus-visible:border-border focus-visible:bg-accent";

export function MainDocumentIndicator({ iconOnly = false }: Readonly<{ iconOnly?: boolean }>) {
  const { t } = useTranslation(["shell"]);
  const projectId = useFilesStore((state) => state.projectId);
  const manifestHome = useFilesStore((state) => state.manifestHome);
  const mainDoc = useFilesStore((state) => state.mainDoc);
  const missing = useFilesStore(mainDocumentMissing);
  const detection = useMainDocumentStore((state) =>
    state.projectId === projectId ? state.detection : null,
  );
  const openChange = useMainDocumentStore((state) => state.openChange);
  if (!projectId || !isLinkedHome(manifestHome) || missing) return null;
  const others = otherDocuments(detection, mainDoc);
  const label = t(($) => $.shell.openedFolder.main.label, { path: compactDocumentPath(mainDoc) });

  const switchTo = (path: string) => {
    void chooseMainDocument(path).catch((error: unknown) => {
      void logError("switch the main document", error);
      toast.error(t(($) => $.shell.openedFolder.main.switchFailed, { path }));
    });
  };

  return (
    <div
      data-testid="main-document-indicator"
      className="flex min-w-0 shrink items-center gap-0.5 text-xs text-muted-foreground"
    >
      {others.length > 0 ? (
        <DropdownMenu>
          <Tooltip label={t(($) => $.shell.openedFolder.main.others)}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t(($) => $.shell.openedFolder.main.others)}
                data-testid="other-documents-trigger"
                className={cn(
                  LINK_BUTTON,
                  "flex h-6 items-center gap-0.5 px-1 animate-in fade-in duration-200 motion-reduce:animate-none",
                )}
              >
                <Files aria-hidden className="size-3.5" />
                <ChevronDown aria-hidden className="size-3" />
              </button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>{t(($) => $.shell.openedFolder.main.others)}</DropdownMenuLabel>
            {others.map((candidate) => (
              <DropdownMenuItem key={candidate.path} onSelect={() => switchTo(candidate.path)}>
                <FileIcon name={candidate.path} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{candidate.path}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {documentKindLabel(candidate.kind)}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {iconOnly ? (
        <Tooltip label={t(($) => $.shell.openedFolder.main.label, { path: mainDoc })}>
          <button
            type="button"
            aria-label={t(($) => $.shell.openedFolder.main.changeLabel)}
            onClick={openChange}
            className={cn(LINK_BUTTON, "flex h-6 items-center px-1.5")}
          >
            <FileText aria-hidden className="size-3.5" />
          </button>
        </Tooltip>
      ) : (
        <>
          <Tooltip label={mainDoc}>
            <span data-testid="main-document-label" className="min-w-0 max-w-56 truncate">
              {label}
            </span>
          </Tooltip>
          <span aria-hidden className="px-0.5 text-muted-foreground/60">
            ·
          </span>
          <button
            type="button"
            aria-label={t(($) => $.shell.openedFolder.main.changeLabel)}
            onClick={openChange}
            className={LINK_BUTTON}
          >
            {t(($) => $.shell.openedFolder.main.change)}
          </button>
        </>
      )}
    </div>
  );
}
