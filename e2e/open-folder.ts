import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { expect } from "./fixtures";
import { waitLong, type Page } from "./helpers";
import { scriptValue } from "./script-value";

export interface EntrySnapshot {
  kind: "file" | "dir" | "link";
  size: string;
  mtime: string;
  mode: string;
  sha256: string;
}

export type FolderSnapshot = Record<string, EntrySnapshot>;

export interface OpenedState {
  projectId: string | null;
  projectName: string;
  mainDoc: string;
  engine: string;
  manifestHome: string;
  loading: boolean;
}

export interface FolderFixtures {
  readonly root: string;
  tag: string;
  make(name: string, files: Record<string, string>): string;
  remove(): void;
}

export function folderFixtures(prefix: string): FolderFixtures {
  let created: string | null = null;
  const ensureRoot = () => {
    created ??= realpathSync(mkdtempSync(join(realpathSync(tmpdir()), `oleafly-${prefix}-`)));
    return created;
  };
  return {
    get root() {
      return ensureRoot();
    },
    tag: Date.now().toString(36).slice(-5),
    make(name, files) {
      const folder = join(ensureRoot(), name);
      mkdirSync(folder, { recursive: true });
      for (const [path, content] of Object.entries(files)) {
        const target = join(folder, ...path.split("/"));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
      }
      return folder;
    },
    remove() {
      if (created === null) return;
      try {
        rmSync(created, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch (error) {
        console.warn(`could not remove the open-folder fixtures in ${created}: ${String(error)}`);
      }
    },
  };
}

export function snapshotFolder(folder: string): FolderSnapshot {
  const snapshot: FolderSnapshot = {};
  const visit = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const stat = lstatSync(path, { bigint: true });
      const kind = stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "dir" : "file";
      snapshot[relative(folder, path).split(sep).join("/")] = {
        kind,
        size: kind === "file" ? String(stat.size) : "",
        mtime: String(stat.mtimeNs),
        mode: stat.mode.toString(8),
        sha256: kind === "file" ? createHash("sha256").update(readFileSync(path)).digest("hex") : "",
      };
      if (kind === "dir") visit(path);
    }
  };
  const top = lstatSync(folder, { bigint: true });
  snapshot["."] = { kind: "dir", size: "", mtime: String(top.mtimeNs), mode: top.mode.toString(8), sha256: "" };
  visit(folder);
  return snapshot;
}

export function folderChanges(before: FolderSnapshot, after: FolderSnapshot): string[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: string[] = [];
  for (const path of [...paths].sort()) {
    const was = before[path];
    const now = after[path];
    if (!was) changes.push(`added ${path}`);
    else if (!now) changes.push(`removed ${path}`);
    else if (JSON.stringify(was) !== JSON.stringify(now)) {
      changes.push(`changed ${path} ${JSON.stringify(was)} -> ${JSON.stringify(now)}`);
    }
  }
  return changes;
}

export function expectFolderUnchanged(
  folder: string,
  before: FolderSnapshot,
  allowed: readonly string[] = [],
): void {
  const changes = folderChanges(before, snapshotFolder(folder)).filter(
    (change) => !allowed.some((path) => change.split(" ")[1] === path),
  );
  expect(changes, `unexpected writes inside ${folder}`).toEqual([]);
}

export function expectNoOleaflyFootprint(folder: string): void {
  const names = Object.keys(snapshotFolder(folder));
  const footprint = names.filter((path) =>
    path === ".oleafly" ||
    path.startsWith(".oleafly/") ||
    path === ".git" ||
    path === "project.json" ||
    /\.(aux|log|synctex\.gz|fls|fdb_latexmk|xdv|out|toc|bbl|blg)$/.test(path) ||
    (path.endsWith(".pdf") && !path.startsWith("figures/")),
  );
  expect(footprint, `Oleafly left files in ${folder}`).toEqual([]);
}

export function ageFolder(folder: string, seconds = 120): void {
  const past = new Date(Date.now() - seconds * 1000);
  const visit = (directory: string) => {
    for (const name of readdirSync(directory)) {
      if (directory === folder && name === ".git") continue;
      const path = join(directory, name);
      if (lstatSync(path).isDirectory()) visit(path);
      utimesSync(path, past, past);
    }
  };
  visit(folder);
  utimesSync(folder, past, past);
}

export function git(folder: string, ...args: string[]): string {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR"]) {
    delete env[key];
  }
  return execFileSync("git", ["-c", "user.name=Open Folder Test", "-c", "user.email=open-folder@example.invalid", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], {
    cwd: folder,
    env,
    encoding: "utf8",
  });
}

export async function injectOpenRequest(page: Page, path: string): Promise<{ token: string; display_name: string }> {
  return page.evaluate<{ token: string; display_name: string }>(
    `import("/src/lib/tauri.ts").then((tauri) => tauri.debugInjectOpenRequest(${scriptValue(path)}))`,
  );
}

export async function answerNextConfirmation(page: Page, answer: boolean): Promise<void> {
  await page.evaluate(
    `import("/src/lib/tauri.ts").then((tauri) => tauri.debugAnswerNextConfirmation(${scriptValue(answer)})).then(() => true)`,
  );
}

export async function trustFromBanner(page: Page): Promise<void> {
  const banner = page.locator('[data-testid="folder-trust-banner"]');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await answerNextConfirmation(page, true);
  await page.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('[data-testid="folder-trust-banner"] button')).find((candidate) => candidate.textContent?.trim() === "Trust this folder");
    button.click();
    return true;
  })()`);
  await expect(banner).toHaveCount(0, { timeout: 20_000 });
}

export async function expectMainDocument(page: Page, path: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate<string>(
          `import("/src/store/files.ts").then(({ useFilesStore }) => {
            const main = useFilesStore.getState().mainDoc;
            const row = document.querySelector('[aria-label="Explorer file tree"] [data-path=' + CSS.escape(main) + ']');
            if (row && row.getAttribute("data-main-document") !== "true") return "tree row not marked as main";
            return main;
          })`,
        ),
      { timeout: 20_000 },
    )
    .toBe(path);
}

export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate<number>(
          `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
        ),
      { timeout: 10_000 },
    )
    .toBe(0);
}

export async function openedState(page: Page): Promise<OpenedState> {
  return page.evaluate<OpenedState>(
    `import("/src/store/files.ts").then(({ useFilesStore }) => {
      const s = useFilesStore.getState();
      return {
        projectId: s.projectId,
        projectName: s.projectName,
        mainDoc: s.mainDoc,
        engine: s.engine?.id ?? "",
        manifestHome: s.manifestHome,
        loading: s.loading,
      };
    })`,
  );
}

export async function openFolder(page: Page, path: string): Promise<OpenedState> {
  const previous = (await openedState(page)).projectId;
  await injectOpenRequest(page, path);
  await expect
    .poll(
      async () => {
        const state = await openedState(page);
        return !state.loading && state.projectId !== null && state.projectId !== previous;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  return openedState(page);
}

export async function startChat(page: Page, projectId: string, message: string): Promise<void> {
  await page.evaluate(
    `import("/src/store/chats.ts").then(({ useChatsStore }) => {
      const chat = useChatsStore.getState().create(${scriptValue(projectId)}, null);
      useChatsStore.getState().saveMessages(chat.id, [{ id: "open-folder-message", role: "user", content: ${scriptValue(message)}, createdAt: Date.now() }]);
      return true;
    })`,
  );
  await expect
    .poll(() => {
      const dataDir = process.env.OLEAFLY_DATA_DIR;
      if (!dataDir) throw new Error("OLEAFLY_DATA_DIR is not set; run specs through scripts/e2e.sh");
      try {
        return readFileSync(join(dataDir, "chats", `${projectId}.json`), "utf8").includes(message);
      } catch {
        return false;
      }
    }, { timeout: 20_000 })
    .toBe(true);
}

export async function loadedChatMessages(page: Page, projectId: string): Promise<string[]> {
  return page.evaluate<string[]>(
    `import("/src/store/chats.ts").then(({ useChatsStore }) =>
      useChatsStore.getState().load(${scriptValue(projectId)}).then(() =>
        useChatsStore.getState().chats.flatMap((chat) => chat.messages.map((message) => message.content)),
      ),
    )`,
  );
}

export function folderCard(name: string): string {
  return `[data-testid="project-grid"] button[aria-label=${JSON.stringify(`Open ${name}`)}]`;
}

export interface CardDetails {
  text: string;
  kind: string | null;
  date: string | null;
}

export async function folderCardDetails(page: Page, name: string): Promise<CardDetails | null> {
  return page.evaluate<CardDetails | null>(
    `(() => {
      const button = document.querySelector(${scriptValue(folderCard(name))});
      const card = button?.parentElement;
      if (!card) return null;
      return {
        text: card.textContent ?? "",
        kind: card.querySelector('[data-testid="project-card-kind"]')?.textContent ?? null,
        date: card.querySelector('[data-testid="project-card-date"]')?.textContent ?? null,
      };
    })()`,
  );
}

export async function showSplitView(page: Page): Promise<void> {
  await page.click('[data-testid="toolbar-views"] button[aria-label="Split View"]');
}

export async function waitForCompileSuccess(page: Page, timeoutMs = 120_000): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate<boolean>(
          `Promise.all([import("/src/store/compile.ts"), import("/src/store/files.ts")]).then(([compile, files]) => {
            const state = compile.useCompileStore.getState();
            const projectId = files.useFilesStore.getState().projectId;
            return state.status === "success" && projectId !== null && state.lastCompileCheckpoint?.projectId === projectId;
          })`,
        ),
      { timeout: timeoutMs },
    )
    .toBe(true);
}

export async function waitForPdfPage(page: Page, timeoutMs = 60_000): Promise<void> {
  await waitLong(page, `!!document.querySelector('.pdf-canvas')`, timeoutMs);
}

export async function goToLibrary(page: Page): Promise<void> {
  await page.evaluate(`import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().closeProject())`);
  await waitLong(page, `!!document.querySelector('[data-testid="library"][data-projects-loaded="true"]')`, 30_000);
}
