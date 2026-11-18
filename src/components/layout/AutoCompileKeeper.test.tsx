// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteCoauthorText, useCoauthorEdits } from "@/lib/live-file-mirror";
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
});
