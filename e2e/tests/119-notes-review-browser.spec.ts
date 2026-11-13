import { EDITS, REPLIES } from "../notes-agent-mock";
import { expect, type NotesPage, test } from "../notes-page";

const ABSTRACT_ID = "2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3e02";
const REMOTE_IMAGE = "https://images.example.com/sweep.png";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const CHECKLIST = `---
title: Abstract draft
kind: note
id: ${ABSTRACT_ID}
---

> [!warning] Before the next run
> Seeds 1 to 3 diverge.

- [ ] Rerun the sweep
- [ ] Write the abstract
`;

function outsideEdit(notes: NotesPage, id: string, from: string, to: string): Promise<string> {
  return notes.text(id).then(async (before) => {
    const after = before.replace(from, to);
    await notes.writeFromDisk(id, after);
    return after;
  });
}

test.describe("Notes review", () => {
  test("asks for a provider first when none is set up", async ({ notes }) => {
    const { page } = await notes.open("?ai=none");
    await notes.openNote("Masking strategy report");
    const dock = page.locator("[data-prompt-state]:visible");
    await expect(dock).toHaveAttribute("data-prompt-state", "expanded");
    await expect(dock.getByText("Connect an AI provider to continue")).toBeVisible();
    await expect(dock.getByRole("button", { name: "Connect a provider" })).toBeVisible();
    await expect(notes.composer).toHaveCount(0);
  });

  test("reviews the assistant's changes one at a time before they reach the note", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    const before = await notes.text("masking");
    await notes.runAction("rewr", "Rewrite the note");

    await expect(notes.button("Reject all")).toBeVisible();
    await expect(page.getByText("Change 1 of 2")).toBeAttached();
    await expect(notes.firstParagraph).toContainText("mask ratio of 0.75");
    await expect(page.locator(".note-diff-delete").first()).toContainText("0.75");
    await expect(notes.conversation).toContainText(REPLIES.rewrite);
    expect(await notes.text("masking")).toBe(before);

    await notes.button("Accept").click();
    await expect(page.locator(".note-diff-delete")).toHaveText(["64.1%."]);
    await expect(notes.firstParagraph).toContainText("mask ratio of 0.60");

    await notes.button("Reject").click();
    await expect(notes.button("Accept")).toHaveCount(0);
    await expect(notes.composer).toBeVisible();
    await expect(notes.firstParagraph).not.toContainText("after the ratio dropped");
    await expect.poll(() => notes.text("masking")).toContain("mask ratio of 0.60. The first run");
    expect(await notes.text("masking")).toContain("and run 3 reached 64.1%.\n");
    const [run] = await notes.runs();
    expect(run.calls).toEqual(["read_note", "propose_note_edits"]);
    expect(run.status).toBe("done");
  });

  test("accepts every change at once, including a new paragraph", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    await notes.runAction("paragraph", "Write a new paragraph");
    await expect(page.locator(".ProseMirror:visible > p > .note-diff-insert")).toContainText("Run 3 is the first run");
    await expect(notes.button("Reject all")).toHaveCount(0);
    await notes.button("Accept").click();
    await expect(page.locator(".ProseMirror:visible > p", { hasText: "Run 3 is the first run" })).toBeVisible();
    await expect.poll(() => notes.text("masking")).toContain("\n\nRun 3 is the first run with the lower ratio");
    await expect(notes.conversation).toContainText(REPLIES.paragraph);

    await notes.runAction("rewr", "Rewrite the note");
    await notes.button("Accept all").click();
    await expect(notes.firstParagraph).toContainText("0.60. The first run");
    await expect(notes.firstParagraph).toContainText("after the ratio dropped to 0.60");
    await expect.poll(() => notes.text("masking")).toContain("and run 3 reached 64.1% after the ratio dropped to 0.60.");
    expect(await notes.text("masking")).toContain("mask ratio of 0.60. The first run");
  });

  test("accepts an edit inside a callout and rejects one inside a task, and undo brings a rejected change back", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.writeFromDisk("abstract", CHECKLIST);
    await notes.openNote("Abstract draft");
    await notes.ask("Sharpen the callout and the tasks");
    await expect(notes.conversation).toContainText(REPLIES.checklist);
    await expect(page.getByText("Change 1 of 2")).toBeAttached();
    await expect(notes.editor.locator(".note-callout .note-diff-insert")).toContainText("after epoch 40");
    await expect(notes.editor.locator("li .note-diff-insert")).toContainText("with five seeds");

    await notes.button("Accept").click();
    await notes.button("Reject").click();
    await expect(notes.button("Accept")).toHaveCount(0);
    await expect.poll(() => notes.text("abstract")).toContain(EDITS.callout.replace);
    expect(await notes.text("abstract")).toContain(EDITS.task.find);

    await notes.editor.click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(notes.editor.locator("li .note-diff-insert")).toContainText("with five seeds");
    await notes.button("Accept").click();
    await expect.poll(() => notes.text("abstract")).toContain(EDITS.task.replace);
  });

  test("offers the latest run only when the note's project has a finished task, and the code check only with a project", async ({
    notes,
  }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    await notes.composer.fill("/");
    await expect(page.getByRole("option", { name: "Proofread the note" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Update from the latest run" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Check claims against the code" })).toBeVisible();
    await notes.composer.fill("");

    await notes.openNote("Reading notes: masked autoencoders");
    await notes.composer.fill("/");
    await expect(page.getByRole("option", { name: "Proofread the note" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Update from the latest run" })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "Check claims against the code" })).toBeVisible();
    await notes.composer.fill("");

    await page.getByRole("button", { name: "Project: Literature" }).click();
    await page.getByRole("menuitemradio", { name: "No project" }).click();
    await expect(page.getByRole("button", { name: "Project: Choose project" })).toBeVisible();
    await notes.composer.fill("/");
    await expect(page.getByRole("option", { name: "Proofread the note" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Check claims against the code" })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "Update from the latest run" })).toHaveCount(0);
  });

  test("updates the note from the latest research task", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    await notes.runAction("latest", "Update from the latest run");
    await expect(page.locator(".note-diff-insert").first()).toContainText("0.60");
    await expect(page.locator(".note-diff-delete").first()).toContainText("0.75");
    await expect(notes.button("Reject all")).toHaveCount(0);
    await expect(notes.conversation).toContainText(REPLIES.latestRun);
    const [run] = await notes.runs();
    expect(run.prompt).toContain("### The latest research task (untrusted reference data)");
    expect(run.prompt).toContain("Task: Review run 3");
    expect(run.calls).toEqual(["read_note", "propose_note_edits"]);
  });

  test("sends the turn to the model picked for that note and remembers the pick per note across a reload", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Abstract draft");
    const picker = page.getByRole("combobox", { name: "AI model" });
    await expect(picker).toContainText("GPT-5 mini");
    await picker.click();
    await page.getByTestId("ai-model-option-openai-gpt-5").click();
    await expect(picker).toContainText("GPT-5");
    await expect(picker).not.toContainText("mini");
    await notes.runAction("proof", "Proofread the note");
    await expect(notes.conversation).toContainText(REPLIES.proofread);
    const [run] = await notes.runs();
    expect([run.provider, run.model]).toEqual(["openai", "gpt-5"]);

    await notes.openNote("Masking strategy report");
    await expect(picker).toContainText("GPT-5");
    await expect(picker).not.toContainText("mini");
    await picker.click();
    await page.getByTestId("ai-model-option-openai-gpt-5-mini").click();
    await expect(picker).toContainText("GPT-5 mini");
    await notes.openNote("Abstract draft");
    await expect(picker).not.toContainText("mini");
    await expect(notes.conversation).toContainText(REPLIES.proofread);

    await notes.reload();
    await notes.openNote("Abstract draft");
    await expect(picker).toContainText("GPT-5");
    await expect(picker).not.toContainText("mini");
    await notes.openNote("Masking strategy report");
    await expect(picker).toContainText("GPT-5 mini");
  });

  test("shows an answer with no edits as a normal reply", async ({ notes }) => {
    await notes.open();
    await notes.openNote("Abstract draft");
    const before = await notes.text("abstract");
    await notes.runAction("proof", "Proofread the note");
    await expect(notes.conversation).toContainText(REPLIES.proofread);
    await expect(notes.button("Send")).toBeVisible();
    await expect(notes.diffs).toHaveCount(0);
    await expect(notes.button("Accept")).toHaveCount(0);
    expect(await notes.text("abstract")).toBe(before);
    const [run] = await notes.runs();
    expect(run.calls).toEqual(["read_note"]);
  });

  test("keeps a separate conversation for each note", async ({ notes }) => {
    await notes.open();
    await notes.openNote("Masking strategy report");
    await notes.ask("What does the note say about the mask ratio?");
    await expect(notes.conversation).toContainText(REPLIES.chat);
    await expect(notes.button("Send")).toBeVisible();

    await notes.openNote("Abstract draft");
    await expect(notes.composer).toBeVisible();
    await expect(notes.conversation).toHaveCount(0);

    await notes.openNote("Masking strategy report");
    await expect(notes.conversation).toContainText("What does the note say about the mask ratio?");
    await expect(notes.conversation).toContainText(REPLIES.chat);
    expect((await notes.runs()).map((run) => run.status)).toEqual(["done"]);
  });

  test("answers, suggests an edit with propose_note_edits and saves the note when it is accepted", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    const before = await notes.text("masking");
    await notes.ask("Tighten the second paragraph");

    await expect(notes.conversation).toContainText(REPLIES.tighten);
    await expect(page.locator(".note-diff-insert")).toContainText("patch, not per");
    expect(await notes.text("masking")).toBe(before);

    await notes.conversation.getByTestId("worked-steps-toggle").click();
    const card = notes.conversation.locator('[data-tool-name="propose_note_edits"]');
    await expect(card).toHaveAttribute("data-tool-status", "done");
    await expect(card).toHaveAttribute("data-tool-result", "success");

    await notes.button("Accept").click();
    await expect(notes.button("Accept")).toHaveCount(0);
    await expect(notes.editor).toContainText(EDITS.patch.replace);
    await expect.poll(() => notes.text("masking")).toBe(before.replace(EDITS.patch.find, EDITS.patch.replace));
    const [run] = await notes.runs();
    expect(run.calls).toEqual(["read_note", "propose_note_edits"]);
    expect(run.tools).toEqual(expect.arrayContaining(["read_note", "propose_note_edits"]));
  });

  test("stops a running turn before it suggests anything", async ({ notes }) => {
    await notes.open("?delay=10000");
    await notes.openNote("Masking strategy report");
    await notes.ask("Tighten the second paragraph");
    const stop = notes.button("Stop");
    await expect(stop).toBeVisible();
    await expect(notes.conversation).toContainText("Reading the note first.");
    await stop.click();
    await expect(notes.button("Send")).toBeVisible();
    await expect.poll(async () => (await notes.runs())[0]?.status).toBe("cancelled");
    expect((await notes.runs())[0].calls).toEqual([]);
    await expect(notes.diffs).toHaveCount(0);
    await expect(notes.composer).toBeEnabled();
  });

  test("quotes a selection in the composer and focuses it", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    await notes.firstParagraph.dblclick({ position: { x: 20, y: 12 } });
    const selected = await page.evaluate(() => window.getSelection()?.toString().trim() ?? "");
    expect(selected).not.toBe("");
    await page.getByRole("button", { name: "Ask agent" }).click();
    await expect(notes.composer).toBeFocused();
    await expect(notes.composer).toHaveValue(`> ${selected}\n\n`);
  });

  test("folds the assistant to a pill without moving the note and brings it back with the pill and Mod+J", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    const view = notes.shown;
    const before = await notes.title.boundingBox();
    await view.getByRole("button", { name: "Hide prompt" }).click();
    const pill = view.getByRole("button", { name: /^Assistant / });
    await expect(pill).toBeVisible();
    await expect(notes.composer).toHaveCount(0);
    expect(await notes.title.boundingBox()).toEqual(before);
    const area = await view.boundingBox();
    const box = await pill.boundingBox();
    if (!area || !box) throw new Error("no geometry");
    expect(area.x + area.width - (box.x + box.width)).toBeLessThan(40);
    expect(area.y + area.height - (box.y + box.height)).toBeLessThan(40);

    await notes.firstParagraph.click();
    await page.keyboard.press("ControlOrMeta+j");
    await expect(notes.composer).toBeFocused();
    await page.keyboard.press("ControlOrMeta+j");
    await expect(pill).toBeVisible();
    await expect(notes.editor).toBeFocused();

    await notes.reload();
    await notes.openNote("Masking strategy report");
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(notes.composer).toBeFocused();
  });

  test("keeps Stop in the folded pill while a turn runs", async ({ notes }) => {
    await notes.open("?delay=10000");
    await notes.openNote("Masking strategy report");
    await notes.ask("Tighten the second paragraph");
    await notes.shown.getByRole("button", { name: "Hide prompt" }).click();
    const stop = notes.shown.getByRole("button", { name: "Stop", exact: true });
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(stop).toHaveCount(0);
    await expect.poll(async () => (await notes.runs())[0]?.status).toBe("cancelled");
    await notes.shown.getByRole("button", { name: /^Assistant / }).click();
    await expect(notes.button("Send")).toBeVisible();
    await expect(notes.diffs).toHaveCount(0);
  });

  test("snaps the prompt open and shut when motion is reduced", async ({ notes }) => {
    const { page } = notes;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await notes.open();
    await notes.openNote("Masking strategy report");
    await notes.shown.getByRole("button", { name: "Hide prompt" }).click();
    const scripted = await page.evaluate(
      () =>
        document
          .querySelector("[data-prompt-state]")
          ?.getAnimations({ subtree: true })
          .filter((animation) => animation.constructor === Animation).length,
    );
    expect(scripted).toBe(0);
    await expect(notes.shown.getByRole("button", { name: /^Assistant / })).toBeVisible();
  });

  test("leaves an outside change on disk as written until it is rejected", async ({ notes }) => {
    await notes.open();
    await notes.openNote("Masking strategy report");
    const before = await notes.text("masking");
    const after = await outsideEdit(notes, "masking", "sampled per pixel", "sampled per patch");
    await expect(notes.page.locator(".note-diff-insert")).toContainText("patch");
    await expect(notes.editor).toContainText("per pixel");
    await expect(notes.page.locator(".note-diff-insert")).toBeVisible();
    expect(await notes.text("masking")).toBe(after);
    expect(await notes.saves("masking")).toBe(0);
    await notes.button("Reject").click();
    await expect.poll(() => notes.text("masking")).toBe(before);
  });

  test("keeps an outside change when it is accepted", async ({ notes }) => {
    await notes.open();
    await notes.openNote("Masking strategy report");
    const after = await outsideEdit(notes, "masking", "sampled per pixel", "sampled per patch");
    await notes.button("Accept").click();
    await expect(notes.editor).toContainText("per patch");
    await expect(notes.page.locator('[data-note-view="masking"] [data-note-save-status="saved"]')).toBeVisible();
    await expect.poll(() => notes.text("masking")).toBe(after);
  });

  test("keeps an outside change reviewable while the person types elsewhere, and writes only their paragraph", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    await notes.firstParagraph.click();
    await page.keyboard.press("End");
    const after = await outsideEdit(notes, "masking", "sampled per pixel", "sampled per patch");
    await expect(page.locator(".note-diff-insert")).toContainText("patch");
    await page.keyboard.type(" Run 4 is queued.");
    await expect.poll(() => notes.text("masking")).toContain("and run 3 reached 64.1%. Run 4 is queued.");
    expect(await notes.text("masking")).toContain("sampled per patch");
    await expect(page.locator(".note-diff-insert")).toContainText("patch");
    await notes.button("Reject").click();
    await expect.poll(() => notes.text("masking")).toContain("sampled per pixel");
    expect(await notes.text("masking")).toContain("Run 4 is queued.");
    expect(after).not.toContain("Run 4 is queued.");
  });

  test("brings back an outside change that was not reviewed when the note is closed and opened again", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    await outsideEdit(notes, "masking", "sampled per pixel", "sampled per patch");
    await expect(page.locator(".note-diff-insert")).toContainText("patch");
    await page.getByRole("button", { name: /^Close Masking strategy report/ }).click();
    await expect(notes.tabs).toHaveText(["Home"]);
    await notes.openNote("Masking strategy report");
    await expect(page.locator(".note-diff-insert")).toContainText("patch");
    await notes.button("Accept").click();
    await expect.poll(() => notes.text("masking")).toContain("sampled per patch");
  });

  for (const [kind, reason] of [
    ["permission", "Permission denied (os error 13)"],
    ["full", "No space left on device (os error 28)"],
  ] as const) {
    test(`shows a save refused for ${kind} as a banner and saves on Retry`, async ({ notes }) => {
      const { page } = await notes.open();
      await notes.openNote("Abstract draft");
      await notes.failNextWrite(kind);
      await notes.firstParagraph.click();
      await page.keyboard.press("End");
      await page.keyboard.type(" Kept.");
      const banner = page.getByText(`Not saved: ${reason}`);
      await expect(banner).toBeVisible();
      expect(await notes.text("abstract")).not.toContain("Kept.");
      await notes.button("Retry").click();
      await expect.poll(() => notes.text("abstract")).toContain("up to a point. Kept.");
      await expect(banner).toHaveCount(0);
    });
  }

  test("saves again after a write that ran into an unchanged file on disk", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Abstract draft");
    await notes.failNextWrite("conflict");
    await notes.firstParagraph.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Kept.");
    await expect.poll(() => notes.text("abstract")).toContain("up to a point. Kept.");
    await expect(notes.diffs).toHaveCount(0);
    await expect(page.getByText(/^Not saved/u)).toHaveCount(0);
  });

  test("holds back a web image in an outside change until it is loaded", async ({ notes }) => {
    const { page } = notes;
    const requests: string[] = [];
    await page.route(REMOTE_IMAGE, (route) => {
      requests.push(route.request().url());
      return route.fulfill({ contentType: "image/png", body: PNG });
    });
    await notes.open();
    await notes.openNote("Abstract draft");
    await outsideEdit(notes, "abstract", "## Contributions", `![Sweep](${REMOTE_IMAGE})\n\n## Contributions`);
    const held = notes.editor.getByText("Image from images.example.com");
    await expect(held).toBeVisible();
    await expect(notes.editor.locator(`img[src="${REMOTE_IMAGE}"]`)).toHaveCount(0);
    expect(requests).toEqual([]);
    await notes.editor.getByRole("button", { name: "Load image", exact: true }).click();
    await expect(notes.editor.locator(`img[src="${REMOTE_IMAGE}"]`)).toBeVisible();
    expect(requests).toEqual([REMOTE_IMAGE]);
  });
});
