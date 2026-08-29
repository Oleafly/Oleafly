// Risk classes for agent tools. read runs without a prompt; write pauses the
// run for confirmation (with a diff where one exists); shell would confirm
// with command and cwd (no such tool ships today; engines run sandboxed);
// network consent is granted when the user configures the connector in
// Settings, so classified network tools do not re-prompt per call. Unknown
// tools default to write so a new tool never runs silently.

export type ToolRisk = "read" | "write" | "shell" | "network";

const READ_TOOLS = new Set([
  "read_file",
  "list_files",
  "project_map",
  "search_project",
  "project_library_search",
  "get_pdf_text",
  "get_log",
  "get_todos",
  "update_todos",
  "list_notes",
  "remember_note",
  "forget_note",
  "load_image",
  "preview_figure",
  "verify_pdf_pages",
  "toggle_theme",
  "compile",
  "spawn_agent",
  "send_message",
  "followup_task",
  "wait_agent",
  "interrupt_agent",
  "list_agents",
  "close_agent",
]);

const WRITE_TOOLS = new Set([
  "write_file",
  "replace_in_file",
  "create_file",
  "rename_file",
  "delete_file",
  "set_main_doc",
  "insert_figure",
  // computer_use gates per-action in its own executor (read-only auto,
  // navigate/click/type confirmed), so the tool itself is not a blanket write.
  "computer_use",
]);

const NETWORK_TOOLS = new Set([
  "literature_search",
  "alphaxiv_search",
  "alphaxiv_paper_content",
  "verify_citation",
]);

export function toolRisk(tool: string): ToolRisk {
  if (tool === "run_command") return "shell";
  if (READ_TOOLS.has(tool)) return "read";
  if (NETWORK_TOOLS.has(tool)) return "network";
  if (WRITE_TOOLS.has(tool)) return "write";
  return "write";
}

export function riskRequiresConfirm(risk: ToolRisk): boolean {
  return risk === "write" || risk === "shell";
}
