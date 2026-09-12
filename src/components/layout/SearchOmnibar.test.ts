import { describe, expect, it } from "vitest";
import type {
  AppContext,
  CommandContribution,
} from "@oleafly/registry";
import type { ProjectInfo } from "@/lib/tauri";
import { parse, projectMatches, slashAliasesFor } from "./SearchOmnibar";

const project: ProjectInfo = {
  id: "project-1",
  name: "Paper",
  main_doc: "main.tex",
  engine: "xetex",
  kind: "document",
  created_at: 1,
  updated_at: 2,
  color: "#123456",
  has_preview: true,
  exports: [],
  forked_from: null,
  recovery_pending: false,
};

describe("project omnibar metadata matching", () => {
  it("indexes the user-facing Tectonic engine label", () => {
    expect(projectMatches(project, "tectonic", false)).toBe(true);
    expect(projectMatches(project, "engine:tectonic", false)).toBe(true);
  });

  it("treats prototype and unknown field names as non-matches", () => {
    expect(projectMatches(project, "toString:x", false)).toBe(false);
    expect(projectMatches(project, "constructor:x", false)).toBe(false);
    expect(projectMatches(project, "__proto__:x", false)).toBe(false);
    expect(projectMatches(project, "author:x", false)).toBe(false);
  });
});

describe("registered slash commands", () => {
  it("exposes every alias from registered omnibar commands", () => {
    const ctx: AppContext = {
      projectId: null,
      projectKind: null,
      theme: "light",
    };
    const commands: CommandContribution[] = [
      {
        id: "tool.citations",
        surfaces: ["omnibar", "palette"],
        label: "Open Citation Search",
        slash: [
          "citations-search",
          "citation-search",
          "literature-search",
        ],
        order: 1,
        run: () => {},
      },
      {
        id: "tool.pdf",
        surfaces: ["omnibar", "palette"],
        label: "Open PDF to LaTeX",
        slash: ["pdf-to-latex"],
        order: 2,
        run: () => {},
      },
    ];

    expect(slashAliasesFor(commands, ctx)).toEqual([
      "citations-search",
      "citation-search",
      "literature-search",
      "pdf-to-latex",
    ]);
  });
});

describe("omnibar slash query parsing", () => {
  const entries = [{ keys: ["docs"], mode: "docs" as const, hint: "documents" }];

  it("leaves a non-slash query untouched", () => {
    expect(parse("plain text", [])).toEqual({ mode: "all", term: "plain text", cmd: "" });
  });

  it("splits the command from the term across spacing shapes", () => {
    expect(parse("/docs", entries).term).toBe("");
    expect(parse("/docs", entries).cmd).toBe("docs");
    expect(parse("/docs   ", entries).term).toBe("");
    expect(parse("/docs  alpha beta ", entries).term).toBe("alpha beta ");
    expect(parse("/DOCS one", entries).cmd).toBe("docs");
    expect(parse("/docs\tone\ttwo", entries).term).toBe("one\ttwo");
    expect(parse("/  leading", entries).cmd).toBe("");
    expect(parse("/docs\n\nrest", entries).term).toBe("rest");
  });

  it("stays linear on long whitespace runs", () => {
    const started = Date.now();
    expect(parse(`/docs${" ".repeat(200000)}`, entries).term).toBe("");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
