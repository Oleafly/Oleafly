import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectIntelligenceSnapshot } from "@/lib/project-intelligence/types";

const mocks = vi.hoisted(() => ({
  getEditorView: vi.fn<() => unknown>(() => null),
  currentSourceProjectIntelligence: vi.fn<(text: string) => unknown>(() => null),
}));

vi.mock("@/components/editor/cm/controller", () => ({ getEditorView: mocks.getEditorView }));
vi.mock("@/lib/project-intelligence/current", () => ({
  currentSourceProjectIntelligence: mocks.currentSourceProjectIntelligence,
}));

import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { projectItems } from "./project-items";

const files = useFilesStore.getState();
const index = useIndexStore.getState();

function definition(kind: string, name: string, file = "main.tex") {
  return { id: `${kind}:${name}:${file}`, kind, name, location: { file, range: { from: 0, to: 1 } } };
}

function snapshot(names: [string, string, string?][], keys: string[] = []): ProjectIntelligenceSnapshot {
  return {
    definitions: names.map(([kind, name, file]) => definition(kind, name, file)),
    bibliography: { entries: keys.map((key) => ({ key })) },
  } as unknown as ProjectIntelligenceSnapshot;
}

function retain(data: ProjectIntelligenceSnapshot | null, projectId = "paper"): void {
  useIndexStore.setState({
    intelligenceState: { ...index.intelligenceState, identity: { projectId } as never, data },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  useFilesStore.setState({
    projectId: "paper",
    files: {},
    tree: [
      { path: "figures", is_dir: true },
      { path: "figures/map.png", is_dir: false },
      { path: "figures/plot.pdf", is_dir: false },
      { path: "main.tex", is_dir: false },
      { path: "refs.bib", is_dir: false },
    ],
  });
  retain(null);
});

afterEach(() => {
  useFilesStore.setState(files, true);
  useIndexStore.setState(index, true);
});

describe("project items for snippet fields", () => {
  it("offers labels and anchors once each, from the editor's current analysis first", () => {
    mocks.getEditorView.mockReturnValue({ state: { doc: { toString: () => "\\label{eq:sum}" } } });
    mocks.currentSourceProjectIntelligence.mockReturnValue({
      path: "main.tex",
      snapshot: snapshot([
        ["label", "eq:sum"],
        ["section", "Intro"],
        ["anchor", "fig-map", "notes.typ"],
        ["label", "eq:sum", "other.tex"],
      ]),
    });
    retain(snapshot([["label", "stale"]]));
    const expected = [
      { label: "eq:sum", detail: "main.tex" },
      { label: "fig-map", detail: "notes.typ" },
    ];
    expect(projectItems("label")).toEqual(expected);
    expect(projectItems("ref")).toEqual(expected);
    expect(mocks.currentSourceProjectIntelligence).toHaveBeenCalledWith("\\label{eq:sum}");
  });

  it("falls back to the last analysis of this project while the editor text is ahead of it", () => {
    retain(snapshot([["label", "tab:results"]]));
    expect(projectItems("label", "new text")).toEqual([{ label: "tab:results", detail: "main.tex" }]);
    expect(mocks.currentSourceProjectIntelligence).toHaveBeenCalledWith("new text");
    retain(snapshot([["label", "elsewhere"]]), "another-project");
    expect(projectItems("label")).toEqual([]);
    expect(mocks.currentSourceProjectIntelligence).toHaveBeenCalledTimes(1);
  });

  it("offers citation keys from open .bib files and the project analysis, the way the editor does", () => {
    useFilesStore.setState({
      files: {
        "refs.bib": { content: "@article{knuth84,\n  title={TeX}\n}\n" },
        "main.tex": { content: "@article{notakey, title={x}}" },
      } as never,
    });
    expect(projectItems("cite")).toEqual([{ label: "knuth84" }]);
    retain(snapshot([], ["lamport94", "knuth84"]));
    expect(projectItems("cite")).toEqual([{ label: "knuth84" }, { label: "lamport94" }]);
  });

  it("offers images LaTeX can include, and every file", () => {
    expect(projectItems("image")).toEqual([{ label: "figures/map.png" }, { label: "figures/plot.pdf" }]);
    expect(projectItems("file")).toEqual([
      { label: "figures/map.png" },
      { label: "figures/plot.pdf" },
      { label: "main.tex" },
      { label: "refs.bib" },
    ]);
  });
});
