// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteCoauthorText, useCoauthorEdits } from "@/lib/live-file-mirror";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { AUTO_COMPILE_DEBOUNCE_MS, AutoCompileKeeper } from "./AutoCompileKeeper";

const recompile = vi.fn(async () => undefined);

function setText(content: string) {
  useFilesStore.setState((state) => ({
    files: { ...state.files, "main.tex": { ...state.files["main.tex"], content } },
  }));
}

function type(content: string) {
  act(() => setText(content));
}

function coauthorTypes(content: string) {
  act(() => {
    noteCoauthorText("p1", "main.tex", content);
    setText(content);
  });
}

async function wait(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  recompile.mockClear();
  useCoauthorEdits.setState({ projectId: null, path: null, text: null, at: null });
  useFilesStore.setState({
    projectId: "p1",
    activePath: "main.tex",
    engineLoaded: false,
    files: { "main.tex": { content: "a", dirty: false } },
  } as never);
  useCompileStore.setState({ autoCompile: true, status: "idle", recompile } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AutoCompileKeeper", () => {
  it("compiles once the author stops typing", async () => {
    render(<AutoCompileKeeper />);
    type("ab");
    await wait(AUTO_COMPILE_DEBOUNCE_MS - 1);
    expect(recompile).not.toHaveBeenCalled();
    await wait(1);
    expect(recompile).toHaveBeenCalledWith({ origin: "automatic" });
  });

  it("a coauthor's edit neither starts nor delays an automatic compile", async () => {
    render(<AutoCompileKeeper />);
    coauthorTypes("ab");
    await wait(AUTO_COMPILE_DEBOUNCE_MS * 2);
    expect(recompile).not.toHaveBeenCalled();

    type("abc");
    await wait(AUTO_COMPILE_DEBOUNCE_MS - 500);
    coauthorTypes("abcd");
    await wait(500);
    expect(recompile).toHaveBeenCalledTimes(1);

    coauthorTypes("abcde");
    await wait(AUTO_COMPILE_DEBOUNCE_MS * 2);
    expect(recompile).toHaveBeenCalledTimes(1);
    expect(useCoauthorEdits.getState()).toMatchObject({ projectId: "p1", path: "main.tex", text: "abcde" });
  });

  describe("in a Typst project with live preview", () => {
    const typst = { ...LATEX_ENGINE, id: "typst", source_format: "typst", typst_missing: null };

    function typstProject(activePath: string) {
      useFilesStore.setState({
        engine: typst,
        engineLoaded: true,
        mainDoc: "main.typ",
        activePath,
        openTabs: ["main.typ", "notes.md"],
        tree: [
          { path: "main.typ", is_dir: false },
          { path: "notes.md", is_dir: false },
        ],
        files: {
          "main.typ": { content: "= Main", dirty: false },
          "notes.md": { content: "# Notes", dirty: false },
        },
      } as never);
    }

    it("leaves the main document to the live preview but compiles a Markdown note as it is typed", async () => {
      typstProject("main.typ");
      useCompileStore.setState({ lastCompileCheckpoint: null, htmlOutput: null } as never);
      render(<AutoCompileKeeper />);
      act(() => useFilesStore.setState((state) => ({ files: { ...state.files, "main.typ": { content: "= Main!", dirty: true } } })));
      await wait(AUTO_COMPILE_DEBOUNCE_MS);
      expect(recompile).not.toHaveBeenCalled();

      act(() => useFilesStore.setState({ activePath: "notes.md" }));
      act(() => useFilesStore.setState((state) => ({ files: { ...state.files, "notes.md": { content: "# Notes!", dirty: true } } })));
      await wait(AUTO_COMPILE_DEBOUNCE_MS);
      expect(recompile).toHaveBeenCalledExactlyOnceWith({ origin: "automatic" });
    });

    it("asks the live preview for the main document again when the note's output is still on screen", async () => {
      typstProject("notes.md");
      useCompileStore.setState({ lastCompileCheckpoint: { mainDocument: "notes.md" }, htmlOutput: null } as never);
      render(<AutoCompileKeeper />);
      expect(recompile).not.toHaveBeenCalled();
      act(() => useFilesStore.setState({ activePath: "main.typ" }));
      expect(recompile).toHaveBeenCalledExactlyOnceWith({ origin: "automatic" });
    });
  });
});
