// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { HotkeysModal } from "./HotkeysModal";

beforeEach(() => {
  useSettingsStore.setState({ hotkeysOpen: false });
  useFilesStore.setState({ activePath: "main.tex" });
});

describe("HotkeysModal render cost", () => {
  it("does not re-render while closed when the active file changes", () => {
    let commits = 0;
    render(
      <Profiler id="hotkeys" onRender={() => { commits += 1; }}>
        <HotkeysModal />
      </Profiler>,
    );
    commits = 0;
    act(() => useFilesStore.setState({ activePath: "chapter.tex" }));
    act(() => useFilesStore.setState({ activePath: "notes.md" }));
    expect(commits).toBe(0);
  });

  it("still filters shortcuts for the active file once opened", () => {
    useFilesStore.setState({ activePath: "notes.md" });
    render(<HotkeysModal />);
    act(() => useSettingsStore.setState({ hotkeysOpen: true }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
