import { expect, test } from "@playwright/test";

type Board = { writes: string[]; replace: (content: string) => void; dark: () => void };
type Scene = { elements: { id: string; type: string; isDeleted?: boolean }[] };

const BASE = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";

test("a whiteboard draws, saves, takes outside edits and loads its fonts from the app", async ({ page }) => {
  const pageErrors: string[] = [];
  const remote: string[] = [];
  const fonts: { url: string; status: number }[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(BASE) && !url.startsWith("data:") && !url.startsWith("blob:")) remote.push(url);
  });
  page.on("response", (response) => {
    if (response.url().includes("/excalidraw/fonts/")) fonts.push({ url: response.url(), status: response.status() });
  });

  await page.goto(`${BASE}/e2e/board-harness.html`);
  await expect(page.locator("body")).toHaveAttribute("data-fixture-state", "mounted");
  const canvas = page.locator(".excalidraw canvas.interactive");
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => fonts.some((font) => font.url.includes("/Excalifont/") && font.status === 200), { timeout: 15_000 }).toBe(true);
  expect(fonts.every((font) => font.status === 200)).toBe(true);

  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as { board: Board }).board.writes.length)).toBe(0);

  const box = await canvas.boundingBox();
  if (!box) throw new Error("the board has no canvas");
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.8);
  await page.keyboard.press("r");
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.4, { steps: 8 });
  await page.mouse.up();

  const written = async () =>
    page.evaluate(() => {
      const { writes } = (window as unknown as { board: Board }).board;
      return writes.length > 0 ? (JSON.parse(writes[writes.length - 1]) as Scene) : null;
    });
  await expect.poll(async () => (await written())?.elements.filter((element) => !element.isDeleted).map((element) => element.type).sort(), { timeout: 5_000 }).toEqual([
    "rectangle",
    "text",
  ]);

  await page.evaluate(() => {
    const { board } = window as unknown as { board: Board };
    const scene = JSON.parse(board.writes[board.writes.length - 1]) as Scene;
    board.replace(
      JSON.stringify({
        ...scene,
        elements: [...scene.elements, { id: "outside", type: "ellipse", x: 120, y: 260, width: 90, height: 60, version: 1, versionNonce: 7, seed: 7 }],
      }),
    );
  });
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.8);
  await page.keyboard.press("d");
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.65);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.75, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await written())?.elements.filter((element) => !element.isDeleted).map((element) => element.id), { timeout: 5_000 }).toContain("outside");
  expect((await written())?.elements.filter((element) => !element.isDeleted).map((element) => element.type).sort()).toEqual([
    "diamond",
    "ellipse",
    "rectangle",
    "text",
  ]);

  await page.getByRole("button", { name: "More tools" }).click();
  await expect(page.getByText("Mermaid to Excalidraw")).toBeVisible();
  await expect(page.getByText("Web Embed")).toBeHidden();
  await page.keyboard.press("Escape");
  await page.locator(".main-menu-trigger").click();
  await expect(page.getByText("Export image...")).toBeVisible();
  await expect(page.getByText("GitHub")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.evaluate(() => (window as unknown as { board: Board }).board.dark());
  await expect(page.locator(".excalidraw.theme--dark")).toHaveCount(1);
  await expect(page.locator(".default-sidebar-trigger")).toBeHidden();

  expect(remote).toEqual([]);
  expect(pageErrors).toEqual([]);
});
