import { LibraryBig } from "lucide-react";
import { LiteratureSearchPanel } from "@/components/tools/LiteratureSearchPanel";
import { ToolPageShell } from "@/components/tools/ToolPageShell";

export function LiteratureSearchToolView() {
  return (
    <ToolPageShell
      page="literature-search"
      title="Citation Search"
      subtitle="Search multiple indexes and export BibTeX"
      icon={LibraryBig}
      testId="literature-search-tool-view"
    >
      <LiteratureSearchPanel />
    </ToolPageShell>
  );
}
