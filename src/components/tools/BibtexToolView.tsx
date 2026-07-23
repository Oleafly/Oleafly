import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { BibtexValidatorPanel } from "@/components/tools/BibtexValidatorPanel";

export function BibtexToolView() {
  return (
    <ToolPageShell page="bibtex" title="BibTeX Validator" testId="bibtex-tool-view">
      <BibtexValidatorPanel />
    </ToolPageShell>
  );
}
