import { createHash } from "node:crypto";
import { test, expect } from "../fixtures";
import {
  clickButton,
  fillTextarea,
  pressKey,
  readProjectText,
  selectEditorText,
  typeInEditorAfter,
  waitEditorContains,
  waitForText,
  waitLong,
  type Page,
} from "../helpers";
import {
  importOverleafProjectLive,
  leaveOverleafLive,
  noneShows,
  OverleafStack,
  reopenOverleafProjectLive,
  showRailTab,
  until,
} from "../overleaf-stack";
import { scriptValue } from "../script-value";

const STACK = process.env.OLEAFLY_E2E_OVERLEAF_STACK ?? "";
const MAIN = "main.tex";
const PANE = '[data-testid="comments-pane"]';
const DRAFT = `${PANE} section[aria-label="New comment"]`;
const CARD = "[data-suggestion-card]";
const QUOTE = "article";
const ASKED = "Is article the right class for this venue?";
const REMOVED = "REMOVED-BY-BOB";
const TRACKED = "TRACKED-FOR-EVERYONE";
const COMMENT_KEYS = process.platform === "darwin" ? { metaKey: true } : { ctrlKey: true };
const FORMATS = [
  { name: "ShareJS", args: ["--name", "E2E Review ShareJS"] },
  { name: "history-ot", args: ["--name", "E2E Review History", "--history-ot"] },
] as const;

type Thread = { messages: { id: string; content: string; user_id?: string }[]; resolved?: boolean };
type Threads = Record<string, Thread>;
type Span = { pos: number; length: number };
type Ranges = {
  format: string;
  ranges?: {
    changes?: { op: { i?: string; d?: string }; metadata?: { user_id?: string } }[];
    comments?: { op: { c?: string; t?: string } }[];
  };
  raw?: {
    content?: string;
    trackedChanges?: { range: Span; tracking: { type: string; userId: string } }[];
    comments?: { id: string; resolved?: boolean; ranges?: Span[] }[];
  };
};

test.skip(
  !process.env.CI && !STACK,
  "Needs OLEAFLY_E2E_OVERLEAF_STACK, the mock Overleaf server built with `cargo build -p oleafly-online --features test-support --example e2e_overleaf`.",
);

function changedBy(ranges: Ranges, kind: "insert" | "delete", user: string, text: string): boolean {
  if (ranges.format === "history-ot") {
    const content = ranges.raw?.content ?? "";
    return (ranges.raw?.trackedChanges ?? [])
      .filter((change) => change.tracking.type === kind && change.tracking.userId === user)
      .map(({ range }) => content.slice(range.pos, range.pos + range.length))
      .join("")
      .includes(text);
  }
  return (ranges.ranges?.changes ?? [])
    .filter((change) => change.metadata?.user_id === user)
    .map((change) => (kind === "insert" ? change.op.i : change.op.d) ?? "")
    .join("")
    .includes(text);
}

function anchoredQuote(ranges: Ranges, thread: string): string | null {
  if (ranges.format === "history-ot") {
    const content = ranges.raw?.content ?? "";
    const comment = (ranges.raw?.comments ?? []).find((entry) => entry.id === thread);
    return comment ? (comment.ranges ?? []).map(({ pos, length }) => content.slice(pos, pos + length)).join("") : null;
  }
  return (ranges.ranges?.comments ?? []).find((entry) => entry.op.t === thread)?.op.c ?? null;
}

function overleafHueOf(userId: string): number {
  const hue = Number.parseInt(createHash("md5").update(userId).digest("hex").slice(0, 8), 16) % 320;
  return hue > 180 && hue < 220 ? hue + 140 : hue;
}

function pendingChanges(ranges: Ranges): number {
  return ranges.format === "history-ot" ? (ranges.raw?.trackedChanges ?? []).length : (ranges.ranges?.changes ?? []).length;
}

async function threadsOf(stack: OverleafStack): Promise<Threads> {
  return (await stack.request({ cmd: "threads" })).threads as Threads;
}

async function rangesOf(stack: OverleafStack): Promise<Ranges> {
  return (await stack.request({ cmd: "ranges", path: MAIN })) as unknown as Ranges;
}

async function resolvedOnOverleaf(stack: OverleafStack, thread: string): Promise<boolean> {
  const ranges = await rangesOf(stack);
  if (ranges.format === "history-ot") {
    return (ranges.raw?.comments ?? []).some((comment) => comment.id === thread && comment.resolved === true);
  }
  return (await threadsOf(stack))[thread]?.resolved === true;
}

async function threadStartedWith(stack: OverleafStack, body: string): Promise<[string, Thread]> {
  let found: [string, Thread] | undefined;
  await until(
    `a thread on Overleaf that starts with ${JSON.stringify(body)}`,
    () => threadsOf(stack),
    (threads) => {
      found = Object.entries(threads).find(([, thread]) => thread.messages[0]?.content === body);
      return found !== undefined;
    },
    30_000,
  );
  if (!found) throw new Error(`no thread starts with ${JSON.stringify(body)}`);
  return found;
}

async function editModeIs(page: Page, mode: "editing" | "suggesting", locked: string | null) {
  await waitLong(
    page,
    `Promise.all([import("/src/lib/tauri-collab.ts"), import("/src/store/files.ts")]).then(([collab, files]) =>
      collab.collabEditModeGet(files.useFilesStore.getState().projectId ?? "").then(
        (state) => state.mode === ${scriptValue(mode)} && (state.locked ?? null) === ${scriptValue(locked)},
        () => false,
      ),
    )`,
    30_000,
  );
}

async function showAllComments(page: Page) {
  await clickButton(page, PANE, "Comments shown: Open", 20_000, { press: "enter" });
  await waitLong(
    page,
    `(() => {
      const item = [...document.querySelectorAll('[role="menuitemcheckbox"]')].find((entry) =>
        [...entry.querySelectorAll("span")].some((span) => span.textContent?.trim() === "All"),
      );
      item?.click();
      return !!item;
    })()`,
    20_000,
  );
  await waitLong(page, `!!document.querySelector(${scriptValue(`${PANE} button[aria-label="Comments shown: All"]`)})`, 20_000);
}

const REVIEWER_LOCK = 'output[aria-label^="You\'re a reviewer"]';
const EVERYONE_LOCK = 'output[aria-label^="Track changes is on for everyone"]';

for (const format of FORMATS) {
  test.describe(`Overleaf review on a ${format.name} project`, () => {
    test.describe.configure({ mode: "serial", retries: 0 });
    let stack: OverleafStack;
    let projectId = "";
    let appThread = "";

    test.beforeAll(async () => {
      if (!STACK) throw new Error("CI must set OLEAFLY_E2E_OVERLEAF_STACK");
      stack = new OverleafStack(STACK, [...format.args]);
      await stack.ready;
    });

    test.afterAll(() => {
      stack?.stop();
    });

    test(`a coauthor's comment shows in the app, which replies and resolves it (${format.name})`, async ({
      tauriPage: page,
    }) => {
      test.setTimeout(240_000);
      projectId = await importOverleafProjectLive(page, await stack.ready, MAIN);
      const posted = await stack.request({ cmd: "peer_comment", path: MAIN, quote: "Hello", body: "Say a little more here?" });
      const thread = `[data-comment-thread="${String(posted.thread)}"]`;
      await showRailTab(page, "comments");
      await waitForText(page, thread, ["Say a little more here?", "Bob Tester"], 30_000);

      await clickButton(page, thread, "Reply", 20_000, { containing: "Say a little more here?" });
      await fillTextarea(page, `${thread} textarea[aria-label="Reply"]`, "Added a sentence about it.");
      await clickButton(page, thread, "Send", 20_000, { containing: "Say a little more here?" });
      await until(
        "the app's reply",
        () => threadsOf(stack),
        (threads) =>
          threads[String(posted.thread)]?.messages.some((message) => message.content === "Added a sentence about it.") ===
          true,
        30_000,
      );

      await clickButton(page, thread, "Resolve");
      await until("the thread resolved", () => resolvedOnOverleaf(stack, String(posted.thread)), (resolved) => resolved, 30_000);

      const { users } = await stack.ready;
      await stack.request({ cmd: "peer_cursor", path: MAIN, row: 2, column: 2 });
      await waitLong(page, `!!document.querySelector(".cm-remote-caret")`, 30_000);
      const hue = await page.evaluate<string>(
        `document.querySelector(".cm-remote-caret")?.style.getPropertyValue("--remote-hue") ?? ""`,
      );
      expect(Number(hue), "a coauthor's caret takes Overleaf's own hue").toBe(overleafHueOf(users.bob));
    });

    test(`a coauthor's suggestions are accepted and rejected from the app (${format.name})`, async ({ tauriPage: page }) => {
      test.setTimeout(180_000);
      await reopenOverleafProjectLive(page, projectId, MAIN);
      await stack.request({ cmd: "peer_track_insert", path: MAIN, at: await stack.offsetAfter(MAIN, "Hello"), text: " KEPT-BY-OWNER", as: "carol" });
      await stack.request({
        cmd: "peer_track_insert",
        path: MAIN,
        at: await stack.offsetAfter(MAIN, "\\begin{document}"),
        text: "\nDROPPED-BY-OWNER",
        as: "carol",
      });
      await showRailTab(page, "comments");
      await waitForText(page, CARD, ["KEPT-BY-OWNER"], 30_000);
      await waitForText(page, CARD, ["DROPPED-BY-OWNER"], 30_000);
      await clickButton(page, CARD, "Accept", 20_000, { containing: "KEPT-BY-OWNER" });
      await clickButton(page, CARD, "Reject", 20_000, { containing: "DROPPED-BY-OWNER" });
      await until("no tracked change left", () => rangesOf(stack), (ranges) => pendingChanges(ranges) === 0, 30_000);
      const settled = await stack.text(MAIN);
      expect(settled, "the accepted text stays on Overleaf").toContain("KEPT-BY-OWNER");
      expect(settled, "the rejected text is gone from Overleaf").not.toContain("DROPPED-BY-OWNER");
      await until(
        "the accepted text kept and the rejected text gone on disk",
        () => readProjectText(page, MAIN),
        (text) => text.includes("KEPT-BY-OWNER") && !text.includes("DROPPED-BY-OWNER"),
        30_000,
      );
      await waitLong(page, noneShows(CARD, ["KEPT-BY-OWNER", "DROPPED-BY-OWNER"]), 30_000);
    });

    test(`a comment made in the app reaches Overleaf on the selected text (${format.name})`, async ({ tauriPage: page }) => {
      test.setTimeout(180_000);
      await reopenOverleafProjectLive(page, projectId, MAIN);
      const { users } = await stack.ready;
      await selectEditorText(page, QUOTE);
      await pressKey(page, { key: "m", code: "KeyM", altKey: true, ...COMMENT_KEYS });
      await fillTextarea(page, `${DRAFT} textarea[aria-label="New comment"]`, ASKED);
      await clickButton(page, DRAFT, "Send");
      const [id, created] = await threadStartedWith(stack, ASKED);
      expect(created.messages[0].user_id, "the comment is the signed-in user's").toBe(users.alice);
      await until("the comment on the selected text", () => rangesOf(stack), (ranges) => anchoredQuote(ranges, id) === QUOTE, 30_000);
      await waitForText(page, `[data-comment-thread="${id}"]`, [ASKED, "Alice Tester"], 30_000);
      appThread = id;
    });

    test(`a coauthor's reply, edit, delete, resolve, reopen and thread delete reach the app (${format.name})`, async ({
      tauriPage: page,
    }) => {
      test.setTimeout(240_000);
      expect(appThread, "the previous test made a comment in the app").not.toBe("");
      await reopenOverleafProjectLive(page, projectId, MAIN);
      await showRailTab(page, "comments");
      const thread = `[data-comment-thread="${appThread}"]`;
      await waitForText(page, thread, [ASKED], 30_000);

      const reply = await stack.request({ cmd: "peer_reply", thread: appThread, body: "It suits the venue." });
      const replyId = String((reply.body as { id: string }).id);
      await waitForText(page, thread, ["It suits the venue.", "Bob Tester"], 30_000);
      await stack.request({ cmd: "peer_edit_message", thread: appThread, message: replyId, body: "It suits the venue, keep it." });
      await waitForText(page, thread, ["It suits the venue, keep it.", "edited"], 30_000);
      await stack.request({ cmd: "peer_delete_message", thread: appThread, message: replyId });
      await waitLong(page, noneShows(thread, ["It suits the venue"]), 30_000);
      await waitForText(page, thread, [ASKED], 10_000);

      await showAllComments(page);
      await stack.request({ cmd: "peer_resolve", path: MAIN, thread: appThread });
      await waitForText(page, thread, ["Resolved by Bob Tester"], 30_000);
      await stack.request({ cmd: "peer_reopen", path: MAIN, thread: appThread });
      await waitLong(
        page,
        `(() => {
          const card = document.querySelector(${scriptValue(thread)});
          return !!card && !(card.textContent ?? "").includes("Resolved by") && !!card.querySelector('[aria-label="Resolve"]');
        })()`,
        30_000,
      );
      await stack.request({ cmd: "peer_delete_thread", path: MAIN, thread: appThread });
      await waitLong(page, `!document.querySelector(${scriptValue(thread)})`, 30_000);
      expect(Object.keys(await threadsOf(stack))).not.toContain(appThread);
      expect(anchoredQuote(await rangesOf(stack), appThread)).toBeNull();
    });

    test(`a coauthor's tracked delete shows as a suggestion until it is accepted (${format.name})`, async ({
      tauriPage: page,
    }) => {
      test.setTimeout(180_000);
      await reopenOverleafProjectLive(page, projectId, MAIN);
      const { users } = await stack.ready;
      await stack.request({ cmd: "peer_type", path: MAIN, at: await stack.offsetAfter(MAIN, "\\begin{document}\n"), text: `${REMOVED}\n` });
      await waitEditorContains(page, REMOVED, 30_000);
      await stack.request({
        cmd: "peer_track_delete",
        path: MAIN,
        at: await stack.offsetAfter(MAIN, "\\begin{document}\n"),
        length: REMOVED.length,
      });
      await until("the coauthor's tracked delete", () => rangesOf(stack), (ranges) => changedBy(ranges, "delete", users.bob, REMOVED), 30_000);
      await showRailTab(page, "comments");
      await waitForText(page, CARD, [REMOVED, "Bob Tester"], 30_000);
      if (format.name === "ShareJS") {
        await stack.request({ cmd: "peer_accept", path: MAIN });
      } else {
        await clickButton(page, CARD, "Accept", 20_000, { containing: REMOVED });
      }
      await until(
        "the deletion accepted on Overleaf",
        () => rangesOf(stack),
        (ranges) => pendingChanges(ranges) === 0 && !(ranges.raw?.content ?? "").includes(REMOVED),
        30_000,
      );
      expect(await stack.text(MAIN)).not.toContain(REMOVED);
      await waitLong(page, noneShows(CARD, [REMOVED]), 30_000);
      await until("the deletion on disk", () => readProjectText(page, MAIN), (text) => !text.includes(REMOVED), 30_000);
    });

    test(`track changes turned on for everyone makes the app's typing a suggestion (${format.name})`, async ({
      tauriPage: page,
    }) => {
      test.setTimeout(180_000);
      await reopenOverleafProjectLive(page, projectId, MAIN);
      const { users } = await stack.ready;
      await stack.request({ cmd: "track_changes", value: true });
      await editModeIs(page, "suggesting", "everyone");
      await waitLong(page, `!!document.querySelector(${scriptValue(EVERYONE_LOCK)})`, 30_000);
      await typeInEditorAfter(page, "Hello", ` ${TRACKED}`);
      await until("the app's typing as a tracked insert", () => rangesOf(stack), (ranges) => changedBy(ranges, "insert", users.alice, TRACKED), 30_000);

      await stack.request({ cmd: "track_changes", value: false });
      await editModeIs(page, "editing", null);
      await waitLong(page, `!document.querySelector(${scriptValue(EVERYONE_LOCK)})`, 30_000);
      await showRailTab(page, "comments");
      await clickButton(page, CARD, "Accept", 20_000, { containing: TRACKED });
      await until("no tracked change left", () => rangesOf(stack), (ranges) => pendingChanges(ranges) === 0, 30_000);
      expect(await stack.text(MAIN)).toContain(TRACKED);
    });

    test(`a reviewer's typing reaches Overleaf as their suggestion (${format.name})`, async ({ tauriPage: page }) => {
      test.setTimeout(180_000);
      await reopenOverleafProjectLive(page, projectId, MAIN);
      const { users } = await stack.ready;
      await stack.request({ cmd: "privilege", name: "alice", role: "review" });
      await editModeIs(page, "suggesting", "reviewer");
      await waitLong(page, `!!document.querySelector(${scriptValue(REVIEWER_LOCK)})`, 30_000);
      await typeInEditorAfter(page, "Hello", " SUGGESTED-BY-REVIEWER");
      await stack.textShows(MAIN, "SUGGESTED-BY-REVIEWER", 30_000);
      await until(
        "the reviewer's text as a tracked insert",
        () => rangesOf(stack),
        (ranges) => changedBy(ranges, "insert", users.alice, "SUGGESTED-BY-REVIEWER"),
        30_000,
      );
      await showRailTab(page, "comments");
      await waitForText(page, CARD, ["SUGGESTED-BY-REVIEWER"], 30_000);
      const accept = await page.evaluate<number>(
        `[...document.querySelectorAll(${scriptValue(CARD)})].filter((card) => card.textContent?.includes("SUGGESTED-BY-REVIEWER")).flatMap((card) => [...card.querySelectorAll("button")]).filter((button) => button.textContent?.trim() === "Accept").length`,
      );
      expect(accept).toBe(0);
      await stack.request({ cmd: "privilege", name: "alice", role: "edit" });
      await leaveOverleafLive(page);
    });
  });
}
