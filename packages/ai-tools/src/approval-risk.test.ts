import { describe, expect, it } from "vitest";
import {
  PLAN_MODE_TOOL_ERROR,
  decideToolApproval,
  isReadOnlyTool,
  planModeTools,
  riskRequiresConfirm,
  toolRisk,
} from "./approval-risk";

describe("toolRisk", () => {
  it("classifies read-only project tools as read", () => {
    for (const tool of [
      "read_file",
      "list_files",
      "project_map",
      "search_project",
      "get_pdf_text",
      "get_log",
      "spawn_agent",
      "send_message",
      "followup_task",
      "wait_agent",
      "interrupt_agent",
      "list_agents",
      "close_agent",
    ]) {
      expect(toolRisk(tool)).toBe("read");
    }
  });

  it("treats computer_use as a write so the per-action gate always runs", () => {
    expect(toolRisk("computer_use")).toBe("write");
  });

  it("classifies file mutations as write", () => {
    for (const tool of [
      "write_file",
      "replace_in_file",
      "create_file",
      "rename_file",
      "delete_file",
      "set_main_doc",
      "insert_figure",
    ]) {
      expect(toolRisk(tool)).toBe("write");
    }
  });

  it("classifies remote lookups as network", () => {
    for (const tool of [
      "literature_search",
      "alphaxiv_search",
      "alphaxiv_paper_content",
      "verify_citation",
    ]) {
      expect(toolRisk(tool)).toBe("network");
    }
  });

  it("treats unknown tools as write so they never run silently", () => {
    expect(toolRisk("brand_new_tool")).toBe("write");
  });
});

describe("riskRequiresConfirm", () => {
  it("only read runs without a prompt", () => {
    expect(riskRequiresConfirm("read")).toBe(false);
    expect(riskRequiresConfirm("write")).toBe(true);
    expect(riskRequiresConfirm("shell")).toBe(true);
    // Network consent is granted when the user configures the connector, so
    // classified network tools do not re-prompt per call.
    expect(riskRequiresConfirm("network")).toBe(false);
  });
});

describe("decideToolApproval", () => {
  it.each([
    ["ask-for-approval", "read_file", "read", "auto-approve"],
    ["ask-for-approval", "write_file", "write", "prompt"],
    ["approve-for-me", "read_file", "read", "auto-approve"],
    ["approve-for-me", "write_file", "write", "prompt"],
    ["full-access", "read_file", "read", "auto-approve"],
    ["full-access", "write_file", "write", "auto-approve"],
    ["custom", "read_file", "read", "auto-approve"],
    ["custom", "write_file", "write", "prompt"],
  ] as const)("routes %s for %s", (mode, name, risk, expected) => {
    expect(
      decideToolApproval({
        mode,
        toolCall: { name },
        risk,
      }),
    ).toBe(expected);
  });

  it("prompts for network access only in Ask for approval", () => {
    expect(
      decideToolApproval({
        mode: "ask-for-approval",
        toolCall: { name: "literature_search" },
        risk: "network",
      }),
    ).toBe("prompt");
    expect(
      decideToolApproval({
        mode: "approve-for-me",
        toolCall: { name: "literature_search" },
        risk: "network",
      }),
    ).toBe("auto-approve");
  });

  it("uses explicit project rules only in Custom mode", () => {
    const projectRules = { write_file: "allow" as const };
    expect(
      decideToolApproval({
        mode: "custom",
        toolCall: { name: "write_file" },
        risk: "write",
        projectRules,
      }),
    ).toBe("auto-approve");
    expect(
      decideToolApproval({
        mode: "ask-for-approval",
        toolCall: { name: "write_file" },
        risk: "write",
        projectRules,
      }),
    ).toBe("prompt");
  });

  it("returns deny-per-rules for an explicit Custom denial", () => {
    expect(
      decideToolApproval({
        mode: "custom",
        toolCall: { name: "read_file" },
        risk: "read",
        projectRules: { read_file: "deny" },
      }),
    ).toBe("deny-per-rules");
  });
});

describe("plan mode tool classification", () => {
  it("keeps only inspection tools", () => {
    for (const tool of [
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
    ]) {
      expect(isReadOnlyTool(tool), tool).toBe(true);
    }
  });

  it("treats every mutating, compiling, executing, delegating, or unknown tool as unavailable", () => {
    for (const tool of [
      "write_file",
      "replace_in_file",
      "create_file",
      "rename_file",
      "delete_file",
      "set_main_doc",
      "insert_figure",
      "preview_figure",
      "compile",
      "run_command",
      "computer_use",
      "toggle_theme",
      "remember_note",
      "forget_note",
      "spawn_agent",
      "send_message",
      "followup_task",
      "wait_agent",
      "interrupt_agent",
      "close_agent",
      "git_commit",
      "mcp__papers__search_papers",
      "brand_new_tool",
    ]) {
      expect(isReadOnlyTool(tool), tool).toBe(false);
    }
  });

  it("filters a tool set down to the read-only tools", () => {
    const filtered = planModeTools({
      read_file: { description: "read" },
      write_file: { description: "write" },
      compile: { description: "compile" },
      run_command: { description: "shell" },
      update_todos: { description: "plan" },
      mcp__papers__search_papers: { description: "mcp" },
    });
    expect(Object.keys(filtered)).toEqual(["read_file", "update_todos"]);
  });

  it("exposes the gate error the execution layer returns", () => {
    expect(PLAN_MODE_TOOL_ERROR).toBe(
      "Plan mode: this tool is unavailable until the plan is approved.",
    );
  });
});
