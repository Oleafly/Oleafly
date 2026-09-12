// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };

const controller = vi.hoisted(() => ({ getEditorView: vi.fn<() => unknown>(() => null) }));
const session = vi.hoisted(() => ({ openInlineEditWithInstruction: vi.fn(() => true) }));
const handoff = vi.hoisted(() => ({ handoffToAssistant: vi.fn() }));

vi.mock("@/components/editor/cm/controller", () => controller);
vi.mock("@/components/editor/cm/inline-ai/openSession", () => session);
vi.mock("@/features/assistant-handoff", () => handoff);

import { SelectionActionMenu } from "./SelectionActionMenu";

const actions = en.selectionActions;

function editorView(overrides: Record<string, unknown> = {}) {
  return {
    hasFocus: true,
    state: {
      selection: { main: { from: 2, to: 9, head: 9 } },
      sliceDoc: () => "selected",
    },
    coordsAtPos: () => ({ top: 120, left: 40, bottom: 136, right: 90 }),
    ...overrides,
  };
}

function openMenu() {
  render(<SelectionActionMenu />);
  act(() => {
    window.dispatchEvent(new Event("mouseup"));
  });
  fireEvent.click(screen.getByText(actions.askAi));
}

describe("SelectionActionMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("offers every rewrite once the pill is expanded", () => {
    openMenu();

    expect(screen.getByText(actions.paraphrase)).toBeInTheDocument();
    expect(screen.getByText(actions.improveWriting)).toBeInTheDocument();
    expect(screen.getByText(actions.fixGrammar)).toBeInTheDocument();
    expect(screen.getByText(actions.expand)).toBeInTheDocument();
    expect(screen.getByText(actions.findReferences)).toBeInTheDocument();
  });

  it("runs the rewrite inline and announces where it went", () => {
    const seen: CustomEvent[] = [];
    const listener = (event: Event) => seen.push(event as CustomEvent);
    window.addEventListener("oleafly:ai-selection-action", listener);
    openMenu();

    fireEvent.click(screen.getByText(actions.paraphrase));

    expect(session.openInlineEditWithInstruction).toHaveBeenCalledOnce();
    expect(handoff.handoffToAssistant).not.toHaveBeenCalled();
    expect(seen[0].detail.target).toBe("inline");
    expect(seen[0].detail.prompt).toContain("selected");
    expect(screen.queryByText(actions.paraphrase)).not.toBeInTheDocument();
    window.removeEventListener("oleafly:ai-selection-action", listener);
  });

  it("hands off to the assistant when no inline session can start", () => {
    session.openInlineEditWithInstruction.mockReturnValue(false);
    const seen: CustomEvent[] = [];
    const listener = (event: Event) => seen.push(event as CustomEvent);
    window.addEventListener("oleafly:ai-selection-action", listener);
    openMenu();

    fireEvent.click(screen.getByText(actions.expand));

    expect(handoff.handoffToAssistant).toHaveBeenCalledOnce();
    expect(seen[0].detail.target).toBe("agent");
    window.removeEventListener("oleafly:ai-selection-action", listener);
  });
});
