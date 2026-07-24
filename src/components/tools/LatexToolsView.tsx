import { useMemo, useState, type ComponentType } from "react";
import { Calculator, FileInput, School, Search, ShieldCheck, Table2, ToolCase, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WHITE_PANEL, cn } from "@/lib/utils";
import { useHomeViewStore, type HomePage } from "@/store/home-view";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";

type ToolId = "pdf-to-latex" | "equation" | "bibtex" | "table" | "lab-search";

interface ToolDef {
  id: ToolId;
  name: string;
  letter: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  tags: string[];
  category: string;
}

const CATEGORY_ORDER = ["Write & Convert", "Check & Validate", "Data & Tables", "Research & Analyze"];

const TOOLS: ToolDef[] = [
  {
    id: "pdf-to-latex",
    name: "PDF to LaTeX",
    letter: "P",
    description: "Convert PDFs to LaTeX with math, figures, and structure preserved.",
    icon: FileInput,
    tags: ["Math extraction", "Figure export", "Client-side"],
    category: "Write & Convert",
  },
  {
    id: "equation",
    name: "Equation Preview",
    letter: "E",
    description: "Render LaTeX math live with KaTeX and copy the source.",
    icon: Calculator,
    tags: ["KaTeX", "Inline & display", "Copy source"],
    category: "Write & Convert",
  },
  {
    id: "bibtex",
    name: "BibTeX Validator",
    letter: "B",
    description: "Validate .bib files for syntax errors and missing required fields.",
    icon: ShieldCheck,
    tags: ["12 entry types", "Required fields", "Duplicate keys"],
    category: "Check & Validate",
  },
  {
    id: "table",
    name: "LaTeX Table Generator",
    letter: "T",
    description: "Build LaTeX tables with a visual row/column editor.",
    icon: Table2,
    tags: ["Visual editor", "booktabs", "Export"],
    category: "Data & Tables",
  },
  {
    id: "lab-search",
    name: "Lab Search",
    letter: "L",
    description: "Search research institutions worldwide via the open OpenAlex API.",
    icon: School,
    tags: ["OpenAlex", "Global", "No sign-up"],
    category: "Research & Analyze",
  },
];

const TOOL_PAGE: Record<ToolId, HomePage> = {
  "pdf-to-latex": "pdf-import",
  equation: "equation",
  bibtex: "bibtex",
  table: "table",
  "lab-search": "lab-search",
};

function ToolCard({ tool, onOpen }: { tool: ToolDef; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-testid={`latex-tool-card-${tool.id}`}
      onClick={onOpen}
      className="group flex w-full items-start gap-4 rounded-lg border bg-card p-4 text-left transition-colors hover:border-foreground/25 hover:bg-accent/40"
    >
      <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-foreground">
        <tool.icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold group-hover:text-foreground">{tool.name}</span>
          <span className="flex size-4 shrink-0 items-center justify-center rounded border bg-muted/60 font-mono text-[9px] font-medium text-muted-foreground">
            {tool.letter}
          </span>
        </div>
        <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {tool.description}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tool.tags.map((t) => (
            <span
              key={t}
              className="rounded-full border bg-muted/40 px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

function ToolsGallery({
  search,
  onOpenTool,
}: {
  search: string;
  onOpenTool: (id: ToolId) => void;
}) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return TOOLS;
    return TOOLS.filter((t) =>
      `${t.name} ${t.description} ${t.tags.join(" ")}`.toLowerCase().includes(q),
    );
  }, [search]);

  const grouped = useMemo(() => {
    const byCategory = new Map<string, ToolDef[]>();
    for (const t of filtered) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
    return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({
      category: c,
      tools: byCategory.get(c) ?? [],
    }));
  }, [filtered]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex-1 space-y-6 p-5">
        {grouped.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No tools match.
          </div>
        ) : (
          grouped.map(({ category: c, tools }) => (
            <div key={c}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {c}
              </div>
              <div className="flex flex-col gap-2">
                {tools.map((t) => (
                  <ToolCard key={t.id} tool={t} onOpen={() => onOpenTool(t.id)} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function LatexToolsView() {
  const active = useHomeViewStore((s) => s.toolsOpen);
  const closeTools = useHomeViewStore((s) => s.closeTools);
  const goTo = useHomeViewStore((s) => s.goTo);
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(active, closeTools);
  const [search, setSearch] = useState("");
  if (!active) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close LaTeX tools"
        className="absolute inset-0"
        onMouseDown={onBackdropMouseDown}
      />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="latex-tools-title"
        data-modal-initial-focus
        data-testid="latex-tools-view"
        className={cn("dark relative flex h-[36rem] w-full max-w-3xl flex-col overflow-hidden rounded-xl text-foreground", WHITE_PANEL)}
      >
        <div className="flex items-center gap-3 border-b px-5 py-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
            <ToolCase className="size-4" />
          </div>
          <div id="latex-tools-title" className="shrink-0 text-base font-bold tracking-tight">LaTeX Tools</div>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${TOOLS.length} tools`}
              className="h-8 pl-8"
            />
          </div>
          <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={closeTools} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
        <ToolsGallery
          search={search}
          onOpenTool={(id) => {
            closeTools();
            goTo(TOOL_PAGE[id]);
          }}
        />
      </div>
    </div>
  );
}
