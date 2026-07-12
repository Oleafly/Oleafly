/** Shared helpers for driving the real app. All of these operate on the live
 *  webview; nothing is mocked. */

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

/** Dispatch a global keyboard shortcut on window (the app's own handlers for
 *  Cmd+K / Cmd+Shift+F listen on window keydown). */
export async function pressGlobal(
  page: Page,
  key: string,
  mods: { meta?: boolean; shift?: boolean } = {},
) {
  await page.evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, metaKey: ${!!mods.meta}, shiftKey: ${!!mods.shift}, bubbles: true, cancelable: true }))`,
  );
}

/** Open the template gallery from wherever the library currently is
 *  (first-run welcome button, or the header button once projects exist). */
export async function openGallery(page: Page) {
  const hasWelcome = await page.evaluate<boolean>(
    `!!document.querySelector('[data-testid="create-first-project"]')`,
  );
  await page.click(hasWelcome ? '[data-testid="create-first-project"]' : '[data-testid="new-project"]');
}

/** Insert text into the CodeMirror editor immediately after `anchorText`.
 *  Positions the caret with the DOM Selection API (which CodeMirror syncs
 *  into its own state) and inserts via execCommand('insertText'), which
 *  CodeMirror 6 treats as real user input - so the store sync, autosave,
 *  and linters all fire exactly as if the user typed it. */
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

/** Make sure the sidebar is expanded on the given rail tab (clicking a rail
 *  tab always reveals the sidebar; re-clicking the active tab collapses it,
 *  and that collapsed state persists across restarts). */
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
      /* re-evaluate and click again */
    }
  }
  throw new Error(`openRailTab: ${ariaLabel} never became the active tab`);
}

/** Open a project from the library by its book title. The test fixture
 *  reloads the app to the library before every test, so specs that need the
 *  editor start here — exactly like a user re-opening their document. */
export async function openProject(page: Page & { getByText(t: string): { click(): Promise<void> } }, name: string) {
  await page.getByText(name).click();
}

/** Insert text at the very start of the CodeMirror document (fresh files). */
export async function typeInEditorAtStart(page: Page, text: string) {
  await page.evaluate(
    `(() => {
      const content = document.querySelector('.cm-content');
      content.focus();
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.setStart(content, 0);
      range.collapse(true);
      sel.addRange(range);
      return document.execCommand('insertText', false, ${JSON.stringify(text)});
    })()`,
  );
}

/** Wait for a JS expression beyond the plugin's ~30s server-side cap on
 *  wait_for_function: poll evaluate() client-side instead. Use for anything
 *  that can take longer than 30s (AI streaming, cold compiles). */
export async function waitLong(page: Page, expression: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await page.evaluate<boolean>(`!!(${expression})`);
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`waitLong timeout: ${expression}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Start a clean conversation in the (connected) chat panel. Conversations
 *  persist across panel remounts by design, so tests that assert on a fresh
 *  reply must begin with a real New-chat click or a restored transcript can
 *  satisfy their waits. */
export async function newChat(page: Page) {
  await page.evaluate(
    `(() => {
      const b = document.querySelector('[aria-label="New chat"]');
      if (b) b.click();
      return 1;
    })()`,
  );
}

/** Fill a TEXTAREA as real input. The plugin's fill() uses the
 *  HTMLInputElement value setter and throws on textareas; use the textarea
 *  prototype setter + an input event so React controlled state updates. */
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

/** Connect GitHub through the real settings UI (PAT route) if the git panel
 *  is still showing its onboarding gate. Reads E2E_GITHUB_TOKEN. */
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

/** Expand the E2E_AI_PROVIDER card inside the OPEN settings modal and return
 *  a serialized handle strategy. Every interaction with the card must be
 *  scoped to it: OpenAI and Z.AI share the "sk-…" input placeholder and a
 *  "Save" button, and a page-wide selector once saved the Z.AI key into the
 *  OpenAI card and silently switched the active provider (HTTP 401s). */
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

/** Run a snippet against the E2E_AI_PROVIDER card's root element. The card is
 *  the header button's closest .rounded-lg; \`card\` is in scope. */
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

/** Connect the AI provider through the real settings UI if the chat panel is
 *  still showing its onboarding gate. Reads E2E_AI_TOKEN / E2E_AI_PROVIDER
 *  (default "Z.AI"); the key lands only in the hermetic test config. All
 *  clicks and fills are scoped to the provider's own card. */
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

/** Open the settings modal (rail gear) at a section. */
export async function openSettings(page: Page, section?: string) {
  await page.click('[aria-label="Settings"]');
  if (section) await page.click(`[data-testid="settings-section-${section}"]`);
}

/** All command-palette item labels currently rendered. */
export async function paletteItems(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(
    `Array.from(document.querySelectorAll('[cmdk-item]')).map(e => e.textContent.trim())`,
  );
}

/** Place the caret inside the nth `anchorText` via a coordinate mouse click
 *  (CodeMirror's own mouse handling; never mutates the document). Searches
 *  line-level text, so lint/decoration spans that split text nodes (e.g.
 *  spellcheck squiggles) cannot hide the anchor. */
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
}

/** The current app theme, read from the real DOM root. */
export async function currentTheme(page: Page): Promise<"light" | "dark"> {
  return page.evaluate<"light" | "dark">(
    `document.documentElement.classList.contains('dark') ? 'dark' : 'light'`,
  );
}
