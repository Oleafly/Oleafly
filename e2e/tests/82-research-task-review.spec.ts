import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResearchTask, TaskFilePreview } from "../../src/lib/research-tasks";
import { test, expect } from "../fixtures";
import { createBlankProject, editorSource, fillTextarea, openRailTab, type Page } from "../helpers";
import { startMockAiServer, type MockAiServer } from "../mock-ai-server";

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
  await createBlankProject(page, `Task review ${run}`);
  const connected = await page.evaluate<boolean>(
    `window.__aiConnect?.("ollama", ${JSON.stringify(server.url)}, "llama3.2") ?? false`,
  );
  expect(connected).toBe(true);
  const projectId = await page.evaluate<string>(
    `document.querySelector('[data-e2e-project-id]')?.getAttribute('data-e2e-project-id') ?? ''`,
  );
  expect(projectId).not.toBe("");
  await openRailTab(page, "Research workspace");
  await expect(page.getByTestId("research-workspace-panel")).toBeVisible({ timeout: 20_000 });
  return projectId;
}

function readMain(page: Page, projectId: string) {
  return page.evaluate<string>(
    `import("/src/lib/tauri.ts").then(({ readFileContent }) => readFileContent(${JSON.stringify(projectId)}, "main.tex"))`,
  );
}

async function nativeTask(page: Page, projectId: string, title: string) {
  const task = await page.evaluate<ResearchTask | null>(
    `import("/src/lib/research-tasks.ts").then(async ({ listResearchTasks }) =>
      (await listResearchTasks(${JSON.stringify(projectId)})).find((task) => task.title === ${JSON.stringify(title)}) ?? null)`,
  );
  if (!task) throw new Error(`The native task ${title} was not found`);
  return task;
}

function previewMain(page: Page, taskId: string) {
  return page.evaluate<TaskFilePreview>(
    `import("/src/lib/research-tasks.ts").then(({ previewResearchTaskFile }) => previewResearchTaskFile(${JSON.stringify(taskId)}, "main.tex"))`,
  );
}

function revisedManuscript(original: string, paragraph: string) {
  expect(original).toContain("\\end{document}");
  return original.replace("\\end{document}", `\\par ${paragraph}\n\\end{document}`);
}

async function runRevision(page: Page, projectId: string, title: string, proposed: string) {
  await page.getByText("New task", { exact: true }).click();
  await page.fill("#research-task-title", title);
  await fillTextarea(page, "#research-task-prompt", "Revise main.tex and leave the change ready for review.");
  const agentValue = ["builtin", "ollama", "llama3.2"].join("\u0000");
  await page.waitForFunction(`(() => {
    const select = document.querySelector('#research-task-agent');
    return !!select && !select.disabled && [...select.options].some((option) => option.value === ${JSON.stringify(agentValue)});
  })()`, 20_000);
  await page.evaluate(`(() => {
    const select = document.querySelector('#research-task-agent');
    select.value = ${JSON.stringify(agentValue)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select.value;
  })()`);
  server.resetRequests();
  server.setToolCall({ name: "write_file", args: { path: "main.tex", content: proposed }, then: `Revision ready: ${title}` });
  await page.getByText("Create task", { exact: true }).click();
  await expect(page.locator(detailSelector)).toContainText(title, { timeout: 20_000 });
  await page.getByText("Start", { exact: true }).click();
  await expect(page.locator(detailSelector)).toContainText("Review needed", { timeout: 90_000 });
  await expect(page.locator(detailSelector)).toContainText(`Revision ready: ${title}`);
  const task = await nativeTask(page, projectId, title);
  expect(task.runtimeId).toBe("builtin");
  expect(task.agentId).toBe("ollama");
  expect(task.modelId).toBe("llama3.2");
  expect(task.status).toBe("awaiting_review");
  expect(task.result?.changedFiles.map((change) => ({ path: change.path, kind: change.kind }))).toEqual([
    { path: "main.tex", kind: "modified" },
  ]);
  expect(task.review).toBeNull();
  expect(task.isolation).not.toBeNull();
  expect(readFileSync(join(task.isolation!.executionRoot, "main.tex"), "utf8")).toBe(proposed);
  const requests = server.requestBodies().map((body) => JSON.parse(body) as {
    tools?: Array<{ function?: { name?: string } }>;
    messages?: Array<{ role?: string; content?: unknown }>;
  });
  expect(requests.some((request) => request.tools?.some((tool) => tool.function?.name === "write_file"))).toBe(true);
  expect(requests.some((request) => request.messages?.some((message) => message.role === "tool"))).toBe(true);
  return task;
}

test("a native task edits its isolated manuscript and applies only after preview and review", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  const run = Date.now().toString(36);
  const projectId = await createProject(tauriPage, run);
  const original = await readMain(tauriPage, projectId);
  const marker = `E2E reviewed revision ${run}`;
  const proposed = revisedManuscript(original, marker);
  const task = await runRevision(tauriPage, projectId, `Review revision ${run}`, proposed);
  expect(await readMain(tauriPage, projectId)).toBe(original);
  expect(await editorSource(tauriPage)).toBe(original);
  const preview = await previewMain(tauriPage, task.id);
  expect(preview.before.text).toBe(original);
  expect(preview.after.text).toBe(proposed);

  const detail = tauriPage.locator(detailSelector);
  const apply = detail.getByText("Apply 1 selected", { exact: true });
  await expect(apply).toBeDisabled();
  await detail.getByText("Preview", { exact: true }).click();
  await expect(detail).toContainText(marker, { timeout: 20_000 });
  await expect(apply).toBeEnabled();
  expect(await readMain(tauriPage, projectId)).toBe(original);
  await apply.click();
  await expect(detail).toContainText("Completed", { timeout: 20_000 });
  expect(await readMain(tauriPage, projectId)).toBe(proposed);
  await tauriPage.waitForFunction(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => getEditorView()?.state.doc.toString() === ${JSON.stringify(proposed)})`,
    20_000,
  );
  const applied = await nativeTask(tauriPage, projectId, task.title);
  expect(applied.status).toBe("completed");
  expect(applied.review?.selectedPaths).toEqual(["main.tex"]);
  expect(applied.review?.projectMutationGeneration).toBeGreaterThan(0);
});

test("applying a task preserves an unsaved editor edit and retains the conflicting result", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  const run = Date.now().toString(36);
  const projectId = await createProject(tauriPage, run);
  const original = await readMain(tauriPage, projectId);
  const marker = `E2E isolated proposal ${run}`;
  const proposed = revisedManuscript(original, marker);
  const manual = revisedManuscript(original, `E2E unsaved manuscript edit ${run}`);
  const task = await runRevision(tauriPage, projectId, `Preserve manual edits ${run}`, proposed);
  const detail = tauriPage.locator(detailSelector);
  await detail.getByText("Preview", { exact: true }).click();
  await expect(detail).toContainText(marker, { timeout: 20_000 });
  await expect(detail.getByText("Apply 1 selected", { exact: true })).toBeEnabled();

  const beforeApply = await tauriPage.evaluate<{
    disk: string;
    dirty: boolean;
    buffer: string;
    editor: string;
  }>(`Promise.all([
    import("/src/components/editor/cm/controller.ts"),
    import("/src/store/files.ts"),
    import("/src/lib/tauri.ts"),
  ]).then(async ([controller, files, tauri]) => {
    const disk = await tauri.readFileContent(${JSON.stringify(projectId)}, "main.tex");
    const view = controller.getEditorView();
    const state = files.useFilesStore.getState();
    if (!view || state.projectId !== ${JSON.stringify(projectId)} || state.activePath !== "main.tex") throw new Error("The manuscript editor is not active");
    const apply = [...document.querySelectorAll('${detailSelector} button')].find((button) => button.textContent.trim() === "Apply 1 selected");
    if (!apply || apply.disabled) throw new Error("The reviewed task is not ready to apply");
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(manual)} } });
    const pending = files.useFilesStore.getState().files["main.tex"];
    const observed = { disk, dirty: pending.dirty, buffer: pending.content, editor: view.state.doc.toString() };
    if (!observed.dirty || observed.buffer !== ${JSON.stringify(manual)}) throw new Error("The editor edit was not pending before Apply");
    apply.click();
    return observed;
  })`);
  expect(beforeApply).toEqual({ disk: original, dirty: true, buffer: manual, editor: manual });
  await expect(tauriPage.getByTestId("research-tasks-panel").locator('[role="alert"]')).toContainText(
    "main.tex changed after this task started",
    { timeout: 20_000 },
  );
  await expect(detail).toContainText("Review needed");
  await expect(detail.getByText("Apply 1 selected", { exact: true })).toBeEnabled();
  expect(await readMain(tauriPage, projectId)).toBe(manual);
  expect(await editorSource(tauriPage)).toBe(manual);
  const retained = await nativeTask(tauriPage, projectId, task.title);
  expect(retained.status).toBe("awaiting_review");
  expect(retained.review).toBeNull();
  expect(retained.result).toEqual(task.result);
  expect(retained.error).toContain("main.tex changed after this task started");
  const preview = await previewMain(tauriPage, task.id);
  expect(preview.before.text).toBe(original);
  expect(preview.after.text).toBe(proposed);
  expect(readFileSync(join(retained.isolation!.executionRoot, "main.tex"), "utf8")).toBe(proposed);

  await detail.getByText("Discard changes", { exact: true }).click();
  await expect(detail).toContainText("Cancelled", { timeout: 20_000 });
  expect((await nativeTask(tauriPage, projectId, task.title)).status).toBe("cancelled");
  expect(await readMain(tauriPage, projectId)).toBe(manual);
  await detail.getByText("Retry", { exact: true }).click();
  await expect(detail).toContainText("Queued", { timeout: 20_000 });
  expect((await nativeTask(tauriPage, projectId, task.title)).status).toBe("queued");
  expect(await editorSource(tauriPage)).toBe(manual);
});
