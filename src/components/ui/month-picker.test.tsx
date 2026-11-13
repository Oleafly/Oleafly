// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import shell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { MonthPicker } from "./month-picker";
import { PopoverItem } from "./popover";

const copy = shell.monthPicker;
const now = new Date();

function name(date: Date, locale = "en"): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date);
}

function openPicker(label: string) {
  const trigger = screen.getByRole("button", { name: label });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  return screen.getByRole("dialog", { name: copy.label });
}

describe("MonthPicker", () => {
  it("opens on the month on show and jumps to a month in another year", () => {
    const onMonthChange = vi.fn();
    const shown = new Date(2026, 10, 1);
    render(<MonthPicker month={shown} onMonthChange={onMonthChange} locale="en" />);
    const trigger = screen.getByRole("button", { name: "November 2026" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const picker = openPicker("November 2026");
    const november = within(picker).getByRole("button", { name: "November 2026" });
    expect(november.dataset.shown).toBe("true");
    expect(document.activeElement).toBe(november);
    expect(within(picker).getAllByRole("button", { name: /\d{4}$/u })).toHaveLength(12);

    fireEvent.click(within(picker).getByRole("button", { name: copy.nextYear }));
    expect(within(picker).getByText("2027")).toBeTruthy();
    expect(within(picker).queryByRole("button", { name: "November 2026" })).toBeNull();
    fireEvent.click(within(picker).getByRole("button", { name: "March 2027" }));

    expect(onMonthChange).toHaveBeenCalledWith(new Date(2027, 2, 1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("fills the current month and opens again on the year on show", () => {
    const shown = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const current = new Date(now.getFullYear(), now.getMonth(), 1);
    render(<MonthPicker month={shown} onMonthChange={vi.fn()} locale="en" />);
    let picker = openPicker(name(shown));
    expect(within(picker).getByRole("button", { name: name(shown) }).getAttribute("aria-current")).toBeNull();
    expect(within(picker).getByRole("button", { name: name(shown) }).className).toContain("bg-accent");
    fireEvent.click(within(picker).getByRole("button", { name: copy.nextYear }));
    const filled = within(picker).getByRole("button", { name: name(current) });
    expect(filled.getAttribute("aria-current")).toBe("date");
    expect(filled.className).toContain("bg-primary");

    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    picker = openPicker(name(shown));
    expect(within(picker).getByText(String(now.getFullYear() - 1))).toBeTruthy();
  });

  it("names the months in the language it is given", () => {
    render(<MonthPicker month={new Date(2026, 2, 1)} onMonthChange={vi.fn()} locale="fr" />);
    const picker = openPicker("mars 2026");
    const short = new Intl.DateTimeFormat("fr", { month: "short" }).format(new Date(2026, 4, 1));
    expect(within(picker).getByRole("button", { name: "mai 2026" }).textContent).toBe(short);
  });

  it("puts extra actions under the grid and closes when one is chosen", () => {
    const go = vi.fn();
    render(
      <MonthPicker month={new Date(2026, 10, 1)} onMonthChange={vi.fn()} locale="en">
        <PopoverItem onClick={go}>{"Open the note"}</PopoverItem>
      </MonthPicker>,
    );
    const picker = openPicker("November 2026");
    fireEvent.click(within(picker).getByRole("button", { name: "Open the note" }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
