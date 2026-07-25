// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { usePreflightStore } from "@/store/preflight";
import { PreflightPanel } from "./PreflightPanel";

const paper =
  "\\documentclass{article}\\section{Introduction}\\section{Methods}";
const resume =
  "\\documentclass{article}\\section{Experience}\\section{GitHub Projects}";

beforeEach(() => {
  usePreflightStore.getState().reset();
  useCompileStore.getState().reset();
  useFilesStore.setState({
    projectId: "project",
    mainDoc: "main.tex",
    activePath: "main.tex",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    files: { "main.tex": { content: paper, dirty: false } },
  });
});

describe("Preflight document suggestion checkpoint", () => {
  it("ignores edits and failed compile state, then refreshes on successful lastCompiledAt", async () => {
    render(<PreflightPanel />);
    const ats = screen.getByLabelText("Enable ATS readiness");
    expect(ats).toHaveAttribute("aria-checked", "false");

    // Editing the source alone intentionally does not make this large panel run
    // document detection on every keystroke.
    act(() => {
      useFilesStore.setState((state) => ({
        files: {
          ...state.files,
          "main.tex": { content: resume, dirty: true },
        },
      }));
    });
    // A failed compile changes status/log but must not publish a success
    // checkpoint, so the suggestion remains the prior paper suggestion.
    act(() => {
      useCompileStore.setState({ status: "error", log: "compile failed" });
      // Even an unrelated Preflight store update may re-render the panel; the
      // suggestion remains memoized until a success checkpoint changes.
      usePreflightStore.setState({ running: true });
    });
    expect(ats).toHaveAttribute("aria-checked", "false");

    act(() => {
      useCompileStore.setState({ status: "success", lastCompiledAt: 1 });
    });
    expect(await screen.findByLabelText("Enable ATS readiness")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
