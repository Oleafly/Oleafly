import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, reloadNativePage } from "../fixtures";
import { compileAndWait, expectCompiledPdfAbsent, expectCompiledPdfContains } from "../helpers";
import {
  expectFolderUnchanged,
  expectMainDocument,
  expectNoOleaflyFootprint,
  expectNoSidewaysScroll,
  folderFixtures,
  goToLibrary,
  openFolder,
  openedState,
  showSplitView,
  snapshotFolder,
  waitForCompileSuccess,
  waitForPdfPage,
} from "../open-folder";
import { scriptValue } from "../script-value";

const fixtures = folderFixtures("detection");

test.afterAll(() => fixtures.remove());

function article(body: string, documentClass = "article"): string {
  return `\\documentclass{${documentClass}}\n\\begin{document}\n${body}\n\\end{document}\n`;
}

async function clickTreeAction(page: Parameters<typeof openFolder>[0], path: string, action: string) {
  const row = `document.querySelector('[aria-label="Explorer file tree"] [data-path=' + CSS.escape(${scriptValue(path)}) + ']')`;
  const item = `Array.from(document.querySelectorAll('[role="menu"][data-state="open"] [role="menuitem"]')).find((candidate) => candidate.textContent?.trim() === ${scriptValue(action)} && candidate.getAttribute('data-disabled') === null && candidate.getBoundingClientRect().width > 0)`;
  const press = `((target) => {
    const init = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true };
    target.dispatchEvent(new PointerEvent("pointerdown", init));
    target.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
    target.click();
    return true;
  })`;
  const menuState = `JSON.stringify({
    row: !!${row},
    focused: document.hasFocus(),
    visibility: document.visibilityState,
    menus: Array.from(document.querySelectorAll('[role="menu"]')).map((menu) => menu.getAttribute('data-state') + ': ' + Array.from(menu.querySelectorAll('[role="menuitem"]')).map((entry) => (entry.textContent?.trim() ?? '') + (entry.getAttribute('data-disabled') === null ? '' : ' (disabled)')).join(' | ')),
  })`;
  const deadline = Date.now() + 30_000;
  for (let attempt = 1; ; attempt++) {
    await page.waitForFunction(`!!${row}`, 30_000);
    const opened = await page.evaluate<boolean>(
      `(() => {
        const row = ${row};
        const expected = ${scriptValue(`More actions for ${path.split("/").pop()}`)};
        const button = row && Array.from(row.querySelectorAll('button')).find((candidate) => candidate.getAttribute('aria-label') === expected);
        return button instanceof HTMLButtonElement && ${press}(button);
      })()`,
    );
    const shown = opened && await page.waitForFunction(`!!(${item})`, 3_000).then(() => true, () => false);
    const pressed = shown && await page.evaluate<boolean>(
      `(() => {
        const entry = ${item};
        return entry instanceof HTMLElement && ${press}(entry);
      })()`,
    );
    if (pressed) break;
    const state = await page.evaluate<string>(menuState);
    if (Date.now() > deadline) {
      throw new Error(`"${action}" never showed in the menu for ${path} after ${attempt} attempts: ${state}`);
    }
    console.warn(`reopening the menu for ${path} (attempt ${attempt}): ${state}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const closed = `!document.querySelector('[role="menu"][data-state="open"]')`;
  if (await page.waitForFunction(closed, 2_000).then(() => true, () => false)) return;
  await page.evaluate(
    `(() => {
      document.querySelector('[role="menu"][data-state="open"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      return true;
    })()`,
  );
  await page.waitForFunction(closed, 5_000);
}

test("a single nested main opens by itself and compiles from its own folder", async ({ tauriPage: page }) => {
  const folder = fixtures.make("Nested Paper", {
    "README.md": "# Nested paper\n\nThe paper lives in paper/.\n",
    "data/results.csv": "trial,value\n1,2\n",
    "paper/main.tex": article("\\input{sections/intro}"),
    "paper/sections/intro.tex": "Nested introduction compiled from its folder.\n",
  });
  const before = snapshotFolder(folder);

  const opened = await openFolder(page, folder);
  expect(opened.mainDoc).toBe("paper/main.tex");
  expect(opened.engine).toBe("latex");
  await expectMainDocument(page, "paper/main.tex");
  await expect(page.locator('[data-testid="main-document-picker"]')).toHaveCount(0);

  await showSplitView(page);
  await waitForCompileSuccess(page);
  await waitForPdfPage(page);
  await expectCompiledPdfContains(page, "Nested introduction compiled from its folder.");

  await goToLibrary(page);
  expectFolderUnchanged(folder, before);
  expectNoOleaflyFootprint(folder);
});

test("a long main path never lets the window scroll sideways", async ({ tauriPage: page }) => {
  const name = "a-rather-long-introduction-file-name-for-the-thesis.tex";
  const folder = fixtures.make("Long Main Path", {
    [`chapters/${name}`]: article("Long main path compiled."),
  });
  const before = snapshotFolder(folder);

  const opened = await openFolder(page, folder);
  expect(opened.mainDoc).toBe(`chapters/${name}`);
  await expectMainDocument(page, `chapters/${name}`);
  await showSplitView(page);
  await waitForCompileSuccess(page);
  await expectCompiledPdfContains(page, "Long main path compiled.");
  await expectNoSidewaysScroll(page);

  await goToLibrary(page);
  expectFolderUnchanged(folder, before);
  expectNoOleaflyFootprint(folder);
});

test("an ambiguous folder asks for the main document and remembers the choice", async ({ tauriPage: page }) => {
  const folder = fixtures.make("Two Papers", {
    "alpha/report.tex": article("Alpha report chosen in the picker."),
    "beta/thesis.tex": article("Beta thesis left alone.", "report"),
  });
  const before = snapshotFolder(folder);

  const opened = await openFolder(page, folder);
  const picker = page.locator('[data-testid="main-document-picker"]');
  await expect(picker).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="main-document-candidates"] label[data-path="alpha/report.tex"]')).toBeVisible();
  await expect(page.locator('[data-testid="main-document-candidates"] label[data-path="beta/thesis.tex"]')).toBeVisible();
  expect(await page.evaluate<string | null>(
    `document.querySelector('[data-testid="main-document-candidates"] input[type="radio"]:checked')?.closest('label')?.getAttribute('data-path') ?? null`,
  )).toBe("beta/thesis.tex");

  await page.click('[data-testid="main-document-candidates"] label[data-path="alpha/report.tex"]');
  await expect.poll(async () => page.evaluate<string | null>(
    `document.querySelector('[data-testid="main-document-candidates"] input[type="radio"]:checked')?.closest('label')?.getAttribute('data-path') ?? null`,
  )).toBe("alpha/report.tex");
  await page.evaluate(`(() => {
    const open = Array.from(document.querySelectorAll('[data-testid="main-document-picker"] button')).find((button) => button.textContent?.trim() === "Open");
    open.click();
    return true;
  })()`);
  await expect(picker).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(async () => (await openedState(page)).mainDoc).toBe("alpha/report.tex");
  await expectMainDocument(page, "alpha/report.tex");

  await showSplitView(page);
  await compileAndWait(page);
  await expectCompiledPdfContains(page, "Alpha report chosen in the picker.");
  await expectCompiledPdfAbsent(page, "Beta thesis left alone.");

  await goToLibrary(page);
  await reloadNativePage(page);
  const reopened = await openFolder(page, folder);
  expect(reopened.projectId).toBe(opened.projectId);
  expect(reopened.mainDoc).toBe("alpha/report.tex");
  await expectMainDocument(page, "alpha/report.tex");
  await expect(page.locator('[data-testid="main-document-picker"]')).toHaveCount(0);

  await goToLibrary(page);
  expectFolderUnchanged(folder, before);
  expectNoOleaflyFootprint(folder);
});

test("an empty folder opens without a main document until one is set", async ({ tauriPage: page }) => {
  const folder = fixtures.make("Empty Folder", {});
  const before = snapshotFolder(folder);

  await openFolder(page, folder);
  await expect(page.locator('[data-testid="no-main-document"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="main-document-picker"]')).toHaveCount(0);
  const compileButton = page.locator('[data-testid="compile-button"]');
  await expect(compileButton).toHaveAttribute("aria-disabled", "true");
  expect(await page.evaluate<string>(
    `import("/src/store/compile.ts").then(({ useCompileStore }) => useCompileStore.getState().status)`,
  )).toBe("idle");
  expectFolderUnchanged(folder, before);

  writeFileSync(join(folder, "draft.tex"), article("Draft set as the main document."));
  const withDraft = snapshotFolder(folder);
  await clickTreeAction(page, "draft.tex", "Set as main document");

  await expect.poll(async () => (await openedState(page)).mainDoc).toBe("draft.tex");
  await expect(page.locator('[data-testid="no-main-document"]')).toHaveCount(0);
  await expect.poll(async () => compileButton.getAttribute("aria-disabled")).toBeNull();
  await showSplitView(page);
  await waitForCompileSuccess(page);
  await expectCompiledPdfContains(page, "Draft set as the main document.");

  await goToLibrary(page);
  expectFolderUnchanged(folder, withDraft);
  expectNoOleaflyFootprint(folder);
});
