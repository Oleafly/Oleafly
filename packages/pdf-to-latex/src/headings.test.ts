import { describe, expect, it } from "vitest";
import { bodyFontSize, classifyHeadings } from "./headings";
import type { Para } from "./lines";

const para = (text: string, fontSize: number): Para => ({
  lines: [{ items: [], y: 0, text, fontSize, x0: 0, x1: 100 }],
  text,
  fontSize,
});

describe("classifyHeadings", () => {
  const paras = [
    para("Title Size 18", 18),
    para("Section Size 14", 14),
    para("Body text ".repeat(5), 10),
    para("Sub Size 12", 12),
    para("More body", 10),
  ];

  it("body size is the modal size", () => {
    expect(bodyFontSize(paras)).toBe(10);
  });

  it("larger sizes become descending heading levels", () => {
    const h = classifyHeadings(paras);
    expect(h.get(paras[0])).toBe(1);
    expect(h.get(paras[1])).toBe(2);
    expect(h.get(paras[3])).toBe(3);
    expect(h.has(paras[2])).toBe(false);
  });

  it("long paragraphs are never headings even if large", () => {
    const long = para("word ".repeat(60), 14);
    expect(classifyHeadings([long, ...paras]).has(long)).toBe(false);
  });

  it("sentences ending with punctuation are not headings", () => {
    const sentence = para("This ends with a period.", 14);
    expect(classifyHeadings([sentence, ...paras]).has(sentence)).toBe(false);
  });
});
