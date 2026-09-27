import { renameSync } from "node:fs";
import { join } from "node:path";
import { test, expect, reloadNativePage } from "../fixtures";
import { chooseAppSelectOption, createBlankProject } from "../helpers";
import {
  expectFolderUnchanged,
  expectNoOleaflyFootprint,
  folderCard,
  folderCardDetails,
  folderFixtures,
  goToLibrary,
  loadedChatMessages,
  openFolder,
  showSplitView,
  snapshotFolder,
  startChat,
  trustFromBanner,
  waitForCompileSuccess,
} from "../open-folder";
import { scriptValue } from "../script-value";

const fixtures = folderFixtures("library");
const CARD = `Card Paper ${fixtures.tag}`;
const LIBRARY_ONLY = `Library Only Paper ${fixtures.tag}`;
const REMOVABLE = `Removable Paper ${fixtures.tag}`;
const BEFORE_RENAME = `Paper Before Rename ${fixtures.tag}`;
const AFTER_RENAME = `Paper After Rename ${fixtures.tag}`;

test.afterAll(() => fixtures.remove());

function article(body: string): string {
  return `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;
}

type LibraryPage = Parameters<typeof openFolder>[0];

const FILTERS_BUTTON = '[aria-label="Advanced project filters"]';
const LOCATION = "#project-filter-location";

async function locationShown(page: LibraryPage): Promise<string | null> {
  return page.evaluate<string | null>(
    `document.querySelector(${scriptValue(LOCATION)})?.textContent?.trim() ?? null`,
  );
}

async function openFilters(page: LibraryPage) {
  if ((await locationShown(page)) === null) await page.click(FILTERS_BUTTON);
  await expect.poll(async () => locationShown(page), { timeout: 10_000 }).not.toBeNull();
}

async function chooseLocation(page: LibraryPage, label: "All projects" | "In Oleafly" | "External projects") {
  await openFilters(page);
  await chooseAppSelectOption(page, LOCATION, { attribute: "data-label", value: label });
  await expect.poll(async () => locationShown(page)).toBe(label);
}

async function resetFilters(page: LibraryPage) {
  const clicked = await page.evaluate<boolean>(`(() => {
    const panel = document.querySelector(${scriptValue(LOCATION)})?.closest("[data-radix-popper-content-wrapper]");
    const reset = Array.from(panel?.querySelectorAll("button") ?? []).find((button) => button.textContent?.trim() === ${scriptValue("Reset")});
    if (!reset || reset.disabled) return false;
    reset.click();
    return true;
  })()`);
  expect(clicked, "the Reset button in the filters must be enabled while a location is chosen").toBe(true);
  await expect.poll(async () => locationShown(page)).toBe("All projects");
}

async function closeFilters(page: LibraryPage) {
  await page.evaluate(`(document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true)`);
  await expect.poll(async () => locationShown(page), { timeout: 10_000 }).toBeNull();
}

async function gridCards(page: LibraryPage): Promise<string[]> {
  return page.evaluate<string[]>(
    `Array.from(document.querySelectorAll('[data-testid="project-grid"] button[aria-label^="Open "]')).map((button) => button.getAttribute('aria-label').slice(5))`,
  );
}

test("the library shows an opened folder as an external card and filters by location", async ({ tauriPage: page }) => {
  await createBlankProject(page, LIBRARY_ONLY);
  await goToLibrary(page);
  const folder = fixtures.make(CARD, { "main.tex": article("Card paper body.") });
  const before = snapshotFolder(folder);
  await openFolder(page, folder);
  await showSplitView(page);
  await waitForCompileSuccess(page);
  await goToLibrary(page);

  await expect(page.locator(folderCard(CARD))).toBeVisible({ timeout: 20_000 });
  const details = await folderCardDetails(page, CARD);
  expect(details?.kind).toBe("external");
  expect(details?.date).toMatch(/^Updated /);
  expect(details?.text).not.toContain("Folder missing");
  expect(details?.text).not.toContain("No main document");
  expect(details?.text).not.toContain(fixtures.root);
  expect((await folderCardDetails(page, LIBRARY_ONLY))?.kind).toBe("document");

  await openFilters(page);
  expect(await locationShown(page)).toBe("All projects");
  const all = await gridCards(page);
  expect(all).toEqual(expect.arrayContaining([CARD, LIBRARY_ONLY]));

  await chooseLocation(page, "External projects");
  await expect.poll(async () => gridCards(page)).not.toContain(LIBRARY_ONLY);
  const external = await gridCards(page);
  expect(external).toContain(CARD);

  await chooseLocation(page, "In Oleafly");
  await expect.poll(async () => gridCards(page)).not.toContain(CARD);
  const library = await gridCards(page);
  expect(library).toContain(LIBRARY_ONLY);
  expect([...external, ...library].sort()).toEqual([...all].sort());

  await resetFilters(page);
  await expect.poll(async () => gridCards(page)).toEqual(expect.arrayContaining([CARD, LIBRARY_ONLY]));
  expect((await gridCards(page)).sort()).toEqual([...all].sort());
  await closeFilters(page);

  expectFolderUnchanged(folder, before);
  expectNoOleaflyFootprint(folder);
});

test("Remove from Oleafly keeps the files and reopening brings the chats back untrusted", async ({ tauriPage: page }) => {
  const folder = fixtures.make(REMOVABLE, { "main.tex": article("Removable paper body.") });
  const before = snapshotFolder(folder);
  const message = `Chat kept for the removed folder ${Date.now()}`;

  const opened = await openFolder(page, folder);
  await trustFromBanner(page);
  await startChat(page, opened.projectId as string, message);
  await goToLibrary(page);

  await expect(page.locator(folderCard(REMOVABLE))).toBeVisible({ timeout: 20_000 });
  await page.evaluate(`(() => {
    const card = document.querySelector(${scriptValue(folderCard(REMOVABLE))});
    const r = card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 2 }));
    return true;
  })()`);
  await expect(page.getByText("Remove from Oleafly", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByText("Remove from Oleafly", { exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible({ timeout: 10_000 });
  await expect(confirmation).toContainText("Your files stay where they are.");
  await page.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find((candidate) => candidate.textContent?.trim().startsWith("Remove from Oleafly"));
    button.click();
    return true;
  })()`);
  await expect(page.locator(folderCard(REMOVABLE))).toHaveCount(0, { timeout: 20_000 });
  expectFolderUnchanged(folder, before);

  await reloadNativePage(page);
  const reopened = await openFolder(page, folder);
  await expect(page.locator('[data-testid="folder-trust-banner"]')).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => loadedChatMessages(page, reopened.projectId as string), { timeout: 20_000 }).toContain(message);

  await goToLibrary(page);
  expectFolderUnchanged(folder, before);
  expectNoOleaflyFootprint(folder);
});

test("renaming a closed folder on disk keeps its project and chats", async ({ tauriPage: page }) => {
  const folder = fixtures.make(BEFORE_RENAME, { "main.tex": article("Renamed paper body.") });
  const before = snapshotFolder(folder);
  const message = `Chat kept across the rename ${Date.now()}`;

  const opened = await openFolder(page, folder);
  expect(opened.projectName).toBe(BEFORE_RENAME);
  await startChat(page, opened.projectId as string, message);
  await goToLibrary(page);
  await expect(page.locator(folderCard(BEFORE_RENAME))).toBeVisible({ timeout: 20_000 });
  await reloadNativePage(page);

  const renamed = join(fixtures.root, AFTER_RENAME);
  await expect.poll(() => {
    try {
      renameSync(folder, renamed);
      return true;
    } catch {
      return false;
    }
  }, { timeout: 20_000 }).toBe(true);

  const reopened = await openFolder(page, renamed);
  expect(reopened.projectId).toBe(opened.projectId);
  expect(reopened.projectName).toBe(AFTER_RENAME);
  expect(reopened.mainDoc).toBe("main.tex");
  await expect.poll(async () => loadedChatMessages(page, reopened.projectId as string), { timeout: 20_000 }).toContain(message);

  await goToLibrary(page);
  await expect(page.locator(folderCard(AFTER_RENAME))).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(folderCard(BEFORE_RENAME))).toHaveCount(0);
  expect((await folderCardDetails(page, AFTER_RENAME))?.kind).toBe("external");
  expectFolderUnchanged(renamed, before, ["."]);
  expectNoOleaflyFootprint(renamed);
});
