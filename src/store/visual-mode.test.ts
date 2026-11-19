// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { getKindModes } from "@/lib/wysiwyg-mode";
import { useFilesStore } from "@/store/files";
import { fileMode, setActiveFileMode, useVisualModeStore } from "./visual-mode";

const store = useVisualModeStore;
const mode = (path: string | null) => fileMode(store.getState(), path);

beforeEach(() => {
  localStorage.clear();
  store.setState({ projectId: null, kinds: {}, files: {}, markdownSplitLayout: "split" });
});

it("gives each kind of file its own default, with data files opening as their table", () => {
  store.getState().loadProject("first");
  expect(mode("main.tex")).toBe("code");
  expect(mode("notes.md")).toBe("code");
  expect(mode("slides/talk/index.tsx")).toBe("code");
  expect(mode("data/results.csv")).toBe("visual");
  expect(mode("data/runs.TSV")).toBe("visual");
  expect(mode(null)).toBe("code");
});

it("keeps a mode to its own file and kind, and pins a file seen before the kind changed", () => {
  store.getState().loadProject("first");
  store.getState().remember("intro.md");
  store.getState().setMode("slides/talk/index.tsx", "both");
  store.getState().setMode("results.csv", "code");
  store.getState().setMode("notes.md", "visual");

  expect(mode("results.csv")).toBe("code");
  expect(mode("other.csv")).toBe("code");
  expect(mode("main.tex")).toBe("code");
  expect(mode("refs.bib")).toBe("code");
  expect(mode("draft.md")).toBe("visual");
  expect(mode("intro.md")).toBe("code");

  store.getState().setMode("slides/other/index.tsx", "visual");
  expect(mode("slides/talk/index.tsx")).toBe("both");
});

it("keeps file modes for the session, kind modes per project, and the arrangement per project", () => {
  store.getState().loadProject("first");
  store.getState().setMode("main.tex", "visual");
  store.getState().setMarkdownSplitLayout("stacked");
  store.getState().loadProject("second");
  expect(store.getState().markdownSplitLayout).toBe("split");
  expect(mode("main.tex")).toBe("code");
  store.getState().setMode("main.tex", "code");

  store.setState({ files: {} });
  store.getState().loadProject("first");
  expect(store.getState().markdownSplitLayout).toBe("stacked");
  expect(mode("chapter.tex")).toBe("visual");
  expect(getKindModes("first")).toEqual({ source: "visual" });
  expect(getKindModes("second")).toEqual({ source: "code" });
});

it("moves the old project-wide Visual and Both choices onto LaTeX and Markdown only", () => {
  localStorage.setItem("oleafly.wysiwyg.old", "1");
  localStorage.setItem("oleafly.markdown-split.old", "1");
  store.getState().loadProject("old");
  expect(mode("main.tex")).toBe("visual");
  expect(mode("notes.md")).toBe("both");
  expect(mode("refs.bib")).toBe("code");
  expect(mode("results.csv")).toBe("visual");
  expect(localStorage.getItem("oleafly.wysiwyg.old")).toBeNull();
  expect(localStorage.getItem("oleafly.markdown-split.old")).toBeNull();
  expect(getKindModes("old")).toEqual({ source: "visual", markdown: "both" });

  localStorage.setItem("oleafly.markdown-split.split-only", "1");
  expect(getKindModes("split-only")).toEqual({ source: "code", markdown: "both" });
  localStorage.setItem("oleafly.view-modes.broken", '{"source":"sideways","sheet":"code"}');
  expect(getKindModes("broken")).toEqual({ sheet: "code" });
  expect(getKindModes("fresh")).toEqual({});
});

it("changes the open file's mode from anywhere", () => {
  store.getState().loadProject("first");
  useFilesStore.setState({ activePath: "notes.md" });
  setActiveFileMode("visual");
  expect(mode("notes.md")).toBe("visual");
  useFilesStore.setState({ activePath: null });
  setActiveFileMode("code");
  expect(mode("notes.md")).toBe("visual");
});
