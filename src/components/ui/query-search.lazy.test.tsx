// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyze, defineSchema } from "@oleafly/search-query";
import type { QueryMeta } from "@/lib/query-suggestions";

const builds = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/lib/query-suggestions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/query-suggestions")>();
  return {
    ...actual,
    buildSuggestions: (...args: Parameters<typeof actual.buildSuggestions>) => {
      builds.count++;
      return actual.buildSuggestions(...args);
    },
  };
});

import { QuerySearch } from "./query-search";

interface Item {
  readonly engine: string;
}

const schema = defineSchema<Item, QueryMeta>({
  fields: [
    {
      key: "engine",
      meta: { label: "Engine" },
      type: "enum",
      options: [{ value: "typst", meta: { label: "Typst" } }],
      test: (item, value) => item.engine === value,
    },
  ],
  text: [{ value: "name", get: () => "" }],
});

const PLACEHOLDER = "Search";

function Harness({ initial }: Readonly<{ initial: string }>) {
  const [value, setValue] = useState(initial);
  const query = useMemo(() => analyze(value, schema, { now: 0 }), [value]);
  return (
    <QuerySearch
      value={value}
      onChange={setValue}
      query={query}
      schema={schema}
      ariaLabel="Search items"
      placeholder={PLACEHOLDER}
      clearLabel="Clear search"
    />
  );
}

beforeEach(() => {
  builds.count = 0;
});

afterEach(cleanup);

describe("QuerySearch suggestions", () => {
  it("waits for focus before building suggestions", () => {
    const view = render(<Harness initial="engine:" />);
    view.rerender(<Harness initial="engine:" />);
    expect(builds.count).toBe(0);

    const box = screen.getByRole("combobox", { name: "Search items" });
    fireEvent.focus(box);
    fireEvent.keyDown(box, { key: "ArrowDown" });

    expect(builds.count).toBeGreaterThan(0);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toContain("Typst");
  });
});
