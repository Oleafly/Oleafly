import { test, expect } from "../fixtures";
import { editorSource, readProjectText, waitEditorShowsFile, waitLong, type Page } from "../helpers";
import { importOverleafProjectLive, leaveOverleafLive, OverleafStack, reopenOverleafProjectLive } from "../overleaf-stack";
import {
  richCaretContext,
  richEditorEditable,
  typeInRichEditorAfter,
  typeInRichEditorAtCaret,
  waitRichEditorText,
} from "../rich-editor";
import { scriptValue } from "../script-value";

const STACK = process.env.OLEAFLY_E2E_OVERLEAF_STACK ?? "";
const MAIN = "main.tex";
const NOTES = "notes.md";
const IDEAS = "notes/ideas.md";
const APP_VISUAL = "APP-VISUAL-OL";
const COAUTHOR_VISUAL = "COAUTHOR-VISUAL-OL";
const APP_NOTE = "APP-NOTE-OL";
const COAUTHOR_NOTE = "COAUTHOR-NOTE-OL";

// Ignored on purpose outside CI without OLEAFLY_E2E_OVERLEAF_STACK, because the spec drives the mock server it names.
test.skip(
  !process.env.CI && !STACK,
  "Needs OLEAFLY_E2E_OVERLEAF_STACK, the mock Overleaf server built with `cargo build -p oleafly-online --features test-support --example e2e_overleaf`, seeded with notes.md and notes/ideas.md and answering the `type` command.",
);
test.describe.configure({ mode: "serial", retries: 0 });

let stack: OverleafStack;
let projectId = "";

test.beforeAll(async () => {
  if (!STACK) throw new Error("CI must set OLEAFLY_E2E_OVERLEAF_STACK");
  stack = new OverleafStack(STACK);
  await stack.ready;
});

test.afterAll(() => {
  stack?.stop();
});

async function openInEditor(page: Page, path: string) {
  await page.evaluate(`import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().openFile(${scriptValue(path)}))`);
}

async function expectSameEverywhere(page: Page, path: string, needles: string[]) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const server = await stack.text(path);
    const disk = await readProjectText(page, path);
    if (server === disk && needles.every((needle) => server.includes(needle))) return server;
    if (Date.now() > deadline) {
      throw new Error(`${path} never matched on Overleaf and on disk: ${JSON.stringify({ needles, server, disk })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

test("a Markdown Visual edit reaches Overleaf, and a coauthor's typing keeps the app's caret", async ({ tauriPage: page }) => {
  test.setTimeout(300_000);
  projectId = await importOverleafProjectLive(page, await stack.ready, MAIN);
  const seeded = await stack.text(NOTES);
  expect(seeded, "the mock seeds notes.md with a heading and a paragraph").toContain("First point.");

  await openInEditor(page, NOTES);
  await waitEditorShowsFile(page, NOTES, 30_000);
  await page.click('[aria-label="Switch to WYSIWYG view"]');
  await waitRichEditorText(page, "visual", ["First point."], 30_000);
  await waitLong(
    page,
    `import("/src/components/editor/wysiwyg/controller.ts").then(({ getWysiwygEditor }) => !!getWysiwygEditor()?.isEditable)`,
    30_000,
  );
  expect(await page.evaluate<boolean>(`!document.querySelector('[data-testid="visual-live-notice"]')`)).toBe(true);

  await typeInRichEditorAfter(page, "visual", "First", ` ${APP_VISUAL}`, 40);
  await stack.textShows(NOTES, `First ${APP_VISUAL} point.`, 30_000);

  expect(await richCaretContext(page, "visual")).toBe(`First ${APP_VISUAL}`);
  const heading = seeded.match(/^# (.+)$/mu)?.[1] ?? "";
  expect(heading, "the mock seeds notes.md with a level-one heading").not.toBe("");
  await stack.request({ cmd: "type", path: NOTES, after: `# ${heading}`, text: ` ${COAUTHOR_VISUAL}`, delay_ms: 40 });
  await waitRichEditorText(page, "visual", [`${heading} ${COAUTHOR_VISUAL}`], 30_000);
  expect(await richCaretContext(page, "visual")).toBe(`First ${APP_VISUAL}`);
  expect(await richEditorEditable(page, "visual")).toBe(true);
  await typeInRichEditorAtCaret(page, "visual", "!", 0);
  await stack.textShows(NOTES, `${APP_VISUAL}! point.`, 30_000);

  await page.click('[aria-label="Switch to source view"]');
  const merged = await expectSameEverywhere(page, NOTES, [`${APP_VISUAL}!`, COAUTHOR_VISUAL]);
  await waitLong(page, `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => getEditorView()?.state.doc.toString() === ${scriptValue(merged)})`, 30_000);
  expect(await editorSource(page)).toBe(merged);
});

test("an Overleaf project note is live while it is open as a note", async ({ tauriPage: page }) => {
  test.setTimeout(240_000);
  await reopenOverleafProjectLive(page, projectId, MAIN);
  await page.evaluate(`import("/src/store/settings.ts").then(({ useSettingsStore }) => useSettingsStore.getState().setNotes(true))`);
  const seeded = await stack.text(IDEAS);
  expect(seeded, "the mock seeds notes/ideas.md as a project note").toMatch(/^---\n[\s\S]*kind: note[\s\S]*---\n/u);
  const line = seeded.split("\n").find((entry) => entry.trim() !== "" && !entry.startsWith("---") && !entry.includes(":")) ?? "";
  const anchor = line.replace(/[.!?]$/u, "").trim();
  expect(anchor, "the note has a line of body text to type after").not.toBe("");

  await openInEditor(page, IDEAS);
  await waitRichEditorText(page, "note", [anchor], 30_000);
  await waitLong(
    page,
    `!!([...document.querySelectorAll("[data-note-blank] .ProseMirror")].find((node) => !node.closest("[hidden]"))?.editor?.isEditable)`,
    30_000,
  );

  await typeInRichEditorAfter(page, "note", anchor, ` ${APP_NOTE}`, 40);
  await stack.textShows(IDEAS, `${anchor} ${APP_NOTE}`, 10_000);

  const frontMatter = seeded.slice(0, seeded.indexOf("\n---\n", 3) + 5);
  await stack.request({ cmd: "type", path: IDEAS, after: frontMatter, text: `${COAUTHOR_NOTE}\n\n`, delay_ms: 40 });
  await waitRichEditorText(page, "note", [COAUTHOR_NOTE, APP_NOTE], 30_000);
  expect(await richCaretContext(page, "note")).toBe(`${anchor} ${APP_NOTE}`);
  await typeInRichEditorAtCaret(page, "note", "?", 0);
  const merged = await expectSameEverywhere(page, IDEAS, [`${APP_NOTE}?`, COAUTHOR_NOTE]);
  expect(merged).toMatch(/kind: note/u);
  await leaveOverleafLive(page);
});
