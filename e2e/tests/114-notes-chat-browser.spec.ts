import { expect, type Page, test } from "@playwright/test";
import { EDITS, REPLIES, type RecordedRun } from "../notes-agent-mock";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";

async function open(page: Page, query = ""): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${BASE_URL}/e2e/notes-harness.html${query}`);
  await page.waitForFunction(() => document.body.dataset.fixtureState === "mounted", null, { timeout: 60_000 });
  return errors;
}

async function openNote(page: Page, title: string): Promise<void> {
  await page.locator("aside").getByRole("button", { name: new RegExp(title) }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(title);
  await expect(page.locator(".ProseMirror:visible")).toBeVisible();
}

function dock(page: Page) {
  return page.locator("[data-prompt-state]:visible");
}

function composer(page: Page) {
  return page.getByRole("combobox", { name: "Assistant", exact: true });
}

function conversation(page: Page) {
  return page.getByRole("region", { name: "Conversation with the assistant" });
}

function noteText(page: Page, id: string): Promise<string> {
  return page.evaluate((noteId) => (window as unknown as { __notes: { text(id: string): string } }).__notes.text(noteId), id);
}

function agentRuns(page: Page): Promise<RecordedRun[]> {
  return page.evaluate(() => (window as unknown as { __agent: { runs: RecordedRun[] } }).__agent.runs);
}

async function ask(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

test.describe("Notes assistant", () => {
  test("asks for a provider first when none is set up", async ({ page }) => {
    const errors = await open(page, "?ai=none");
    await openNote(page, "Masking strategy report");
    await expect(dock(page)).toHaveAttribute("data-prompt-state", "expanded");
    await expect(dock(page).getByText("Connect an AI provider to continue")).toBeVisible();
    await expect(dock(page).getByRole("button", { name: "Connect a provider" })).toBeVisible();
    await expect(composer(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("folds to the Assistant pill and opens again with the pill and Mod+J", async ({ page }) => {
    const errors = await open(page);
    await openNote(page, "Masking strategy report");
    await dock(page).getByRole("button", { name: "Hide prompt" }).click();
    await expect(dock(page)).toHaveAttribute("data-prompt-state", "collapsed");
    const pill = dock(page).getByRole("button", { name: /^Assistant / });
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(dock(page)).toHaveAttribute("data-prompt-state", "expanded");
    await expect(composer(page)).toBeFocused();
    await page.locator(".ProseMirror:visible > p").first().click();
    await page.keyboard.press("ControlOrMeta+j");
    await expect(dock(page)).toHaveAttribute("data-prompt-state", "collapsed");
    await page.keyboard.press("ControlOrMeta+j");
    await expect(dock(page)).toHaveAttribute("data-prompt-state", "expanded");
    expect(errors).toEqual([]);
  });

  test("keeps a separate conversation for each note", async ({ page }) => {
    const errors = await open(page);
    await openNote(page, "Masking strategy report");
    await ask(page, "What does the note say about the mask ratio?");
    await expect(conversation(page)).toContainText(REPLIES.chat);
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();

    await openNote(page, "Abstract draft");
    await expect(composer(page)).toBeVisible();
    await expect(conversation(page)).toHaveCount(0);

    await openNote(page, "Masking strategy report");
    await expect(conversation(page)).toContainText("What does the note say about the mask ratio?");
    await expect(conversation(page)).toContainText(REPLIES.chat);
    expect((await agentRuns(page)).map((run) => run.status)).toEqual(["done"]);
    expect(errors).toEqual([]);
  });

  test("answers, suggests an edit with propose_note_edits and saves the note when it is accepted", async ({ page }) => {
    const errors = await open(page);
    await openNote(page, "Masking strategy report");
    const before = await noteText(page, "masking");
    await ask(page, "Tighten the second paragraph");

    await expect(conversation(page)).toContainText(REPLIES.tighten);
    await expect(page.locator(".note-diff-insert")).toContainText("patch, not per");
    expect(await noteText(page, "masking")).toBe(before);

    await conversation(page).getByTestId("worked-steps-toggle").click();
    const card = conversation(page).locator('[data-tool-name="propose_note_edits"]');
    await expect(card).toHaveAttribute("data-tool-status", "done");
    await expect(card).toHaveAttribute("data-tool-result", "success");

    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
    await expect(page.locator(".ProseMirror:visible")).toContainText(EDITS.patch.replace);
    await expect.poll(() => noteText(page, "masking")).toBe(before.replace(EDITS.patch.find, EDITS.patch.replace));
    const [run] = await agentRuns(page);
    expect(run.calls).toEqual(["read_note", "propose_note_edits"]);
    expect(run.tools).toEqual(expect.arrayContaining(["read_note", "propose_note_edits"]));
    expect(errors).toEqual([]);
  });
});
