// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatGrid } from "./stat-grid";

describe("StatGrid", () => {
  it("lists each figure as a term with its value and detail", () => {
    const { container } = render(
      <StatGrid
        className="border-t-0"
        stats={[
          { id: "people", label: "People", value: "12", detail: "Suspended: 1" },
          { id: "version", label: "Version", value: "0.1.0" },
        ]}
      />,
    );
    const grid = container.querySelector("dl");
    expect(grid).toHaveClass("grid", "border-t-0");
    expect(grid).not.toHaveClass("border-t");
    expect(screen.getByText("People").tagName).toBe("DT");
    expect(screen.getByText("12").tagName).toBe("DD");
    expect(screen.getByText("Suspended: 1").tagName).toBe("DD");
    const version = container.querySelector('[data-stat="version"]');
    expect(version?.querySelectorAll("dd")).toHaveLength(1);
  });
});
