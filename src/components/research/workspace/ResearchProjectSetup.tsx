import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, FolderOpen, FolderTree, Star } from "lucide-react";
import { FileIcon } from "@/components/files/fileIcon";
import { HighlightedCode } from "@/components/ui/code-highlighter";
import { Button } from "@/components/ui/button";
import { SIDEBAR_TITLE_CLASS } from "@/components/layout/SidebarSection";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { i18n } from "@/i18n";
import {
  createResearchProject,
  finishResearchProjectSetup,
  previewResearchProject,
  type ResearchDocumentEngine,
  type ResearchProjectPreview,
  type ResearchProjectRequest,
  ResearchProjectSetupStageError,
  type ResearchStarter,
} from "@/lib/research-workspace";
import { Spinner } from "@/components/ui/spinner";
import { CodeBlock } from "@/components/ui/code-block";

const ENGINES: { value: ResearchDocumentEngine; label: string }[] = [
  { value: "latex", label: "LaTeX" },
  { value: "typst", label: "Typst" },
  { value: "markdown", label: "Markdown" },
  { value: "quarto", label: "Quarto" },
  { value: "calepin", label: "Calepin" },
];

const STARTERS: {
  value: ResearchStarter;
  label: () => string;
  description: () => string;
}[] = [
  {
    value: "article",
    label: () => i18n.t(($) => $.researchTools.setup.starter.article.label),
    description: () => i18n.t(($) => $.researchTools.setup.starter.article.description),
  },
  {
    value: "literature_review",
    label: () => i18n.t(($) => $.researchTools.setup.starter.literatureReview.label),
    description: () => i18n.t(($) => $.researchTools.setup.starter.literatureReview.description),
  },
  {
    value: "thesis",
    label: () => i18n.t(($) => $.researchTools.setup.starter.thesis.label),
    description: () => i18n.t(($) => $.researchTools.setup.starter.thesis.description),
  },
  {
    value: "reproducible_analysis",
    label: () => i18n.t(($) => $.researchTools.setup.starter.reproducibleAnalysis.label),
    description: () =>
      i18n.t(($) => $.researchTools.setup.starter.reproducibleAnalysis.description),
  },
];

const TASK_TITLES: Record<ResearchStarter, () => string> = {
  article: () => i18n.t(($) => $.researchTools.setup.starter.article.task),
  literature_review: () => i18n.t(($) => $.researchTools.setup.starter.literatureReview.task),
  thesis: () => i18n.t(($) => $.researchTools.setup.starter.thesis.task),
  reproducible_analysis: () =>
    i18n.t(($) => $.researchTools.setup.starter.reproducibleAnalysis.task),
};

const PREVIEW_TREE_SKELETON = [82, 58, 71, 46, 64, 52];
const PREVIEW_TEXT_SKELETON = [92, 68, 79, 44, 86, 61, 74];

function previewLanguage(path: string): string | undefined {
  const extension = path.split(".").pop()?.toLowerCase();
  if (!extension || extension === path.toLowerCase()) return undefined;
  return extension;
}

function causeDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function previewPanel({
  preview,
  previewing,
  selectedPreviewPath,
  previewTree,
  previewPane,
}: Readonly<{
  preview: ResearchProjectPreview | null;
  previewing: boolean;
  selectedPreviewPath: string | null;
  previewTree: () => React.ReactNode;
  previewPane: () => React.ReactNode;
}>) {
  return (
    <div className="flex h-[32rem] flex-col overflow-hidden rounded-lg border bg-background">
      <div className="flex h-9 items-center justify-between border-b bg-sidebar px-3">
        <div className="flex items-center gap-1.5">
          <FolderTree aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span className={SIDEBAR_TITLE_CLASS}>
            {i18n.t(($) => $.researchTools.setup.previewTitle)}
          </span>
        </div>
        <span className="text-[0.6875rem] text-muted-foreground">
          {preview
            ? i18n.t(($) => $.researchTools.setup.mainDocument, { path: preview.mainDocument })
            : "\u00a0"}
        </span>
      </div>
      <div
        aria-busy={previewing}
        className="grid min-h-0 flex-1 overflow-hidden md:grid-cols-[minmax(12rem,0.42fr)_minmax(0,1fr)]"
      >
        <div className="overflow-auto border-r bg-sidebar p-1.5">
          {previewing && !preview ? (
            <ul className="space-y-1 p-1" aria-hidden="true">
              {PREVIEW_TREE_SKELETON.map((width) => (
                <li
                  key={width}
                  className="h-5 animate-pulse rounded bg-muted"
                  style={{ width: `${width}%` }}
                />
              ))}
            </ul>
          ) : previewTree()}
        </div>
        <div className="flex min-w-0 flex-col overflow-hidden">
          {preview && selectedPreviewPath ? (
            <div className="flex h-9 shrink-0 items-center gap-1.5 border-b bg-card px-3">
              <FileIcon
                name={selectedPreviewPath.split("/").pop() ?? selectedPreviewPath}
                className="size-4 shrink-0"
              />
              <span className="truncate text-xs text-foreground">
                {selectedPreviewPath.split("/").pop()}
              </span>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto">
            {previewing && !preview ? (
              <div className="space-y-2 px-4 py-3" aria-hidden="true">
                {PREVIEW_TEXT_SKELETON.map((width) => (
                  <div
                    key={width}
                    className="h-3 animate-pulse rounded bg-muted"
                    style={{ width: `${width}%` }}
                  />
                ))}
              </div>
            ) : previewPane()}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ResearchProjectSetup({
  open,
  onClose,
  onFinished,
  onCreated,
  ensureInitialTask,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  onFinished?: () => void;
  onCreated: (projectId: string) => void | Promise<void>;
  ensureInitialTask: (task: {
    projectId: string;
    title: string;
    prompt: string;
    starter: ResearchStarter;
  }) => void | Promise<void>;
}>) {
  const { t } = useTranslation(["common", "researchTools"]);
  const [name, setName] = useState("");
  const [engine, setEngine] = useState<ResearchDocumentEngine>("latex");
  const [starter, setStarter] = useState<ResearchStarter>("article");
  const [previewResult, setPreviewResult] = useState<{ requestKey: string; value: ResearchProjectPreview } | null>(null);
  const [previewFailure, setPreviewFailure] = useState<{ requestKey: string; message: string } | null>(null);
  const [selectedPreviewPath, setSelectedPreviewPath] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [initialTaskReady, setInitialTaskReady] = useState(false);
  const sampleName = t(($) => $.researchTools.setup.namePlaceholder);
  const named = name.trim() !== "";
  const request = useMemo<ResearchProjectRequest>(
    () => ({ name: named ? name : sampleName, engine, starter }),
    [engine, name, named, sampleName, starter],
  );
  const requestKey = JSON.stringify(request);
  const preview = previewResult?.value ?? null;
  const previewFailed = previewFailure?.requestKey === requestKey;
  const previewing = previewResult?.requestKey !== requestKey && !previewFailed;

  useEffect(() => {
    if (!open) return;
    setName("");
    setEngine("latex");
    setStarter("article");
    setPreviewResult(null);
    setPreviewFailure(null);
    setSelectedPreviewPath(null);
    setError(null);
    setCreatedProjectId(null);
    setInitialTaskReady(false);
  }, [open]);

  const showPreview = useCallback((key: string, result: ResearchProjectPreview) => {
    setPreviewResult({ requestKey: key, value: result });
    setPreviewFailure(null);
    setSelectedPreviewPath((selected) =>
      selected !== null && result.files.some((file) => file.path === selected && file.kind !== "directory")
        ? selected
        : result.mainDocument,
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    let current = true;
    const key = JSON.stringify(request);
    void previewResearchProject(request)
      .then((result) => {
        if (current) showPreview(key, result);
      })
      .catch((cause) => {
        if (current) setPreviewFailure({ requestKey: key, message: causeDetail(cause) });
      });
    return () => {
      current = false;
    };
  }, [open, request, showPreview]);

  const reportSetupFailure = async (cause: unknown) => {
    const detail = causeDetail(cause);
    if (cause instanceof ResearchProjectSetupStageError && cause.stage === "task") {
      if (cause.projectId) {
        try {
          await onCreated(cause.projectId);
        } catch (error_) {
          setError(
            t(($) => $.researchTools.setup.errorProjectOnly, {
              detail,
              openDetail: causeDetail(error_),
            }),
          );
          return;
        }
      }
      setError(t(($) => $.researchTools.setup.errorTask, { detail }));
      return;
    }
    if (cause instanceof ResearchProjectSetupStageError && cause.stage === "open") {
      setError(t(($) => $.researchTools.setup.errorOpen, { detail }));
      return;
    }
    setError(detail);
  };

  const canCreate = named && preview !== null && !previewFailed && !creating;
  const alert = error ?? (previewFailed ? (previewFailure?.message ?? null) : null);

  const create = async () => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      const exact =
        previewResult?.requestKey === requestKey ? previewResult.value : await previewResearchProject(request);
      showPreview(requestKey, exact);
      await finishResearchProjectSetup({
        request,
        task: {
          title: TASK_TITLES[starter](),
          prompt: exact.initialTask,
          starter,
        },
        progress: { projectId: createdProjectId, initialTaskReady },
        createProject: createResearchProject,
        ensureInitialTask,
        onCreated,
        onProgress: (progress) => {
          setCreatedProjectId(progress.projectId);
          setInitialTaskReady(progress.initialTaskReady);
        },
      });
      (onFinished ?? onClose)();
    } catch (cause) {
      await reportSetupFailure(cause);
    } finally {
      setCreating(false);
    }
  };

  const previewPane = () => {
    if (!preview || !selectedPreviewPath) return null;
    const source = preview.files.find((file) => file.path === selectedPreviewPath)?.content ?? "";
    return (
      <CodeBlock
        code={source}
        preClassName="overflow-visible whitespace-pre-wrap break-words rounded-none border-0 bg-transparent px-4 py-3 pr-10 font-sans text-xs"
      >
        <HighlightedCode language={previewLanguage(selectedPreviewPath)} source={source} />
      </CodeBlock>
    );
  };

  const previewTree = () =>
    !preview ? null : (
      <ul
        aria-label={t(($) => $.researchTools.setup.previewFiles)}
        className="space-y-px"
      >
        {preview.files.map((file) => {
          const depth = file.path.split("/").length - 1;
          const name = file.path.split("/").pop() ?? file.path;
          const isMain = file.path === preview.mainDocument;
          const selected = selectedPreviewPath === file.path;
          const indent = { paddingLeft: `${depth * 12 + 8}px` };
          if (file.kind === "directory") {
            return (
              <li key={file.path}>
                <div
                  className="flex items-center gap-1.5 rounded-md py-1.5 pr-2 text-sm text-sidebar-foreground"
                  style={indent}
                >
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 shrink-0 rotate-90 text-muted-foreground"
                  />
                  <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{name}</span>
                </div>
              </li>
            );
          }
          return (
            <li key={file.path}>
              <button
                type="button"
                aria-pressed={selected}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent focus-visible:bg-sidebar-accent",
                  selected && "bg-sidebar-accent",
                )}
                style={indent}
                onClick={() => setSelectedPreviewPath(file.path)}
              >
                <span className="flex w-3.5 shrink-0 items-center justify-center">
                  {isMain ? (
                    <Star
                      aria-hidden="true"
                      className="size-3 shrink-0 fill-foreground text-foreground"
                    />
                  ) : null}
                </span>
                <FileIcon name={name} className="size-4 shrink-0" />
                <span className="truncate">{name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );

  const selectedStarter = STARTERS.find((item) => item.value === starter);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !creating && onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col overflow-hidden" closeDisabled={creating}>
        <DialogHeader>
          <DialogTitle>{t(($) => $.researchTools.setup.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.researchTools.setup.description)}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-5 overflow-auto md:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="grid gap-1.5 text-sm font-medium">
              <label htmlFor="research-project-name">
                {t(($) => $.researchTools.setup.nameLabel)}
              </label>
              <Input
                id="research-project-name"
                autoFocus
                disabled={creating || Boolean(createdProjectId)}
                value={name}
                maxLength={120}
                placeholder={t(($) => $.researchTools.setup.namePlaceholder)}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5 text-sm font-medium">
              <label htmlFor="research-project-engine">
                {t(($) => $.researchTools.setup.engineLabel)}
              </label>
              <Select value={engine} disabled={creating || Boolean(createdProjectId)} onValueChange={(value) => setEngine(value as ResearchDocumentEngine)}>
                <SelectTrigger id="research-project-engine"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENGINES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 text-sm font-medium">
              <label htmlFor="research-project-starter">
                {t(($) => $.researchTools.setup.starterLabel)}
              </label>
              <Select value={starter} disabled={creating || Boolean(createdProjectId)} onValueChange={(value) => setStarter(value as ResearchStarter)}>
                <SelectTrigger id="research-project-starter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STARTERS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">
              {selectedStarter?.description()}
            </p>
            <div className="flex min-h-[4.75rem] items-start gap-3 rounded-md border bg-muted/30 p-3">
              <img
                src="/project-kind/first-research-task.webp"
                alt=""
                aria-hidden="true"
                draggable={false}
                loading="lazy"
                decoding="async"
                className="pointer-events-none size-9 shrink-0 select-none object-contain"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{t(($) => $.researchTools.setup.firstTask)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {preview ? preview.initialTask : t(($) => $.researchTools.setup.firstTaskWorking)}
                </p>
              </div>
            </div>
          </div>
          {previewPanel({ preview, previewing, selectedPreviewPath, previewTree, previewPane })}
        </div>
        {alert && <p className="select-text text-sm text-destructive" role="alert">{alert}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={creating} onClick={onClose}>
            {t(($) => $.common.actions.cancel)}
          </Button>
          <Button disabled={!canCreate} onClick={create}>
            {creating && <Spinner />}{" "}
            {createdProjectId
              ? t(($) => $.researchTools.setup.retry)
              : t(($) => $.researchTools.setup.create)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
