// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUPPORTED_LOCALES } from "@oleafly/i18n-contract";
import { applyLocale } from "@/i18n";
import { DatePicker, type DatePickerProps } from "./date-picker";

const SHELL_CATALOGS = import.meta.glob<{ datePicker: { placeholder: string } }>(
  "../../i18n/locales/*/shell.json",
  { eager: true, import: "default" },
);

function catalogPlaceholder(locale: string): string {
  const catalog = SHELL_CATALOGS[`../../i18n/locales/${locale}/shell.json`];
  if (!catalog) throw new Error(`no shell catalog for ${locale}`);
  return catalog.datePicker.placeholder;
}

const DUE_DATE = "Due date";

type HarnessProps = Omit<DatePickerProps, "value" | "onChange"> & {
  initial?: string | null;
  onChange?: (value: string | null) => void;
};

function Harness({ initial = null, onChange, ...rest }: Readonly<HarnessProps>) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <DatePicker
      aria-label={DUE_DATE}
      {...rest}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

function trigger(): HTMLElement {
  return screen.getByRole("button", { name: DUE_DATE });
}

function cell(day: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`td[data-day="${day}"]`);
  if (!found) throw new Error(`no cell for ${day}`);
  return found;
}

function dayButton(day: string): HTMLButtonElement {
  const button = cell(day).querySelector("button");
  if (!button) throw new Error(`no button for ${day}`);
  return button;
}

function caption(): string {
  return screen.getByRole("status").textContent ?? "";
}

function focusedDay(): string | null {
  return document.activeElement?.closest("td")?.getAttribute("data-day") ?? null;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 23, 12));
});

afterEach(async () => {
  vi.useRealTimers();
  await applyLocale("en");
});

describe("DatePicker", () => {
  it("shows the placeholder until a date is chosen, then the short English date", () => {
    const { rerender } = render(<DatePicker aria-label={DUE_DATE} value={null} onChange={() => {}} />);
    expect(trigger()).toHaveTextContent("Pick a date");
    expect(trigger()).toHaveAttribute("data-empty", "true");

    rerender(<DatePicker aria-label={DUE_DATE} value="2026-09-15" onChange={() => {}} />);
    expect(trigger()).toHaveTextContent("Sep 15, 2026");
    expect(trigger()).toHaveAttribute("data-empty", "false");
  });

  it("opens on the selected month with the selected day focused", async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-03-15" />);

    await user.click(trigger());

    expect(caption()).toBe("March 2026");
    expect(cell("2026-03-15")).toHaveAttribute("aria-selected", "true");
    expect(focusedDay()).toBe("2026-03-15");
  });

  it("opens on the current month and focuses today when nothing is chosen", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());

    expect(caption()).toBe("September 2026");
    expect(focusedDay()).toBe("2026-09-23");
    expect(dayButton("2026-09-23")).toHaveAccessibleName("Today, Wednesday, September 23rd, 2026");
  });

  it("opens on the month of the latest allowed date when nothing is chosen", async () => {
    const user = userEvent.setup();
    render(<Harness max="2026-03-10" />);

    await user.click(trigger());

    expect(caption()).toBe("March 2026");
  });

  it("reports the picked day as an ISO date and closes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="2026-09-15" onChange={onChange} />);

    await user.click(trigger());
    await user.click(dayButton("2026-09-20"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("2026-09-20");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(trigger()).toHaveTextContent("Sep 20, 2026");
  });

  it("picks a day in another month after moving with the navigation buttons", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="2026-09-15" onChange={onChange} />);

    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "Go to the Previous Month" }));
    expect(caption()).toBe("August 2026");
    await user.click(dayButton("2026-08-04"));

    expect(onChange).toHaveBeenLastCalledWith("2026-08-04");
  });

  it("picks a day with the keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="2026-09-15" onChange={onChange} />);

    await user.click(trigger());
    expect(focusedDay()).toBe("2026-09-15");
    await user.keyboard("{ArrowRight}{ArrowDown}");
    expect(focusedDay()).toBe("2026-09-23");
    await user.keyboard("{PageDown}");
    expect(caption()).toBe("October 2026");
    expect(focusedDay()).toBe("2026-10-23");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenLastCalledWith("2026-10-23");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("disables days outside min and max without limiting month navigation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="2026-09-15" min="2026-09-05" max="2026-09-25" onChange={onChange} />);

    await user.click(trigger());

    expect(dayButton("2026-09-04")).toBeDisabled();
    expect(dayButton("2026-09-26")).toBeDisabled();
    expect(dayButton("2026-09-05")).toBeEnabled();
    expect(dayButton("2026-09-25")).toBeEnabled();
    await user.click(dayButton("2026-09-26"));
    expect(onChange).not.toHaveBeenCalled();

    const next = screen.getByRole("button", { name: "Go to the Next Month" });
    expect(next).not.toHaveAttribute("aria-disabled");
    await user.click(next);
    expect(caption()).toBe("October 2026");
    expect(dayButton("2026-10-01")).toBeDisabled();
  });

  it("keeps the date when the selected day is clicked again and it is not clearable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="2026-09-15" onChange={onChange} />);

    await user.click(trigger());
    await user.click(dayButton("2026-09-15"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(trigger()).toHaveTextContent("Sep 15, 2026");
  });

  it("clears the date when the selected day is clicked again and it is clearable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="2026-09-15" clearable onChange={onChange} />);

    await user.click(trigger());
    await user.click(dayButton("2026-09-15"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(trigger()).toHaveTextContent("Pick a date");
  });

  it("clears the date from the clear button and closes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="2026-09-15" clearable onChange={onChange} />);

    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(trigger()).toHaveTextContent("Pick a date");
  });

  it.each(SUPPORTED_LOCALES)("renders the calendar in English under the %s interface language", async (locale) => {
    const user = userEvent.setup();
    await applyLocale(locale);
    const { rerender } = render(<DatePicker aria-label={DUE_DATE} value={null} onChange={() => {}} />);
    expect(trigger()).toHaveTextContent(catalogPlaceholder(locale));

    rerender(<Harness initial="2026-10-15" />);
    expect(trigger()).toHaveTextContent("Oct 15, 2026");

    await user.click(trigger());

    expect(document.querySelector(".rdp-root")).toHaveAttribute("lang", "en-US");
    expect(caption()).toBe("October 2026");
    expect(screen.getByRole("grid", { name: "October 2026" })).toBeInTheDocument();
    const headers = Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).toEqual(["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]);
    expect(cell("2026-09-27")).toHaveAttribute("data-outside", "true");
    expect(dayButton("2026-10-15")).toHaveAccessibleName("Thursday, October 15th, 2026, selected");
    expect(screen.getByRole("button", { name: "Go to the Previous Month" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to the Next Month" })).toBeInTheDocument();
  });
});
