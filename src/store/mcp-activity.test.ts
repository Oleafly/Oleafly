import { beforeEach, describe, expect, it } from "vitest";
import {
  formatMcpArgs,
  sanitizeMcpArgs,
  useMcpActivityStore,
} from "@/store/mcp-activity";

describe("MCP activity argument retention", () => {
  beforeEach(() => {
    useMcpActivityStore.setState({ logs: [], unread: 0 });
  });

  it("never retains file bodies or other bulk payloads", () => {
    const content = "secret manuscript ".repeat(100_000);
    const args = sanitizeMcpArgs({
      path: "main.tex",
      content,
      nested: { token: "must not be retained" },
    });

    expect(args).toEqual({
      path: "main.tex",
      content: `[omitted ${content.length} chars]`,
      nested: "[object]",
    });
    expect(JSON.stringify(args)).not.toContain("secret manuscript");
  });

  it("stores only the bounded summary for a running call", () => {
    const content = "x".repeat(16 * 1024 * 1024);
    useMcpActivityStore.getState().beginCall("write_file", {
      path: "main.tex",
      content,
    });

    const retained = useMcpActivityStore.getState().logs[0].args;
    expect(retained).toEqual({
      path: "main.tex",
      content: `[omitted ${content.length} chars]`,
    });
    expect(formatMcpArgs(retained).length).toBeLessThanOrEqual(120);
  });
});
