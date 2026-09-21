// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { useSettingsStore } from "@/store/settings";

import { CompileControls } from "./CompileControls";

describe("compile button focus", () => {
  beforeEach(() => {
    useFilesStore.setState({ projectId: "p1", engineLoaded: true });
    useCompileStore.setState({ status: "idle" });
    useSettingsStore.setState({ viewMode: "editor" });
    usePreviewDetachedStore.setState({ projectId: null });
  });

  it("keeps the caret where it was when Compile is pressed", () => {
    const recompile = vi.fn();
    useCompileStore.setState({ recompile });
    render(<CompileControls />);
    const button = screen.getByTestId("compile-button");

    const accepted = fireEvent.mouseDown(button);

    expect(accepted).toBe(false);
    expect(recompile).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(recompile).toHaveBeenCalledTimes(1);
  });

  it("keeps the editor layout when recompiling with a detached preview", () => {
    const recompile = vi.fn();
    useCompileStore.setState({ recompile });
    usePreviewDetachedStore.setState({ projectId: "p1" });
    render(<CompileControls />);
    fireEvent.click(screen.getByTestId("compile-button"));
    expect(recompile).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState().viewMode).toBe("editor");
    expect(usePreviewDetachedStore.getState().projectId).toBe("p1");
  });

  it("shows the attached preview when compiling from the editor", () => {
    useCompileStore.setState({ recompile: vi.fn() });
    render(<CompileControls />);
    fireEvent.click(screen.getByTestId("compile-button"));
    expect(useSettingsStore.getState().viewMode).toBe("split");
  });
});
