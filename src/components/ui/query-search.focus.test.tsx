// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { analyze, defineSchema } from "@oleafly/search-query";
import type { QueryMeta } from "@/lib/query-suggestions";
import { QuerySearch } from "./query-search";

const LABEL = "Search notes";
const ELSEWHERE = "Elsewhere";
const PLACEHOLDER = "Search";
const CLEAR = "Clear";
const schema = defineSchema<{ readonly name: string }, QueryMeta>({ fields: [], text: [{ value: "name", get: (item) => item.name }] });

function Search({ focusKey }: Readonly<{ focusKey: number }>) {
  const query = useMemo(() => analyze("", schema, { now: 0 }), []);
  return (
    <>
      <button type="button">{ELSEWHERE}</button>
      <QuerySearch
        value=""
        onChange={() => undefined}
        query={query}
        schema={schema}
        ariaLabel={LABEL}
        placeholder={PLACEHOLDER}
        clearLabel={CLEAR}
        focusKey={focusKey}
      />
    </>
  );
}

afterEach(cleanup);

describe("QuerySearch focusKey", () => {
  it("focuses the box when the key changes, not when it mounts with a key already used", () => {
    const box = () => screen.getByRole("combobox", { name: LABEL });
    const view = render(<Search focusKey={3} />);
    expect(box()).not.toHaveFocus();
    view.rerender(<Search focusKey={4} />);
    expect(box()).toHaveFocus();
    const elsewhere = screen.getByRole("button", { name: ELSEWHERE });
    elsewhere.focus();
    view.rerender(<Search focusKey={4} />);
    expect(elsewhere).toHaveFocus();
    view.unmount();
    render(<Search focusKey={4} />);
    expect(box()).not.toHaveFocus();
  });
});
