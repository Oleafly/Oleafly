// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { railSections, railTabLabel, registry, type AppContext } from "@oleafly/registry";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  noteFacts: vi.fn(async () => []),
}));

import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { registerRailTabs } from "./tabs";

const project: AppContext = { projectId: "paper", projectKind: "latex", theme: "light" };
const saved = { files: useFilesStore.getState(), settings: useSettingsStore.getState() };

function notesTab() {
  const tab = registry.railTabs.find((entry) => entry.id === "notes");
  if (!tab) throw new Error("the Notes tab was not registered");
  return tab;
}

function shownIds(ctx: AppContext): string[] {
  return railSections(ctx).flat().map((tab) => tab.id);
}

beforeEach(() => {
  registry.railTabs.length = 0;
  registerRailTabs();
});

afterEach(() => {
  registry.railTabs.length = 0;
  useFilesStore.setState(saved.files, true);
  useSettingsStore.setState(saved.settings, true);
});

describe("the Notes rail tab", () => {
  it("sits right after Files in the explore section", () => {
    const tab = notesTab();
    expect(tab.section).toBe("explore");
    expect(railTabLabel(tab, project)).toBe(enShell.rail.notes);
    useSettingsStore.setState({ notes: true });
    const ids = shownIds(project);
    expect(ids.indexOf("notes")).toBe(ids.indexOf("files") + 1);
  });

  it("shows only while Notes is on, and never inside a note", () => {
    useSettingsStore.setState({ notes: false });
    expect(shownIds(project)).not.toContain("notes");
    useSettingsStore.setState({ notes: true });
    expect(shownIds(project)).toContain("notes");
    expect(shownIds({ ...project, projectKind: "note" })).not.toContain("notes");
  });

  it("loads the project's notes panel with its strings", async () => {
    useFilesStore.setState({ projectId: "paper", projects: [], tree: [] });
    const Panel = notesTab().panel;
    render(
      <Suspense fallback={null}>
        <Panel />
      </Suspense>,
    );
    expect(await screen.findByText(enNotes.projectNotes.mineEmpty)).toBeInTheDocument();
    expect(screen.getByText(enNotes.projectNotes.projectEmpty)).toBeInTheDocument();
  });
});
