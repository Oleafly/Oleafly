import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
});
