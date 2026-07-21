import { describe, expect, it } from "vitest";
import type { Line } from "./lines";
import { stripRepeatedFurniture } from "./strip";

const line = (text: string, y: number): Line => ({
  items: [],
  y,
  text,
  fontSize: 10,
  x0: 0,
  x1: 100,
});
const page = (...ls: Line[]) => ls;

describe("stripRepeatedFurniture", () => {
  it("drops running heads repeated across pages", () => {
    const pages = [
      page(line("My Paper", 790), line("intro text", 400)),
      page(line("My Paper", 790), line("more text", 400)),
      page(line("My Paper", 791), line("end text", 400)),
    ];
    const out = stripRepeatedFurniture(pages, [800, 800, 800]);
    expect(out.every((p) => p.every((l) => l.text !== "My Paper"))).toBe(true);
    expect(out[0].some((l) => l.text === "intro text")).toBe(true);
  });

  it("drops bare page numbers in the footer band", () => {
    const pages = [
      page(line("1", 20), line("body", 400)),
      page(line("2", 20), line("body2", 400)),
      page(line("3", 20), line("body3", 400)),
    ];
    const out = stripRepeatedFurniture(pages, [800, 800, 800]);
    expect(out.flat().every((l) => !/^\d+$/.test(l.text))).toBe(true);
  });

  it("keeps mid-page text that happens to repeat", () => {
    const pages = [
      page(line("repeated", 400), line("a", 300)),
      page(line("repeated", 400), line("b", 300)),
      page(line("repeated", 400), line("c", 300)),
    ];
    const out = stripRepeatedFurniture(pages, [800, 800, 800]);
    expect(out[0].some((l) => l.text === "repeated")).toBe(true);
  });

  it("keeps everything on short documents", () => {
    const pages = [page(line("1", 20), line("body", 400))];
    expect(stripRepeatedFurniture(pages, [800]).flat()).toHaveLength(2);
  });
});
