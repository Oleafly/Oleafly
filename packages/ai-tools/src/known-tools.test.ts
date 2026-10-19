import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createOverleafTools } from "./overleaf-tools";
import { createResearchTools } from "./research-tools";
import { createFigureTools, createOleaflyTools } from "./tools";

// Every method a tool set reads from its host is a stub. The tools are only
// listed here, never run.
function stubHost<T>(): T {
  return new Proxy({}, { get: () => vi.fn() }) as T;
}

// Saving approvals.toml warns about a rule whose tool isn't on this list, so
// a tool missing from it would make a correct rule look like a typo.
function knownTools(): Set<string> {
  const rust = readFileSync(join(process.cwd(), "src-tauri/src/approvals.rs"), "utf8");
  const block = rust.slice(rust.indexOf("const KNOWN_TOOLS"), rust.indexOf("const MCP_TOOL_PREFIX"));
  return new Set([...block.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]));
}

describe("the approval rules' list of tools", () => {
  it("names every tool the in-app chat can register", () => {
    const tools = {
      // The optional run_command tool needs its options.
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
