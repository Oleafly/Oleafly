import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { expect } from "./fixtures";
import { chooseProjectKind, openNewProject, type Page, waitEditorShowsFile, waitLong } from "./helpers";
import { scriptValue } from "./script-value";

const PROTOCOL = "e2e-overleaf ";
const REPLY_MS = 60_000;

export type OverleafReady = { server: string; project: string; users: Record<string, string> };
type Reply = Record<string, unknown> & { id: number; ok: boolean; error?: string };

export async function until<T>(
  what: string,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`never saw ${what}; the last read was ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export function noneShows(selector: string, texts: string[]): string {
  return `![...document.querySelectorAll(${scriptValue(selector)})].some((node) => ${scriptValue(texts)}.some((text) => (node.textContent ?? "").includes(text)))`;
}

export class OverleafStack {
  private readonly child: ChildProcessWithoutNullStreams;
  readonly log: string[] = [];
  private readonly pending = new Map<number, (reply: Reply) => void>();
  private next = 1;
  readonly ready: Promise<OverleafReady>;

  constructor(binary: string, args: string[] = []) {
    this.child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    let started: (ready: OverleafReady) => void = () => undefined;
    this.ready = new Promise<OverleafReady>((resolve, reject) => {
      started = resolve;
      this.child.on("exit", (code) => {
        const error = `the mock Overleaf server exited with ${code}`;
        reject(new Error(error));
        for (const [id, answer] of this.pending) answer({ id, ok: false, error });
      });
    });
    createInterface({ input: this.child.stderr }).on("line", (line) => this.log.push(line));
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      if (!line.startsWith(PROTOCOL)) return;
      const message = JSON.parse(line.slice(PROTOCOL.length)) as Reply & { event?: string };
      if (message.event === "ready") started(message as unknown as OverleafReady);
      else this.pending.get(message.id)?.(message);
    });
  }

  async request(command: Record<string, unknown>): Promise<Reply> {
    if ("id" in command) throw new Error(`a mock command can't carry its own "id", the reply is matched by it: ${JSON.stringify(command)}`);
    const id = this.next++;
    let timer: NodeJS.Timeout | undefined;
    const reply = new Promise<Reply>((resolve) => {
      this.pending.set(id, resolve);
      timer = setTimeout(
        () => resolve({ id, ok: false, error: `no answer in ${REPLY_MS} ms. The mock's log ends ${JSON.stringify(this.log.slice(-10))}` }),
        REPLY_MS,
      );
    });
    this.child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
    const answer = await reply;
    clearTimeout(timer);
    this.pending.delete(id);
    if (!answer.ok) throw new Error(`the mock refused ${JSON.stringify(command)}: ${answer.error}`);
    return answer;
  }

  async text(path: string): Promise<string> {
    return (await this.request({ cmd: "text", path })).text as string;
  }

  async textShows(path: string, marker: string, timeoutMs: number): Promise<string> {
    return until(`${marker} in ${path} on the server`, () => this.text(path), (text) => text.includes(marker), timeoutMs);
  }

  async offsetAfter(path: string, needle: string): Promise<number> {
    const text = await this.text(path);
    const at = text.indexOf(needle);
    if (at < 0) throw new Error(`${path} on the server has no ${needle}`);
    return at + needle.length;
  }

  stop() {
    this.child.stdin.end(`${JSON.stringify({ cmd: "quit" })}\n`);
  }
}

export async function overleafLiveState(page: Page, states: string[], timeoutMs: number) {
  await waitLong(
    page,
    `${JSON.stringify(states)}.includes(document.querySelector('[data-testid="overleaf-live-button"]')?.dataset.syncState)`,
    timeoutMs,
  );
}

export async function importOverleafProjectLive(page: Page, { server, project }: OverleafReady, main: string): Promise<string> {
  await openNewProject(page);
  await chooseProjectKind(page, "import");
  await page.click('[data-testid="project-import-overleaf"]');
  await expect(page.locator('[data-testid="overleaf-change-server"]')).toBeVisible({ timeout: 20_000 });
  await page.click('[data-testid="overleaf-change-server"]');
  await page.fill('[data-testid="overleaf-server-input"]', server);
  await page.click('[data-testid="overleaf-save-server"]');
  await expect(page.locator('[data-testid="overleaf-sign-in-panel"]')).toBeVisible({ timeout: 20_000 });
  await page.click('[data-testid="overleaf-sign-in"]');
  await expect(page.locator(`[data-testid="overleaf-project-${project}"]`)).toBeVisible({ timeout: 60_000 });
  await page.click('[data-testid="overleaf-select-all"]');
  await page.click('[data-testid="overleaf-import-selected"]');
  await expect(page.locator(`[data-testid="overleaf-status-${project}"]`)).toContainText("Imported", { timeout: 60_000 });
  await page.evaluate(`import("/src/store/settings.ts").then((m) => m.useSettingsStore.getState().setOverleafLive(true))`);
  await page.click(`[data-testid="overleaf-status-${project}"] button`);
  await waitEditorShowsFile(page, main, 45_000);
  await overleafLiveState(page, ["upToDate"], 60_000);
  return page.evaluate<string>(`import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().projectId ?? "")`);
}

export async function reopenOverleafProjectLive(page: Page, projectId: string, path: string) {
  expect(projectId, "an earlier test imported the Overleaf project").not.toBe("");
  await page.evaluate(`import("/src/store/files.ts").then(({ useFilesStore }) => {
    if (useFilesStore.getState().projectId !== ${scriptValue(projectId)}) void useFilesStore.getState().openProject(${scriptValue(projectId)});
  })`);
  await waitLong(
    page,
    `import("/src/store/files.ts").then(({ useFilesStore }) => {
      const files = useFilesStore.getState();
      return files.projectId === ${scriptValue(projectId)} && !files.loading;
    })`,
    45_000,
  );
  await page.evaluate(`import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().openFile(${scriptValue(path)}))`);
  await waitEditorShowsFile(page, path, 45_000);
  await overleafLiveState(page, ["upToDate"], 60_000);
}

export async function leaveOverleafLive(page: Page) {
  await page.evaluate(`Promise.all([import("/src/store/settings.ts"), import("/src/store/overleaf-import.ts")]).then(([settings, overleaf]) => {
    settings.useSettingsStore.getState().setOverleafLive(false);
    overleaf.useOverleafImportStore.getState().setServer("");
  })`);
}

const RAIL_PANES = { comments: '[data-testid="comments-pane"]', chat: '[data-testid="chat-pane"]' } as const;

export async function showRailTab(page: Page, tab: keyof typeof RAIL_PANES) {
  await waitLong(
    page,
    `import("/src/store/settings.ts").then(({ useSettingsStore }) => {
      const settings = useSettingsStore.getState();
      if (settings.railTab === ${scriptValue(tab)} && settings.showTree && document.querySelector(${scriptValue(RAIL_PANES[tab])})) return true;
      settings.setRailTab(${scriptValue(tab)});
      if (!settings.showTree) settings.setShowTree(true);
      return false;
    })`,
    30_000,
  );
}
