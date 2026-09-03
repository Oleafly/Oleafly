import { expect } from "./fixtures";
import type { LocatorLike } from "@srsholmes/tauri-playwright";
import type { E2ePdfProbe } from "../src/lib/e2e-probe";

const SHELL_READY_TIMEOUT_MS = 60_000;

export interface Page {
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  fill(selector: string, text: string): Promise<void>;
  focus(selector: string): Promise<void>;
  press(selector: string, key: string): Promise<void>;
  evaluate<T = unknown>(expression: string): Promise<T>;
  waitForFunction(expression: string, timeout?: number): Promise<unknown>;
  locator(selector: string): LocatorLike & { click(): Promise<void> };
  getByTestId(id: string): LocatorLike & { click(): Promise<void> };
  getByText(
    text: string,
    opts?: { exact?: boolean },
  ): LocatorLike & { click(): Promise<void> };
}

/**
 * The desktop shell must always remain attached to the native viewport.
 * Editors and previews own their scroll positions; the browser document does
 * not. This catches both scrollTop leaks and the resulting displaced root.
 */
export async function expectDesktopShellAnchored(page: Page) {
  const state = await page.evaluate<{
    scrollTop: number;
    scrollLeft: number;
    scrollRange: number;
    rootTop: number;
    rootLeft: number;
    rootPosition: string;
    bodyPosition: string;
    overflowing: string[];
  }>(
    `(() => {
      const root = document.getElementById("root");
      if (!root) throw new Error("desktop root is unavailable");
      const rect = root.getBoundingClientRect();
      const doc = document.documentElement;
      // Anything sticking out below the viewport is what makes the document
      // scrollable; name it so a failure points at the offender directly.
      const overflowing = [...document.querySelectorAll("body > *")]
        .filter((el) => el.getBoundingClientRect().bottom > doc.clientHeight + 1)
        .map((el) => el.tagName + (el.id ? "#" + el.id : "") + "." + String(el.className || ""));
      return {
        scrollTop: document.scrollingElement?.scrollTop ?? -1,
        scrollLeft: document.scrollingElement?.scrollLeft ?? -1,
        scrollRange: Math.max(0, Math.round(doc.scrollHeight - doc.clientHeight)),
        rootTop: rect.top,
        rootLeft: rect.left,
        rootPosition: getComputedStyle(root).position,
        bodyPosition: getComputedStyle(document.body).position,
        overflowing,
      };
    })()`,
  );
  const { bodyPosition, overflowing, ...anchoredState } = state;
  // scrollRange must be 0. `body { overflow: hidden }` only hides the
  // scrollbar - it still permits programmatic scrolling, so any element that
  // extends past the viewport leaves the whole app scrollable and lets a
  // library (react-joyride's step scroll, a focus reveal) shift the shell.
  expect(anchoredState, `overflowing body children: ${overflowing.join(", ")}`).toEqual({
    scrollTop: 0,
    scrollLeft: 0,
    scrollRange: 0,
    rootTop: 0,
    rootLeft: 0,
    rootPosition: "static",
  });
  // Radix temporarily establishes the body as a containing block while a
  // portalled Select finishes its exit transition. `relative` does not move
  // the shell; fixed/absolute positioning would. Keep the displacement checks
  // exact while accepting both valid, anchored body states.
  expect(["static", "relative"]).toContain(bodyPosition);
}

/**
 * Predicate expression: does the line the caret sits on contain `needle`?
 *
 * Read the editor state, not `.cm-activeLine`. That decoration is deliberately
 * suppressed while a selection exists, so the selection colour stays uniform
 * across every selected line - and navigation actions such as Go to definition
 * land with the symbol selected, which is exactly when these probes run.
 */
export function caretLineIncludes(needle: string): string {
  return `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
    const view = getEditorView();
    if (!view) return false;
    return view.state.doc
      .lineAt(view.state.selection.main.head)
      .text.includes(${JSON.stringify(needle)});
  })`;
}

// The app's own handlers for Cmd+K / Cmd+Shift+F listen on window keydown.
export async function pressGlobal(
  page: Page,
  key: string,
  mods: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
) {
  await page.evaluate(
    `(() => {
      const apple = /Mac|iPhone|iPad/.test(navigator.platform);
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: ${JSON.stringify(key)},
        altKey: ${!!mods.alt},
        ctrlKey: ${!!mods.ctrl} || (${!!mods.meta} && !apple),
        metaKey: ${!!mods.meta} && apple,
        shiftKey: ${!!mods.shift},
        bubbles: true,
        cancelable: true,
      }));
    })()`,
  );
}

// The fixture reloads the SPA before each test, so wait for the library to
// finish loading projects (one of the two buttons exists only after that)
// before deciding which button to click - probing earlier races the load.
export async function openGallery(page: Page) {
  const library = page.locator(
    '[data-testid="library"][data-projects-loaded="true"]',
  ) as unknown as LocatorLike;
  await expect(library).toBeVisible({ timeout: SHELL_READY_TIMEOUT_MS });
  const hasWelcome = await page.evaluate<boolean>(
    `!!document.querySelector('[data-testid="create-first-project"]')`,
  );
  await page.click(hasWelcome ? '[data-testid="create-first-project"]' : '[data-testid="new-project"]');
  const gallery = page.locator(
    '[data-testid="template-gallery"]',
  ) as unknown as LocatorLike;
  await expect(gallery).toBeVisible({ timeout: SHELL_READY_TIMEOUT_MS });
}

// Insert through CodeMirror's authoritative state rather than searching its
// virtualized DOM. Off-screen lines are intentionally absent from `.cm-content`
// and a loaded runner can move the target outside the mounted viewport between
// edits. The input annotation preserves the same store sync, autosave, and lint
// behavior as keyboard input without depending on viewport realization.
export async function typeInEditorAfter(
  page: Page,
  anchorText: string,
  text: string,
  occurrence = 1,
) {
  const ok = await page.evaluate<boolean>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) return false;
      const source = view.state.doc.toString();
      let anchor = -1;
      let cursor = 0;
      for (let index = 0; index < ${occurrence}; index++) {
        anchor = source.indexOf(${JSON.stringify(anchorText)}, cursor);
        if (anchor < 0) return false;
        cursor = anchor + ${JSON.stringify(anchorText)}.length;
      }
      view.dispatch({
        changes: { from: cursor, insert: ${JSON.stringify(text)} },
        selection: { anchor: cursor + ${JSON.stringify(text)}.length },
        scrollIntoView: true,
        userEvent: "input.type",
      });
      view.focus();
      return true;
    })`,
  );
  if (!ok) throw new Error("typeInEditorAfter: anchor " + JSON.stringify(anchorText) + " not found in editor");
}

async function pollCompiledPdf(page: Page, predicate: string, timeoutMs: number, onTimeout: string) {
  await ensureE2ePdfProbe(page);
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  for (;;) {
    await page.evaluate(
      `(() => {
        window.__pdfProbe = null;
        window.__pdfProbeError = null;
        window.__e2ePdfText()
          .then((t) => { window.__pdfProbe = t; })
          .catch((error) => { window.__pdfProbeError = String(error); });
        return true;
      })()`,
    );
    try {
      await waitLong(
        page,
        `typeof window.__pdfProbe === 'string' || typeof window.__pdfProbeError === 'string'`,
        20_000,
      );
    } catch {
    }
    lastError = await page.evaluate<string>(
      `typeof window.__pdfProbeError === 'string' ? window.__pdfProbeError : ''`,
    );
    const ok = await page.evaluate<boolean>(
      `(() => { const t = window.__pdfProbe; return typeof t === 'string' && (${predicate}); })()`,
    );
    if (ok) return;
    if (Date.now() > deadline) {
      throw new Error(lastError ? `${onTimeout}: ${lastError}` : onTimeout);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function ensureE2ePdfProbe(page: Page): Promise<void> {
  const installed = await page.evaluate<boolean>(
    `typeof window.__e2ePdfText === "function" &&
      typeof window.__e2ePdfProbe === "function"`,
  );
  if (installed) return;
  await page.evaluate(
    `(import("/src/lib/e2e-probe.ts")
      .then(({ installE2ePdfProbe }) => installE2ePdfProbe()), true)`,
  );
  await waitLong(
    page,
    `typeof window.__e2ePdfText === "function" &&
      typeof window.__e2ePdfProbe === "function"`,
    20_000,
  );
}

export async function getCompiledPdfProbe(
  page: Page,
  timeoutMs = 90_000,
): Promise<E2ePdfProbe> {
  // The compiled PDF lands on disk a beat after the compile status flips on a
  // slow filesystem (Windows CI), so a fresh probe can read ENOENT once or
  // twice before the artifact exists. Retry those reads before failing.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await getCompiledPdfProbeOnce(page, timeoutMs);
    } catch (error) {
      if (!String(error).includes("no compiled PDF")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
  return getCompiledPdfProbeOnce(page, timeoutMs);
}

async function getCompiledPdfProbeOnce(
  page: Page,
  timeoutMs: number,
): Promise<E2ePdfProbe> {
  await ensureE2ePdfProbe(page);
  await page.evaluate(
    `(() => {
      window.__pdfSemanticProbe = null;
      window.__pdfSemanticProbeError = null;
      window.__e2ePdfProbe()
        .then((probe) => { window.__pdfSemanticProbe = probe; })
        .catch((error) => { window.__pdfSemanticProbeError = String(error); });
      return true;
    })()`,
  );
  await waitLong(
    page,
    `(typeof window.__pdfSemanticProbe === "object" &&
      window.__pdfSemanticProbe !== null) ||
      typeof window.__pdfSemanticProbeError === "string"`,
    timeoutMs,
  );
  const error = await page.evaluate<string>(
    `typeof window.__pdfSemanticProbeError === "string"
      ? window.__pdfSemanticProbeError
      : ""`,
  );
  if (error) {
    // Attach the compile log's interesting lines: "no compiled PDF" class
    // failures are usually the compile itself failing for an environmental
    // reason the probe error alone cannot show.
    const logTail = await page
      .evaluate<string>(
        `import("/src/store/compile.ts").then(({ useCompileStore }) =>
          (useCompileStore.getState().log || "")
            .split("\\n")
            .filter((line) =>
              /missing character|undefined|substitut|not found|unavailable|invalid|error|warning|only-cached/i.test(line),
            )
            .slice(-40)
            .join("\\n"),
        )`,
      )
      .catch(() => "unavailable");
    throw new Error(
      `compiled PDF semantic probe failed: ${error}\ncompile log excerpts:\n${logTail}`,
    );
  }
  return page.evaluate<E2ePdfProbe>(`window.__pdfSemanticProbe`);
}

export async function compileAndProbe(
  page: Page,
  timeoutMs = 120_000,
): Promise<E2ePdfProbe> {
  await compileAndWait(page, timeoutMs);
  return getCompiledPdfProbe(page, timeoutMs);
}

/**
 * Compiles through the real toolbar and waits for a new verified output
 * revision without extracting every PDF page. Book-scale rendering tests use
 * this path so the measurement covers the product viewer, not an E2E-only
 * full-document semantic traversal on the WebView main thread.
 */
export async function compileAndWait(
  page: Page,
  timeoutMs = 120_000,
): Promise<number> {
  const compileButton = page.locator(
    '[data-testid="compile-button"]',
  ) as unknown as LocatorLike;
  type CompileSnapshot = {
    status: string;
    outputRevision: number;
    disabled: boolean;
  };
  // A layout or panel re-render can unmount the toolbar for a frame; tolerate
  // a brief absence instead of failing the whole compile wait, while a button
  // that stays gone still throws.
  const snapshot = async (): Promise<CompileSnapshot> => {
    const absentDeadline = Date.now() + 3_000;
    for (;;) {
      try {
        return await page.evaluate<CompileSnapshot>(
          `(() => {
            const button = document.querySelector('[data-testid="compile-button"]');
            if (!(button instanceof HTMLButtonElement)) {
              throw new Error("compile button is unavailable");
            }
            return {
              status: button.dataset.e2eCompileStatus ?? "",
              outputRevision: Number(button.dataset.e2eCompileRevision ?? "0"),
              disabled: button.disabled,
            };
          })()`,
        );
      } catch (error) {
        if (Date.now() > absentDeadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  };

  const deadline = Date.now() + timeoutMs;
  // A project that just opened schedules its first compile from a React
  // effect. The button can briefly be enabled before that effect starts, so
  // waiting only for "enabled" can click into a compile-store reset. Require a
  // short quiescent window before establishing the production checkpoint.
  let quietSince = 0;
  for (;;) {
    await expect(compileButton).toBeEnabled({ timeout: 60_000 });
    const state = await snapshot();
    if (state.disabled || state.status === "compiling") {
      quietSince = 0;
    } else if (quietSince === 0) {
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= 750) {
      break;
    }
    if (Date.now() > deadline) {
      throw new Error("compile button never reached a stable ready state");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const before = await snapshot();
  let attempts = 1;
  let attemptStartedAt = Date.now();
  let observedCompiling = false;
  await page.click('[data-testid="compile-button"]');

  for (;;) {
    const state = await snapshot();
    if (state.status === "compiling") observedCompiling = true;
    if (
      state.status === "success" &&
      state.outputRevision !== before.outputRevision
    ) {
      break;
    }
    if (
      state.status === "error" &&
      (observedCompiling || Date.now() - attemptStartedAt > 2_000)
    ) {
      const diagnostics = await page
        .evaluate<string>(
          `import("/src/store/compile.ts").then(({ useCompileStore }) => {
            const compile = useCompileStore.getState();
            return JSON.stringify({
              failureReason: compile.failureReason,
              errors: compile.errors,
              log: (compile.log || "").slice(-12000),
            }, null, 2);
          })`,
        )
        .catch(() => "compile diagnostics unavailable");
      throw new Error(
        `semantic fixture failed to compile\n${diagnostics}`,
      );
    }
    // A project-open effect can reset a just-started manual compile. If no
    // compile state becomes observable, retry the real toolbar control instead
    // of waiting until the suite timeout. The Rust output revision guarantees
    // that a later success cannot be confused with an earlier PDF.
    if (
      state.status !== "compiling" &&
      state.outputRevision === before.outputRevision &&
      Date.now() - attemptStartedAt > 5_000 &&
      attempts < 3
    ) {
      await expect(compileButton).toBeEnabled({ timeout: 60_000 });
      await page.click('[data-testid="compile-button"]');
      attempts++;
      attemptStartedAt = Date.now();
      observedCompiling = false;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `semantic compile timed out: ${JSON.stringify({
          beforeRevision: before.outputRevision,
          status: state.status,
          outputRevision: state.outputRevision,
          disabled: state.disabled,
          attempts,
        })}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return (await snapshot()).outputRevision;
}

export async function expectCompiledPdfContains(page: Page, text: string, timeoutMs = 90_000) {
  await pollCompiledPdf(
    page,
    `t.includes(${JSON.stringify(text)})`,
    timeoutMs,
    `compiled PDF never contained: ${text}`,
  );
}

export async function expectCompiledPdfAbsent(page: Page, text: string, timeoutMs = 90_000) {
  await pollCompiledPdf(
    page,
    `!t.includes(${JSON.stringify(text)})`,
    timeoutMs,
    `compiled PDF still contains: ${text}`,
  );
}

export async function expectCompiledPdfEmpty(page: Page, timeoutMs = 90_000) {
  await pollCompiledPdf(page, `t.trim() === ''`, timeoutMs, "compiled PDF text was not empty");
}

export async function createBlankProject(page: Page, name: string) {
  await openGallery(page);
  await page.click('[data-testid="template-card-blank"]');
  await expect(page.locator("#new-project-name")).toBeVisible({ timeout: 20_000 });
  await page.fill("#new-project-name", name);
  await finishProjectCreation(page);
}

export async function createProjectFromTemplate(
  page: Page,
  templateId: string,
  name: string,
) {
  await openGallery(page);
  await page.click(`[data-testid="template-card-${templateId}"]`);
  await expect(page.locator("#new-project-name")).toBeVisible({ timeout: 20_000 });
  await page.fill("#new-project-name", name);
  await finishProjectCreation(page);
}

export async function finishProjectCreation(page: Page) {
  const createButton = page.locator('[data-testid="create-project"]');
  await expect(createButton).toBeEnabled({ timeout: 20_000 });

  // A bridge click can occasionally land during the details step's React
  // commit and be discarded. Observe the actual product states and retry only
  // while the same enabled Create button is still visible. Once creation has
  // started the button becomes disabled, so this cannot submit a second
  // project. Waiting for the editor also covers the native create/open work on
  // a loaded macOS runner instead of treating 20 seconds as a product failure.
  const deadline = Date.now() + 60_000;
  let lastClickAt = 0;
  let lastState: unknown = null;
  for (;;) {
    const state = await page.evaluate<{
      editorVisible: boolean;
      dialogVisible: boolean;
      createEnabled: boolean;
      createVisible: boolean;
      notice: string;
    }>(`(() => {
      const visible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && rect.width > 0
          && rect.height > 0;
      };
      const editor = document.querySelector(".cm-content");
      const dialog = document.querySelector('[data-testid="template-gallery"]');
      const create = document.querySelector('[data-testid="create-project"]');
      const notice = Array.from(document.querySelectorAll('[role="alert"]'))
        .map((element) => element.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" | ");
      return {
        editorVisible: visible(editor),
        dialogVisible: visible(dialog),
        createEnabled: create instanceof HTMLButtonElement && !create.disabled,
        createVisible: visible(create),
        notice,
      };
    })()`);
    lastState = state;
    if (state.editorVisible) return;

    if (
      state.dialogVisible &&
      state.createVisible &&
      state.createEnabled &&
      Date.now() - lastClickAt >= 1_500
    ) {
      await page.click('[data-testid="create-project"]');
      lastClickAt = Date.now();
    }

    if (Date.now() > deadline) {
      throw new Error(`project creation never opened the editor: ${JSON.stringify(lastState)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export async function setEditorContent(page: Page, text: string) {
  const ok = await page.evaluate<boolean>(
    `(() => {
      const content = document.querySelector('.cm-content');
      if (!content) return false;
      content.focus();
      const range = document.createRange();
      range.selectNodeContents(content);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return document.execCommand('insertText', false, ${JSON.stringify(text)});
    })()`,
  );
  if (!ok) throw new Error("setEditorContent: could not replace editor content");
}

export async function editorSource(page: Page): Promise<string> {
  return page.evaluate<string>(
    `import("/src/components/editor/cm/controller.ts").then(
      ({ getEditorView }) => getEditorView()?.state.doc.toString() ?? ""
    )`,
  );
}

export async function replaceEditorSource(page: Page, text: string): Promise<void> {
  const changed = await page.evaluate<boolean>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) return false;
      view.focus();
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(text)} },
        selection: { anchor: ${JSON.stringify(text)}.length },
        userEvent: "input.e2e-fixture",
      });
      return true;
    })`,
  );
  if (!changed) throw new Error("replaceEditorSource: editor is unavailable");
}

export async function selectEditorText(
  page: Page,
  text: string,
  occurrence = 1,
): Promise<void> {
  const selected = await page.evaluate<boolean>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) return false;
      const source = view.state.doc.toString();
      let from = -1;
      let cursor = 0;
      for (let index = 0; index < ${occurrence}; index++) {
        from = source.indexOf(${JSON.stringify(text)}, cursor);
        if (from < 0) return false;
        cursor = from + ${JSON.stringify(text)}.length;
      }
      view.dispatch({ selection: { anchor: from, head: from + ${JSON.stringify(text)}.length } });
      view.focus();
      return true;
    })`,
  );
  if (!selected) {
    throw new Error(
      `selectEditorText: ${JSON.stringify(text)} occurrence ${occurrence} not found`,
    );
  }
}

export async function setEditorCaretAfter(
  page: Page,
  text: string,
  occurrence = 1,
): Promise<void> {
  await selectEditorText(page, text, occurrence);
  const placed = await page.evaluate<boolean>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) return false;
      const head = view.state.selection.main.to;
      view.dispatch({ selection: { anchor: head } });
      view.focus();
      return true;
    })`,
  );
  if (!placed) throw new Error("setEditorCaretAfter: editor is unavailable");
}

export async function replaceEditorSelection(page: Page, text: string): Promise<void> {
  const changed = await page.evaluate<boolean>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) return false;
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: ${JSON.stringify(text)} },
        selection: { anchor: selection.from + ${JSON.stringify(text)}.length },
        userEvent: "input",
      });
      view.focus();
      return true;
    })`,
  );
  if (!changed) throw new Error("replaceEditorSelection: editor is unavailable");
}

export async function replaceEditorLiteral(
  page: Page,
  before: string,
  after: string,
  occurrence = 1,
): Promise<void> {
  await selectEditorText(page, before, occurrence);
  await replaceEditorSelection(page, after);
}

export async function writeProjectBinary(
  page: Page,
  path: string,
  base64: string,
): Promise<void> {
  const written = await page.evaluate<boolean>(
    `import("/src/lib/tauri.ts").then(async ({ writeProjectBytes }) => {
      const projectId =
        document.querySelector('[data-e2e-project-id]')?.dataset.e2eProjectId;
      if (!projectId) return false;
      await writeProjectBytes(projectId, ${JSON.stringify(path)}, ${JSON.stringify(base64)});
      return true;
    })`,
  );
  if (!written) throw new Error(`writeProjectBinary: no active project for ${path}`);
}

export async function readProjectText(page: Page, path: string): Promise<string> {
  return page.evaluate<string>(
    `import("/src/lib/tauri.ts").then(({ readFileContent }) => {
      const projectId =
        document.querySelector('[data-e2e-project-id]')?.dataset.e2eProjectId;
      if (!projectId) throw new Error("no active project");
      return readFileContent(projectId, ${JSON.stringify(path)});
    })`,
  );
}

export async function writeProjectText(
  page: Page,
  path: string,
  content: string,
): Promise<void> {
  const written = await page.evaluate<boolean>(
    `Promise.all([
      import("/src/lib/tauri.ts"),
      import("/src/store/files.ts"),
    ]).then(async ([tauri, files]) => {
      const projectId =
        document.querySelector('[data-e2e-project-id]')?.dataset.e2eProjectId;
      if (!projectId) return false;
      await tauri.writeFileContent(
        projectId,
        ${JSON.stringify(path)},
        ${JSON.stringify(content)},
      );
      await files.useFilesStore.getState().refreshTree();
      return true;
    })`,
  );
  if (!written) throw new Error(`writeProjectText: no active project for ${path}`);
}

export async function readProjectBase64(page: Page, path: string): Promise<string> {
  return page.evaluate<string>(
    `import("/src/lib/tauri.ts").then(async ({ readProjectBytes }) => {
      const projectId =
        document.querySelector('[data-e2e-project-id]')?.dataset.e2eProjectId;
      if (!projectId) throw new Error("no active project");
      const result = await readProjectBytes(projectId, ${JSON.stringify(path)});
      const bytes = new Uint8Array(result);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    })`,
  );
}

export async function readCompiledPdfBase64(page: Page): Promise<string> {
  return page.evaluate<string>(
    `import("/src/lib/tauri.ts").then(async ({ readCompiledPdf }) => {
      const projectId =
        document.querySelector('[data-e2e-project-id]')?.dataset.e2eProjectId;
      if (!projectId) throw new Error("no active project");
      const result = await readCompiledPdf(projectId);
      const bytes = new Uint8Array(result);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    })`,
  );
}

export async function listProjectEntries(
  page: Page,
): Promise<Array<{ path: string; is_dir: boolean }>> {
  return page.evaluate<Array<{ path: string; is_dir: boolean }>>(
    `import("/src/lib/tauri.ts").then(({ listFiles }) => {
      const projectId =
        document.querySelector('[data-e2e-project-id]')?.dataset.e2eProjectId;
      if (!projectId) throw new Error("no active project");
      return listFiles(projectId);
    })`,
  );
}

export async function setNextImportPaths(
  page: Page,
  paths: string[] | null,
): Promise<void> {
  const available = await page.evaluate<boolean>(
    `(() => {
      if (typeof window.__e2eSetNextImportPaths !== "function") return false;
      window.__e2eSetNextImportPaths(${JSON.stringify(paths)});
      return true;
    })()`,
  );
  if (!available) throw new Error("DEV import-dialog adapter is unavailable");
}

export async function setNextSavePath(
  page: Page,
  path: string | null,
): Promise<void> {
  const available = await page.evaluate<boolean>(
    `(() => {
      if (typeof window.__e2eSetNextSavePath !== "function") return false;
      window.__e2eSetNextSavePath(${JSON.stringify(path)});
      return true;
    })()`,
  );
  if (!available) throw new Error("DEV save-dialog adapter is unavailable");
}

// The AI assistant is its own panel now, toggled from the workspace dock
// controls rather than living as a sidebar tab.
export async function openAssistant(page: Page) {
  const openExpr = `document.querySelector('[data-testid="rail-assistant-toggle"]')?.getAttribute('aria-pressed') === 'true'`;
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await page.evaluate<boolean>(openExpr)) return;
    await page.evaluate(
      `(() => { const b = document.querySelector('[data-testid="rail-assistant-toggle"]'); if (b) b.click(); return true; })()`,
    );
    try {
      await page.waitForFunction(openExpr, 2_000);
      return;
    } catch {
    }
  }
  throw new Error("openAssistant: the assistant panel never opened");
}

// The sidebar view switchers live in a bar at the top of the sidebar, which
// only renders while the sidebar is open. Reveal the sidebar first, then select
// the view; a view button reports aria-current="page" when it is the active
// pane. Selecting a view no longer collapses the sidebar.
export async function openRailTab(page: Page, ariaLabel: string) {
  if (ariaLabel === "Research Assistant") return openAssistant(page);
  const sel = JSON.stringify(`[aria-label=${JSON.stringify(ariaLabel)}]`);
  const activeExpr = `(() => {
    const b = document.querySelector(${sel});
    return !!b && b.getAttribute('aria-current') === 'page';
  })()`;
  for (let attempt = 0; attempt < 12; attempt++) {
    if (await page.evaluate<boolean>(activeExpr)) return;
    await page.evaluate(`(() => {
      const b = document.querySelector(${sel});
      if (b) { b.click(); return true; }
      const show = document.querySelector('[aria-label^="Show sidebar"]');
      if (show) { show.click(); return true; }
      return false;
    })()`);
    try {
      await page.waitForFunction(activeExpr, 2_000);
      return;
    } catch {
    }
  }
  throw new Error(`openRailTab: ${ariaLabel} never became the active tab`);
}

// The test fixture reloads the app to the library before every test, so
// specs that need the editor start here.
export async function openProject(page: Page & { getByText(t: string): { click(): Promise<void> } }, name: string) {
  const libraryVisible = await page.evaluate<boolean>(
    `!!document.querySelector('[data-testid="library"]')`,
  );
  if (!libraryVisible) {
    const hasBack = await page.evaluate<boolean>(
      `!!document.querySelector('[title="Back to library"]')`,
    );
    if (hasBack) await page.click('[title="Back to library"]');
  }
  const library = page.locator(
    '[data-testid="library"][data-projects-loaded="true"]',
  ) as unknown as LocatorLike;
  await expect(library).toBeVisible({ timeout: SHELL_READY_TIMEOUT_MS });
  try {
    await page.click(`button[aria-label=${JSON.stringify(`Open ${name}`)}]`);
  } catch (error) {
    const snapshot = await page.evaluate<string>(`(async () => {
      const labels = Array.from(document.querySelectorAll('[data-testid="library"] button[aria-label]'))
        .map((el) => el.getAttribute("aria-label"))
        .filter((label) => label && /^Open /.test(label));
      let stored = "unavailable";
      try {
        const files = await import("/src/store/files.ts");
        const state = files.useFilesStore.getState();
        stored = JSON.stringify({
          loaded: state.projectsLoaded,
          loading: state.loading,
          projectId: state.projectId,
          names: state.projects.map((project) => [project.name, project.recovery_pending ?? false]),
        });
      } catch {}
      return JSON.stringify({ labels, stored });
    })()`).catch(() => "snapshot unavailable");
    throw new Error(`${String(error)}; library snapshot ${snapshot}`);
  }
  const workspace = page.locator(
    "[data-e2e-project-id]",
  ) as unknown as LocatorLike;
  await expect(workspace).toBeVisible({ timeout: SHELL_READY_TIMEOUT_MS });
}

// Creating or clicking a file updates the tree before the editor finishes
// switching documents, so typing right away can land in the previously active
// document and silently leave the new file empty. Wait until the CM view holds
// the target file's store content before typing.
export async function waitEditorShowsFile(page: Page, path: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ready = await page.evaluate<boolean>(
      `Promise.all([
        import("/src/store/files.ts"),
        import("/src/components/editor/cm/controller.ts"),
      ]).then(([files, cm]) => {
        const state = files.useFilesStore.getState();
        if (state.activePath !== ${JSON.stringify(path)}) return false;
        const view = cm.getEditorView();
        if (!view) return false;
        return view.state.doc.toString() === (state.files[${JSON.stringify(path)}]?.content ?? "");
      })`,
    );
    if (ready) return;
    if (Date.now() > deadline) throw new Error(`editor never showed ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

export async function typeInEditorAtStart(page: Page, text: string) {
  const inserted = await page.evaluate<boolean>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) return false;
      view.focus();
      view.dispatch({
        changes: { from: 0, insert: ${JSON.stringify(text)} },
        selection: { anchor: ${JSON.stringify(text)}.length },
      });
      return true;
    })`,
  );
  if (!inserted) throw new Error("typeInEditorAtStart: editor input was rejected");
}

// The plugin's wait_for_function has a ~30s server-side cap, so poll
// evaluate() client-side instead for anything that can take longer
// (AI streaming, cold compiles).
export async function waitLong(page: Page, expression: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // Many app-state predicates use dynamic import(...).then(...). Coercing
    // that expression directly with `!!` treats the pending Promise itself as
    // true and lets the test continue before its callback has run. Normalize
    // both synchronous and asynchronous predicates through Promise.resolve so
    // this helper observes the resolved boolean value.
    const ok = await page.evaluate<boolean>(
      `Promise.resolve(${expression}).then((value) => !!value)`,
    );
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`waitLong timeout: ${expression}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// CodeMirror virtualizes the document, so `.cm-content` textContent only holds
// the rendered viewport. Read the full doc through the editor controller (the
// dev-server module import trick spec 24 established).
export async function waitEditorContains(page: Page, needle: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await page.evaluate(
      `(import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
        window.__docText = getEditorView()?.state.doc.toString() ?? "";
      }), true)`,
    );
    await new Promise((r) => setTimeout(r, 500));
    const ok = await page.evaluate<boolean>(
      `(window.__docText ?? "").includes(${JSON.stringify(needle)})`,
    );
    if (ok) return;
    if (Date.now() > deadline) {
      const doc = await page
        .evaluate<string>(`(window.__docText ?? "").slice(0, 600)`)
        .catch(() => "unavailable");
      throw new Error(
        `editor never contained: ${needle}; document head:\n${doc}`,
      );
    }
  }
}

// Conversations persist across panel remounts by design, so tests that
// assert on a fresh reply must begin with a real New-chat click or a
// restored transcript can satisfy their waits.
export async function newChat(page: Page) {
  await page.evaluate(
    `(() => {
      const b = document.querySelector('[aria-label="New chat"]');
      if (b) b.click();
      return 1;
    })()`,
  );
}

// The plugin's fill() uses the HTMLInputElement value setter and throws on
// textareas; use the textarea prototype setter + an input event so React
// controlled state updates.
export async function fillTextarea(page: Page, selector: string, text: string) {
  await page.evaluate(
    `(() => {
      const t = document.querySelector(${JSON.stringify(selector)});
      if (!t) throw new Error('fillTextarea: not found: ' + ${JSON.stringify(selector)});
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      set.call(t, ${JSON.stringify(text)});
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    })()`,
  );
}

export async function ensureGithubConnected(page: Page) {
  const token = process.env.E2E_GITHUB_TOKEN;
  if (!token) throw new Error("ensureGithubConnected: E2E_GITHUB_TOKEN not set");
  // The Git panel itself has no connection gate (it works fully locally);
  // connection state and the PAT input both live on the GitHub tab of
  // Settings -> Integrations, which is the tab's default.
  await openSettings(page, "integrations");
  const connected = await page.evaluate<boolean>(
    `document.body.innerText.includes('Disconnect')`,
  );
  if (!connected) {
    await page.getByText("Advanced: use a personal access token").click();
    await page.fill('input[placeholder="ghp_…"]', token);
    await page.getByText("Connect", { exact: true }).click();
    // Connected: the account card renders with a Disconnect button.
    await page.waitForFunction(
      `document.body.innerText.includes('Disconnect')`,
      20_000,
    );
  }
  await page.click('[aria-label="Close settings"]');
  await openRailTab(page, "Source Control");
}

// Every interaction with the card must be scoped to it: OpenAI and Z.AI
// share the "sk-…" input placeholder and a "Save" button, and a page-wide
// selector once saved the Z.AI key into the OpenAI card and silently
// switched the active provider (HTTP 401s).
export async function expandProviderCard(page: Page) {
  const provider = process.env.E2E_AI_PROVIDER || "Z.AI";
  await page.evaluate(
    `(() => {
      const modal = document.querySelector('[aria-label="Close settings"]')?.closest('.fixed');
      if (!modal) throw new Error('settings modal not open');
      const header = Array.from(modal.querySelectorAll('button[aria-expanded]'))
        .find(b => (b.textContent || '').includes(${JSON.stringify(provider)}));
      if (!header) throw new Error('provider card not found: ' + ${JSON.stringify(provider)});
      if (header.getAttribute('aria-expanded') !== 'true') header.click();
      return 1;
    })()`,
  );
}

export function inProviderCard(snippet: string): string {
  const provider = process.env.E2E_AI_PROVIDER || "Z.AI";
  return `(() => {
    const modal = document.querySelector('[aria-label="Close settings"]')?.closest('.fixed');
    if (!modal) throw new Error('settings modal not open');
    const header = Array.from(modal.querySelectorAll('button[aria-expanded]'))
      .find(b => (b.textContent || '').includes(${JSON.stringify(provider)}));
    const card = header?.closest('.rounded-lg');
    if (!card) throw new Error('provider card not found');
    ${snippet}
  })()`;
}

export async function ensureAiConnected(page: Page) {
  const token = process.env.E2E_AI_TOKEN;
  if (!token) throw new Error("ensureAiConnected: E2E_AI_TOKEN not set");
  await openRailTab(page, "Research Assistant");
  const ready = await page.evaluate<boolean>(
    `!!document.querySelector('textarea[placeholder*="Ask AI"], textarea[placeholder*="Describe a figure"]')`,
  );
  if (ready) return;
  await openSettings(page, "ai");
  await expandProviderCard(page);
  await page.evaluate(
    inProviderCard(`
      const replace = card.querySelector('[data-testid^="ai-provider-replace-"]');
      if (replace) replace.click();
      return 1;
    `),
  );
  await page
    .waitForFunction(
      inProviderCard(`return !!card.querySelector('input[type="password"]');`),
      5_000,
    )
    .catch(() => {});
  await page.evaluate(
    inProviderCard(`
      const input = card.querySelector('input[type="password"]');
      if (!input) throw new Error('no key input in the provider card');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(input, ${JSON.stringify(token)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    `),
  );
  // Save a new/changed key, or activate an already-saved one via Use. If the
  // card is already Active with the same key, neither button renders. The
  // button appears one React render AFTER the input event, so wait for it
  // rather than querying immediately (a lost race left the key unsaved).
  await page
    .waitForFunction(
      inProviderCard(
        `return Array.from(card.querySelectorAll('button')).some(b => ['Save', 'Activate'].includes(b.textContent.trim()));`,
      ),
      5_000,
    )
    .catch(() => {});
  const clicked = await page.evaluate<boolean>(
    inProviderCard(`
      const btn = Array.from(card.querySelectorAll('button'))
        .find(b => ['Save', 'Activate'].includes(b.textContent.trim()));
      if (!btn) return false;
      btn.click();
      return true;
    `),
  );
  if (clicked) {
    await page.waitForFunction(
      inProviderCard(`return (card.textContent || '').includes('Connected');`),
      15_000,
    );
  }
  await page.click('[aria-label="Close settings"]');
  await openRailTab(page, "Research Assistant");
  await page.waitForFunction(
    `!!document.querySelector('textarea[placeholder*="Ask AI"], textarea[placeholder*="Describe a figure"]')`,
    10_000,
  );
}

export async function openSettings(page: Page, section?: string) {
  // The settings modal is lazy-loaded. Wait for its always-present appearance
  // nav via the locator-assertion path (tauriExpect), NOT waitForFunction: the
  // bridge's eval intermittently hangs for its full timeout right after the
  // settings modal opens deep in a long session (this is what previously forced
  // the agent-tools test to test.fixme). If the settings-button click missed and
  // the modal never opened, reset and re-open once.
  const appearance = page.locator(
    '[data-testid="settings-section-appearance"]',
  ) as unknown as LocatorLike;
  await page.click('[aria-label="Settings"]');
  const mounted = await expect(appearance)
    .toBeVisible({ timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!mounted) {
    await page.press("body", "Escape").catch(() => {});
    await page.click('[aria-label="Settings"]').catch(() => {});
    await expect(appearance).toBeVisible({ timeout: 8_000 });
  }
  if (section) {
    const sel = `[data-testid="settings-section-${section}"]`;
    // Probe-and-click in one browser task, then confirm the nav button gained
    // aria-current="page". A bare bridge click blocks its full 20s timeout when
    // the button is momentarily absent (modal still populating its nav), so
    // driving it through evaluate with our own short retry loop — and
    // reopening the modal if the whole nav vanished — is both faster and more
    // robust than waiting on one click.
    const activeExpr = `document.querySelector(${JSON.stringify(sel)})?.getAttribute("aria-current") === "page"`;
    const deadline = Date.now() + 15_000;
    for (let attempt = 0; ; attempt++) {
      const state = await page.evaluate<string>(
        `(() => {
          if (${activeExpr}) return "active";
          const button = document.querySelector(${JSON.stringify(sel)});
          if (button instanceof HTMLElement) {
            button.click();
            return "clicked";
          }
          if (!document.querySelector('[data-testid="settings-section-appearance"]')) {
            return "closed";
          }
          // Dictionary/Engine/Downloads/Data live behind the "Show advanced
          // settings" toggle, persisted in localStorage. A fresh data dir (or a
          // shard whose earlier specs never enabled it) opens with it off, so
          // the section button legitimately isn't in the nav yet. Enable it.
          const advanced = document.querySelector('[aria-label="Show advanced settings"]');
          if (advanced instanceof HTMLElement && advanced.getAttribute("aria-checked") !== "true") {
            advanced.click();
            return "advanced";
          }
          return "waiting";
        })()`,
      );
      if (state === "active") return;
      if (state === "closed") {
        // The modal lost its nav (or never fully opened); reopen and retry.
        await page.click('[aria-label="Settings"]').catch(() => {});
        await expect(appearance).toBeVisible({ timeout: 8_000 });
      }
      if (Date.now() > deadline) {
        throw new Error(`settings section ${section} never activated (last: ${state})`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

export async function openOleaflyMcpSettings(page: Page) {
  await openSettings(page, "integrations");
  const tab = page.getByTestId("integrations-tab-oleafly-mcp");
  await tab.click();
  // A synthetic click can lose the Radix activation race right after the
  // section mounts; keyboard activation on the focused trigger is the
  // deterministic fallback.
  const selected = await page.evaluate<boolean>(
    `document.querySelector('[data-testid="integrations-tab-oleafly-mcp"]')?.getAttribute("aria-selected") === "true"`,
  );
  if (!selected) {
    await page.focus('[data-testid="integrations-tab-oleafly-mcp"]');
    await page.press('[data-testid="integrations-tab-oleafly-mcp"]', "Enter");
  }
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("oleafly-mcp-server")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="mcp-enable-toggle"]')).toBeVisible({
    timeout: 10_000,
  });
}

export async function paletteItems(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(
    `Array.from(document.querySelectorAll('[cmdk-item]')).map(e => e.textContent.trim())`,
  );
}

/**
 * The native Tauri bridge's fill/type commands can update an input's DOM value
 * on Linux without notifying React, leaving cmdk's filtered state unchanged.
 * Development builds expose this narrow event seam so E2E drives the same
 * controlled query state used by real keyboard input.
 */
export async function fillCommandPalette(
  page: Page,
  text: string,
): Promise<void> {
  await page.waitForFunction(
    `Array.from(document.querySelectorAll('[cmdk-input]')).some(
      (element) =>
        element instanceof HTMLInputElement &&
        element.getClientRects().length > 0
    )`,
    10_000,
  );
  const accepted = await page.evaluate<boolean>(
    `(() => {
      const input = Array.from(document.querySelectorAll('[cmdk-input]')).find(
        (element) =>
          element instanceof HTMLInputElement &&
          element.getClientRects().length > 0
      );
      if (!(input instanceof HTMLInputElement)) return false;
      input.focus();
      return new Promise((resolve) => {
        let attempts = 0;
        const nextFrame = (run) => {
          let settled = false;
          const finish = () => { if (!settled) { settled = true; run(); } };
          requestAnimationFrame(finish);
          setTimeout(finish, 100);
        };
        const update = () => {
          window.dispatchEvent(new CustomEvent("oleafly:e2e-command-query", {
            detail: ${JSON.stringify(text)},
          }));
          nextFrame(() => {
            if (input.value === ${JSON.stringify(text)}) {
              nextFrame(() => resolve(true));
              return;
            }
            attempts += 1;
            if (attempts >= 30) {
              resolve(false);
              return;
            }
            update();
          });
        };
        update();
      });
    })()`,
  );
  if (!accepted) {
    throw new Error(
      `fillCommandPalette: controlled input rejected ${JSON.stringify(text)}`,
    );
  }
}

// Place the caret through CodeMirror's public state API. This never mutates
// the document and is independent of viewport rendering, text-node splitting,
// lint decorations, and WebKit's synthetic mouse-event handling.
export async function caretIn(
  page: Page,
  anchorText: string,
  occurrence = 1,
  where: "start" | "end" = "start",
) {
  const placed = await page.evaluate<boolean>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) return false;
      const source = view.state.doc.toString();
      const anchor = ${JSON.stringify(anchorText)};
      let from = -1;
      let cursor = 0;
      for (let index = 0; index < ${occurrence}; index += 1) {
        from = source.indexOf(anchor, cursor);
        if (from < 0) return false;
        cursor = from + anchor.length;
      }
      const position = ${JSON.stringify(where)} === "end"
        ? from + anchor.length
        : from;
      view.dispatch({
        selection: { anchor: position },
        scrollIntoView: true,
      });
      view.focus();
      return view.state.selection.main.head === position;
    })`,
  );
  if (!placed) {
    throw new Error(
      `caretIn: ${JSON.stringify(anchorText)} occurrence ${occurrence} not found or editor unavailable`,
    );
  }
}

// The Diagram Composer is now a standalone home-shell page (not a per-project
// modal), reached from the dock and backed by a single hidden scratch
// project, not the currently open project.
export async function openDiagramComposer(page: Page) {
  const libraryVisible = await page.evaluate<boolean>(
    `!!document.querySelector('[data-testid="library"]')`,
  );
  if (!libraryVisible) {
    const hasBack = await page.evaluate<boolean>(
      `!!document.querySelector('[title="Back to library"]')`,
    );
    if (hasBack) await page.click('[title="Back to library"]');
  }
  const library = page.locator(
    '[data-testid="library"][data-projects-loaded="true"]',
  ) as unknown as LocatorLike;
  await expect(library).toBeVisible({ timeout: SHELL_READY_TIMEOUT_MS });
  await page.click('[data-testid="open-diagram-composer"]');
  const dialog = page.locator(
    '[role="dialog"][data-tour="diagram-composer"]',
  ) as unknown as LocatorLike;
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  // The dialog mounts before React Flow finishes its first render pass (the
  // starter drawing has ~27 nodes); wait for the canvas to actually settle so
  // callers that count/select nodes don't race an empty or partial canvas.
  await page.waitForFunction(
    `document.querySelectorAll('.react-flow__node').length > 0`,
    15_000,
  );
}

export async function closeDiagramComposer(page: Page) {
  await page.click('[role="dialog"][data-tour="diagram-composer"] [aria-label="Home"]');
}

// Drives a synthetic mouse-drag over real text coordinates: CM re-asserts its
// state over foreign DOM selections, so Range/Selection injection alone does
// not stick. CI runners occasionally render the target line off the
// currently-scrolled viewport on the first attempt (slower initial layout),
// which makes elementFromPoint miss - scrollIntoView plus a couple of
// retries makes this deterministic without weakening the assertion.
export async function selectWord(page: Page, word: string, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const ok = await page.evaluate<boolean>(
      `(() => {
        const content = document.querySelector('.cm-content');
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const i = node.textContent.indexOf(${JSON.stringify(word)});
          if (i >= 0) {
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + ${JSON.stringify(word)}.length);
            range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
            const rects = range.getClientRects();
            const a = rects[0], b = rects[rects.length - 1];
            if (!a || !b) return false;
            const opts = (x, y, extra) => Object.assign({
              bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1, detail: 1,
            }, extra);
            const sx = a.left + 1, sy = a.top + a.height / 2;
            const ex = b.right - 1, ey = b.top + b.height / 2;
            const target = document.elementFromPoint(sx, sy) || content;
            target.dispatchEvent(new MouseEvent('mousedown', opts(sx, sy)));
            document.dispatchEvent(new MouseEvent('mousemove', opts(ex, ey)));
            document.dispatchEvent(new MouseEvent('mouseup', opts(ex, ey, { buttons: 0 })));
            return true;
          }
        }
        return false;
      })()`,
    );
    if (!ok) {
      expect(ok).toBe(true);
      return;
    }
    try {
      await page.waitForFunction(
        `window.getSelection().toString() === ${JSON.stringify(word)}`,
        1_500,
      );
      return;
    } catch {
      if (attempt === attempts - 1) throw new Error(`selectWord("${word}") never stuck after ${attempts} attempts`);
    }
  }
}

export async function clickLiveToolbarPopoverTrigger(page: Page, ariaLabel: string) {
  const encodedLabel = JSON.stringify(ariaLabel);
  const directSelector = `button[aria-label=${encodedLabel}].size-7`;
  const menuSelector =
    `[data-radix-popper-content-wrapper] [data-state="open"] ` +
    `button[aria-label=${encodedLabel}].w-full`;
  // Probe and click in the SAME browser task: a ResizeObserver relayout or
  // Radix remount between a readiness probe and a separate click call leaves
  // the click targeting a node that no longer exists (the race class
  // clickToolbarControl in helpers.ts fixed).
  const directClicked = await page.evaluate<boolean>(
    `(() => {
      const element = document.querySelector(${JSON.stringify(directSelector)});
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        style.display === "none" ||
        style.visibility === "hidden"
      ) {
        return false;
      }
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
      if (!hit || (hit !== element && !element.contains(hit))) return false;
      element.click();
      return true;
    })()`,
  );
  if (directClicked) return;

  const moreSelector = 'button[aria-label="More formatting options"]';
  const moreExpanded = await page.evaluate<boolean>(
    `document.querySelector(${JSON.stringify(moreSelector)})?.getAttribute("aria-expanded") === "true"`,
  );
  if (!moreExpanded) {
    await page.click(moreSelector, { timeout: 3_000 });
  }
  const deadline = Date.now() + 3_000;
  for (;;) {
    // No elementFromPoint here: rows deep in a long overflow list sit below
    // the popover's scrolled fold, where a hit-test fails forever even though
    // a synthetic click works fine. Scroll the row near and click it.
    const menuClicked = await page.evaluate<boolean>(
      `(() => {
        const elements = Array.from(
          document.querySelectorAll(${JSON.stringify(menuSelector)})
        );
        if (elements.length !== 1) return false;
        const element = elements[0];
        element.scrollIntoView({ block: 'nearest' });
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        element.click();
        return true;
      })()`,
    );
    if (menuClicked) return;
    if (Date.now() > deadline) {
      throw new Error(`${ariaLabel} popover trigger never became clickable`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// A headless webview may never run Radix's exit animation, so a closed symbol
// popover can stay mounted forever. Requiring EXACTLY one search input (as an
// earlier version did) then fails every retry after the first slow attempt.
// Scope every lookup to the portal that contains a search input inside an
// open [data-state] subtree, and act on it atomically in one browser task.
export const openSymbolPortalExpression = `(() => {
  const search = Array.from(document.querySelectorAll(
    '[data-radix-popper-content-wrapper] input[aria-label="Search symbols"]'
  )).find((candidate) => candidate.closest('[data-state="open"]'));
  return search ? search.closest('[data-radix-popper-content-wrapper]') : null;
})()`;

export async function insertSymbol(page: Page, category: string, name: string) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const triggerClicked = await clickLiveToolbarPopoverTrigger(page, "Insert symbol")
      .then(() => true)
      .catch(() => false);
    if (!triggerClicked) {
      await page.press("body", "Escape").catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    const categoryClicked = await page
      .waitForFunction(
        `(() => {
          const portal = ${openSymbolPortalExpression};
          if (!portal) return false;
          const category = Array.from(portal.querySelectorAll('button')).find(
            (candidate) =>
              (candidate.querySelector('span')?.textContent ?? candidate.textContent ?? '')
                .trim() === ${JSON.stringify(category)}
          );
          if (!(category instanceof HTMLElement)) return false;
          category.click();
          return true;
        })()`,
        3_000,
      )
      .then(() => true)
      .catch(() => false);
    if (categoryClicked) {
      const symbolClicked = await page
        .waitForFunction(
          `(() => {
            const portal = ${openSymbolPortalExpression};
            if (!portal) return false;
            const button = portal.querySelector('button[aria-label^=${JSON.stringify(`Insert ${name} (`)}]');
            if (!(button instanceof HTMLElement)) return false;
            button.click();
            return true;
          })()`,
          3_000,
        )
        .then(() => true)
        .catch(() => false);
      if (symbolClicked) return;
    }
    await page.press("body", "Escape").catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const pickerState = await page
    .evaluate<string>(
      `(() => {
        const triggers = Array.from(
          document.querySelectorAll('button[aria-label="Insert symbol"]')
        ).map((trigger) => trigger.getAttribute('aria-expanded'));
        const portals = Array.from(
          document.querySelectorAll('[data-radix-popper-content-wrapper]')
        ).map((portal) => ({
          state: portal.querySelector('[data-state]')?.getAttribute('data-state') ?? null,
          hasSearch: !!portal.querySelector('input[aria-label="Search symbols"]'),
          text: (portal.textContent || '').slice(0, 40),
        }));
        return JSON.stringify({ triggers, portals });
      })()`,
    )
    .catch(() => "unavailable");
  throw new Error(
    `${name} never opened from the toolbar symbol picker; state=${pickerState}`,
  );
}

// The editor toolbar collapses controls that don't fit its measured width
// into a "More formatting options" overflow menu (EditorToolbar.tsx's
// ResizeObserver-driven fitCount) - the overflowed control loses its
// aria-label (the menu row is plain text) and sits behind the trigger.
// CI's window can render narrower than local dev, so direct bar selectors
// are not reliable for controls past the first few; this checks both states.
export async function clickToolbarControl(page: Page, barSelector: string, menuText: string) {
  // Each attempt probes AND clicks inside one browser task. Splitting "find"
  // from "click" across evaluations is what made this flake: the toolbar's
  // ResizeObserver-driven fitCount re-renders (and Radix re-mounts the
  // overflow popover) between two bridge calls, so a control seen by a wait
  // can be gone by the time a separate click evaluation runs.
  //
  // The overflow popover also has closeOnClick=false, so it stays open across
  // a nested dropdown selection. Re-clicking its trigger while open toggles it
  // CLOSED, so the trigger is only clicked when its own aria-expanded says the
  // popover is closed - never inferred from whether the target row is visible
  // (which is false during the popover's entrance frame too).
  const attemptExpression = `(() => {
    const element = document.querySelector(${JSON.stringify(barSelector)});
    if (element instanceof HTMLElement) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      ) {
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        if (hit && (hit === element || element.contains(hit))) {
          element.click();
          return "clicked";
        }
      }
    }
    const button = Array.from(
      document.querySelectorAll('[data-radix-popper-content-wrapper] button')
    ).find((candidate) => {
      if (candidate.textContent?.trim() !== ${JSON.stringify(menuText)}) return false;
      const style = getComputedStyle(candidate);
      const rect = candidate.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    });
    if (button instanceof HTMLElement) {
      button.click();
      return "clicked";
    }
    const trigger = document.querySelector('[aria-label="More formatting options"]');
    if (!(trigger instanceof HTMLElement)) return "no-trigger";
    if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
    return "pending";
  })()`;
  const deadline = Date.now() + 10_000;
  let last = "";
  for (;;) {
    last = await page.evaluate<string>(attemptExpression);
    if (last === "clicked") return;
    if (Date.now() > deadline) {
      throw new Error(`toolbar control ${menuText} never became clickable (${last})`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

export async function currentTheme(page: Page): Promise<"light" | "dark"> {
  return page.evaluate<"light" | "dark">(
    `document.documentElement.classList.contains('dark') ? 'dark' : 'light'`,
  );
}
