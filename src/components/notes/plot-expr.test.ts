import { describe, expect, it } from "vitest";
import { compileExpression, MAX_EXPRESSION_DEPTH, MAX_EXPRESSION_LENGTH } from "./plot-expr";

function value(text: string, scope: Record<string, number> = {}, variables: string[] = Object.keys(scope)): number {
  const compiled = compileExpression(text, variables);
  if (!compiled.ok) throw new Error(`${text}: ${compiled.error}`);
  return compiled.evaluate(scope);
}

function failure(text: string, variables: string[] = ["x"]) {
  const compiled = compileExpression(text, variables);
  if (compiled.ok) throw new Error(`${text} compiled`);
  return compiled.detail === undefined ? { error: compiled.error } : { error: compiled.error, detail: compiled.detail };
}

describe("plot expressions", () => {
  it.each([
    ["1", 1],
    [".5", 0.5],
    ["2.5e-3", 0.0025],
    ["1.", 1],
    ["1E2", 100],
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["10 / 4", 2.5],
    ["7 - 2 - 1", 4],
    ["2 ^ 3 ^ 2", 512],
    ["2 ** 3", 8],
    ["-2 ^ 2", -4],
    ["2 ^ -1", 0.5],
    ["--3", 3],
    ["+3", 3],
    ["-+-3", 3],
    ["2pi", 2 * Math.PI],
    ["π", Math.PI],
    ["e", Math.E],
    ["PI", Math.PI],
    ["3sin(pi / 2)", 3],
    ["(1 + 1)(2 + 1)", 6],
    ["2(3)", 6],
    ["pi(2)", 2 * Math.PI],
    ["1/2pi", Math.PI / 2],
    ["6 ÷ 3 × 2 − 1 · 1 ⋅ 1", 3],
    ["min(3, 1, 2)", 1],
    ["max(3)", 3],
    ["max(1, min(5, 4), 2)", 4],
    ["sqrt(16) + abs(-2) + floor(2.7) + ceil(2.1)", 11],
    ["ln(e) + log(1) + log10(1000) + exp(0)", 5],
    ["sinh(0) + cosh(0) + tanh(0) + asin(0) + acos(1) + atan(0) + cos(0) + tan(0)", 2],
  ])("evaluates %s", (text, expected) => {
    expect(value(text)).toBeCloseTo(expected, 12);
  });

  it("reads variables, binds powers tighter than unary minus and multiplies implicitly", () => {
    expect(value("-x^2", { x: 3 })).toBe(-9);
    expect(value("2x^2", { x: 3 })).toBe(18);
    expect(value("x(x + 1)", { x: 3 })).toBe(12);
    expect(value("(x + 1)x", { x: 3 })).toBe(12);
    expect(value("sin(x)cos(x)", { x: 0.3 })).toBeCloseTo(Math.sin(0.3) * Math.cos(0.3), 12);
    expect(value("2 x", { x: 4 })).toBe(8);
    expect(value("X + Sin(0)", { x: 4 })).toBe(4);
    expect(value("max(x, t)", { x: 1, t: 5 })).toBe(5);
    expect(value("min(x, 2) + -x", { x: 1 })).toBe(0);
  });

  it("evaluates the same compiled expression for many scopes", () => {
    const compiled = compileExpression("x^2 - 2x + 1", ["x"]);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.constant).toBe(false);
    const results = Array.from({ length: 601 }, (_value, index) => compiled.evaluate({ x: index - 300 }));
    expect(results[300]).toBe(1);
    expect(results[301]).toBe(0);
    expect(results[0]).toBe(90601);
  });

  it("folds constant expressions", () => {
    const compiled = compileExpression("2 * pi + max(1, 2) - sin(0)", []);
    expect(compiled.ok && compiled.constant).toBe(true);
    expect(compiled.ok && compiled.evaluate({})).toBeCloseTo(2 * Math.PI + 2, 12);
    const mixed = compileExpression("max(x, 1)", ["x"]);
    expect(mixed.ok && mixed.constant).toBe(false);
  });

  it("gives NaN for a listed variable the scope leaves out", () => {
    const compiled = compileExpression("x + 1", ["x"]);
    expect(compiled.ok && Number.isNaN(compiled.evaluate({}))).toBe(true);
  });

  it.each([
    ["", { error: "empty" }],
    ["   ", { error: "empty" }],
    ["y + 1", { error: "name", detail: "y" }],
    ["constructor", { error: "name", detail: "constructor" }],
    ["sin x", { error: "call", detail: "sin" }],
    ["sin", { error: "call", detail: "sin" }],
    ["sin(1, 2)", { error: "arguments", detail: "sin" }],
    ["sin()", { error: "arguments", detail: "sin" }],
    ["max()", { error: "arguments", detail: "max" }],
    ["(1 + 2", { error: "parenthesis" }],
    ["1 + 2)", { error: "parenthesis" }],
    ["()", { error: "parenthesis" }],
    ["max(1, 2", { error: "parenthesis" }],
    ["1 +", { error: "end" }],
    ["2 3", { error: "syntax", detail: "3" }],
    ["1 , 2", { error: "syntax", detail: "," }],
    ["(,)", { error: "syntax", detail: "," }],
    ["* 2", { error: "syntax", detail: "*" }],
    ["2 # 3", { error: "syntax", detail: "#" }],
    ["x @ 1", { error: "syntax", detail: "@" }],
    ["1 😀", { error: "syntax", detail: "😀" }],
  ])("rejects %j", (text, expected) => {
    expect(failure(text)).toEqual(expected);
  });

  it("rejects input that is too long or nested too deeply", () => {
    expect(failure("1+".repeat(MAX_EXPRESSION_LENGTH))).toEqual({ error: "length" });
    expect(failure(`${"(".repeat(MAX_EXPRESSION_DEPTH + 1)}1${")".repeat(MAX_EXPRESSION_DEPTH + 1)}`)).toEqual({
      error: "depth",
    });
    expect(failure(`${"-".repeat(MAX_EXPRESSION_DEPTH + 1)}1`)).toEqual({ error: "depth" });
    expect(failure(Array.from({ length: MAX_EXPRESSION_DEPTH + 2 }, () => "2").join("^"))).toEqual({
      error: "depth",
    });
    expect(value(`${"(".repeat(20)}1${")".repeat(20)}`)).toBe(1);
  });
});
