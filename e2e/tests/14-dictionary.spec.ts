import { test, expect } from "../fixtures";
import {
  createBlankProject,
  openSettings,
  typeInEditorAfter,
} from "../helpers";

const WORD = "Qwertzuiopz";
const NAME = `E2E Dictionary ${Date.now().toString(36)}`;

test("misspellings get squiggles; ignore clears them; un-ignore brings them back", async ({
  tauriPage,
}) => {
  await createBlankProject(tauriPage, NAME);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  // A word no dictionary knows. Linting is debounced + lazy-loads WASM.
  await typeInEditorAfter(tauriPage, "here.", ` ${WORD}.`);
  const targetLint = `Array.from(document.querySelectorAll('.cm-lintRange')).find(
    (mark) => mark.textContent?.includes(${JSON.stringify(WORD)})
  )`;
  await tauriPage.waitForFunction(`!!(${targetLint})`, 60_000);

  const hovered = await tauriPage.evaluate<boolean>(
    `(() => {
      const el = ${targetLint};
      if (!(el instanceof HTMLElement)) return false;
      const r = el.getBoundingClientRect();
      const opts = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      el.dispatchEvent(new MouseEvent('mousemove', opts));
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      return true;
    })()`,
  );
  expect(hovered).toBe(true);
  await expect(tauriPage.getByText("in this project")).toBeVisible({ timeout: 15_000 });
  await tauriPage.evaluate(`(() => {
    const action = Array.from(document.querySelectorAll('button')).find(
      (button) =>
        button.textContent?.includes(${JSON.stringify(WORD)}) &&
        button.textContent?.includes('in this project')
    );
    if (!(action instanceof HTMLElement)) {
      throw new Error('Project dictionary action not found for ${WORD}');
    }
    action.click();
    return true;
  })()`);

  await tauriPage.waitForFunction(
    `Promise.all([
      import("/src/lib/dictionary.ts"),
      import("/src/store/files.ts"),
    ]).then(([{ useDictionary }, { useFilesStore }]) => {
      const projectId = useFilesStore.getState().projectId;
      return !!projectId &&
        (useDictionary.getState().ignored[projectId] || []).includes(${JSON.stringify(WORD)});
    })`,
    30_000,
  );
  await tauriPage.waitForFunction(`!(${targetLint})`, 30_000);

  await openSettings(tauriPage, "dictionary");
  // Project-scoped ignores live in the "Project ignores" tab; the section
  // defaults to the global tab. Enter reaches Radix's keydown tab activation.
  const projectsTab = tauriPage.locator('[data-testid="dictionary-tab-projects"]');
  await projectsTab.focus();
  await projectsTab.press("Enter");
  await expect(tauriPage.locator(`[aria-label="Stop ignoring ${WORD}"]`)).toBeVisible();
  // The webview's localStorage outlives the per-run data dir, so stale projects
  // from earlier runs can also list this word. Scope the click to this run's
  // project group (headed by its unique name) or a bare aria-label selector may
  // un-ignore the word for a stale project instead.
  await tauriPage.evaluate(`(() => {
    const heading = Array.from(document.querySelectorAll('h4')).find(
      (h) => h.textContent === ${JSON.stringify(NAME)}
    );
    const btn = heading?.parentElement?.querySelector('[aria-label="Stop ignoring ${WORD}"]');
    if (!(btn instanceof HTMLElement)) throw new Error('Stop-ignoring button not found for ${WORD} in this project');
    btn.click();
  })()`);
  await tauriPage.waitForFunction(
    `Promise.all([
      import("/src/lib/dictionary.ts"),
      import("/src/store/files.ts"),
    ]).then(([{ useDictionary }, { useFilesStore }]) => {
      const projectId = useFilesStore.getState().projectId;
      return !!projectId &&
        !(useDictionary.getState().ignored[projectId] || []).includes(${JSON.stringify(WORD)});
    })`,
    10_000,
  );
  await tauriPage.click('[aria-label="Close settings"]');
  await tauriPage.waitForFunction(`!!(${targetLint})`, 60_000);
});
