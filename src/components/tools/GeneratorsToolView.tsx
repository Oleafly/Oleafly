import { FileText, ListChecks, RefreshCcw, ScrollText, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { ToolPane, ToolPreviewSurface, ToolSegmentedControl, ToolSplitView, ToolStatus } from "@/components/tools/ToolWorkspace";
import { Button } from "@/components/ui/button";
import { useHomeViewStore } from "@/store/home-view";
import { handoffToAssistant, ensureAiProviderOrOpenSettings } from "@/features/assistant-handoff";
import { useFilesStore } from "@/store/files";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { activeSelectionText } from "@/components/editor/selection-text";

interface Generator {
  id: string;
  name: string;
  description: string;
  icon: typeof FileText;
  prompt: string;
}

const GENERATORS: Generator[] = [
  {
    id: "abstract",
    name: "Abstract",
    description: "Draft an abstract from the paper as written, without inventing claims.",
    icon: ScrollText,
    prompt:
      "Write an abstract for the current paper. Read the main document first, then summarize its actual research question, method, and results in at most 250 words. Do not state any claim that is not present in the document. If a section you would need is missing, say so instead of filling the gap.",
  },
  {
    id: "summarize",
    name: "Summarize",
    description: "Condense the open document or selection into key points.",
    icon: FileText,
    prompt:
      "Summarize the current document in 8 to 12 bullet points, ordered the way the argument builds. Keep the paper's own terminology. Flag any point where the source is ambiguous rather than guessing.",
  },
  {
    id: "paraphrase",
    name: "Paraphrase",
    description: "Rewrite a passage in clearer academic prose, meaning preserved.",
    icon: RefreshCcw,
    prompt:
      "Paraphrase the selected passage in clearer academic prose. Preserve the original meaning and terminology choices, keep roughly the same length, and list any sentence whose meaning you were not fully sure of.",
  },
  {
    id: "thesis",
    name: "Thesis outline",
    description: "Plan thesis chapters around the material in the current draft.",
    icon: ListChecks,
    prompt:
      "Propose a chapter-by-chapter outline for turning the current document into a full thesis. Base the chapters on the material that actually exists in the project, mark which chapters are already covered by present content and which would need new writing, and suggest where existing sections would move.",
  },
];


function captureSource() {
  const files = useFilesStore.getState();
  return {
    projectId: files.projectId,
    activePath: files.activePath,
    mainDoc: resolveEffectiveMainDoc().mainDoc,
    selection: activeSelectionText()?.trim() ?? "",
  };
}

export function GeneratorsToolView() {
  const activePage = useHomeViewStore((s) => s.page);
  const goTo = useHomeViewStore((s) => s.goTo);
  const projectId = useFilesStore((s) => s.projectId);
  const activePath = useFilesStore((s) => s.activePath);
  const docVersion = useFilesStore((s) => s.docVersion);
  const [selectedId, setSelectedId] = useState("abstract");
  const [sourceMode, setSourceMode] = useState("document");
  const [source, setSource] = useState(captureSource);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const launching = useRef(false);
  const revision = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: source snapshots follow the open project and document revision
  useEffect(() => {
    revision.current += 1;
    setSource(captureSource());
    return () => { revision.current += 1; };
  }, [activePage, projectId, activePath, docVersion]);

  useEffect(() => {
    if (activePage === "generators") {
      setError(null);
      document.querySelector<HTMLElement>('[data-testid="generators-tool-view-back"]')?.focus();
    }
  }, [activePage]);

  const generator = GENERATORS.find((item) => item.id === selectedId) ?? GENERATORS[0];
  const usesSelection = generator.id === "paraphrase" || (generator.id === "summarize" && sourceMode === "selection");
  const missingSource = !projectId
    ? "Open a project to use a writing task."
    : usesSelection && !source.selection
      ? "Select a passage in the editor, then return to this task."
      : null;
  const sourceInstruction = usesSelection
    ? `Use this selected passage as the source:\n\n${source.selection}`
    : `Work from @${source.mainDoc}.`;
  const prompt = `${generator.prompt}${instructions.trim() ? `\n\nAdditional instructions:\n${instructions.trim()}` : ""}\n\n${sourceInstruction}`;

  if (activePage !== "generators") return null;

  const selectTask = (id: string) => {
    if (launching.current) return;
    revision.current += 1;
    setSelectedId(id);
    const current = captureSource();
    setSource(current);
    setSourceMode(id === "paraphrase" || (id === "summarize" && current.selection) ? "selection" : "document");
    setError(null);
  };

  const launch = async () => {
    if (launching.current || missingSource) return;
    const expected = source;
    const expectedRevision = revision.current;
    const reviewedPrompt = prompt;
    const matchesSource = () => {
      const current = captureSource();
      return current.projectId === expected.projectId
        && current.activePath === expected.activePath
        && current.mainDoc === expected.mainDoc
        && (!usesSelection || current.selection === expected.selection);
    };
    const changedMessage = "The source changed. Review the updated prompt before generating.";
    if (!matchesSource()) {
      setSource(captureSource());
      setError(changedMessage);
      return;
    }
    launching.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!(await ensureAiProviderOrOpenSettings())) return;
      if (
        useHomeViewStore.getState().page !== "generators"
        || revision.current !== expectedRevision
        || !matchesSource()
      ) {
        if (useHomeViewStore.getState().page === "generators") {
          setSource(captureSource());
          setError(changedMessage);
        }
        return;
      }
      handoffToAssistant(reviewedPrompt, { autoSend: true });
      // Reveal the project assistant after the explicit header action.
      goTo("library");
    } catch {
      const message = "Could not open the assistant. Try again.";
      setError(message);
      toast.error(message);
    } finally {
      launching.current = false;
      setBusy(false);
    }
  };

  return (
    <ToolPageShell
      page="generators"
      title="Writing Generators"
      subtitle="Prepare a prompt for the open document"
      icon={ListChecks}
      testId="generators-tool-view"
      showTheme
      status={<ToolStatus state={busy ? "busy" : error ? "error" : "ready"}>{busy ? "Opening assistant" : error ? "Review source" : missingSource ? "Choose a source" : "Ready"}</ToolStatus>}
      actions={
        <Button size="sm" disabled={busy || !!missingSource} onClick={() => void launch()} data-testid="generator-launch">
          <Send aria-hidden className="size-4" /> Generate
        </Button>
      }
    >
      <ToolSplitView>
        <ToolPane title="Writing task" badge={`${GENERATORS.length} tasks`} footer={
          <p className="text-xs text-muted-foreground">Generate opens the assistant and sends the previewed prompt.</p>
        }>
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-6 p-4">
            <legend className="sr-only">Writing task and source</legend>
            <div className="flex flex-col gap-1" data-testid="generators-grid">
              {GENERATORS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={item.id === selectedId}
                  data-testid={`generator-${item.id}`}
                  onClick={() => selectTask(item.id)}
                  className={cn(
                    "flex items-start gap-3 rounded-md px-3 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    item.id === selectedId && "bg-muted",
                  )}
                >
                  <item.icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{item.name}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{item.description}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold tracking-wide text-muted-foreground">SOURCE</span>
                {generator.id === "summarize" ? (
                  <ToolSegmentedControl
                    label="Source for summary"
                    value={sourceMode}
                    options={[
                      { value: "document", label: "Document", testId: "generator-source-document" },
                      { value: "selection", label: "Selection", testId: "generator-source-selection" },
                    ]}
                    onChange={(value) => { revision.current += 1; setSourceMode(value); setError(null); }}
                  />
                ) : null}
              </div>
              <p className="break-all font-mono text-xs text-muted-foreground" data-testid="generator-source-path">
                {projectId ? usesSelection ? source.activePath : source.mainDoc : "No project open"}
              </p>
              {usesSelection && source.selection ? (
                <p className="max-h-44 overflow-auto whitespace-pre-wrap text-sm leading-relaxed" data-testid="generator-source-selection-text">{source.selection}</p>
              ) : !usesSelection && projectId ? (
                <p className="text-xs leading-relaxed text-muted-foreground">The assistant will read the main document before writing.</p>
              ) : null}
              {missingSource ? <p className="text-xs leading-relaxed text-muted-foreground">{missingSource}</p> : null}
            </div>
            <div className="space-y-2 border-t pt-4">
              <label htmlFor="generator-instructions" className="text-xs font-semibold tracking-wide text-muted-foreground">INSTRUCTIONS (OPTIONAL)</label>
              <textarea
                id="generator-instructions"
                data-testid="generator-instructions"
                value={instructions}
                maxLength={2000}
                rows={4}
                placeholder="For example, use plain language and keep it under 150 words."
                onChange={(event) => { revision.current += 1; setInstructions(event.target.value); setError(null); }}
                className="w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            {error ? <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p> : null}
          </fieldset>
        </ToolPane>
        <ToolPane title="Prompt preview" badge={generator.name} footer={
          <p className="text-xs text-muted-foreground">Review the source and instructions before generating.</p>
        }>
          <ToolPreviewSurface className="items-start justify-center">
            <div className="mx-auto w-full max-w-2xl space-y-6">
              <p className="text-xs font-medium text-muted-foreground">{generator.name}</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-7" data-testid="generator-prompt-preview">
                {missingSource ?? prompt}
              </p>
            </div>
          </ToolPreviewSurface>
        </ToolPane>
      </ToolSplitView>
    </ToolPageShell>
  );
}
