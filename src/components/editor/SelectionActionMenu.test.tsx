// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const controller = vi.hoisted(() => ({ getEditorView: vi.fn<() => unknown>(() => null) }));
const session = vi.hoisted(() => ({ openInlineEditWithInstruction: vi.fn(() => true) }));
const providerConfig = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/components/editor/cm/controller", () => controller);
vi.mock("@/components/collab/CollabSlots", () => ({ useCollabReady: () => true }));
vi.mock("@/components/collab/comments-rail", () => ({ useCommentsRail: () => true, requestComment: vi.fn() }));

import { loadNamespace } from "@/i18n";
beforeAll(() => loadNamespace("collab"));

import { SelectionActionMenu } from "./SelectionActionMenu";


function editorView(overrides: Record<string, unknown> = {}, readOnly = false) {
  return {
    hasFocus: true,
    focus: vi.fn(),
    state: {
      readOnly,
      selection: { main: { from: 2, to: 9, head: 9 } },
      sliceDoc: () => "selected",
    },
    coordsAtPos: () => ({ top: 120, left: 40, bottom: 136, right: 90 }),
    scrollDOM: { getBoundingClientRect: () => ({ top: 30, bottom: 600, left: 0, right: 800 }) },
    ...overrides,
  };
}


function sized(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(height);
}

function showPill() {
  const view = render(<SelectionActionMenu />);
  act(() => {
    window.dispatchEvent(new Event("mouseup"));
  });
  return view.container.firstElementChild as HTMLElement;
}

describe("SelectionActionMenu", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    providerConfig.current = null;
    controller.getEditorView.mockReturnValue(editorView());
    session.openInlineEditWithInstruction.mockReturnValue(true);
  });

  it("stays hidden until the editor has a non-empty selection", () => {
    controller.getEditorView.mockReturnValue(null);
    const { container } = render(<SelectionActionMenu />);
    act(() => {
      window.dispatchEvent(new Event("mouseup"));
    });
    expect(container).toBeEmptyDOMElement();

    controller.getEditorView.mockReturnValue(
      editorView({ state: { selection: { main: { from: 2, to: 2, head: 2 } }, sliceDoc: () => "" } }),
    );
    act(() => {
      window.dispatchEvent(new Event("mouseup"));
    });
    expect(container).toBeEmptyDOMElement();

    controller.getEditorView.mockReturnValue(editorView({ coordsAtPos: () => null }));
    act(() => {
      window.dispatchEvent(new Event("mouseup"));
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("places the pill above the selection, or below it on the editor's first line", () => {
    sized(90, 24);
    expect(showPill()).toHaveStyle({ top: "84px", left: "40px" });
    cleanup();

    controller.getEditorView.mockReturnValue(editorView({ coordsAtPos: () => ({ top: 34, left: 40, bottom: 50, right: 90 }) }));
    expect(showPill()).toHaveStyle({ top: "62px", left: "40px" });
  });
});
