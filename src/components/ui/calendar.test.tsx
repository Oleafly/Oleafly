// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { de } from "date-fns/locale";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { describe, expect, it, vi } from "vitest";
import { Calendar } from "./calendar";

const TODAY = new Date(2026, 8, 23);
const SEPTEMBER = new Date(2026, 8, 1);

function day(name: RegExp) {
  return screen.getByRole("button", { name });
}

function cell(date: string) {
  const found = document.querySelector<HTMLElement>(`[role="gridcell"][data-day="${date}"]`);
  if (!found) throw new Error(`no cell for ${date}`);
  return found;
}

function RangeCalendar({ onSelect }: Readonly<{ onSelect: (range: DateRange | undefined) => void }>) {
  const [range, setRange] = useState<DateRange | undefined>();
  return (
    <Calendar
      mode="range"
      today={TODAY}
      defaultMonth={SEPTEMBER}
      selected={range}
      onSelect={(next) => {
        setRange(next);
        onSelect(next);
      }}
    />
  );
}

function weekdayHeaders(container: HTMLElement) {
  return Array.from(container.querySelectorAll("thead th")).map((th) => th.textContent);
}

describe("Calendar", () => {
  it("renders an en-US month with Sunday first when no locale is given", () => {
    const { container } = render(<Calendar mode="single" today={TODAY} defaultMonth={SEPTEMBER} />);
    expect(container.firstElementChild).toHaveAttribute("lang", "en-US");
    expect(screen.getByRole("grid", { name: "September 2026" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("September 2026");
    expect(weekdayHeaders(container)).toEqual(["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]);
    expect(cell("2026-08-30")).toHaveAttribute("data-outside", "true");
    expect(day(/^Sunday, August 30th, 2026$/)).toHaveTextContent("30");
  });

  it("follows a date-fns locale for names and week start", () => {
    const { container } = render(
      <Calendar mode="single" locale={de} today={TODAY} defaultMonth={new Date(2026, 2, 1)} />,
    );
    expect(container.firstElementChild).toHaveAttribute("lang", "de");
    expect(screen.getByRole("grid", { name: "März 2026" })).toBeInTheDocument();
    expect(weekdayHeaders(container)).toEqual(["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]);
    expect(cell("2026-02-23")).toHaveAttribute("data-outside", "true");
  });

  it("selects the clicked day", async () => {
    const onSelect = vi.fn();
    render(<Calendar mode="single" today={TODAY} defaultMonth={SEPTEMBER} onSelect={onSelect} />);
    await userEvent.setup().click(day(/September 16th, 2026/));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toEqual(new Date(2026, 8, 16));
  });

  it("marks selected, today, outside and disabled days with the calendar styles", () => {
    render(
      <Calendar
        mode="single"
        today={TODAY}
        defaultMonth={SEPTEMBER}
        selected={new Date(2026, 8, 15)}
        disabled={[{ before: new Date(2026, 8, 3) }, { after: new Date(2026, 8, 25) }]}
        onSelect={() => {}}
      />,
    );
    const selected = cell("2026-09-15");
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(selected).toHaveClass("bg-primary", "text-primary-foreground");
    expect(day(/^Tuesday, September 15th, 2026, selected$/)).toHaveAttribute("tabindex", "0");

    const today = cell("2026-09-23");
    expect(today).toHaveAttribute("data-today", "true");
    expect(today).toHaveClass("bg-accent", "text-accent-foreground", "rounded-md");
    expect(day(/^Today, Wednesday, September 23rd, 2026$/)).toBeEnabled();

    expect(cell("2026-08-31")).toHaveClass("day-outside", "opacity-50");
    expect(cell("2026-09-02")).toHaveAttribute("data-disabled", "true");
    expect(cell("2026-09-02")).toHaveClass("text-muted-foreground", "opacity-50");
    expect(day(/September 2nd, 2026/)).toBeDisabled();
    expect(day(/September 26th, 2026/)).toBeDisabled();
    expect(day(/September 3rd, 2026/)).toBeEnabled();
    expect(day(/September 25th, 2026/)).toBeEnabled();
  });

  it("does not select a disabled day", () => {
    const onSelect = vi.fn();
    render(
      <Calendar
        mode="single"
        today={TODAY}
        defaultMonth={SEPTEMBER}
        disabled={{ after: new Date(2026, 8, 25) }}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(day(/September 28th, 2026/));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("moves between months with the navigation buttons", async () => {
    const user = userEvent.setup();
    render(<Calendar mode="single" today={TODAY} defaultMonth={SEPTEMBER} />);
    await user.click(screen.getByRole("button", { name: "Go to the Next Month" }));
    expect(screen.getByRole("grid", { name: "October 2026" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Go to the Previous Month" }));
    await user.click(screen.getByRole("button", { name: "Go to the Previous Month" }));
    expect(screen.getByRole("grid", { name: "August 2026" })).toBeInTheDocument();
  });

  it("focuses the selected day and moves focus with the keyboard", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <Calendar
        mode="single"
        today={TODAY}
        defaultMonth={SEPTEMBER}
        selected={new Date(2026, 8, 15)}
        onSelect={onSelect}
        autoFocus
      />,
    );
    expect(document.activeElement).toBe(day(/September 15th, 2026/));
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(day(/September 16th, 2026/));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(day(/September 23rd, 2026/));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(day(/September 20th, 2026/));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(day(/September 26th, 2026/));
    await user.keyboard("{PageDown}");
    expect(screen.getByRole("grid", { name: "October 2026" })).toBeInTheDocument();
    expect(document.activeElement).toBe(day(/October 26th, 2026/));
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(day(/October 19th, 2026/));
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toEqual(new Date(2026, 9, 19));
    await user.keyboard("{Shift>}{PageUp}{/Shift}");
    expect(screen.getByRole("grid", { name: "October 2025" })).toBeInTheDocument();
    expect(document.activeElement).toBe(day(/October 19th, 2025/));
    await user.keyboard("{Shift>}{PageDown}{/Shift}");
    expect(screen.getByRole("grid", { name: "October 2026" })).toBeInTheDocument();
    expect(document.activeElement).toBe(day(/October 19th, 2026/));
  });

  it("selects a range across two clicks and styles its ends and middle", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<RangeCalendar onSelect={onSelect} />);
    await user.click(day(/September 10th, 2026/));
    expect(onSelect.mock.calls.at(-1)?.[0]).toEqual({
      from: new Date(2026, 8, 10),
      to: new Date(2026, 8, 10),
    });
    await user.click(day(/September 14th, 2026/));
    expect(onSelect.mock.calls.at(-1)?.[0]).toEqual({
      from: new Date(2026, 8, 10),
      to: new Date(2026, 8, 14),
    });
    expect(cell("2026-09-10")).toHaveClass("day-range-start", "rounded-l-md");
    expect(cell("2026-09-14")).toHaveClass("day-range-end", "rounded-r-md");
    expect(cell("2026-09-12")).toHaveClass("aria-selected:bg-accent");
    expect(cell("2026-09-12")).toHaveAttribute("aria-selected", "true");
    expect(cell("2026-09-15")).not.toHaveAttribute("aria-selected");
  });

  it("keeps the app button styles on navigation and day buttons", () => {
    const { container } = render(
      <Calendar mode="single" today={TODAY} defaultMonth={SEPTEMBER} className="border" />,
    );
    expect(container.firstElementChild).toHaveClass("rdp-root", "p-3", "border");
    const previous = screen.getByRole("button", { name: "Go to the Previous Month" });
    expect(previous).toHaveClass("border-input", "size-7", "bg-transparent", "p-0", "opacity-60");
    expect(previous.querySelector("svg")).toHaveClass("lucide-chevron-left", "size-4");
    const next = screen.getByRole("button", { name: "Go to the Next Month" });
    expect(next.querySelector("svg")).toHaveClass("lucide-chevron-right", "size-4");
    expect(day(/September 16th, 2026/)).toHaveClass("size-8", "p-0", "font-normal");
    expect(screen.getByRole("status")).toHaveClass("text-sm", "font-medium");
  });
});
