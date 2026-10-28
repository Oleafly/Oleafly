import { describe, expect, it } from "vitest";
import type { ComponentInfo } from "@/lib/tauri";
import { cjkCharacters, isTypstFontPackId, missingTypstFont, packForFamily } from "./typst-font-packs";

const pack = (over: Partial<ComponentInfo>): ComponentInfo => ({
  id: "typst-text",
  label: "Text",
  description: "",
  approx_bytes: 1,
  license: null,
  installed: false,
  kind: "typst-font",
  families: ["Liberation Sans", "TeX Gyre Termes"],
  ...over,
});

describe("typst font packs", () => {
  it("reads the family out of Typst's unknown font warning", () => {
    expect(missingTypstFont("unknown font family: liberation sans")).toBe("liberation sans");
    expect(missingTypstFont('unknown font family: "Noto Serif CJK SC"')).toBe("Noto Serif CJK SC");
    expect(missingTypstFont("unknown variable: x")).toBeNull();
    expect(missingTypstFont("  Unknown Font Family:   SimSun  ")).toBe("SimSun");
    expect(missingTypstFont('unknown font family: ""')).toBeNull();
    expect(missingTypstFont("unknown font family:")).toBeNull();
  });

  it("finds the Typst pack that carries a family, ignoring case", () => {
    const packs = [
      pack({}),
      pack({ id: "lato", kind: "font", families: ["Liberation Sans"] }),
      pack({ id: "typst-cjk", families: ["Noto Serif CJK SC"] }),
    ];
    expect(packForFamily(packs, "liberation sans")?.id).toBe("typst-text");
    expect(packForFamily(packs, "NOTO SERIF CJK SC")?.id).toBe("typst-cjk");
    expect(packForFamily(packs, "SimSun")).toBeUndefined();
    expect(packForFamily([pack({ id: "typst-unknown" })], "Liberation Sans")).toBeUndefined();
  });

  it("knows the shipped pack ids", () => {
    expect(isTypstFontPackId("typst-icons")).toBe(true);
    expect(isTypstFontPackId("lato")).toBe(false);
  });
});

describe("CJK text detection", () => {
  it("collects each Chinese, Japanese and Korean character once across sources", () => {
    expect(cjkCharacters(["= 你好 Hello", "#set text(lang: \"zh\")\n你们好"])).toBe("你好们");
    expect(cjkCharacters(["ひらがな カタカナ 한국어"])).toBe("ひらがなカタナ한국어");
    expect(cjkCharacters(["= Results\nThe café is open. Ünïcödé, Ελληνικά, кириллица."])).toBe("");
    expect(cjkCharacters([])).toBe("");
  });

  it("stops at the limit", () => {
    expect(cjkCharacters(["一二三四五六"], 3)).toBe("一二三");
    expect(Array.from(cjkCharacters([Array.from({ length: 100 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join("")]))).toHaveLength(32);
  });
});
