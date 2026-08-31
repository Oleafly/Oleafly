import { expect, test } from "@playwright/test";

test("chat math keeps KaTeX fonts and vertical layout in the browser", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("http://localhost:1420/e2e/markdown-rendering-harness.html");
  await expect(page.locator("body")).toHaveAttribute("data-fixture-state", "mounted");
  await expect(page.locator(".katex-display")).toHaveCount(4);

  const result = await page.evaluate(async () => {
    const requiredFonts = [
      { family: "KaTeX_Main", query: "16px KaTeX_Main" },
      { family: "KaTeX_Math", query: "italic 16px KaTeX_Math" },
      { family: "KaTeX_Size1", query: "16px KaTeX_Size1" },
      { family: "KaTeX_Size4", query: "16px KaTeX_Size4" },
    ];
    const loadedFonts = await Promise.all(
      requiredFonts.map(async ({ family, query }) => ({
        family,
        faces: await document.fonts.load(query),
      })),
    );
    const math = document.querySelector<HTMLElement>(".chat-markdown .katex");
    const descendant = document.querySelector<HTMLElement>(".chat-markdown .katex .mord");
    const base = document.querySelector<HTMLElement>(".chat-markdown .katex-base");
    const strut = document.querySelector<HTMLElement>(".chat-markdown .katex-strut");
    const display = document.querySelector<HTMLElement>(".chat-markdown .katex-display");
    const script = document.querySelector<HTMLElement>(".chat-markdown .msupsub");
    const fraction = document.querySelector<HTMLElement>(".chat-markdown .mfrac > span > span");
    const vlist = document.querySelector<HTMLElement>(".chat-markdown .vlist");
    const fontFaces = loadedFonts.map(({ family, faces }) => ({
      family,
      matches: faces.length,
      loaded: faces.length > 0 && faces.every((face) => face.status === "loaded"),
    }));
    return {
      baseDisplay: base ? getComputedStyle(base).display : null,
      descendantLineHeight: descendant ? getComputedStyle(descendant).lineHeight : null,
      descendantWhiteSpace: descendant ? getComputedStyle(descendant).whiteSpace : null,
      displayMarginBottom: display ? Number.parseFloat(getComputedStyle(display).marginBottom) : 0,
      displayMarginTop: display ? Number.parseFloat(getComputedStyle(display).marginTop) : 0,
      displayOverflowX: display ? getComputedStyle(display).overflowX : null,
      displayTextAlign: display ? getComputedStyle(display).textAlign : null,
      fontFaces,
      fractionTextAlign: fraction ? getComputedStyle(fraction).textAlign : null,
      mathLineHeight: math ? getComputedStyle(math).lineHeight : null,
      scriptTextAlign: script ? getComputedStyle(script).textAlign : null,
      strutDisplay: strut ? getComputedStyle(strut).display : null,
      vlistVerticalAlign: vlist ? getComputedStyle(vlist).verticalAlign : null,
    };
  });

  expect(result.fontFaces).toHaveLength(4);
  expect(result.fontFaces.every((font) => font.matches > 0)).toBe(true);
  expect(result.fontFaces.every((face) => face.loaded)).toBe(true);
  expect(result.baseDisplay).toBe("inline-block");
  expect(result.strutDisplay).toBe("inline-block");
  expect(result.mathLineHeight).toBe("normal");
  expect(result.descendantLineHeight).toBe("normal");
  expect(result.descendantWhiteSpace).toBe("normal");
  expect(result.scriptTextAlign).toBe("left");
  expect(result.fractionTextAlign).toBe("center");
  expect(result.vlistVerticalAlign).toBe("bottom");
  expect(result.displayTextAlign).toBe("center");
  expect(result.displayOverflowX).toBe("auto");
  expect(result.displayMarginTop).toBeGreaterThan(0);
  expect(result.displayMarginBottom).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});
