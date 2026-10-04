// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { analyze, defineSchema } from "@oleafly/search-query";
import type { QueryMeta } from "@/lib/query-suggestions";
import { QuerySearch } from "./query-search";

const PLACEHOLDER = "Search";

interface Item {
  readonly kind: string;
  readonly words: number;
  readonly engine: string;
}

const schema = defineSchema<Item, QueryMeta>({
  fields: [
    {
      key: "kind",
      type: "enum",
      options: [{ value: "draft" }, { value: "final" }],
      test: (item, value) => item.kind === value,
    },
    { key: "words", type: "number", get: (item) => item.words },
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
  ],
  text: [{ value: "name", get: () => "" }],
});

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

const input = () => screen.getByRole("combobox", { name: "Search items" }) as HTMLInputElement;
const options = () => screen.queryAllByRole("option").map((option) => option.textContent);
const value = () => screen.getByTestId("value").textContent;

function focusAt(position: number) {
  input().setSelectionRange(position, position);
  fireEvent.focus(input());
}

describe("QuerySearch without display names", () => {
  it("lists qualifiers and values by their keys", () => {
    render(<Harness />);
    fireEvent.focus(input());

    expect(options()).toEqual(["kind", "words", "Engine", "Exclude"]);

    fireEvent.change(input(), { target: { value: "kind:" } });

    expect(options()).toEqual(["Exclude ", "draft", "final"]);
  });

  it("explains a number that does not parse", () => {
    render(<Harness initial="words:many" />);
    focusAt(0);
    fireEvent.keyDown(input(), { key: "ArrowDown" });

    expect(screen.getByText("many is not a number")).toBeTruthy();
  });
});

describe("QuerySearch pointer and focus", () => {
  it("activates the option under the pointer and keeps focus in the field", () => {
    render(<Harness />);
    fireEvent.focus(input());
    const engine = screen.getByRole("option", { name: "Engine" });

    fireEvent.mouseEnter(engine);

    expect(input().getAttribute("aria-activedescendant")).toBe(engine.id);
    expect(fireEvent.mouseDown(engine)).toBe(false);
    expect(fireEvent.mouseDown(screen.getByRole("listbox"))).toBe(false);

    fireEvent.keyDown(input(), { key: "Enter" });
    expect(value()).toBe("engine:");
  });

  it("closes the list when focus leaves the field", () => {
    render(<Harness />);
    fireEvent.focus(input());
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input().getAttribute("aria-activedescendant")).not.toBeNull();

    fireEvent.blur(input());

    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
  });

  it("ignores keys pressed while an input method is composing", () => {
    render(<Harness />);
    fireEvent.focus(input());

    fireEvent.keyDown(input(), { key: "Escape", isComposing: true });

    expect(input().getAttribute("aria-expanded")).toBe("true");
  });

  it("moves the highlighted text with the field's scroll position", () => {
    render(<Harness initial="engine:typst" />);
    const field = input();
    field.scrollLeft = 40;

    fireEvent.scroll(field);

    const shifted = screen.getByTestId("query-search-highlight").querySelector("span[style]") as HTMLElement;
    expect(shifted.style.transform).toBe("translateX(-40px)");
  });

  it("moves the caret past a value that is already spelled out", () => {
    render(<Harness initial="engine:typst rest" />);
    focusAt(9);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(options()).toEqual(["Typst"]);

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(value()).toBe("engine:typst rest");
    expect(input().selectionStart).toBe(13);
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });
});
