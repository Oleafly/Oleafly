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

function requestField(): HTMLInputElement {
  return screen.getByRole("textbox", { name: actions.customPrompt });
}

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

  it("offers no rewrite on a read-only view", () => {
    controller.getEditorView.mockReturnValue(editorView({}, true));
    const { container } = render(<SelectionActionMenu />);
    act(() => {
      window.dispatchEvent(new Event("mouseup"));
    });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(actions.askAi)).not.toBeInTheDocument();
  });

  it("never hands a rewrite to the assistant once the view turned read-only", () => {
    const seen: CustomEvent[] = [];
    const listener = (event: Event) => seen.push(event as CustomEvent);
    window.addEventListener("oleafly:ai-selection-action", listener);
    openMenu();
    controller.getEditorView.mockReturnValue(editorView({}, true));
    session.openInlineEditWithInstruction.mockReturnValue(false);

    fireEvent.click(screen.getByText(actions.improveWriting));

    expect(session.openInlineEditWithInstruction).not.toHaveBeenCalled();
    expect(handoff.handoffToAssistant).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
    expect(screen.queryByText(actions.improveWriting)).not.toBeInTheDocument();
    window.removeEventListener("oleafly:ai-selection-action", listener);
  });

  it("focuses the request field when the pill expands", () => {
    openMenu();

    expect(requestField()).toHaveFocus();
    expect(requestField()).toHaveAttribute("placeholder", actions.customPrompt);
    expect(screen.getByRole("button", { name: en.inlineAi.submit })).toBeDisabled();
  });

  it("runs a typed request inline like a preset", () => {
    const seen: CustomEvent[] = [];
    const listener = (event: Event) => seen.push(event as CustomEvent);
    window.addEventListener("oleafly:ai-selection-action", listener);
    openMenu();

    fireEvent.change(requestField(), { target: { value: "  Make it formal " } });
    fireEvent.keyDown(requestField(), { key: "Enter" });

    expect(session.openInlineEditWithInstruction).toHaveBeenCalledWith(controller.getEditorView(), "Make it formal");
    expect(seen[0].detail).toEqual({ prompt: "Make it formal:\n\nselected", target: "inline" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    window.removeEventListener("oleafly:ai-selection-action", listener);
  });

  it("sends a typed request from the button and hands it off when no inline session starts", () => {
    session.openInlineEditWithInstruction.mockReturnValue(false);
    openMenu();

    fireEvent.change(requestField(), { target: { value: "Translate to French" } });
    fireEvent.click(screen.getByRole("button", { name: en.inlineAi.submit }));

    expect(handoff.handoffToAssistant).toHaveBeenCalledWith("Translate to French:\n\nselected", { autoSend: true });
  });

  it("ignores Enter on an empty request or while an input method is composing", () => {
    openMenu();

    fireEvent.change(requestField(), { target: { value: "   " } });
    fireEvent.keyDown(requestField(), { key: "Enter" });
    fireEvent.change(requestField(), { target: { value: "Shorten" } });
    fireEvent.keyDown(requestField(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(requestField(), { key: "a" });

    expect(session.openInlineEditWithInstruction).not.toHaveBeenCalled();
    expect(requestField()).toHaveValue("Shorten");
  });

  it("stays open while the request field holds focus", () => {
    openMenu();
    controller.getEditorView.mockReturnValue(editorView({ hasFocus: false }));

    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(requestField()).toBeInTheDocument();

    act(() => {
      requestField().blur();
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps focus in the field when a preset is pressed", () => {
    openMenu();

    expect(fireEvent.mouseDown(screen.getByText(actions.paraphrase))).toBe(false);
    expect(fireEvent.mouseDown(requestField())).toBe(true);
  });

  it("collapses on Escape and hands focus back to the editor", () => {
    const view = editorView();
    controller.getEditorView.mockReturnValue(view);
    openMenu();
    fireEvent.change(requestField(), { target: { value: "Draft" } });

    fireEvent.keyDown(requestField(), { key: "Escape" });

    expect(screen.queryByText(actions.paraphrase)).not.toBeInTheDocument();
    expect(view.focus).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText(actions.askAi));
    expect(requestField()).toHaveValue("");
    expect(session.openInlineEditWithInstruction).not.toHaveBeenCalled();
  });
});
