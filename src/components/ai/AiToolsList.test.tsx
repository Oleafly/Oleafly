// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { toolRisk, type ToolRisk } from "@oleafly/ai-tools";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import {
  AI_TOOLS,
  AI_TOOL_GROUPS,
  AiToolsGrid,
  AiToolsTable,
  aiToolGroupLabel,
  approvalLabel,
} from "./AiToolsList";

const RISKS: ToolRisk[] = ["read", "write", "shell", "network"];

describe("AI tool catalog", () => {
  it("resolves a description for every tool and a note where one is declared", () => {
    expect(AI_TOOLS.length).toBeGreaterThan(0);
    for (const tool of AI_TOOLS) {
      expect(tool.desc()).toBeTruthy();
      expect(AI_TOOL_GROUPS).toContain(tool.group);
      if (tool.note) expect(tool.note()).toBeTruthy();
    }
  });

  it("names every group", () => {
    const labels = AI_TOOL_GROUPS.map(aiToolGroupLabel);
    expect(labels).toEqual([
      enAi.tools.groups.files,
      enAi.tools.groups.buildAndPdf,
      enAi.tools.groups.research,
      enAi.tools.groups.figures,
      enAi.tools.groups.planAndMemory,
      enAi.tools.groups.skills,
      enAi.tools.groups.agents,
      enAi.tools.groups.system,
    ]);
  });

  it("names an approval rule for every risk level", () => {
    expect(RISKS.map(approvalLabel)).toEqual([
      enAi.tools.approval.never,
      enAi.tools.approval.unlessAllowed,
      enAi.tools.approval.everyTime,
      enAi.tools.approval.askModeOnly,
    ]);
  });
});

describe("AiToolsTable", () => {
  it("renders one section per group with each tool, its blurb, and its approval rule", () => {
    render(<AiToolsTable className="test-table" />);

    expect(screen.getByTestId("ai-tools-table")).toHaveClass("test-table");
    expect(
      screen.getByRole("columnheader", { name: enAi.tools.table.tool }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: enAi.tools.table.whatItDoes }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: enAi.tools.table.asksFirst }),
    ).toBeInTheDocument();

    for (const group of AI_TOOL_GROUPS) {
      const section = screen.getByTestId(`ai-tools-group-${group}`);
      expect(within(section).getByText(aiToolGroupLabel(group))).toBeInTheDocument();
      for (const tool of AI_TOOLS.filter((entry) => entry.group === group)) {
        const cell = within(section).getByText(tool.name);
        expect(cell).toBeInTheDocument();
        const row = cell.closest("tr");
        expect(row).not.toBeNull();
        if (!row) continue;
        expect(
          within(row).getByText(approvalLabel(toolRisk(tool.name))),
        ).toBeInTheDocument();
        if (tool.note) expect(within(row).getByText(tool.note())).toBeInTheDocument();
      }
    }
  });
});

describe("AiToolsGrid", () => {
  it("lists every tool name and description in one column", () => {
    const { container } = render(<AiToolsGrid columns={1} className="test-grid" />);

    const grid = container.firstElementChild;
    expect(grid).toHaveClass("test-grid", "grid-cols-1");
    for (const tool of AI_TOOLS) {
      expect(screen.getByText(tool.name)).toBeInTheDocument();
    }
  });

  it("defaults to a two column layout", () => {
    const { container } = render(<AiToolsGrid />);

    expect(container.firstElementChild).toHaveClass("sm:grid-cols-2");
  });
});
