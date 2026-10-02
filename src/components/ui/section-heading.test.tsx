// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SECTION_HEADING_CLASS, SectionHeading } from "./section-heading";

const HEADING = "Distributions";

describe("SectionHeading", () => {
  it("renders an h3 with the shared section heading style by default", () => {
    render(<SectionHeading id="distributions">{HEADING}</SectionHeading>);
    const heading = screen.getByRole("heading", { level: 3, name: HEADING });
    expect(heading).toHaveAttribute("id", "distributions");
    expect(heading).toHaveClass(...SECTION_HEADING_CLASS.split(" "));
  });

  it("renders the requested element and keeps extra spacing", () => {
    const { container } = render(
      <SectionHeading as="p" className="mb-2">
        {HEADING}
      </SectionHeading>,
    );
    const label = container.firstElementChild;
    expect(label?.tagName).toBe("P");
    expect(label).toHaveClass("mb-2", "uppercase", "tracking-wide");
  });
});
