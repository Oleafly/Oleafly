// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { SidebarViews } from "@/components/layout/WorkspaceControls";
import { useCollabRail } from "@/components/collab/collab-rail";
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
  useCollabRail.setState({ visible: false, unread: false });
});

afterEach(() => {
  useFilesStore.setState({ projectId: null });
  useCollabRail.setState({ visible: false, unread: false });
});

describe("Live collaboration rail tab", () => {
  it("is hidden until the open project is shared", () => {
    const { container } = renderRail();
    expect(railOrder(container)).not.toContain("rail-collab");
    act(() => useCollabRail.setState({ visible: true }));
    expect(screen.getByRole("button", { name: enCollab.pane.title })).toBeInTheDocument();
  });

  it("sits right before the beta research tab and shows the radio tower icon", () => {
    useCollabRail.setState({ visible: true });
    const { container } = renderRail();
    const order = railOrder(container);
    expect(order[order.indexOf("rail-research") - 1]).toBe("rail-collab");
    const button = screen.getByRole("button", { name: enCollab.pane.title });
    expect(button.querySelector("svg.lucide-radio-tower")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(enShell.rail.research) })).toBeInTheDocument();
  });

  it("pulses a filled dot for unread activity, says so to screen readers, and never uses a ring", () => {
    useCollabRail.setState({ visible: true, unread: true });
    renderRail();
    const button = screen.getByRole("button", { name: enCollab.pane.titleUnread });
    const dot = button.querySelector("[data-testid='collab-rail-dot']") as HTMLElement;
    expect(dot).toBeInTheDocument();
    const pulse = dot.querySelector(".motion-safe\\:animate-ping");
    expect(pulse).toHaveClass("bg-primary", "rounded-full");
    expect(dot.outerHTML).not.toMatch(/\bring\b|ring-|outline|shadow/);
    act(() => useCollabRail.setState({ unread: false }));
    expect(screen.getByRole("button", { name: enCollab.pane.title }).querySelector("[data-testid='collab-rail-dot']")).toBeNull();
  });

  it("opens the pane and a hidden sidebar, and leaves it when sharing goes away", () => {
    useCollabRail.setState({ visible: true });
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: enCollab.pane.title }));
    expect(useSettingsStore.getState()).toMatchObject({ railTab: "collab", showTree: true });
    act(() => useCollabRail.setState({ visible: false }));
    expect(useSettingsStore.getState().railTab).toBe("files");
  });
});
