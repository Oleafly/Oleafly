import { afterEach, describe, expect, it, vi } from "vitest";
import { compilerLabel, wrappedModalFocus } from "./NewProjectDialog";
import { visibleFocusable } from "./modal-coordinator";
import type { TemplateInfo } from "./types";

const template = (document_engine: TemplateInfo["document_engine"], engine: string): TemplateInfo => ({
  id: "blank", name: "Blank", description: "", category: "Blank", document_engine, engine,
  ats_profile: null, default_color: null, license: null, has_preview: false, assets_ready: true,
});

describe("modal focus wrapping", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("wraps Tab at both boundaries without disturbing middle focus", () => {
    const first = {};
    const last = {};
    expect(wrappedModalFocus(last, first, last, false)).toBe("first");
    expect(wrappedModalFocus(first, first, last, true)).toBe("last");
    expect(wrappedModalFocus({}, first, last, false)).toBeNull();
  });

  it("excludes hidden controls from the focus cycle", () => {
    const visible = { hidden: false, closest: () => null } as unknown as HTMLElement;
    const hidden = { hidden: true, closest: () => null } as unknown as HTMLElement;
    expect(visibleFocusable([visible, hidden])).toEqual([visible]);
  });

  it("excludes controls inside CSS-hidden ancestors", () => {
    const parent = { hidden: false, closest: () => null, parentElement: null } as unknown as HTMLElement;
    const child = { hidden: false, closest: () => null, parentElement: parent } as unknown as HTMLElement;
    vi.stubGlobal("window", {
      getComputedStyle: (element: HTMLElement) => ({
        display: element === parent ? "none" : "block",
        visibility: "visible",
      }),
    });
    expect(visibleFocusable([child])).toEqual([]);
  });
});

describe("compilerLabel", () => {
  it("labels every engine honestly", () => {
    expect(compilerLabel(template("latex", "xetex"))).toBe("Tectonic");
    expect(compilerLabel(template("latex", "luatex"))).toBe("LuaLaTeX");
    expect(compilerLabel(template("typst", "typst"))).toBe("Typst");
    expect(compilerLabel(template("markdown", "markdown"))).toBe("Pandoc");
  });
});
