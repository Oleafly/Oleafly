import { tourExpect as expect, tourTest as test } from "../fixtures";
import { createProjectFromTemplate } from "../helpers";

test.skip(
  process.env.OLEAFLY_E2E_PRODUCTION !== "1",
  "requires an embedded production build, not the Vite-backed dev app",
);

test("the packaged editor accepts CodeMirror runtime styles", async ({ tauriPage }) => {
  test.setTimeout(120_000);

  await tauriPage.evaluate(`(() => {
    window.__oleaflyStyleCspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      if (event.violatedDirective.startsWith("style-src")) {
        window.__oleaflyStyleCspViolations.push({
          directive: event.violatedDirective,
          blockedURI: event.blockedURI,
        });
      }
    });
  })()`);

  await createProjectFromTemplate(
    tauriPage,
    "resume",
    `E2E Packaged Editor CSP ${Date.now().toString(36)}`,
  );

  await expect
    .poll(
      async () =>
        tauriPage.evaluate<boolean>(`(() => {
          const scroller = document.querySelector(".cm-scroller");
          if (!(scroller instanceof HTMLElement)) return false;
          const viewport = scroller.getBoundingClientRect();
          const visibleLines = Array.from(document.querySelectorAll(".cm-line"))
            .filter((line) => {
              const rect = line.getBoundingClientRect();
              return Boolean(line.textContent?.trim()) && rect.width > 0 && rect.height > 0 &&
                rect.bottom > viewport.top && rect.top < viewport.bottom;
            });
          const markers = Array.from(document.querySelectorAll(".cm-fold-marker svg"));
          return visibleLines.length > 0 && markers.length > 0;
        })()`),
      { timeout: 30_000 },
    )
    .toBe(true);

  const evidence = await tauriPage.evaluate<{
    href: string;
    acceptedRuntimeStyles: number;
    styleViolations: Array<{ directive: string; blockedURI: string }>;
    visibleNonblankLines: number;
    hitTestedLines: number;
    foldMarkerCount: number;
    largestFoldMarkerWidth: number;
    largestFoldMarkerHeight: number;
  }>(`(() => {
    const acceptedRuntimeStyles = Array.from(document.head.querySelectorAll("style"))
      .filter((style) => style.textContent?.includes(".cm-content"))
      .filter((style) => {
        try {
          return Boolean(style.sheet && style.sheet.cssRules.length > 0);
        } catch {
          return false;
        }
      }).length;
    const scroller = document.querySelector(".cm-scroller");
    if (!(scroller instanceof HTMLElement)) throw new Error("CodeMirror scroller missing");
    const viewport = scroller.getBoundingClientRect();
    const visibleLines = Array.from(document.querySelectorAll(".cm-line"))
      .filter((line) => {
        const rect = line.getBoundingClientRect();
        return Boolean(line.textContent?.trim()) && rect.width > 0 && rect.height > 0 &&
          rect.bottom > viewport.top && rect.top < viewport.bottom;
      });
    let hitTestedLines = 0;
    for (const line of visibleLines) {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      const textNode = walker.nextNode();
      if (!textNode) continue;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rect = range.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + 2, rect.top + rect.height / 2);
      if (top === line || (top instanceof Node && line.contains(top))) hitTestedLines++;
    }
    const markerRects = Array.from(document.querySelectorAll(".cm-fold-marker svg"))
      .map((marker) => marker.getBoundingClientRect());
    return {
      href: location.href,
      acceptedRuntimeStyles,
      styleViolations: window.__oleaflyStyleCspViolations ?? [],
      visibleNonblankLines: visibleLines.length,
      hitTestedLines,
      foldMarkerCount: markerRects.length,
      largestFoldMarkerWidth: Math.max(0, ...markerRects.map((rect) => rect.width)),
      largestFoldMarkerHeight: Math.max(0, ...markerRects.map((rect) => rect.height)),
    };
  })()`);

  expect(evidence.href).not.toMatch(/^https?:\/\/localhost(?::\d+)?\//);
  expect(evidence.acceptedRuntimeStyles).toBeGreaterThan(0);
  expect(evidence.styleViolations).toEqual([]);
  expect(evidence.visibleNonblankLines).toBeGreaterThan(0);
  expect(evidence.hitTestedLines).toBeGreaterThan(0);
  expect(evidence.foldMarkerCount).toBeGreaterThan(0);
  expect(evidence.largestFoldMarkerWidth).toBeLessThanOrEqual(16);
  expect(evidence.largestFoldMarkerHeight).toBeLessThanOrEqual(16);
});
