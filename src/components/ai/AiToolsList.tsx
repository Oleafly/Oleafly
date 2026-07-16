import { cn } from "@/lib/utils";

// The tools the assistant (and external agents over MCP) can call. Shared by the
// AI settings panel and the MCP activity info popover so the list stays in sync.
export const AI_TOOLS: { name: string; desc: string }[] = [
  { name: "read_file", desc: "Read a file's contents" },
  { name: "write_file", desc: "Write or overwrite a file" },
  { name: "replace_in_file", desc: "Find & replace within a file" },
  { name: "create_file", desc: "Create a file or folder" },
  { name: "rename_file", desc: "Rename or move a path" },
  { name: "delete_file", desc: "Delete a file or folder" },
  { name: "list_files", desc: "List the project tree" },
  { name: "search_project", desc: "Search text in the current project" },
  { name: "project_map", desc: "Structural outline, labels, cites, inputs" },
  { name: "compile", desc: "Compile the project to PDF" },
  { name: "get_log", desc: "Get the last compile log" },
  { name: "get_pdf_text", desc: "Extract text from the PDF" },
  { name: "verify_pdf_pages", desc: "Rasterize pages for vision layout checks" },
  { name: "update_todos", desc: "Maintain a multi-step plan checklist" },
  { name: "get_todos", desc: "Read the current plan checklist" },
  { name: "remember_note", desc: "Save sticky project memory for later turns" },
  { name: "forget_note", desc: "Remove a sticky memory note" },
  { name: "list_notes", desc: "List sticky project memory notes" },
  { name: "set_main_doc", desc: "Set the main document" },
  { name: "toggle_theme", desc: "Toggle light/dark mode" },
];

export function AiToolsGrid({
  columns = 2,
  className,
}: {
  columns?: 1 | 2;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-x-4 gap-y-1",
        columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1",
        className,
      )}
    >
      {AI_TOOLS.map((t) => (
        <div key={t.name} className="flex items-baseline gap-2 text-[11px]">
          <code className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
            {t.name}
          </code>
          <span className="text-muted-foreground">{t.desc}</span>
        </div>
      ))}
    </div>
  );
}
