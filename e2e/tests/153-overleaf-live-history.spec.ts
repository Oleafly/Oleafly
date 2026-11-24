import { existsSync, readFileSync } from "node:fs";
import { test, expect } from "../fixtures";
import {
  clickButton,
  COLLAB_PANE,
  openCollabPane,
  readProjectText,
  typeInEditorAfter,
  waitLong,
  type Page,
} from "../helpers";
import { importOverleafProjectLive, leaveOverleafLive, OverleafStack, reopenOverleafProjectLive, until } from "../overleaf-stack";
import { scriptValue } from "../script-value";

const STACK = process.env.OLEAFLY_E2E_OVERLEAF_STACK ?? "";
const MAIN = "main.tex";
const NOTES = "notes.md";
const MARKER = "KEPT-IN-HISTORY";
const WORD = "Oleaflyzzword";
const HISTORY = `${COLLAB_PANE} button[aria-label="History"]`;

// Ignored on purpose outside CI without OLEAFLY_E2E_OVERLEAF_STACK, because the spec drives the mock server it names.
test.skip(
  !process.env.CI && !STACK,
  "Needs OLEAFLY_E2E_OVERLEAF_STACK, the mock Overleaf server built with `cargo build -p oleafly-online --features test-support --example e2e_overleaf`.",
);
test.describe.configure({ mode: "serial", retries: 0 });

let stack: OverleafStack;
let projectId = "";

test.beforeAll(async () => {
  if (!STACK) throw new Error("CI must set OLEAFLY_E2E_OVERLEAF_STACK");
  stack = new OverleafStack(STACK, ["--name", "E2E History"]);
  await stack.ready;
});

test.afterAll(() => {
  stack?.stop();
});

async function showHistory(page: Page) {
  await openCollabPane(page);
  await waitLong(page, `!!document.querySelector(${scriptValue(HISTORY)})`, 30_000);
  await page.evaluate(`(() => {
    const header = document.querySelector(${scriptValue(HISTORY)});
    if (header?.getAttribute("aria-expanded") === "false") header.click();
  })()`);
}

async function waitOnDisk(page: Page, path: string, what: string, wanted: (text: string | null) => boolean) {
  await until(`${path} on disk ${what}`, () => readProjectText(page, path).catch(() => null), wanted, 30_000);
}

test("a file deleted on Overleaf comes back from its history", async ({ tauriPage: page }) => {
  test.setTimeout(240_000);
  projectId = await importOverleafProjectLive(page, await stack.ready, MAIN);
  const at = await stack.offsetAfter(NOTES, "First point.");
  await stack.request({ cmd: "peer_type", path: NOTES, at, text: ` ${MARKER}` });
  await waitOnDisk(page, NOTES, `with ${MARKER}`, (text) => text?.includes(MARKER) === true);
  await stack.request({ cmd: "peer_delete", path: NOTES });
  await waitOnDisk(page, NOTES, "gone after Overleaf deleted it", (text) => text === null);

  await showHistory(page);
  await clickButton(page, `${COLLAB_PANE} li`, "Open", 30_000, { containing: NOTES });
  await clickButton(page, '[role="dialog"]', NOTES);
  await waitLong(
    page,
    `[...document.querySelectorAll('[role="dialog"]')].some((dialog) => dialog.textContent?.includes(${scriptValue(MARKER)}))`,
    30_000,
  );
  await clickButton(page, '[role="dialog"]', "Restore this file");
  await clickButton(page, '[role="alertdialog"]', "Restore file");
  await until("the restored file", () => stack.request({ cmd: "exists", path: NOTES }), (reply) => reply.exists === true, 30_000);
  expect(await stack.textShows(NOTES, MARKER, 30_000)).toContain("First point.");
  await waitOnDisk(page, NOTES, `back with ${MARKER}`, (text) => text?.includes(MARKER) === true);
});

test("a version downloads as a ZIP of the project", async ({ tauriPage: page }) => {
  test.setTimeout(120_000);
  await reopenOverleafProjectLive(page, projectId, MAIN);
  const destination = test.info().outputPath("version.zip");
  await page.evaluate(`window.__e2eSetNextSavePath(${scriptValue(destination)})`);
  await showHistory(page);
  await clickButton(page, `${COLLAB_PANE} li`, "Download as ZIP", 30_000, { containing: NOTES });
  const deadline = Date.now() + 60_000;
  while (!existsSync(destination) || readFileSync(destination).length < 4) {
    if (Date.now() > deadline) throw new Error(`the version ZIP never reached ${destination}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const bytes = readFileSync(destination);
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  expect(bytes.includes(Buffer.from(MAIN))).toBe(true);
});

test("ignoring a word everywhere learns it on the Overleaf account", async ({ tauriPage: page }) => {
  test.setTimeout(180_000);
  await reopenOverleafProjectLive(page, projectId, MAIN);
  const spellcheckWasOn = await page.evaluate<boolean>(`import("/src/store/settings.ts").then(({ useSettingsStore }) => {
    const state = useSettingsStore.getState();
    const wasOn = state.spellcheck;
    if (!wasOn) state.toggleSpellcheck();
    return wasOn;
  })`);
  try {
    await typeInEditorAfter(page, "Hello", ` ${WORD}.`);
    await page.waitForFunction(`window.__e2eHasProofreadingDiagnostic?.(${scriptValue(WORD)}) === true`, 60_000);
    await page.waitForFunction(`typeof window.__e2eMountProofreadingCard === "function"`, 20_000);
    expect(await page.evaluate<boolean>(`window.__e2eMountProofreadingCard(${scriptValue(WORD)})`)).toBe(true);
    await page.evaluate(`(() => {
      const card = document.querySelector('[data-e2e-proofreading-card="true"]');
      const button = [...(card?.querySelectorAll(".cm-proofread-ignore") ?? [])].find(
        (entry) => entry.textContent?.trim() === "Ignore everywhere",
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error("Ignore everywhere is unavailable");
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    })()`);
    await page.evaluate(`document.querySelector('[data-e2e-proofreading-card="true"]')?.remove()`);
    await until(
      `${WORD} learned on Overleaf`,
      () => stack.request({ cmd: "learned_words", name: "alice" }),
      (reply) => (reply.words as string[]).includes(WORD),
      30_000,
    );
  } finally {
    await page.evaluate(`Promise.all([import("/src/lib/dictionary.ts"), import("/src/store/settings.ts")]).then(([dictionary, settings]) => {
      dictionary.useDictionary.getState().unignoreGlobal(${scriptValue(WORD)});
      const state = settings.useSettingsStore.getState();
      if (state.spellcheck !== ${String(spellcheckWasOn)}) state.toggleSpellcheck();
    })`);
    await leaveOverleafLive(page);
  }
});
