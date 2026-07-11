/** Shared helpers for driving the real app. All of these operate on the live
 *  webview; nothing is mocked. */

// The plugin's page handle (structural: only what the helpers need).
export interface Page {
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  fill(selector: string, text: string): Promise<void>;
  press(selector: string, key: string): Promise<void>;
  evaluate<T = unknown>(expression: string): Promise<T>;
  locator(selector: string): unknown;
  getByTestId(id: string): unknown;
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
export async function typeInEditorAfter(page: Page, anchorText: string, text: string) {
  const ok = await page.evaluate<boolean>(
    `(() => {
      const content = document.querySelector('.cm-content');
      if (!content) return false;
      content.focus();
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.textContent.indexOf(${JSON.stringify(anchorText)});
        if (i >= 0) {
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

/** Open a project from the library by its book title. The test fixture
 *  reloads the app to the library before every test, so specs that need the
 *  editor start here — exactly like a user re-opening their document. */
export async function openProject(page: Page & { getByText(t: string): { click(): Promise<void> } }, name: string) {
  await page.getByText(name).click();
}

/** The current app theme, read from the real DOM root. */
export async function currentTheme(page: Page): Promise<"light" | "dark"> {
  return page.evaluate<"light" | "dark">(
    `document.documentElement.classList.contains('dark') ? 'dark' : 'light'`,
  );
}
