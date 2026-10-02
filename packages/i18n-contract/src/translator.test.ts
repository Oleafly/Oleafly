import { describe, expect, it } from "vitest";
import { createTranslatorSlot, echoKey, type Translator } from "./translator";

describe("translator slot", () => {
  it("echoes keys until a translator is installed", () => {
    const slot = createTranslatorSlot<"a.b">();
    expect(slot.translate("a.b")).toBe("a.b");
    expect(echoKey("x.y")).toBe("x.y");
  });

  it("routes through the installed translator and resets on null", () => {
    const slot = createTranslatorSlot<"greeting">();
    const english: Translator<"greeting"> = (key, params) => `${key}:${params?.name ?? ""}`;
    slot.install(english);
    expect(slot.translate("greeting", { name: "Ada" })).toBe("greeting:Ada");
    slot.install(null);
    expect(slot.translate("greeting", { name: "Ada" })).toBe("greeting");
  });

  it("keeps slots independent", () => {
    const first = createTranslatorSlot<"k">();
    const second = createTranslatorSlot<"k">();
    first.install(() => "first");
    expect(first.translate("k")).toBe("first");
    expect(second.translate("k")).toBe("k");
  });
});
