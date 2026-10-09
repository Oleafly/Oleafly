// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useScrollTopOnChange } from "./use-scroll-top-on-change";

function List({ query, items }: Readonly<{ query: string; items: number }>) {
  const ref = useScrollTopOnChange(query);
  return (
    <div ref={ref} data-testid="list" style={{ height: 40, overflowY: "auto" }}>
      {Array.from({ length: items }, (_, index) => `Model ${index}`).map((name) => (
        <p key={name}>{name}</p>
      ))}
    </div>
  );
}

describe("useScrollTopOnChange", () => {
  it("starts a new result list at the top", () => {
    const view = render(<List query="" items={40} />);
    const list = view.getByTestId("list");
    list.scrollTop = 300;

    view.rerender(<List query="glm" items={12} />);

    expect(list.scrollTop).toBe(0);
  });

  it("keeps the scroll position while the query stays the same", () => {
    const view = render(<List query="glm" items={40} />);
    const list = view.getByTestId("list");
    list.scrollTop = 300;

    view.rerender(<List query="glm" items={41} />);

    expect(list.scrollTop).toBe(300);
  });
});
