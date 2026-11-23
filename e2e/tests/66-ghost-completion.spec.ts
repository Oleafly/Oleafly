import { test, expect } from "../fixtures";
import {
  createBlankProject,
  editorSource,
  openProject,
  openSettings,
  replaceEditorSource,
  waitLong,
  type Page,
} from "../helpers";
import { startMockAiServer, type MockAiServer } from "../mock-ai-server";

const PROJECT = "Ghost Completion";
const GHOST = ".cm-ghostCompletion";

async function openGhostProject(page: Page) {
  await waitLong(
    page,
    `!!document.querySelector('[data-testid="library"][data-projects-loaded="true"]')`,
    30_000,
  );
  const exists = await page.evaluate<boolean>(
    `import("/src/store/files.ts").then((m) =>
      m.useFilesStore.getState().projects.some((p) => p.name === ${JSON.stringify(PROJECT)}))`,
  );
  if (exists) {
    await openProject(page, PROJECT);
  } else {
    await createBlankProject(page, PROJECT);
  }
  await waitLong(page, `!!document.querySelector('.cm-content')`, 30_000);
}

async function setSwitch(page: Page, selector: string, on: boolean) {
  await waitLong(page, `!!document.querySelector('${selector}')`, 10_000);
  const already = await page.evaluate<boolean>(
    `document.querySelector('${selector}')?.getAttribute("aria-checked") === "true"`,
  );
  if (already !== on) {
    await page.click(selector);
    await waitLong(
      page,
      `document.querySelector('${selector}')?.getAttribute("aria-checked") === "${on}"`,
      10_000,
    );
  }
  await page.click('[data-testid="settings-close"]');
  await waitLong(page, `!!document.querySelector('.cm-content')`, 10_000);
}

async function toggleSetting(page: Page, label: string, on: boolean) {
  await openSettings(page, "appearance");
  await page.press('[data-testid="appearance-tab-editor"]', "Enter");
  await waitLong(
    page,
    `document.querySelector('[data-testid="appearance-tab-editor"]')?.getAttribute("data-state") === "active"`,
    10_000,
  );
  await setSwitch(page, `[role="switch"][aria-label="${label}"]`, on);
}

async function toggleAiCompletions(page: Page, on: boolean) {
  await openSettings(page, "experimentation");
  await setSwitch(page, '[data-testid="settings-ai-completion"]', on);
}

// One character per input event, the only path CodeMirror's input handling
// observes.
async function typeAtCaret(page: Page, text: string) {
  for (const character of text) {
    const ok = await page.evaluate<boolean>(
      `(() => {
        const content = document.querySelector('.cm-content');
        if (!content) return false;
        content.focus();
        return document.execCommand('insertText', false, ${JSON.stringify(character)});
      })()`,
    );
    if (!ok) throw new Error(`typeAtCaret: editor rejected ${character}`);
  }
}

async function caretToEnd(page: Page) {
  await page.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
      return 1;
    })`,
  );
}

async function ghostText(page: Page): Promise<string> {
  return page.evaluate<string>(
    `document.querySelector('${GHOST}')?.textContent ?? ""`,
  );
}

async function pressTab(page: Page) {
  await page.evaluate(
    `(() => {
      const content = document.querySelector('.cm-content');
      content.focus();
      content.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Tab', code: 'Tab', bubbles: true, cancelable: true,
      }));
      return 1;
    })()`,
  );
}

async function settle(page: Page, ms: number) {
  await page.evaluate(
    `new Promise((resolve) => setTimeout(() => resolve(1), ${ms}))`,
  );
}

async function startDocument(page: Page) {
  await replaceEditorSource(
    page,
    "\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n",
  );
  await page.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      const marker = "\\\\begin{document}";
      const at = view.state.doc.toString().indexOf(marker) + marker.length + 1;
      view.dispatch({ selection: { anchor: at } });
      view.focus();
      return 1;
    })`,
  );
}

test("a dim suggestion appears while typing a command", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openGhostProject(tauriPage);
  await toggleSetting(tauriPage, "Inline suggestion", true);
  await startDocument(tauriPage);

  await typeAtCaret(tauriPage, "\\alph");
  await waitLong(tauriPage, `!!document.querySelector('${GHOST}')`, 15_000);
  const suggestion = await ghostText(tauriPage);
  expect(suggestion.length).toBeGreaterThan(0);
  expect(suggestion.startsWith("\\")).toBe(false);
  expect(`\\alph${suggestion}`.startsWith("\\alph")).toBe(true);
});

test("Tab accepts the suggestion into the document", async ({ tauriPage }) => {
  test.setTimeout(240_000);
  await openGhostProject(tauriPage);
  await toggleSetting(tauriPage, "Inline suggestion", true);
  await startDocument(tauriPage);

  await typeAtCaret(tauriPage, "\\alph");
  await waitLong(tauriPage, `!!document.querySelector('${GHOST}')`, 15_000);
  const suggestion = await ghostText(tauriPage);
  await pressTab(tauriPage);

  await expect
    .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
    .toContain(`\\alph${suggestion}`);
  expect(await ghostText(tauriPage)).toBe("");
});

test("Escape dismisses the suggestion and leaves the text alone", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openGhostProject(tauriPage);
  await toggleSetting(tauriPage, "Inline suggestion", true);
  await startDocument(tauriPage);

  await typeAtCaret(tauriPage, "\\alph");
  await waitLong(tauriPage, `!!document.querySelector('${GHOST}')`, 15_000);
  await tauriPage.evaluate(
    `(() => {
      const content = document.querySelector('.cm-content');
      content.focus();
      content.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
      }));
      return 1;
    })()`,
  );
  await waitLong(tauriPage, `!document.querySelector('${GHOST}')`, 10_000);
  expect(await editorSource(tauriPage)).toContain("\\alph");
  expect(await editorSource(tauriPage)).not.toContain("\\alpha ");
});

test("no suggestion appears when the preference is off", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openGhostProject(tauriPage);
  await toggleSetting(tauriPage, "Inline suggestion", false);
  await startDocument(tauriPage);

  await typeAtCaret(tauriPage, "\\alph");
  await settle(tauriPage, 3_000);
  expect(await ghostText(tauriPage)).toBe("");

  const before = await editorSource(tauriPage);
  await pressTab(tauriPage);
  await settle(tauriPage, 500);
  expect(await editorSource(tauriPage)).not.toBe(`${before}alpha`);
});

test("the preference persists and stays out of the way of plain typing", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openGhostProject(tauriPage);
  await toggleSetting(tauriPage, "Inline suggestion", true);
  expect(
    await tauriPage.evaluate<string | null>(
      `localStorage.getItem("oleafly.editor.ghostCompletion")`,
    ),
  ).toBe("1");

  await startDocument(tauriPage);
  await typeAtCaret(tauriPage, "Hi ");
  await settle(tauriPage, 1_500);
  expect(await ghostText(tauriPage)).toBe("");
  await caretToEnd(tauriPage);
});

test.describe("AI completions", () => {
  let server: MockAiServer;

  test.beforeAll(async () => {
    server = await startMockAiServer();
  });
  test.afterAll(async () => {
    await server?.close();
  });

  async function withMockProvider(page: Page, on: boolean, run: () => Promise<void>) {
    await openGhostProject(page);
    const saved = await page.evaluate<unknown>(
      `import("/src/lib/tauri.ts").then((m) => m.getConfig())`,
    );
    const connected = await page.evaluate<boolean>(
      `window.__aiConnect?.("ollama", ${JSON.stringify(server.url)}, "llama3.2") ?? false`,
    );
    expect(connected, "__aiConnect devtools hook must be present").toBe(true);
    try {
      await toggleAiCompletions(page, on);
      await startDocument(page);
      server.resetRequests();
      await run();
    } finally {
      await toggleAiCompletions(page, false);
      await page.evaluate(
        `import("/src/lib/tauri.ts").then(async (m) => {
          const saved = ${JSON.stringify(saved)};
          await m.setConfig(saved);
          window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed", { detail: saved }));
          return 1;
        })`,
      );
    }
  }

  test("a suggestion from the model appears after a pause and Tab accepts it", async ({ tauriPage }) => {
    test.setTimeout(240_000);
    await withMockProvider(tauriPage, true, async () => {
      server.setReply("show a clear trend.");
      await typeAtCaret(tauriPage, "The results ");
      await waitLong(
        tauriPage,
        `document.querySelector('${GHOST}')?.textContent === "show a clear trend."`,
        20_000,
      );
      const sent = server.requestBodies().join("\n");
      expect(sent).toContain("The results <cursor/>");

      await expect.poll(() => server.requestCount(), { timeout: 10_000 }).toBe(2);
      await pressTab(tauriPage);
      await expect
        .poll(async () => await editorSource(tauriPage), { timeout: 10_000 })
        .toContain("The results show a clear trend.");
      await expect.poll(() => ghostText(tauriPage), { timeout: 2_000 }).toBe("show a clear trend.");
      expect(server.requestCount()).toBe(2);
    });
  });

  test("nothing is sent while AI completions are off", async ({ tauriPage }) => {
    test.setTimeout(240_000);
    await withMockProvider(tauriPage, false, async () => {
      server.setReply("should not appear");
      await typeAtCaret(tauriPage, "The results ");
      await settle(tauriPage, 2_000);
      expect(server.requestCount()).toBe(0);
      expect(await ghostText(tauriPage)).toBe("");
    });
  });
});
