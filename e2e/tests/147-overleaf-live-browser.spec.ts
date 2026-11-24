import { expect, test, type Page } from "@playwright/test";
import { harnessCalls, openHarnessPage } from "../harness-page";

async function openHarness(page: Page, query: string, size = { width: 420, height: 360 }) {
  await openHarnessPage(page, "overleaf-live-harness", query, size);
}

const REVIEW_SIZE = { width: 420, height: 900 };

async function openReview(page: Page, query: string) {
  await openHarness(page, `view=comments&live=online&${query}`, REVIEW_SIZE);
  await expect(page.getByTestId("comments-pane")).toBeVisible();
}

test("the toolbar says how live editing with Overleaf stands", async ({ page }) => {
  for (const [query, state, words] of [
    ["live=online", "upToDate", "Up to date"],
    ["live=connecting", "syncing", "Connecting to Overleaf…"],
    ["live=sending", "syncing", "Sending changes to Overleaf…"],
    ["live=offline", "offline", "Offline. Changes waiting: 3"],
    ["live=paused", "paused", "Paused"],
    ["live=signedout", "signedOut", "Signed out"],
  ] as const) {
    await openHarness(page, query);
    const button = page.getByTestId("overleaf-live-button");
    await expect(button).toHaveAttribute("data-sync-state", state);
    await button.click();
    await expect(page.getByTestId("overleaf-live-status")).toHaveText(words);
  }
});

test("Pause asks before leaving unsent changes behind", async ({ page }) => {
  await openHarness(page, "live=online");
  await page.getByTestId("overleaf-live-button").click();
  await page.getByRole("menuitem", { name: "Pause live editing" }).click();
  const dialog = page.getByTestId("overleaf-pause-dialog");
  await expect(dialog.getByText("Some changes haven't reached Overleaf yet")).toBeVisible();
  await expect(dialog.getByText("sections/intro.tex")).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing live" }).click();
  await expect(dialog).toBeHidden();
});

test("a paused project with a Git token keeps the Git sync button, marked paused", async ({ page }) => {
  await openHarness(page, "linked=1&token=1&live=gitpaused");
  await expect(page.getByTestId("overleaf-live-paused-badge")).toHaveText("Live editing paused");
  await page.getByTestId("overleaf-sync-button").click();
  await expect(page.getByRole("menuitem", { name: "Resume live editing" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sync now" })).toBeVisible();
});

test("while offline the toolbar counts down to the next try on its own line", async ({ page }) => {
  await openHarness(page, "live=offline");
  await page.getByTestId("overleaf-live-button").click();
  await expect(page.getByTestId("overleaf-live-status")).toHaveText("Offline. Changes waiting: 3");
  await expect(page.getByTestId("overleaf-live-status-note")).toHaveText(/^Trying again in [1-4] s\.$/);
});

test("the banners show maintenance, a review, a merge and an unsteady file, and a review compares both copies", async ({
  page,
}) => {
  await openHarness(page, "live=maintenance&notice=maintenance&notice=review&notice=merged&notice=unsteady");
  await expect(page.getByTestId("overleaf-maintenance-banner")).toContainText("The server is restarting for an update.");
  await expect(page.getByTestId("overleaf-merged-row")).toContainText("main.tex");
  await expect(page.getByTestId("overleaf-unsteady-row")).toContainText("refs.bib");
  const review = page.getByTestId("overleaf-review-row");
  await expect(review).toContainText("sections/results.tex");
  await review.getByRole("button", { name: "Compare" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Red lines are yours and green lines are Overleaf's.");
  await expect(dialog.getByRole("button", { name: "Use Overleaf's" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Use mine" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).first().click();
  await expect(dialog).toBeHidden();
});

test("on an Overleaf server without comments the Comments tab shows tracked changes and says why", async ({ page }) => {
  await openReview(page, "role=editor&comments=off");
  const pane = page.getByTestId("comments-pane");
  await expect(pane.getByText("This Overleaf server doesn't have comments, so only tracked changes show here.")).toBeVisible();
  await expect(pane.locator("[data-suggestion-card]")).toHaveCount(2);
  await expect(pane.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("status", { name: "This Overleaf server can't turn track changes on or off" })).toHaveText(
    "Editing",
  );
  expect(await harnessCalls(page, "collab_comment_thread_list")).toEqual([]);
});

test("a reviewer sees Suggesting locked on, with the reason", async ({ page }) => {
  await openReview(page, "role=reviewer");
  const locked = page.getByRole("status", {
    name: "You're a reviewer, so your edits become suggestions for an owner or editor to accept",
  });
  await expect(locked).toHaveText("Suggesting");
  await expect(page.getByRole("button", { name: "Editing" })).toHaveCount(0);
  await expect(page.locator("[data-suggestion-card]").getByRole("button", { name: "Accept" })).toHaveCount(0);
});

test("a replacement is one card, and Accept and Reject act on both of its changes", async ({ page }) => {
  await openReview(page, "role=owner");
  const pair = page.locator('[data-suggestion-card="c00001"]');
  await expect(pair).toHaveAttribute("data-suggestion-replaced", "c00002");
  await expect(page.locator('[data-suggestion-card="c00002"]')).toHaveCount(0);
  await expect(pair.getByText("Changed")).toBeVisible();
  await expect(pair.getByText("network")).toBeVisible();
  await expect(pair.getByText("model")).toBeVisible();
  await pair.getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => harnessCalls(page, "collab_suggestion_accept")).toEqual([
    { projectId: "project-1", ids: ["c00001", "c00002"] },
  ]);
  await page.locator('[data-suggestion-card="c00003"]').getByRole("button", { name: "Reject" }).click();
  await expect.poll(() => harnessCalls(page, "collab_suggestion_reject")).toEqual([{ projectId: "project-1", ids: ["c00003"] }]);
});

test("Accept stays off with the reason where Overleaf can't accept, and Reject still works", async ({ page }) => {
  await openReview(page, "role=owner&accept=0");
  const card = page.locator('[data-suggestion-card="c00003"]');
  const accept = card.getByRole("button", { name: "Accept" });
  await expect(accept).toBeDisabled();
  await expect(page.getByRole("button", { name: "Accept all" })).toBeDisabled();
  await accept.hover({ force: true });
  await expect(page.getByRole("tooltip")).toHaveText(
    "This Overleaf server can't accept tracked changes in this file. You can still reject them.",
  );
  await card.getByRole("button", { name: "Reject" }).click();
  await expect.poll(() => harnessCalls(page, "collab_suggestion_reject")).toEqual([{ projectId: "project-1", ids: ["c00003"] }]);
  expect(await harnessCalls(page, "collab_suggestion_accept")).toEqual([]);
});

test("replying, resolving and track changes for everyone reach the app as calls", async ({ page }) => {
  await openReview(page, "role=owner");
  const thread = page.locator('[data-comment-thread="64f1c2a3b4c5d6e7f80900aa"]');
  await expect(thread.getByText("Is 40 the right number?")).toBeVisible();
  await thread.getByRole("button", { name: "Reply", exact: true }).click();
  await thread.getByRole("textbox", { name: "Reply" }).fill("Yes, it is.");
  await thread.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => harnessCalls(page, "collab_comment_reply")).toEqual([
    expect.objectContaining({
      projectId: "project-1",
      fileId: "6af963ebc9037022065bb541",
      threadId: "64f1c2a3b4c5d6e7f80900aa",
      body: "Yes, it is.",
    }),
  ]);
  await thread.locator("[data-resolve-button]").evaluate((button: HTMLElement) => button.click());
  await expect.poll(() => harnessCalls(page, "collab_comment_resolve")).toHaveLength(1);
  await page.getByRole("button", { name: "Suggesting" }).click();
  await expect.poll(() => harnessCalls(page, "collab_edit_mode_set")).toEqual([
    { projectId: "project-1", mode: "suggesting", scope: "me" },
  ]);
  await page.getByRole("button", { name: "Track changes for others" }).click();
  await page.getByRole("menuitemcheckbox", { name: "For everyone" }).click();
  await expect.poll(() => harnessCalls(page, "collab_edit_mode_set")).toContainEqual({
    projectId: "project-1",
    mode: "suggesting",
    scope: "everyone",
  });
});

const CHAT_SIZE = { width: 420, height: 760 };

async function openChat(page: Page, query = "") {
  await openHarness(page, `view=chat&live=online&${query}`, CHAT_SIZE);
  await expect(page.getByTestId("chat-pane")).toBeVisible();
}

async function chatChanged(page: Page, change: "new" | "edit", posted = "One more thing") {
  await page.evaluate(({ kind, body }) => {
    const harness = (
      window as unknown as {
        __chat: {
          messages: { author: string; body: string; editedAt: number | null }[];
          add: (author: string, body: string, minutes: number) => { author: string; body: string; editedAt: number | null };
          emit: (event: string, payload: unknown) => Promise<void>;
        };
      }
    ).__chat;
    if (kind === "new") harness.messages.push(harness.add("64f1c2a3b4c5d6e7f8091a2c", body, 30 + harness.messages.length));
    else Object.assign(harness.messages[1], { body: "The bound is tight", editedAt: Date.now() });
    return harness.emit("collab://chat-changed", { projectId: "project-1", local: false, mentioned: [] });
  }, { kind: change, body: posted });
}

test("Overleaf chat draws math and links, names someone who left, and offers no reactions or Clear chat", async ({ page }) => {
  await openChat(page, "role=owner");
  const pane = page.getByTestId("chat-pane");
  await expect(page.getByTestId("chat-rail-tab")).toBeVisible();
  const math = pane.locator('[data-comment-math="inline"] .katex');
  await expect(math).toHaveCount(1);
  await expect(math).toBeVisible();
  const link = pane.getByRole("link", { name: "https://www.overleaf.com/learn" });
  await expect(link).toHaveAttribute("href", "https://www.overleaf.com/learn");
  await expect(link).toHaveAttribute("target", "_blank");
  const carol = pane.locator("[data-comment-entry]").filter({ hasText: "I set up the bibliography" });
  await expect(carol.getByText("Carol Diaz")).toBeVisible();
  await expect(carol.getByText("(left the project)")).toBeVisible();
  await expect(pane.getByRole("button", { name: "Clear chat" })).toHaveCount(0);
  await expect(pane.getByRole("button", { name: "Add reaction" })).toHaveCount(0);
  expect(await harnessCalls(page, "collab_chat_status")).toEqual([{ projectId: "project-1" }]);
});

test("sending, editing and deleting your own Overleaf chat message reach the app, and a deleted message is gone", async ({ page }) => {
  await openChat(page);
  const pane = page.getByTestId("chat-pane");
  await pane.getByRole("textbox", { name: "Message" }).fill("Sending from Oleafly");
  await pane.getByRole("button", { name: "Send" }).click();
  await expect(pane.getByText("Sending from Oleafly")).toBeVisible();
  await expect.poll(() => harnessCalls(page, "collab_chat_send")).toEqual([
    expect.objectContaining({ projectId: "project-1", body: "Sending from Oleafly" }),
  ]);
  const own = pane.locator("[data-comment-entry]").filter({ hasText: "Will check it today" });
  await own.hover();
  await own.getByRole("button", { name: "More actions for this message" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const field = pane.getByRole("textbox", { name: "Edit message" });
  await field.fill("Checked it today");
  await pane.getByRole("button", { name: "Save" }).click();
  const edited = pane.locator("[data-comment-entry]").filter({ hasText: "Checked it today" });
  await expect(edited).toContainText("edited");
  const [edit] = await harnessCalls(page, "collab_chat_edit");
  expect(edit).toMatchObject({ projectId: "project-1", body: "Checked it today" });
  expect(String(edit.id)).toMatch(/^[0-9a-f]{24}$/u);
  await edited.hover();
  await edited.getByRole("button", { name: "More actions for this message" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(edited).toHaveCount(0);
  await expect(pane.getByText("This message was deleted.")).toHaveCount(0);
  expect(await harnessCalls(page, "collab_chat_delete")).toEqual([{ projectId: "project-1", id: edit.id }]);
});

test("a new Overleaf chat message from someone else dots the chat rail, and an edit doesn't", async ({ page }) => {
  await openChat(page);
  const dot = page.getByTestId("chat-rail-dot");
  await chatChanged(page, "edit");
  await expect(page.getByTestId("chat-pane").getByText("The bound is tight")).toBeVisible();
  await expect(dot).toHaveCount(0);
  await chatChanged(page, "new");
  await expect(page.getByTestId("chat-pane").getByText("One more thing")).toBeVisible();
  await expect(dot).toBeVisible();
});

test("the line break beside display math in chat folds away only when the math draws as a block", async ({ page }) => {
  await openChat(page);
  await chatChanged(page, "new", "Drawn $$x^2$$\nnext line");
  await chatChanged(page, "new", "Broken $$\\notacommand$$\nnext line");
  const pane = page.getByTestId("chat-pane");
  await expect(pane.locator('[data-comment-math="display"] .katex')).toHaveCount(1);
  await expect(pane.locator("[data-comment-math-source]")).toHaveCount(1);
  const beside = (math: string) =>
    pane.locator(math).evaluate((node) =>
      [node.previousElementSibling, node.nextElementSibling].map((gap) => [
        gap?.textContent,
        gap ? getComputedStyle(gap).whiteSpace : null,
      ]),
    );
  expect(await beside('[data-comment-math="display"]')).toEqual([
    [" ", "normal"],
    ["\n", "normal"],
  ]);
  expect(await beside("[data-comment-math-source]")).toEqual([
    [" ", "pre-wrap"],
    ["\n", "pre-wrap"],
  ]);
});

test("an Overleaf viewer can post, and the chat stays hidden when the server has it off or the link user is restricted", async ({
  page,
}) => {
  await openChat(page, "role=viewer");
  await expect(page.getByTestId("chat-pane").getByRole("textbox", { name: "Message" })).toBeVisible();
  for (const query of ["chat=off", "restricted=1"]) {
    await openChat(page, query);
    await expect.poll(() => harnessCalls(page, "collab_chat_status")).toHaveLength(1);
    await expect(page.getByTestId("chat-rail-tab")).toHaveCount(0);
    expect(await harnessCalls(page, "collab_chat_list")).toEqual([]);
  }
});

async function swatch(page: Page, hue: number): Promise<string> {
  return page.evaluate((value) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = `hsl(${value} 55% 45%)`;
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, hue);
}

async function avatarColor(page: Page, scope: ReturnType<Page["locator"]>): Promise<string> {
  return scope
    .locator('[data-slot="avatar"]')
    .first()
    .evaluate((avatar) => getComputedStyle(avatar).backgroundColor);
}

test("Overleaf people get Overleaf's own hue, in chat and on tracked changes", async ({ page }) => {
  await openChat(page, "role=owner");
  const dana = page.locator("[data-comment-entry]").filter({ hasText: "Figures are in" });
  await expect(dana).toBeVisible();
  expect(await avatarColor(page, dana)).toBe(await swatch(page, 89));

  await openReview(page, "role=owner");
  const bob = await page.evaluate<number>(
    `import("/src/features/collab/live/peer-hue.ts").then(({ overleafHue }) => overleafHue("64f1c2a3b4c5d6e7f8091a2c", "64f1c2a3b4c5d6e7f8091a2b"))`,
  );
  const server = await page.evaluate<number>(
    `import("/src/components/ui/avatar.tsx").then(({ avatarHue }) => avatarHue("64f1c2a3b4c5d6e7f8091a2c"))`,
  );
  expect(bob).not.toBe(server);
  const card = page.locator('[data-suggestion-card="c00003"]');
  await expect(card).toBeVisible();
  expect(await avatarColor(page, card)).toBe(await swatch(page, bob));
});

const HISTORY_SIZE = { width: 420, height: 900 };

function version(page: Page, text: string) {
  return page.locator("li").filter({ hasText: text });
}

test("Overleaf history lists named versions and downloads one as a ZIP", async ({ page }) => {
  await openHarness(page, "view=history&live=online&role=owner", HISTORY_SIZE);
  const named = version(page, "Submitted draft");
  await expect(named).toContainText("Bob Smith");
  await expect(version(page, "Alice Chen")).toContainText("Dana Ruiz");
  await expect(named.getByRole("button", { name: "Rename" })).toBeVisible();
  await expect(named.getByRole("button", { name: "Remove name" })).toBeVisible();
  await named.getByRole("button", { name: "Download as ZIP" }).click();
  await expect.poll(() => harnessCalls(page, "collab_history_zip")).toEqual([
    { projectId: "project-1", versionId: "12", dest: "/tmp/oleafly-e2e/Paper (version 12).zip" },
  ]);
  expect(await harnessCalls(page, "pick_save_path")).toEqual([
    { options: expect.objectContaining({ defaultPath: "Paper (version 12).zip" }) },
  ]);
  await expect(page.getByTestId("collab-history-limited")).toHaveCount(0);
});

test("restoring an Overleaf version says newer files go, and a viewer can only look", async ({ page }) => {
  await openHarness(page, "view=history&live=online&role=owner", HISTORY_SIZE);
  await version(page, "Submitted draft").getByRole("button", { name: "Open", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("The model converges after 40 epochs.")).toBeVisible();
  await dialog.getByRole("button", { name: "Restore whole project" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("files added since then are deleted");
  await confirm.getByRole("button", { name: "Restore project" }).click();
  await expect.poll(() => harnessCalls(page, "collab_history_restore")).toEqual([
    { projectId: "project-1", versionId: "12", paths: null },
  ]);

  await openHarness(page, "view=history&live=online&role=viewer&limited=1", HISTORY_SIZE);
  const named = version(page, "Submitted draft");
  await expect(named).toBeVisible();
  await expect(named.getByRole("button", { name: "Rename" })).toHaveCount(0);
  await expect(page.getByTestId("collab-history-limited")).toHaveText(
    "Older changes need an Overleaf plan with full history.",
  );
  await named.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("The model converges after 40 epochs.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore whole project" })).toHaveCount(0);
});

test("the On Overleaf settings pick the main bibliography, and a reviewer can't change them", async ({ page }) => {
  await openHarness(page, "view=settings&live=online&role=owner", { width: 420, height: 900 });
  const group = page.getByTestId("overleaf-project-settings");
  await expect(group).toContainText("On Overleaf");
  await expect(page.getByTestId("overleaf-tex-live")).toHaveText("TeX Live 2025");
  await page.getByTestId("overleaf-bibliography").click();
  await page.getByRole("option", { name: "refs.bib" }).click();
  await expect.poll(() => harnessCalls(page, "overleaf_live_set_setting")).toEqual([
    { projectId: "project-1", setting: "bibliography", value: "refs.bib" },
  ]);
  await expect(page.getByTestId("overleaf-bibliography")).toHaveText("refs.bib");

  await openHarness(page, "view=settings&live=online&role=reviewer", { width: 420, height: 900 });
  await expect(page.getByTestId("overleaf-bibliography")).toBeDisabled();
  await expect(page.getByTestId("overleaf-tex-live")).toBeDisabled();
});

test("a linked file is marked in the tree, names its source and refreshes from it", async ({ page }) => {
  await openHarness(page, "view=linked&live=online&role=owner", { width: 420, height: 700 });
  const row = page.getByRole("treeitem", { name: /^refs\.bib/ });
  await expect(row.getByTestId("tree-overleaf-linked")).toBeVisible();
  await expect(row).toHaveAttribute("title", "Linked to a source on Overleaf");
  await expect(page.getByRole("treeitem", { name: /^main\.tex/ }).getByTestId("tree-overleaf-linked")).toHaveCount(0);
  const banner = page.getByTestId("overleaf-linked-banner");
  await expect(banner).toContainText("refs.bib is linked to shared/library.bib on Overleaf.");
  await banner.getByRole("button", { name: "Refresh from source" }).click();
  await expect.poll(() => harnessCalls(page, "overleaf_live_refresh_linked")).toEqual([
    { projectId: "project-1", path: "refs.bib" },
  ]);
  await page.getByRole("button", { name: "More actions for refs.bib" }).click();
  await page.getByRole("menuitem", { name: "Refresh from source" }).click();
  await expect.poll(() => harnessCalls(page, "overleaf_live_refresh_linked")).toHaveLength(2);
});

test("a refused refresh shows Overleaf's words, and a reviewer gets no refresh", async ({ page }) => {
  await openHarness(page, "view=linked&live=online&role=owner&refresh=refused", { width: 420, height: 700 });
  const banner = page.getByTestId("overleaf-linked-banner");
  await banner.getByRole("button", { name: "Refresh from source" }).click();
  await expect(banner).toContainText("Overleaf couldn't refresh it: The source file is not shared with you");

  await openHarness(page, "view=linked&live=online&role=reviewer", { width: 420, height: 700 });
  await expect(page.getByTestId("overleaf-linked-banner")).toContainText("refs.bib is linked to shared/library.bib");
  await expect(page.getByTestId("overleaf-linked-banner").getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: "More actions for refs.bib" }).click();
  await expect(page.getByRole("menuitem").first()).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Refresh from source" })).toHaveCount(0);
});

test("learned words follow the Overleaf account both ways while live", async ({ page }) => {
  await openHarness(page, "view=words&live=online&role=owner", { width: 720, height: 900 });
  await expect(page.getByText("Knuth", { exact: true })).toBeVisible();
  await expect(page.getByText("Synced with the learned words on your Overleaf account")).toBeVisible();
  await expect.poll(() => harnessCalls(page, "overleaf_live_learn_words")).toEqual([
    { projectId: "project-1", learn: ["Oleafly"], unlearn: [] },
  ]);
  const field = page.getByRole("textbox", { name: "Add a globally ignored word" });
  await field.fill("Qwertzuiop");
  await field.press("Enter");
  await expect.poll(() => harnessCalls(page, "overleaf_live_learn_words")).toContainEqual({
    projectId: "project-1",
    learn: ["Qwertzuiop"],
    unlearn: [],
  });
});

const PDF_SOURCE = "\\section{Results}\nThe model converges after 40 epochs on the held-out set.\n";

async function selectPdfLine(page: Page, words: string) {
  await expect(page.getByTestId("pdf-renderer")).toHaveAttribute("data-pdf-state", "ready", { timeout: 30_000 });
  const line = page.locator(".textLayer span").filter({ hasText: words }).first();
  await expect(line).toBeVisible({ timeout: 30_000 });
  const box = await line.boundingBox();
  if (!box) throw new Error(`the PDF line with ${words} has no box`);
  await page.mouse.move(box.x + 0.5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 0.5, box.y + box.height / 2, { steps: 20 });
  await page.mouse.up();
  await page.waitForFunction((needle) => document.getSelection()?.toString().includes(needle) === true, words);
}

for (const backend of ["overleaf", "server"] as const) {
  test(`a PDF selection becomes a comment for coauthors on the matching source text (${backend})`, async ({ page }) => {
    await openHarness(page, `view=pdf&live=online&role=owner&backend=${backend}`, { width: 1100, height: 800 });
    await selectPdfLine(page, "converges after 40");
    await page.getByRole("button", { name: "Comment for coauthors" }).click();
    const pane = page.getByTestId("comments-pane");
    await expect(pane.getByText("The model converges after 40 epochs on the held-out set")).toBeVisible();
    await pane.getByRole("textbox", { name: "New comment" }).fill("Which split is this?");
    await pane.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => harnessCalls(page, "collab_comment_create")).toHaveLength(1);
    const [created] = await harnessCalls(page, "collab_comment_create");
    expect(created).toMatchObject({ projectId: "project-1", path: "main.tex", body: "Which split is this?" });
    const from = Number(created.from);
    const to = Number(created.to);
    expect(from).toBe(PDF_SOURCE.indexOf("The model"));
    expect(PDF_SOURCE.slice(from, to)).toMatch(/^The model converges after 40 epochs on the held-out set\.?$/u);
  });
}

test("without a comments module the PDF offers no comment for coauthors", async ({ page }) => {
  await openHarness(page, "view=pdf&live=online&role=owner&comments=off", { width: 1100, height: 800 });
  await selectPdfLine(page, "converges after 40");
  await expect(page.getByTestId("comments-pane")).toBeVisible();
  await expect(page.getByRole("button", { name: "Comment for coauthors" })).toHaveCount(0);
  expect(await harnessCalls(page, "collab_comment_create")).toEqual([]);
});
