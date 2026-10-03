// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const engine = (variants: string[], source_format: "typst" | "latex" = "typst") => ({
  source_format,
  typst_options: {
    system_fonts: true,
    reproducible: false,
    variants,
    font_dirs: [],
    flags: [],
    output_formats: ["pdf"],
    pdf_standards: [],
  },
});

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("the chosen Typst variant", () => {
  it("is remembered per project on this computer", async () => {
    const { useTypstVariantStore } = await import("./typst-variant");
    useTypstVariantStore.getState().select("paper", "final");
    useTypstVariantStore.getState().select("thesis", "draft");
    useTypstVariantStore.getState().select("thesis", null);
    expect(JSON.parse(localStorage.getItem("oleafly.typstVariants") ?? "{}")).toEqual({ paper: "final" });
    vi.resetModules();
    const reloaded = await import("./typst-variant");
    expect(reloaded.useTypstVariantStore.getState().selections).toEqual({ paper: "final" });
  });

  it("only counts while the project still declares it", async () => {
    const { activeTypstVariant } = await import("./typst-variant");
    const selections = { paper: "final" };
    expect(activeTypstVariant("paper", engine(["draft", "final"]), selections)).toBe("final");
    expect(activeTypstVariant("paper", engine(["draft"]), selections)).toBeNull();
    expect(activeTypstVariant("paper", engine(["final"], "latex"), selections)).toBeNull();
    expect(activeTypstVariant("other", engine(["final"]), selections)).toBeNull();
    expect(activeTypstVariant(null, engine(["final"]), selections)).toBeNull();
  });

  it("ignores stored data it cannot read", async () => {
    localStorage.setItem("oleafly.typstVariants", "[1,2]");
    const first = await import("./typst-variant");
    expect(first.useTypstVariantStore.getState().selections).toEqual({});
    vi.resetModules();
    localStorage.setItem("oleafly.typstVariants", JSON.stringify({ paper: 3, thesis: "draft", empty: "" }));
    const second = await import("./typst-variant");
    expect(second.useTypstVariantStore.getState().selections).toEqual({ thesis: "draft" });
  });
});
