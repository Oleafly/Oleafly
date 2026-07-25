import { test, expect } from "../fixtures";
import {
  compileAndProbe,
  createBlankProject,
  createProjectFromTemplate,
  getCompiledPdfProbe,
  openProject,
  readCompiledPdfBase64,
  readProjectBase64,
  setEditorContent,
} from "../helpers";

test.beforeEach(async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await expect(
    tauriPage.locator('[data-testid="library"][data-projects-loaded="true"]'),
  ).toBeVisible({ timeout: 30_000 });
  const hasBaseline = await tauriPage.evaluate<boolean>(
    `!!document.querySelector('button[aria-label="Open E2E Doc"]')`,
  );
  if (hasBaseline) {
    await openProject(tauriPage, "E2E Doc");
  } else {
    // The native bridge is shared across focused local runs. Recreate the
    // deterministic baseline if another suite intentionally reset its isolated
    // data directory instead of making every preview assertion order-dependent.
    await createBlankProject(tauriPage, "E2E Doc");
  }
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 180_000,
  });
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 30_000 });
  await expect(tauriPage.locator('[data-testid="compile-button"]')).toBeEnabled({ timeout: 60_000 });
});

test("zoom controls change the zoom level", async ({ tauriPage }) => {
  const zoom = () =>
    tauriPage.evaluate<string>(
      `(document.body.innerText.match(/(\\d+)%/) || ["", "?"])[1]`,
    );
  // The preview auto-fits to page height once, deferred a requestAnimationFrame
  // after the PDF becomes visible. Reading `before` immediately can race that
  // and capture the pre-auto-fit value, making the later zoom-out assertion
  // compare against a level the app never actually returns to. Poll until two
  // consecutive reads agree before treating it as the stable baseline.
  let before = await zoom();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const reread = await zoom();
    if (reread === before) break;
    before = reread;
  }
  await tauriPage.click('[aria-label="Zoom in"]');
  const after = await zoom();
  expect(Number(after)).toBeGreaterThan(Number(before));
  await tauriPage.click('[aria-label="Zoom out"]');
  expect(await zoom()).toBe(before);
});

test("zoom menu applies presets and calculated fit scales", async ({ tauriPage }) => {
  const trigger = tauriPage.locator('[aria-haspopup="menu"][aria-label^="Zoom "]');
  const openMenu = async () => {
    await trigger.focus();
    await trigger.press("Enter");
    await expect(tauriPage.getByRole("menu")).toBeVisible();
  };

  for (const preset of ["25%", "50%", "75%", "100%", "150%", "200%", "400%"]) {
    await openMenu();
    await tauriPage.getByRole("menu").getByText(preset, { exact: true }).click();
    await expect(trigger).toHaveText(new RegExp(preset.replace("%", "\\s*%")));
  }
  await expect(tauriPage.locator('button[aria-label="Zoom in"]')).toBeDisabled();

  await openMenu();
  await tauriPage.getByRole("menu").getByText("100%", { exact: true }).click();
  await openMenu();
  await tauriPage.getByRole("menu").getByText("Zoom in", { exact: true }).click();
  await expect(trigger).toHaveText(/120\s*%/);
  await openMenu();
  await tauriPage.getByRole("menu").getByText("Zoom out", { exact: true }).click();
  await expect(trigger).toHaveText(/100\s*%/);

  await openMenu();
  await tauriPage.getByRole("menu").getByText("Fit to width", { exact: true }).click();
  const widthScale = Number((await trigger.textContent())?.match(/\d+/)?.[0]);
  expect(widthScale).toBeGreaterThanOrEqual(25);
  expect(widthScale).toBeLessThan(400);

  await openMenu();
  await tauriPage.getByRole("menu").getByText("Fit to height", { exact: true }).click();
  const heightScale = Number((await trigger.textContent())?.match(/\d+/)?.[0]);
  expect(heightScale).toBeGreaterThanOrEqual(25);
  expect(heightScale).toBeLessThan(400);
});

test("one-page documents hide two-page layout and bound page navigation", async ({
  tauriPage,
}) => {
  await expect(tauriPage.locator('[aria-label="Two-page view"]')).not.toBeVisible();
  await expect(tauriPage.locator('[aria-label="Single page view"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(tauriPage.locator('[aria-label="Previous page"]')).toBeDisabled();
  await expect(tauriPage.locator('[aria-label="Next page"]')).toBeDisabled();
  await expect(tauriPage.locator('[aria-label="Page number"]')).toHaveValue("1");
});

test("multi-page layout, previous/next, and direct page jump all navigate", async ({
  tauriPage,
}) => {
  await tauriPage.click('[aria-label="Home"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible({ timeout: 30_000 });
  await createBlankProject(tauriPage, `E2E Preview Pages ${Date.now().toString(36)}`);
  await setEditorContent(
    tauriPage,
    String.raw`\documentclass{article}
\begin{document}
Page one
\newpage
Page two
\newpage
Page three
\end{document}
`,
  );
  await compileAndProbe(tauriPage, 150_000);
  await tauriPage.waitForFunction(
    `(document.body.innerText || '').includes('of 3')`,
    120_000,
  );

  const page = tauriPage.locator('[aria-label="Page number"]');
  await expect(page).toHaveValue("1");
  await tauriPage.click('[aria-label="Next page"]');
  await expect(page).toHaveValue("2");
  await tauriPage.click('[aria-label="Next page"]');
  await expect(page).toHaveValue("3");
  await tauriPage.click('[aria-label="Previous page"]');
  await expect(page).toHaveValue("2");

  await tauriPage.fill('[aria-label="Page number"]', "1");
  await tauriPage.press('[aria-label="Page number"]', "Enter");
  await expect(page).toHaveValue("1");
  for (const invalid of ["", "0", "999", "not-a-page"]) {
    await tauriPage.fill('[aria-label="Page number"]', invalid);
    await tauriPage.press('[aria-label="Page number"]', "Enter");
    await expect(page).toHaveValue("1");
  }
  await tauriPage.click('[aria-label="Two-page view"]');
  await expect(tauriPage.locator('[aria-label="Two-page view"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await tauriPage.click('[aria-label="Next page"]');
  await expect(page).toHaveValue("3");
  await tauriPage.click('[aria-label="Previous page"]');
  await expect(page).toHaveValue("1");
  await tauriPage.click('[aria-label="Single page view"]');
  await expect(tauriPage.locator('[aria-label="Single page view"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("invert colors toggles on and off", async ({ tauriPage }) => {
  await tauriPage.click('[aria-label="Invert PDF preview colors"]');
  await expect(
    tauriPage.locator('[aria-label="Invert PDF preview colors"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await tauriPage.click('[aria-label="Invert PDF preview colors"]');
  await expect(
    tauriPage.locator('[aria-label="Invert PDF preview colors"]'),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible();
});

test("logs control toggles back to the PDF preview", async ({ tauriPage }) => {
  await tauriPage.click('[aria-label="Show compile logs"]');
  await expect(tauriPage.locator('[aria-label="Show PDF preview"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(tauriPage.getByText("Copy log")).toBeVisible();
  await tauriPage.click('[aria-label="Show PDF preview"]');
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible();
});

test("save PDF writes the exact compiled bytes at the requested relative path and reports failures", async ({
  tauriPage,
}) => {
  const compiledBase64 = await readCompiledPdfBase64(tauriPage);
  expect((await getCompiledPdfProbe(tauriPage)).text).toContain("Introduction");
  await tauriPage.click('[aria-label="Save PDF to project"]');
  const name = `e2e-saved-${Date.now().toString(36)}.pdf`;
  const path = `exports/${name}`;
  await tauriPage.fill('[aria-label="Project save name"]', path);
  await tauriPage.getByText("Save", { exact: true }).click();
  await tauriPage.waitForFunction(
    `!document.querySelector('[role="dialog"][aria-labelledby="save-preview-title"]')`,
    20_000,
  );
  const savedBase64 = await readProjectBase64(tauriPage, path);
  expect(savedBase64).toBe(compiledBase64);
  expect(Buffer.from(savedBase64, "base64").subarray(0, 5).toString("ascii")).toBe("%PDF-");

  await tauriPage.click('[aria-label="Save PDF to project"]');
  await tauriPage.fill('[aria-label="Project save name"]', "../outside-project.pdf");
  await tauriPage.getByText("Save", { exact: true }).click();
  await expect(tauriPage.getByText("Couldn't save into the project.", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(tauriPage.locator('[aria-label="Project save name"]')).toBeVisible();
});

test("save image writes a real nonblank PNG at the requested relative path", async ({
  tauriPage,
}) => {
  await tauriPage.click('[aria-label="Home"]');
  await createProjectFromTemplate(
    tauriPage,
    "diagram",
    `E2E preview image ${Date.now().toString(36)}`,
  );
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute(
    "data-severity",
    "ok",
    { timeout: 180_000 },
  );
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 30_000 });
  await tauriPage.click('[aria-label="Save image to project"]');
  const path = `renders/result-${Date.now().toString(36)}.png`;
  await tauriPage.fill('[aria-label="Project save name"]', path);
  await tauriPage.getByText("Save", { exact: true }).click();
  await tauriPage.waitForFunction(
    `!document.querySelector('[role="dialog"][aria-labelledby="save-preview-title"]')`,
    30_000,
  );
  const png = Buffer.from(await readProjectBase64(tauriPage, path), "base64");
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBeGreaterThan(0);
  expect(png.readUInt32BE(20)).toBeGreaterThan(0);
  const nonblank = await tauriPage.evaluate<number>(
    `(async () => {
      const bytes = Uint8Array.from(
        atob(${JSON.stringify(png.toString("base64"))}),
        char => char.charCodeAt(0)
      );
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (
          pixels[index + 3] > 0 &&
          (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245)
        ) count += 1;
      }
      bitmap.close();
      return count;
    })()`,
  );
  expect(nonblank).toBeGreaterThan(100);
});

test("copy log writes the exact visible payload and log scrolling reaches both boundaries", async ({
  tauriPage,
}) => {
  await tauriPage.getByText("Logs").click();
  const raw = await tauriPage.evaluate<string>(
    `window.__e2eRenderedCompileLog ?? ""`,
  );
  expect(raw.length).toBeGreaterThan(0);
  expect(await tauriPage.evaluate<boolean>(
    `(() => {
      window.__e2eCopiedLog = null;
      try {
        Object.defineProperty(navigator.clipboard, "writeText", {
          configurable: true,
          value: async text => { window.__e2eCopiedLog = text; }
        });
        return true;
      } catch {
        return false;
      }
    })()`,
  )).toBe(true);
  await tauriPage.getByText("Copy log").click();
  await expect(tauriPage.getByText("Copied")).toBeVisible();
  expect(await tauriPage.evaluate<string>(`window.__e2eCopiedLog ?? ""`)).toBe(raw);

  await tauriPage.evaluate(
    `(() => {
      const box = document.querySelector('[data-testid="compile-log-scroll"]');
      box.style.flex = "none";
      box.style.height = "80px";
      box.scrollTop = Math.floor(box.scrollHeight / 2);
      return true;
    })()`,
  );
  await tauriPage.click('[aria-label="Scroll to bottom"]');
  await new Promise((resolve) => setTimeout(resolve, 900));
  expect(await tauriPage.evaluate<boolean>(
    `(() => {
      const box = document.querySelector('[data-testid="compile-log-scroll"]');
      return box.scrollTop >= box.scrollHeight - box.clientHeight - 1;
    })()`,
  )).toBe(true);
  await tauriPage.click('[aria-label="Scroll to top"]');
  await new Promise((resolve) => setTimeout(resolve, 900));
  expect(await tauriPage.evaluate<number>(
    `document.querySelector('[data-testid="compile-log-scroll"]').scrollTop`,
  )).toBeLessThanOrEqual(1);
});

test("fullscreen controls hide, restore, and exit the preview toolbar", async ({
  tauriPage,
}) => {
  await tauriPage.click('[aria-label="Fullscreen preview"]');
  await expect(tauriPage.locator('[aria-label="Exit fullscreen"]')).toBeVisible({
    timeout: 10_000,
  });
  await tauriPage.click('[aria-label="Hide toolbar"]');
  await expect(tauriPage.locator('[aria-label="Show toolbar"]')).toBeVisible();
  await tauriPage.click('[aria-label="Show toolbar"]');
  await expect(tauriPage.locator('[aria-label="Exit fullscreen"]')).toBeVisible();
  await tauriPage.click('[aria-label="Exit fullscreen"]');
  await expect(tauriPage.locator('[aria-label="Fullscreen preview"]')).toBeVisible();
});

test("open-in-window control creates the detached preview window", async ({
  tauriPage,
}) => {
  await tauriPage.click('[aria-label="Open preview in a new window"]');
  const preview = await tauriPage.waitForWindow((window) => window.label === "preview", {
    timeout: 20_000,
  });
  expect(preview.targetWindow).toBe("preview");
});
