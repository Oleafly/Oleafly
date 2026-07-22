import { useState } from "react";
import { ArrowLeft, BookMarked, Calculator, PanelLeft, School, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { LibrarySidebar } from "@/components/library/LibrarySidebar";
import { useLatexToolsStore } from "@/store/latex-tools";
import { useLibrarySidebarStore } from "@/store/library-sidebar";
import { BibtexValidatorPanel } from "@/components/tools/BibtexValidatorPanel";
import { EquationPreviewPanel } from "@/components/tools/EquationPreviewPanel";
import { TableGeneratorPanel } from "@/components/tools/TableGeneratorPanel";
import { LabSearchPanel } from "@/components/tools/LabSearchPanel";

const TABS = [
  { id: "bibtex", label: "BibTeX validator", icon: BookMarked },
  { id: "equation", label: "Equation preview", icon: Calculator },
  { id: "table", label: "Table generator", icon: Table2 },
  { id: "lab-search", label: "Lab search", icon: School },
] as const;
type ToolTab = (typeof TABS)[number]["id"];

export function LatexToolsView() {
  const open = useLatexToolsStore((s) => s.open);
  const close = useLatexToolsStore((s) => s.close);
  const [tab, setTab] = useState<ToolTab>("bibtex");
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useLibrarySidebarStore();
  if (!open) return null;
  return (
    <div data-testid="latex-tools-view" className="fixed inset-0 z-50 flex bg-background">
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
          <Button variant="ghost" size="sm" onClick={close} data-testid="latex-tools-back">
            <ArrowLeft className="size-4" /> Back
          </Button>
          <div className="font-medium">LaTeX Tools</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
          {TABS.map((t) => (
            <Button
              key={t.id}
              size="xs"
              variant={tab === t.id ? "secondary" : "ghost"}
              data-testid={`latex-tools-tab-${t.id}`}
              onClick={() => setTab(t.id)}
            >
              <t.icon className="size-3.5" /> {t.label}
            </Button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1">
          {tab === "bibtex" && <BibtexValidatorPanel />}
          {tab === "equation" && <EquationPreviewPanel />}
          {tab === "table" && <TableGeneratorPanel />}
          {tab === "lab-search" && <LabSearchPanel />}
        </div>
      </div>
    </div>
  );
}
