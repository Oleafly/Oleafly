import { describe, expect, it } from "vitest";
import { escapeRegExp } from "./regexp";

describe("escapeRegExp", () => {
  it("lets an environment name with metacharacters match literally", () => {
    const pattern = new RegExp(String.raw`\\begin\{${escapeRegExp("align*")}\}`);
    expect(pattern.test(String.raw`\begin{align*}`)).toBe(true);
    expect(pattern.test(String.raw`\begin{alignnn}`)).toBe(false);
  });

  it("escapes every regular expression metacharacter", () => {
    expect(escapeRegExp(String.raw`.*+?^$a{}()|[]\\`)).toBe(String.raw`\.\*\+\?\^\$a\{\}\(\)\|\[\]\\\\`);
  });
});
