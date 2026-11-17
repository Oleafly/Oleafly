// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImagePlaceholder } from "./image-placeholder";

describe("ImagePlaceholder", () => {
  it("fills its box and names the image it stands in for", () => {
    render(<ImagePlaceholder hint="Team photo" />);

    const placeholder = screen.getByRole("img", { name: "Team photo" });
    expect(placeholder).toHaveTextContent("Team photo");
    expect(placeholder).toHaveAttribute("data-slide-placeholder", "Team photo");
    expect(placeholder.style.width).toBe("100%");
    expect(placeholder.style.height).toBe("100%");
  });

  it("takes a fixed size, extra styles and other attributes", () => {
    render(<ImagePlaceholder hint="Chart" width={320} height={180} className="tile" style={{ borderRadius: 0 }} id="chart" />);

    const placeholder = screen.getByRole("img", { name: "Chart" });
    expect(placeholder).toHaveAttribute("id", "chart");
    expect(placeholder).toHaveClass("tile");
    expect(placeholder.style.width).toBe("320px");
    expect(placeholder.style.height).toBe("180px");
    expect(placeholder.style.borderRadius).toBe("0px");
  });
});
