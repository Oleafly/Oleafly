// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { allowRadixSelect, chooseOption } from "@/features/collab/tests/select";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(async () => undefined) }));

import { VISUAL_APPEARANCE_DEFAULTS } from "@/lib/visual-appearance";
import { VISUAL_TYPEFACE_STACKS, attachVisualAppearance } from "@/lib/visual-appearance-style";
import { useSettingsStore } from "@/store/settings";
import { VisualAppearanceTab } from "./VisualAppearance";

const visual = enSettings.appearance.visual;
const reset = (setting: string) => enSettings.appearance.resetSetting.replace("{{setting}}", setting);
let detach: (() => void) | null = null;

function rootVariable(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

beforeAll(async () => {
  await loadNamespace("settings");
});

beforeEach(() => {
  localStorage.clear();
  allowRadixSelect();
  useSettingsStore.setState({ ...VISUAL_APPEARANCE_DEFAULTS, editorFontSize: 14, editorUsesAppFont: false });
  detach = attachVisualAppearance(document.documentElement);
});

afterEach(() => {
  detach?.();
  detach = null;
});

describe("Visual mode appearance tab", () => {
  it("starts on the built-in Visual mode look with nothing to reset", () => {
    render(<VisualAppearanceTab />);
    expect(screen.getByRole("figure", { name: visual.preview.label })).toBeInTheDocument();
    expect(screen.getByTestId("settings-visual-intro")).toHaveTextContent(visual.intro);
    expect(screen.queryAllByRole("button", { name: /^Reset .* to default$/ })).toEqual([]);
    expect(screen.getByTestId("settings-visual-typeface-serif")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("settings-visual-font-size-trigger")).toHaveTextContent(visual.matchEditor);
    expect(screen.getByTestId("settings-visual-line-height-trigger")).toHaveTextContent(visual.matchEditor);
    for (const title of [visual.text.title, visual.headings.title, visual.layout.title]) {
      expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
    }
  });

  it("changes the typeface on the page and resets it", async () => {
    const user = userEvent.setup();
    render(<VisualAppearanceTab />);
    await user.click(screen.getByTestId("settings-visual-typeface-sans"));
    expect(useSettingsStore.getState().visualTypeface).toBe("sans");
    expect(rootVariable("--visual-text-font")).toBe(VISUAL_TYPEFACE_STACKS.sans);
    const sameAsText = screen.getByTestId("settings-visual-heading-typeface-text");
    expect(sameAsText.querySelector("span")).toHaveStyle({ fontFamily: VISUAL_TYPEFACE_STACKS.sans });
    await user.click(screen.getByRole("button", { name: reset(visual.typeface.label) }));
    expect(useSettingsStore.getState().visualTypeface).toBe("serif");
  });

  it("sets a fixed text size and seeds Custom from the editor size", async () => {
    const user = userEvent.setup();
    render(<VisualAppearanceTab />);
    await chooseOption(user, visual.fontSize.label, "18px");
    expect(rootVariable("--visual-text-size")).toBe("18px");
    await user.click(screen.getByRole("button", { name: reset(visual.fontSize.label) }));
    await chooseOption(user, visual.fontSize.label, enSettings.appearance.editor.fontSize.custom);
    expect(screen.getByRole("spinbutton", { name: visual.fontSize.customLabel })).toHaveValue(16);
  });

  it("seeds a custom line height from the editor's line height", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ editorLineHeight: "wide" });
    render(<VisualAppearanceTab />);
    await chooseOption(user, visual.lineHeight.label, enSettings.appearance.editor.lineHeight.options.custom);
    const custom = screen.getByRole("spinbutton", { name: visual.lineHeight.customLabel });
    expect(custom).toHaveValue(2);
    fireEvent.change(custom, { target: { value: "1.9" } });
    expect(rootVariable("--visual-line-height")).toBe("1.9");
  });

  it("sets paragraph spacing, indent and alignment from their lists", async () => {
    const user = userEvent.setup();
    render(<VisualAppearanceTab />);
    await chooseOption(user, visual.paragraphSpacing.label, enSettings.appearance.text.paragraphSpacings.spacious);
    await chooseOption(user, visual.paragraphIndent.label, "1.5 em");
    await chooseOption(user, visual.textAlign.label, visual.textAlign.options.justify);
    expect(rootVariable("--visual-paragraph-gap")).toBe("2");
    expect(rootVariable("--visual-paragraph-indent")).toBe("1.5em");
    expect(rootVariable("--visual-text-align")).toBe("justify");
  });

  it("colours headings with a swatch and goes back to the editor theme", async () => {
    const user = userEvent.setup();
    render(<VisualAppearanceTab />);
    const theme = screen.getByTestId("settings-visual-heading-color-theme");
    expect(theme).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByTestId("settings-visual-heading-color-green"));
    expect(document.documentElement).toHaveAttribute("data-visual-heading-color");
    await user.click(theme);
    expect(document.documentElement).not.toHaveAttribute("data-visual-heading-color");
  });

  it("picks a text width and turns Markdown on", async () => {
    const user = userEvent.setup();
    render(<VisualAppearanceTab />);
    await user.click(screen.getByTestId("settings-visual-width-narrow"));
    expect(rootVariable("--visual-text-width")).toBe("70ch");
    expect(document.documentElement).toHaveAttribute("data-visual-text-width", "narrow");
    await user.click(screen.getByRole("switch", { name: visual.markdown.label }));
    expect(document.documentElement).toHaveAttribute("data-visual-markdown");
  });
});
