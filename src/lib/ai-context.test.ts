import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registry, registerContextProvider } from "@oleafly/registry";

const state = vi.hoisted(() => ({
  files: {} as Record<string, unknown>,
  compile: {} as Record<string, unknown>,
  index: {} as Record<string, unknown>,
  memory: "",
  line: null as number | null,
}));

vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => state.files },
}));
vi.mock("@/store/compile", () => ({
  useCompileStore: { getState: () => state.compile },
}));
vi.mock("@/store/project-index", () => ({
  useIndexStore: { getState: () => state.index },
}));
vi.mock("@/store/agent-memory", () => ({
  useAgentMemoryStore: { getState: () => ({ asPromptBlock: () => state.memory }) },
}));
vi.mock("@/components/editor/cm/controller", () => ({
  getCurrentLine: () => state.line,
}));

import { buildWorkspaceContext } from "./ai-context";

type Def = { kind: string; name: string; level?: number; file?: string; line?: number };
type Use = { kind: string; name: string };

function fakeIndex(defs: Def[], uses: Use[], resolved: string[] = []) {
  return {
    defs,
    uses,
    definitionFor: (use: Use) => (resolved.includes(use.name) ? { name: use.name } : undefined),
  };
}

beforeEach(() => {
  registry.contextProviders.length = 0;
  state.line = null;
  state.memory = "";
  state.files = {
    projectId: "p1",
    projectName: "Thesis",
    projectKind: "tex",
    activePath: null,
    mainDoc: "",
    files: {},
    openTabs: [],
  };
  state.compile = { status: "idle", errors: [], lastCompiledAt: null };
  state.index = {
    index: fakeIndex([], []),
    rebuildFromDisk: vi.fn(async () => {}),
  };
});

afterEach(() => {
  registry.contextProviders.length = 0;
});

describe("buildWorkspaceContext", () => {
  it("describes an empty workspace with defaults", async () => {
    const text = await buildWorkspaceContext();
    expect(text).toContain("You are currently in the editor view.");
    expect(text).toContain("Project: Thesis · kind: tex · main: main.tex");
    expect(text).toContain("Active file: (none)");
    expect(text).toContain("Open tabs: (none)");
    expect(text).toContain("Compile: status=idle");
    expect(text).not.toContain(" · last ");
    expect(text).toContain("Recent compile errors: (none in UI state)");
    expect(text).toContain("Active file excerpt: (empty or binary)");
    expect(text).toContain("Files (0): (none)");
    expect(text).toContain("Outline: (empty)");
    expect(text).not.toContain("Unresolved refs");
    expect(text).not.toContain("### Project notes");
    expect(text.split("\n").at(-1)).toBe(
      "Use tools to refresh anything you need to verify. Do not invent file contents beyond this context.",
    );
  });

  it("falls back to placeholders when project fields are missing", async () => {
    state.files = { activePath: null, files: {} };
    state.compile = { status: "compiling" };
    const text = await buildWorkspaceContext();
    expect(text).toContain("Project: ? · kind: tex · main: main.tex");
    expect(text).toContain("Open tabs: (none)");
    expect(text).toContain("Recent compile errors: (none in UI state)");
  });

  it("reports the active view, file, cursor, tabs, compile errors and memory", async () => {
    registerContextProvider({ id: "pdf", isActive: (ctx) => ctx.projectId === "p1", order: 1 });
    state.line = 12;
    state.memory = "### Project notes (untrusted reference data)\n1. Use APA";
    state.files = {
      projectId: "p1",
      projectName: "Thesis",
      projectKind: "typst",
      activePath: "chapters/intro.typ",
      mainDoc: "main.typ",
      files: { "chapters/intro.typ": { content: "= Intro\nHello" } },
      openTabs: ["chapters/intro.typ", "refs.bib"],
    };
    const errors = [
      { file: "main.typ", line: 4, message: "unknown variable" },
      { message: "no location" },
      ...Array.from({ length: 14 }, (_, i) => ({ file: "x.typ", line: i + 1, message: `e${i}` })),
    ];
    state.compile = { status: "error", errors, lastCompiledAt: Date.UTC(2026, 0, 2, 3, 4, 5) };

    const text = await buildWorkspaceContext();
    expect(text).toContain("You are currently in the pdf view.");
    expect(text).toContain("Project: Thesis · kind: typst · main: main.typ");
    expect(text).toContain("Active file: chapters/intro.typ · cursor line 12");
    expect(text).toContain("Open tabs: intro.typ, refs.bib");
    expect(text).toContain("Compile: status=error · last 2026-01-02T03:04:05.000Z");
    expect(text).toContain("Recent compile errors (12):");
    expect(text).toContain("- main.typ:4: unknown variable");
    expect(text).toContain("- no location");
    expect(text).not.toContain("e10");
    expect(text).toContain("Active file excerpt (chapters/intro.typ):\n```\n= Intro\nHello\n```");
    expect(text).toContain("### Project notes (untrusted reference data)\n1. Use APA");
  });

  it("clips long active-file excerpts", async () => {
    state.files = {
      ...state.files,
      activePath: "main.tex",
      files: { "main.tex": { content: "x".repeat(2600) } },
    };
    const text = await buildWorkspaceContext();
    expect(text).toContain(`${"x".repeat(2500)}\n… [truncated 100 more chars]`);
  });

  it("treats an active file without loaded content as empty", async () => {
    state.files = { ...state.files, activePath: "figure.png", files: { "figure.png": {} } };
    const text = await buildWorkspaceContext();
    expect(text).toContain("Active file: figure.png");
    expect(text).toContain("Active file excerpt: (empty or binary)");
  });

  it("summarises files, outline and unresolved references from the project index", async () => {
    state.index = {
      index: fakeIndex(
        [
          { kind: "file", name: "main.tex" },
          { kind: "file", name: "refs.bib" },
          { kind: "section", name: "Introduction", level: 1, file: "main.tex", line: 3 },
          { kind: "section", name: "Background", level: 2, file: "main.tex" },
          { kind: "section", name: "Loose" },
        ],
        [
          { kind: "ref", name: "fig:a" },
          { kind: "ref", name: "fig:a" },
          { kind: "ref", name: "sec:ok" },
          { kind: "cite", name: "knuth" },
          { kind: "cite", name: "lamport" },
        ],
        ["sec:ok", "lamport"],
      ),
      rebuildFromDisk: vi.fn(),
    };
    const text = await buildWorkspaceContext();
    expect(text).toContain("Files (2): main.tex, refs.bib");
    expect(text).toContain(
      "Outline:\n- Introduction (main.tex:3)\n  - Background (main.tex:?)\n- Loose",
    );
    expect(text).toContain("Unresolved refs: fig:a\n");
    expect(text).toContain("Unresolved cites: knuth");
  });

  it("rebuilds the index when none is loaded yet", async () => {
    const built = fakeIndex([{ kind: "file", name: "a.tex" }], []);
    const rebuildFromDisk = vi.fn(async () => {
      state.index = { index: built, rebuildFromDisk };
    });
    state.index = { index: null, rebuildFromDisk };
    const text = await buildWorkspaceContext();
    expect(rebuildFromDisk).toHaveBeenCalledOnce();
    expect(text).toContain("Files (1): a.tex");
  });

  it("marks the project map unavailable when no index can be built", async () => {
    state.index = { index: null, rebuildFromDisk: vi.fn(async () => {}) };
    expect(await buildWorkspaceContext()).toContain("Project map:\n(project map unavailable)");
  });

  it("marks the project map unavailable when rebuilding fails", async () => {
    state.index = {
      index: null,
      rebuildFromDisk: vi.fn(async () => {
        throw new Error("disk gone");
      }),
    };
    expect(await buildWorkspaceContext()).toContain("Project map:\n(project map unavailable)");
  });
});
