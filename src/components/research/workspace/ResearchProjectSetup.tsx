import { useEffect, useState } from "react";
import { FileText, Folder, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export function ResearchProjectSetup({
  open,
  onClose,
  onCreated,
  ensureInitialTask,
}: {
  open: boolean;
  onClose: () => void;
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
  const [preview, setPreview] = useState<ResearchProjectPreview | null>(null);
  const [selectedPreviewPath, setSelectedPreviewPath] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [initialTaskReady, setInitialTaskReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setEngine("latex");
    setStarter("article");
    setPreview(null);
    setSelectedPreviewPath(null);
    setError(null);
    setCreatedProjectId(null);
    setInitialTaskReady(false);
  }, [open]);

  useEffect(() => {
    if (!open || !name.trim()) {
      setPreview(null);
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
            setPreview(result);
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
    setCreating(true);
    setError(null);
    try {
      await finishResearchProjectSetup({
        request: { name, engine, starter },
        task: {
          title: TASK_TITLES[starter],
          prompt: preview?.initialTask ?? "Plan the first research task.",
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
      onClose();
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
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-hidden" closeDisabled={creating}>
        <DialogHeader>
          <DialogTitle>New research project</DialogTitle>
          <DialogDescription>Choose a starting structure and inspect every file before Oleafly creates it.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-5 overflow-auto md:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="grid gap-1.5 text-sm font-medium">
              <label htmlFor="research-project-name">Project name</label>
              <Input id="research-project-name" autoFocus disabled={Boolean(createdProjectId)} value={name} maxLength={120} placeholder="My research project" onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="grid gap-1.5 text-sm font-medium">
              <label htmlFor="research-project-engine">Document engine</label>
              <Select value={engine} disabled={Boolean(createdProjectId)} onValueChange={(value) => setEngine(value as ResearchDocumentEngine)}>
                <SelectTrigger id="research-project-engine"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENGINES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 text-sm font-medium">
              <label htmlFor="research-project-starter">Study starter</label>
              <Select value={starter} disabled={Boolean(createdProjectId)} onValueChange={(value) => setStarter(value as ResearchStarter)}>
                <SelectTrigger id="research-project-starter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STARTERS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{selectedStarter?.description}</p>
            {preview && (
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium">First research task</p>
                <p className="mt-1 text-xs text-muted-foreground">{preview.initialTask}</p>
              </div>
            )}
          </div>
          <div className="min-h-72 rounded-lg border bg-muted/20">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <p className="text-sm font-medium">Project preview</p>
                {preview && <p className="text-xs text-muted-foreground">Main document: {preview.mainDocument}</p>}
              </div>
              {previewing && <Loader2 className="animate-spin text-muted-foreground" />}
            </div>
            <div className="grid max-h-[52vh] min-h-64 overflow-hidden md:grid-cols-[minmax(12rem,0.45fr)_minmax(0,1fr)]">
              <div className="overflow-auto border-r p-3">
                {!preview ? (
                  <p className="p-2 text-sm text-muted-foreground">Name the project to see its files.</p>
                ) : (
                  <ul className="space-y-1">
                    {preview.files.map((file) => (
                      <li key={file.path}>
                        {file.kind === "directory" ? (
                          <div className="flex items-center gap-2 rounded px-2 py-1 text-xs text-muted-foreground">
                            <Folder />
                            <span className="truncate">{file.path}</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent aria-pressed:bg-accent"
                            aria-pressed={selectedPreviewPath === file.path}
                            onClick={() => setSelectedPreviewPath(file.path)}
                          >
                            <FileText />
                            <span className="truncate">{file.path}</span>
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="overflow-auto p-4">
                {preview ? (
                  <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed">
                    {preview.files.find((file) => file.path === selectedPreviewPath)?.content}
                  </pre>
                ) : null}
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
