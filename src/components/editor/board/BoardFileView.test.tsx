// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { useFilesStore } from "@/store/files";

type Change = (elements: readonly { id: string; version: number }[], appState: Record<string, unknown>, files: Record<string, unknown>) => void;

const excalidraw = vi.hoisted(() => ({
  props: [] as Record<string, unknown>[],
  api: { updateScene: vi.fn(), addFiles: vi.fn(), getAppState: () => ({ viewBackgroundColor: "#fff", gridModeEnabled: false }) },
}));

vi.mock("@excalidraw/excalidraw/index.css", () => ({}));
vi.mock("@excalidraw/excalidraw", () => {
  const MainMenu = ({ children }: { children: ReactNode }) => <div data-testid="board-menu">{children}</div>;
  const item = (name: string) => () => <span>{name}</span>;
  MainMenu.DefaultItems = {
    SaveAsImage: item("SaveAsImage"),
    SearchMenu: item("SearchMenu"),
    Help: item("Help"),
    ClearCanvas: item("ClearCanvas"),
    ChangeCanvasBackground: item("ChangeCanvasBackground"),
  };
  MainMenu.Separator = () => <hr />;
  return {
    CaptureUpdateAction: { NEVER: "NEVER" },
    MainMenu,
    languages: [{ code: "en" }, { code: "de-DE" }],
    hashElementsVersion: (elements: readonly { version: number }[]) => elements.reduce((sum, element) => sum + element.version, 0),
    restoreElements: (elements: unknown[]) => elements,
    serializeAsJSON: (elements: unknown[], appState: { viewBackgroundColor?: string }) =>
      JSON.stringify({ type: "excalidraw", elements, appState: { viewBackgroundColor: appState.viewBackgroundColor } }),
    Excalidraw: (props: Record<string, unknown> & { excalidrawAPI: (api: unknown) => void; children: ReactNode }) => {
      excalidraw.props.push(props);
      props.excalidrawAPI(excalidraw.api);
      return <div data-testid="excalidraw">{props.children}</div>;
    },
  };
});

import { BoardFileView } from "./BoardFileView";

const PATH = "figures/sketch.excalidraw";
const DRAWING = JSON.stringify({ type: "excalidraw", elements: [{ id: "a", version: 1 }], appState: { viewBackgroundColor: "#fff" }, files: {} });
const VIEW = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, viewBackgroundColor: "#fff", gridModeEnabled: false, gridSize: 20, gridStep: 5 };

function latest() {
  return excalidraw.props.at(-1) as Record<string, unknown> & { onChange: Change };
}

function open(content: string | undefined) {
  const setContent = vi.fn(() => true);
  useFilesStore.setState({
    projectId: "p1",
    activePath: PATH,
    files: content === undefined ? {} : { [PATH]: { content, dirty: false, edits: 0 } },
    setContent,
  } as never);
  return setContent;
}

beforeEach(() => {
  vi.useFakeTimers();
  excalidraw.props = [];
  excalidraw.api.updateScene.mockReset();
  excalidraw.api.addFiles.mockReset();
});

afterEach(() => vi.useRealTimers());

describe("BoardFileView", () => {
  it("opens the drawing without writing it back, then saves a change once drawing pauses", () => {
    const setContent = open(DRAWING);
    render(<BoardFileView projectId="p1" path={PATH} />);
    const props = latest();
    expect(props.initialData).toEqual(expect.objectContaining({ elements: [{ id: "a", version: 1 }], scrollToContent: true }));
    expect(props).toEqual(expect.objectContaining({ aiEnabled: false, validateEmbeddable: false, viewModeEnabled: false, langCode: "en" }));
    expect(screen.getByTestId("board-menu")).not.toHaveTextContent("Socials");

    act(() => props.onChange([{ id: "a", version: 1 }], VIEW, {}));
    act(() => props.onChange([{ id: "a", version: 1 }], { ...VIEW, scrollX: 40 }, {}));
    act(() => vi.advanceTimersByTime(1000));
    expect(setContent).not.toHaveBeenCalled();

    act(() => latest().onChange([{ id: "a", version: 2 }], VIEW, {}));
    act(() => latest().onChange([{ id: "a", version: 3 }], VIEW, {}));
    act(() => vi.advanceTimersByTime(299));
    expect(setContent).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(setContent).toHaveBeenCalledTimes(1);
    expect(JSON.parse((setContent.mock.calls[0] as unknown as [string, string])[1]).elements).toEqual([{ id: "a", version: 3 }]);
  });

  it("saves a pending change at once when the board closes", () => {
    const setContent = open(DRAWING);
    const { unmount } = render(<BoardFileView projectId="p1" path={PATH} />);
    act(() => latest().onChange([{ id: "a", version: 1 }], VIEW, {}));
    act(() => latest().onChange([{ id: "a", version: 2 }], VIEW, {}));
    unmount();
    expect(setContent).toHaveBeenCalledTimes(1);
  });

  it("takes in a change made outside the board without adding it to undo", () => {
    open(DRAWING);
    render(<BoardFileView projectId="p1" path={PATH} />);
    const outside = JSON.stringify({
      type: "excalidraw",
      elements: [{ id: "b", version: 1 }],
      appState: { viewBackgroundColor: "#000" },
      files: { img: { id: "img" } },
    });
    act(() => useFilesStore.setState({ files: { [PATH]: { content: outside, dirty: false, edits: 1 } } } as never));
    expect(excalidraw.api.addFiles).toHaveBeenCalledWith([{ id: "img" }]);
    expect(excalidraw.api.updateScene).toHaveBeenCalledWith({
      elements: [{ id: "b", version: 1 }],
      appState: { viewBackgroundColor: "#000", gridModeEnabled: false },
      captureUpdate: "NEVER",
    });

    act(() => useFilesStore.setState({ files: { [PATH]: { content: "{broken", dirty: false, edits: 2 } } } as never));
    expect(excalidraw.api.updateScene).toHaveBeenCalledTimes(1);
  });

  it("reopens a board where it was left", () => {
    open(DRAWING);
    const { unmount } = render(<BoardFileView projectId="p1" path={PATH} />);
    act(() => latest().onChange([{ id: "a", version: 1 }], { ...VIEW, scrollX: 120, scrollY: -30, zoom: { value: 2 } }, {}));
    unmount();
    render(<BoardFileView projectId="p1" path={PATH} />);
    expect(latest().initialData).toEqual(
      expect.objectContaining({
        scrollToContent: false,
        appState: expect.objectContaining({ scrollX: 120, scrollY: -30, zoom: { value: 2 } }),
      }),
    );
  });

  it("shows a board it cannot read instead of replacing it", () => {
    const setContent = open("not json");
    render(<BoardFileView projectId="p1" path={PATH} />);
    expect(screen.getByText(en.board.unreadable)).toBeInTheDocument();
    expect(screen.queryByTestId("excalidraw")).toBeNull();
    expect(setContent).not.toHaveBeenCalled();
  });

  it("waits for the file to load, and opens an empty file as a blank board", () => {
    open(undefined);
    const { rerender } = render(<BoardFileView projectId="p1" path={PATH} />);
    expect(screen.queryByTestId("excalidraw")).toBeNull();
    act(() => useFilesStore.setState({ files: { [PATH]: { content: "", dirty: false, edits: 0 } } } as never));
    rerender(<BoardFileView projectId="p1" path={PATH} />);
    expect(screen.getByTestId("excalidraw")).toBeInTheDocument();
    expect(latest().initialData).toEqual(expect.objectContaining({ elements: [] }));
  });
});
