import { test, expect } from "../fixtures";
import {
  createBlankProject,
  fillTextarea,
  newChat,
  openProject,
  openRailTab,
  openSettings,
  waitLong,
  type Page,
} from "../helpers";
import { startMockAiServer, type MockAiServer } from "../mock-ai-server";
import { SKILL_FIXTURE_ID, startPackFixtureServer } from "../pack-fixture-server";

const PROJECT = "Skills E2E";
const TA = 'textarea[placeholder*="Ask AI"]';
const RESEARCH_LOOP = "oleafly-research-loop";
const PAPER_LOOKUP = "paper-lookup";
const LOOP_HEADING = "# Oleafly Research Loop";

let server: MockAiServer;
let fixtures: Awaited<ReturnType<typeof startPackFixtureServer>> | undefined;

test.beforeAll(async () => {
  server = await startMockAiServer();
  fixtures = await startPackFixtureServer();
});

test.afterAll(async () => {
  await server?.close();
  await fixtures?.close();
});

async function openSkillsProject(page: Page) {
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

async function closeAssistant(page: Page) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const open = await page.evaluate<boolean>(
      `document.querySelector('[data-testid="rail-assistant-toggle"]')?.getAttribute("aria-pressed") === "true"`,
    );
    if (!open) return;
    await page.evaluate(
      `(() => {
        const button = document.querySelector('[data-testid="rail-assistant-toggle"]');
        if (button instanceof HTMLElement) button.click();
        return true;
      })()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("closeAssistant: the assistant panel never closed");
}

async function openSkillsSettings(page: Page) {
  await openSettings(page, "ai");
  const tab = '[data-testid="ai-settings-tab-skills"]';
  const selectedExpression = `document.querySelector(${JSON.stringify(tab)})?.getAttribute("aria-selected") === "true"`;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await page.evaluate<boolean>(selectedExpression)) break;
    await page.evaluate(
      `(() => {
        const trigger = document.querySelector(${JSON.stringify(tab)});
        if (trigger instanceof HTMLElement) trigger.click();
        return true;
      })()`,
    );
    if (await page.evaluate<boolean>(selectedExpression)) break;
    await page.focus(tab);
    await page.press(tab, "Enter");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await waitLong(page, selectedExpression, 10_000);
  await waitLong(
    page,
    `!!document.querySelector('[data-testid="skills-catalog-section"]')`,
    20_000,
  );
}

async function clickWhenEnabled(page: Page, selector: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const clicked = await page.evaluate<boolean>(
      `(() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.click();
        return true;
      })()`,
    );
    if (clicked) return;
    if (Date.now() > deadline) throw new Error(`never became clickable: ${selector}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function skillRowText(page: Page, id: string): Promise<string> {
  return page.evaluate<string>(
    `document.querySelector('[data-testid="skill-row-${id}"]')?.textContent ?? ""`,
  );
}

async function groupOwning(page: Page, id: string): Promise<string> {
  return page.evaluate<string>(
    `(() => {
      const row = document.querySelector('[data-testid="skill-row-${id}"]');
      const group = row?.closest('[data-testid^="skills-phase-"]');
      return group?.getAttribute("data-testid") ?? "";
    })()`,
  );
}

async function ask(page: Page, text: string) {
  await fillTextarea(page, TA, text);
  await page.press(TA, "Enter");
}

async function waitForReply(page: Page, marker: string, timeoutMs = 60_000) {
  await waitLong(
    page,
    `document.body.innerText.includes(${JSON.stringify(marker)}) && !document.querySelector('[aria-label="Stop"]')`,
    timeoutMs,
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
  await page.evaluate(
    `(() => {
      for (const group of document.querySelectorAll('[data-testid="exploration-group"]')) {
        const button = group.querySelector("button");
        if (button && button.getAttribute("aria-expanded") !== "true") button.click();
      }
      return true;
    })()`,
  );
}

async function toolCardOutput(page: Page, name: string, timeoutMs = 20_000): Promise<string> {
  const badge = `[data-tool-name=${JSON.stringify(name)}]`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await expandFinishedSteps(page);
    const text = await page.evaluate<string>(
      `(() => {
        const card = document.querySelector(${JSON.stringify(badge)});
        if (!card) return "";
        const body = card.querySelector("pre");
        if (body) return body.textContent ?? "";
        const button = card.querySelector("button");
        if (button instanceof HTMLButtonElement) button.click();
        return "";
      })()`,
    );
    if (text) return text;
    if (Date.now() > deadline) {
      throw new Error(`the ${name} tool card never showed its output`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function bodyMessages(body: string): { role: string; content: unknown }[] {
  const parsed = JSON.parse(body) as { messages?: { role: string; content: unknown }[] };
  return parsed.messages ?? [];
}

function systemPrompt(body: string): string {
  const message = bodyMessages(body).find((entry) => entry.role === "system");
  return typeof message?.content === "string" ? message.content : "";
}

function lastUserMessage(body: string): string {
  const users = bodyMessages(body).filter((entry) => entry.role === "user");
  const last = users[users.length - 1];
  return typeof last?.content === "string" ? last.content : "";
}

function toolResults(body: string): string[] {
  return bodyMessages(body)
    .filter((entry) => entry.role === "tool")
    .map((entry) => (typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content)));
}

test("Settings lists the bundled skill pack grouped by research phase", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await openSkillsProject(tauriPage);
  await openSkillsSettings(tauriPage);

  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="skill-row-${RESEARCH_LOOP}"]')`,
    90_000,
  );
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="skill-row-${PAPER_LOOKUP}"]')`,
    30_000,
  );

  const phases = await tauriPage.evaluate<string[]>(
    `[...document.querySelectorAll('[data-testid^="skills-phase-"]')].map((group) => group.getAttribute("data-testid"))`,
  );
  expect(phases).toContain("skills-phase-research");
  expect(phases).toContain("skills-phase-review");

  expect(await groupOwning(tauriPage, RESEARCH_LOOP)).toBe("skills-phase-research");
  expect(await groupOwning(tauriPage, PAPER_LOOKUP)).toBe("skills-phase-research");
  expect(await skillRowText(tauriPage, RESEARCH_LOOP)).toContain("Built in");
  expect(await skillRowText(tauriPage, PAPER_LOOKUP)).toContain("Built in");

  await tauriPage.click('[aria-label="Close settings"]');
});

test("the slash menu lists skills and fills the composer with the command", async ({
  tauriPage,
}) => {
  test.setTimeout(120_000);
  await openSkillsProject(tauriPage);
  await connect(tauriPage);
  await openChat(tauriPage);

  await fillTextarea(tauriPage, TA, "/");
  await waitLong(
    tauriPage,
    `!!document.querySelector('[id="ai-slash-command-skill:${RESEARCH_LOOP}"]')`,
    30_000,
  );

  const menu = await tauriPage.evaluate<string>(
    `document.querySelector('[role="listbox"][aria-label="Slash commands"]')?.textContent ?? ""`,
  );
  expect(menu).toContain("Skills");
  expect(menu).toContain(RESEARCH_LOOP);

  const selected = await tauriPage.evaluate<boolean>(
    `(() => {
      const option = document.querySelector('[id="ai-slash-command-skill:${RESEARCH_LOOP}"]');
      if (!(option instanceof HTMLElement)) return false;
      option.click();
      return true;
    })()`,
  );
  expect(selected, "the skill option must be clickable").toBe(true);

  await waitLong(
    tauriPage,
    `(document.querySelector(${JSON.stringify(TA)})?.value ?? "").startsWith("/${RESEARCH_LOOP} ")`,
    10_000,
  );
  await fillTextarea(tauriPage, TA, "");
});

test("a slash skill invocation reaches the model and loads the skill", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await openSkillsProject(tauriPage);
  await connect(tauriPage);
  await openChat(tauriPage);

  server.setStreamDelay(0);
  server.setToolCall({
    name: "load_skill",
    args: { id: RESEARCH_LOOP },
    then: "SKILLLOADED75",
  });
  server.resetRequests();

  await ask(tauriPage, `/${RESEARCH_LOOP} plan my paper`);
  await waitForReply(tauriPage, "SKILLLOADED75", 90_000);

  const bodies = server.requestBodies();
  expect(bodies.length, "the harness must take a second turn").toBeGreaterThan(1);

  const system = systemPrompt(bodies[0]);
  expect(system).toContain("<requested_skill");
  expect(system).toContain(RESEARCH_LOOP);
  expect(system).toContain(LOOP_HEADING);
  expect(lastUserMessage(bodies[0])).toContain(
    `Use the skill "${RESEARCH_LOOP}" (${RESEARCH_LOOP}) for this request.`,
  );

  const results = toolResults(bodies[1]);
  expect(results.length, "the load_skill result must reach the model").toBeGreaterThan(0);
  const loaded = results.join("\n");
  expect(loaded).toContain(RESEARCH_LOOP);
  expect(loaded).toContain(LOOP_HEADING);
  expect(loaded, "the skill folder must be named in the tool result").toContain("dir=");
  expect(loaded, "the skill file list must be in the tool result").toContain("<files>");
  expect(loaded, "the usage hints must reach the model").toContain("read_skill_file");

  const card = await toolCardOutput(tauriPage, "load_skill");
  expect(card).toContain(RESEARCH_LOOP);
});

test("read_skill_file returns a supporting file from the skill folder", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await openSkillsProject(tauriPage);
  await connect(tauriPage);
  await openChat(tauriPage);

  server.setStreamDelay(0);
  server.setToolCall({
    name: "read_skill_file",
    args: { id: RESEARCH_LOOP, path: "references/handoffs.md" },
    then: "SKILLFILEREAD75",
  });

  await ask(tauriPage, "Read the handoffs reference for the research loop.");
  await waitForReply(tauriPage, "SKILLFILEREAD75", 90_000);

  const card = await toolCardOutput(tauriPage, "read_skill_file");
  expect(card).toContain("# Handoffs");
  expect(card).toContain("oleafly-literature-sweep");

  server.setToolCall(null);
});

test("a shelf skill installs from the catalog and uninstalls again", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await openSkillsProject(tauriPage);
  await openSkillsSettings(tauriPage);

  await clickWhenEnabled(tauriPage, '[data-testid="skills-catalog-refresh"]', 60_000);
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="skill-shelf-row-${SKILL_FIXTURE_ID}"]')`,
    60_000,
  );

  await clickWhenEnabled(tauriPage, `[data-testid="skill-shelf-install-${SKILL_FIXTURE_ID}"]`);

  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="skill-row-${SKILL_FIXTURE_ID}"]')`,
    90_000,
  );
  expect(await groupOwning(tauriPage, SKILL_FIXTURE_ID)).toBe("skills-phase-shelf");
  expect(await skillRowText(tauriPage, SKILL_FIXTURE_ID)).toContain("Installed");
  expect(await skillRowText(tauriPage, SKILL_FIXTURE_ID)).toContain("Domain shelf");

  await clickWhenEnabled(tauriPage, `[data-testid="skill-shelf-uninstall-${SKILL_FIXTURE_ID}"]`);

  await waitLong(
    tauriPage,
    `!document.querySelector('[data-testid="skill-row-${SKILL_FIXTURE_ID}"]')`,
    60_000,
  );
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="skill-shelf-install-${SKILL_FIXTURE_ID}"]')`,
    30_000,
  );

  await tauriPage.click('[aria-label="Close settings"]');
});

test("a steered message survives reopening the assistant", async ({ tauriPage }) => {
  test.setTimeout(220_000);
  await openSkillsProject(tauriPage);
  await connect(tauriPage);
  await openChat(tauriPage);

  server.setToolCall(null);
  server.setReply("STEERPERSIST75");
  server.setStreamDelay(10_000);

  await ask(tauriPage, "Keep this turn running while I steer it.");
  await waitLong(tauriPage, `!!document.querySelector('[aria-label="Stop"]')`, 20_000);

  const steerText = "Steer this run and remember it";
  await ask(tauriPage, steerText);
  await expect(
    tauriPage.getByText(`Queued for the next turn: ${steerText}`),
  ).toBeVisible({ timeout: 10_000 });

  await waitLong(
    tauriPage,
    `(() => {
      const chip = [...document.querySelectorAll('[data-testid="agent-follow-up-chip"]')]
        .find((element) => element.textContent?.includes(${JSON.stringify(steerText)}));
      const button = chip?.querySelector('[data-testid="agent-follow-up-steer"]');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`,
    20_000,
  );

  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="steered-message-label"]')`,
    40_000,
  );
  server.setStreamDelay(0);
  await waitLong(tauriPage, `!document.querySelector('[aria-label="Stop"]')`, 60_000);

  await closeAssistant(tauriPage);
  await waitLong(tauriPage, `!document.querySelector(${JSON.stringify(TA)})`, 15_000);
  await openRailTab(tauriPage, "Research Assistant");
  await expect(tauriPage.locator(TA)).toBeVisible({ timeout: 15_000 });

  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="steered-message-label"]')`,
    30_000,
  );
  const bubble = await tauriPage.evaluate<boolean>(
    `[...document.querySelectorAll('[data-message-role="user"]')]
      .some((element) => element.textContent?.includes(${JSON.stringify(steerText)}))`,
  );
  expect(bubble, "the steered message must still be in the restored transcript").toBe(true);
});
