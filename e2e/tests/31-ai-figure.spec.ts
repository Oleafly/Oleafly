import { test, expect } from "../fixtures";
import {
  caretIn,
  createBlankProject,
  fillTextarea,
  newChat,
  openProject,
  openRailTab,
  waitLong,
  type Page,
} from "../helpers";
import { startMockAiServer, type MockAiServer } from "../mock-ai-server";

const PROJECT = "Figure E2E";
const TA = 'textarea[placeholder*="Ask AI"]';
const FIGURE_CODE = "\\begin{tikzpicture}\\draw (0,0) circle (1);\\end{tikzpicture}";

let server: MockAiServer;

test.beforeAll(async () => {
  server = await startMockAiServer();
});

test.afterAll(async () => {
  await server?.close();
});

async function openFigureProject(page: Page) {
  const exists = await page.evaluate<boolean>(
    `document.body.innerText.includes(${JSON.stringify(PROJECT)})`,
  );
  if (exists) {
    await openProject(page, PROJECT);
  } else {
    await createBlankProject(page, PROJECT);
  }
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
}

async function connect(page: Page) {
  const ok = await page.evaluate<boolean>(
    `window.__aiConnect?.("ollama", ${JSON.stringify(server.url)}, "llama3.2") ?? false`,
  );
  expect(ok, "__aiConnect devtools hook must be present").toBe(true);
}

async function openChat(page: Page) {
  await openRailTab(page, "Research Assistant");
  await expect(page.locator(TA)).toBeVisible({ timeout: 10_000 });
  await newChat(page);
  await waitLong(page, `document.querySelector(${JSON.stringify(TA)})?.value === ""`, 10_000);
}

async function ask(page: Page, text: string) {
  await fillTextarea(page, TA, text);
  await page.press(TA, "Enter");
}

async function approveIfAsked(page: Page): Promise<boolean> {
  return page.evaluate<boolean>(
    `(() => {
      const button = Array.from(document.querySelectorAll('button'))
        .find((candidate) => (candidate.textContent || '').trim() === 'Approve');
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
}

async function expandFinishedSteps(page: Page) {
  await page.evaluate(
    `(() => {
      for (const button of document.querySelectorAll('[data-testid="worked-steps-toggle"]')) {
        if (button.getAttribute("aria-expanded") !== "true") button.click();
      }
      return true;
    })()`,
  );
}

async function waitForReply(page: Page, marker: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await approveIfAsked(page);
    const done = await page.evaluate<boolean>(
      `document.body.innerText.includes(${JSON.stringify(marker)}) && !document.querySelector('[aria-label="Stop"]')`,
    );
    if (done) return;
    if (Date.now() > deadline) throw new Error(`the reply "${marker}" never arrived`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function requestTools(body: string): string[] {
  const parsed = JSON.parse(body) as {
    tools?: { type?: string; function?: { name?: string }; name?: string }[];
  };
  return (parsed.tools ?? []).map((entry) => entry.function?.name ?? entry.name ?? "");
}

function systemPrompt(body: string): string {
  const parsed = JSON.parse(body) as { messages?: { role: string; content: unknown }[] };
  const message = (parsed.messages ?? []).find((entry) => entry.role === "system");
  return typeof message?.content === "string" ? message.content : "";
}

test("a LaTeX chat run carries the figure tools with no mode to switch on", async ({
  tauriPage,
}) => {
  test.setTimeout(180_000);
  await openFigureProject(tauriPage);
  await connect(tauriPage);
  await openChat(tauriPage);

  expect(
    await tauriPage.evaluate<number>(
      `document.querySelectorAll('[aria-label="Toggle figure mode"]').length`,
    ),
    "the figure toggle must be gone from the composer",
  ).toBe(0);

  server.setStreamDelay(0);
  server.setToolCall(null);
  server.setReply("FIGURETOOLS31");
  server.resetRequests();

  await ask(tauriPage, "What figures can you draw for this paper?");
  await waitForReply(tauriPage, "FIGURETOOLS31");

  const bodies = server.requestBodies();
  expect(bodies.length, "the run must reach the model").toBeGreaterThan(0);

  const tools = requestTools(bodies[0]);
  expect(tools).toContain("preview_figure");
  expect(tools).toContain("insert_figure");
  expect(tools).toContain("load_image");

  const system = systemPrompt(bodies[0]);
  expect(system).toContain("Figures and diagrams:");
  expect(system).toContain("preview_figure");
  expect(system).toContain("insert_figure");
});

test("insert_figure lands a tikzpicture in the open document", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await openFigureProject(tauriPage);
  await connect(tauriPage);
  await caretIn(tauriPage, "here.", 1, "end");
  await openChat(tauriPage);

  server.setStreamDelay(0);
  server.setToolCall({
    name: "insert_figure",
    args: { code: FIGURE_CODE, caption: "E2E circle", label: "fig:e2e-circle" },
    then: "FIGUREINSERTED31",
  });
  server.resetRequests();

  await ask(tauriPage, "Insert the circle figure with insert_figure.");
  await waitForReply(tauriPage, "FIGUREINSERTED31", 150_000);

  server.setToolCall(null);

  await expandFinishedSteps(tauriPage);
  try {
    await waitLong(
      tauriPage,
      `!!document.querySelector('[data-tool-name="insert_figure"][data-tool-status="done"][data-tool-result="success"]')`,
      20_000,
    );
  } catch (error) {
    const card = await tauriPage.evaluate<string>(
      `(() => {
        const node = document.querySelector('[data-tool-name="insert_figure"]');
        if (!node) return "no insert_figure card";
        return [node.getAttribute("data-tool-status"), node.getAttribute("data-tool-result"), (node.textContent || "").slice(0, 600)].join(" | ");
      })()`,
    );
    throw new Error(`insert_figure did not succeed: ${card}`, { cause: error });
  }
  await waitLong(
    tauriPage,
    `(document.querySelector('.cm-content')?.textContent || '').includes('tikzpicture')`,
    20_000,
  );
});
