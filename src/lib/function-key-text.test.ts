// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFunctionKeyTextGuard } from "./function-key-text";

const LEFT_ARROW = "";
const RIGHT_ARROW = "";
const APPLE_LOGO = "";

let uninstall: () => void = () => {};
let field: HTMLInputElement;

beforeEach(() => {
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

describe("function key text guard", () => {
  it("refuses the characters macOS gives arrow keys at the edge of a field", () => {
    expect(typed("beforeinput", LEFT_ARROW)).toBe(true);
    expect(typed("beforeinput", RIGHT_ARROW)).toBe(true);
    expect(typed("beforeinput", `${LEFT_ARROW}${LEFT_ARROW}`)).toBe(true);
    expect(typed("textInput", RIGHT_ARROW)).toBe(true);
    expect(typed("beforeinput", RIGHT_ARROW, "insertCompositionText")).toBe(true);
  });

  it("lets real text through, private-use characters included", () => {
    expect(typed("beforeinput", "a")).toBe(false);
    expect(typed("beforeinput", APPLE_LOGO)).toBe(false);
    expect(typed("beforeinput", `name${RIGHT_ARROW}`)).toBe(false);
    expect(typed("beforeinput", null, "insertFromPaste")).toBe(false);
    expect(typed("beforeinput", LEFT_ARROW, "deleteContentBackward")).toBe(false);
  });

  it("stops guarding once removed", () => {
    uninstall();
    expect(typed("beforeinput", LEFT_ARROW)).toBe(false);
  });
});
