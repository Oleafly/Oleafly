// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { VISUAL_APPEARANCE_FALLBACKS, VISUAL_SERIF_FONT } from "@oleafly/editor/visual/appearance";
import { useSettingsStore } from "@/store/settings";
import {
  VISUAL_APPEARANCE_DEFAULTS,
  VISUAL_APPEARANCE_KEYS,
  VISUAL_APPEARANCE_STORAGE_KEYS,
  clampVisualFontSize,
  isVisualAppearanceKey,
  normalizeVisualSetting,
  readVisualAppearance,
  type VisualAppearance,
} from "./visual-appearance";
import {
  VISUAL_MARKDOWN_ATTRIBUTE,
  VISUAL_TYPEFACE_STACKS,
  attachVisualAppearance,
  visualAppearanceStyle,
  visualHeadingFont,
  visualTextFont,
} from "./visual-appearance-style";

const defaults = (): VisualAppearance => ({ ...VISUAL_APPEARANCE_DEFAULTS });

afterEach(() => {
  for (const key of VISUAL_APPEARANCE_KEYS) {
    useSettingsStore.getState().setVisualAppearance(key, VISUAL_APPEARANCE_DEFAULTS[key]);
  }
  localStorage.clear();
});

describe("Visual mode appearance defaults", () => {
  it("give the look Visual mode had before the settings existed", () => {
    const { variables, attributes } = visualAppearanceStyle(defaults());
    const { "--visual-heading-font": headingFont, ...rest } = variables;
    const { "--visual-heading-font": _fallback, ...fallbacks } = VISUAL_APPEARANCE_FALLBACKS;
    expect(rest).toEqual(fallbacks);
    expect(headingFont).toBe(VISUAL_SERIF_FONT);
    expect(attributes).toEqual({
      "data-visual-heading-color": null,
      "data-visual-text-width": null,
      [VISUAL_MARKDOWN_ATTRIBUTE]: null,
    });
    expect(VISUAL_TYPEFACE_STACKS.serif).toBe(VISUAL_SERIF_FONT);
  });

  it("only know their own keys", () => {
    expect(isVisualAppearanceKey("visualTypeface")).toBe(true);
    expect(isVisualAppearanceKey("notesTypeface")).toBe(false);
    expect(isVisualAppearanceKey("toString")).toBe(false);
  });
});

describe("Visual mode appearance variables", () => {
  it("write the chosen text, spacing and layout values", () => {
    const { variables, attributes } = visualAppearanceStyle({
      ...defaults(),
      visualTypeface: "sans",
      visualFontSize: 18,
      visualLineHeight: "wide",
      visualParagraphSpacing: "compact",
      visualParagraphIndent: 1.5,
      visualTextAlign: "justify",
      visualTextWidth: "narrow",
      visualHeadingSize: "large",
    });
    expect(variables).toMatchObject({
      "--visual-text-font": "var(--font-sans)",
      "--visual-text-size": "18px",
      "--visual-line-height": "2",
      "--visual-paragraph-gap": "0.5",
      "--visual-paragraph-indent": "1.5em",
      "--visual-text-align": "justify",
      "--visual-text-width": "70ch",
      "--visual-heading-scale": "1.5",
    });
    expect(attributes["data-visual-text-width"]).toBe("narrow");
  });

  it("clamps a custom line height", () => {
    const style = visualAppearanceStyle({ ...defaults(), visualLineHeight: "custom", visualCustomLineHeight: 9 });
    expect(style.variables["--visual-line-height"]).toBe("3");
  });

  it("puts an installed font in front of the typeface stack", () => {
    expect(visualTextFont({ visualTypeface: "serif", visualFontFamily: "Charter" })).toBe(`"Charter", ${VISUAL_SERIF_FONT}`);
    expect(visualTextFont({ visualTypeface: "mono", visualFontFamily: "  " })).toBe("var(--font-mono)");
  });

  it("gives headings the text font unless they have their own", () => {
    const base = { ...defaults(), visualTypeface: "sans" as const };
    expect(visualHeadingFont(base)).toBe("var(--font-sans)");
    expect(visualHeadingFont({ ...base, visualHeadingTypeface: "serif" })).toBe(VISUAL_SERIF_FONT);
    expect(visualHeadingFont({ ...base, visualHeadingFontFamily: "Lora" })).toBe(`"Lora", var(--font-sans)`);
  });

  it("turns on the heading colour and Markdown attributes only when they are set", () => {
    const style = visualAppearanceStyle({ ...defaults(), visualHeadingColor: "#2563eb", visualMarkdown: true });
    expect(style.variables["--visual-heading-color"]).toBe("#2563eb");
    expect(style.attributes).toEqual({
      "data-visual-heading-color": "",
      "data-visual-text-width": null,
      [VISUAL_MARKDOWN_ATTRIBUTE]: "",
    });
  });
});

describe("normalizing a Visual mode setting", () => {
  it("keeps only the choices it knows", () => {
    expect(normalizeVisualSetting("visualTypeface", "comic")).toBe("serif");
    expect(normalizeVisualSetting("visualLineHeight", "editor")).toBe("editor");
    expect(normalizeVisualSetting("visualTextAlign", "center")).toBe("start");
    expect(normalizeVisualSetting("visualTextWidth", "wide")).toBe("wide");
    expect(normalizeVisualSetting("visualHeadingColor", "#ABCDEF")).toBe("#abcdef");
    expect(normalizeVisualSetting("visualHeadingColor", "red")).toBe("");
    expect(normalizeVisualSetting("visualMarkdown", "1")).toBe(true);
  });

  it("accepts only the listed paragraph indents", () => {
    expect(normalizeVisualSetting("visualParagraphIndent", "1.5")).toBe(1.5);
    expect(normalizeVisualSetting("visualParagraphIndent", "4")).toBe(0);
    expect(normalizeVisualSetting("visualParagraphIndent", "")).toBe(0);
  });

  it("keeps Match editor as its own text size and clamps the rest", () => {
    expect(clampVisualFontSize(0)).toBe(0);
    expect(clampVisualFontSize(3)).toBe(10);
    expect(clampVisualFontSize(99)).toBe(40);
    expect(normalizeVisualSetting("visualFontSize", "")).toBe(0);
    expect(normalizeVisualSetting("visualFontSize", "abc")).toBe(0);
    expect(normalizeVisualSetting("visualFontSize", "17")).toBe(17);
  });

  it("reads every key from its own storage slot", () => {
    const saved: Record<string, string> = {
      [VISUAL_APPEARANCE_STORAGE_KEYS.visualTypeface]: "mono",
      [VISUAL_APPEARANCE_STORAGE_KEYS.visualParagraphIndent]: "2",
      [VISUAL_APPEARANCE_STORAGE_KEYS.visualMarkdown]: "1",
    };
    expect(readVisualAppearance((key) => saved[key] ?? null)).toEqual({
      ...defaults(),
      visualTypeface: "mono",
      visualParagraphIndent: 2,
      visualMarkdown: true,
    });
    expect(new Set(Object.values(VISUAL_APPEARANCE_STORAGE_KEYS)).size).toBe(VISUAL_APPEARANCE_KEYS.length);
  });
});

describe("applying Visual mode appearance to the page", () => {
  it("writes the variables, follows changes and cleans up", () => {
    const root = document.createElement("div");
    const detach = attachVisualAppearance(root);
    expect(root.style.getPropertyValue("--visual-paragraph-indent")).toBe("0");
    useSettingsStore.getState().setVisualAppearance("visualParagraphIndent", 2);
    useSettingsStore.getState().setVisualAppearance("visualHeadingColor", "#16a34a");
    expect(root.style.getPropertyValue("--visual-paragraph-indent")).toBe("2em");
    expect(root.style.getPropertyValue("--visual-heading-color")).toBe("#16a34a");
    expect(root.hasAttribute("data-visual-heading-color")).toBe(true);
    useSettingsStore.getState().setVisualAppearance("visualHeadingColor", "");
    expect(root.hasAttribute("data-visual-heading-color")).toBe(false);
    detach();
    expect(root.style.getPropertyValue("--visual-paragraph-indent")).toBe("");
  });
});

describe("the Visual mode settings store", () => {
  it("saves each change and keeps a custom line height it already has", () => {
    const state = useSettingsStore.getState();
    state.setVisualAppearance("visualTextAlign", "justify");
    expect(localStorage.getItem(VISUAL_APPEARANCE_STORAGE_KEYS.visualTextAlign)).toBe("justify");
    state.setVisualAppearance("visualCustomLineHeight", 2.4);
    state.setVisualAppearance("visualLineHeight", "custom");
    expect(useSettingsStore.getState().visualCustomLineHeight).toBe(2.4);
  });

  it("goes back to the defaults with the rest of Appearance", () => {
    const state = useSettingsStore.getState();
    state.setVisualAppearance("visualTypeface", "sans");
    state.setVisualAppearance("visualMarkdown", true);
    state.resetAppearancePreferences();
    expect(useSettingsStore.getState().visualTypeface).toBe("serif");
    expect(useSettingsStore.getState().visualMarkdown).toBe(false);
  });
});
