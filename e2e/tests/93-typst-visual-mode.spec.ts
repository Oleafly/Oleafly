import { readFileSync } from "node:fs";
import { test, expect } from "../fixtures";
import {
  clickToolbarControl,
  compileAndWait,
  createProjectFromTemplate,
  editorSource,
  expectCompiledPdfContains,
  replaceEditorLiteral,
  replaceEditorSource,
  selectEditorText,
  setEditorCaretAfter,
  writeProjectBinary,
  type Page,
} from "../helpers";

test.describe.configure({ timeout: 240_000 });

const RUN = Date.now().toString(36);
const FIXTURE_PNG = readFileSync(
  new URL("../../src-tauri/resources/templates/blank/preview.png", import.meta.url),
).toString("base64");
const SETTINGS = '#set page(paper: "a4")\n#set text(size: 11pt)\n\n';

async function freshTypst(page: Page, suffix: string, body: string) {
  await createProjectFromTemplate(page, "blank-typst", `E2E Typst Visual ${suffix} ${RUN}`);
  await replaceEditorSource(page, `${SETTINGS}${body}`);
}

async function openVisual(page: Page) {
  await page.click('[aria-label="Switch to WYSIWYG view"]');
  await page.waitForFunction(
    `import("/src/store/visual-mode.ts").then(
      ({ useVisualModeStore }) => useVisualModeStore.getState().enabled === true
    )`,
    10_000,
  );
  await expect(page.locator(".cm-editor.ofl-visual-parsed")).toBeVisible({ timeout: 20_000 });
}

async function openSource(page: Page) {
  await page.click('[aria-label="Switch to source view"]');
  await page.waitForFunction(
    `import("/src/store/visual-mode.ts").then(
      ({ useVisualModeStore }) => useVisualModeStore.getState().enabled === false
    )`,
    10_000,
  );
}

async function refreshTree(page: Page) {
  await page.evaluate<boolean>(
    `import("/src/store/files.ts").then(({ useFilesStore }) =>
      useFilesStore.getState().refreshTree().then(() => true))`,
  );
}

async function pressElement(page: Page, selector: string) {
  await page.evaluate(
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) throw new Error("element is unavailable: " + ${JSON.stringify(selector)});
      const options = { bubbles: true, cancelable: true, button: 0, detail: 1 };
      element.dispatchEvent(new MouseEvent("mousedown", options));
      element.dispatchEvent(new MouseEvent("mouseup", options));
      element.dispatchEvent(new MouseEvent("click", options));
      return 1;
    })()`,
  );
}

async function lineTextAt(page: Page, needle: string): Promise<string> {
  return page.evaluate<string>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) return "";
      const at = view.state.doc.toString().indexOf(${JSON.stringify(needle)});
      if (at < 0) return "";
      const line = view.state.doc.lineAt(at);
      const block = view.domAtPos(line.from).node;
      const element = block instanceof Element ? block : block.parentElement;
      return element?.closest(".cm-line")?.textContent ?? "";
    })`,
  );
}

test("Typst visual mode renders the document and reveals the source under the cursor", async ({ tauriPage }) => {
  await freshTypst(
    tauriPage,
    "render",
    `= Widgets <widgets>
A *bold* claim#footnote[A footnote.] with $a^2 + b^2$ inline.

$ E = m c^2 $

- first item
- second item

See @widgets.
`,
  );
  await openVisual(tauriPage);

  const content = tauriPage.locator(".cm-content");
  await expect(content.locator(".ofl-visual-typst-heading-1").first()).toContainText("Widgets");
  await expect(content.locator(".ofl-visual-typst-strong").first()).toHaveText("bold");
  await expect(content.locator(".ofl-visual-footnote").first()).toBeVisible();
  await expect(content.locator(".ofl-visual-item")).toHaveCount(2);
  await expect(content.locator(".ofl-visual-chip-ref").first()).toBeVisible();
  await expect(content.locator(".ofl-visual-typst-math img.ofl-typst-math").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(content.locator(".ofl-visual-math-display.ofl-visual-typst-math img.ofl-typst-math")).toBeVisible({
    timeout: 30_000,
  });
});

test("moving the cursor into a Typst heading shows its marker and the edit lands in the file", async ({
  tauriPage,
}) => {
  await freshTypst(tauriPage, "reveal", "= Widgets\nBody text.\n");
  await openVisual(tauriPage);
  await setEditorCaretAfter(tauriPage, "Body text.");
  await expect.poll(() => lineTextAt(tauriPage, "= Widgets"), { timeout: 10_000 }).toBe("Widgets");

  await setEditorCaretAfter(tauriPage, "Widgets");
  await expect.poll(() => lineTextAt(tauriPage, "= Widgets"), { timeout: 10_000 }).toBe("= Widgets");

  await replaceEditorLiteral(tauriPage, "Widgets", "Rendering");
  await expect.poll(() => editorSource(tauriPage), { timeout: 10_000 }).toContain("= Rendering\n");

  await setEditorCaretAfter(tauriPage, "Body text.");
  await expect.poll(() => lineTextAt(tauriPage, "= Rendering"), { timeout: 10_000 }).toBe("Rendering");
});

test("the leading set and import lines fold into a document settings bar", async ({ tauriPage }) => {
  await freshTypst(tauriPage, "settings", "Body.\n");
  await openVisual(tauriPage);

  const bar = tauriPage.locator(".cm-content .ofl-visual-preamble-widget");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("Show document settings");
  await pressElement(tauriPage, ".cm-content .ofl-visual-preamble-widget");
  await expect(bar).toContainText("Hide document settings");
  await expect(tauriPage.locator(".cm-content .ofl-visual-preamble-expanded")).toBeVisible();
  await pressElement(tauriPage, ".cm-content .ofl-visual-preamble-widget");
  await expect(bar).toContainText("Show document settings");
});

test("a Typst table renders as a grid whose toolbar writes valid Typst", async ({ tauriPage }) => {
  await freshTypst(
    tauriPage,
    "table",
    `#figure(
  table(
    columns: 2,
    table.header([Name], [Count]),
    [a], [b],
    [c], [d],
  ),
  caption: [Table caption],
)
`,
  );
  await openVisual(tauriPage);

  const cell = ".cm-content .ofl-visual-table-grid .ofl-visual-table-cell-text";
  await expect
    .poll(
      () => tauriPage.evaluate<string>(`document.querySelector(${JSON.stringify(cell)})?.textContent ?? ""`),
      { timeout: 20_000 },
    )
    .toBe("Name");

  await pressElement(tauriPage, `${cell}`);
  await expect(tauriPage.locator(".ofl-visual-table-toolbar")).toBeVisible({ timeout: 10_000 });
  await tauriPage.click('.ofl-visual-table-toolbar [aria-label="Insert"]');
  await tauriPage.waitForFunction(
    `(() => {
      const item = Array.from(document.querySelectorAll('.ofl-visual-table-menu [role="menuitem"]')).find(
        (candidate) => (candidate.textContent ?? "").trim() === "Insert row below",
      );
      if (!(item instanceof HTMLElement)) return false;
      item.click();
      return true;
    })()`,
    10_000,
  );
  await expect
    .poll(() => editorSource(tauriPage), { timeout: 10_000 })
    .toContain("table.header([Name], [Count]),\n    [], [],\n    [a], [b],");

  await openSource(tauriPage);
  await compileAndWait(tauriPage);
  await expectCompiledPdfContains(tauriPage, "Table caption");
});

test("a Typst figure renders its image and the edit button opens the Typst figure dialog", async ({
  tauriPage,
}) => {
  await freshTypst(
    tauriPage,
    "figure",
    `#figure(
  image("plot.png", width: 50%),
  caption: [Plot caption],
) <fig:plot>
`,
  );
  await writeProjectBinary(tauriPage, "plot.png", FIXTURE_PNG);
  await refreshTree(tauriPage);
  await openVisual(tauriPage);

  const image = tauriPage.locator(".cm-content .ofl-visual-graphics-image").first();
  await expect(image).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => image.getAttribute("src")).toMatch(/^data:image\/png/u);
  await expect(tauriPage.locator(".cm-content .ofl-visual-typst-caption").first()).toHaveText("Plot caption");

  await tauriPage.evaluate(
    `(() => {
      const host = document.querySelector(".cm-content .ofl-visual-graphics");
      host?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
      const button = document.querySelector(".cm-content .ofl-visual-graphics-edit");
      if (!(button instanceof HTMLElement)) throw new Error("graphics edit button is unavailable");
      button.click();
      return 1;
    })()`,
  );
  await expect(tauriPage.locator('[data-testid="figure-dialog"]')).toBeVisible({ timeout: 10_000 });
  await tauriPage.fill('[data-testid="figure-dialog-caption"]', "Edited caption");
  await tauriPage.click('[data-testid="figure-dialog-insert"]');
  await expect.poll(() => editorSource(tauriPage), { timeout: 10_000 }).toContain("caption: [Edited caption]");
  await expect.poll(() => editorSource(tauriPage), { timeout: 10_000 }).toContain("<fig:plot>");
});

test("Typst toolbar insertions write Typst into the document in visual mode", async ({ tauriPage }) => {
  await freshTypst(tauriPage, "insert", "Body text.\n");
  await openVisual(tauriPage);

  await selectEditorText(tauriPage, "Body");
  await clickToolbarControl(tauriPage, '[aria-label^="Bold ("]', "Bold");
  await expect.poll(() => editorSource(tauriPage), { timeout: 10_000 }).toContain("*Body*");

  await selectEditorText(tauriPage, "text", 2);
  await clickToolbarControl(tauriPage, '[aria-label="Underline"]', "Underline");
  await expect.poll(() => editorSource(tauriPage), { timeout: 10_000 }).toContain("#underline[text]");
  await setEditorCaretAfter(tauriPage, "Body*");
  await expect(tauriPage.locator(".cm-content .ofl-visual-typst-underline").first()).toHaveText("text");
});
