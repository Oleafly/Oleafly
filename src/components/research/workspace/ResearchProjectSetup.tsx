import { useEffect, useState } from "react";
import { ChevronRight, FolderOpen, FolderTree, Loader2, Star } from "lucide-react";
import { FileIcon } from "@/components/files/fileIcon";
import { HighlightedCode } from "@/components/ui/code-highlighter";
import { Button } from "@/components/ui/button";
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

const ENGINES: { value: ResearchDocumentEngine; label: string }[] = [
  { value: "latex", label: "LaTeX" },
  { value: "typst", label: "Typst" },
  { value: "markdown", label: "Markdown" },
];

const STARTERS: { value: ResearchStarter; label: string; description: string }[] = [
  { value: "article", label: "Article", description: "A standard research paper with methods, results, and discussion." },
  { value: "literature_review", label: "Literature review", description: "A source-led review organized around scope, themes, and evidence gaps." },
  { value: "thesis", label: "Thesis", description: "A longer study with background, methods, results, and conclusion sections." },
  { value: "reproducible_analysis", label: "Reproducible analysis", description: "A manuscript with data provenance, environment notes, and separate outputs." },
];

const TASK_TITLES: Record<ResearchStarter, string> = {
  article: "Plan the article",
  literature_review: "Plan the literature review",
  thesis: "Plan the thesis",
  reproducible_analysis: "Plan the analysis",
};

const PREVIEW_TREE_SKELETON = [82, 58, 71, 46, 64, 52];
const PREVIEW_TEXT_SKELETON = [92, 68, 79, 44, 86, 61, 74];

function previewLanguage(path: string): string | undefined {
  const extension = path.split(".").pop()?.toLowerCase();
  if (!extension || extension === path.toLowerCase()) return undefined;
  return extension;
}

export function ResearchProjectSetup({
  open,
  onClose,
  onFinished,
  onCreated,
  ensureInitialTask,
}: {
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
}) {
  const [name, setName] = useState("");
  const [engine, setEngine] = useState<ResearchDocumentEngine>("latex");
  const [starter, setStarter] = useState<ResearchStarter>("article");
  const [previewResult, setPreviewResult] = useState<{ requestKey: string; value: ResearchProjectPreview } | null>(null);
  const [selectedPreviewPath, setSelectedPreviewPath] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [initialTaskReady, setInitialTaskReady] = useState(false);
  const requestKey = JSON.stringify({ name, engine, starter });
  const preview = previewResult?.requestKey === requestKey ? previewResult.value : null;

  useEffect(() => {
    if (!open) return;
    setName("");
    setEngine("latex");
    setStarter("article");
    setPreviewResult(null);
    setSelectedPreviewPath(null);
    setError(null);
    setCreatedProjectId(null);
    setInitialTaskReady(false);
  }, [open]);

  useEffect(() => {
    if (!open || !name.trim()) {
      setPreviewResult(null);
      setPreviewing(false);
      setSelectedPreviewPath(null);
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      setPreviewing(true);
      setError(null);
      const request: ResearchProjectRequest = { name, engine, starter };
      void previewResearchProject(request)
        .then((result) => {
          if (current) {
            setPreviewResult({ requestKey: JSON.stringify(request), value: result });
            setSelectedPreviewPath(result.mainDocument);
          }
        })
        .catch((cause) => {
          if (current) setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (current) setPreviewing(false);
        });
    }, 150);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [engine, name, open, starter]);

  const create = async () => {
    if (!preview || previewing || creating) return;
    setCreating(true);
    setError(null);
    try {
      await finishResearchProjectSetup({
        request: { name, engine, starter },
        task: {
          title: TASK_TITLES[starter],
          prompt: preview.initialTask,
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
      const detail = cause instanceof Error ? cause.message : String(cause);
      if (cause instanceof ResearchProjectSetupStageError && cause.stage === "task") {
        if (cause.projectId) {
          try {
            await onCreated(cause.projectId);
          } catch (openCause) {
            const openDetail = openCause instanceof Error ? openCause.message : String(openCause);
            setError(`The project was created, but Oleafly couldn't save its first task or open the project. Retry setup. ${detail} ${openDetail}`);
            return;
          }
        }
        setError(`The project is open, but its first task wasn't saved. Retry to finish setup. ${detail}`);
      } else if (cause instanceof ResearchProjectSetupStageError && cause.stage === "open") {
        setError(`The project and its first task are ready, but Oleafly couldn't open it. Retry to open it. ${detail}`);
      } else {
        setError(detail);
      }
    } finally {
      setCreating(false);
    }
  };

  const selectedStarter = STARTERS.find((item) => item.value === starter);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !creating && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-hidden" closeDisabled={creating}>
        <DialogHeader>
          <DialogTitle>New research project</DialogTitle>
          <DialogDescription>Choose a starting structure and inspect every file before Oleafly creates it.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-5 overflow-auto md:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="grid gap-1.5 text-sm font-medium">
              <label htmlFor="research-project-name">Project name</label>
              <Input id="research-project-name" autoFocus disabled={creating || Boolean(createdProjectId)} value={name} maxLength={120} placeholder="My research project" onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="grid gap-1.5 text-sm font-medium">
              <label htmlFor="research-project-engine">Document engine</label>
              <Select value={engine} disabled={creating || Boolean(createdProjectId)} onValueChange={(value) => setEngine(value as ResearchDocumentEngine)}>
                <SelectTrigger id="research-project-engine"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENGINES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 text-sm font-medium">
              <label htmlFor="research-project-starter">Study starter</label>
              <Select value={starter} disabled={creating || Boolean(createdProjectId)} onValueChange={(value) => setStarter(value as ResearchStarter)}>
                <SelectTrigger id="research-project-starter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STARTERS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">{selectedStarter?.description}</p>
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
                <p className="text-xs font-medium">First research task</p>
                {preview ? (
                  <p className="mt-1 text-xs text-muted-foreground">{preview.initialTask}</p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {previewing
                      ? "Working out the first task…"
                      : "Name the project to see the task Oleafly queues for it."}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex h-[32rem] flex-col overflow-hidden rounded-lg border bg-background">
            <div className="flex h-9 items-center justify-between border-b bg-sidebar px-3">
              <div className="flex items-center gap-1.5">
                <FolderTree aria-hidden="true" className="size-3.5 text-muted-foreground" />
                <span className="text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70">
                  Project preview
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {preview ? `Main document: ${preview.mainDocument}` : "\u00a0"}
                </span>
                {previewing ? (
                  <Loader2
                    aria-label="Building the preview"
                    className="size-3.5 animate-spin text-muted-foreground"
                  />
                ) : null}
              </div>
            </div>
            <div className="grid min-h-0 flex-1 overflow-hidden md:grid-cols-[minmax(12rem,0.42fr)_minmax(0,1fr)]">
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
                ) : !preview ? (
                  <p className="p-2 text-sm text-muted-foreground">
                    Name the project to see its files.
                  </p>
                ) : (
                  <ul aria-label="Project preview files" className="space-y-px">
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
                              "flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-ring",
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
                )}
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
                  ) : preview && selectedPreviewPath ? (
                    <pre className="whitespace-pre-wrap break-words px-4 py-3 text-xs leading-relaxed">
                      <HighlightedCode
                        language={previewLanguage(selectedPreviewPath)}
                        source={
                          preview.files.find((file) => file.path === selectedPreviewPath)
                            ?.content ?? ""
                        }
                      />
                    </pre>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={creating} onClick={onClose}>Cancel</Button>
          <Button disabled={creating || previewing || !preview} onClick={create}>
            {creating && <Loader2 className="animate-spin" />} {createdProjectId ? "Retry setup" : "Create and open project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
