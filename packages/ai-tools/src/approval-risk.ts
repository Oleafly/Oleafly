export type ToolRisk = "read" | "write" | "shell" | "network";
export type ApprovalMode =
  | "ask-for-approval"
  | "approve-for-me"
  | "full-access"
  | "custom";
export type ApprovalGateDecision = "prompt" | "auto-approve" | "deny-per-rules";
export type ApprovalRuleDecision = "allow" | "deny";

export const DEFAULT_APPROVAL_MODE: ApprovalMode = "approve-for-me";

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

const READ_ONLY_TOOLS = new Set([
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
  "load_image",
  "verify_pdf_pages",
  "load_skill",
  "list_agents",
  "literature_search",
  "alphaxiv_search",
  "alphaxiv_paper_content",
  "verify_citation",
]);

export const PLAN_MODE_TOOL_ERROR =
  "Plan mode: this tool is unavailable until the plan is approved.";

export function isReadOnlyTool(tool: string): boolean {
  return READ_ONLY_TOOLS.has(tool);
}

export function planModeTools<T>(tools: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(tools).filter(([name]) => isReadOnlyTool(name)),
  );
}

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

export function decideToolApproval(input: {
  mode: ApprovalMode;
  toolCall: { name: string };
  risk: ToolRisk;
  projectRules?: Readonly<Record<string, ApprovalRuleDecision>>;
}): ApprovalGateDecision {
  if (input.mode === "custom") {
    const rule = input.projectRules?.[input.toolCall.name];
    if (rule === "deny") return "deny-per-rules";
    if (rule === "allow") return "auto-approve";
  }
  if (input.mode === "full-access") return "auto-approve";
  if (input.mode === "ask-for-approval") {
    return input.risk === "read" ? "auto-approve" : "prompt";
  }
  return riskRequiresConfirm(input.risk) ? "prompt" : "auto-approve";
}
