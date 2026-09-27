// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
    minimize: () => Promise.resolve(),
    toggleMaximize: () => Promise.resolve(),
    close: () => Promise.resolve(),
  }),
}));

import { TopToolbar } from "./TopToolbar";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { ThemeProvider } from "@/lib/theme";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useFolderAccessStore } from "@/store/folder-access";
import { useSettingsStore } from "@/store/settings";

const CHARACTER = 7;
const ICON = 16;
const VIEWS = 180;
const HIDDEN = /(^|\s)(invisible|hidden|sr-only)(\s|$)/;

let windowWidth = 1400;

function contentWidth(node: Node): number {
  let total = 0;
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) total += (child.textContent ?? "").trim().length * CHARACTER;
    else if (child instanceof SVGElement) total += ICON;
    else if (child instanceof HTMLElement && !HIDDEN.test(child.className)) total += contentWidth(child);
  }
  return total;
}

function isToolbar(element: Element): boolean {
  return element.matches('[data-tour="project-toolbar"]');
}

function measuredWidth(element: Element): number {
  if (isToolbar(element)) return windowWidth;
  if (element.matches('[data-toolbar-part="views"]')) return VIEWS;
  if (element instanceof SVGElement) return ICON;
  return contentWidth(element);
}

function toolbarTree() {
  return (
    <ThemeProvider>
      <TopToolbar />
    </ThemeProvider>
  );
}

function renderToolbarAt(width: number) {
  windowWidth = width;
  const view = render(toolbarTree());
  const toolbar = () => {
    const header = view.container.querySelector('[data-tour="project-toolbar"]');
    if (!(header instanceof HTMLElement)) throw new Error("toolbar not rendered");
    return header;
  };
  const resize = (next: number) => {
    windowWidth = next;
    view.rerender(toolbarTree());
    return toolbar();
  };
  return { toolbar: toolbar(), resize };
}

function widths(from: number, to: number, step: number): number[] {
  const list: number[] = [];
  for (let width = from; width <= to; width += step) list.push(width);
  return list;
}

beforeEach(() => {
  document.documentElement.style.fontSize = "16px";
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return { width: measuredWidth(this) } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return isToolbar(this) ? windowWidth : 0;
  });
  useFilesStore.setState({
    projectId: "linked-a",
    projectName: "Cross-Modal Retrieval for Scientific Figures",
    projects: [],
    engineError: null,
    manifestHome: "device",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    loading: false,
    mainDoc: "paper/main.tex",
    activePath: null,
    files: {},
    tree: [
      { path: "paper/main.tex", is_dir: false },
      { path: "talk/slides.tex", is_dir: false },
    ],
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useCompileStore.setState({ status: "idle", lastCompileCheckpoint: null });
  useSettingsStore.setState({
    viewMode: "split",
    assistantOpen: false,
    workspaceHidden: false,
    webBrowser: true,
  });
  useFolderAccessStore.getState().reset("linked-a");
  useFolderAccessStore.setState({
    loaded: true,
    trust: { trusted: true, source: "folder", parent: null, repository: null },
  });
});

afterEach(() => {
  cleanup();
  useFolderAccessStore.getState().reset(null);
  document.documentElement.style.fontSize = "";
  vi.restoreAllMocks();
});

describe("TopToolbar for an opened folder", () => {
  it("settles on one layout at every width from narrow to wide and back", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const growing = widths(360, 2400, 160);
    const { resize } = renderToolbarAt(360);
    for (const width of [...growing, ...[...growing].reverse()]) {
      expect(resize(width).isConnected, `toolbar at ${width}px`).toBe(true);
    }
    const loops = errors.mock.calls.filter((call) => /Maximum update depth/.test(String(call[0])));
    expect(loops).toEqual([]);
  }, 20_000);

  it("drops the compile caption when narrow and keeps it when wide", () => {
    const { toolbar: narrow } = renderToolbarAt(480);
    expect(within(narrow).getByTestId("compile-button").querySelector('[data-toolbar-part="compile-label"]'))
      .toHaveAttribute("aria-hidden", "true");
    cleanup();
    const { toolbar: wide } = renderToolbarAt(2400);
    expect(within(wide).getByTestId("compile-button").querySelector('[data-toolbar-part="compile-label"]'))
      .not.toHaveAttribute("aria-hidden");
  });

  it("leaves the main document out of the toolbar", () => {
    renderToolbarAt(2400);
    expect(screen.queryByText(/paper\/main\.tex/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change the main document" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Other documents" })).not.toBeInTheDocument();
  });
});
