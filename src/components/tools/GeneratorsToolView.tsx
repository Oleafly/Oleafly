import { FileText, ListChecks, RefreshCcw, ScrollText } from "lucide-react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { useHomeViewStore } from "@/store/home-view";
import { handoffToAssistant } from "@/features/assistant-handoff";
import { ensureAiProviderOrOpenSettings } from "@/features/assistant-handoff";
import { useFilesStore } from "@/store/files";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { toast } from "@/lib/toast";

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
    description: "Turn the current draft into a chapter-by-chapter thesis skeleton.",
    icon: ListChecks,
    prompt:
      "Propose a chapter-by-chapter outline for turning the current document into a full thesis. Base the chapters on the material that actually exists in the project, mark which chapters are already covered by present content and which would need new writing, and suggest where existing sections would move.",
  },
];

export function GeneratorsToolView() {
  const activePage = useHomeViewStore((s) => s.page);
  if (activePage !== "generators") return null;

  const launch = (generator: Generator) => {
    if (!ensureAiProviderOrOpenSettings()) return;
    const files = useFilesStore.getState();
    if (!files.projectId) {
      toast.info("Open a project first. Generators work on the document you are writing.");
      return;
    }
    const mainDoc = resolveEffectiveMainDoc().mainDoc;
    handoffToAssistant(
      `${generator.prompt} Work from @${mainDoc}.`,
      { autoSend: true },
    );
  };

  return (
    <ToolPageShell
      page="generators"
      title="Writing Generators"
      subtitle="One-click drafts handed to the assistant, grounded in the open project"
      icon={ListChecks}
      testId="generators-tool-view"
    >
      <div className="grid gap-2 sm:grid-cols-2" data-testid="generators-grid">
        {GENERATORS.map((generator) => (
          <button
            key={generator.id}
            type="button"
            data-testid={`generator-${generator.id}`}
            onClick={() => launch(generator)}
            className="flex items-start gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <generator.icon aria-hidden className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                {generator.name}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {generator.description}
              </span>
            </span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Generators start an assistant turn with the document attached. Every
        instruction asks for no claims beyond what the draft contains.
      </p>
    </ToolPageShell>
  );
}
