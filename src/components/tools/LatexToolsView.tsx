import { useMemo, useState, type ComponentType } from "react";
import {
  ArrowLeft,
  Calculator,
  FileInput,
  PanelLeft,
  School,
  Search,
  ShieldCheck,
  Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { LibrarySidebar } from "@/components/library/LibrarySidebar";
import { cn } from "@/lib/utils";
import { useHomeViewStore } from "@/store/home-view";
import { useLibrarySidebarStore } from "@/store/library-sidebar";
import { BibtexValidatorPanel } from "@/components/tools/BibtexValidatorPanel";
import { EquationPreviewPanel } from "@/components/tools/EquationPreviewPanel";
import { TableGeneratorPanel } from "@/components/tools/TableGeneratorPanel";
import { LabSearchPanel } from "@/components/tools/LabSearchPanel";

type ToolId = "pdf-to-latex" | "equation" | "bibtex" | "table" | "lab-search";

interface ToolDef {
  id: ToolId;
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  tags: string[];
  category: string;
  /** Navigates to a different home page instead of opening in-gallery. */
  external?: boolean;
}

const CATEGORY_ORDER = ["Write & Convert", "Check & Validate", "Data & Tables", "Research & Analyze"];

const TOOLS: ToolDef[] = [
  {
    id: "pdf-to-latex",
    name: "PDF to LaTeX",
    description: "Convert PDFs to LaTeX with math, figures, and structure preserved.",
    icon: FileInput,
    tags: ["Math extraction", "Figure export", "Client-side"],
    category: "Write & Convert",
    external: true,
  },
  {
    id: "equation",
    name: "Equation Preview",
    description: "Render LaTeX math live with KaTeX and copy the source.",
    icon: Calculator,
    tags: ["KaTeX", "Inline & display", "Copy source"],
    category: "Write & Convert",
  },
  {
    id: "bibtex",
    name: "BibTeX Validator",
    description: "Validate .bib files for syntax errors and missing required fields.",
    icon: ShieldCheck,
    tags: ["12 entry types", "Required fields", "Duplicate keys"],
    category: "Check & Validate",
  },
  {
    id: "table",
    name: "LaTeX Table Generator",
    description: "Build LaTeX tables with a visual row/column editor.",
    icon: Table2,
    tags: ["Visual editor", "booktabs", "Export"],
    category: "Data & Tables",
  },
  {
    id: "lab-search",
    name: "Lab Search",
    description: "Search research institutions worldwide via the open OpenAlex API.",
    icon: School,
    tags: ["OpenAlex", "Global", "No sign-up"],
    category: "Research & Analyze",
  },
];

function ToolCard({ tool, onOpen }: { tool: ToolDef; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-testid={`latex-tool-card-${tool.id}`}
      onClick={onOpen}
      className="group flex flex-col items-start gap-3 rounded-lg border bg-muted/20 p-5 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
        <tool.icon className="size-4.5" />
      </div>
      <div>
        <div className="text-sm font-semibold group-hover:text-foreground">{tool.name}</div>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {tool.description}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tool.tags.map((t) => (
          <span
            key={t}
            className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
          >
            {t}
          </span>
        ))}
      </div>
    </button>
  );
}

function ToolsGallery({ onOpenTool }: { onOpenTool: (id: ToolId) => void }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("All");

  const categories = useMemo(() => ["All", ...CATEGORY_ORDER], []);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set("All", TOOLS.length);
    for (const t of TOOLS) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    return counts;
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return TOOLS.filter((t) => {
      if (category !== "All" && t.category !== category) return false;
      if (q && !`${t.name} ${t.description} ${t.tags.join(" ")}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [search, category]);

  const grouped = useMemo(() => {
    const byCategory = new Map<string, ToolDef[]>();
    for (const t of filtered) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
    return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({
      category: c,
      tools: byCategory.get(c) ?? [],
    }));
  }, [filtered]);

  return (
    <div className="flex min-h-0 flex-1">
      <nav className="w-48 shrink-0 overflow-y-auto border-r p-2">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={cn(
              "mb-0.5 flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
              category === c
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <span className="truncate">{c}</span>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                category === c
                  ? "bg-accent-foreground/15 text-accent-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {categoryCounts.get(c) ?? 0}
            </span>
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="border-b px-5 py-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${TOOLS.length} tools`}
              className="pl-8"
            />
          </div>
        </div>
        <div className="flex-1 space-y-8 p-5">
          {grouped.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No tools match.
            </div>
          ) : (
            grouped.map(({ category: c, tools }) => (
              <div key={c}>
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {c}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {tools.map((t) => (
                    <ToolCard
                      key={t.id}
                      tool={t}
                      onOpen={() => {
                        if (t.external) {
                          useHomeViewStore.getState().goTo("pdf-import");
                        } else {
                          onOpenTool(t.id);
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function LatexToolsView() {
  const page = useHomeViewStore((s) => s.page);
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useLibrarySidebarStore();
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const active = page === "latex-tools";
  const tool = activeTool ? TOOLS.find((t) => t.id === activeTool) : null;
  if (!active) return null;
  return (
    <div data-testid="latex-tools-view" className="flex h-full bg-background">
      <LibrarySidebar collapsed={sidebarCollapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div data-tauri-drag-region className="flex items-center gap-3 border-b py-2 pl-4 pr-4">
          <Tooltip label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle sidebar"
              data-testid="toggle-latex-tools-sidebar"
              className="text-muted-foreground hover:text-foreground"
              onClick={toggleSidebar}
            >
              <PanelLeft className="size-4" />
            </Button>
          </Tooltip>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              tool
                ? setActiveTool(null)
                : useHomeViewStore.getState().goTo("library")
            }
            data-testid="latex-tools-back"
          >
            <ArrowLeft className="size-4" /> {tool ? "All tools" : "Back"}
          </Button>
          <div className="font-medium">{tool ? tool.name : "LaTeX Tools"}</div>
        </div>
        {tool ? (
          <div className="flex min-h-0 flex-1">
            {tool.id === "bibtex" && <BibtexValidatorPanel />}
            {tool.id === "equation" && <EquationPreviewPanel />}
            {tool.id === "table" && <TableGeneratorPanel />}
            {tool.id === "lab-search" && <LabSearchPanel />}
          </div>
        ) : (
          <ToolsGallery onOpenTool={setActiveTool} />
        )}
      </div>
    </div>
  );
}
