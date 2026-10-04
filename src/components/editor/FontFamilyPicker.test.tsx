// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import type { TypstFontEntry, TypstFontSourceKind } from "@/lib/typst-options";
import { FontFamilyPicker, fontChoices, type FontFamilies } from "./FontFamilyPicker";

const FAMILIES: TypstFontEntry[] = [
  { name: "Libertinus Serif", sources: [{ kind: "embedded", path: null }] },
  { name: "Inter", sources: [{ kind: "system", path: "/fonts/Inter.ttf" }, { kind: "project", path: "fonts/Inter.ttf" }] },
  { name: "Iosevka", sources: [{ kind: "system", path: "/fonts/Iosevka.ttf" }] },
];

function Harness({
  fonts,
  sources = ["project", "system", "embedded"],
  onLoad = () => {},
  onChange = () => {},
  invalid,
}: Readonly<{
  fonts: FontFamilies;
  sources?: TypstFontSourceKind[];
  onLoad?: () => void;
  onChange?: (value: string) => void;
  invalid?: boolean;
}>) {
  const [value, setValue] = useState("");
  return (
    <FontFamilyPicker
      id="font"
      label={FONT_LABEL}
      value={value}
      placeholder={en.typstSettings.placeholders.font}
      invalid={invalid}
      fonts={fonts}
      sources={sources}
      onLoad={onLoad}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const READY: FontFamilies = { status: "ready", families: FAMILIES };
const FONT_LABEL = en.typstSettings.fields.font;

function options() {
  return screen.queryAllByRole("option").map((option) => option.textContent);
}

describe("fontChoices", () => {
  it("keeps the allowed sources of each matching family", () => {
    expect(fontChoices(FAMILIES, ["system"], "i")).toEqual([
      { name: "Inter", kinds: ["system"] },
      { name: "Iosevka", kinds: ["system"] },
    ]);
  });

  it("stops at eighty choices", () => {
    const many = Array.from({ length: 90 }, (_, index) => ({
      name: `Font ${index}`,
      sources: [{ kind: "system" as const, path: null }],
    }));
    expect(fontChoices(many, ["system"], "")).toHaveLength(80);
  });
});

describe("FontFamilyPicker", () => {
  it("asks for the font list and says it is loading", () => {
    const onLoad = vi.fn();
    render(<Harness fonts={{ status: "loading" }} onLoad={onLoad} invalid />);
    const input = screen.getByRole("combobox", { name: FONT_LABEL });
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.focus(input);
    expect(onLoad).toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox", { name: en.documentSettings.availableFonts })).toHaveTextContent(
      en.documentSettings.fontsLoading,
    );
  });

  it("lists families with their sources and picks one by click", () => {
    const onChange = vi.fn();
    render(<Harness fonts={READY} onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: FONT_LABEL });
    fireEvent.click(input);
    expect(options()).toEqual([
      `Libertinus Serif${en.typstFonts.sources.embedded}`,
      `Inter${en.typstFonts.sources.project}${en.typstFonts.sources.system}`,
      `Iosevka${en.typstFonts.sources.system}`,
    ]);
    const inter = screen.getByRole("option", { name: /^Inter/ });
    fireEvent.mouseEnter(inter);
    expect(inter).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", inter.id);
    const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    inter.dispatchEvent(mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);
    fireEvent.click(inter);
    expect(onChange).toHaveBeenLastCalledWith("Inter");
    expect(input).toHaveValue("Inter");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("filters while typing and picks with the arrow keys and Enter", () => {
    const onChange = vi.fn();
    render(<Harness fonts={READY} onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: FONT_LABEL });
    fireEvent.change(input, { target: { value: "i" } });
    expect(options()).toHaveLength(3);
    fireEvent.change(input, { target: { value: "io" } });
    expect(options()).toEqual([`Iosevka${en.typstFonts.sources.system}`]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("Iosevka");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("moves the highlight up and down within the list", () => {
    render(<Harness fonts={READY} />);
    const input = screen.getByRole("combobox", { name: FONT_LABEL });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[2]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("hides the list when nothing matches or the fonts failed to load", () => {
    const { rerender } = render(<Harness fonts={READY} sources={["project"]} />);
    const input = screen.getByRole("combobox", { name: FONT_LABEL });
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(input).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("zzz");

    rerender(<Harness fonts={{ status: "error" }} />);
    fireEvent.click(screen.getByRole("combobox", { name: FONT_LABEL }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes when the user clicks elsewhere but not on the field itself", async () => {
    render(
      <div>
        <Harness fonts={READY} />
        <button type="button" data-testid="elsewhere" />
      </div>,
    );
    const input = screen.getByRole("combobox", { name: FONT_LABEL });
    fireEvent.click(input);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.pointerDown(input);
    fireEvent.click(input);
    expect(input).toHaveAttribute("aria-expanded", "true");
    const elsewhere = screen.getByTestId("elsewhere");
    fireEvent.pointerDown(elsewhere);
    fireEvent.click(elsewhere);
    expect(input).toHaveAttribute("aria-expanded", "false");
  });
});
