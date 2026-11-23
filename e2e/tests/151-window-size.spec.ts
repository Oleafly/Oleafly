import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { scriptValue } from "../script-value";

test("the window saves the size it was left at", async ({ tauriPage: page }) => {
  // Ignored on purpose when the runner forces a window size, because the saved size is then not used.
  test.skip(Boolean(process.env.OLEAFLY_E2E_WINDOW), "OLEAFLY_E2E_WINDOW turns the remembered size off.");
  const saved = join(process.env.OLEAFLY_DATA_DIR ?? "", "window.json");
  const read = () =>
    existsSync(saved)
      ? (JSON.parse(readFileSync(saved, "utf8")) as { width: number; height: number; maximized: boolean })
      : null;
  const invoke = (command: string) =>
    page.evaluate(`window.__TAURI_INTERNALS__.invoke(${scriptValue(`plugin:window|${command}`)}, { label: "main" })`);
  const expected = () =>
    page.evaluate<{ width: number; height: number }>(`(async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const size = await invoke("plugin:window|inner_size", { label: "main" });
      const unit = ${process.platform !== "win32"} ? await invoke("plugin:window|scale_factor", { label: "main" }) : 1;
      return { width: Math.round(size.width / unit), height: Math.round(size.height / unit) };
    })()`);

  await invoke("unmaximize");
  await page.evaluate(`import("/src/lib/e2e-probe.ts").then((probe) => probe.resizeCurrentWindow(1000, 700))`);
  await expect
    .poll(async () => {
      const file = read();
      const size = await expected();
      return file && !file.maximized && Math.round(file.width) === size.width && Math.round(file.height) === size.height;
    }, { timeout: 15_000 })
    .toBe(true);
  const normal = read();

  // Ignored on purpose on Linux, because the CI display has no window manager that can maximize.
  test.skip(process.platform === "linux", "The Linux runner has no window manager to maximize with.");
  await invoke("maximize");
  await expect.poll(() => read()?.maximized ?? false, { timeout: 15_000 }).toBe(true);
  expect([read()?.width, read()?.height]).toEqual([normal?.width, normal?.height]);
});
