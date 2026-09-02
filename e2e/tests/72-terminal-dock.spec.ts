import { test, expect } from "../fixtures";
import { openProject, openRailTab, pressGlobal, type Page } from "../helpers";

const TERMINAL = '[data-testid="dock-terminal"]';
const TERMINAL_HOST = '[data-testid="dock-terminal-host"]';
const TERMINAL_TOGGLE = '[data-testid="rail-terminal-toggle"]';
const BROWSER_TOGGLE = '[data-testid="rail-browser-toggle"]';

async function terminalOutput(page: Page): Promise<string> {
  return page.evaluate<string>(
    `document.querySelector(${JSON.stringify(TERMINAL)})?.getAttribute("data-terminal-output") ?? ""`,
  );
}

async function enterTerminalCommand(page: Page, command: string): Promise<void> {
  await page.evaluate(
    `(() => {
      const input = document.querySelector(${JSON.stringify(`${TERMINAL_HOST} .xterm-helper-textarea`)});
      if (!(input instanceof HTMLTextAreaElement)) throw new Error("terminal input is unavailable");
      input.focus();
      input.dispatchEvent(new InputEvent("input", {
        data: ${JSON.stringify(command)},
        inputType: "insertText",
        bubbles: true,
        cancelable: true,
      }));
      const keyDown = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(keyDown, "keyCode", { value: 13 });
      input.dispatchEvent(keyDown);
      const keyUp = new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(keyUp, "keyCode", { value: 13 });
      input.dispatchEvent(keyUp);
      return true;
    })()`,
  );
}

async function triggerDockShortcut(
  page: Page,
  dock: "terminal" | "browser",
): Promise<void> {
  const nativeMenu = await page.evaluate<boolean>(
    `Boolean(window.__TAURI_INTERNALS__) && /Mac|Linux/.test(navigator.platform)`,
  );
  if (nativeMenu) {
    await page.evaluate(
      `window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
        event: ${JSON.stringify(`menu://toggle-${dock}`)},
        payload: null,
      }).then(() => true)`,
    );
    return;
  }
  if (dock === "terminal") {
    await pressGlobal(page, "`", { ctrl: true });
  } else {
    await pressGlobal(page, "b", { ctrl: true, shift: true });
  }
}

test("project docks start closed and their toggles live in the top toolbar", async ({
  tauriPage,
}) => {
  await expect(tauriPage.locator(TERMINAL_TOGGLE)).toHaveCount(0);
  await expect(tauriPage.locator(BROWSER_TOGGLE)).toHaveCount(0);

  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await expect(tauriPage.locator(TERMINAL)).not.toBeVisible();
  await expect(tauriPage.getByTestId("dock-browser")).not.toBeVisible();
  await expect(tauriPage.locator(TERMINAL_TOGGLE)).toBeVisible();
  await expect(tauriPage.locator(BROWSER_TOGGLE)).toBeVisible();

  await openRailTab(tauriPage, "Source Control");
  await expect(
    tauriPage.locator('[data-tour="project-sidebar"] [aria-label="Source Control"]'),
  ).toBeVisible();

  const terminalLabel = await tauriPage.getAttribute(TERMINAL_TOGGLE, "aria-label");
  const browserLabel = await tauriPage.getAttribute(BROWSER_TOGGLE, "aria-label");
  expect(terminalLabel).toMatch(/^Show terminal \(Ctrl(?:\+)?`\)$/u);
  expect(browserLabel).toMatch(/^Open browser \(Ctrl(?:\+Shift\+|⇧)B\)$/u);
});

test("the real terminal opens, echoes, and exits cleanly", async ({
  tauriPage,
}) => {
  // The prompt nudge alone may take 150s on a cold Windows runner, and the
  // echo and exit phases follow it.
  test.setTimeout(300_000);
  await tauriPage.evaluate(`(() => {
    window.__e2eTerminalEvents = [];
    return true;
  })()`);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  const sessionOpenState = () =>
    tauriPage.evaluate<string>(`(window.__e2eTerminalEvents ?? [])
      .filter((entry) => entry.startsWith("open:"))
      .join(",") || "none"`);
  await expect(tauriPage.locator(TERMINAL)).not.toBeVisible();
  await expect.poll(sessionOpenState, { timeout: 60_000 }).toMatch(/^open:ok:/u);
  await expect(tauriPage.locator(`${TERMINAL_HOST} .xterm-helper-textarea`)).toHaveCount(1);
  await tauriPage.click(TERMINAL_TOGGLE);
  await expect(tauriPage.locator(TERMINAL)).toBeVisible();
  await expect(tauriPage.getByTestId("dock-terminal-loading")).toHaveCount(0);
  // Return the channel breadcrumbs plus the buffer tail so a failure names
  // the stage that broke: open error, no output at all, or a promptless
  // shell. The tail stays last so the end anchor still matches the prompt.
  // A cold Windows shell start on a busy CI runner can take minutes, so keep
  // nudging with Enter until a prompt paints.
  const promptState = () =>
    tauriPage.evaluate<string>(`(() => {
      const events = (window.__e2eTerminalEvents ?? []).join(",");
      const host = document.querySelector('[data-terminal-output]');
      const tail = (host?.dataset.terminalOutput ?? "").trimEnd().slice(-160);
      return "events[" + events + "] tail:" + tail;
    })()`);
  const promptPattern = /[$#%>❯➜]\s*$/u;
  const promptDeadline = Date.now() + 150_000;
  let prompt = await promptState();
  while (!promptPattern.test(prompt) && Date.now() < promptDeadline) {
    await enterTerminalCommand(tauriPage, "");
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    prompt = await promptState();
  }
  expect(prompt).toMatch(promptPattern);

  await enterTerminalCommand(tauriPage, "echo e2e-terminal-ok");
  await expect
    .poll(
      async () => (await terminalOutput(tauriPage)).split("e2e-terminal-ok").length - 1,
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(2);

  await enterTerminalCommand(tauriPage, "echo still-alive");
  await expect
    .poll(
      async () => (await terminalOutput(tauriPage)).split("still-alive").length - 1,
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(2);
  expect(await terminalOutput(tauriPage)).toContain("e2e-terminal-ok");

  await enterTerminalCommand(tauriPage, "exit");
  // Asserting the exit event separately splits IPC-delivery failures from
  // dock-close failures.
  await expect
    .poll(
      () =>
        tauriPage.evaluate<string>(
          `(window.__e2eTerminalEvents ?? [])
            .filter((entry) => entry.startsWith("exit"))
            .join(",") || "none"`,
        ),
      { timeout: 15_000 },
    )
    .not.toBe("none");
  await expect(tauriPage.locator(TERMINAL)).not.toBeVisible({ timeout: 15_000 });
  await expect(tauriPage.locator(`${TERMINAL_HOST} .xterm`)).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(tauriPage.locator(TERMINAL_TOGGLE)).toHaveAttribute("aria-pressed", "false");
  const output = await terminalOutput(tauriPage);
  expect(output).not.toContain("The shell could not start");
  expect(output).not.toContain("The shell could not accept input");
  expect(output).not.toContain("The terminal could not resize");
});

test("configured terminal and browser shortcut routes toggle their docks", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await triggerDockShortcut(tauriPage, "terminal");
  await expect(tauriPage.locator(TERMINAL)).toBeVisible({ timeout: 10_000 });
  await triggerDockShortcut(tauriPage, "terminal");
  await expect(tauriPage.locator(TERMINAL)).not.toBeVisible({ timeout: 10_000 });

  // The browser shortcut launches a separate window (no dock), so it is a
  // safe no-op here; assert only that it does not throw or open a dock.
  await triggerDockShortcut(tauriPage, "browser");
  await expect(tauriPage.getByTestId("dock-browser")).not.toBeVisible();
});

test.skip(
  "native Ctrl dock accelerator keystrokes cannot be synthesized through the app bridge",
  async () => {},
);
