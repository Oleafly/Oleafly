import { describe, expect, it } from "vitest";
import { isDisplayMathLine, mathifyText } from "./math";

describe("mathifyText", () => {
  it("maps greek and operators into an inline math run", () => {
    const r = mathifyText("rate α + β decreases");
    expect(r.text).toBe("rate $\\alpha + \\beta$ decreases");
    expect(r.inlineCount).toBe(1);
  });

  it("maps comparison symbols", () => {
    expect(mathifyText("x ≤ y").text).toBe("$x \\le y$");
  });

  it("creates separate runs for separated symbols", () => {
    const r = mathifyText("where λ controls decay and the temperature τ anneals");
    expect(r.text).toBe("where $\\lambda$ controls decay and the temperature $\\tau$ anneals");
    expect(r.inlineCount).toBe(2);
  });

  it("leaves plain text untouched", () => {
    const r = mathifyText("no math here");
    expect(r.text).toBe("no math here");
    expect(r.inlineCount).toBe(0);
  });
});

describe("isDisplayMathLine", () => {
  it("true for a symbol-dense equation line", () => {
    expect(isDisplayMathLine("∑ x2 = ∫ f(x) dx ≈ π")).toBe(true);
  });

  it("false for prose", () => {
    expect(isDisplayMathLine("The sum of squares is described below.")).toBe(false);
  });

  it("false for empty and very long lines", () => {
    expect(isDisplayMathLine("")).toBe(false);
    expect(isDisplayMathLine(`x = ${"very long prose ".repeat(10)}`)).toBe(false);
  });
});
