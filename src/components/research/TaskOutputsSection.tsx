import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, FlaskConical, Paperclip } from "lucide-react";
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
import { statusDotClass } from "@/components/research/tasks/task-status";
import {
  previewResearchTaskArtifact,
  previewResearchTaskFile,
  type ResearchTask,
  type TaskArtifact,
  type TaskFileChange,
} from "@/lib/research-tasks";
import {
  mountResearchTaskSubscriptions,
  useResearchTasksStore,
} from "@/store/research-tasks";
import { useFilesStore } from "@/store/files";
import { readSidebarView } from "@/store/sidebar-view-state";
import { useSidebarViewMemory } from "@/hooks/use-sidebar-view-memory";
import { SIDEBAR_TITLE_CLASS } from "@/components/layout/SidebarSection";
import { useTauriSubscription } from "@/hooks/use-tauri-event";
import { cn } from "@/lib/utils";
import { i18n } from "@/i18n";
import { LoadingState } from "@/components/ui/empty";

const CHANGE_MARKS: Record<TaskFileChange["kind"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
};

interface OpenPreview {
  taskId: string;
  taskTitle: string;
  label: string;
  path: string;
  loading: boolean;
  text: string | null;
  note: string | null;
  truncated: boolean;
  error: string | null;
}

function fileNote(exists: boolean, binary: boolean): string | null {
  if (!exists) return i18n.t(($) => $.researchTools.outputs.deleted);
  if (binary) return i18n.t(($) => $.researchTools.outputs.binaryFile);
  return null;
}

function hasOutputs(task: ResearchTask): boolean {
  const result = task.result;
  if (!result) return false;
  return result.changedFiles.length > 0 || result.artifacts.length > 0;
}

function awaitsAttention(task: ResearchTask): boolean {
  if (task.review) return false;
  return task.status === "running" || task.status === "awaiting_review" || task.status === "failed";
}

export function TaskOutputsSection() {
  const { t } = useTranslation(["common", "researchTools"]);
  const projectId = useFilesStore((state) => state.projectId);
  const tasks = useResearchTasksStore((state) => state.tasks);
  const openTaskDetail = useResearchTasksStore((state) => state.openTaskDetail);
  const [open, setOpen] = useState(
    () => readSidebarView(projectId, "taskOutputs")?.open ?? true,
  );
  useSidebarViewMemory(projectId, "taskOutputs", { open });
  const previousProjectId = useRef(projectId);
  useEffect(() => {
    if (previousProjectId.current === projectId) return;
    previousProjectId.current = projectId;
    setOpen(readSidebarView(projectId, "taskOutputs")?.open ?? true);
  }, [projectId]);
  const [preview, setPreview] = useState<OpenPreview | null>(null);
  const previewRequest = useRef(0);

  useEffect(() => {
    if (!projectId) return;
    const state = useResearchTasksStore.getState();
    if (state.projectId !== projectId) void state.bindProject(projectId);
  }, [projectId]);

  useTauriSubscription(
    projectId ? mountResearchTaskSubscriptions : null,
    "listen for research tasks",
  );

  const groups = useMemo(
    () =>
      tasks.filter(
        (task) => task.projectId === projectId && hasOutputs(task) && awaitsAttention(task),
      ),
    [projectId, tasks],
  );

  if (!projectId || groups.length === 0) return null;

  const start = (task: ResearchTask, label: string, path: string) => {
    const request = ++previewRequest.current;
    setPreview({
      taskId: task.id,
      taskTitle: task.title,
      label,
      path,
      loading: true,
      text: null,
      note: null,
      truncated: false,
      error: null,
    });
    return request;
  };

  const settle = (request: number, values: Partial<OpenPreview>) => {
    if (previewRequest.current !== request) return;
    setPreview((current) => (current ? { ...current, loading: false, ...values } : current));
  };

  const failure = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

  const openFile = async (task: ResearchTask, change: TaskFileChange) => {
    const request = start(task, change.path, change.path);
    try {
      const result = await previewResearchTaskFile(task.id, change.path);
      settle(request, {
        text: result.after.text,
        truncated: result.after.truncated,
        note: fileNote(result.after.exists, result.after.binary),
      });
    } catch (cause) {
      settle(request, { error: failure(cause) });
    }
  };

  const openArtifact = async (task: ResearchTask, artifact: TaskArtifact) => {
    const request = start(task, artifact.label, artifact.path);
    try {
      const result = await previewResearchTaskArtifact(task.id, artifact.path);
      settle(request, {
        text: result.content.text,
        truncated: result.content.truncated,
        note:
          result.content.text === null
            ? i18n.t(($) => $.researchTools.outputs.binaryArtifact)
            : null,
      });
    } catch (cause) {
      settle(request, { error: failure(cause) });
    }
  };

  const previewBody = () => {
    if (preview?.loading) {
      return (
        <LoadingState label={t(($) => $.common.state.loading)} />
      );
    }
    if (preview?.note) return <p className="text-sm text-muted-foreground">{preview.note}</p>;
    return (
      <>
        <pre className="whitespace-pre-wrap break-words text-xs">{preview?.text ?? ""}</pre>
        {preview?.truncated ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t(($) => $.researchTools.outputs.previewTruncated)}
          </p>
        ) : null}
      </>
    );
  };

  return (
    <section
      aria-label={t(($) => $.researchTools.outputs.title)}
      data-testid="task-outputs-section"
      className="shrink-0 border-t border-sidebar-border"
    >
      <button
        type="button"
        aria-expanded={open}
        className="flex h-8 w-full items-center gap-1.5 px-3 text-left hover:bg-sidebar-accent"
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <FlaskConical aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className={cn("flex-1", SIDEBAR_TITLE_CLASS)}>
          {t(($) => $.researchTools.outputs.title)}
        </span>
        <Badge variant="quiet" className="px-1.5 text-[0.625rem] tabular-nums">
          {groups.length}
        </Badge>
      </button>
      {open ? (
        <div className="max-h-56 overflow-auto p-1.5 pt-0">
          {groups.map((task) => (
            <div key={task.id} className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5 rounded-md py-1 pl-2 pr-1">
                <span
                  aria-hidden="true"
                  className={cn("size-1.5 shrink-0 rounded-full", statusDotClass(task.status))}
                />
                <Tooltip label={task.title} className="min-w-0 flex-1">
                  <span className="min-w-0 truncate text-xs font-medium text-sidebar-foreground">
                    {task.title}
                  </span>
                </Tooltip>
                <Button
                  size="xs"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => openTaskDetail(task.id, "review")}
                >
                  {t(($) => $.researchTools.outputs.review)}
                </Button>
              </div>
              {(task.result?.changedFiles ?? []).map((change) => (
                <button
                  key={`file:${change.path}`}
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded-md py-1 pl-6 pr-2 text-left text-xs text-sidebar-foreground hover:bg-sidebar-accent"
                  onClick={() => void openFile(task, change)}
                >
                  <span className="w-3 shrink-0 font-mono text-[0.625rem] text-muted-foreground">
                    {CHANGE_MARKS[change.kind]}
                  </span>
                  <span className="min-w-0 truncate">{change.path}</span>
                </button>
              ))}
              {(task.result?.artifacts ?? []).map((artifact) => (
                <button
                  key={`artifact:${artifact.path}:${artifact.label}`}
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded-md py-1 pl-6 pr-2 text-left text-xs text-sidebar-foreground hover:bg-sidebar-accent"
                  onClick={() => void openArtifact(task, artifact)}
                >
                  <Paperclip aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{artifact.label}</span>
                  <span className="min-w-0 shrink truncate font-mono text-[0.625rem] text-muted-foreground">
                    {artifact.path}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      <Dialog
        open={preview !== null}
        onOpenChange={(next) => {
          if (!next) {
            previewRequest.current += 1;
            setPreview(null);
          }
        }}
      >
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.label ?? ""}</DialogTitle>
            <DialogDescription>
              {t(($) => $.researchTools.outputs.previewDescription, {
                title: preview?.taskTitle ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div data-select-all-scope className="min-h-0 select-text overflow-auto rounded-md border bg-muted/20 p-3">
            {preview?.error ? (
              <p role="alert" className="text-sm text-destructive">
                {preview.error}
              </p>
            ) : (
              previewBody()
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                previewRequest.current += 1;
                setPreview(null);
              }}
            >
              {t(($) => $.common.actions.close)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
