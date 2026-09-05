import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test, expect } from "../fixtures";
import {
  createBlankProject,
  fillTextarea,
  listProjectEntries,
  openGallery,
  openRailTab,
  setNextImportPaths,
  waitLong,
  type Page,
} from "../helpers";
import { startMockAiServer, type MockAiServer } from "../mock-ai-server";

let server: MockAiServer;

test.beforeAll(async () => {
  server = await startMockAiServer();
});

test.afterAll(async () => {
  await server?.close();
});

test.beforeEach(async ({ tauriPage }) => {
  const hasBack = await tauriPage.evaluate<boolean>(
    `!!document.querySelector('[title="Back to library"]')`,
  );
  if (hasBack) await tauriPage.click('[title="Back to library"]');
});

async function connectAgent(page: Page) {
  const connected = await page.evaluate<boolean>(
    `window.__aiConnect?.("ollama", ${JSON.stringify(server.url)}, "llama3.2") ?? false`,
  );
  expect(connected, "the provider connection fixture must be available").toBe(true);
}

async function activeProjectId(page: Page) {
  const projectId = await page.evaluate<string>(
    `document.querySelector('[data-e2e-project-id]')?.getAttribute('data-e2e-project-id') ?? ''`,
  );
  expect(projectId, "an open project must expose its native identity").not.toBe("");
  return projectId;
}

async function chooseSelectOption(page: Page, trigger: string, option: string) {
  await page.click(trigger);
  const selector = `[role="option"][data-label=${JSON.stringify(option)}]`;
  await page.waitForFunction(`!!document.querySelector(${JSON.stringify(selector)})`, 5_000);
  await page.click(selector);
}

test("a research task runs in Rust, reaches review, and records the same native turn", async ({
  tauriPage,
}) => {
  test.setTimeout(120_000);
  const run = Date.now().toString(36);
  const projectName = `Research task ${run}`;
  const taskTitle = `Audit the manuscript ${run}`;
  const reply = `The manuscript structure is ready for review. ${run}`;

  await createBlankProject(tauriPage, projectName);
  await connectAgent(tauriPage);
  const projectId = await activeProjectId(tauriPage);
  await openRailTab(tauriPage, "Research workspace");
  await expect(tauriPage.getByTestId("research-workspace-panel")).toBeVisible({ timeout: 20_000 });

  const newTask = tauriPage.getByText("New task", { exact: true });
  await expect(newTask).toBeEnabled({ timeout: 20_000 });
  await newTask.click();
  await tauriPage.fill("#research-task-title", taskTitle);
  await fillTextarea(
    tauriPage,
    "#research-task-prompt",
    "Review the manuscript structure and return a concise readiness note. Do not change any files.",
  );
  const targetAgent = ["builtin", "ollama", "llama3.2"].join("\u0000");
  await tauriPage.waitForFunction(`(() => {
    const select = document.querySelector('#research-task-agent');
    return !!select && [...select.options].some((option) => option.value === ${JSON.stringify(targetAgent)});
  })()`, 20_000);
  await tauriPage.evaluate(`(() => {
    const select = document.querySelector('#research-task-agent');
    select.value = ${JSON.stringify(targetAgent)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select.value;
  })()`);
  server.resetRequests();
  server.setToolCall(null);
  server.setReply(reply);
  await tauriPage.getByText("Create task", { exact: true }).click();

  const detail = tauriPage.locator(
    'article[aria-labelledby="research-task-detail-title"]',
  );
  await expect(detail).toContainText(taskTitle, { timeout: 20_000 });
  await detail.getByText("Start", { exact: true }).click();
  await expect(detail.getByText("Review needed", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await expect(detail.locator('section[aria-labelledby="research-task-result"]')).toContainText(
    reply,
  );
  await expect(detail.locator('section[aria-labelledby="research-task-activity"]')).toContainText(
    "Usage: 13 input, 9 output tokens.",
  );

  const task = await tauriPage.evaluate<{
    nativeSessionId: string | null;
    resultSessionId: string | null;
    status: string;
  }>(
    `import("/src/lib/research-tasks.ts").then(async ({ listResearchTasks }) => {
      const tasks = await listResearchTasks(${JSON.stringify(projectId)});
      const task = tasks.find((candidate) => candidate.title === ${JSON.stringify(taskTitle)});
      if (!task) throw new Error("the created research task was not found");
      return {
        nativeSessionId: task.nativeSessionId,
        resultSessionId: task.result?.nativeSessionId ?? null,
        status: task.status,
      };
    })`,
  );
  expect(task.status).toBe("awaiting_review");
  expect(task.nativeSessionId).toBeTruthy();
  expect(task.resultSessionId).toBe(task.nativeSessionId);
  expect(server.requestCount()).toBeGreaterThan(0);

  await detail.getByText("Mark reviewed", { exact: true }).click();
  await expect(detail).toContainText("Completed", { timeout: 20_000 });

  await openRailTab(tauriPage, "Research Assistant");
  await tauriPage.click('[aria-label="Usage report"]');
  const reportDialog = tauriPage.locator('[role="dialog"]:has(input[placeholder="All projects"])');
  await expect(reportDialog).toBeVisible({ timeout: 20_000 });
  await reportDialog.locator('input[placeholder="All projects"]').fill(projectId);
  await reportDialog.locator('input[placeholder="All agents"]').fill("built-in");
  await reportDialog
    .locator('input[placeholder="All sessions"]')
    .fill(task.nativeSessionId as string);
  await reportDialog.getByText("Apply", { exact: true }).click();

  await waitLong(
    tauriPage,
    `(() => {
      const report = document.querySelector('[data-testid="usage-report"]');
      return !!report &&
        !!report.querySelector(${JSON.stringify(`[title="${task.nativeSessionId}"]`)}) &&
        !!report.querySelector(${JSON.stringify(`[title="${projectId}"]`)});
    })()`,
    30_000,
  );
  const report = tauriPage.getByTestId("usage-report");
  await expect(report.locator(`[title="${task.nativeSessionId}"]`)).toBeVisible();
  await expect(report).toContainText(projectName);
  await expect(report).toContainText("Oleafly assistant");
  await expect(report).toContainText("13");
  await expect(report).toContainText("9");
  await expect(report).toContainText("1 usage record");
});

test("a linked folder keeps its access profile, previews a source, and unlinks without deletion", async ({
  tauriPage,
}) => {
  test.setTimeout(90_000);
  const run = Date.now().toString(36);
  const fixtureRoot = mkdtempSync(join(tmpdir(), "oleafly-research-root-e2e-"));
  const sourceName = `evidence-${run}.txt`;
  const sourcePath = join(fixtureRoot, sourceName);
  const sourceText = `Verified evidence for ${run}.\n`;
  writeFileSync(sourcePath, sourceText);

  try {
    await createBlankProject(tauriPage, `Linked research ${run}`);
    await openRailTab(tauriPage, "Research workspace");
    const workspace = tauriPage.getByTestId("research-workspace-panel");
    await expect(workspace).toBeVisible({ timeout: 20_000 });
    await expect(workspace.locator('[role="tab"][id$="-trigger-folders"]')).toBeVisible({
      timeout: 20_000,
    });
    await tauriPage.evaluate(`(() => {
      const workspace = document.querySelector('[data-testid="research-workspace-panel"]');
      const tab = workspace?.querySelector('[role="tab"][id$="-trigger-folders"]');
      if (!tab) throw new Error('Linked folders tab is unavailable');
      tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      tab.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
      tab.click();
    })()`);
    await expect(tauriPage.getByText("Research folders", { exact: true })).toBeVisible({
      timeout: 20_000,
    });

    await setNextImportPaths(tauriPage, [fixtureRoot]);
    await tauriPage.click('[aria-label="Choose folder"]');
    await expect(tauriPage.locator("#new-research-root-path")).toHaveValue(fixtureRoot);
    await tauriPage.fill("#new-research-root-label", "Study evidence");
    await chooseSelectOption(tauriPage, "#new-research-root-role", "References");
    await chooseSelectOption(tauriPage, "#new-research-root-access", "Read and write");
    await tauriPage.getByText("Link folder", { exact: true }).click();

    const root = tauriPage.locator("article[data-root-id]");
    await expect(root).toBeVisible({ timeout: 20_000 });
    await expect(root.locator('input[id^="research-root-label-"]')).toHaveValue("Study evidence");
    await expect(root.locator('[aria-label="Study evidence role"]')).toContainText("References");
    await expect(root.locator('[aria-label="Study evidence access"]')).toContainText(
      "Read and write",
    );
    await expect(root).toContainText(basename(fixtureRoot));

    await root.getByText("Browse files", { exact: true }).click();
    await root.getByText(sourceName, { exact: true }).click();
    await expect(root).toContainText(sourceText.trim(), { timeout: 20_000 });
    await root.getByText("Unlink", { exact: true }).click();
    await expect(root).toHaveCount(0);
    await expect(
      tauriPage.getByText("No research folders are linked to this manuscript.", { exact: true }),
    ).toBeVisible();
    expect(readFileSync(sourcePath, "utf8")).toBe(sourceText);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("research project setup previews the planned tree and creates its queued first task", async ({
  tauriPage,
}) => {
  test.setTimeout(120_000);
  const run = Date.now().toString(36);
  const projectName = `Evidence review ${run}`;

  await connectAgent(tauriPage);
  await openGallery(tauriPage);
  await tauriPage.click('[data-testid="new-research-project"]');
  const dialog = tauriPage.locator('[role="dialog"]:has(#research-project-name)');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await tauriPage.fill("#research-project-name", projectName);
  await chooseSelectOption(tauriPage, "#research-project-engine", "Markdown");
  await chooseSelectOption(tauriPage, "#research-project-starter", "Literature review");

  await expect(dialog.getByText("Main document: main.md", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  for (const path of [
    "main.md",
    "research/sources",
    "research/reading-list.md",
    "research/claims.md",
    "review/notes.md",
  ]) {
    await expect(dialog.getByText(path, { exact: true })).toBeVisible();
  }
  await dialog.getByText("main.md", { exact: true }).click();
  await expect(dialog.locator("pre")).toContainText(`# ${projectName}`);
  await expect(dialog.locator("pre")).toContainText("## Search strategy");
  await expect(dialog).toContainText(
    "Set the review scope, then build a reading list from verified sources.",
  );

  await dialog.getByText("Create and open project", { exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expect(tauriPage.locator("[data-e2e-project-id]")).toBeVisible({ timeout: 60_000 });
  const entries = (await listProjectEntries(tauriPage)).map((entry) => entry.path);
  expect(entries).toEqual(
    expect.arrayContaining([
      "main.md",
      "research/reading-list.md",
      "research/claims.md",
      "review/notes.md",
    ]),
  );

  await openRailTab(tauriPage, "Research workspace");
  const panel = tauriPage.getByTestId("research-tasks-panel");
  await expect(panel).toContainText("Plan the literature review", { timeout: 20_000 });
  await expect(panel).toContainText(
    "Set the review scope, then build a reading list from verified sources.",
  );
  await expect(panel).toContainText("Queued");
});
