import { test, expect } from "../fixtures";
import type { TauriPage } from "@srsholmes/tauri-playwright";
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

const OPEN_OVERFLOW = `(() => {
  const trigger = document.querySelector('[aria-label="More preview controls"]');
  if (!(trigger instanceof HTMLElement)) return false;
  trigger.focus();
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return true;
})()`;

const CLOSE_OVERFLOW = `document.dispatchEvent(
  new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
)`;

/**
 * The current page, however the toolbar is presenting it. Below the collapse
 * threshold the navigation group moves into the overflow menu, which reports
 * "Page N of M" on a submenu trigger and has no page-number input (see the
 * renderMenu comment in PreviewPane). WebView2 lays the bar out wider than
 * WebKit, so Windows collapses at window sizes where Linux and macOS do not.
 */
async function pageValue(tauriPage: TauriPage): Promise<string> {
  const field = tauriPage.locator('[aria-label="Page number"]');
  if (await field.isVisible()) {
    return await tauriPage.evaluate<string>(
      `document.querySelector('[aria-label="Page number"]').value`,
    );
  }
  await tauriPage.evaluate(OPEN_OVERFLOW);
  await expect(tauriPage.getByRole("menu")).toBeVisible();
  const reported = await tauriPage.evaluate<string>(
    `(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find(
        (el) => /^Page \\d+ of \\d+$/.test((el.textContent || "").trim()),
      );
      return item ? (item.textContent || "").trim().split(" ")[1] : "";
    })()`,
  );
  await tauriPage.evaluate(CLOSE_OVERFLOW);
  return reported;
}

/** Step one page in whichever presentation the toolbar is currently using. */
async function stepPage(tauriPage: TauriPage, label: "Next page" | "Previous page") {
  const inline = tauriPage.locator(`[aria-label="${label}"]`);
  if (await inline.isVisible()) {
    await inline.click();
    return;
  }
  await tauriPage.evaluate(OPEN_OVERFLOW);
  await expect(tauriPage.getByRole("menu")).toBeVisible();
  await tauriPage.evaluate(
    `(() => {
      const trigger = [...document.querySelectorAll('[role="menuitem"]')].find(
        (el) => /^Page \\d+ of \\d+$/.test((el.textContent || "").trim()),
      );
      trigger?.click();
      return !!trigger;
    })()`,
  );
  await tauriPage.waitForFunction(
    `[...document.querySelectorAll('[role="menuitem"]')].some(
      (el) => (el.textContent || "").trim() === ${JSON.stringify(label)},
    )`,
    10_000,
  );
  await tauriPage.evaluate(
    `(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find(
        (el) => (el.textContent || "").trim() === ${JSON.stringify(label)},
      );
      item?.click();
      return !!item;
    })()`,
  );
  await tauriPage.evaluate(CLOSE_OVERFLOW);
}

async function selectPageLayout(
  tauriPage: TauriPage,
  label: "Single page view" | "Two-page view",
  value: "single" | "double",
) {
  const inlineControl = tauriPage.locator(
    `[role="radio"][aria-label="${label}"]`,
  );
  if (await inlineControl.isVisible()) {
    await inlineControl.click();
  } else {
    const moreControls = tauriPage.locator(
      '[aria-label="More preview controls"]',
    );
    await moreControls.focus();
    await moreControls.press("Enter");
    const layoutMenu = tauriPage.getByText("Page layout", { exact: true });
    await expect(layoutMenu).toBeVisible();
    await layoutMenu.click();
    const layoutOption = tauriPage.getByText(label, { exact: true });
    await expect(layoutOption).toBeVisible();
    await layoutOption.click();
  }
  await expect(tauriPage.getByTestId("preview-pane")).toHaveAttribute(
    "data-preview-layout",
    value,
  );
}

async function activatePreviewControl(
  tauriPage: TauriPage,
  label: string,
) {
  const direct = tauriPage.locator(
    `[aria-label=${JSON.stringify(label)}]`,
  );
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }

  const moreControls = tauriPage.locator(
    '[aria-label="More preview controls"]',
  );
  await expect(moreControls).toBeVisible();
  // Radix opens this trigger from keyboard activation consistently across
  // WebKitGTK; the bridge's synthetic pointer click can be discarded.
  await moreControls.focus();
  await moreControls.press("Enter");
  const menu = tauriPage.getByRole("menu");
  await expect(menu).toBeVisible();
  await menu.getByText(label, { exact: true }).click();
}

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
    await expect(trigger).toHaveText(
      new RegExp(`${preset.slice(0, -1)}\\s*%`),
    );
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

test("one-page documents hide the layout toggles and bound page navigation", async ({
  tauriPage,
}) => {
  await expect(tauriPage.locator('[aria-label="Two-page view"]')).not.toBeVisible();
  await expect(tauriPage.locator('[aria-label="Single page view"]')).not.toBeVisible();
  await expect(tauriPage.locator('[aria-label="Previous page"]')).toBeDisabled();
  await expect(tauriPage.locator('[aria-label="Next page"]')).toBeDisabled();

  // The page position, however the toolbar is currently showing it. Below the
  // collapse threshold the navigation group moves into the overflow menu, and
  // that form deliberately has no page-number input - it reports "Page N of M"
  // instead (see the renderMenu comment in PreviewPane). Asserting on the input
  // alone therefore fails purely because the window is narrow, which is what
  // WebView2 does at the same size that WebKit still fits.
  const pageField = tauriPage.locator('[aria-label="Page number"]');
  if (await pageField.isVisible()) {
    await expect(pageField).toHaveValue("1");
    return;
  }
  const moreControls = tauriPage.locator('[aria-label="More preview controls"]');
  await expect(moreControls).toBeVisible();
  await moreControls.press("Enter");
  await expect(tauriPage.getByRole("menu")).toBeVisible();
  await expect(tauriPage.getByText("Page 1 of 1", { exact: true })).toBeVisible();
  await tauriPage.evaluate(
    `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
  );
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

  expect(await pageValue(tauriPage)).toBe("1");
  await stepPage(tauriPage, "Next page");
  expect(await pageValue(tauriPage)).toBe("2");
  await stepPage(tauriPage, "Next page");
  expect(await pageValue(tauriPage)).toBe("3");
  await stepPage(tauriPage, "Previous page");
  expect(await pageValue(tauriPage)).toBe("2");

  // Typing a destination only exists in the expanded toolbar - the collapsed
  // form has no input to type into - so exercise it only when it is rendered.
  const pageField = tauriPage.locator('[aria-label="Page number"]');
  if (await pageField.isVisible()) {
    await tauriPage.fill('[aria-label="Page number"]', "1");
    await tauriPage.press('[aria-label="Page number"]', "Enter");
    expect(await pageValue(tauriPage)).toBe("1");
    for (const invalid of ["", "0", "999", "not-a-page"]) {
      await tauriPage.fill('[aria-label="Page number"]', invalid);
      await tauriPage.press('[aria-label="Page number"]', "Enter");
      expect(await pageValue(tauriPage)).toBe("1");
    }
  } else {
    await stepPage(tauriPage, "Previous page");
    expect(await pageValue(tauriPage)).toBe("1");
  }
  // Narrow split panes move page layout into the measured overflow menu.
  // Exercise whichever production presentation is active, then assert the
  // preview's actual layout state rather than assuming the inline buttons fit.
  await selectPageLayout(tauriPage, "Two-page view", "double");
  await stepPage(tauriPage, "Next page");
  expect(await pageValue(tauriPage)).toBe("3");
  await stepPage(tauriPage, "Previous page");
  expect(await pageValue(tauriPage)).toBe("1");
  await selectPageLayout(tauriPage, "Single page view", "single");
});

test("invert colors toggles on and off", async ({ tauriPage }) => {
  // Toggle through whichever form the toolbar is showing and assert the pane's
  // own state: the collapsed menu item carries no aria-pressed.
  const pane = tauriPage.getByTestId("preview-pane");
  await expect(pane).toHaveAttribute("data-preview-inverted", "false");
  await activatePreviewControl(tauriPage, "Invert PDF preview colors");
  await expect(pane).toHaveAttribute("data-preview-inverted", "true");
  await activatePreviewControl(tauriPage, "Invert PDF preview colors");
  await expect(pane).toHaveAttribute("data-preview-inverted", "false");
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
  await activatePreviewControl(tauriPage, "Save PDF to project");
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

  await activatePreviewControl(tauriPage, "Save PDF to project");
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
  await activatePreviewControl(tauriPage, "Save image to project");
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
  await activatePreviewControl(tauriPage, "Open preview in a new window");
  const preview = await tauriPage.waitForWindow((window) => window.label === "preview", {
    timeout: 20_000,
  });
  expect(preview.targetWindow).toBe("preview");
});
