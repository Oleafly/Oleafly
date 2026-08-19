import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures";
import {
  clickToolbarControl,
  compileAndProbe,
  createBlankProject,
  openRailTab,
  replaceEditorSource,
  setEditorCaretAfter,
  waitEditorContains,
  waitLong,
  type Page,
} from "../helpers";
import { startMockAiServer, type MockAiServer } from "../mock-ai-server";

// Tier 2 of the import pipeline: the refine handoff and image-to-LaTeX both
// need a vision-capable model, so connect the keyless Ollama provider with a
// "llava" model id against the mock server (llava passes modelSupportsVision).

let server: MockAiServer;
const RUN = Date.now().toString(36);

test.beforeAll(async () => {
  server = await startMockAiServer();
});
test.afterAll(async () => {
  await server?.close();
});

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(join(here, "..", "fixture-files", name)).toString("base64");

async function connectVision(page: Page) {
  const ok = await page.evaluate<boolean>(
    `window.__aiConnect?.("ollama", ${JSON.stringify(server.url)}, "llava") ?? false`,
  );
  expect(ok, "__aiConnect devtools hook must be present").toBe(true);
}

test("refine with AI creates the project and hands off to the agent", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await expect(
    tauriPage.locator('[data-testid="library"][data-projects-loaded="true"]') as Parameters<
      typeof expect
    >[0],
  ).toBeVisible({ timeout: 30_000 });
  await connectVision(tauriPage);
  const before = server.requestCount();
  await tauriPage.evaluate<boolean>(
    `(window.__importFile(${JSON.stringify("refine.pdf")}, ${JSON.stringify(
      fixture("tiny.pdf"),
    )}), true)`,
  );
  await expect(tauriPage.locator('[data-testid="pdf-import-view"]')).toBeVisible({
    timeout: 20_000,
  });
  await expect(tauriPage.locator('[data-testid="import-refine"]')).toBeVisible({
    timeout: 20_000,
  });
  // wait for the conversion result: refine is a no-op while the button is disabled
  await waitLong(
    tauriPage,
    `(document.querySelector('[data-testid="import-source"]')?.textContent ?? "").includes("documentclass")`,
    30_000,
  );
  await tauriPage.click('[data-testid="import-refine"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 60_000 });
  await openRailTab(tauriPage, "Research Assistant");
  const deadline = Date.now() + 60_000;
  while (server.requestCount() <= before) {
    if (Date.now() > deadline) throw new Error("agent handoff never reached the model");
    await new Promise((r) => setTimeout(r, 1000));
  }
});

test("image to LaTeX toolbar action transcribes and renders through the production path", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await expect(
    tauriPage.locator('[data-testid="library"][data-projects-loaded="true"]') as Parameters<
      typeof expect
    >[0],
  ).toBeVisible({ timeout: 30_000 });
  await connectVision(tauriPage);
  server.setReply(
    "\\begin{equation}\\mathrm{VISIONSEMANTIC}=mc^2\\end{equation}",
  );
  await createBlankProject(tauriPage, `E2E Image LaTeX ${RUN}`);
  await replaceEditorSource(
    tauriPage,
    String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage{amsmath}
\begin{document}
IMAGEANCHOR
\end{document}
`,
  );
  await setEditorCaretAfter(tauriPage, "IMAGEANCHOR");
  await expect(tauriPage.locator('[data-testid="image-to-latex-input"]')).toBeAttached({
    timeout: 20_000,
  });

  // The native bridge cannot choose a file in the OS picker. Still exercise
  // the real toolbar control and its input.click() wiring, then provide the
  // deterministic File through the same production input change handler.
  await tauriPage.evaluate(
    `(() => {
      const input = document.querySelector('[data-testid="image-to-latex-input"]');
      if (!input) throw new Error("image-to-LaTeX input is unavailable");
      window.__imageToolbarInputClicked = false;
      input.addEventListener("click", (event) => {
        window.__imageToolbarInputClicked = true;
        event.preventDefault();
      }, { once: true });
      return true;
    })()`,
  );
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Image to LaTeX (transcribe with AI)"]',
    "Image to LaTeX",
  );
  expect(
    await tauriPage.evaluate<boolean>(`window.__imageToolbarInputClicked === true`),
  ).toBe(true);

  const RED_PNG =
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAABZUlEQVQ4jZ2SPU8CQRCG38NDPM6PKCAeUNhotNLERGJHYucPMFbGj9gaY6uFP4AQSwuBHkNpYkWMjcYYbQgVnaAE8MAGPGB3LEyA4w4k9262mJl3Zp/NLohokhGLcuIVTkOvEiMWIaJRgTEWg4B9WBEhLLR4UwUwbWkAUBaarEGDHGqjirv8PV6/0sjXCwivncPvnGvXRQLv23ybSyGSuUad/QAAtvwh+Jyz6O4RicwHRLMJxLKJdhyQFRwvHaDXLxKMN3gqvyGevdHlgu5VjNsl9PoNBJw4LjMxg5E4N5xuSvBQfEauVtDl5uUAjhZ3DENNCVKfj52iICLkXcfJ8h6cI47/CQiEFzUNRfLgcGEbQdcKJuxyu2YmHUGhXoLGNFwFL+CTvH+NfV6pi6BjeK99YFPZgCJ5MOh/dEv41oplEFxDuY2q2IhYnMBhcSfFKYd6VtVmbCDsAnAPx40KiJKtMfvpL2rU7TM3sBQgAAAAAElFTkSuQmCC";
  await tauriPage.evaluate(
    `(() => {
      const input = document.querySelector('[data-testid="image-to-latex-input"]');
      const bytes = Uint8Array.from(atob(${JSON.stringify(RED_PNG)}), (c) => c.charCodeAt(0));
      const file = new File([bytes], "equation.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`,
  );
  await waitEditorContains(tauriPage, "VISIONSEMANTIC", 60_000);
  const probe = await compileAndProbe(tauriPage);
  expect(probe.text).toContain("VISIONSEMANTIC");

  server.setReply(
    "\\begin{equation}\\mathrm{VISUALVISIONSEMANTIC}=x+1\\end{equation}",
  );
  await tauriPage.click('[aria-label="Switch to WYSIWYG view"]');
  await expect(tauriPage.locator(".ProseMirror")).toBeVisible({ timeout: 10_000 });
  const visualCaret = await tauriPage.evaluate<boolean>(
    `import("/src/components/editor/wysiwyg/controller.ts").then(({ getWysiwygEditor }) => {
      const editor = getWysiwygEditor();
      if (!editor) return false;
      let position = null;
      editor.state.doc.descendants((node, offset) => {
        if (position !== null || !node.isText || !node.text) return;
        const index = node.text.indexOf("IMAGEANCHOR");
        if (index >= 0) position = offset + index + "IMAGEANCHOR".length;
      });
      if (position === null) return false;
      editor.chain().focus().setTextSelection(position).run();
      return true;
    })`,
  );
  expect(visualCaret).toBe(true);
  await tauriPage.evaluate(
    `(() => {
      const input = document.querySelector('[data-testid="image-to-latex-input"]');
      if (!input) throw new Error("image-to-LaTeX input is unavailable");
      window.__visualImageToolbarInputClicked = false;
      input.addEventListener("click", (event) => {
        window.__visualImageToolbarInputClicked = true;
        event.preventDefault();
      }, { once: true });
      return true;
    })()`,
  );
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Image to LaTeX (transcribe with AI)"]',
    "Image to LaTeX",
  );
  expect(
    await tauriPage.evaluate<boolean>(
      `window.__visualImageToolbarInputClicked === true`,
    ),
  ).toBe(true);
  await tauriPage.evaluate(
    `(() => {
      const input = document.querySelector('[data-testid="image-to-latex-input"]');
      const bytes = Uint8Array.from(atob(${JSON.stringify(RED_PNG)}), (c) => c.charCodeAt(0));
      const file = new File([bytes], "visual-equation.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`,
  );
  await waitEditorContains(tauriPage, "VISUALVISIONSEMANTIC", 60_000);
  await tauriPage.click('[aria-label="Switch to source view"]');
  const visualProbe = await compileAndProbe(tauriPage);
  expect(visualProbe.text).toContain("VISUALVISIONSEMANTIC");
});
