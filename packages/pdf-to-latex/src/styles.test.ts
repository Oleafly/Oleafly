import { describe, expect, it } from "vitest";
import { buildLines } from "./lines";
import { renderLineText } from "./styles";
import type { TextItem } from "./types";

const item = (str: string, x: number, over: Partial<TextItem> = {}): TextItem => ({
  str,
  x,
  y: 700,
  width: str.length * 5,
  height: 10,
  fontName: "ABCDEF+Times",
  fontSize: 10,
  ...over,
});

const esc = (s: string) => s;

describe("renderLineText", () => {
  it("wraps bold and italic runs", () => {
    const line = buildLines([
      item("plain", 0),
      item("loud", 40, { fontName: "ABCDEF+Times-Bold" }),
      item("slanted", 80, { fontName: "ABCDEF+Times-Italic" }),
    ])[0];
    expect(renderLineText(line, esc)).toBe("plain \\textbf{loud} \\textit{slanted}");
  });

  it("merges adjacent same-style items into one command", () => {
    const line = buildLines([
      item("very", 0, { fontName: "F+Helvetica-Bold" }),
      item("loud", 30, { fontName: "F+Helvetica-Bold" }),
    ])[0];
    expect(renderLineText(line, esc)).toBe("\\textbf{very loud}");
  });

  it("renders a raised small item as superscript", () => {
    const line = buildLines([item("x", 0), item("2", 8, { y: 704, fontSize: 6.5 })])[0];
    expect(renderLineText(line, esc)).toBe("x\\textsuperscript{2}");
  });

  it("renders a lowered small item as subscript", () => {
    const line = buildLines([
      item("H", 0),
      item("2", 8, { y: 697, fontSize: 6.5 }),
      item("O", 14),
    ])[0];
    expect(renderLineText(line, esc)).toBe("H\\textsubscript{2}O");
  });

  it("monospace fonts become texttt", () => {
    const line = buildLines([item("code", 0, { fontName: "F+Courier" })])[0];
    expect(renderLineText(line, esc)).toBe("\\texttt{code}");
  });

  it("applies the escape callback to run text", () => {
    const line = buildLines([item("50%", 0)])[0];
    expect(renderLineText(line, (s) => s.replace("%", "\\%"))).toBe("50\\%");
  });
});
