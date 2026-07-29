import type { TauriPage } from "@srsholmes/tauri-playwright";
import { test, expect, reloadNativePage } from "../fixtures";
import {
  createBlankProject,
  createProjectFromTemplate,
  editorSource,
  expectDesktopShellAnchored,
  openProject,
  openSettings,
  readProjectText,
  replaceEditorSource,
} from "../helpers";

type ProofreadingSurface = "source" | "visual";

interface ProofreadingDiagnosticSnapshot {
  from: number;
  to: number;
  message: string;
  kind: string;
  source: "harper" | "hunspell";
  word: string;
  suggestions: { text: string; kind: number }[];
}

interface ProofreadingSnapshot {
  phase: string;
  message: string | null;
  diagnosticCount: number;
  activeDictionaryLocale: string | null;
  identity: {
    path: string;
    revision: number;
    requestGeneration: number;
    surface: ProofreadingSurface;
  } | null;
  diagnostics: ProofreadingDiagnosticSnapshot[];
}

function alphabeticRunId(value: number): string {
  let remaining = value;
  let id = "";
  do {
    id = String.fromCharCode(97 + (remaining % 26)) + id;
    remaining = Math.floor(remaining / 26);
  } while (remaining > 0);
  return id;
}

// Dictionary fixtures must remain one lexical token. Base-36 timestamps can
// contain digits, which Hunspell correctly treats as a token boundary and
// would make an assertion for the un-split alphanumeric string impossible.
const RUN = alphabeticRunId(Date.now());
const LATEX_PROSE = String.raw`\documentclass{article}
\begin{document}
The colour of this aluminum artifact could of changed. Qwertzuiopz.
\end{document}
`;

async function proofreadingSnapshot(
  page: TauriPage,
  surface: ProofreadingSurface,
): Promise<ProofreadingSnapshot> {
  return page.evaluate<ProofreadingSnapshot>(
    `import("/src/store/proofreading.ts").then(({ useProofreadingStore }) => {
      const state = useProofreadingStore.getState()[${JSON.stringify(surface)}];
      return {
        phase: state.phase,
        message: state.message,
        diagnosticCount: state.diagnosticCount,
        activeDictionaryLocale: state.activeDictionaryLocale,
        identity: state.identity
          ? {
              path: state.identity.path,
              revision: state.identity.revision,
              requestGeneration: state.identity.requestGeneration,
              surface: state.identity.surface,
            }
          : null,
        diagnostics: state.diagnostics.map((diagnostic) => ({
          from: diagnostic.from,
          to: diagnostic.to,
          message: diagnostic.message,
          kind: diagnostic.kind,
          source: diagnostic.source,
          word: diagnostic.word,
          suggestions: diagnostic.suggestions.map((suggestion) => ({
            text: suggestion.text,
            kind: suggestion.kind,
          })),
        })),
      };
    })`,
  );
}

async function waitForProofreading(
  page: TauriPage,
  surface: ProofreadingSurface,
  predicate: (snapshot: ProofreadingSnapshot) => boolean,
  description: string,
  timeoutMs = 90_000,
): Promise<ProofreadingSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let last = await proofreadingSnapshot(page, surface);
  for (;;) {
    if (predicate(last)) return last;
    if (Date.now() > deadline) {
      throw new Error(
        `${description}; last ${surface} proofreading state:\n${JSON.stringify(last, null, 2)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    last = await proofreadingSnapshot(page, surface);
  }
}

function providers(snapshot: ProofreadingSnapshot): Set<string> {
  return new Set(snapshot.diagnostics.map((diagnostic) => diagnostic.source));
}

function hasDiagnostic(
  snapshot: ProofreadingSnapshot,
  source: "harper" | "hunspell",
  word: string,
): boolean {
  const normalized = word.toLocaleLowerCase();
  return snapshot.diagnostics.some(
    (diagnostic) =>
      diagnostic.source === source &&
      diagnostic.word.toLocaleLowerCase() === normalized,
  );
}

async function resetProofreadingState(page: TauriPage): Promise<void> {
  await page.evaluate(
    `Promise.all([
      import("/src/store/settings.ts"),
      import("/src/lib/dictionary.ts"),
    ]).then(([settings, dictionary]) => {
      const state = settings.useSettingsStore.getState();
      if (!state.spellcheck) state.toggleSpellcheck();
      state.setHarper(true);
      state.setGrammarDialect("american");
      state.setDictionaryLocale("en_US");
      state.setShowRegionalism(true);
      state.setShowWordChoice(true);
      state.setDefaultView("editor-preview");
      dictionary.useDictionary.getState().clearAll();
      document
        .querySelectorAll('[data-e2e-proofreading-card="true"]')
        .forEach((element) => element.remove());
      return true;
    })`,
  );
}

async function setProofreadingFlags(
  page: TauriPage,
  options: { spellcheck: boolean; harper: boolean },
): Promise<void> {
  await page.evaluate(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) => {
      const state = useSettingsStore.getState();
      if (state.spellcheck !== ${options.spellcheck}) state.toggleSpellcheck();
      state.setHarper(${options.harper});
      state.setShowRegionalism(true);
      state.setShowWordChoice(true);
      return true;
    })`,
  );
}

async function chooseSettingsOption(
  page: TauriPage,
  triggerLabel: string,
  optionLabel: string,
): Promise<void> {
  const trigger = `[aria-label=${JSON.stringify(triggerLabel)}]`;
  const option = `[role="option"][data-label=${JSON.stringify(optionLabel)}]`;
  await page.click(trigger);
  await page.waitForFunction(
    `!!document.querySelector(${JSON.stringify(option)})`,
    8_000,
  );
  await page.evaluate(
    `document.querySelector(${JSON.stringify(option)})?.scrollIntoView({ block: "nearest" })`,
  );
  await page.click(option);
}

async function setSettingsToggle(
  page: TauriPage,
  label: string,
  checked: boolean,
): Promise<void> {
  const selector = `[role="switch"][aria-label=${JSON.stringify(label)}]`;
  const current = await page.evaluate<boolean>(
    `document.querySelector(${JSON.stringify(selector)})?.getAttribute("aria-checked") === "true"`,
  );
  if (current !== checked) await page.click(selector);
  await page.waitForFunction(
    `document.querySelector(${JSON.stringify(selector)})?.getAttribute("aria-checked") === ${JSON.stringify(String(checked))}`,
    8_000,
  );
}

async function createProjectForFormat(
  page: TauriPage,
  format: "latex" | "markdown" | "typst",
  name: string,
): Promise<void> {
  if (format === "latex") {
    await createBlankProject(page, name);
    return;
  }
  await createProjectFromTemplate(page, `blank-${format}`, name);
}

async function returnToLibrary(page: TauriPage): Promise<void> {
  await page.click('[title="Back to library"]');
  await expect(
    page.locator('[data-testid="library"][data-projects-loaded="true"]'),
  ).toBeVisible({ timeout: 30_000 });
}

async function currentProjectId(page: TauriPage): Promise<string> {
  const projectId = await page.evaluate<string>(
    `document.querySelector("[data-e2e-project-id]")?.dataset.e2eProjectId ?? ""`,
  );
  expect(projectId).not.toBe("");
  return projectId;
}

async function activateDictionaryTab(
  page: TauriPage,
  tab: "global" | "projects",
): Promise<void> {
  const selector = `[data-testid="dictionary-tab-${tab}"]`;
  // Radix Tabs changes value from pointer-down or keyboard activation. GTK's
  // bridge can emit a terminal click without the preceding pointer-down, so
  // use the trigger's accessible Enter path for a deterministic real UI event.
  await page.press(selector, "Enter");
  await page.waitForFunction(
    `document.querySelector(${JSON.stringify(selector)})?.getAttribute("data-state") === "active"`,
    8_000,
  );
}

async function addDictionaryWord(
  page: TauriPage,
  inputLabel: string,
  word: string,
): Promise<void> {
  const selector = `[aria-label=${JSON.stringify(inputLabel)}]`;
  await page.fill(selector, word);
  // The native bridge can issue Enter in the same render turn as fill.
  // Wait until React has committed the controlled value and enabled this
  // form's submit button so the test exercises a real accepted submission.
  await page.waitForFunction(
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      const submit = input?.closest("form")?.querySelector('button[type="submit"]');
      return input instanceof HTMLInputElement &&
        input.value === ${JSON.stringify(word)} &&
        submit instanceof HTMLButtonElement &&
        !submit.disabled;
    })()`,
    8_000,
  );
  // GTK WebKit's native automation bridge can update the controlled input
  // without synthesizing the implicit form submit for Enter. Click the real
  // enabled submit control so this follows the same reliable UI path on every
  // desktop platform.
  await page.click(`${selector} + button[type="submit"]`);
  await expect(
    page.locator(`[aria-label=${JSON.stringify(`Stop ignoring ${word}`)}]`),
  ).toBeVisible({ timeout: 10_000 });
}

async function diagnosticCardVisible(
  page: TauriPage,
  text: string,
): Promise<boolean> {
  return page.evaluate<boolean>(
    `window.__e2eHasProofreadingDiagnostic?.(${JSON.stringify(text)}) === true`,
  );
}

async function applySourceSuggestion(
  page: TauriPage,
  diagnostic: ProofreadingDiagnosticSnapshot,
  suggestionText: string,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  let mounted = false;
  while (!mounted && Date.now() < deadline) {
    mounted = await page.evaluate<boolean>(
      `window.__e2eMountProofreadingCard?.(${JSON.stringify(diagnostic.word)}) === true`,
    );
    if (!mounted) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  expect(mounted, `proofreading card for ${diagnostic.word}`).toBe(true);
  await expect(page.locator(".cm-proofread-card")).toBeVisible({
    timeout: 10_000,
  });
  await page.evaluate(
    `(() => {
      const card = document.querySelector(
        '[data-e2e-proofreading-card="true"]'
      );
      const expected = ${JSON.stringify(suggestionText)};
      const action = Array.from(
        card?.querySelectorAll(".cm-proofread-suggestion") ?? []
      ).find((button) => {
        const label = button.textContent?.trim() ?? "";
        return label === expected || label.includes(expected);
      });
      if (!(action instanceof HTMLButtonElement)) {
        throw new Error("Suggestion action is unavailable: " + expected);
      }
      action.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      card?.remove();
      window.__e2eRefreshEditorLints?.();
      return true;
    })()`,
  );
}

test.afterEach(async ({ tauriPage }) => {
  await tauriPage
    .evaluate(
      `(() => {
        if (window.__e2eOriginalWorker) {
          window.Worker = window.__e2eOriginalWorker;
          delete window.__e2eOriginalWorker;
        }
        document
          .querySelectorAll('[data-e2e-proofreading-card="true"]')
          .forEach((element) => element.remove());
        return true;
      })()`,
    )
    .catch(() => {});
});

test("every Harper dialect selected in Settings produces its dialect-sensitive result", async ({
  tauriPage,
}) => {
  await resetProofreadingState(tauriPage);
  await setProofreadingFlags(tauriPage, {
    spellcheck: false,
    harper: true,
  });
  await tauriPage.evaluate(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) =>
      useSettingsStore.getState().setGrammarDialect("canadian")
    )`,
  );
  await createBlankProject(tauriPage, `E2E Harper Dialects ${RUN}`);
  await replaceEditorSource(tauriPage, LATEX_PROSE);
  await waitForProofreading(
    tauriPage,
    "source",
    (state) => state.phase === "ready" && providers(state).has("harper"),
    "initial Harper analysis did not finish",
  );

  await openSettings(tauriPage, "general");
  const cases = [
    {
      id: "american",
      label: "English (US)",
      includes: "`colour`",
      excludes: "`aluminum`",
    },
    {
      id: "british",
      label: "English (UK)",
      includes: "`aluminum`",
      excludes: "`colour`",
    },
    {
      id: "australian",
      label: "English (Australia)",
      includes: "`aluminum`",
      excludes: "`colour`",
    },
    {
      id: "canadian",
      label: "English (Canada)",
      includes: "rather than `of`",
      excludes: "`colour`|`aluminum`",
    },
    {
      id: "indian",
      label: "English (India)",
      includes: "`aluminum`",
      excludes: "`colour`",
    },
  ] as const;

  for (const dialect of cases) {
    const before =
      (await proofreadingSnapshot(tauriPage, "source")).identity
        ?.requestGeneration ?? 0;
    await chooseSettingsOption(
      tauriPage,
      "Proofreading English dialect",
      dialect.label,
    );
    const snapshot = await waitForProofreading(
      tauriPage,
      "source",
      (state) =>
        state.phase === "ready" &&
        (state.identity?.requestGeneration ?? 0) > before &&
        providers(state).has("harper") &&
        !providers(state).has("hunspell"),
      `${dialect.id} Harper result did not replace the previous generation`,
    );
    const selected = await tauriPage.evaluate<string>(
      `import("/src/store/settings.ts").then(({ useSettingsStore }) =>
        useSettingsStore.getState().grammarDialect
      )`,
    );
    expect(selected).toBe(dialect.id);
    const messages = snapshot.diagnostics
      .map((diagnostic) => diagnostic.message)
      .join("\n");
    expect(messages).toContain("rather than `of`");
    expect(messages).toContain(dialect.includes);
    for (const excluded of dialect.excludes.split("|")) {
      expect(messages).not.toContain(excluded);
    }
  }
  await tauriPage.click('[aria-label="Close settings"]');
  await expectDesktopShellAnchored(tauriPage);
});

test("every Hunspell locale selected in Settings returns its locale-sensitive suggestion", async ({
  tauriPage,
}) => {
  await resetProofreadingState(tauriPage);
  await setProofreadingFlags(tauriPage, {
    spellcheck: true,
    harper: false,
  });
  await tauriPage.evaluate(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) =>
      useSettingsStore.getState().setDictionaryLocale("fr_FR")
    )`,
  );
  await createBlankProject(tauriPage, `E2E Hunspell Locales ${RUN}`);
  await replaceEditorSource(
    tauriPage,
    String.raw`\documentclass{article}
\begin{document}
colur Farbee couleurr
\end{document}
`,
  );
  await waitForProofreading(
    tauriPage,
    "source",
    (state) =>
      state.phase === "ready" &&
      state.activeDictionaryLocale === "fr_FR",
    "initial Hunspell analysis did not finish",
  );
  await openSettings(tauriPage, "general");

  const cases = [
    ["en_US", "English (US)", "colur", "color"],
    ["en_GB", "English (UK)", "colur", "colour"],
    ["en_AU", "English (Australia)", "colur", "colour"],
    ["de_DE", "Deutsch", "Farbee", "Farbe"],
    ["fr_FR", "Français", "couleurr", "couleur"],
  ] as const;
  for (const [locale, label, typo, expectedSuggestion] of cases) {
    const before =
      (await proofreadingSnapshot(tauriPage, "source")).identity
        ?.requestGeneration ?? 0;
    await chooseSettingsOption(
      tauriPage,
      "Proofreading spelling dictionary",
      label,
    );
    const snapshot = await waitForProofreading(
      tauriPage,
      "source",
      (state) =>
        state.phase === "ready" &&
        state.activeDictionaryLocale === locale &&
        (state.identity?.requestGeneration ?? 0) > before &&
        hasDiagnostic(state, "hunspell", typo),
      `${locale} Hunspell result did not replace the previous generation`,
    );
    expect(providers(snapshot)).toEqual(new Set(["hunspell"]));
    const diagnostic = snapshot.diagnostics.find(
      (entry) =>
        entry.source === "hunspell" &&
        entry.word.toLocaleLowerCase() === typo.toLocaleLowerCase(),
    );
    expect(
      diagnostic?.suggestions.map((suggestion) => suggestion.text),
      `${locale} suggestions for ${typo}`,
    ).toContain(expectedSuggestion);
  }
  await tauriPage.click('[aria-label="Close settings"]');
  await expectDesktopShellAnchored(tauriPage);
});

test("Spellcheck and Harper Settings toggles remove and restore their editor decorations", async ({
  tauriPage,
}) => {
  await resetProofreadingState(tauriPage);
  await createBlankProject(tauriPage, `E2E Proofreading Toggles ${RUN}`);
  await replaceEditorSource(
    tauriPage,
    String.raw`\documentclass{article}
\begin{document}
This could of changed. TypeScript.
\end{document}
`,
  );
  await waitForProofreading(
    tauriPage,
    "source",
    (state) =>
      state.phase === "ready" &&
      providers(state).has("harper") &&
      providers(state).has("hunspell"),
    "combined proofreading did not finish",
  );
  await expect
    .poll(() => diagnosticCardVisible(tauriPage, "TypeScript"), {
      timeout: 20_000,
    })
    .toBe(true);

  await openSettings(tauriPage, "general");
  await setSettingsToggle(tauriPage, "Spellcheck", false);
  await waitForProofreading(
    tauriPage,
    "source",
    (state) =>
      state.phase === "ready" &&
      providers(state).has("harper") &&
      !providers(state).has("hunspell"),
    "spellcheck decorations were not removed",
  );
  await expect
    .poll(() => diagnosticCardVisible(tauriPage, "TypeScript"), {
      timeout: 20_000,
    })
    .toBe(false);

  await setSettingsToggle(
    tauriPage,
    "Grammar & style (Harper)",
    false,
  );
  await waitForProofreading(
    tauriPage,
    "source",
    (state) => state.phase === "idle" && state.diagnosticCount === 0,
    "disabling both proofreading providers did not clear the editor",
  );
  expect(await diagnosticCardVisible(tauriPage, "of")).toBe(false);

  await setSettingsToggle(tauriPage, "Spellcheck", true);
  await waitForProofreading(
    tauriPage,
    "source",
    (state) =>
      state.phase === "ready" &&
      providers(state).has("hunspell") &&
      !providers(state).has("harper") &&
      hasDiagnostic(state, "hunspell", "TypeScript"),
    "spellcheck decorations did not return",
  );
  await expect
    .poll(() => diagnosticCardVisible(tauriPage, "TypeScript"), {
      timeout: 20_000,
    })
    .toBe(true);

  await setSettingsToggle(
    tauriPage,
    "Grammar & style (Harper)",
    true,
  );
  await waitForProofreading(
    tauriPage,
    "source",
    (state) =>
      state.phase === "ready" &&
      providers(state).has("harper") &&
      providers(state).has("hunspell"),
    "Harper decorations did not return",
  );
  await tauriPage.click('[aria-label="Close settings"]');
  await expectDesktopShellAnchored(tauriPage);
});

test("LaTeX, Markdown, and Typst Source proofreading checks prose and masks syntax", async ({
  tauriPage,
}) => {
  await resetProofreadingState(tauriPage);
  const cases = [
    {
      format: "latex",
      path: "main.tex",
      source: String.raw`\documentclass{article}
\title{MetadataQwertzuiopz}
\begin{document}
The the Qwertzuiopz.
\verb|CodeQwertzuiopz|
\end{document}
`,
    },
    {
      format: "markdown",
      path: "main.md",
      source: `---
title: MetadataQwertzuiopz
---
# Heading
The the Qwertzuiopz.
\`CodeQwertzuiopz\`
`,
    },
    {
      format: "typst",
      path: "main.typ",
      source: `#set document(title: "MetadataQwertzuiopz")
= Heading
The the Qwertzuiopz.
\`CodeQwertzuiopz\`
$ x + y $
`,
    },
  ] as const;

  for (const entry of cases) {
    const name = `E2E ${entry.format} Source Proofreading ${RUN}`;
    await createProjectForFormat(tauriPage, entry.format, name);
    await replaceEditorSource(tauriPage, entry.source);
    const snapshot = await waitForProofreading(
      tauriPage,
      "source",
      (state) =>
        state.phase === "ready" &&
        state.identity?.path === entry.path &&
        providers(state).has("harper") &&
        providers(state).has("hunspell") &&
        hasDiagnostic(state, "hunspell", "Qwertzuiopz"),
      `${entry.format} Source proofreading did not finish`,
    );
    expect(
      snapshot.diagnostics.some(
        (diagnostic) =>
          diagnostic.source === "harper" &&
          /repeat|repeated|duplicate/iu.test(
            `${diagnostic.kind} ${diagnostic.message}`,
          ),
      ),
      `${entry.format} Harper repeated-word diagnostic`,
    ).toBe(true);
    expect(
      snapshot.diagnostics.some((diagnostic) =>
        /MetadataQwertzuiopz|CodeQwertzuiopz/u.test(diagnostic.word),
      ),
      `${entry.format} syntax and metadata must be masked`,
    ).toBe(false);
    await expectDesktopShellAnchored(tauriPage);
    await returnToLibrary(tauriPage);
  }
});

test("LaTeX and Markdown Visual proofreading paints real prose issues", async ({
  tauriPage,
}) => {
  await resetProofreadingState(tauriPage);
  const cases = [
    {
      format: "latex",
      source: String.raw`\documentclass{article}
\begin{document}
\section{Visual proof}
The the Qwertzuiopz.
\end{document}
`,
    },
    {
      format: "markdown",
      source: `# Visual proof

The the Qwertzuiopz.
`,
    },
  ] as const;

  for (const entry of cases) {
    const name = `E2E ${entry.format} Visual Proofreading ${RUN}`;
    await createProjectForFormat(tauriPage, entry.format, name);
    await replaceEditorSource(tauriPage, entry.source);
    await tauriPage.click('[aria-label="Switch to WYSIWYG view"]');
    await expect(tauriPage.getByText("Visual proof")).toBeVisible({
      timeout: 20_000,
    });
    const snapshot = await waitForProofreading(
      tauriPage,
      "visual",
      (state) =>
        state.phase === "ready" &&
        providers(state).has("harper") &&
        providers(state).has("hunspell") &&
        hasDiagnostic(state, "hunspell", "Qwertzuiopz"),
      `${entry.format} Visual proofreading did not finish`,
    );
    expect(snapshot.identity?.surface).toBe("visual");
    await expect(
      tauriPage.locator('[data-proofreading-issue]'),
    ).toBeVisible({ timeout: 20_000 });
    await expectDesktopShellAnchored(tauriPage);
    await tauriPage.click('[aria-label="Switch to source view"]');
    await expect(tauriPage.locator(".cm-content")).toBeVisible({
      timeout: 10_000,
    });
    await returnToLibrary(tauriPage);
  }
});

test("grammar and spelling suggestions apply and serialize back to project source", async ({
  tauriPage,
}) => {
  await resetProofreadingState(tauriPage);
  await createBlankProject(tauriPage, `E2E Apply Proofreading ${RUN}`);
  const projectId = await currentProjectId(tauriPage);
  await replaceEditorSource(
    tauriPage,
    String.raw`\documentclass{article}
\begin{document}
This could of changed. colur.
\end{document}
`,
  );
  let snapshot = await waitForProofreading(
    tauriPage,
    "source",
    (state) =>
      state.phase === "ready" &&
      state.diagnostics.some(
        (diagnostic) =>
          diagnostic.source === "harper" &&
          diagnostic.suggestions.some((suggestion) =>
            suggestion.text.toLocaleLowerCase().includes("have"),
          ),
      ) &&
      hasDiagnostic(state, "hunspell", "colur"),
    "actionable grammar and spelling diagnostics did not appear",
  );
  const grammar = snapshot.diagnostics.find(
    (diagnostic) =>
      diagnostic.source === "harper" &&
      diagnostic.suggestions.some((suggestion) =>
        suggestion.text.toLocaleLowerCase().includes("have"),
      ),
  );
  const grammarSuggestion = grammar?.suggestions.find((suggestion) =>
    suggestion.text.toLocaleLowerCase().includes("have"),
  );
  expect(grammar).toBeDefined();
  expect(grammarSuggestion).toBeDefined();
  await applySourceSuggestion(
    tauriPage,
    grammar!,
    grammarSuggestion!.text,
  );
  await expect
    .poll(() => editorSource(tauriPage), { timeout: 20_000 })
    .not.toContain("could of");

  snapshot = await waitForProofreading(
    tauriPage,
    "source",
    (state) =>
      state.phase === "ready" &&
      hasDiagnostic(state, "hunspell", "colur"),
    "spelling diagnostic did not survive the grammar edit",
  );
  const spelling = snapshot.diagnostics.find(
    (diagnostic) =>
      diagnostic.source === "hunspell" &&
      diagnostic.word.toLocaleLowerCase() === "colur",
  );
  expect(
    spelling?.suggestions.map((suggestion) => suggestion.text),
  ).toContain("color");
  await applySourceSuggestion(tauriPage, spelling!, "color");

  const serialized = await expect
    .poll(
      () =>
        tauriPage.evaluate<string>(
          `import("/src/store/files.ts").then(({ useFilesStore }) => {
            const state = useFilesStore.getState();
            return state.files[state.activePath ?? ""]?.content ?? "";
          })`,
        ),
      { timeout: 20_000 },
    )
    .not.toContain("colur");
  void serialized;
  const current = await editorSource(tauriPage);
  expect(current).toContain("color");
  expect(current).not.toContain("could of");

  await expect
    .poll(() => readProjectText(tauriPage, "main.tex"), {
      timeout: 30_000,
    })
    .toBe(current);
  expect(projectId).toBe(await currentProjectId(tauriPage));
  await expectDesktopShellAnchored(tauriPage);
});

test("global and project dictionaries add, remove, and remain isolated", async ({
  tauriPage,
}) => {
  await resetProofreadingState(tauriPage);
  await setProofreadingFlags(tauriPage, {
    spellcheck: true,
    harper: false,
  });
  const globalWord = `Globalterm${RUN}`;
  const projectWord = `Projectterm${RUN}`;
  const projectA = `E2E Dictionary A ${RUN}`;
  const projectB = `E2E Dictionary B ${RUN}`;

  await createBlankProject(tauriPage, projectA);
  const projectAId = await currentProjectId(tauriPage);
  await replaceEditorSource(
    tauriPage,
    String.raw`\documentclass{article}
\begin{document}
${globalWord} ${projectWord}
\end{document}
`,
  );
  await waitForProofreading(
    tauriPage,
    "source",
    (state) =>
      state.phase === "ready" &&
      hasDiagnostic(state, "hunspell", globalWord) &&
      hasDiagnostic(state, "hunspell", projectWord),
    "dictionary fixture words were not initially flagged",
  );

  await openSettings(tauriPage, "dictionary");
  await addDictionaryWord(
    tauriPage,
    "Add a globally ignored word",
    globalWord,
  );
  await activateDictionaryTab(tauriPage, "projects");
  await addDictionaryWord(
    tauriPage,
    `Add a word ignored in ${projectA}`,
    projectWord,
  );
  await tauriPage.click('[aria-label="Close settings"]');
  await waitForProofreading(
    tauriPage,
    "source",
    (state) =>
      state.phase === "ready" &&
      !hasDiagnostic(state, "hunspell", globalWord) &&
      !hasDiagnostic(state, "hunspell", projectWord),
    "ignored words did not clear in project A",
  );

  await returnToLibrary(tauriPage);
  await createBlankProject(tauriPage, projectB);
  await replaceEditorSource(
    tauriPage,
    String.raw`\documentclass{article}
\begin{document}
${globalWord} ${projectWord}
\end{document}
`,
  );
  await waitForProofreading(
    tauriPage,
    "source",
    (state) =>
      state.phase === "ready" &&
      !hasDiagnostic(state, "hunspell", globalWord) &&
      hasDiagnostic(state, "hunspell", projectWord),
    "project-only word leaked into project B",
  );

  await openProject(tauriPage, projectA);
  await waitForProofreading(
    tauriPage,
    "source",
    (state) =>
      state.phase === "ready" &&
      !hasDiagnostic(state, "hunspell", globalWord) &&
      !hasDiagnostic(state, "hunspell", projectWord),
    "project A dictionary did not survive reopen",
  );
  expect(await currentProjectId(tauriPage)).toBe(projectAId);

  await openSettings(tauriPage, "dictionary");
  await pageClickScopedStopIgnoring(
    tauriPage,
    `[data-testid="dictionary-tab-global"]`,
    globalWord,
  );
  await activateDictionaryTab(tauriPage, "projects");
  await tauriPage.evaluate(
    `(() => {
      const section = document.querySelector(
        '[aria-labelledby="dictionary-project-${projectAId}"]'
      );
      const button = section?.querySelector(
        '[aria-label=${JSON.stringify(`Stop ignoring ${projectWord}`)}]'
      );
      if (!(button instanceof HTMLElement)) {
        throw new Error("Project dictionary removal is unavailable");
      }
      button.click();
      return true;
    })()`,
  );
  await tauriPage.click('[aria-label="Close settings"]');
  await waitForProofreading(
    tauriPage,
    "source",
    (state) =>
      state.phase === "ready" &&
      hasDiagnostic(state, "hunspell", globalWord) &&
      hasDiagnostic(state, "hunspell", projectWord),
    "removed dictionary words did not return as findings",
  );
  await expectDesktopShellAnchored(tauriPage);
});

test("proofreading preferences and dictionaries persist across project and app reopen", async ({
  tauriPage,
}) => {
  await resetProofreadingState(tauriPage);
  const projectName = `E2E Proofreading Persistence ${RUN}`;
  const globalWord = `Persistglobal${RUN}`;
  const projectWord = `Persistproject${RUN}`;
  await createBlankProject(tauriPage, projectName);
  const projectId = await currentProjectId(tauriPage);
  await replaceEditorSource(
    tauriPage,
    String.raw`\documentclass{article}
\begin{document}
${globalWord} ${projectWord} colur
\end{document}
`,
  );

  await openSettings(tauriPage, "general");
  await chooseSettingsOption(
    tauriPage,
    "Proofreading English dialect",
    "English (UK)",
  );
  await chooseSettingsOption(
    tauriPage,
    "Proofreading spelling dictionary",
    "English (UK)",
  );
  await tauriPage.click('[aria-label="Close settings"]');
  await openSettings(tauriPage, "dictionary");
  await addDictionaryWord(
    tauriPage,
    "Add a globally ignored word",
    globalWord,
  );
  await activateDictionaryTab(tauriPage, "projects");
  await addDictionaryWord(
    tauriPage,
    `Add a word ignored in ${projectName}`,
    projectWord,
  );
  await tauriPage.click('[aria-label="Close settings"]');

  await returnToLibrary(tauriPage);
  await openProject(tauriPage, projectName);
  await waitForProofreading(
    tauriPage,
    "source",
    (state) =>
      state.phase === "ready" &&
      state.activeDictionaryLocale === "en_GB" &&
      !hasDiagnostic(state, "hunspell", globalWord) &&
      !hasDiagnostic(state, "hunspell", projectWord) &&
      state.diagnostics.some(
        (diagnostic) =>
          diagnostic.word === "colur" &&
          diagnostic.suggestions.some(
            (suggestion) => suggestion.text === "colour",
          ),
      ),
    "proofreading state did not survive project reopen",
  );

  await reloadNativePage(tauriPage);
  await openProject(tauriPage, projectName);
  const persisted = await tauriPage.evaluate<{
    grammarDialect: string;
    dictionaryLocale: string;
    global: string[];
    project: string[];
  }>(
    `Promise.all([
      import("/src/store/settings.ts"),
      import("/src/lib/dictionary.ts"),
    ]).then(([settings, dictionary]) => {
      const preferences = settings.useSettingsStore.getState();
      const words = dictionary.useDictionary.getState();
      return {
        grammarDialect: preferences.grammarDialect,
        dictionaryLocale: preferences.dictionaryLocale,
        global: words.global,
        project: words.ignored[${JSON.stringify(projectId)}] ?? [],
      };
    })`,
  );
  expect(persisted).toEqual({
    grammarDialect: "british",
    dictionaryLocale: "en_GB",
    global: [globalWord],
    project: [projectWord],
  });
  await waitForProofreading(
    tauriPage,
    "source",
    (state) =>
      state.phase === "ready" &&
      state.activeDictionaryLocale === "en_GB" &&
      !hasDiagnostic(state, "hunspell", globalWord) &&
      !hasDiagnostic(state, "hunspell", projectWord),
    "proofreading state did not survive app reload",
  );
  await expectDesktopShellAnchored(tauriPage);
  await resetProofreadingState(tauriPage);
});

test("rapid locale switching rejects superseded worker generations and keeps only the newest locale", async ({
  tauriPage,
}) => {
  await resetProofreadingState(tauriPage);
  await createBlankProject(tauriPage, `E2E Locale Race ${RUN}`);
  const projectId = await currentProjectId(tauriPage);
  const outcome = await tauriPage.evaluate<{
    attempts: { status: string; code?: string; locale?: string }[];
    finalStore: ProofreadingSnapshot;
  }>(`(async () => {
    const [{ proofreadDocument }, { useSettingsStore }, { useProofreadingStore }] =
      await Promise.all([
        import("/src/lib/proofreading/client.ts"),
        import("/src/store/settings.ts"),
        import("/src/store/proofreading.ts"),
      ]);
    const text = Array.from(
      { length: 80 },
      (_, index) => "couleurr phrase " + index
    ).join("\\n");
    const request = (locale, revision) => {
      useSettingsStore.getState().setDictionaryLocale(locale);
      return proofreadDocument({
        identity: {
          projectId: ${JSON.stringify(projectId)},
          path: "__e2e-locale-race__.tex",
          revision,
          surface: "visual",
        },
        text,
        format: "latex",
        mode: "spelling",
        ignoredWords: [],
        preferences: {
          showRegionalism: true,
          showWordChoice: true,
          dialect: "american",
          dictionaryLocale: locale,
        },
      }).then(
        (result) => ({
          status: result.status,
          locale: result.activeDictionaryLocale,
        }),
        (error) => ({
          status: "rejected",
          code: error?.code ?? "unknown",
        }),
      );
    };
    const attempts = await Promise.all([
      request("de_DE", 1),
      request("en_US", 2),
      request("fr_FR", 3),
    ]);
    const final = useProofreadingStore.getState().visual;
    return {
      attempts,
      finalStore: {
        phase: final.phase,
        message: final.message,
        diagnosticCount: final.diagnosticCount,
        activeDictionaryLocale: final.activeDictionaryLocale,
        identity: final.identity,
        diagnostics: final.diagnostics,
      },
    };
  })()`);

  expect(outcome.attempts.slice(0, 2)).toEqual([
    { status: "rejected", code: "superseded" },
    { status: "rejected", code: "superseded" },
  ]);
  expect(outcome.attempts[2]).toEqual({
    status: "ready",
    locale: "fr_FR",
  });
  expect(outcome.finalStore.phase).toBe("ready");
  expect(outcome.finalStore.activeDictionaryLocale).toBe("fr_FR");
  expect(outcome.finalStore.identity?.revision).toBe(3);
  expect(
    outcome.finalStore.diagnostics.some(
      (diagnostic) =>
        diagnostic.word === "couleurr" &&
        diagnostic.suggestions.some(
          (suggestion) => suggestion.text === "couleur",
        ),
    ),
  ).toBe(true);
  expect(
    outcome.finalStore.diagnostics.some((diagnostic) =>
      diagnostic.suggestions.some(
        (suggestion) =>
          suggestion.text === "Farbe" || suggestion.text === "color",
      ),
    ),
  ).toBe(false);
  await expectDesktopShellAnchored(tauriPage);
});

test("worker startup failure, partial analysis, retry, and recovery remain usable", async ({
  tauriPage,
}) => {
  await resetProofreadingState(tauriPage);
  await tauriPage.evaluate(
    `(() => {
      const NativeWorker = window.Worker;
      window.__e2eOriginalWorker = NativeWorker;
      window.Worker = class E2eFailingProofreadingWorker extends NativeWorker {
        constructor(url, options) {
          if (String(url).includes("proofreading.worker")) {
            throw new Error("E2E forced proofreading startup failure");
          }
          super(url, options);
        }
      };
      return true;
    })()`,
  );
  await createBlankProject(tauriPage, `E2E Proofreading Recovery ${RUN}`);
  await replaceEditorSource(tauriPage, LATEX_PROSE);
  await waitForProofreading(
    tauriPage,
    "source",
    (state) =>
      state.phase === "unavailable" &&
      /could not start/iu.test(state.message ?? ""),
    "forced worker startup failure was not surfaced",
  );

  await tauriPage.evaluate(
    `(() => {
      window.Worker = window.__e2eOriginalWorker;
      delete window.__e2eOriginalWorker;
      return Promise.all([
        import("/src/lib/proofreading/client.ts"),
        import("/src/components/editor/cm/controller.ts"),
        import("@oleafly/editor"),
      ]).then(([client, controller, editor]) => {
        client.retryProofreading("source");
        editor.refreshEditorLints(controller.getEditorView());
        return true;
      });
    })()`,
  );
  await waitForProofreading(
    tauriPage,
    "source",
    (state) =>
      state.phase === "ready" &&
      providers(state).has("harper") &&
      providers(state).has("hunspell"),
    "proofreading did not recover after retry",
  );

  const projectId = await currentProjectId(tauriPage);
  const partial = await tauriPage.evaluate<ProofreadingSnapshot>(
    `(async () => {
      const [{ proofreadDocument }, { useProofreadingStore }] =
        await Promise.all([
          import("/src/lib/proofreading/client.ts"),
          import("/src/store/proofreading.ts"),
        ]);
      await proofreadDocument({
        identity: {
          projectId: ${JSON.stringify(projectId)},
          path: "__e2e-partial__.tex",
          revision: 1,
          surface: "visual",
        },
        text: "This could of changed. Qwertzuiopz.",
        format: "latex",
        mode: "combined",
        ignoredWords: [],
        preferences: {
          showRegionalism: true,
          showWordChoice: true,
          dialect: "american",
          dictionaryLocale: "zz_ZZ",
        },
      });
      return useProofreadingStore.getState().visual;
    })()`,
  );
  expect(partial.phase).toBe("partial");
  expect(partial.message).toContain(
    "the requested zz_ZZ spelling dictionary could not start",
  );
  expect(providers(partial)).toEqual(new Set(["harper"]));

  const recovered = await tauriPage.evaluate<ProofreadingSnapshot>(
    `(async () => {
      const [{ proofreadDocument, retryProofreading }, { useProofreadingStore }] =
        await Promise.all([
          import("/src/lib/proofreading/client.ts"),
          import("/src/store/proofreading.ts"),
        ]);
      retryProofreading("visual");
      await proofreadDocument({
        identity: {
          projectId: ${JSON.stringify(projectId)},
          path: "__e2e-partial__.tex",
          revision: 2,
          surface: "visual",
        },
        text: "This could of changed. Qwertzuiopz.",
        format: "latex",
        mode: "combined",
        ignoredWords: [],
        preferences: {
          showRegionalism: true,
          showWordChoice: true,
          dialect: "american",
          dictionaryLocale: "en_US",
        },
      });
      return useProofreadingStore.getState().visual;
    })()`,
  );
  expect(recovered.phase).toBe("ready");
  expect(recovered.activeDictionaryLocale).toBe("en_US");
  expect(providers(recovered)).toEqual(
    new Set(["harper", "hunspell"]),
  );
  await expectDesktopShellAnchored(tauriPage);
});

async function pageClickScopedStopIgnoring(
  page: TauriPage,
  tabSelector: string,
  word: string,
): Promise<void> {
  await activateDictionaryTab(
    page,
    tabSelector.includes("global") ? "global" : "projects",
  );
  await page.click(
    `[aria-label=${JSON.stringify(`Stop ignoring ${word}`)}]`,
  );
}
