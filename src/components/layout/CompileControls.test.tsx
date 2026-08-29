// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";

import { CompileControls } from "./CompileControls";

describe("compile button focus", () => {
  beforeEach(() => {
    useFilesStore.setState({ engineLoaded: true });
    useCompileStore.setState({ status: "idle" });
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
});
