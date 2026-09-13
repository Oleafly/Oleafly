import { test, expect } from "../fixtures";
import {
  createBlankProject,
  editorSource,
  fillCommandPalette,
  openProject,
  openSettings,
  pressGlobal,
  paletteItems,
  typeAtCaret,
  type Page,
} from "../helpers";

const PROJECT = "E2E Settings";

async function openSettingsProject(page: Page & { getByText(t: string): { click(): Promise<void> } }) {
  const exists = await page.evaluate<boolean>(
    `Array.from(document.querySelectorAll('button')).some((el) => el.textContent?.includes(${JSON.stringify(PROJECT)}))`,
  );
  if (exists) await openProject(page, PROJECT);
  else await createBlankProject(page, PROJECT);
}

// The test fixture reloads the whole frontend before every test, so the
// two-test pair below proves persistence across a renderer restart, not merely
// React component state.

test("settings modal opens with all sections", async ({ tauriPage }) => {
  await openSettingsProject(tauriPage);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage);
  for (const s of ["appearance", "general", "ai", "integrations"]) {
    await expect(tauriPage.locator(`[data-testid="settings-section-${s}"]`)).toBeVisible();
  }
  await expect(
    tauriPage.locator(
      '[aria-label="Settings sections"] [data-testid="settings-section-mcp"]',
    ),
  ).toHaveCount(0);
  // The "Show advanced" toggle persists (localStorage), so only click it when
  // advanced sections are currently hidden.
  const dictionary = tauriPage.locator('[data-testid="settings-section-dictionary"]');
  if (!(await dictionary.isVisible())) {
    await tauriPage.click('[data-testid="settings-toggle-advanced"]');
  }
  for (const s of ["dictionary", "engine", "downloads", "data"]) {
    await expect(tauriPage.locator(`[data-testid="settings-section-${s}"]`)).toBeVisible();
  }
  await openSettings(tauriPage, "help");
  await expect(tauriPage.locator('[data-testid="about-oleafly-logo"]')).toBeVisible();
  await expect(tauriPage.getByTestId("about-oleafly-section")).toContainText("Oleafly");
  await tauriPage.click('[aria-label="Close settings"]');
});

test("keyboard shortcuts are editable from their Settings section", async ({ tauriPage }) => {
  await openSettingsProject(tauriPage);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "shortcuts");
  await expect(tauriPage.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(
    tauriPage.getByText("Customize application shortcuts", { exact: false }),
  ).toBeVisible();
  await expect(tauriPage.getByText("Recompile", { exact: true })).toBeVisible();
  await tauriPage.click('[aria-label="Close settings"]');
});

test("keyboard shortcuts Settings section opens from the home view", async ({ tauriPage }) => {
  const back = tauriPage.locator('[title="Back to library"]');
  if (await back.isVisible()) await back.click();
  await openSettings(tauriPage, "shortcuts");
  await expect(tauriPage.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(tauriPage.getByText("Reset to defaults", { exact: true })).toBeVisible();
  await tauriPage.click('[aria-label="Close settings"]');
});

test("home tour opens from Help and About", async ({ tauriPage }) => {
  const back = tauriPage.locator('[title="Back to library"]');
  if (await back.isVisible()) await back.click();
  await openSettings(tauriPage, "help");
  await tauriPage.getByText("Start tour", { exact: true }).click();
  await expect(tauriPage.getByRole("alertdialog")).toBeVisible({ timeout: 20_000 });
  await expect(tauriPage.locator("#react-joyride-portal h2")).toHaveText("Home");
  await tauriPage.getByRole("button", { name: "Skip" }).click();
  await expect(tauriPage.getByText("Quit the tour?")).toBeVisible({ timeout: 10_000 });
  await tauriPage.getByText("Quit tour", { exact: true }).click();
  await expect(tauriPage.getByRole("alertdialog")).toBeHidden();
});

test("compile button becomes recompile after the first result", async ({ tauriPage }) => {
  await openSettingsProject(tauriPage);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  const initialLabel = await tauriPage.evaluate<string>(
    `document.querySelector('[data-testid="compile-button"]')?.textContent?.trim() ?? ''`,
  );
  if (initialLabel === "Compile") {
    await tauriPage.click('[data-testid="compile-button"]');
  }
  await expect(tauriPage.locator('[data-testid="compile-button"]')).toContainText("Recompile", {
    timeout: 120_000,
  });
});

test("vim mode: modal editing, live toggle, and persistence part 1", async ({ tauriPage }) => {
  await openSettingsProject(tauriPage);
  const editor = tauriPage.locator(".cm-content");
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await pressGlobal(tauriPage, "k", { meta: true });
  await fillCommandPalette(tauriPage, "vim");
  const alreadyEnabled = await tauriPage.evaluate<boolean>(
    `document.body.innerText.includes('Disable vim mode')`,
  );
  if (alreadyEnabled) {
    await expect(
      tauriPage.locator('[cmdk-item][aria-selected="true"]'),
    ).toHaveText("Disable vim mode");
    await tauriPage.press("[cmdk-input]", "Enter");
    await expect(tauriPage.locator("[cmdk-input]")).toBeHidden();
    await pressGlobal(tauriPage, "k", { meta: true });
    await fillCommandPalette(tauriPage, "vim");
  }
  await expect(
    tauriPage.locator('[cmdk-item][aria-selected="true"]'),
  ).toHaveText("Enable vim mode");
  await tauriPage.press("[cmdk-input]", "Enter");
  await expect(tauriPage.locator("[cmdk-input]")).toBeHidden();
  await expect
    .poll(
      () =>
        tauriPage.evaluate<string>(
          `localStorage.getItem("oleafly.vim") ?? ""`,
        ),
      { timeout: 10_000 },
    )
    .toBe("1");

  await editor.focus();
  await tauriPage.keyboard.press("Escape");
  await expect(tauriPage.locator(".cm-vim-panel")).toContainText("NORMAL");
  const original = await editorSource(tauriPage);

  await tauriPage.keyboard.press("g");
  await tauriPage.keyboard.press("g");
  await expect
    .poll(() => tauriPage.evaluate<number>(`import("/src/components/editor/cm/controller.ts").then(
      ({ getEditorView }) => getEditorView()?.state.doc.lineAt(
        getEditorView()?.state.selection.main.head ?? 0
      ).number ?? 0
    )`))
    .toBe(1);
  await tauriPage.keyboard.press("j");
  await expect
    .poll(() => tauriPage.evaluate<number>(`import("/src/components/editor/cm/controller.ts").then(
      ({ getEditorView }) => getEditorView()?.state.doc.lineAt(
        getEditorView()?.state.selection.main.head ?? 0
      ).number ?? 0
    )`))
    .toBe(2);

  await tauriPage.keyboard.press("Tab");
  expect(await editorSource(tauriPage)).toBe(original);
  await editor.focus();
  await tauriPage.keyboard.press("d");
  await tauriPage.keyboard.press("d");
  expect(await editorSource(tauriPage)).not.toBe(original);
  await tauriPage.keyboard.press("u");
  await expect.poll(() => editorSource(tauriPage)).toBe(original);

  await tauriPage.keyboard.press("i");
  await expect(tauriPage.locator(".cm-vim-panel")).toContainText("INSERT");
  await typeAtCaret(tauriPage, "VIM_E2E ");
  await tauriPage.keyboard.press("Escape");
  await expect(tauriPage.locator(".cm-vim-panel")).toContainText("NORMAL");
  await expect.poll(() => editorSource(tauriPage)).toContain("VIM_E2E");

  await tauriPage.keyboard.press("u");
  await expect.poll(() => editorSource(tauriPage)).toBe(original);
  await tauriPage.keyboard.press("Control+y");
  await expect.poll(() => editorSource(tauriPage)).toBe(original);
  await tauriPage.keyboard.press("Control+r");
  await expect.poll(() => editorSource(tauriPage)).toContain("VIM_E2E");

  await tauriPage.evaluate(`import("/src/store/files.ts").then(({ useFilesStore }) => {
    const originalSave = useFilesStore.getState().saveActive;
    window.__vimE2eSaveCount = 0;
    window.__vimE2eOriginalSave = originalSave;
    useFilesStore.setState({
      saveActive: async () => {
        window.__vimE2eSaveCount += 1;
        await originalSave();
      },
    });
  })`);
  const exCommand = tauriPage.locator(".cm-vim-panel input");
  try {
    await tauriPage.keyboard.press(":");
    await expect(exCommand).toBeVisible();
    await exCommand.fill("w");
    await exCommand.press("Enter");
    await expect
      .poll(() => tauriPage.evaluate<number>(`window.__vimE2eSaveCount ?? 0`))
      .toBe(1);
  } finally {
    await tauriPage.evaluate(`import("/src/store/files.ts").then(({ useFilesStore }) => {
      useFilesStore.setState({ saveActive: window.__vimE2eOriginalSave });
      delete window.__vimE2eOriginalSave;
    })`);
  }

  await editor.focus();
  await tauriPage.keyboard.press("u");
  await expect.poll(() => editorSource(tauriPage)).toBe(original);
  await tauriPage.keyboard.press(":");
  await expect(exCommand).toBeVisible();
  await exCommand.fill("w");
  await exCommand.press("Enter");
  await expect
    .poll(() => tauriPage.evaluate<boolean>(`import("/src/store/files.ts").then(
      ({ useFilesStore }) => useFilesStore.getState().files[
        useFilesStore.getState().activePath ?? ""
      ]?.dirty === false
    )`))
    .toBe(true);

  await pressGlobal(tauriPage, "k", { meta: true });
  await fillCommandPalette(tauriPage, "vim");
  await expect(
    tauriPage.locator('[cmdk-item][aria-selected="true"]'),
  ).toHaveText("Disable vim mode", { timeout: 10_000 });
  await tauriPage.press("[cmdk-input]", "Enter");
  await expect(tauriPage.locator(".cm-vim-panel")).toHaveCount(0);
  await pressGlobal(tauriPage, "k", { meta: true });
  await fillCommandPalette(tauriPage, "vim");
  await expect(
    tauriPage.locator('[cmdk-item][aria-selected="true"]'),
  ).toHaveText("Enable vim mode", { timeout: 10_000 });
  await tauriPage.press("[cmdk-input]", "Enter");
  await expect(tauriPage.locator(".cm-vim-panel")).toContainText("NORMAL");
});

test("vim mode survived the app restart, then disable it (part 2)", async ({ tauriPage }) => {
  // The fixture reloaded the entire app between these two tests.
  await expect
    .poll(
      () =>
        tauriPage.evaluate<string>(
          `localStorage.getItem("oleafly.vim") ?? ""`,
        ),
      { timeout: 10_000 },
    )
    .toBe("1");
  await openSettingsProject(tauriPage);
  await expect(tauriPage.locator(".cm-vim-panel")).toContainText("NORMAL", {
    timeout: 20_000,
  });
  await pressGlobal(tauriPage, "k", { meta: true });
  await fillCommandPalette(tauriPage, "vim");
  await expect(
    tauriPage.locator('[cmdk-item][aria-selected="true"]'),
  ).toHaveText("Disable vim mode", { timeout: 10_000 });
  await tauriPage.press("[cmdk-input]", "Enter"); // restore off
  await expect
    .poll(
      () =>
        tauriPage.evaluate<string>(
          `localStorage.getItem("oleafly.vim") ?? ""`,
        ),
      { timeout: 10_000 },
    )
    .toBe("0");
  await expect(tauriPage.locator(".cm-vim-panel")).toHaveCount(0);
  await pressGlobal(tauriPage, "k", { meta: true });
  await fillCommandPalette(tauriPage, "vim");
  await expect(
    tauriPage.locator('[cmdk-item][aria-selected="true"]'),
  ).toHaveText("Enable vim mode", { timeout: 10_000 });
  await tauriPage.press("[cmdk-input]", "Escape");
});

test("palette lists every registered core command", async ({ tauriPage }) => {
  await openSettingsProject(tauriPage);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await pressGlobal(tauriPage, "k", { meta: true });
  await expect(tauriPage.locator("[cmdk-input]")).toBeVisible();
  const items = await paletteItems(tauriPage);
  for (const label of [
    "New project…",
    "Recompile",
    "Go to PDF (SyncTeX)",
    "Export PDF…",
    "Word count",
    "Git history",
    "Checkpoints",
    "Add citation",
    "Bold",
    "Italic",
    "Section",
    "Bulleted list",
    "Figure",
    "Table",
    "Equation",
    "Label",
  ]) {
    expect(items.some((t) => t.includes(label))).toBe(true);
  }
  expect(items.some((t) => /vim mode/.test(t))).toBe(true);
  expect(items.some((t) => /spellcheck/.test(t))).toBe(true);
  expect(items.some((t) => /theme/.test(t))).toBe(true);
  expect(items.some((t) => /auto-compile/.test(t))).toBe(true);
  expect(items.some((t) => /line mode|Offline|Online/.test(t))).toBe(true);
  await tauriPage.press("[cmdk-input]", "Escape");
});
