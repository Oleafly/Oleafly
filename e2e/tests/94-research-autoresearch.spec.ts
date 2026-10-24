import type { ResearchTask } from "../../src/lib/research-tasks";
import { test, expect } from "../fixtures";
import { clickTabByText, createBlankProject, openRailTab, type Page } from "../helpers";
import { startMockAiServer, type MockAiServer } from "../mock-ai-server";
import { scriptValue } from "../script-value";

const detailSelector = 'article[aria-labelledby="research-task-detail-title"]';

let server: MockAiServer;

test.beforeAll(async () => {
  server = await startMockAiServer();
});

test.afterAll(async () => {
  await server?.close();
});

test.beforeEach(async ({ tauriPage }) => {
  const hasBack = await tauriPage.evaluate<boolean>(`!!document.querySelector('[title="Back to library"]')`);
  if (hasBack) await tauriPage.click('[title="Back to library"]');
});

async function createProject(page: Page, run: string) {
  await createBlankProject(page, `Autoresearch ${run}`);
  const connected = await page.evaluate<boolean>(
    `window.__aiConnect?.("ollama", ${scriptValue(server.url)}, "llama3.2") ?? false`,
  );
  expect(connected).toBe(true);
  // 0.4.8: research tasks are experimental and off by default.
  const enabled = await page.evaluate<boolean>(`window.__researchTasksEnable?.() ?? false`);
  expect(enabled).toBe(true);
  const projectId = await page.evaluate<string>(
    `document.querySelector('[data-e2e-project-id]')?.getAttribute('data-e2e-project-id') ?? ''`,
  );
  expect(projectId).not.toBe("");
  await openRailTab(page, "Research workspace");
  await expect(page.getByTestId("research-workspace-panel")).toBeVisible({ timeout: 20_000 });
  return projectId;
}

/** Creates a task through the app's own API (the composer is covered elsewhere). */
function createTask(
  page: Page,
  projectId: string,
  title: string,
  options: { reviewPlanFirst?: boolean; dependencyIds?: string[] } = {},
) {
  return page.evaluate<ResearchTask>(
    `import("/src/lib/research-tasks.ts").then(async ({ createResearchTask, defaultBrief }) => {
      const brief = defaultBrief("Check the manuscript.");
      brief.reviewPlanFirst = ${options.reviewPlanFirst === true};
      const task = await createResearchTask({
        projectId: ${scriptValue(projectId)},
        title: ${scriptValue(title)},
        prompt: "Check the manuscript and report.",
        runtimeId: "builtin",
        agentId: "ollama",
        modelId: "llama3.2",
        skillIds: [],
        dependencyIds: ${scriptValue(options.dependencyIds ?? [])},
        brief,
      });
      const { useResearchTasksStore } = await import("/src/store/research-tasks.ts");
      useResearchTasksStore.getState().receiveTask(task);
      return task;
    })`,
  );
}

function nativeTask(page: Page, projectId: string, taskId: string) {
  return page.evaluate<ResearchTask | null>(
    `import("/src/lib/research-tasks.ts").then(async ({ listResearchTasks }) =>
      (await listResearchTasks(${scriptValue(projectId)})).find((task) => task.id === ${scriptValue(taskId)}) ?? null)`,
  );
}

async function waitForStatus(page: Page, projectId: string, taskId: string, status: ResearchTask["status"]) {
  await expect
    .poll(async () => (await nativeTask(page, projectId, taskId))?.status, { timeout: 90_000 })
    .toBe(status);
}

function openTask(page: Page, taskId: string) {
  return page.evaluate(
    `import("/src/store/research-tasks.ts").then(({ useResearchTasksStore }) =>
      useResearchTasksStore.getState().openTaskDetail(${scriptValue(taskId)}))`,
  );
}

test("a plan-first task stops at Plan ready and continues after approval", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  const run = Date.now().toString(36);
  const projectId = await createProject(tauriPage, run);
  const task = await createTask(tauriPage, projectId, `Plan first ${run}`, { reviewPlanFirst: true });
  expect(task.recordDir).toMatch(/^research\//);

  server.resetRequests();
  server.setToolCall({
    name: "write_file",
    args: { path: `${task.recordDir}/plan.md`, content: "- [ ] Measure a baseline\n- [ ] Report\n" },
    then: "The plan is written.",
  });
  await tauriPage.evaluate(
    `import("/src/lib/research-tasks.ts").then(({ startResearchTask }) => startResearchTask(${scriptValue(task.id)}))`,
  );
  await waitForStatus(tauriPage, projectId, task.id, "plan_ready");

  await openTask(tauriPage, task.id);
  const detail = tauriPage.locator(detailSelector);
  await clickTabByText(tauriPage, '[data-testid="research-task-detail"]', "Review");
  await expect(detail.getByTestId("research-task-plan")).toContainText("Measure a baseline", { timeout: 20_000 });

  server.setToolCall(null);
  server.setReply("Plan carried out.");
  await detail.getByText("Approve plan", { exact: true }).click();
  await waitForStatus(tauriPage, projectId, task.id, "awaiting_review");

  const requests = server.requestBodies().join("\n");
  expect(requests).toContain("the user approved the plan below; carry it out");
});

test("a failed dependency fails its waiting dependent with a Retry", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  const run = Date.now().toString(36);
  const projectId = await createProject(tauriPage, run);
  const first = await createTask(tauriPage, projectId, `Collect ${run}`);
  const second = await createTask(tauriPage, projectId, `Analyse ${run}`, { dependencyIds: [first.id] });
  await tauriPage.evaluate(
    `import("/src/lib/research-tasks.ts").then(({ startResearchTask }) => startResearchTask(${scriptValue(second.id)}))`,
  );
  await tauriPage.evaluate(
    `import("/src/lib/research-tasks.ts").then(({ cancelResearchTask }) => cancelResearchTask(${scriptValue(first.id)}))`,
  );
  await waitForStatus(tauriPage, projectId, second.id, "failed");

  await openTask(tauriPage, second.id);
  const detail = tauriPage.locator(detailSelector);
  await expect(detail.getByText("Retry", { exact: true })).toBeVisible({ timeout: 20_000 });
});

test("the Research tab shows a badge while a task waits for review", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  const run = Date.now().toString(36);
  const projectId = await createProject(tauriPage, run);
  const task = await createTask(tauriPage, projectId, `Badge ${run}`);
  server.setToolCall(null);
  server.setReply("Nothing to change.");
  await tauriPage.evaluate(
    `import("/src/lib/research-tasks.ts").then(({ startResearchTask }) => startResearchTask(${scriptValue(task.id)}))`,
  );
  await waitForStatus(tauriPage, projectId, task.id, "awaiting_review");
  await expect(tauriPage.locator('button[data-tour="rail-research"] output[aria-label="1 pending"]')).toBeVisible({ timeout: 20_000 });
});
