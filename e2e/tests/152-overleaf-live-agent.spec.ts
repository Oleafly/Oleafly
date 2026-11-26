import { test, expect } from "../fixtures";
import {
  createBlankProject,
  fillTextarea,
  mcpRequest,
  mcpToolCall,
  openProject,
  openRailTab,
  readProjectText,
  startMcpServer,
  waitEditorShowsFile,
  type Page,
} from "../helpers";
import { startMockAiServer, type MockAiServer } from "../mock-ai-server";
import {
  leaveOverleafLive,
  OverleafStack,
  overleafLiveState,
  reopenOverleafProjectLive,
  type OverleafReady,
} from "../overleaf-stack";

const STACK = process.env.OLEAFLY_E2E_OVERLEAF_STACK ?? "";
const BASE = "Agent Live Base";
const PROJECT = "E2E Live";
const MAIN = "main.tex";
const TA = 'textarea[placeholder*="Ask AI"]';
const COAUTHOR = "COAUTHOR-AGENT-OL ";
const AGENT = " AGENT-WROTE-OL";

// Ignored on purpose outside CI without OLEAFLY_E2E_OVERLEAF_STACK, because the spec drives the mock server it names.
test.skip(
  !process.env.CI && !STACK,
  "Needs OLEAFLY_E2E_OVERLEAF_STACK, the mock Overleaf server built with `cargo build -p oleafly-online --features test-support --example e2e_overleaf`, answering the `text` and `peer_type` commands.",
);
test.describe.configure({ mode: "serial", retries: 0 });

let stack: OverleafStack;
let ai: MockAiServer;
let liveProjectId = "";

test.beforeAll(async () => {
  if (!STACK) throw new Error("CI must set OLEAFLY_E2E_OVERLEAF_STACK");
  stack = new OverleafStack(STACK);
  ai = await startMockAiServer();
  await stack.ready;
});

test.afterAll(async () => {
  stack?.stop();
  await ai?.close();
});

async function signInToTheMock(page: Page, { server }: OverleafReady) {
  const signedIn = await page.evaluate<boolean>(`Promise.all([import("/src/store/settings.ts"), import("/src/store/overleaf-import.ts")]).then(async ([settings, overleaf]) => {
    settings.useSettingsStore.getState().setOverleafLive(true);
    overleaf.useOverleafImportStore.getState().setServer(${JSON.stringify(server)});
    return overleaf.useOverleafImportStore.getState().signIn("Sign in to Overleaf");
  })`);
  expect(signedIn, "the mock signs the app in as alice").toBe(true);
}

async function openBaseProjectWithChat(page: Page) {
  const exists = await page.evaluate<boolean>(`document.body.innerText.includes(${JSON.stringify(BASE)})`);
  if (exists) await openProject(page, BASE);
  else await createBlankProject(page, BASE);
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const connected = await page.evaluate<boolean>(
    `window.__aiConnect?.("ollama", ${JSON.stringify(ai.url)}, "llama3.2") ?? false`,
  );
  expect(connected, "__aiConnect devtools hook must be present").toBe(true);
  await openRailTab(page, "Research Assistant");
  await expect(page.locator(TA)).toBeVisible({ timeout: 10_000 });
}

async function openProjectName(page: Page): Promise<{ id: string | null; name: string }> {
  return page.evaluate(
    `import("/src/store/files.ts").then(({ useFilesStore }) => ({ id: useFilesStore.getState().projectId, name: useFilesStore.getState().projectName }))`,
  );
}

async function approveMcp(page: Page, tool: string): Promise<void> {
  await expect
    .poll(() => page.evaluate<string[]>(`window.__mcpQueue?.() ?? []`), { timeout: 15_000 })
    .toEqual(expect.arrayContaining([expect.stringContaining(tool)]));
  expect(await page.evaluate<string>(`window.__mcpDecide("approve")`)).toContain(tool);
}

async function diskShows(page: Page, marker: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = await readProjectText(page, MAIN);
    if (text.includes(marker)) return text;
    if (Date.now() > deadline) throw new Error(`the project folder never showed ${marker}; it has ${JSON.stringify(text)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function sameEverywhere(page: Page, needles: string[]): Promise<string> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const server = await stack.text(MAIN);
    const disk = await readProjectText(page, MAIN);
    if (server === disk && needles.every((needle) => server.includes(needle))) return server;
    if (Date.now() > deadline) {
      throw new Error(`${MAIN} never matched on Overleaf and on disk: ${JSON.stringify({ needles, server, disk })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

test("the assistant opens an Overleaf project live after the user approves it", async ({ tauriPage: page }) => {
  test.setTimeout(240_000);
  const ready = await stack.ready;
  await signInToTheMock(page, ready);
  await openBaseProjectWithChat(page);

  ai.setToolCall({ name: "open_overleaf_live", args: { id: ready.project }, then: "OPENEDLIVE77" });
  await fillTextarea(page, TA, "Open my E2E Live project from Overleaf with live editing.");
  await page.press(TA, "Enter");

  const approve = page.getByTestId("tool-confirm-approve");
  await expect(approve).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate<string>(`document.body.innerText`)).toContain(
    `Open “${PROJECT}” from Overleaf with live editing`,
  );
  await approve.click();

  await waitEditorShowsFile(page, MAIN, 90_000);
  await overleafLiveState(page, ["upToDate"], 90_000);
  const opened = await openProjectName(page);
  expect(opened.name).toBe(PROJECT);
  liveProjectId = opened.id ?? "";
  ai.setToolCall(null);
});

test("an MCP write made before a coauthor's edit is refused, and the retry keeps both edits", async ({ tauriPage: page }) => {
  test.setTimeout(240_000);
  const { server, project } = await stack.ready;
  await reopenOverleafProjectLive(page, liveProjectId, MAIN);
  const connection = await startMcpServer(page, "ask");

  try {
    const listed = (await mcpRequest(connection, "tools/list")) as { result?: { tools?: { name: string }[] } };
    const names = (listed.result?.tools ?? []).map((tool) => tool.name);
    expect(names).toContain("open_overleaf_live");
    expect(names).not.toContain("import_overleaf_projects");

    const reopening = mcpToolCall(connection, "open_overleaf_live", { id: `${server}/project/${project}` });
    await approveMcp(page, "open_overleaf_live");
    expect(await reopening).toMatchObject({ success: true, projectId: liveProjectId, status: "online" });

    const first = await mcpToolCall(connection, "read_file", { path: MAIN });
    const read = `${String(first.content)}\n`;
    expect(read).toContain("Hello");
    const stale = mcpToolCall(connection, "write_file", { path: MAIN, content: read.replace("Hello", `Hello${AGENT}`) });
    await expect
      .poll(() => page.evaluate<string[]>(`window.__mcpQueue?.() ?? []`), { timeout: 15_000 })
      .toEqual(expect.arrayContaining([expect.stringContaining("write_file")]));

    const at = (await stack.text(MAIN)).indexOf("Hello");
    expect(at, "the mock seeds main.tex with Hello").toBeGreaterThan(0);
    await stack.request({ cmd: "peer_type", as: "bob", path: MAIN, at, text: COAUTHOR });
    await stack.textShows(MAIN, COAUTHOR, 30_000);
    await diskShows(page, COAUTHOR, 30_000);

    expect(await page.evaluate<string>(`window.__mcpDecide("approve")`)).toContain("write_file");
    const refused = await stale;
    expect(String(refused.error), JSON.stringify(refused)).toContain("changed while approval was pending");
    const kept = await stack.text(MAIN);
    expect(kept).toContain(COAUTHOR);
    expect(kept).not.toContain(AGENT);

    const second = await mcpToolCall(connection, "read_file", { path: MAIN });
    const fresh = `${String(second.content)}\n`;
    expect(fresh).toContain(COAUTHOR);
    const retry = mcpToolCall(connection, "write_file", { path: MAIN, content: fresh.replace("Hello", `Hello${AGENT}`) });
    await approveMcp(page, "write_file");
    expect(await retry).toMatchObject({ success: true });

    const merged = await sameEverywhere(page, [COAUTHOR, `Hello${AGENT}`]);
    expect(merged.split(COAUTHOR)).toHaveLength(2);
    expect(merged.split(AGENT)).toHaveLength(2);
  } finally {
    await page.evaluate(`import("/src/lib/tauri.ts").then(({ mcpSetEnabled }) => mcpSetEnabled(false))`);
    await leaveOverleafLive(page);
  }
});
