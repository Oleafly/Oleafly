// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { useReferencesStore } from "@/store/references";
import { ReferencesPanel } from "./ReferencesPanel";

vi.mock("@/lib/project-intelligence/navigation", () => ({
  navigateToProjectRange: vi.fn(),
}));

const sources = {
  "main.tex": String.raw`\section{Overview}\cite{smith2020}`,
  "refs.bib": "@article{smith2020, title={A title}, author={Smith}}",
};

function readySnapshot() {
  const files = Object.fromEntries(
    Object.entries(sources).map(([path, source]) => [
      path,
      analyzeProjectFile(path, source, 1),
    ]),
  );
  return assembleProjectIntelligence({
    identity: { projectId: "project", projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles: Object.keys(sources),
    mainDocument: "main.tex",
    stats: {
      fileCount: 2,
      characterCount: Object.values(sources).join("").length,
      parsedFileCount: 2,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
}

beforeEach(() => {
  const snapshot = readySnapshot();
  useFilesStore.setState({
    projectId: "project",
    projectName: "Paper",
    activePath: "main.tex",
    files: {
      "main.tex": { content: sources["main.tex"], dirty: false },
    },
  });
  useIndexStore.setState({
    intelligenceState: {
      status: "success",
      identity: snapshot.identity,
      data: snapshot,
      stale: false,
    },
  });
});

afterEach(() => {
  cleanup();
  useReferencesStore.getState().clear();
  useIndexStore.getState().reset();
  useFilesStore.setState({
    projectId: null,
    projectName: "",
    activePath: null,
    tree: [],
    files: {},
  });
});

describe("ReferencesPanel controls", () => {
  it("renders the view switch as the shared tab strip", () => {
    render(<ReferencesPanel />);

    const tablist = screen.getByRole("tablist", { name: "Reference panel view" });
    expect(tablist.className).toContain("rounded-lg");
    expect(tablist.className).toContain("bg-muted");
    expect(tablist.className).toContain("h-8");

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "References",
      "Citations, 1",
      expect.stringMatching(/^Symbols/u),
    ]);
    expect(
      screen.getByRole("tab", { name: "Citations, 1" }),
    ).toHaveAttribute("aria-selected", "true");
    for (const tab of tabs) {
      expect(tab.className).toContain("text-xs");
      expect(tab.className).toContain("focus-visible:ring-ring");
    }
  });

  it("switches the view from the shared tabs", async () => {
    const user = userEvent.setup();
    render(<ReferencesPanel />);

    expect(
      screen.getByRole("button", { name: "Import references" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Symbols/u }));

    expect(screen.getByRole("tab", { name: /^Symbols/u })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "Import references" }),
    ).toBeNull();
    expect(
      screen.getByRole("searchbox", { name: "Filter symbols" }),
    ).toBeInTheDocument();
  });

  it("renders the filter as the shared input", () => {
    render(<ReferencesPanel />);

    const filter = screen.getByRole("searchbox", { name: "Filter citations" });
    expect(filter).toHaveAttribute(
      "placeholder",
      "Filter keys, titles, authors…",
    );
    expect(filter.className).toContain("border-input");
    expect(filter.className).toContain("bg-background");
    expect(filter.className).toContain("rounded-md");
    expect(filter.className).toContain("focus-visible:ring-ring");
    expect(filter.className).toContain("h-8");
  });

  it("clears the filter from the inline button", async () => {
    const user = userEvent.setup();
    render(<ReferencesPanel />);

    const filter = screen.getByRole("searchbox", { name: "Filter citations" });
    expect(screen.queryByRole("button", { name: "Clear filter" })).toBeNull();

    await user.type(filter, "smith");
    expect(filter).toHaveValue("smith");

    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(filter).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear filter" })).toBeNull();
  });
});
