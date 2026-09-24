import { expect, test } from "@playwright/test";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";

type Jump = { line: number; offset: number; drift: number };
type Journey = { rowHeight: number; jumps: Jump[]; warnings: string[] };
type Harness = { jumpThrough(width: number, lines: number[]): Promise<Journey> };

const BOOK_JUMPS = [1_100, 3_100, 5_100, 3_165, 4_700, 420, 432, 3_480];
const EDITOR_WIDTHS = [360, 480, 600, 720];

test.describe("go to line in a long book", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/e2e/editor-jump-harness.html`);
    await page.waitForFunction(() => "__editorJump" in window, null, { timeout: 60_000 });
  });

  for (const width of EDITOR_WIDTHS) {
    test(`centers each target line and keeps the gutter aligned at ${width}px`, async ({ page }) => {
      const journey = await page.evaluate(
        ([editorWidth, lines]) =>
          (window as unknown as { __editorJump: Harness }).__editorJump.jumpThrough(editorWidth, lines),
        [width, BOOK_JUMPS] as const,
      );

      expect(journey.warnings.filter((warning) => /stabilize|restarted/.test(warning))).toEqual([]);
      for (const jump of journey.jumps) {
        expect(Math.abs(jump.offset), `line ${jump.line} lands near the middle`).toBeLessThanOrEqual(
          journey.rowHeight * 2,
        );
        expect(jump.drift, `line ${jump.line} keeps its number beside it`).toBeLessThanOrEqual(1.5);
      }
    });
  }
});
