import type { TauriPage } from "@srsholmes/tauri-playwright";
import { test, expect } from "../fixtures";
import {
  createBlankProject,
  expectDesktopShellAnchored,
  openProject,
  openSettings,
  replaceEditorSource,
} from "../helpers";

interface SpellSnapshot {
  phase: string;
  locale: string | null;
  words: string[];
  suggestions: Record<string, string[]>;
}

function runId(): string {
  let remaining = Date.now();
  let id = "";
  do {
    id = String.fromCharCode(97 + (remaining % 26)) + id;
    remaining = Math.floor(remaining / 26);
  } while (remaining > 0);
  return id;
}

const RUN = runId();
const FRENCH_SOURCE = String.raw`\documentclass{article}
\begin{document}
bonjur monde
\end{document}
`;
const ENGLISH_SOURCE = String.raw`\documentclass{article}
\begin{document}
helo world
\end{document}
`;
const SPANISH_SOURCE = String.raw`\documentclass{article}
\begin{document}
hola holaa
\end{document}
`;

async function spellSnapshot(page: TauriPage): Promise<SpellSnapshot> {
  return page.evaluate<SpellSnapshot>(
    `import("/src/store/proofreading.ts").then(({ useProofreadingStore }) => {
      const state = useProofreadingStore.getState().source;
      const spelling = state.diagnostics.filter((d) => d.source === "hunspell");
      return {
        phase: state.phase,
        locale: state.activeDictionaryLocale,
        words: spelling.map((d) => d.word),
        suggestions: Object.fromEntries(
          spelling.map((d) => [d.word, d.suggestions.map((s) => s.text)]),
        ),
      };
    })`,
  );
}

async function waitForSpelling(
  page: TauriPage,
  accept: (snapshot: SpellSnapshot) => boolean,
  reason: string,
): Promise<SpellSnapshot> {
  const deadline = Date.now() + 60_000;
  let last: SpellSnapshot | null = null;
  while (Date.now() < deadline) {
    last = await spellSnapshot(page);
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${reason}: ${JSON.stringify(last)}`);
}

async function setSpellcheckOnly(page: TauriPage, locale: string) {
  await page.evaluate(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) => {
      const state = useSettingsStore.getState();
      if (!state.spellcheck) state.toggleSpellcheck();
      state.setHarper(false);
      state.setDictionaryLocale(${JSON.stringify(locale)});
    })`,
  );
}

async function chooseOption(
  page: TauriPage,
  trigger: string,
  label: string,
): Promise<void> {
  const option = `[role="listbox"][data-state="open"] [role="option"][data-label=${JSON.stringify(label)}]`;
  await page.click(trigger);
  await page.waitForFunction(
    `!!document.querySelector(${JSON.stringify(option)})`,
    10_000,
  );
  await page.evaluate(
    `document.querySelector(${JSON.stringify(option)})?.scrollIntoView({ block: "nearest" })`,
  );
  await page.click(option);
}

async function setProjectLanguage(page: TauriPage, label: string) {
  await page.click('[aria-label="Project info"]');
  await page.waitForFunction(
    `!!document.querySelector('[data-testid="project-dictionary-locale"]')`,
    10_000,
  );
  await chooseOption(page, '[data-testid="project-dictionary-locale"]', label);
  await page.keyboard.press("Escape");
}

async function returnToLibrary(page: TauriPage): Promise<void> {
  await page.click('[title="Back to library"]');
  await page.waitForFunction(
    `!!document.querySelector('[data-testid="library"][data-projects-loaded="true"]')`,
    30_000,
  );
}

test("a project keeps its own spell-check language while the app setting stays English", async ({
  tauriPage,
}) => {
  await createBlankProject(tauriPage, `E2E Dict French ${RUN}`);
  await setSpellcheckOnly(tauriPage, "en_US");
  await replaceEditorSource(tauriPage, FRENCH_SOURCE);
  await waitForSpelling(
    tauriPage,
    (snapshot) => snapshot.phase === "ready" && snapshot.locale === "en_US",
    "the first analysis did not settle on the app language",
  );

  await setProjectLanguage(tauriPage, "French (France)");
  const french = await waitForSpelling(
    tauriPage,
    (snapshot) =>
      snapshot.phase === "ready" &&
      snapshot.locale === "fr_FR" &&
      snapshot.words.includes("bonjur"),
    "the project language did not reach the spelling check",
  );
  expect(french.suggestions.bonjur).toContain("bonjour");
  expect(french.words).not.toContain("monde");

  const globalLocale = await tauriPage.evaluate<string>(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) =>
      useSettingsStore.getState().dictionaryLocale
    )`,
  );
  expect(globalLocale).toBe("en_US");

  await returnToLibrary(tauriPage);
  await createBlankProject(tauriPage, `E2E Dict English ${RUN}`);
  await replaceEditorSource(tauriPage, ENGLISH_SOURCE);
  const english = await waitForSpelling(
    tauriPage,
    (snapshot) =>
      snapshot.phase === "ready" &&
      snapshot.locale === "en_US" &&
      snapshot.words.includes("helo"),
    "the second project did not fall back to the app language",
  );
  expect(english.suggestions.helo).toContain("hello");

  await openProject(tauriPage, `E2E Dict French ${RUN}`);
  await waitForSpelling(
    tauriPage,
    (snapshot) =>
      snapshot.phase === "ready" &&
      snapshot.locale === "fr_FR" &&
      snapshot.words.includes("bonjur"),
    "the stored project language did not survive reopening",
  );
  await expectDesktopShellAnchored(tauriPage);
});

test("downloading a language in Settings makes it spell check immediately", async ({
  tauriPage,
}) => {
  test.skip(
    process.env.E2E_SKIP_NETWORK === "1",
    "dictionary downloads need network access",
  );
  test.setTimeout(180_000);

  await createBlankProject(tauriPage, `E2E Dict Spanish ${RUN}`);
  await setSpellcheckOnly(tauriPage, "en_US");
  await replaceEditorSource(tauriPage, SPANISH_SOURCE);
  await waitForSpelling(
    tauriPage,
    (snapshot) => snapshot.phase === "ready" && snapshot.locale === "en_US",
    "the first analysis did not settle on the app language",
  );

  await openSettings(tauriPage, "general");
  await chooseOption(
    tauriPage,
    '[data-testid="dictionary-locale-select"]',
    "Spanish (Spain)",
  );
  await tauriPage.waitForFunction(
    `(() => {
      const trigger = document.querySelector('[data-testid="dictionary-locale-select"]');
      return trigger?.textContent?.includes("Spanish (Spain)") === true;
    })()`,
    150_000,
  );
  await tauriPage.click('[aria-label="Close settings"]');

  const spanish = await waitForSpelling(
    tauriPage,
    (snapshot) =>
      snapshot.phase === "ready" &&
      snapshot.locale === "es_ES" &&
      snapshot.words.includes("holaa"),
    "the downloaded dictionary did not reach the spelling check",
  );
  expect(spanish.words).not.toContain("hola");
  expect(spanish.suggestions.holaa).toContain("hola");
  await expectDesktopShellAnchored(tauriPage);
});
