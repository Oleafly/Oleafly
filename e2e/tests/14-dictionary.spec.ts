import { test, expect } from "../fixtures";
import {
  createBlankProject,
  expectDesktopShellAnchored,
  openSettings,
  typeInEditorAfter,
} from "../helpers";

const WORD = "Qwertzuiopz";
const NAME = `E2E Dictionary ${Date.now().toString(36)}`;

test("every shipped Hunspell pack loads through production and supports spell, suggest, and user words", async ({
  tauriPage,
}) => {
  const results = await tauriPage.evaluate<
    {
      locale: string;
      known: boolean;
      misspelled: boolean;
      suggestions: string[];
      added: boolean;
      isolated: boolean;
      expectedSuggestion: string;
    }[]
  >(`(async () => {
    const { loadHunspellDictionary } = await import("/src/lib/proofreading/hunspell.ts");
    const cases = [
      ["en_US", "color", "colur", "color"],
      ["en_GB", "colour", "colur", "colour"],
      ["en_AU", "colour", "colur", "colour"],
      ["de_DE", "Farbe", "Farbee", "Farbe"],
      ["fr_FR", "couleur", "couleurr", "couleur"],
    ];
    const output = [];
    for (const [locale, knownWord, typo, expectedSuggestion] of cases) {
      const checker = await loadHunspellDictionary(locale);
      const userWord = "Oleaflyruntimeword";
      let known = false;
      let misspelled = false;
      let suggestions = [];
      let added = false;
      try {
        const beforeAdd = checker.spell(userWord);
        checker.addWord(userWord);
        const afterAdd = checker.spell(userWord);
        known = checker.spell(knownWord);
        misspelled = !checker.spell(typo);
        suggestions = checker.suggest(typo);
        added = !beforeAdd && afterAdd;
      } finally {
        checker.dispose();
      }
      // Runtime user words must be scoped to the current checker. The app's
      // persisted ignore lists are deliberately applied outside Hunspell.
      const freshChecker = await loadHunspellDictionary(locale);
      let isolated = false;
      try {
        isolated = !freshChecker.spell(userWord);
      } finally {
        freshChecker.dispose();
      }
      output.push({
        locale,
        known,
        misspelled,
        suggestions,
        added,
        isolated,
        expectedSuggestion,
      });
    }
    return output;
  })()`);

  for (const result of results) {
    expect(result.known, `${result.locale} known word`).toBe(true);
    expect(result.misspelled, `${result.locale} typo`).toBe(true);
    expect(result.added, `${result.locale} addWord`).toBe(true);
    expect(result.isolated, `${result.locale} user-word isolation`).toBe(true);
    expect(
      result.suggestions,
      `${result.locale} suggestions`,
    ).toContain(result.expectedSuggestion);
  }
});

test("misspellings get squiggles; ignore clears them; un-ignore brings them back", async ({
  tauriPage,
}) => {
  await createBlankProject(tauriPage, NAME);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const activeProjectId = await tauriPage.evaluate<string>(
    `document.querySelector('[data-e2e-project-id]')?.dataset.e2eProjectId ?? ""`,
  );
  expect(activeProjectId).not.toBe("");

  // A word no dictionary knows. Linting is debounced + lazy-loads WASM.
  await typeInEditorAfter(tauriPage, "here.", ` ${WORD}.`);
  const targetLint = `Array.from(document.querySelectorAll('.cm-lintRange')).find(
    (mark) => mark.textContent?.includes(${JSON.stringify(WORD)})
  )`;
  const targetDiagnostic =
    `window.__e2eHasProofreadingDiagnostic?.(${JSON.stringify(WORD)}) === true`;
  await tauriPage.waitForFunction(`!!(${targetLint})`, 60_000);

  // The Tauri Playwright socket bridge does not synthesize the pointer dwell
  // sequence that CodeMirror's delayed hoverTooltip requires. Resolve the
  // tooltip from the same production source at the diagnostic's document
  // position, then mount its real DOM so the action path remains end-to-end.
  await tauriPage.waitForFunction(
    `typeof window.__e2eMountProofreadingCard === "function"`,
    20_000,
  );
  const openedCard = await tauriPage.evaluate<boolean>(
    `window.__e2eMountProofreadingCard(${JSON.stringify(WORD)})`,
  );
  expect(openedCard).toBe(true);
  const proofreadingCard = tauriPage.locator(".cm-proofread-card");
  await expect(proofreadingCard).toBeVisible({ timeout: 15_000 });
  const projectIgnore = proofreadingCard.locator(".cm-proofread-ignore").first();
  await expect(projectIgnore).toHaveText("Ignore");
  // The production card intentionally applies on mousedown so CodeMirror
  // cannot reclaim focus and remove the tooltip before a later click. The
  // Tauri bridge's locator click invokes HTMLElement.click() and therefore
  // skips that earlier event; dispatch the exact production event.
  await tauriPage.evaluate(`(() => {
    const card = document.querySelector('[data-e2e-proofreading-card="true"]');
    const button = card?.querySelector('.cm-proofread-ignore');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Project ignore action is unavailable");
    }
    button.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }));
  })()`);
  await expectDesktopShellAnchored(tauriPage);
  await tauriPage.evaluate(
    `document.querySelector('[data-e2e-proofreading-card="true"]')?.remove()`,
  );

  // The real tooltip manager re-focuses the editor after an action and causes
  // this refresh as part of its teardown. Our deterministic, directly mounted
  // card has no manager, so flush the same public refresh explicitly.
  await tauriPage.evaluate(`window.__e2eRefreshEditorLints()`);
  // CodeMirror recycles line DOM independently of the lint state, so a
  // detached/reused `.cm-lintRange` is not a reliable absence selector.
  // Query the production diagnostic source for the active editor instead.
  await expect
    .poll(
      () =>
        tauriPage.evaluate<boolean>(`!(${targetDiagnostic})`),
      { timeout: 30_000 },
    )
    .toBe(true);

  await openSettings(tauriPage, "dictionary");
  // Project-scoped ignores live in the "Project ignores" tab; the section
  // defaults to the global tab. Enter reaches Radix's keydown tab activation.
  const projectsTab = tauriPage.locator('[data-testid="dictionary-tab-projects"]');
  await projectsTab.focus();
  await projectsTab.press("Enter");
  await expect(tauriPage.locator(`[aria-label="Stop ignoring ${WORD}"]`)).toBeVisible();
  // The webview's localStorage outlives the per-run data dir, so stale projects
  // from earlier runs can also list this word. Scope the click to the exact
  // active project ID rather than relying on a repeated project name.
  await tauriPage.evaluate(`(() => {
    const section = document.querySelector(
      '[aria-labelledby="dictionary-project-${activeProjectId}"]'
    );
    const btn = section?.querySelector('[aria-label="Stop ignoring ${WORD}"]');
    if (!(btn instanceof HTMLElement)) throw new Error('Stop-ignoring button not found for ${WORD} in this project');
    btn.click();
  })()`);
  await tauriPage.click('[aria-label="Close settings"]');
  await expect
    .poll(
      () => tauriPage.evaluate<boolean>(targetDiagnostic),
      { timeout: 60_000 },
    )
    .toBe(true);
  await tauriPage.waitForFunction(`!!(${targetLint})`, 60_000);
  await expectDesktopShellAnchored(tauriPage);
});
