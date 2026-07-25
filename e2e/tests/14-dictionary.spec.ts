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
  await expect(tauriPage.locator(`[aria-label="Stop ignoring ${WORD}"]`)).toBeVisible();
  await tauriPage.click(`[aria-label="Stop ignoring ${WORD}"]`);
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
