import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  Link2,
  Loader2,
  Lock,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { FileIcon } from "@/components/files/fileIcon";
import { readResearchRootFile, type ResearchRootFileContent } from "@/lib/research-workspace";
import { useFilesStore } from "@/store/files";
import { cn } from "@/lib/utils";
import { linkedNodeKey, useLinkedRootsStore } from "./linked-roots-store";

interface OpenPreview {
  rootId: string;
  rootLabel: string;
  rootPath: string;
  relativePath: string;
  content: ResearchRootFileContent | null;
  error: string | null;
}

function joinPath(root: string, relative: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${relative.replace(/\//g, separator)}`;
}

export function LinkedFoldersSection() {
  const { t } = useTranslation(["common", "researchTools"]);
  const projectId = useFilesStore((state) => state.projectId);
  const roots = useLinkedRootsStore((state) => state.roots);
  const health = useLinkedRootsStore((state) => state.health);
  const listings = useLinkedRootsStore((state) => state.listings);
  const loading = useLinkedRootsStore((state) => state.loading);
  const errors = useLinkedRootsStore((state) => state.errors);
  const expanded = useLinkedRootsStore((state) => state.expanded);
  const bindProject = useLinkedRootsStore((state) => state.bindProject);
  const refresh = useLinkedRootsStore((state) => state.refresh);
  const toggle = useLinkedRootsStore((state) => state.toggle);
  const [preview, setPreview] = useState<OpenPreview | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void bindProject(projectId);
  }, [bindProject, projectId]);

  if (!projectId || roots.length === 0) return null;

  const openFile = async (
    root: { id: string; label: string; canonicalPath: string },
    relativePath: string,
  ) => {
    setCopied(false);
    setPreview({
      rootId: root.id,
      rootLabel: root.label,
      rootPath: root.canonicalPath,
      relativePath,
      content: null,
      error: null,
    });
    try {
      const content = await readResearchRootFile(projectId, root.id, relativePath);
      setPreview((current) =>
        current && current.rootId === root.id && current.relativePath === relativePath
          ? { ...current, content }
          : current,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setPreview((current) =>
        current && current.rootId === root.id && current.relativePath === relativePath
          ? { ...current, error: message }
          : current,
      );
    }
  };

  const renderChildren = (
    root: { id: string; label: string; canonicalPath: string },
    relativePath: string,
    depth: number,
  ) => {
    const key = linkedNodeKey(root.id, relativePath);
    const entries = listings[key];
    if (loading[key]) {
      return (
        <p
          role="status"
          className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground"
          style={{ paddingLeft: `${depth * 12 + 26}px` }}
        >
          <Loader2 className="size-3 animate-spin" /> {t(($) => $.common.state.loading)}
        </p>
      );
    }
    if (errors[key]) {
      return (
        <p
          role="alert"
          className="py-1 text-[11px] text-destructive"
          style={{ paddingLeft: `${depth * 12 + 26}px` }}
        >
          {errors[key]}
        </p>
      );
    }
    if (!entries) return null;
    if (entries.length === 0) {
      return (
        <p
          className="py-1 text-[11px] text-muted-foreground"
          style={{ paddingLeft: `${depth * 12 + 26}px` }}
        >
          {t(($) => $.researchTools.linked.emptyFolder)}
        </p>
      );
    }
    return entries.map((entry) => {
      const entryKey = linkedNodeKey(root.id, entry.relativePath);
      const open = expanded.includes(entryKey);
      if (entry.isSymlink) {
        return (
          <div
            key={entryKey}
            className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground"
            style={{ paddingLeft: `${depth * 12 + 26}px` }}
          >
            <Lock aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{entry.name}</span>
            <span className="ml-auto shrink-0 text-[11px]">
              {t(($) => $.researchTools.linked.blockedLink)}
            </span>
          </div>
        );
      }
      return (
        <div key={entryKey}>
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs text-sidebar-foreground hover:bg-sidebar-accent"
            style={{ paddingLeft: `${depth * 12 + 14}px` }}
            onClick={() =>
              entry.isDirectory
                ? toggle(root.id, entry.relativePath)
                : void openFile(root, entry.relativePath)
            }
          >
            {entry.isDirectory ? (
              <>
                <ChevronRight
                  aria-hidden="true"
                  className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
                />
                {open ? (
                  <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Folder aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                )}
              </>
            ) : (
              <>
                <span className="w-3.5 shrink-0" />
                <FileIcon name={entry.name} className="size-4 shrink-0" />
              </>
            )}
            <span className="truncate">{entry.name}</span>
          </button>
          {entry.isDirectory && open ? renderChildren(root, entry.relativePath, depth + 1) : null}
        </div>
      );
    });
  };

  return (
    <section
      aria-label={t(($) => $.researchTools.linked.title)}
      data-testid="linked-folders-section"
      className="shrink-0 border-t border-sidebar-border"
    >
      <div className="flex h-8 items-center gap-1.5 px-3">
        <Link2 aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <span className="flex-1 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70">
          {t(($) => $.researchTools.linked.title)}
        </span>
        <Tooltip label={t(($) => $.researchTools.linked.readOnlyTooltip)}>
          <Badge variant="quiet" className="gap-1 text-[10px]">
            <Lock aria-hidden="true" className="size-2.5" />
            {t(($) => $.researchTools.linked.readOnly)}
          </Badge>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t(($) => $.researchTools.linked.refresh)}
          onClick={() => void refresh()}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      <div className="max-h-56 overflow-auto p-1.5 pt-0">
        {roots.map((root) => {
          const key = linkedNodeKey(root.id, "");
          const open = expanded.includes(key);
          const availability = health[root.id]?.availability ?? "available";
          return (
            <div key={root.id}>
              <button
                type="button"
                data-linked-root={root.id}
                aria-expanded={open}
                className="flex w-full items-center gap-1.5 rounded-md py-1 pl-2 pr-2 text-left text-xs text-sidebar-foreground hover:bg-sidebar-accent"
                onClick={() => toggle(root.id, "")}
              >
                <ChevronRight
                  aria-hidden="true"
                  className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
                />
                {open ? (
                  <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Folder aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{root.label}</span>
                {availability !== "available" ? (
                  <span className="ml-auto shrink-0 text-[10px] text-destructive">
                    {availability === "missing"
                      ? t(($) => $.researchTools.linked.missing)
                      : t(($) => $.researchTools.linked.unreadable)}
                  </span>
                ) : null}
              </button>
              {open ? renderChildren(root, "", 1) : null}
            </div>
          );
        })}
      </div>

      <Dialog open={preview !== null} onOpenChange={(next) => { if (!next) setPreview(null); }}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.relativePath ?? ""}</DialogTitle>
            <DialogDescription>
              {t(($) => $.researchTools.linked.previewDescription, {
                label: preview?.rootLabel ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-auto rounded-md border bg-muted/20 p-3">
            {preview?.error ? (
              <p role="alert" className="text-sm text-destructive">
                {preview.error}
              </p>
            ) : !preview?.content ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> {t(($) => $.common.state.loading)}
              </p>
            ) : preview.content.isBinary ? (
              <p className="text-sm text-muted-foreground">
                {t(($) => $.researchTools.linked.binary)}
              </p>
            ) : (
              <>
                <pre className="whitespace-pre-wrap break-words text-xs">{preview.content.content}</pre>
                {preview.content.truncated ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t(($) => $.researchTools.linked.previewTruncated)}
                  </p>
                ) : null}
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (!preview) return;
                void navigator.clipboard
                  ?.writeText(joinPath(preview.rootPath, preview.relativePath))
                  .then(() => setCopied(true))
                  .catch(() => {});
              }}
            >
              {copied
                ? t(($) => $.researchTools.linked.pathCopied)
                : t(($) => $.researchTools.linked.copyPath)}
            </Button>
            <Button onClick={() => setPreview(null)}>{t(($) => $.common.actions.close)}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
