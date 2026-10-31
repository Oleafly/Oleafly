import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createOverleafTools } from "./overleaf-tools";
import { createResearchTools } from "./research-tools";
import { createFigureTools, createOleaflyTools } from "./tools";

function stubHost<T>(): T {
  return new Proxy({}, { get: () => vi.fn() }) as T;
}

function knownTools(): Set<string> {
  const rust = readFileSync(join(process.cwd(), "src-tauri/src/approvals.rs"), "utf8");
  const block = rust.slice(rust.indexOf("const KNOWN_TOOLS"), rust.indexOf("const MCP_TOOL_PREFIX"));
  return new Set([...block.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]));
}

describe("the approval rules' list of tools", () => {
  it("names every tool the in-app chat can register", () => {
    const tools = {
      ...createOleaflyTools(stubHost(), {
        resolveExecCwd: async () => "",
        authorizeExec: async () => ({ approvalToken: "", runId: "" }),
        execCommand: async (_projectId, command) => ({
          command,
          output: "",
          exit_code: 0,
          status: "completed",
          truncated: false,
          timed_out: false,
        }),
      }),
      ...createFigureTools(stubHost()),
      ...createResearchTools(stubHost()),
      ...createOverleafTools(stubHost()),
    };
    const known = knownTools();

    expect(Object.keys(tools)).toContain("run_command");
    expect(Object.keys(tools)).not.toContain("computer_use");
    expect(known.size).toBeGreaterThan(0);
    expect(Object.keys(tools).filter((name) => !known.has(name))).toEqual([]);
  });
});
