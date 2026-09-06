import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TauriPage } from "@srsholmes/tauri-playwright";
import type { AcpDefinition, AcpEventPage, AcpSession, AcpSnapshot } from "../../src/lib/acp";
import type { UsageReport } from "../../src/lib/usage-report";
import { test, expect, reloadNativePage } from "../fixtures";
import { createBlankProject, fillTextarea, openProject, openRailTab, type Page } from "../helpers";

const assistantSelector = 'section[aria-label="CLI agent assistant"]';
const composerSelector = 'textarea[aria-label="Message CLI agent"]';
const fixturePath = fileURLToPath(new URL("../fixtures/acp-agent.mjs", import.meta.url));

type AgentFixture = {
  agentId: string;
  projectId: string;
  projectName: string;
  pidFile: string;
  run: string;
};

function acpCall(method: string, ...args: unknown[]) {
  return `import("/src/lib/acp.ts").then((acp) => acp[${JSON.stringify(method)}](${args.map((arg) => JSON.stringify(arg)).join(",")}))`;
}

async function openAppOverlay(page: Page, testId: string, label: string) {
  const trigger = `[data-testid=${JSON.stringify(testId)}]`;
  try {
    await page.waitForFunction(`(() => {
      const control = document.querySelector(${JSON.stringify(trigger)});
      return !!control && !control.disabled;
    })()`, 20_000);
  } catch (error) {
    const diagnostic = await page.evaluate(`(() => {
      const control = document.querySelector(${JSON.stringify(trigger)});
      return { present: !!control, disabled: control?.disabled ?? null, shown: control?.textContent ?? null };
    })()`).catch((failure: unknown) => ({ unavailable: String(failure) }));
    console.error("ACP picker timeout", JSON.stringify({ testId, label, diagnostic }));
    throw error;
  }
  await page.evaluate(`(() => {
    const control = document.querySelector(${JSON.stringify(trigger)});
    control.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
    return true;
  })()`);
}

async function pickOverlayEntry(page: Page, role: string, container: string, label: string) {
  const match = `[...document.querySelectorAll('[role="${role}"]')].find((entry) => (entry.textContent ?? "").trim().startsWith(${JSON.stringify(label)}))`;
  try {
    await page.waitForFunction(`!!(${match})`, 20_000);
  } catch (error) {
    const diagnostic = await page.evaluate(`(() => {
      const entries = [...document.querySelectorAll('[role="${role}"]')].map((entry) => (entry.textContent ?? "").trim().slice(0, 120));
      const containers = [...document.querySelectorAll('[role="${container}"]')].length;
      const triggers = [...document.querySelectorAll('[data-testid$="-picker"]')].map((entry) => ({
        id: entry.getAttribute("data-testid"), state: entry.getAttribute("data-state"), expanded: entry.getAttribute("aria-expanded"), disabled: entry.disabled ?? null,
      }));
      return { entries, containers, triggers };
    })()`).catch((failure: unknown) => ({ unavailable: String(failure) }));
    console.error("ACP overlay entry timeout", JSON.stringify({ role, container, label, diagnostic }));
    throw error;
  }
  await page.evaluate(`(() => {
    (${match}).dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    return true;
  })()`);
  await page.waitForFunction(`!document.querySelector('[role="${container}"]')`, 20_000);
}

async function selectAppOption(page: Page, testId: string, label: string) {
  await openAppOverlay(page, testId, label);
  await pickOverlayEntry(page, "option", "listbox", label);
}

async function selectAppMenuItemByValue(page: Page, testId: string, value: string) {
  await openAppOverlay(page, testId, value);
  const selector = `[role="menuitem"][data-value=${JSON.stringify(value)}]`;
  await page.waitForFunction(`!!document.querySelector(${JSON.stringify(selector)})`, 20_000);
  await page.evaluate(`(() => {
    document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    return true;
  })()`);
  await page.waitForFunction(`!document.querySelector('[role="menu"]')`, 20_000);
}

async function clickHeaderAction(page: Page, label: string) {
  const selector = `button[aria-label=${JSON.stringify(label)}]`;
  await page.waitForFunction(`(() => {
    const control = document.querySelector(${JSON.stringify(selector)});
    return !!control && !control.disabled;
  })()`, 20_000);
  await page.click(selector);
}

async function openAcp(page: Page) {
  await openRailTab(page, "Research Assistant");
  await page.getByText("CLI agents", { exact: true }).click();
  await expect(page.locator(assistantSelector)).toBeVisible({ timeout: 20_000 });
}

function fixturePids(pidFile: string): number[] {
  try {
    const value = JSON.parse(readFileSync(pidFile, "utf8")) as { parentPid?: number; childPid?: number };
    return [value.parentPid, value.childPid].filter((pid): pid is number => typeof pid === "number" && pid > 0);
  } catch {
    return [];
  }
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitHost(predicate: () => boolean, description: string) {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(description);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function withAgent(page: Page, login: boolean, work: (fixture: AgentFixture) => Promise<void>) {
  const run = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const directory = mkdtempSync(join(tmpdir(), "oleafly-acp-e2e-"));
  const fixture: AgentFixture = {
    agentId: `e2e-acp-${run}`,
    projectId: "",
    projectName: `ACP workspace ${run}`,
    pidFile: join(directory, "pids.json"),
    run,
  };
  const definition: AcpDefinition = {
    id: fixture.agentId,
    name: `E2E ACP ${run}`,
    version: "1.0.0",
    description: "Local ACP protocol fixture",
    builtin: false,
    distribution: {
      command: {
        executable: process.execPath,
        args: [fixturePath, "--pid-file", fixture.pidFile, "--state-file", join(directory, "state.json"), ...(login ? ["--require-login"] : [])],
      },
    },
  };
  try {
    const hasBack = await page.evaluate<boolean>(`!!document.querySelector('[title="Back to library"]')`);
    if (hasBack) await page.click('[title="Back to library"]');
    await createBlankProject(page, fixture.projectName);
    fixture.projectId = await page.evaluate<string>(`document.querySelector('[data-e2e-project-id]')?.getAttribute('data-e2e-project-id') ?? ''`);
    expect(fixture.projectId).not.toBe("");
    await openAcp(page);
    const assistant = page.locator(assistantSelector);
    await page.evaluate(acpCall("acpRegister", JSON.stringify(definition)));
    await selectAppOption(page, "acp-agent-picker", definition.name);
    await clickHeaderAction(page, "New conversation");
    await expect(assistant).toContainText(`${fixture.agentId} · ${login ? "auth required" : "ready"}`, { timeout: 30_000 });
    await work(fixture);
  } finally {
    try {
      if (fixture.projectId) {
        await page.evaluate(`import("/src/lib/acp.ts").then(async (acp) => {
          const sessions = await acp.acpSessions(${JSON.stringify(fixture.projectId)});
          for (const session of sessions.filter((value) => value.agentId === ${JSON.stringify(fixture.agentId)})) {
            await acp.acpDisconnect(${JSON.stringify(fixture.projectId)}, session.id).catch(() => {});
          }
          await acp.acpRemoveAgent(${JSON.stringify(fixture.agentId)});
          return true;
        })`);
      }
    } finally {
      for (const pid of fixturePids(fixture.pidFile).reverse()) {
        if (processAlive(pid)) {
          try { process.kill(pid, "SIGKILL"); } catch {}
        }
      }
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

async function onlySession(page: Page, fixture: AgentFixture) {
  const sessions = await page.evaluate<AcpSession[]>(acpCall("acpSessions", fixture.projectId));
  const matches = sessions.filter((session) => session.agentId === fixture.agentId);
  expect(matches).toHaveLength(1);
  return matches[0];
}

async function sendPrompt(page: Page, prompt: string) {
  await expect(page.locator(composerSelector)).toBeEnabled({ timeout: 20_000 });
  await fillTextarea(page, composerSelector, prompt);
  await page.click('button[aria-label="Send"]');
}

async function usageReport(page: Page, fixture: AgentFixture, sessionId: string, count = 1) {
  const filter = {
    startMs: Date.now() - 3_600_000,
    endMs: Date.now() + 3_600_000,
    projectIds: [fixture.projectId],
    runtimeIds: ["acp"],
    providerIds: [],
    modelIds: [],
    sessionIds: [sessionId],
    page: 0,
    pageSize: 25,
  };
  const query = `window.__TAURI_INTERNALS__.invoke("usage_report_query", { filter: ${JSON.stringify(filter)} })`;
  await page.waitForFunction(`${query}.then((report) => report.totals.recordCount === ${count} && report.sessions.items.every((session) => session.status !== "in_progress"))`, 30_000);
  return page.evaluate<UsageReport>(query);
}

test("a custom ACP agent signs in, selects its model, and resolves a native permission", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  await withAgent(tauriPage, true, async (fixture) => {
    const assistant = tauriPage.locator(assistantSelector);
    const session = await onlySession(tauriPage, fixture);
    expect(session.status).toBe("auth_required");
    await expect(tauriPage.locator(composerSelector)).toBeDisabled();
    await assistant.getByText("Sign in to E2E agent", { exact: true }).click();
    await expect(tauriPage.locator(composerSelector)).toBeEnabled({ timeout: 20_000 });
    await selectAppOption(tauriPage, "acp-model-picker", "E2E model B");
    await tauriPage.waitForFunction(`${acpCall("acpSnapshot", fixture.projectId, session.id)}.then((snapshot) => snapshot.session.controls.modelId === "e2e-model-b")`, 20_000);

    const prompt = `permission ${fixture.run}`;
    await sendPrompt(tauriPage, prompt);
    const permission = assistant.locator('fieldset[aria-label="Agent permission"]');
    await expect(permission).toContainText("Review the E2E manuscript", { timeout: 20_000 });
    const pending = await tauriPage.evaluate<AcpSnapshot>(acpCall("acpSnapshot", fixture.projectId, session.id));
    expect(pending.permissions).toHaveLength(1);
    expect(pending.session.status).toBe("running");
    await permission.getByText("Allow once", { exact: true }).click();
    await expect(assistant).toContainText(`ACP fixture approved: ${prompt}`, { timeout: 20_000 });
    await expect(permission).toHaveCount(0);
    await expect(tauriPage.locator(composerSelector)).toBeEnabled({ timeout: 20_000 });
    await tauriPage.evaluate(`(() => {
      const groups = document.querySelectorAll('${assistantSelector} [data-testid="worked-steps-toggle"][aria-expanded="false"]');
      groups.forEach((button) => button.click());
      return groups.length;
    })()`);
    await expect(assistant).toContainText("Read E2E evidence");
    const reasoning = assistant.locator('[data-reasoning-block][data-reasoning-status="completed"]');
    await reasoning.locator("button").click();
    await expect(reasoning).toContainText("Checking local E2E evidence.");

    const { events } = await tauriPage.evaluate<AcpEventPage>(acpCall("acpEvents", fixture.projectId, session.id));
    expect(events.some((event) => event.kind === "permission_resolved" && event.data.optionId === "allow-once")).toBe(true);
    expect(events.some((event) => event.kind === "tool_call_update" && event.data.status === "completed")).toBe(true);
    expect(events.filter((event) => event.kind === "turn_complete")).toHaveLength(1);
    const report = await usageReport(tauriPage, fixture, session.id);
    expect(report.totals.inputTotal).toBe(11);
    expect(report.totals.outputTotal).toBe(7);
    expect(report.totals.cacheReadTotal).toBe(3);
    expect(report.totals.cacheWriteTotal).toBe(2);
    expect(report.totals.inputUnknownRecords).toBe(0);
    expect(report.sessions.items[0].modelId).toBe("e2e-model-b");
    expect(report.sessions.items[0].status).toBe("completed");
  });
});

test("ACP history survives reload and reconnect without inventing token usage", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await withAgent(tauriPage, false, async (fixture) => {
    const session = await onlySession(tauriPage, fixture);
    const prompt = `unknown ${fixture.run}`;
    const reply = `ACP fixture answer: ${prompt}`;
    await sendPrompt(tauriPage, prompt);
    await expect(tauriPage.locator(assistantSelector)).toContainText(reply, { timeout: 20_000 });
    const report = await usageReport(tauriPage, fixture, session.id);
    expect(report.totals.inputKnownRecords).toBe(0);
    expect(report.totals.inputUnknownRecords).toBe(1);
    expect(report.totals.outputUnknownRecords).toBe(1);
    expect(report.sessions.items[0].inputTotal).toBeNull();
    expect(report.sessions.items[0].outputTotal).toBeNull();
    expect(report.sessions.items[0].measurement).toBe("mixed_or_unavailable");

    await tauriPage.evaluate(acpCall("acpDisconnect", fixture.projectId, session.id));
    await reloadNativePage(tauriPage as TauriPage);
    await openProject(tauriPage, fixture.projectName);
    await openAcp(tauriPage);
    await selectAppMenuItemByValue(tauriPage, "acp-history-picker", session.id);
    const assistant = tauriPage.locator(assistantSelector);
    await expect(assistant).toContainText(reply, { timeout: 20_000 });
    await assistant.getByText("Reconnect to conversation", { exact: true }).click();
    await expect(tauriPage.locator(composerSelector)).toBeEnabled({ timeout: 20_000 });
    const reopened = await tauriPage.evaluate<AcpSnapshot>(acpCall("acpSnapshot", fixture.projectId, session.id));
    expect(reopened.session.nativeSessionId).toBe(session.nativeSessionId);
    const { events } = await tauriPage.evaluate<AcpEventPage>(acpCall("acpEvents", fixture.projectId, session.id));
    expect(events.filter((event) => event.kind === "user_message")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "agent_message_chunk")).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("ACP replay sentinel");
    await expect(assistant.getByText("ACP replay sentinel", { exact: true })).toHaveCount(0);

    await sendPrompt(tauriPage, `follow-up ${fixture.run}`);
    await expect(assistant).toContainText(`ACP fixture answer: follow-up ${fixture.run}`, { timeout: 20_000 });
    const afterFollowup = await usageReport(tauriPage, fixture, session.id, 2);
    expect(afterFollowup.totals.inputKnownRecords).toBe(1);
    expect(afterFollowup.totals.inputUnknownRecords).toBe(1);
  });
});

test("Stop reaps the child process of an agent that ignores cancellation", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await withAgent(tauriPage, false, async (fixture) => {
    const session = await onlySession(tauriPage, fixture);
    const assistant = tauriPage.locator(assistantSelector);
    await sendPrompt(tauriPage, `wait-ignore-cancel ${fixture.run}`);
    await expect(assistant).toContainText("ACP fixture waiting for cancellation.", { timeout: 20_000 });
    await waitHost(() => fixturePids(fixture.pidFile).length === 2, "the fixture did not start its child process");
    const pids = fixturePids(fixture.pidFile);
    expect(pids.every(processAlive)).toBe(true);
    await tauriPage.click('button[aria-label="Stop"]');
    await expect(assistant).toContainText(`${fixture.agentId} · cancelled`, { timeout: 60_000 });
    await waitHost(() => pids.every((pid) => !processAlive(pid)), "Stop left an ACP fixture process running");
    const stopped = await tauriPage.evaluate<AcpSnapshot>(acpCall("acpSnapshot", fixture.projectId, session.id));
    expect(stopped.session.status).toBe("cancelled");
    expect(stopped.permissions).toHaveLength(0);
    await expect(assistant.getByText("Reconnect to conversation", { exact: true })).toBeEnabled();
    const report = await usageReport(tauriPage, fixture, session.id);
    expect(report.sessions.items[0].status).toBe("cancelled");
    expect(report.totals.inputUnknownRecords).toBe(1);
  });
});

test("Stop ends the turn and leaves a compliant agent connected", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  await withAgent(tauriPage, false, async (fixture) => {
    const session = await onlySession(tauriPage, fixture);
    const assistant = tauriPage.locator(assistantSelector);
    await sendPrompt(tauriPage, `wait ${fixture.run}`);
    await expect(assistant).toContainText("ACP fixture waiting for cancellation.", { timeout: 20_000 });
    await waitHost(() => fixturePids(fixture.pidFile).length === 2, "the fixture did not start its child process");
    await tauriPage.click('button[aria-label="Stop"]');
    await expect(assistant).toContainText(`${fixture.agentId} · ready`, { timeout: 30_000 });
    await expect(tauriPage.locator(composerSelector)).toBeEnabled({ timeout: 20_000 });
    await expect(assistant.getByText("Reconnect to conversation", { exact: true })).toHaveCount(0);
    const stopped = await tauriPage.evaluate<AcpSnapshot>(acpCall("acpSnapshot", fixture.projectId, session.id));
    expect(stopped.session.status).toBe("ready");
    await sendPrompt(tauriPage, `after stop ${fixture.run}`);
    await expect(assistant).toContainText(`ACP fixture answer: after stop ${fixture.run}`, { timeout: 20_000 });
  });
});

test("Agent setup opens the CLI agents tab in settings", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  await withAgent(tauriPage, false, async (fixture) => {
    await clickHeaderAction(tauriPage, "Agent setup");
    await expect(tauriPage.locator('[data-testid="ai-settings-tab-agents"]')).toBeVisible({ timeout: 20_000 });
    await expect(tauriPage.locator(`[data-testid="acp-agent-card-${fixture.agentId}"]`)).toBeVisible({ timeout: 20_000 });
    await tauriPage.press("body", "Escape");
  });
});
