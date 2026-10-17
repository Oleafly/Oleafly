// @vitest-environment jsdom
import { Profiler } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));

import { useFilesStore } from "@/store/files";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { LanguageServiceStatus } from "./LanguageServiceStatus";

const initialAnalysis = useProjectAnalysisStore.getState();

beforeEach(() => {
  useFilesStore.setState({ projectId: "project", activePath: "main.tex" });
  useProjectAnalysisStore.getState().setLanguageService({
    kind: "texlab",
    readiness: "setup_required",
    failure: null,
    reason: { key: "setupRequiredBeforeAnalysis" },
  });
});

afterEach(() => {
  cleanup();
  useProjectAnalysisStore.setState(initialAnalysis, true);
  useFilesStore.setState({ projectId: null, activePath: null });
});

describe("LanguageServiceStatus render cost", () => {
  it("does not re-render when a publish repeats the same status with a new reason object", () => {
    let commits = 0;
    render(
      <Profiler id="status" onRender={() => { commits += 1; }}>
        <LanguageServiceStatus />
      </Profiler>,
    );
    commits = 0;
    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({ reason: { key: "setupRequiredBeforeAnalysis" } });
      useProjectAnalysisStore.getState().setLanguageService({ reason: { key: "setupRequiredBeforeAnalysis" } });
    });
    expect(commits).toBe(0);
  });

  it("does not re-render when the active file changes between two non-bibliography files", () => {
    let commits = 0;
    render(
      <Profiler id="status" onRender={() => { commits += 1; }}>
        <LanguageServiceStatus />
      </Profiler>,
    );
    commits = 0;
    act(() => useFilesStore.setState({ activePath: "chapter.tex" }));
    expect(commits).toBe(0);
  });
});
