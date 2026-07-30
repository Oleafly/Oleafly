import { describe, expect, it } from "vitest";
import { commandAliasSearchText } from "@/lib/command-search";
import { TOOL_DEFINITIONS } from "@/lib/tool-catalog";

describe("command palette slash aliases", () => {
  it("indexes every tool alias with its leading slash", () => {
    for (const tool of TOOL_DEFINITIONS) {
      const searchText = commandAliasSearchText(tool.slash);
      for (const alias of tool.slash) {
        expect(searchText).toContain(`/${alias}`);
      }
    }
  });

  it("returns an empty search value when no aliases are registered", () => {
    expect(commandAliasSearchText(undefined)).toBe("");
  });
});
