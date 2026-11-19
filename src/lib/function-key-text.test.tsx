// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { functionKeyTextInput, installFunctionKeyTextGuard } from "./function-key-text";

const LEFT_ARROW = "";
const RIGHT_ARROW = "";
const END = "";
const F5 = "";
const APPLE_LOGO = "";

let uninstall: () => void = () => {};
let field: HTMLInputElement;

beforeEach(() => {
  mocks.logError.mockReset();
  uninstall = installFunctionKeyTextGuard(window);
  field = document.createElement("input");
  document.body.append(field);
});

afterEach(() => {
  uninstall();
  field.remove();
});

function typed(type: "beforeinput" | "textInput", data: string | null, inputType = "insertText"): boolean {
  const event = new InputEvent(type, { data, inputType, bubbles: true, cancelable: true });
  field.dispatchEvent(event);
  return event.defaultPrevented;
}

function insertedPastBeforeInput(target: HTMLInputElement | HTMLTextAreaElement, value: string, caret: number, inputType = "insertText") {
  const owner = Object.getPrototypeOf(target) as object;
  Object.getOwnPropertyDescriptor(owner, "value")?.set?.call(target, value);
  target.setSelectionRange(caret, caret);
  target.dispatchEvent(new InputEvent("input", { data: null, inputType, bubbles: true }));
}

describe("function key text guard", () => {
  it("refuses the characters macOS gives arrow, End and F keys before they reach a field", () => {
    expect(typed("beforeinput", LEFT_ARROW)).toBe(true);
    expect(typed("beforeinput", RIGHT_ARROW)).toBe(true);
    expect(typed("beforeinput", END)).toBe(true);
    expect(typed("beforeinput", F5)).toBe(true);
    expect(typed("beforeinput", `${LEFT_ARROW}${LEFT_ARROW}`)).toBe(true);
    expect(typed("textInput", END)).toBe(true);
    expect(typed("beforeinput", RIGHT_ARROW, "insertCompositionText")).toBe(true);
  });

  it("lets real text through, the Apple logo included", () => {
    expect(typed("beforeinput", "a")).toBe(false);
    expect(typed("beforeinput", APPLE_LOGO)).toBe(false);
    expect(typed("beforeinput", `name${RIGHT_ARROW}`)).toBe(false);
    expect(typed("beforeinput", null, "insertFromPaste")).toBe(false);
    expect(typed("beforeinput", LEFT_ARROW, "deleteContentBackward")).toBe(false);
  });

  it("takes a function key character back out of a field it reached without beforeinput, keeping the caret", () => {
    field.value = "Say hello";
    insertedPastBeforeInput(field, `Say${END} hello`, 4);
    expect(field.value).toBe("Say hello");
    expect([field.selectionStart, field.selectionEnd]).toEqual([3, 3]);
    expect(mocks.logError).toHaveBeenCalledWith("function key text reached a field past beforeinput", "insertText");
  });

  it("cleans a textarea too and reports the stray path once per window", () => {
    const area = document.createElement("textarea");
    document.body.append(area);
    insertedPastBeforeInput(area, `one${END}`, 4);
    insertedPastBeforeInput(area, `one${F5}${APPLE_LOGO}`, 4);
    expect(area.value).toBe(`one${APPLE_LOGO}`);
    expect(area.selectionStart).toBe(3);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    area.remove();
  });

  it("waits for an input method to finish before cleaning the field", () => {
    const area = document.createElement("textarea");
    document.body.append(area);
    const owner = Object.getPrototypeOf(area) as object;
    Object.getOwnPropertyDescriptor(owner, "value")?.set?.call(area, `かな${END}`);
    area.dispatchEvent(new InputEvent("input", { data: `かな${END}`, inputType: "insertCompositionText", isComposing: true, bubbles: true }));
    expect(area.value).toBe(`かな${END}`);
    area.dispatchEvent(new CompositionEvent("compositionend", { data: `かな${END}`, bubbles: true }));
    expect(area.value).toBe("かな");
    expect(mocks.logError).toHaveBeenCalledWith("function key text reached a field past beforeinput", "compositionend");
    area.remove();
  });

  it("keeps a controlled React field in step with the cleaned text", () => {
    const seen: string[] = [];
    function Composer() {
      const [value, setValue] = useState("Say hello in five words.");
      return (
        <textarea
          data-testid="composer"
          value={value}
          onChange={(event) => {
            seen.push(event.target.value);
            setValue(event.target.value);
          }}
        />
      );
    }
    const { getByTestId } = render(<Composer />);
    const area = getByTestId("composer") as HTMLTextAreaElement;
    act(() => insertedPastBeforeInput(area, `Say hello in five words.${END}`, 25));
    expect(area.value).toBe("Say hello in five words.");
    expect(seen).toEqual([]);
    act(() => insertedPastBeforeInput(area, `Say hello in five words.!${END}`, 26));
    expect(area.value).toBe("Say hello in five words.!");
    expect(seen).toEqual(["Say hello in five words.!"]);
  });

  it("stops guarding once removed", () => {
    uninstall();
    expect(typed("beforeinput", LEFT_ARROW)).toBe(false);
    insertedPastBeforeInput(field, `x${END}`, 2);
    expect(field.value).toBe(`x${END}`);
  });
});

describe("CodeMirror function key input", () => {
  function editor(doc: string) {
    const view = new EditorView({ state: EditorState.create({ doc, extensions: [functionKeyTextInput] }), parent: document.body });
    const handle = (from: number, to: number, text: string) =>
      view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, text, () => view.state.update({ changes: { from, to, insert: text } })));
    return { view, handle };
  }

  it("drops a typed function key character and leaves other input to CodeMirror", () => {
    const { view, handle } = editor("\\section{}");
    expect(handle(10, 10, END)).toBe(true);
    expect(view.state.doc.toString()).toBe("\\section{}");
    expect(handle(9, 9, "a")).toBe(false);
    view.destroy();
  });

  it("types the rest of a mixed insertion without the function key character", () => {
    const { view, handle } = editor("ab");
    expect(handle(1, 1, `x${F5}y`)).toBe(true);
    expect(view.state.doc.toString()).toBe("axyb");
    expect(view.state.selection.main.head).toBe(3);
    view.destroy();
  });
});
