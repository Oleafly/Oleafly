// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { analyze, defineSchema, flagField } from "@oleafly/search-query";
import type { QueryMeta } from "@/lib/query-suggestions";
import { QuerySearch } from "./query-search";

interface Item {
  readonly engine: string;
  readonly starred: boolean;
  readonly created: number;
}

const schema = defineSchema<Item, QueryMeta>({
  fields: [
    flagField<Item, QueryMeta>("is", [{ value: "starred", meta: { label: "Starred" }, test: (item) => item.starred }], {
      meta: { label: "Is" },
    }),
    {
      key: "engine",
      meta: { label: "Engine" },
      type: "enum",
      options: [
        { value: "typst", meta: { label: "Typst" } },
        { value: "markdown", meta: { label: "Markdown" } },
      ],
      test: (item, value) => item.engine === value,
    },
    { key: "created", meta: { label: "Created" }, type: "date", get: (item) => item.created },
  ],
  text: [{ value: "name", get: () => "" }],
});

const PLACEHOLDER = "Search";

function Harness({ initial = "" }: Readonly<{ initial?: string }>) {
  const [value, setValue] = useState(initial);
  const query = useMemo(() => analyze(value, schema, { now: 0 }), [value]);
  return (
    <>
      <QuerySearch
        value={value}
        onChange={setValue}
        query={query}
        schema={schema}
        ariaLabel="Search items"
        placeholder={PLACEHOLDER}
        clearLabel="Clear search"
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

afterEach(cleanup);

const input = () => screen.getByRole("combobox", { name: "Search items" });
const options = () => screen.queryAllByRole("option").map((option) => option.textContent);
const value = () => screen.getByTestId("value").textContent;

function type(text: string) {
  fireEvent.change(input(), { target: { value: text } });
}

describe("QuerySearch", () => {
  it("opens the qualifier list on focus only while empty", () => {
    render(<Harness />);
    fireEvent.focus(input());
    expect(options()).toEqual(["Is", "Engine", "Created", "Exclude"]);
    expect(input()).toHaveAttribute("aria-expanded", "true");
    cleanup();

    render(<Harness initial="engine:typst" />);
    fireEvent.focus(input());
    expect(input()).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input()).toHaveAttribute("aria-expanded", "true");
  });

  it("accepts a qualifier and then a value from the keyboard", () => {
    render(<Harness />);
    fireEvent.focus(input());
    type("eng");
    expect(options()).toEqual(["Engine"]);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input()).toHaveAttribute("aria-activedescendant", expect.stringContaining("field:engine"));
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(value()).toBe("engine:");
    expect(options()).toEqual(["Exclude Engine", "Typst", "Markdown"]);

    fireEvent.keyDown(input(), { key: "ArrowUp" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(value()).toBe("engine:markdown ");
    expect(input()).toHaveAttribute("aria-expanded", "false");
  });

  it("wraps through an empty slot when moving with the arrows", () => {
    render(<Harness />);
    fireEvent.focus(input());
    type("is:");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input()).toHaveAttribute("aria-activedescendant", expect.stringContaining("value:starred"));
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input()).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(value()).toBe("is:");
  });

  it("toggles exclusion and inserts operators with the mouse", () => {
    render(<Harness />);
    fireEvent.focus(input());
    type("engine:");
    fireEvent.click(screen.getByRole("option", { name: "Exclude Engine" }));
    expect(value()).toBe("-engine:");
    type("engine:typst ");
    fireEvent.click(screen.getByRole("option", { name: "OR" }));
    expect(value()).toBe("engine:typst OR ");
    fireEvent.click(screen.getByRole("option", { name: "Exclude" }));
    expect(value()).toBe("engine:typst OR -");
    expect(screen.getByText("Exclude", { selector: "p" })).toBeInTheDocument();
  });

  it("closes on Escape and Tab without accepting", () => {
    render(<Harness />);
    fireEvent.focus(input());
    type("e");
    fireEvent.keyDown(input(), { key: "Tab" });
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(value()).toBe("e");
    type("en");
    expect(input()).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(input()).toHaveAttribute("aria-expanded", "false");
  });

  it("highlights values and operators and lists problems away from the caret", () => {
    render(<Harness initial="engine:banana OR is:starred created:soon" />);
    const highlight = screen.getByTestId("query-search-highlight");
    expect(highlight.querySelector('[data-kind="operator"]')).toHaveTextContent("OR");
    expect(highlight.querySelectorAll('[data-kind="value"]')).toHaveLength(3);
    expect(screen.queryByText(/is not a valid value/)).toBeNull();
    fireEvent.focus(input());
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(screen.getByText("banana is not a valid value for engine")).toBeInTheDocument();
    expect(screen.queryByText(/soon is not a date/)).toBeNull();
    act(() => {
      input().focus();
      (input() as HTMLInputElement).setSelectionRange(0, 0);
    });
    fireEvent.keyUp(input(), { key: "Home" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(screen.getByText(/soon is not a date/)).toBeInTheDocument();
  });

  it("shows the date hint after a date key", () => {
    render(<Harness />);
    fireEvent.focus(input());
    type("created:");
    expect(screen.getByText(/Dates look like/)).toBeInTheDocument();
  });

  it("clears the query", () => {
    render(<Harness initial="is:starred" />);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(value()).toBe("");
    expect(input()).toHaveFocus();
  });
});
