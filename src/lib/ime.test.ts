// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isImeEnter } from "./ime";

describe("isImeEnter", () => {
  it("treats a composing key event as IME input", () => {
    expect(isImeEnter(new KeyboardEvent("keydown", { key: "Enter", isComposing: true }))).toBe(true);
  });

  it("treats WebKit's keyCode 229 Enter as IME input even when isComposing is false", () => {
    const event = new KeyboardEvent("keydown", { key: "Enter" });
    Object.defineProperty(event, "keyCode", { value: 229 });
    expect(isImeEnter(event)).toBe(true);
  });

  it("reads React events through nativeEvent", () => {
    expect(
      isImeEnter({ key: "Enter", nativeEvent: { isComposing: false, keyCode: 229 } } as never),
    ).toBe(true);
  });

  it("lets a plain Enter through", () => {
    expect(isImeEnter(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(false);
  });
});
