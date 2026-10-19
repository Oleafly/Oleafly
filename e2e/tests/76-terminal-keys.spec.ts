import { test, expect } from "../fixtures";
import { openProject, type Page } from "../helpers";

// The bytes the terminal sends for keys that mean something to a shell, and
// output that arrives while a tab is in the background. Keys are synthetic
// keydown/keyup events on xterm's input (the bridge has no native key
// input), so they take the same path as typed keys. A program in the shell
// reads them back: `od` on Linux and macOS, [Console]::ReadKey on Windows.

const TERMINAL = '[data-testid="dock-terminal"]';
const TERMINAL_HOST = '[data-testid="dock-terminal-host"]';
const TERMINAL_INPUT = `${TERMINAL_HOST} .xterm-helper-textarea`;
const TERMINAL_TAB = '[data-testid="dock-terminal-tab"]';
const NEW_TERMINAL = '[data-testid="dock-terminal-tabs"] [aria-label="New terminal"]';
const TERMINAL_TOGGLE = '[data-testid="rail-terminal-toggle"]';
const WINDOWS = process.platform === "win32";
const MAC = process.platform === "darwin";
// Printed with the halves apart, so the typed command line never matches.
const READY = "bytes-ready";
const DONE = "bytes-done";

interface Key {
  key: string;
  code: string;
  keyCode: number;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
}

function terminalTab(index: number): string {
  return `${TERMINAL_TAB}[data-session-index="${index}"]`;
}

async function openTerminalDock(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    window.__e2eTerminalEvents = [];
    return true;
  })()`);
  await openProject(page, "E2E Doc");
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await page.click(TERMINAL_TOGGLE);
  await expect(page.locator(TERMINAL)).toBeVisible();
  await expect(page.locator(TERMINAL_TAB)).toHaveCount(1);
  await expect(page.locator(terminalTab(1))).toHaveAttribute("data-active", "true");
}

async function terminalOutput(page: Page): Promise<string> {
  return page.evaluate<string>(
    `document.querySelector(${JSON.stringify(TERMINAL)})?.getAttribute("data-terminal-output") ?? ""`,
  );
}

async function enterTerminalCommand(page: Page, command: string): Promise<void> {
  await page.evaluate(
    `(() => {
      const input = document.querySelector(${JSON.stringify(TERMINAL_INPUT)});
      if (!(input instanceof HTMLTextAreaElement)) throw new Error("terminal input is unavailable");
      input.focus();
      input.dispatchEvent(new InputEvent("input", {
        data: ${JSON.stringify(command)},
        inputType: "insertText",
        bubbles: true,
        cancelable: true,
      }));
      for (const type of ["keydown", "keyup"]) {
        const event = new KeyboardEvent(type, {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, "keyCode", { value: 13 });
        input.dispatchEvent(event);
      }
      return true;
    })()`,
  );
}

/** keydown then keyup on xterm's input, with keyCode set as xterm reads it. */
async function pressInTerminal(page: Page, key: Key): Promise<void> {
  await page.evaluate(
    `(() => {
      const input = document.querySelector(${JSON.stringify(TERMINAL_INPUT)});
      if (!(input instanceof HTMLTextAreaElement)) throw new Error("terminal input is unavailable");
      input.focus();
      for (const type of ["keydown", "keyup"]) {
        const event = new KeyboardEvent(type, {
          key: ${JSON.stringify(key.key)},
          code: ${JSON.stringify(key.code)},
          shiftKey: ${Boolean(key.shift)},
          ctrlKey: ${Boolean(key.ctrl)},
          altKey: ${Boolean(key.alt)},
          metaKey: ${Boolean(key.meta)},
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, "keyCode", { value: ${key.keyCode} });
        Object.defineProperty(event, "which", { value: ${key.keyCode} });
        input.dispatchEvent(event);
      }
      return true;
    })()`,
  );
}

/** A cold shell on a busy runner can take minutes; nudge with Enter until a prompt paints. */
async function waitForPrompt(page: Page): Promise<void> {
  const tail = async () => (await terminalOutput(page)).trimEnd().slice(-160);
  const promptPattern = /[$#%>❯➜]\s*$/u;
  const deadline = Date.now() + 150_000;
  let prompt = await tail();
  while (!promptPattern.test(prompt) && Date.now() < deadline) {
    await enterTerminalCommand(page, "");
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    prompt = await tail();
  }
  expect(prompt).toMatch(promptPattern);
}

function occurrences(text: string, marker: string): number {
  return text.split(marker).length - 1;
}

/** Prints the next `count` bytes the program reads (Unix) or the next key with its modifiers (Windows). */
function readerCommand(count: number): string {
  if (WINDOWS) {
    return `"bytes-" + "ready"; $k = [Console]::ReadKey($true); "key:$($k.Key)|$($k.Modifiers)"; "bytes-" + "done"`;
  }
  // The ready line prints after raw mode is on, so no key reaches the line
  // discipline (where ^W and ^U would edit the line instead).
  return `stty raw -echo; printf '%s-%s\\r\\n' bytes ready; od -An -tx1 -N ${count}; stty sane; printf '%s-%s\\n' bytes done`;
}

/** Runs the reader, presses the keys once it waits, and returns what it printed, spaces collapsed. */
async function readKeys(page: Page, keys: Key[], count = 1): Promise<string> {
  const before = await terminalOutput(page);
  const ready = occurrences(before, READY);
  const done = occurrences(before, DONE);
  await enterTerminalCommand(page, readerCommand(count));
  await expect
    .poll(async () => occurrences(await terminalOutput(page), READY), { timeout: 30_000 })
    .toBeGreaterThan(ready);
  for (const key of keys) await pressInTerminal(page, key);
  await expect
    .poll(async () => occurrences(await terminalOutput(page), DONE), { timeout: 30_000 })
    .toBeGreaterThan(done);
  const output = await terminalOutput(page);
  const start = output.lastIndexOf(READY) + READY.length;
  const end = output.indexOf(DONE, start);
  return output.slice(start, end < 0 ? undefined : end).replace(/\s+/gu, " ");
}

test("Shift+Enter reaches the program as the newline CLI agents read", async ({ tauriPage }) => {
  test.setTimeout(300_000);
  await openTerminalDock(tauriPage);
  await waitForPrompt(tauriPage);

  // macOS sends ESC CR (Option+Enter); Linux CI's bash gets LF.
  const printed = await readKeys(tauriPage, [{ key: "Enter", code: "Enter", keyCode: 13, shift: true }], MAC ? 2 : 1);

  expect(printed).toMatch(WINDOWS ? /key:Enter\|Alt/u : MAC ? /1b 0d/u : /\b0a\b/u);
});

test("Ctrl+/ reaches the shell as 0x1f", async ({ tauriPage }) => {
  test.skip(WINDOWS, "Windows console input has no key for 0x1f to report.");
  test.setTimeout(300_000);
  await openTerminalDock(tauriPage);
  await waitForPrompt(tauriPage);

  const printed = await readKeys(tauriPage, [{ key: "/", code: "Slash", keyCode: 191, ctrl: true }]);

  expect(printed).toMatch(/\b1f\b/u);
});

test("word keys reach the shell", async ({ tauriPage }) => {
  test.setTimeout(300_000);
  await openTerminalDock(tauriPage);
  await waitForPrompt(tauriPage);
  const left = { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 };

  if (WINDOWS) {
    expect(await readKeys(tauriPage, [{ ...left, alt: true }])).toMatch(/key:LeftArrow\|Control/u);
    return;
  }
  if (MAC) {
    expect(await readKeys(tauriPage, [{ ...left, alt: true }], 2)).toMatch(/1b 62/u);
    expect(await readKeys(tauriPage, [{ ...left, meta: true }])).toMatch(/\b01\b/u);
    return;
  }
  expect(await readKeys(tauriPage, [{ ...left, alt: true }], 6)).toMatch(/1b 5b 31 3b 35 44/u);
  expect(
    await readKeys(tauriPage, [{ key: "Backspace", code: "Backspace", keyCode: 8, ctrl: true }]),
  ).toMatch(/\b17\b/u);
});

test("Ctrl+B goes to the shell, not the sidebar", async ({ tauriPage }) => {
  test.skip(MAC, "On macOS the sidebar shortcut is Cmd+B; Ctrl+B is the shell's either way.");
  test.setTimeout(300_000);
  await openTerminalDock(tauriPage);
  await waitForPrompt(tauriPage);
  const sidebar = () =>
    tauriPage.evaluate<string>(
      `document.querySelector("[data-sidebar-open]")?.getAttribute("data-sidebar-open") ?? "missing"`,
    );
  const before = await sidebar();

  const printed = await readKeys(tauriPage, [{ key: "b", code: "KeyB", keyCode: 66, ctrl: true }]);

  expect(printed).toMatch(WINDOWS ? /key:B\|Control/u : /\b02\b/u);
  expect(await sidebar()).toBe(before);
});

test("output that arrives while a tab is hidden is all there when it comes back", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  await openTerminalDock(tauriPage);
  // The WebView2 regression threw from xterm's renderer ("dimensions") when
  // a hidden pane was measured at zero size.
  await tauriPage.evaluate(`(() => {
    window.__terminalErrors = [];
    window.addEventListener("error", (event) => window.__terminalErrors.push(String(event.message)));
    window.addEventListener("unhandledrejection", (event) => window.__terminalErrors.push(String(event.reason)));
    return true;
  })()`);
  await waitForPrompt(tauriPage);

  await enterTerminalCommand(tauriPage, WINDOWS ? '1..3000 | % { "line-$_" }' : "seq 1 3000");
  await tauriPage.click(NEW_TERMINAL);
  await expect(tauriPage.locator(TERMINAL_TAB)).toHaveCount(2);
  await expect(tauriPage.locator(terminalTab(2))).toHaveAttribute("data-active", "true");
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  await tauriPage.click(terminalTab(1));
  await expect(tauriPage.locator(terminalTab(1))).toHaveAttribute("data-active", "true");

  await expect
    .poll(() => terminalOutput(tauriPage), { timeout: 60_000 })
    .toMatch(WINDOWS ? /(^|\n)line-3000\n/u : /\n3000\n/u);
  expect(await terminalOutput(tauriPage)).toMatch(WINDOWS ? /(^|\n)line-1\n/u : /\n1\n/u);
  const errors = await tauriPage.evaluate<string[]>(`window.__terminalErrors ?? []`);
  expect(errors.filter((message) => message.includes("dimensions"))).toEqual([]);
});
