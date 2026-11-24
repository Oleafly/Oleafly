import { test, expect } from "../fixtures";
import { clickButton, fillTextarea, waitForText, waitLong } from "../helpers";
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
const PANE = '[data-testid="chat-pane"]';
const ENTRY = `${PANE} [data-comment-entry]`;
const LINK = "https://www.overleaf.com/learn";
const FORMATS = [
  { name: "ShareJS", args: ["--name", "E2E Chat ShareJS"] },
  { name: "history-ot", args: ["--name", "E2E Chat History", "--history-ot"] },
] as const;

type ChatMessage = { id: string; content: string; edited_at?: unknown };

// Ignored on purpose outside CI without OLEAFLY_E2E_OVERLEAF_STACK, because the spec drives the mock server it names.
test.skip(
  !process.env.CI && !STACK,
  "Needs OLEAFLY_E2E_OVERLEAF_STACK, the mock Overleaf server built with `cargo build -p oleafly-online --features test-support --example e2e_overleaf`.",
);

async function messagesOf(stack: OverleafStack): Promise<ChatMessage[]> {
  return (await stack.request({ cmd: "chat" })).messages as ChatMessage[];
}

function count(selector: string): string {
  return `document.querySelectorAll(${scriptValue(selector)}).length`;
}

for (const format of FORMATS) {
  test.describe(`Overleaf chat on a ${format.name} project`, () => {
    test.describe.configure({ mode: "serial", retries: 0 });
    let stack: OverleafStack;
    let projectId = "";

    test.beforeAll(async () => {
      if (!STACK) throw new Error("CI must set OLEAFLY_E2E_OVERLEAF_STACK");
      stack = new OverleafStack(STACK, [...format.args]);
      await stack.ready;
    });

    test.afterAll(() => {
      stack?.stop();
    });

    test(`a coauthor's message draws its math and link, offers no reactions, and its edit and delete reach the app (${format.name})`, async ({
      tauriPage: page,
    }) => {
      test.setTimeout(240_000);
      projectId = await importOverleafProjectLive(page, await stack.ready, MAIN);
      const posted = await stack.request({ cmd: "peer_chat", body: `The bound is $\\mathcal{O}(n \\log n)$, notes at ${LINK}` });
      const id = String((posted.message as ChatMessage).id);
      await showRailTab(page, "chat");
      await waitForText(page, ENTRY, ["notes at"], 30_000);
      await waitForText(page, ENTRY, ["Bob Tester"], 10_000);
      await waitLong(page, `${count(`${ENTRY} [data-comment-math="inline"] .katex`)} === 1`, 10_000);
      const link = await page.evaluate<{ href: string | null; target: string | null } | null>(`(() => {
        const anchor = [...document.querySelectorAll(${scriptValue(`${ENTRY} a`)})].find((node) => node.textContent === ${scriptValue(LINK)});
        return anchor ? { href: anchor.getAttribute("href"), target: anchor.getAttribute("target") } : null;
      })()`);
      expect(link).toEqual({ href: LINK, target: "_blank" });
      expect(await page.evaluate<number>(count(`${PANE} [aria-label="Add reaction"]`))).toBe(0);
      expect(await page.evaluate<number>(count(`${PANE} [aria-label="Clear chat"]`))).toBe(0);

      await stack.request({ cmd: "peer_chat_edit", message: id, body: "The bound is tight, notes to follow" });
      await waitForText(page, ENTRY, ["The bound is tight, notes to follow", "edited"], 30_000);
      await waitLong(page, noneShows(ENTRY, ["notes at"]), 30_000);
      await stack.request({ cmd: "peer_chat_delete", message: id });
      await waitLong(page, noneShows(ENTRY, ["The bound is tight"]), 30_000);
      expect((await messagesOf(stack)).some((message) => message.id === id)).toBe(false);
    });

    test(`sending, editing and deleting your own message reach Overleaf (${format.name})`, async ({ tauriPage: page }) => {
      test.setTimeout(180_000);
      await reopenOverleafProjectLive(page, projectId, MAIN);
      await showRailTab(page, "chat");
      await fillTextarea(page, `${PANE} textarea[aria-label="Message"]`, "Sent from Oleafly");
      await clickButton(page, PANE, "Send", 20_000, { containing: "Sent from Oleafly" });
      const [sent] = (
        await until(
          "the app's message",
          () => messagesOf(stack),
          (messages) => messages.some((message) => message.content === "Sent from Oleafly"),
          30_000,
        )
      ).filter((message) => message.content === "Sent from Oleafly");
      await waitForText(page, ENTRY, ["Sent from Oleafly"], 30_000);

      await clickButton(page, ENTRY, "More actions for this message", 20_000, { containing: "Sent from Oleafly", press: "enter" });
      await clickButton(page, '[role="menu"]', "Edit");
      await fillTextarea(page, `${PANE} textarea[aria-label="Edit message"]`, "Edited in Oleafly");
      await clickButton(page, PANE, "Save", 20_000, { containing: "Edited in Oleafly" });
      await until(
        "the edit",
        () => messagesOf(stack),
        (messages) => messages.some((message) => message.id === sent.id && message.content === "Edited in Oleafly"),
        30_000,
      );
      await waitForText(page, ENTRY, ["edited"], 30_000);

      await stack.request({ cmd: "peer_chat", body: "Thanks, looks right." });
      await waitForText(page, ENTRY, ["Thanks, looks right."], 30_000);
      const own = await page.evaluate<number>(`[...document.querySelectorAll(${scriptValue(ENTRY)})]
        .filter((entry) => entry.textContent?.includes("Thanks, looks right."))
        .flatMap((entry) => [...entry.querySelectorAll('[aria-label="More actions for this message"]')]).length`);
      expect(own, "someone else's message has no edit or delete for you").toBe(0);

      await clickButton(page, ENTRY, "More actions for this message", 20_000, { containing: "Edited in Oleafly", press: "enter" });
      await clickButton(page, '[role="menu"]', "Delete");
      await clickButton(page, '[role="alertdialog"]', "Delete");
      await until(
        "the message gone",
        () => messagesOf(stack),
        (messages) => !messages.some((message) => message.id === sent.id),
        30_000,
      );
      await waitLong(page, noneShows(ENTRY, ["Edited in Oleafly"]), 30_000);
      await leaveOverleafLive(page);
    });
  });
}
