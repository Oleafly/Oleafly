// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderVisualMath } from "./math";

// The MathML annotation keeps the TeX source, labels included; only the
// rendered part must leave them out.
function rendered(html: string): string {
  return html.replace(/<annotation[\s\S]*?<\/annotation>/gu, "");
}

describe("renderVisualMath", () => {
  it("renders an equation that carries a label", () => {
    const result = renderVisualMath("\\begin{equation}\n  x = 1 \\label{eq:one}\n\\end{equation}", true);
    expect(result.status).toBe("ready");
    expect(rendered(result.html)).not.toContain("eq:one");
  });

  it("renders a label written with a space or a cleveref type", () => {
    const spaced = renderVisualMath("\\begin{equation}\n  x = 1 \\label {eq:one}\n\\end{equation}", true);
    expect(spaced.status).toBe("ready");
    expect(rendered(spaced.html)).not.toContain("eq:one");

    const typed = renderVisualMath("\\begin{equation}\n  x = 1 \\label[lemma]{eq:one}\n\\end{equation}", true);
    expect(typed.status).toBe("ready");
    expect(rendered(typed.html)).not.toContain("lemma");
    expect(rendered(typed.html)).not.toContain("eq:one");
  });

  it("renders numbered environments without a number", () => {
    const result = renderVisualMath("\\begin{align}a &= b \\\\ c &= d\\end{align}", true);
    expect(result.status).toBe("ready");
    expect(result.html).not.toContain("katex-tag");
  });
});
