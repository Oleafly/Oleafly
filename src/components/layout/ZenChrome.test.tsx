// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const host = vi.hoisted(() => ({
  fullscreen: false,
  isFullscreen: vi.fn(async () => host.fullscreen),
  reattach: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFullscreen: host.isFullscreen,
    onResized: async () => () => {},
  }),
}));
vi.mock("@/lib/preview-window", () => ({ reattachPreviewWindow: host.reattach }));
vi.mock("@/components/layout/WindowControls", () => ({
  WindowControls: ({ compact }: { compact?: boolean }) => (
    <div data-testid="window-controls" data-compact={String(Boolean(compact))} />
  ),
}));

import { LATEX_ENGINE } from "@/lib/document-engine";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useZenStore } from "@/store/zen";
import { ZenCompileCorner, ZenTitleStrip } from "./ZenChrome";

const copy = enShell.zen;
const compile = enShell.compile;

function beginZen(fullscreen: "none" | "entering" | "on" = "none") {
  useZenStore.getState().begin({
    projectId: "p1",
    snapshot: {
      showTree: true,
      railTab: "files",
      assistantOpen: false,
      workspaceHidden: false,
      viewMode: "editor",
      terminalOpen: false,
    },
    pdfVisibleAtStart: false,
    fullscreen,
  });
}

function movePointer(x: number, y: number) {
  act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y, bubbles: true }));
  });
}

beforeEach(() => {
  host.fullscreen = false;
  host.isFullscreen.mockClear();
  host.reattach.mockClear();
  useZenStore.getState().end();
  useFilesStore.setState({
    projectId: "p1",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    manifestHome: "app",
    mainDoc: "main.tex",
    tree: [{ path: "main.tex", is_dir: false }],
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useCompileStore.setState({
    status: "idle",
    recompile: vi.fn(async () => undefined),
  } as unknown as ReturnType<typeof useCompileStore.getState>);
  useSettingsStore.setState({ viewMode: "editor", zenShowPdfOnCompile: true });
});

describe("the strip along the top", () => {
  it("is a thin drag region that carries the window controls", async () => {
    beginZen();
    render(<ZenTitleStrip />);
    const strip = await screen.findByTestId("zen-title-strip");
    expect(strip).toHaveAttribute("data-tauri-drag-region");
    expect(screen.getByTestId("window-controls")).toHaveAttribute("data-compact", "true");
  });

  it("goes away while the window is full screen", async () => {
    host.fullscreen = true;
    beginZen();
    render(<ZenTitleStrip />);
    await act(async () => {});
    expect(screen.queryByTestId("zen-title-strip")).toBeNull();
  });

  it("stays out of the way while the window is going full screen", async () => {
    beginZen("entering");
    render(<ZenTitleStrip />);
    await act(async () => {});
    expect(screen.queryByTestId("zen-title-strip")).toBeNull();
  });

  it("comes back if the window leaves full screen by itself", async () => {
    beginZen("on");
    render(<ZenTitleStrip />);
    await act(async () => {});
    expect(screen.getByTestId("zen-title-strip")).toBeInTheDocument();
  });
});

describe("compile feedback in the corner", () => {
  it("shows nothing but a hidden compile button when idle", () => {
    beginZen();
    render(<ZenCompileCorner />);
    expect(screen.queryByTestId("zen-compile-pill")).toBeNull();
    expect(screen.getByTestId("zen-compile-button")).toHaveAttribute("data-visible", "false");
  });

  it("sits in the top right corner, below the window's title strip", () => {
    beginZen();
    render(<ZenCompileCorner />);
    const corner = screen.getByTestId("zen-compile-corner");
    expect(corner).toHaveClass("top-10", "right-4");
    expect(corner.className).not.toMatch(/bottom-/u);
  });

  it("stays hidden while the pointer is near the bottom right corner instead", () => {
    beginZen();
    render(<ZenCompileCorner />);
    movePointer(window.innerWidth - 20, window.innerHeight - 20);
    expect(screen.getByTestId("zen-compile-button")).toHaveAttribute("data-visible", "false");
  });

  it("reveals the compile button when the pointer is near the corner", () => {
    beginZen();
    render(<ZenCompileCorner />);
    movePointer(window.innerWidth - 20, 20);
    expect(screen.getByTestId("zen-compile-button")).toHaveAttribute("data-visible", "true");
    movePointer(window.innerWidth / 2, window.innerHeight / 2);
    expect(screen.getByTestId("zen-compile-button")).toHaveAttribute("data-visible", "false");
  });

  it("hides the compile button when the pointer leaves the window", () => {
    beginZen();
    render(<ZenCompileCorner />);
    movePointer(window.innerWidth - 5, 5);
    act(() => {
      document.documentElement.dispatchEvent(new MouseEvent("mouseleave"));
    });
    expect(screen.getByTestId("zen-compile-button")).toHaveAttribute("data-visible", "false");
  });

  it("reveals the compile button for keyboard focus too", async () => {
    beginZen();
    render(<ZenCompileCorner />);
    await userEvent.setup().tab();
    expect(screen.getByTestId("zen-compile-button")).toHaveFocus();
    expect(screen.getByTestId("zen-compile-button")).toHaveAttribute("data-visible", "true");
  });

  it("compiles with the existing compile action and opens the PDF", async () => {
    beginZen();
    const recompile = vi.fn(async () => undefined);
    useCompileStore.setState({ recompile } as unknown as ReturnType<typeof useCompileStore.getState>);
    render(<ZenCompileCorner />);
    movePointer(window.innerWidth - 10, 10);
    await userEvent.setup().click(screen.getByRole("button", { name: compile.compile }));
    expect(recompile).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState().viewMode).toBe("split");
  });

  it("offers Recompile once there is a result", () => {
    beginZen();
    useCompileStore.setState({ status: "success" });
    render(<ZenCompileCorner />);
    expect(screen.getByRole("button", { name: compile.recompile })).toBeInTheDocument();
  });

  it("shows one spinner pill and no compile button while any compile runs", () => {
    beginZen();
    useCompileStore.setState({ status: "compiling" });
    render(<ZenCompileCorner />);
    expect(screen.getAllByTestId("zen-compile-pill")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(copy.compiling);
    expect(screen.queryByTestId("zen-compile-button")).toBeNull();
  });

  it("keeps one indicator while the pointer is over the corner during a compile", () => {
    beginZen();
    useCompileStore.setState({ status: "compiling" });
    render(<ZenCompileCorner />);
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: window.innerWidth - 4, clientY: 4 }));
    });
    expect(screen.getAllByTestId("zen-compile-pill")).toHaveLength(1);
    expect(screen.queryByTestId("zen-compile-button")).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("brings the compile button back once the compile ends", () => {
    beginZen();
    useCompileStore.setState({ status: "compiling" });
    render(<ZenCompileCorner />);
    act(() => useCompileStore.setState({ status: "success" }));
    expect(screen.getByTestId("zen-compile-button")).toBeEnabled();
  });

  it("drops the pill after a compile succeeds", () => {
    beginZen();
    useCompileStore.setState({ status: "compiling" });
    render(<ZenCompileCorner />);
    act(() => useCompileStore.setState({ status: "success" }));
    expect(screen.queryByTestId("zen-compile-pill")).toBeNull();
  });

  it.each(["error", "unavailable"] as const)("keeps a pill after a compile ends as %s", (status) => {
    beginZen();
    useCompileStore.setState({ status });
    render(<ZenCompileCorner />);
    expect(screen.getByRole("button", { name: copy.compileFailed })).toBeInTheDocument();
  });

  it("opens the compile log from a failed pill and closes it again", async () => {
    beginZen();
    useCompileStore.setState({ status: "error" });
    render(<ZenCompileCorner />);
    const pill = screen.getByRole("button", { name: copy.compileFailed });
    expect(pill).toHaveAttribute("aria-pressed", "false");
    await userEvent.setup().click(pill);
    expect(useZenStore.getState().logsOpen).toBe(true);
    expect(useSettingsStore.getState().viewMode).toBe("split");
    expect(pill).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pill);
    expect(useZenStore.getState().logsOpen).toBe(false);
  });

  it("blocks the compile button when the opened folder has no main document", () => {
    beginZen();
    useFilesStore.setState({
      manifestHome: "folder",
      tree: [],
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<ZenCompileCorner />);
    expect(screen.getByTestId("zen-compile-button")).toBeDisabled();
  });

  it("waits for the engine before offering to compile", () => {
    beginZen();
    useFilesStore.setState({ engineLoaded: false } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<ZenCompileCorner />);
    expect(screen.getByTestId("zen-compile-button")).toBeDisabled();
  });
});
