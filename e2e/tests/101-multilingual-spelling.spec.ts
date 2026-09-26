import type { TauriPage } from "@srsholmes/tauri-playwright";
import { test, expect } from "../fixtures";
import {
  createBlankProject,
  expectDesktopShellAnchored,
  openSettings,
  replaceEditorSource,
} from "../helpers";

interface SpellSnapshot {
  phase: string;
  message: string | null;
  locale: string | null;
  words: string[];
  sources: string[];
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

const GERMAN_SOURCE = String.raw`\documentclass{article}
\usepackage[ngerman]{babel}
\begin{document}
\section{Einführung}
Die Größe der Straße überrascht die Bürger. Übungen für Schüler sind schön.
Die Bürgr warten vor dem Rathaus.
\end{document}
`;

const CZECH_SOURCE = String.raw`\documentclass{article}
\usepackage{fontspec}
\usepackage[czech]{babel}
\title{Bakalářka}
\begin{document}
\section{Skladatelnost crease patternu}
Crease pattern na listu papíru se skládá z vrcholů a hran. V místě průniků dvou
hran je právě jeden vrchol a hrany končí pouze ve vrcholu nebo na okraji papíru.
K hranám je navíc přiřazený směr ohybu hora nebo údolí. Toto přiřazení má význam
pro dané otočení papíru na rub nebo líc.

Určení skladatelsnoti je obtížné. Jellikož je problém těžký, výsledem je odhad.
Musí platit, že lze vybrat dvě stěny ve složeném stavu, které budeme dále
označovat jako horní a dolní, a stlačit je k sobě tak, že celý složený pattern
leží v jedné rovině.
\end{document}
`;

async function spellSnapshot(page: TauriPage): Promise<SpellSnapshot> {
  return page.evaluate<SpellSnapshot>(
    `import("/src/store/proofreading.ts").then(({ useProofreadingStore }) => {
      const state = useProofreadingStore.getState().source;
      return {
        phase: state.phase,
        message: state.message ?? null,
        locale: state.activeDictionaryLocale ?? null,
        words: state.diagnostics
          .filter((d) => d.source === "hunspell")
          .map((d) => d.word),
        sources: state.diagnostics.map((d) => d.source),
      };
    })`,
  );
}

async function waitForSpelling(
  page: TauriPage,
  accept: (snapshot: SpellSnapshot) => boolean,
  reason: string,
  timeout = 60_000,
): Promise<SpellSnapshot> {
  const deadline = Date.now() + timeout;
  let last: SpellSnapshot | null = null;
  while (Date.now() < deadline) {
    last = await spellSnapshot(page);
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${reason}: ${JSON.stringify(last)}`);
}

async function setProofreading(
  page: TauriPage,
  options: { harper: boolean; locale: string },
): Promise<void> {
  await page.evaluate(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) => {
      const state = useSettingsStore.getState();
      if (!state.spellcheck) state.toggleSpellcheck();
      state.setHarper(${JSON.stringify(options.harper)});
      state.setDictionaryLocale(${JSON.stringify(options.locale)});
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

function wholeWordsOnly(source: string, words: readonly string[]): string[] {
  const fragments: string[] = [];
  for (const word of words) {
    let at = source.indexOf(word);
    let whole = false;
    while (at >= 0 && !whole) {
      const before = source[at - 1] ?? " ";
      const after = source[at + word.length] ?? " ";
      whole = !/[\p{L}\p{M}]/u.test(before) && !/[\p{L}\p{M}]/u.test(after);
      at = source.indexOf(word, at + 1);
    }
    if (!whole) fragments.push(word);
  }
  return fragments;
}

async function applySuggestion(
  page: TauriPage,
  word: string,
  suggestion: string,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  let mounted = false;
  while (!mounted && Date.now() < deadline) {
    mounted = await page.evaluate<boolean>(
      `window.__e2eMountProofreadingCard?.(${JSON.stringify(word)}) === true`,
    );
    if (!mounted) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  expect(mounted, `proofreading card for ${word}`).toBe(true);
  await page.waitForFunction(
    `Array.from(document.querySelectorAll('[data-e2e-proofreading-card="true"] .cm-proofread-suggestion'))
      .some((button) => (button.textContent ?? "").includes(${JSON.stringify(suggestion)}))`,
    30_000,
  );
  await page.evaluate(
    `(() => {
      const card = document.querySelector('[data-e2e-proofreading-card="true"]');
      const action = Array.from(card?.querySelectorAll(".cm-proofread-suggestion") ?? [])
        .find((button) => (button.textContent ?? "").includes(${JSON.stringify(suggestion)}));
      action?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      card?.remove();
      window.__e2eRefreshEditorLints?.();
      return true;
    })()`,
  );
}

async function editorText(page: TauriPage): Promise<string> {
  return page.evaluate<string>(
    `import("/src/store/files.ts").then(({ useFilesStore }) => {
      const state = useFilesStore.getState();
      return state.activePath ? state.files[state.activePath]?.content ?? "" : "";
    })`,
  );
}

interface ProofreadingSettings {
  spellcheck: boolean;
  harper: boolean;
  dictionaryLocale: string;
}

let savedSettings: ProofreadingSettings | null = null;

test.beforeEach(async ({ tauriPage }) => {
  savedSettings = await tauriPage.evaluate<ProofreadingSettings>(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) => {
      const state = useSettingsStore.getState();
      return {
        spellcheck: state.spellcheck,
        harper: state.harper,
        dictionaryLocale: state.dictionaryLocale,
      };
    })`,
  );
});

test.afterEach(async ({ tauriPage }) => {
  await tauriPage
    .evaluate(
      `(() => {
        document
          .querySelectorAll('[data-e2e-proofreading-card="true"]')
          .forEach((element) => element.remove());
        return true;
      })()`,
    )
    .catch(() => undefined);
  if (!savedSettings) return;
  const saved = savedSettings;
  savedSettings = null;
  await tauriPage.evaluate(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) => {
      const state = useSettingsStore.getState();
      if (state.spellcheck !== ${JSON.stringify(saved.spellcheck)}) state.toggleSpellcheck();
      state.setHarper(${JSON.stringify(saved.harper)});
      state.setDictionaryLocale(${JSON.stringify(saved.dictionaryLocale)});
    })`,
  );
});

test("German spell checking keeps umlauts and ß inside words and skips English grammar", async ({
  tauriPage,
}) => {
  await createBlankProject(tauriPage, `E2E Spelling German ${RUN}`);
  await setProofreading(tauriPage, { harper: true, locale: "de_DE" });
  await replaceEditorSource(tauriPage, GERMAN_SOURCE);

  const german = await waitForSpelling(
    tauriPage,
    (snapshot) =>
      snapshot.phase === "ready" &&
      snapshot.locale === "de_DE" &&
      snapshot.words.includes("Bürgr"),
    "German spell checking did not settle",
  );
  expect(german.words).toEqual(["Bürgr"]);
  expect(german.sources).not.toContain("harper");

  await applySuggestion(tauriPage, "Bürgr", "Bürger");
  await expect
    .poll(() => editorText(tauriPage), { timeout: 10_000 })
    .toContain("Die Bürger warten");
  await expectDesktopShellAnchored(tauriPage);
});

test("a downloaded Czech dictionary checks a thesis without splitting words or timing out", async ({
  tauriPage,
}, testInfo) => {
  testInfo.skip(
    process.env.E2E_SKIP_NETWORK === "1",
    "dictionary downloads need network access",
  );
  test.setTimeout(240_000);

  await createBlankProject(tauriPage, `E2E Spelling Czech ${RUN}`);
  await setProofreading(tauriPage, { harper: true, locale: "en_US" });
  await replaceEditorSource(tauriPage, CZECH_SOURCE);
  await waitForSpelling(
    tauriPage,
    (snapshot) => snapshot.phase === "ready" && snapshot.locale === "en_US",
    "the first analysis did not settle on the app language",
  );

  await openSettings(tauriPage, "general");
  await chooseOption(
    tauriPage,
    '[data-testid="dictionary-locale-select"]',
    "Czech (Czechia)",
  );
  await tauriPage.waitForFunction(
    `(() => {
      const trigger = document.querySelector('[data-testid="dictionary-locale-select"]');
      return trigger?.textContent?.includes("Czech (Czechia)") === true;
    })()`,
    150_000,
  );
  await tauriPage.click('[aria-label="Close settings"]');

  const czech = await waitForSpelling(
    tauriPage,
    (snapshot) =>
      (snapshot.phase === "ready" &&
        snapshot.locale === "cs_CZ" &&
        snapshot.words.includes("skladatelsnoti")) ||
      snapshot.phase === "error" ||
      snapshot.phase === "unavailable",
    "the Czech dictionary did not reach the spelling check",
    120_000,
  );
  expect(czech.phase, czech.message ?? "").toBe("ready");
  expect(wholeWordsOnly(CZECH_SOURCE, czech.words)).toEqual([]);
  for (const correct of ["papíru", "skládá", "vrcholů", "údolí", "přiřazený", "Bakalářka"]) {
    expect(czech.words).not.toContain(correct);
  }
  expect(czech.words).toEqual(
    expect.arrayContaining(["skladatelsnoti", "Jellikož", "výsledem"]),
  );
  expect(czech.sources).not.toContain("harper");

  await applySuggestion(tauriPage, "skladatelsnoti", "skladatelnosti");
  await expect
    .poll(() => editorText(tauriPage), { timeout: 10_000 })
    .toContain("Určení skladatelnosti je obtížné");
  await expectDesktopShellAnchored(tauriPage);
});
