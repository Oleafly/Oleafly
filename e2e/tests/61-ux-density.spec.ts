import { test, expect } from "../fixtures";
import {
  compileAndWait,
  createBlankProject,
  replaceEditorSource,
  type Page,
} from "../helpers";

// Phase C editor UX density: list continuation, environment closing,
// masked word count, and compile-derived reference numbers.

async function editorKey(page: Page, key: string) {
  await page.evaluate(
    `(document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(
      key,
    )}, bubbles: true, cancelable: true })), 1)`,
  );
}

async function editorSourceText(page: Page): Promise<string> {
  return await page.evaluate<string>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => getEditorView().state.doc.toString())`,
  );
}

async function placeCaretAfter(page: Page, anchor: string) {
  await page.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      const at = view.state.doc.toString().indexOf(${JSON.stringify(anchor)});
      view.dispatch({ selection: { anchor: at + ${anchor.length} } });
      view.focus();
      return 1;
    })`,
  );
}

test("Enter continues \\item lists and Mod-Alt-. closes the open environment", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await createBlankProject(tauriPage, "Ux Density");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({
    timeout: 20_000,
  });
  await replaceEditorSource(
    tauriPage,
    "\\documentclass{article}\n\\begin{document}\n\\begin{itemize}\n  \\item First point\n\\end{document}\n",
  );

  await placeCaretAfter(tauriPage, "\\item First point");
  await editorKey(tauriPage, "Enter");
  await expect
    .poll(async () => await editorSourceText(tauriPage))
    .toContain("First point\n  \\item ");

  // Close the still-open itemize from the fresh item line.
  await tauriPage.evaluate(
    `(document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key: '.', metaKey: true, altKey: true, bubbles: true, cancelable: true })), 1)`,
  );
  await expect
    .poll(async () => await editorSourceText(tauriPage))
    .toContain("\\end{itemize}");
});

test("word count popover reports mask-accurate counts", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await createBlankProject(tauriPage, "Word Count");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({
    timeout: 20_000,
  });
  await replaceEditorSource(
    tauriPage,
    "\\documentclass{article}\n\\begin{document}\nFive plain prose words here.\n\\begin{equation}x^2 + y^2 = z^2\\end{equation}\n\\end{document}\n",
  );
  const stats = await tauriPage.evaluate<{
    words: number;
    method: string;
  }>(
    `import("/src/lib/wordcount.ts").then(({ countWords }) => {
      return import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
        const { words, method } = countWords(getEditorView().state.doc.toString());
        return { words, method };
      });
    })`,
  );
  expect(stats.method).toBe("masked");
  // Math body excluded; only the five prose words count.
  expect(stats.words).toBe(5);
});

test("reference numbers surface from the last compile's aux file", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  await createBlankProject(tauriPage, "Aux Numbers");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({
    timeout: 20_000,
  });
  await replaceEditorSource(
    tauriPage,
    "\\documentclass{article}\n\\begin{document}\n\\section{Intro}\\label{sec:intro}\nText referencing \\ref{sec:intro}.\n\\end{document}\n",
  );
  await compileAndWait(tauriPage, 90_000);
  await expect
    .poll(
      async () =>
        await tauriPage.evaluate<string | null>(
          `import("/src/lib/aux-numbers.ts").then(({ auxNumberFor }) => {
            const hit = auxNumberFor("sec:intro");
            return hit ? hit.number : null;
          })`,
        ),
      { timeout: 20_000 },
    )
    .toBe("1");
});
