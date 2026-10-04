import { describe, expect, it } from "vitest";
import { validateXparseArgumentSpecification } from "./latex-xparse";

function problems(specification: string): Array<[string, string]> {
  return validateXparseArgumentSpecification(specification).map((item) => [
    specification.slice(item.from, item.to),
    item.message,
  ]);
}

describe("validateXparseArgumentSpecification", () => {
  it("accepts every supported argument type with its delimiters and defaults", () => {
    const specification = String.raw`m o +m !o >{\Trim}m s t* t\foo t\@ r() R{<}{>}{d} d<> D\x\y{v} e{^_} E{^_}{{a}{b}} O{x} b v`;
    expect(problems(specification)).toEqual([]);
    expect(problems("   ")).toEqual([]);
  });

  it("requires braces around processors and closes them", () => {
    expect(problems(">m")).toEqual([["m", "latex.xparse.bracedProcessor"]]);
    expect(problems(">{x")).toEqual([["{", "latex.xparse.unclosedProcessor"]]);
  });

  it("requires a type after modifiers", () => {
    expect(problems("m +")).toEqual([["+", "latex.xparse.modifiersNeedType"]]);
  });

  it("requires trigger and delimiter tokens", () => {
    expect(problems("t")).toEqual([["t", "latex.xparse.triggerToken"]]);
    expect(problems("r(")).toEqual([["r(", "latex.xparse.delimiterTokens"]]);
    expect(problems("r")).toEqual([["r", "latex.xparse.delimiterTokens"]]);
    expect(problems("r{(")).toEqual([["r", "latex.xparse.delimiterTokens"]]);
  });

  it("requires braced default values and embellishment lists", () => {
    expect(problems("R()")).toEqual([[")", "latex.xparse.bracedDefaultValue"]]);
    expect(problems("O{x")).toEqual([["{", "latex.xparse.unclosedDefaultValue"]]);
    expect(problems("e")).toEqual([["e", "latex.xparse.bracedEmbellishmentList"]]);
    expect(problems("E{^}")).toEqual([["}", "latex.xparse.bracedDefaultList"]]);
    expect(problems("E{^}{")).toEqual([["{", "latex.xparse.unclosedDefaultList"]]);
  });

  it("reports unknown types and keeps checking the rest", () => {
    expect(problems("Z m q")).toEqual([
      ["Z", "latex.xparse.unknownType"],
      ["q", "latex.xparse.unknownType"],
    ]);
  });
});
