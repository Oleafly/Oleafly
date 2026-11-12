// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { MAX_SVG_CHARS, paintSvg, SVG_TEMPLATE, sanitizeSvg, svgBlock, svgDataUrl } from "./svg-block";
import "./tests/setup";

function clean(source: string): string {
  const result = sanitizeSvg(source);
  if (!result.ok) throw new Error(result.problem);
  return result.svg;
}

describe("sanitizeSvg", () => {
  it("removes scripts, handlers, foreign objects, links and animations", () => {
    const svg = clean(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
      <script>alert(2)</script>
      <foreignObject><div>html</div></foreignObject>
      <a href="https://evil.example"><circle r="4" onclick="alert(3)"/></a>
      <set attributeName="href" to="javascript:alert(4)"/>
      <animate attributeName="x" values="0;1"/>
      <rect width="2" height="2"/>
    </svg>`);
    expect(svg).not.toMatch(/script|onload|onclick|foreignObject|<a\b|evil|<set|<animate|javascript/iu);
    expect(svg).toContain("<rect");
    expect(svg).toContain("<circle");
  });

  it("drops external references and keeps local ones", () => {
    const svg = clean(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs><linearGradient id="g"/></defs>
      <use href="#g"/>
      <use xlink:href="https://evil.example/sprite.svg#x"/>
      <image href="https://evil.example/cat.png"/>
      <image href="data:image/png;base64,AA=="/>
      <rect style="fill: url(https://evil.example/f.svg); stroke: url(#g)"/>
      <style>@import url(https://evil.example/s.css); rect { fill: url('//evil.example/p') }</style>
    </svg>`);
    expect(svg).not.toContain("evil.example");
    expect(svg).not.toContain("<use");
    expect(svg).toContain("data:image/png;base64,AA==");
    expect(svg).toContain("url(#g)");
  });

  it("scans unclosed CSS urls in linear time", () => {
    const unclosed = "url(".repeat(50_000);
    const started = performance.now();
    const svg = clean(`<svg xmlns="http://www.w3.org/2000/svg"><style>${unclosed}</style><rect style="fill: ${unclosed}"/></svg>`);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(svg.split("url(")).toHaveLength(100_001);
  });

  it("adds the namespace when the source leaves it out", () => {
    expect(clean('<svg viewBox="0 0 1 1"><rect/></svg>')).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("rejects empty, oversized and non-SVG sources", () => {
    expect(sanitizeSvg("  ")).toEqual({ ok: false, problem: "empty" });
    expect(sanitizeSvg(`<svg>${"x".repeat(MAX_SVG_CHARS)}</svg>`)).toEqual({ ok: false, problem: "large" });
    expect(sanitizeSvg("<div>not svg</div>")).toEqual({ ok: false, problem: "invalid" });
    expect(sanitizeSvg("<svg><text>a&nbsp;b</text></svg>")).toEqual({ ok: false, problem: "invalid" });
  });
});

describe("paintSvg", () => {
  it("draws the sanitized SVG through an image with its title as the alt text", () => {
    const preview = document.createElement("div");
    expect(paintSvg(preview, SVG_TEMPLATE)).toBeUndefined();
    const image = preview.querySelector("img") as HTMLImageElement;
    expect(image.alt).toBe("Two-state system");
    expect(image.src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(image.src)).toContain("<circle");
    paintSvg(preview, '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    expect((preview.querySelector("img") as HTMLImageElement).alt).toBe(enNotes.blocks.svg.alt);
  });

  it.each([
    ["", enNotes.blocks.svg.empty],
    ["<p>x</p>", enNotes.blocks.svg.invalid],
    [`<svg>${"x".repeat(MAX_SVG_CHARS)}</svg>`, enNotes.blocks.svg.tooLarge],
  ])("explains a bad source %#", (source, message) => {
    const preview = document.createElement("div");
    paintSvg(preview, source);
    expect(preview.textContent).toBe(message);
  });

  it("registers as the svg block with a template", () => {
    expect(svgBlock.name).toBe("svg");
    expect(svgBlock.label()).toBe("SVG");
    expect(svgBlock.template?.()).toEqual({ info: "svg", source: SVG_TEMPLATE });
    const preview = document.createElement("div");
    expect(svgBlock.paint(preview, SVG_TEMPLATE, { still: true })).toBeUndefined();
    expect(svgDataUrl("<svg/>")).toBe("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E");
  });
});
