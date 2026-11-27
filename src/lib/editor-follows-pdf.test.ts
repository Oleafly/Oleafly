// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pdfPointAt: vi.fn(),
  inverseFromClick: vi.fn(async () => {}),
}));

vi.mock("@oleafly/preview", () => ({ pdfPointAt: mocks.pdfPointAt }));
vi.mock("@/features/synctex", () => ({ inverseFromClick: mocks.inverseFromClick }));

import { startEditorFollowsPdf } from "./editor-follows-pdf";
import { useFilesStore } from "@/store/files";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { useSettingsStore } from "@/store/settings";

let page = 2;
let stop: () => void = () => {};
let scroller: HTMLElement;
let shown = true;

function box(width: number, height: number): DOMRect {
  return { left: 0, top: 100, width, height, right: width, bottom: 100 + height, x: 0, y: 100, toJSON: () => ({}) };
}

function view(viewMode: "editor" | "split" | "pdf") {
  useSettingsStore.setState({ viewMode });
}

beforeEach(async () => {
  page = 2;
  shown = true;
  scroller = document.createElement("div");
  scroller.dataset.pdfScrollRoot = "";
  scroller.getBoundingClientRect = () => (shown ? box(800, 600) : box(0, 0));
  document.body.append(scroller);
  mocks.pdfPointAt.mockImplementation((x: number, y: number) => ({ page, x, y, fraction: y > 101 ? 0.5 : 0.1 }));
  mocks.inverseFromClick.mockClear();
  useFilesStore.setState({ projectId: "p1" });
  usePreviewDetachedStore.setState({ projectId: null });
  stop = startEditorFollowsPdf();
  await vi.dynamicImportSettled();
  useSettingsStore.setState({ viewMode: "split", workspaceHidden: false });
});

afterEach(() => {
  stop();
  scroller.remove();
  vi.useRealTimers();
});

describe("the editor after the PDF view", () => {
  it("goes to the part of the document the PDF was scrolled to", () => {
    view("pdf");
    page = 5;
    view("split");
    expect(mocks.inverseFromClick).toHaveBeenCalledWith(5, 400, 400);
  });

  it("stays where it was when the PDF was not scrolled away", () => {
    view("pdf");
    view("editor");
    expect(mocks.inverseFromClick).not.toHaveBeenCalled();
  });

  it("remembers the PDF place once the PDF is on screen when it was hidden while the editor closed", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    view("editor");
    shown = false;
    view("pdf");
    shown = true;
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
    page = 4;
    view("split");
    expect(mocks.inverseFromClick).toHaveBeenCalledWith(4, 400, 400);
  });

  it("does nothing for a detached preview, another project or the AI only view", () => {
    usePreviewDetachedStore.setState({ projectId: "p1" });
    view("pdf");
    page = 6;
    view("split");
    usePreviewDetachedStore.setState({ projectId: null });

    view("pdf");
    useFilesStore.setState({ projectId: "p2" });
    useSettingsStore.setState({ viewMode: "pdf" });
    page = 8;
    view("split");

    useSettingsStore.setState({ workspaceHidden: true });
    page = 9;
    useSettingsStore.setState({ workspaceHidden: false });
    expect(mocks.inverseFromClick).toHaveBeenCalledTimes(1);
    expect(mocks.inverseFromClick).toHaveBeenLastCalledWith(9, 400, 400);
  });
});
