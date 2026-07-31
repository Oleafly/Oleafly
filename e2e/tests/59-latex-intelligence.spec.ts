import { test, expect } from "../fixtures";
import {
  createBlankProject,
  pressGlobal,
  replaceEditorSource,
  typeInEditorAfter,
  type Page,
} from "../helpers";

// Verifies the LaTeX Workshop intelligence adoption end to end: corpus
// package completion, package-gated commands, and % !TEX root handling.

async function completionEntries(
  page: Page,
): Promise<{ label: string; detail: string }[]> {
  return await page.evaluate<{ label: string; detail: string }[]>(
    `[...document.querySelectorAll('.cm-tooltip-autocomplete li[role="option"]')].map((li) => ({
      label: li.querySelector('.cm-completionLabel')?.textContent ?? '',
      detail: li.querySelector('.cm-completionDetail')?.textContent ?? '',
    }))`,
  );
}

async function waitForCompletion(page: Page, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const open = await page.evaluate<boolean>(
      `!!document.querySelector('.cm-tooltip-autocomplete li[role="option"]')`,
    );
    if (open) return;
    if (Date.now() > deadline) {
      throw new Error("completion tooltip did not open");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function removeEditorText(page: Page, needle: string) {
  await page.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      const source = view.state.doc.toString();
      const from = source.indexOf(${JSON.stringify(needle)});
      if (from >= 0) view.dispatch({ changes: { from, to: from + ${needle.length}, insert: "" } });
      return true;
    })`,
  );
}

async function waitForSettledIndex(page: Page, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const settled = await page.evaluate<boolean>(
      `import("/src/store/project-index.ts").then((indexModule) => {
        const state = indexModule.useIndexStore.getState().intelligenceState;
        return !!state && state.stale === false &&
          (state.data?.detectedPackages ?? []).includes("siunitx");
      })`,
    );
    if (settled) return;
    if (Date.now() > deadline) {
      throw new Error("project intelligence never settled on siunitx");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function maybeScreenshot(page: Page, name: string) {
  const dir = process.env.OLEAFLY_E2E_SHOTS;
  if (!dir) return;
  try {
    await (page as unknown as {
      screenshot(options: { path: string }): Promise<unknown>;
    }).screenshot({ path: `${dir}/${name}` });
  } catch {
    // Screenshotting is best-effort diagnostics only.
  }
}

test("corpus package completion is curated and package-gated", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  await createBlankProject(tauriPage, "Latex Intel");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({
    timeout: 20_000,
  });
  await replaceEditorSource(
    tauriPage,
    "\\documentclass{article}\n\\usepackage{siunitx}\n\\begin{document}\nBody text anchor.\n\\end{document}\n",
  );
  // Persist the seed and give the project index a full compile's worth of
  // time — unsaved template edits are not what the worker analyzes.
  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute(
    "data-severity",
    "ok",
    { timeout: 90_000 },
  );

  // Empty-query package completion: curated, no hidden directories.
  await typeInEditorAfter(
    tauriPage,
    "\\usepackage{siunitx}",
    "\n\\usepackage{",
  );
  await waitForCompletion(tauriPage);
  const emptyQuery = await completionEntries(tauriPage);
  await maybeScreenshot(tauriPage, "e2e-pkg-empty.png");
  expect(
    emptyQuery.some((entry) => entry.label.startsWith(".")),
  ).toBe(false);

  // Narrowed query surfaces the corpus entry with its CTAN description.
  // The probe package differs from the seeded one so the cleanup needle
  // cannot collide with the real \\usepackage{siunitx} line.
  await typeInEditorAfter(tauriPage, "\\usepackage{", "geome", 2);
  await waitForCompletion(tauriPage);
  const narrowed = await completionEntries(tauriPage);
  await maybeScreenshot(tauriPage, "e2e-pkg-query.png");
  const geometry = narrowed.find(
    (entry) => entry.label === "geometry",
  );
  expect(geometry).toBeTruthy();
  expect(geometry?.detail.length ?? 0).toBeGreaterThan(0);
  await removeEditorText(tauriPage, "\n\\usepackage{geome");

  // Package-gated command completion (modern siunitx interface; the
  // deprecated \\SI is corpus-flagged unusual and deliberately hidden).
  // Completion reads the snapshot only once analysis settles, so wait for a
  // fresh non-stale snapshot that has detected siunitx before probing —
  // further edits would keep resetting the debounced analysis.
  await waitForSettledIndex(tauriPage);
  // The snapshot-backed source serves only non-stale queries whose text
  // matches the indexed revision, so type the probe, let analysis settle,
  // then re-trigger completion without typing (Ctrl-Space).
  await typeInEditorAfter(tauriPage, "Body text anchor.", " \\qty");
  await waitForSettledIndex(tauriPage);
  await tauriPage.evaluate(
    `(document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })), 1)`,
  );
  await tauriPage.evaluate(
    `(document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true, cancelable: true })), 1)`,
  );
  await waitForCompletion(tauriPage);
  const commandEntries = await completionEntries(tauriPage);
  await maybeScreenshot(tauriPage, "e2e-qty-command.png");
  expect(
    commandEntries.some((entry) =>
      entry.label.replace(/^\\/, "").startsWith("qty"),
    ),
  ).toBe(true);
});

test("% !TEX root override and broken-root warning surface in the toolbar", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  await createBlankProject(tauriPage, "Tex Root");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({
    timeout: 20_000,
  });

  // A root that resolves to a real project file activates the indicator.
  await replaceEditorSource(
    tauriPage,
    "% !TEX root = main.tex\n\\documentclass{article}\n\\begin{document}\nx\n\\end{document}\n",
  );
  await expect(
    tauriPage.getByTestId("tex-root-indicator"),
  ).toBeVisible({ timeout: 15_000 });
  await maybeScreenshot(tauriPage, "e2e-texroot-active.png");

  // A root pointing at a missing file shows the warning badge instead.
  await replaceEditorSource(
    tauriPage,
    "% !TEX root = ../missing.tex\n\\documentclass{article}\n\\begin{document}\nx\n\\end{document}\n",
  );
  await expect(
    tauriPage.getByTestId("tex-root-broken"),
  ).toBeVisible({ timeout: 15_000 });
  await maybeScreenshot(tauriPage, "e2e-texroot-broken.png");
});
