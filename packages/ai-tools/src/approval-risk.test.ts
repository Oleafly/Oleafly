import { describe, expect, it } from "vitest";
import { riskRequiresConfirm, toolRisk } from "./approval-risk";

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
