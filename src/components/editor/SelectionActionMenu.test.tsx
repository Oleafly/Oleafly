// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };

const controller = vi.hoisted(() => ({ getEditorView: vi.fn<() => unknown>(() => null) }));
const session = vi.hoisted(() => ({ openInlineEditWithInstruction: vi.fn(() => true) }));
const handoff = vi.hoisted(() => ({ handoffToAssistant: vi.fn() }));
const providerConfig = vi.hoisted(() => ({ current: null as unknown }));
const usage = vi.hoisted(() => ({ recordSavedInstructionUse: vi.fn(async (_ids: readonly string[]) => {}) }));
const snippets = vi.hoisted(() => ({ fieldSelected: false }));

vi.mock("@oleafly/editor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oleafly/editor")>()),
  snippetFieldSelected: () => snippets.fieldSelected,
}));

vi.mock("@/components/editor/cm/controller", () => controller);
vi.mock("@/components/editor/cm/inline-ai/openSession", () => session);
vi.mock("@/features/assistant-handoff", () => handoff);
vi.mock("@/features/saved-instructions", () => usage);
vi.mock("@/hooks/use-provider-config", () => ({
  useProviderConfig: () => ({ config: providerConfig.current, failed: false }),
}));

import { useInlineEditStore } from "@/store/inlineEdit";
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
    scrollDOM: { getBoundingClientRect: () => ({ top: 30, bottom: 600, left: 0, right: 800 }) },
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
    snippets.fieldSelected = false;
    providerConfig.current = null;
    useInlineEditStore.setState({ picked: [] });
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

  it("stays hidden while the selection is a snippet field waiting to be typed over", () => {
    snippets.fieldSelected = true;
    expect(showPill()).toBeNull();
    snippets.fieldSelected = false;
    act(() => {
      window.dispatchEvent(new Event("mouseup"));
    });
    expect(screen.getByText(actions.askAi)).toBeTruthy();
  });

  it("places the pill above the selection, or below it on the editor's first line", () => {
    sized(90, 24);
    expect(showPill()).toHaveStyle({ top: "84px", left: "40px" });
    cleanup();

    controller.getEditorView.mockReturnValue(editorView({ coordsAtPos: () => ({ top: 34, left: 40, bottom: 50, right: 90 }) }));
    expect(showPill()).toHaveStyle({ top: "62px", left: "40px" });
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

  describe("saved instructions", () => {
    const saved = en.savedInstructions;
    const keep = { id: "keep", name: "Keep formatting", text: "Keep the formatting." };
    const quotes = { id: "quotes", name: "Quotes", text: "Don't change quoted text." };

    beforeEach(() => {
      providerConfig.current = {
        ai_saved_instructions: [keep, quotes],
        ai_saved_instruction_uses: { quotes: 3 },
      };
    });

    it("shows nothing extra when none are saved", () => {
      providerConfig.current = null;
      openMenu();
      expect(screen.queryByRole("group", { name: saved.label })).not.toBeInTheDocument();
    });

    it("lists them most used first and toggles one without closing the menu", () => {
      openMenu();
      const group = screen.getByRole("group", { name: saved.label });
      const names = [...group.querySelectorAll("button")].map((button) => button.textContent);
      expect(names).toEqual(["Quotes", "Keep formatting"]);

      const chip = screen.getByRole("button", { name: "Keep formatting" });
      expect(fireEvent.mouseDown(chip)).toBe(false);
      fireEvent.click(chip);

      expect(useInlineEditStore.getState().picked).toEqual(["keep"]);
      expect(screen.getByRole("button", { name: "Keep formatting" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(actions.paraphrase)).toBeInTheDocument();
      expect(session.openInlineEditWithInstruction).not.toHaveBeenCalled();
    });

    it("runs the picked instructions alone from the submit button", () => {
      useInlineEditStore.setState({ picked: ["keep"] });
      openMenu();
      const submit = screen.getByRole("button", { name: en.inlineAi.submit });
      expect(submit).toBeEnabled();
      fireEvent.click(submit);
      expect(session.openInlineEditWithInstruction).toHaveBeenCalledWith(controller.getEditorView(), "");
      expect(usage.recordSavedInstructionUse).not.toHaveBeenCalled();
    });

    it("hands the picked instructions to the assistant and counts them there", () => {
      session.openInlineEditWithInstruction.mockReturnValue(false);
      useInlineEditStore.setState({ picked: ["quotes", "keep"] });
      openMenu();

      fireEvent.click(screen.getByText(actions.improveWriting));

      const [prompt] = handoff.handoffToAssistant.mock.calls[0];
      expect(prompt).toBe(
        "Instruction: Improve the clarity, tone, and flow of the following text\n\nAlso follow these instructions:\n- Keep the formatting.\n- Don't change quoted text.\n\nText:\n\nselected",
      );
      expect(usage.recordSavedInstructionUse).toHaveBeenCalledWith(["keep", "quotes"]);
    });
  });
});
