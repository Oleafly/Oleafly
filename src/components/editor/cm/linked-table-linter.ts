import { linter, type Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { findLinkedLatexTables } from "@oleafly/conversion-registry/table";
import { i18n } from "@/i18n";
import { diskHash } from "@/lib/disk-hash";
import { logError } from "@/lib/log";
import { normalizeProjectPath } from "@/lib/project-intelligence/source";
import { readFileContent } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

export type LinkedDataReader = (path: string) => Promise<string | null>;

type Relink = typeof import("@/features/table-import").relinkedTable;

async function readLinkedData(path: string): Promise<string | null> {
  const indexed = useIndexStore.getState().texts[path];
  if (indexed !== undefined) return indexed;
  const projectId = useFilesStore.getState().projectId;
  if (!projectId) return null;
  try {
    return await readFileContent(projectId, path, true);
  } catch (error) {
    void logError("read a linked table's data file", error);
    return null;
  }
}

function updateTable(view: EditorView, from: number, data: string, relink: Relink): void {
  if (view.state.readOnly) return;
  const match = findLinkedLatexTables(view.state.doc.toString()).find((candidate) => candidate.from === from);
  const edit = match ? relink(match, data) : null;
  if (edit) view.dispatch({ changes: edit });
}

export async function linkedTableDiagnostics(text: string, read: LinkedDataReader = readLinkedData): Promise<Diagnostic[]> {
  const matches = findLinkedLatexTables(text);
  if (matches.length === 0) return [];
  const { relinkedTable } = await import("@/features/table-import");
  const diagnostics: Diagnostic[] = [];
  const reads = await Promise.all(
    matches.map((match) => {
      const path = normalizeProjectPath(match.table.source);
      return path ? read(path) : Promise.resolve(null);
    }),
  );
  for (const [index, match] of matches.entries()) {
    const data = reads[index];
    if (data === null || diskHash(data) === match.table.hash || !relinkedTable(match, data)) continue;
    diagnostics.push({
      from: match.from,
      to: match.to,
      severity: "info",
      message: i18n.t(($) => $.editor.tableImport.dataChanged),
      source: "linked-table",
      actions: [{
        name: i18n.t(($) => $.editor.tableImport.updateTable),
        apply: (view, from) => updateTable(view, from, data, relinkedTable),
      }],
    });
  }
  return diagnostics;
}

export function createLinkedTableLinter() {
  return linter((view) => linkedTableDiagnostics(view.state.doc.toString()).catch((error: unknown) => {
    void logError("check linked tables", error);
    return [];
  }), {
    delay: 1500,
    tooltipFilter: () => [],
  });
}
