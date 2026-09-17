// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderVisualMath } from "./math";

describe("renderVisualMath", () => {
  it("renders an equation that carries a label", () => {
    const result = renderVisualMath("\\begin{equation}\n  x = 1 \\label{eq:one}\n\\end{equation}", true);
    expect(result.status).toBe("ready");
    expect(result.html).not.toContain("eq:one");
  });

  it("renders numbered environments without a number", () => {
    const result = renderVisualMath("\\begin{align}a &= b \\\\ c &= d\\end{align}", true);
    expect(result.status).toBe("ready");
    expect(result.html).not.toContain("katex-tag");
  });
});
