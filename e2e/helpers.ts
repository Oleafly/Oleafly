import { expect } from "./fixtures";

// The plugin's page handle (structural: only what the helpers need).
export interface Page {
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  fill(selector: string, text: string): Promise<void>;
  press(selector: string, key: string): Promise<void>;
  evaluate<T = unknown>(expression: string): Promise<T>;
  waitForFunction(expression: string, timeout?: number): Promise<unknown>;
  locator(selector: string): unknown;
  getByTestId(id: string): unknown;
  getByText(text: string, opts?: { exact?: boolean }): { click(): Promise<void> };
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
  ) as unknown as Parameters<typeof expect>[0];
  await expect(library).toBeVisible({ timeout: 30_000 });
  const hasWelcome = await page.evaluate<boolean>(
    `!!document.querySelector('[data-testid="create-first-project"]')`,
  );
  await page.click(hasWelcome ? '[data-testid="create-first-project"]' : '[data-testid="new-project"]');
  const gallery = page.locator('[data-testid="template-gallery"]') as unknown as Parameters<
    typeof expect
  >[0];
  await expect(gallery).toBeVisible({ timeout: 30_000 });
}

// Positions the caret with the DOM Selection API (which CodeMirror syncs
// into its own state) and inserts via execCommand('insertText'), which
// CodeMirror 6 treats as real user input - so the store sync, autosave,
// and linters all fire exactly as if the user typed it.
export async function typeInEditorAfter(
  page: Page,
  anchorText: string,
  text: string,
  occurrence = 1,
) {
  const ok = await page.evaluate<boolean>(
    `(() => {
      const content = document.querySelector('.cm-content');
      if (!content) return false;
      content.focus();
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let node;
      let seen = 0;
      while ((node = walker.nextNode())) {
        const i = node.textContent.indexOf(${JSON.stringify(anchorText)});
        if (i >= 0 && ++seen === ${occurrence}) {
          const range = document.createRange();
          range.setStart(node, i + ${JSON.stringify(anchorText)}.length);
          range.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          return document.execCommand('insertText', false, ${JSON.stringify(text)});
        }
      }
      return false;
    })()`,
  );
  if (!ok) throw new Error("typeInEditorAfter: anchor " + JSON.stringify(anchorText) + " not found in editor");
}

async function pollCompiledPdf(page: Page, predicate: string, timeoutMs: number, onTimeout: string) {
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
  await page.fill("#new-project-name", name);
  await page.click('[data-testid="create-project"]');
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
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

// Clicking a rail tab always reveals the sidebar; re-clicking the active tab
// collapses it, and that collapsed state persists across restarts.
export async function openRailTab(page: Page, ariaLabel: string) {
  const sel = JSON.stringify(`[aria-label=${JSON.stringify(ariaLabel)}]`);
  // Desired end state: this tab is ACTIVE (bg-accent implies the sidebar is
  // open on it). Click only when not there yet, then wait for the state to
  // commit - a blind click-then-probe races React and can collapse the
  // sidebar when the tab was already active.
  const activeExpr = `(() => {
    const b = document.querySelector(${sel});
    return !!b && b.classList.contains('bg-accent')
      && !!document.querySelector('[aria-label="Hide sidebar"]');
  })()`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const active = await page.evaluate<boolean>(activeExpr);
    if (active) return;
    await page.evaluate(
      `(() => { const b = document.querySelector(${sel}); if (b) b.click(); return true; })()`,
    );
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
  ) as unknown as Parameters<typeof expect>[0];
  await expect(library).toBeVisible({ timeout: 30_000 });
  await page.click(`button[aria-label=${JSON.stringify(`Open ${name}`)}]`);
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
    const ok = await page.evaluate<boolean>(`!!(${expression})`);
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
      throw new Error(`editor never contained: ${needle}`);
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
  await openRailTab(page, "Git");
  const gated = await page.evaluate<boolean>(
    `document.body.innerText.includes('Connect GitHub to continue')`,
  );
  if (!gated) return;
  // The gate's link opens Settings -> GitHub; the PAT input hides behind the
  // "Advanced" disclosure there. Right after a disconnect the section can
  // briefly render a transient state, so retry the link once if needed.
  await page.getByText("Use a personal access token instead").click();
  try {
    await page.waitForFunction(
      `document.body.innerText.includes('Advanced: use a personal access token')`,
      10_000,
    );
  } catch {
    await page.getByText("Use a personal access token instead").click();
    await page.waitForFunction(
      `document.body.innerText.includes('Advanced: use a personal access token')`,
      10_000,
    );
  }
  await page.getByText("Advanced: use a personal access token").click();
  await page.fill('input[placeholder="ghp_…"]', token);
  await page.getByText("Connect", { exact: true }).click();
  // Connected: the account card renders with a Disconnect button.
  await page.waitForFunction(
    `document.body.innerText.includes('Disconnect')`,
    20_000,
  );
  await page.click('[aria-label="Close settings"]');
  await openRailTab(page, "Git");
  await page.waitForFunction(
    `!document.body.innerText.includes('Connect GitHub to continue')`,
    10_000,
  );
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
  await openRailTab(page, "Chat / AI Assistant");
  const ready = await page.evaluate<boolean>(
    `!!document.querySelector('textarea[placeholder*="Ask AI"], textarea[placeholder*="Describe a figure"]')`,
  );
  if (ready) return;
  await openSettings(page, "ai");
  await expandProviderCard(page);
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
        `return Array.from(card.querySelectorAll('button')).some(b => ['Save', 'Use'].includes(b.textContent.trim()));`,
      ),
      5_000,
    )
    .catch(() => {});
  const clicked = await page.evaluate<boolean>(
    inProviderCard(`
      const btn = Array.from(card.querySelectorAll('button'))
        .find(b => ['Save', 'Use'].includes(b.textContent.trim()));
      if (!btn) return false;
      btn.click();
      return true;
    `),
  );
  if (clicked) {
    await page.waitForFunction(
      inProviderCard(`return (card.textContent || '').includes('Active');`),
      10_000,
    );
  }
  await page.click('[aria-label="Close settings"]');
  await openRailTab(page, "Chat / AI Assistant");
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
  ) as unknown as Parameters<typeof expect>[0];
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
    // Verify the section actually activated (the nav button gets
    // aria-current="page"); the section click can miss through the bridge, and
    // an un-navigated modal leaves the wrong panel showing. Retry once.
    const active = page.locator(`${sel}[aria-current="page"]`) as unknown as Parameters<
      typeof expect
    >[0];
    await page.click(sel);
    const navigated = await expect(active)
      .toBeVisible({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!navigated) {
      await page.click(sel).catch(() => {});
      await expect(active).toBeVisible({ timeout: 5_000 });
    }
  }
}

export async function paletteItems(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(
    `Array.from(document.querySelectorAll('[cmdk-item]')).map(e => e.textContent.trim())`,
  );
}

// Uses a coordinate mouse click (CodeMirror's own mouse handling; never
// mutates the document) and searches line-level text, so lint/decoration
// spans that split text nodes (e.g. spellcheck squiggles) cannot hide the
// anchor.
export async function caretIn(
  page: Page,
  anchorText: string,
  occurrence = 1,
  where: "start" | "end" = "start",
) {
  const ok = await page.evaluate<boolean>(
    `(() => {
      const lines = Array.from(document.querySelectorAll('.cm-content .cm-line'));
      let seen = 0;
      for (const line of lines) {
        let idx = -1;
        while ((idx = line.textContent.indexOf(ANCHOR, idx + 1)) >= 0) {
          if (++seen !== OCC) continue;
          // Map the line-level offset back to a concrete text node.
          const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
          let node, acc = 0;
          const target = WHERE === 'end' ? idx + ANCHOR.length - 1 : idx + 1;
          while ((node = walker.nextNode())) {
            const len = node.textContent.length;
            if (acc + len > target) {
              const range = document.createRange();
              range.setStart(node, target - acc);
              range.setEnd(node, Math.min(target - acc + 1, len));
              const r = range.getClientRects()[0] || range.getBoundingClientRect();
              const x = WHERE === 'end' ? r.right - 1 : r.left + 1;
              const y = r.top + r.height / 2;
              const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1, detail: 1 };
              const t = document.elementFromPoint(x, y) || line;
              t.dispatchEvent(new MouseEvent('mousedown', opts));
              document.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, opts, { buttons: 0 })));
              return true;
            }
            acc += len;
          }
          return false;
        }
      }
      return false;
    })()`
      .replaceAll("ANCHOR", JSON.stringify(anchorText))
      .replaceAll("WHERE", JSON.stringify(where))
      .replace("OCC", String(occurrence)),
  );
  if (!ok) throw new Error("caretIn: anchor " + JSON.stringify(anchorText) + " not found");

  // The synthetic mouse events place the caret through CodeMirror's DOM
  // observer; verify the selection actually landed on the anchor's line so a
  // missed placement fails here instead of corrupting the document at the
  // original caret position (e.g. inserting before \documentclass).
  const placed = `(() => {
    const sel = window.getSelection();
    const node = sel && sel.anchorNode;
    if (!node) return false;
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const line = el && el.closest ? el.closest('.cm-line') : null;
    return !!line && line.textContent.includes(${JSON.stringify(anchorText)});
  })()`;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await page.evaluate<boolean>(placed)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    "caretIn: selection did not land on the line containing " + JSON.stringify(anchorText),
  );
}

export async function currentTheme(page: Page): Promise<"light" | "dark"> {
  return page.evaluate<"light" | "dark">(
    `document.documentElement.classList.contains('dark') ? 'dark' : 'light'`,
  );
}
