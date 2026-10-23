import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ResearchTaskApprovalDetails } from "@oleafly/ai-tools";
import type { ToolApprovalRequest } from "@/lib/ai-tools";
import { ToolConfirm } from "./ToolConfirm";

describe("ToolConfirm", () => {
  it("shows the exact command and working directory before approval", () => {
    const req = {
      tool: "run_command",
      summary: "$ pnpm test --filter ai-core",
      command: "pnpm test --filter ai-core",
      cwd: "/projects/paper-one",
    } as ToolApprovalRequest & { command: string; cwd: string };

    const html = renderToStaticMarkup(
      createElement(ToolConfirm, {
        req,
        onApprove: vi.fn(),
        onReject: vi.fn(),
      }),
    );

    expect(html).toContain("pnpm test --filter ai-core");
    expect(html).toContain("/projects/paper-one");
  });

  it("labels internet access separately from file edits", () => {
    const req = {
      tool: "literature_search",
      summary: "Search OpenAlex for approval policies",
    } as ToolApprovalRequest;

    const html = renderToStaticMarkup(
      createElement(ToolConfirm, {
        req,
        onApprove: vi.fn(),
        onReject: vi.fn(),
      }),
    );

    expect(html).toContain("The assistant wants to access the internet");
    expect(html).toContain('aria-label="Confirm internet access"');
  });

  it("shows MCP provenance and a redacted argument preview as an external action", () => {
    const req = {
      tool: "mcp__papers__7d28a7_search_papers",
      summary: "Use search_papers from the Papers MCP server",
      mcp: {
        server: "Papers",
        tool: "search_papers",
        argumentsPreview:
          '{\n  "query": "tool managers",\n  "apiToken": "[redacted]"\n}',
      },
    } as ToolApprovalRequest & {
      mcp: {
        server: string;
        tool: string;
        argumentsPreview: string;
      };
    };

    const html = renderToStaticMarkup(
      createElement(ToolConfirm, {
        req,
        onApprove: vi.fn(),
        onReject: vi.fn(),
      }),
    );

    expect(html).toContain("The assistant wants to use an external tool");
    expect(html).toContain("This sends the arguments below to the configured MCP server.");
    expect(html).toContain('aria-label="Confirm external tool action"');
    expect(html).toContain("MCP server");
    expect(html).toContain("Papers");
    expect(html).toContain("search_papers");
    expect(html).toContain("Arguments");
    expect(html).toContain("[redacted]");
    expect(html).not.toContain("change your files");
    expect(html).not.toContain("mcp__papers__7d28a7_search_papers");
  });

  it("shows what a research task will do before it is created", () => {
    const prompt = "Survey sparse attention papers.\nWrite findings to notes/survey.md.";
    const req = {
      tool: "research_task_create",
      summary: "Create the research task",
      researchTask: {
        title: "Sparse attention survey",
        prompt,
        goal: "A ranked reading list",
        skills: ["literature-review"],
        commands: "ask",
        network: true,
        reviewPlanFirst: true,
        timeBudgetMinutes: 90,
        start: false,
      },
    } as ToolApprovalRequest & { researchTask: ResearchTaskApprovalDetails };

    const html = renderToStaticMarkup(
      createElement(ToolConfirm, { req, onApprove: vi.fn(), onReject: vi.fn() }),
    );

    expect(html).toContain("The assistant wants to create a research task");
    expect(html).toContain('aria-label="Confirm research task"');
    expect(html).not.toContain("change your files");
    expect(html).toContain("Sparse attention survey");
    expect(html).toContain("Survey sparse attention papers.\nWrite findings to notes/survey.md.");
    expect(html).toContain("A ranked reading list");
    expect(html).toContain("literature-review");
    expect(html).toContain("Ask before each one");
    expect(html).toMatch(/Network<\/span><span[^>]*>On</);
    expect(html).toContain("90 minutes");
    expect(html).toMatch(/Plan first<\/span><span[^>]*>Yes</);
    expect(html).toMatch(/Start now<\/span><span[^>]*>No</);
  });

  it("says the time budget is the default when the agent set none", () => {
    const req = {
      tool: "research_task_create",
      summary: "Create the research task",
      researchTask: {
        title: "Quick check",
        prompt: "Check the bibliography.",
        goal: null,
        skills: [],
        commands: "ask",
        network: false,
        reviewPlanFirst: false,
        timeBudgetMinutes: null,
        start: true,
      },
    } as ToolApprovalRequest & { researchTask: ResearchTaskApprovalDetails };

    const html = renderToStaticMarkup(
      createElement(ToolConfirm, { req, onApprove: vi.fn(), onReject: vi.fn() }),
    );

    expect(html).toMatch(/Network<\/span><span[^>]*>Off</);
    expect(html).toMatch(/Time budget<\/span><span[^>]*>Default</);
    expect(html).not.toContain("Goal");
    expect(html).not.toContain("Skills");
  });
});
