// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser-window", () => ({ toggleBrowser: vi.fn(), launchBrowser: vi.fn() }));

import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { SidebarViews } from "@/components/layout/WorkspaceControls";
import { useCollabRail } from "@/components/collab/collab-rail";
import { useCommentsRail } from "@/components/collab/comments-rail";
import { registerRailTabs } from "@/contributions/tabs";
import { ThemeProvider } from "@/lib/theme";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

registerRailTabs();

function renderRail() {
  return render(
    <ThemeProvider>
      <SidebarViews />
    </ThemeProvider>,
  );
}

function railOrder(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-tour^='rail-']")].map((element) => element.getAttribute("data-tour") ?? "");
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  useSettingsStore.setState({ showTree: false, railTab: "files" });
  useFilesStore.setState({ projectId: "grant" });
  useCollabRail.setState({ visible: true, unread: false });
  useCommentsRail.setState({ visible: false, unread: false });
});

afterEach(() => {
  useFilesStore.setState({ projectId: null });
  useCollabRail.setState({ visible: false, unread: false });
  useCommentsRail.setState({ visible: false, unread: false });
});

describe("Comments rail tab", () => {
  it("appears next to Live collaboration once comments are allowed", () => {
    const { container } = renderRail();
    expect(railOrder(container)).not.toContain("rail-comments");
    act(() => useCommentsRail.setState({ visible: true }));
    const order = railOrder(container);
    expect(order[order.indexOf("rail-collab") + 1]).toBe("rail-comments");
    const button = screen.getByRole("button", { name: enCollab.comments.title });
    expect(button.querySelector("svg.lucide-message-square")).toBeInTheDocument();
  });

  it("shows the same dot as Live collaboration for unseen comments", () => {
    useCommentsRail.setState({ visible: true });
    renderRail();
    act(() => useCommentsRail.setState({ unread: true }));
    const button = screen.getByRole("button", { name: enCollab.comments.titleUnread });
    const dot = button.querySelector("[data-testid='comments-rail-dot']") as HTMLElement;
    expect(dot.querySelector(".motion-safe\\:animate-ping")).toHaveClass("bg-primary", "rounded-full");
    expect(dot.outerHTML).not.toMatch(/\bring\b|ring-|outline|shadow/);
  });

  it("opens the tab and leaves it when comments are turned off", () => {
    useCommentsRail.setState({ visible: true });
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: enCollab.comments.title }));
    expect(useSettingsStore.getState()).toMatchObject({ railTab: "comments", showTree: true });
    act(() => useCommentsRail.setState({ visible: false }));
    expect(screen.queryByRole("button", { name: enCollab.comments.title })).not.toBeInTheDocument();
    expect(useSettingsStore.getState().railTab).toBe("files");
  });
});
