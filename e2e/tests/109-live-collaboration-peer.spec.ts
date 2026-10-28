import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { test, expect } from "../fixtures";
import {
  chooseAppSelectOption,
  createBlankProject,
  createProjectFromTemplate,
  editorSource,
  openSettings,
  readProjectText,
  replaceEditorSource,
  setTypstFormField,
  waitEditorContains,
  waitLong,
  writeProjectText,
  type Page,
} from "../helpers";
import { scriptValue } from "../script-value";

const STACK = process.env.OLEAFLY_E2E_COLLAB_STACK ?? "";
const PROTOCOL = "e2e-peer ";
const SHARE_DIALOG = '[data-testid="collab-share-dialog"]';
const PANE = '[data-testid="collab-pane"]';
const PANE_STATUS = `${PANE} header button[aria-haspopup="dialog"]`;
const LINK_ROLE = `${SHARE_DIALOG} [aria-label="Role for people who open the link"]`;
const APP_LIVE = "APP-LIVE-1";
const PEER_LIVE = "PEER-LIVE-café";
const APP_AWAY = "APP-WHILE-PEER-AWAY";
const PEER_AWAY = "PEER-OFFLINE-1";
const PEER_REMOVED = "PEER-AFTER-REMOVAL";

test.skip(
  !STACK,
  "Needs OLEAFLY_E2E_COLLAB_STACK, the headless collaboration peer built with `cargo build -p oleafly-collab --example e2e_peer`, and OLEAFLY_E2E_BROWSER=scripts/e2e-collab-browser.sh for the app.",
);

type Ready = { server: string; setupCode: string; owner: string; peer: string };
type Reply = Record<string, unknown> & { id: number | null; ok: boolean; error?: string };

class CollabStack {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, { resolve: (reply: Reply) => void; reject: (error: Error) => void }>();
  private next = 1;
  private exited: string | null = null;
  readonly ready: Promise<Ready>;

  constructor(binary: string, log: string) {
    mkdirSync(dirname(log), { recursive: true });
    this.child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    let started: (ready: Ready) => void = () => undefined;
    let failed: (error: Error) => void = () => undefined;
    this.ready = new Promise<Ready>((resolve, reject) => {
      started = resolve;
      failed = reject;
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      appendFileSync(log, `${line}\n`);
      if (!line.startsWith(PROTOCOL)) return;
      const message = JSON.parse(line.slice(PROTOCOL.length)) as Reply & { event?: string };
      if (message.event === "ready") {
        started(message as unknown as Ready);
        return;
      }
      if (typeof message.id !== "number") return;
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.ok) waiting.resolve(message);
      else waiting.reject(new Error(`the peer refused: ${message.error ?? "no reason"}`));
    });
    createInterface({ input: this.child.stderr }).on("line", (line) => appendFileSync(log, `${line}\n`));
    this.child.on("exit", (code, signal) => {
      this.exited = `the headless peer exited (${code ?? signal}); its log is ${log}`;
      failed(new Error(this.exited));
      for (const waiting of this.pending.values()) waiting.reject(new Error(this.exited));
      this.pending.clear();
    });
  }

  request(command: Record<string, unknown>, timeoutMs = 90_000): Promise<Reply> {
    if (this.exited) return Promise.reject(new Error(this.exited));
    const id = this.next++;
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the peer never answered ${JSON.stringify(command)}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
    });
  }

  async stop() {
    if (this.exited) return;
    await this.request({ cmd: "quit" }, 15_000).catch(() => undefined);
    if (!this.exited) this.child.kill("SIGKILL");
  }
}

function projectIdExpression(): string {
  return `document.querySelector('[data-e2e-project-id]')?.dataset.e2eProjectId`;
}

async function bridge<T>(page: Page, call: string): Promise<T> {
  return page.evaluate<T>(
    `import("/src/lib/tauri-collab.ts").then((tauri) => { const projectId = ${projectIdExpression()}; return ${call}; })`,
  );
}

async function clickButton(page: Page, scope: string, text: string, timeoutMs = 20_000) {
  await waitLong(
    page,
    `(() => {
      const scopes = [...document.querySelectorAll(${scriptValue(scope)})];
      const button = scopes.flatMap((node) => [...node.querySelectorAll("button")])
        .reverse()
        .find((entry) => entry.textContent.trim() === ${scriptValue(text)} && !entry.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()`,
    timeoutMs,
  );
}

async function typeInAppAfter(page: Page, anchor: string, text: string, delayMs: number) {
  const typed = await page.evaluate<boolean>(
    `import("/src/components/editor/cm/controller.ts").then(async ({ getEditorView }) => {
      const view = getEditorView();
      if (!view) return false;
      const start = view.state.doc.toString().indexOf(${scriptValue(anchor)});
      if (start < 0) return false;
      view.focus();
      view.dispatch({ selection: { anchor: start + ${scriptValue(anchor)}.length } });
      for (const character of ${scriptValue(text)}) {
        const at = view.state.selection.main.head;
        view.dispatch({
          changes: { from: at, insert: character },
          selection: { anchor: at + character.length },
          userEvent: "input.type",
        });
        await new Promise((resolve) => setTimeout(resolve, ${delayMs}));
      }
      return true;
    })`,
  );
  if (!typed) throw new Error(`the app editor has no ${JSON.stringify(anchor)} to type after`);
}

async function waitForText(page: Page, selector: string, needles: string[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = await page.evaluate<string>(`document.querySelector(${scriptValue(selector)})?.innerText ?? ""`);
    if (needles.every((needle) => text.includes(needle))) return;
    if (Date.now() > deadline) {
      throw new Error(`${selector} never showed ${JSON.stringify(needles)}; it shows ${JSON.stringify(text.slice(0, 800))}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function paneStatus(page: Page): Promise<string> {
  return page.evaluate<string>(`document.querySelector(${scriptValue(PANE_STATUS)})?.getAttribute("aria-label") ?? ""`);
}

async function openCollabPane(page: Page) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const state = await page.evaluate<string>(`(() => {
      const tab = document.querySelector('[data-tour="rail-collab"]');
      if (!tab) {
        const show = document.querySelector('[aria-label^="Show sidebar"]');
        if (show) { show.click(); return "revealing"; }
        return "missing";
      }
      if (tab.getAttribute("aria-current") === "page" && document.querySelector(${scriptValue(PANE)})) return "open";
      if (tab.getAttribute("aria-current") !== "page") tab.click();
      return "opening";
    })()`);
    if (state === "open") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("the Live collaboration pane never opened");
}

async function waitAppUpToDate(page: Page, timeoutMs = 30_000) {
  await openCollabPane(page);
  await waitLong(page, `document.querySelector(${scriptValue(PANE_STATUS)})?.getAttribute("aria-label") === "Up to date"`, timeoutMs);
}

// Leaves only this run's server, adds it, and signs the owner in.
async function signInToServer(page: Page, ready: Ready) {
  await page.evaluate(
    `import("/src/lib/tauri-collab.ts").then(async ({ collabServersList, collabServerRemove }) => {
      for (const server of await collabServersList()) {
        if (server.url !== ${scriptValue(ready.server)}) await collabServerRemove(server.server_id);
      }
      return true;
    })`,
  );
  await openSettings(page, "collaboration");
  await clickButton(page, '[data-testid="collaboration-section"]', "Add server");
  const address = '[role="dialog"] input[autocomplete="url"]';
  await page.waitForFunction(`!!document.querySelector(${scriptValue(address)})`, 20_000);
  await page.fill(address, ready.server);
  await page.click('[role="dialog"] form button[type="submit"]');
  const setup = '[role="dialog"] input[autocomplete="one-time-code"]';
  await page.waitForFunction(`!!document.querySelector(${scriptValue(setup)})`, 20_000);
  await page.fill(setup, ready.setupCode);
  await clickButton(page, '[role="dialog"]', "Continue with GitHub");
  await waitLong(
    page,
    `import("/src/lib/tauri-collab.ts").then(({ collabServersList }) => collabServersList()).then((servers) =>
      servers.some((server) => server.signed_in && server.account?.display_name === ${scriptValue(ready.owner)}))`,
    60_000,
  );
  await clickButton(page, '[role="dialog"]', "Done");
  await page.press("body", "Escape");
  await page.waitForFunction(`!document.querySelector('[data-testid="settings-section-appearance"]')`, 20_000);
}

// Shares the open project, turns on link sharing for editors, and returns the link.
async function shareWithEditors(page: Page): Promise<string> {
  await page.click('[data-toolbar-item="share"] button');
  await page.waitForFunction(`!!document.querySelector(${scriptValue(SHARE_DIALOG)})`, 20_000);
  await clickButton(page, SHARE_DIALOG, "Share", 60_000);
  await waitLong(page, `import("/src/lib/tauri-collab.ts").then((tauri) => tauri.collabShareInfo(${projectIdExpression()})).then((share) => !!share)`, 60_000);
  await waitLong(
    page,
    `(() => {
      const toggle = document.querySelector(${scriptValue(`${SHARE_DIALOG} [role="switch"]`)});
      if (!toggle) return false;
      if (toggle.getAttribute("aria-checked") !== "true") toggle.click();
      return !!document.querySelector(${scriptValue(LINK_ROLE)});
    })()`,
    30_000,
  );
  await chooseAppSelectOption(page, LINK_ROLE, { attribute: "data-label", value: "Editor" });
  await waitLong(
    page,
    `import("/src/lib/tauri-collab.ts").then((tauri) => tauri.collabProjectSummary(${projectIdExpression()})).then((summary) => summary.link_sharing && summary.link_role === "editor")`,
    30_000,
  );
  const link = await bridge<string>(page, `tauri.collabShareInfo(projectId).then((share) => share?.link ?? "")`);
  expect(link).toContain("/p/");
  await page.click(`${SHARE_DIALOG} button[aria-label="Close"]`);
  return link;
}

async function expectConverged(page: Page, stack: CollabStack, contains: string[], path = "main.tex") {
  const deadline = Date.now() + 60_000;
  let last = "";
  for (;;) {
    const peer = (await stack.request({ cmd: "settle" })).text as string;
    const editor = await editorSource(page);
    const disk = await readProjectText(page, path);
    const missing = contains.filter((needle) => !editor.includes(needle));
    if (editor === peer && disk === editor && missing.length === 0) return editor;
    last = JSON.stringify({ missing, editor, peer, disk });
    if (Date.now() > deadline) throw new Error(`the app and the peer never converged: ${last}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

test("one app and a headless peer share, edit together, merge after time away, and removal stops the peer", async ({ tauriPage: page }, testInfo) => {
  test.setTimeout(600_000);
  const stack = new CollabStack(STACK, testInfo.outputPath("collab-stack.log"));
  const project = `Live Paper r${testInfo.retry}-${testInfo.repeatEachIndex}`;
  try {
    const ready = await stack.ready;

    await test.step("the owner creates a project and signs in to the server", async () => {
      await createBlankProject(page, project);
      await signInToServer(page, ready);
    });

    let link = "";
    let reviewText = "";
    await test.step("the owner shares the project and turns on link sharing for editors", async () => {
      link = await shareWithEditors(page);
    });

    await test.step("the headless peer pastes the link and joins as an editor", async () => {
      const joined = await stack.request({ cmd: "join", link });
      expect(joined.role).toBe("editor");
      expect(joined.file).toBe("main.tex");
      expect(joined.title).toBe(project);
      await waitLong(page, `!!document.querySelector('[data-toolbar-item="collab"]')`, 30_000);
    });

    await test.step("edits typed at the same time on both sides converge in both editors and on disk", async () => {
      const peerTyping = stack.request({ cmd: "type", text: PEER_LIVE, after: "\\section{Introduction}\n", delay_ms: 40 });
      await typeInAppAfter(page, "\\maketitle", `\n${APP_LIVE}`, 40);
      await peerTyping;
      await waitEditorContains(page, PEER_LIVE, 30_000);
      await stack.request({ cmd: "wait_text", contains: [APP_LIVE, PEER_LIVE] });
      await expectConverged(page, stack, [APP_LIVE, PEER_LIVE]);
    });

    await test.step("the peer edits offline, comes back, and the app reviews the merged changes", async () => {
      await stack.request({ cmd: "offline", side: "peer" });
      await stack.request({ cmd: "type", text: `${PEER_AWAY} `, after: "Write your ", delay_ms: 10 });
      await typeInAppAfter(page, "\\author{}", `\n${APP_AWAY}`, 10);
      await waitAppUpToDate(page);
      await stack.request({ cmd: "offline", side: "app" });
      await waitLong(page, `document.querySelector(${scriptValue(PANE_STATUS)})?.getAttribute("aria-label") !== "Up to date"`, 30_000);
      await stack.request({ cmd: "online", side: "peer" });
      const settled = await stack.request({ cmd: "settle" });
      expect(settled.text).toContain(PEER_AWAY);
      await stack.request({ cmd: "wait_text", contains: [APP_AWAY] });
      expect(await editorSource(page)).not.toContain(PEER_AWAY);
      await stack.request({ cmd: "online", side: "app" });
      await waitEditorContains(page, PEER_AWAY, 60_000);
      await expectConverged(page, stack, [APP_LIVE, PEER_LIVE, APP_AWAY, PEER_AWAY]);
      await openCollabPane(page);
      await clickButton(page, `${PANE} ul[aria-label="Activity"]`, "Review", 30_000);
      const review = '[data-testid="collab-merge-review"]';
      await waitForText(page, review, ["main.tex: "], 30_000);
      reviewText = await page.evaluate<string>(`document.querySelector(${scriptValue(review)})?.innerText ?? ""`);
      await page.click(`${review} button[aria-label="Close"]`);
    });

    await test.step("the owner removes the peer and the peer's later edits are refused", async () => {
      await page.click('[data-toolbar-item="share"] button');
      const remove = `${SHARE_DIALOG} button[aria-label=${JSON.stringify(`Remove ${ready.peer}`)}]`;
      await page.waitForFunction(`!!document.querySelector(${scriptValue(remove)})`, 30_000);
      await page.click(remove);
      await clickButton(page, '[role="alertdialog"]', "Remove");
      const ended = await stack.request({ cmd: "wait_ended" });
      expect(ended.reason).toBe("removed");
      await stack.request({ cmd: "type", text: PEER_REMOVED, after: "\\section{Introduction}\n", delay_ms: 0 });
      const retried = await stack.request({ cmd: "retry" });
      expect(retried.state).toBe("ended");
      expect(retried.reason).toBe("removed");
      expect(retried.unsent).toBe(true);
      expect(retried.text).toContain(PEER_REMOVED);
      expect(retried.headAfter).toBe(retried.headBefore);
      expect(retried.snapshot).toBe("refused 404");
      expect(await editorSource(page)).not.toContain(PEER_REMOVED);
      expect(await readProjectText(page, "main.tex")).not.toContain(PEER_REMOVED);
      const members = await bridge<Array<{ person: { display_name: string } }>>(page, `tauri.collabMembersList(projectId)`);
      expect(members.map((member) => member.person.display_name)).toEqual([ready.owner]);
      await page.click(`${SHARE_DIALOG} button[aria-label="Close"]`);
    });

    expect(await paneStatus(page)).toBe("Up to date");
    expect(reviewText, "the merge review names the person whose changes it merged").toContain(`${ready.peer}: `);
  } finally {
    await stack.stop();
  }
});

const MEMO_FORMS = `[tool.oleafly]
schema = 1

[[tool.oleafly.forms]]
module = "template/memo.typ"
function = "memo-header"
label = "Memo header"
fields = [
  { arg = "to", kind = "text", label = "To" },
  { arg = "subject", kind = "text", label = "Subject" },
]
`;
const MEMO_TEMPLATE = "#let memo-header(to: none, subject: none) = [To: #to. Subject: #subject.]\n";
const MEMO_REPORT = '#import "template/memo.typ": memo-header\n\nIntro.\n\n#memo-header(to: "Team", subject: "Plan")\n';

async function focusedFormValue(page: Page): Promise<{ inForm: boolean; value: string }> {
  return page.evaluate<{ inForm: boolean; value: string }>(`(() => {
    const element = document.activeElement;
    return { inForm: !!element?.closest(".ofl-visual-form-card"), value: element instanceof HTMLInputElement ? element.value : "" };
  })()`);
}

test("a form field edit reaches the peer, and the peer's edit leaves a draft in a focused field alone", async ({ tauriPage: page }, testInfo) => {
  test.setTimeout(600_000);
  const stack = new CollabStack(STACK, testInfo.outputPath("collab-stack-forms.log"));
  try {
    const ready = await stack.ready;

    await test.step("the owner shares a Typst project whose memo template declares a form", async () => {
      await createProjectFromTemplate(page, "blank-typst", `Live Forms r${testInfo.retry}-${testInfo.repeatEachIndex}`);
      await writeProjectText(page, "oleafly-forms.toml", MEMO_FORMS);
      await writeProjectText(page, "template/memo.typ", MEMO_TEMPLATE);
      await replaceEditorSource(page, MEMO_REPORT);
      await signInToServer(page, ready);
      const link = await shareWithEditors(page);
      const joined = await stack.request({ cmd: "join", link });
      expect(joined.file).toBe("main.typ");
      await page.click('[aria-label="Switch to WYSIWYG view"]');
      await waitLong(page, `!!document.querySelector(".cm-content .ofl-visual-form-card")`, 30_000);
    });

    await test.step("a field edited in the app shows up in the peer's document", async () => {
      await setTypstFormField(page, "Memo header", "To", "Board", "enter");
      await stack.request({ cmd: "wait_text", contains: ['to: "Board"'] });
      await expectConverged(page, stack, ['to: "Board"'], "main.typ");
    });

    await test.step("the peer types while the app has a draft in a focused field", async () => {
      await setTypstFormField(page, "Memo header", "Subject", "Draft subject", "none");
      await stack.request({ cmd: "type", text: "Peer note. ", after: "Intro.", delay_ms: 20 });
      await waitEditorContains(page, "Peer note.", 30_000);
      expect(await focusedFormValue(page)).toEqual({ inForm: true, value: "Draft subject" });
      await page.evaluate(
        `document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))`,
      );
      await stack.request({ cmd: "wait_text", contains: ['subject: "Draft subject"', "Peer note."] });
      await expectConverged(page, stack, ['to: "Board"', 'subject: "Draft subject"', "Peer note."], "main.typ");
    });
  } finally {
    await stack.stop();
  }
});
