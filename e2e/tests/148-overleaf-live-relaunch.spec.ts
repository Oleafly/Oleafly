import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { openSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "node:net";
import { test, expect, releaseBridge } from "../fixtures";
import { appLogPath } from "../ui-crash-guard";
import {
  openProject,
  readProjectText,
  typeAtCaret,
  typeInEditorAfter,
  waitEditorShowsFile,
  waitLong,
  type Page,
} from "../helpers";
import { importOverleafProjectLive, leaveOverleafLive, OverleafStack, overleafLiveState } from "../overleaf-stack";

const STACK = process.env.OLEAFLY_E2E_OVERLEAF_STACK ?? "";
const APP = process.env.OLEAFLY_E2E_APP_BINARY ?? "";
const PROJECT = "E2E Live";
const MAIN = "main.tex";
const ONLINE = "SENT-WHILE-ONLINE";
const OFFLINE = "TYPED-WHILE-OFFLINE";
const BOOT_SEED = JSON.stringify({
  "oleafly.tours": JSON.stringify({ state: { schemaVersion: 1, enabled: false, tours: {} }, version: 1 }),
  "oleafly.overleafLive": "1",
});

// Ignored on purpose outside CI without the mock server and a packaged app, because the test kills the app and starts the same binary again.
test.skip(
  !process.env.CI && (!STACK || !APP),
  "Needs OLEAFLY_E2E_OVERLEAF_STACK, the mock Overleaf server built with `cargo build -p oleafly-online --features test-support --example e2e_overleaf`, and OLEAFLY_E2E_APP_BINARY, a packaged app built with the e2e-testing feature.",
);
test.describe.configure({ mode: "serial", retries: 0 });

let stack: OverleafStack;
let relaunched: ChildProcess | null = null;

test.beforeAll(async () => {
  if (!STACK || !APP) throw new Error(`CI must set OLEAFLY_E2E_OVERLEAF_STACK (${STACK || "unset"}) and OLEAFLY_E2E_APP_BINARY (${APP || "unset"})`);
  stack = new OverleafStack(STACK);
  await stack.ready;
});

test.afterAll(async () => {
  stack?.stop();
  const app = relaunched;
  if (!app?.pid || app.exitCode !== null) return;
  killTree(app.pid);
  await exited(app.pid, 15_000).catch(() => app.kill("SIGKILL"));
});

function run(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout: 10_000 });
  } catch (error) {
    return `(${command} failed: ${String(error)})`;
  }
}

function processReport(): string {
  if (process.platform !== "win32") {
    return run("ps", ["-ax", "-o", "pid,ppid,stat,comm"])
      .split("\n")
      .filter((line) => /oleafly|WebKit|WebContent/i.test(line))
      .join("\n");
  }
  const ports = run("netstat", ["-ano", "-p", "TCP"])
    .split("\n")
    .filter((line) => line.includes(":6274"))
    .join("\n");
  return `${run("tasklist", ["/FI", "IMAGENAME eq oleafly.exe"])}\n${run("tasklist", ["/FI", "IMAGENAME eq msedgewebview2.exe"])}\n--- port 6274 ---\n${ports}`;
}

function killTree(pid: number) {
  if (process.platform === "win32") {
    console.log(`e2e: ${run("taskkill", ["/F", "/T", "/PID", String(pid)]).trim()}`);
  } else {
    process.kill(pid, "SIGKILL");
  }
}

function bridgeAnswers(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket =
      process.platform === "win32"
        ? connect(Number(process.env.TAURI_PLAYWRIGHT_TCP_PORT ?? 6274), "127.0.0.1")
        : connect(process.env.TAURI_PLAYWRIGHT_SOCKET ?? "/tmp/tauri-playwright.sock");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function journalHas(marker: string): boolean {
  const root = join(process.env.OLEAFLY_DATA_DIR ?? "", "overleaf-live");
  let names: string[];
  try {
    names = readdirSync(root, { recursive: true, encoding: "utf8" });
  } catch {
    return false;
  }
  return names.some((name) => {
    try {
      return readFileSync(join(root, name), "utf8").includes(marker);
    } catch {
      return false;
    }
  });
}

function tail(path: string): string {
  try {
    return readFileSync(path, "utf8").split("\n").slice(-40).join("\n");
  } catch (error) {
    return `(no ${path}: ${String(error)})`;
  }
}

async function bridgeDown(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (await bridgeAnswers()) {
    if (Date.now() > deadline) throw new Error(`the killed app's test bridge still answers\n${processReport()}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function bridgeUp(app: ChildProcess, output: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (!(await bridgeAnswers())) {
    if (Date.now() > deadline || app.exitCode !== null) {
      throw new Error(
        `the relaunched app never opened its test bridge (pid ${app.pid}, exit ${app.exitCode}, signal ${app.signalCode})\n--- its output ---\n${tail(output)}\n--- app.log ---\n${tail(appLogPath())}\n--- mock server ---\n${stack.log.slice(-20).join("\n")}\n--- processes ---\n${processReport()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function occurrences(text: string, marker: string): number {
  return text.split(marker).length - 1;
}

function serverTextShows(marker: string, timeoutMs: number): Promise<string> {
  return stack.textShows(MAIN, marker, timeoutMs);
}

async function appProcessId(page: Page): Promise<number> {
  const launch = await page.evaluate<string | null>(`localStorage.getItem("oleafly.e2e.launch")`);
  const pid = Number(launch?.split("-")[0]);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`no launch id in the page: ${launch}`);
  return pid;
}

async function exited(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    if (Date.now() > deadline) throw new Error(`the app ${pid} is still running`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test("text typed while Overleaf is unreachable survives the app being killed", async ({ tauriPage: page }) => {
  test.setTimeout(240_000);
  await importOverleafProjectLive(page, await stack.ready, MAIN);

  await typeInEditorAfter(page, "Hello", ` ${ONLINE}`);
  await serverTextShows(ONLINE, 30_000);

  await stack.request({ cmd: "crash" });
  await overleafLiveState(page, ["offline", "reconnecting"], 30_000);
  await typeAtCaret(page, ` ${OFFLINE}`);
  await waitLong(page, `document.querySelector('[data-testid="overleaf-live-button"]')?.dataset.syncState === "offline"`, 30_000);
  const deadline = Date.now() + 30_000;
  while (!journalHas(OFFLINE)) {
    if (Date.now() > deadline) throw new Error(`the unsent journal never got ${OFFLINE}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  while (!(await readProjectText(page, MAIN)).includes(OFFLINE)) {
    if (Date.now() > deadline) throw new Error(`${MAIN} on disk never got ${OFFLINE} while the server was down`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  expect(occurrences(await stack.text(MAIN), OFFLINE)).toBe(0);

  const pid = await appProcessId(page);
  releaseBridge(page);
  killTree(pid);
  await exited(pid, 15_000);
  await bridgeDown(15_000);
  await stack.request({ cmd: "recover" });
  const output = test.info().outputPath("relaunched-app.log");
  const descriptor = openSync(output, "a");
  relaunched = spawn(APP, [], {
    env: { ...process.env, OLEAFLY_E2E_BOOT_LOCALSTORAGE: BOOT_SEED },
    stdio: ["ignore", descriptor, descriptor],
    detached: process.platform !== "win32",
  });
  console.log(`e2e: killed the app (pid ${pid}) and started it again (pid ${relaunched.pid})`);
  await bridgeUp(relaunched, output, 120_000);
});

test("after a relaunch Overleaf gets every change exactly once", async ({ tauriPage: page }) => {
  test.setTimeout(180_000);
  await openProject(page, PROJECT);
  await waitEditorShowsFile(page, MAIN, 45_000);
  const text = await serverTextShows(OFFLINE, 90_000).catch(async (error: unknown) => {
    const shown = await page.evaluate<string>(
      `JSON.stringify({ sync: document.querySelector('[data-testid="overleaf-live-button"]')?.dataset.syncState ?? null, live: localStorage.getItem("oleafly.overleafLive"), server: localStorage.getItem("oleafly.overleaf.server"), banners: [...document.querySelectorAll('[role="alert"], [role="status"], output')].map((node) => node.textContent?.trim()).filter(Boolean).slice(0, 8) })`,
    );
    throw new Error(`${String(error)}\n--- the relaunched app shows ---\n${shown}\n--- mock server ---\n${stack.log.slice(-20).join("\n")}`);
  });
  await overleafLiveState(page, ["upToDate"], 60_000);
  expect(occurrences(text, ONLINE)).toBe(1);
  expect(occurrences(text, OFFLINE)).toBe(1);
  expect(await stack.text(MAIN)).toBe(await readProjectText(page, MAIN));
  await leaveOverleafLive(page);
});
