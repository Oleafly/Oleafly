import { test, expect } from "../fixtures";
import {
  createBlankProject,
  editorSource,
  expectCompiledPdfContains,
  openProject,
  openRailTab,
  setEditorContent,
} from "../helpers";

test("preflight categories render and a single check runs independently", async ({
  tauriPage,
}) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  // Preflight's PDF checks need a compiled PDF.
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 90_000,
  });
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 30_000 });

  await openRailTab(tauriPage, "Preflight (ATS + accessibility)");
  const runButton = tauriPage.locator('[aria-label^="Run "]:not(:disabled)').first();
  await expect(runButton).toBeVisible();

  await runButton.click();
  await expect(tauriPage.getByTestId("preflight-panel")).toHaveAttribute(
    "data-running",
    "false",
    { timeout: 60_000 },
  );
  await expect(tauriPage.getByTestId("preflight-panel")).toHaveAttribute(
    "data-error",
    "",
  );
  await expect(tauriPage.getByTestId("preflight-panel")).toHaveAttribute(
    "data-report",
    "true",
    { timeout: 60_000 },
  );
  await expect(tauriPage.getByText("No document language set")).toBeVisible();
  await expect(tauriPage.getByText("Accessible export")).toBeVisible();
});

test("compiled GitHub Projects reaches the ATS store and parser UI", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  await createBlankProject(
    tauriPage,
    `E2E ATS GitHub Projects ${Date.now().toString(36)}`,
  );
  await setEditorContent(
    tauriPage,
    String.raw`\documentclass{article}
\usepackage[english]{babel}
\usepackage[unicode]{hyperref}
\hypersetup{pdftitle={Jane Doe Resume},pdflang=en-US}
\begin{document}
\begin{center}
{\Large Jane Doe}\\
jane@example.com \quad +1 (415) 555-2671
\end{center}
\section*{Experience}
Software Engineer at Acme.
\section*{GitHub Projects}
Built a deterministic compiler project.
\section*{Education}
Example University.
\end{document}
`,
  );

  await expect(tauriPage.getByTestId("compile-button")).toBeEnabled({
    timeout: 120_000,
  });
  await tauriPage.getByTestId("compile-button").click();
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute(
    "data-severity",
    "ok",
    { timeout: 120_000 },
  );
  // The blank template can still be completing its on-open compile when the
  // replacement is queued. Prove that the latest source—not the prior green
  // status—reached the PDF before exercising Preflight.
  await expectCompiledPdfContains(tauriPage, "GitHub Projects", 120_000);
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({
    timeout: 30_000,
  });

  const source = await editorSource(tauriPage);
  const looksLikeResume = await tauriPage.evaluate<boolean>(
    `import("/packages/preflight/src/doc-type.ts").then(
      ({ looksLikeResumeSource }) => looksLikeResumeSource(${JSON.stringify(source)})
    )`,
  );
  expect(source).toContain("\\section*{GitHub Projects}");
  expect(looksLikeResume).toBe(true);

  await openRailTab(tauriPage, "Preflight (ATS + accessibility)");
  await expect(tauriPage.getByTestId("preflight-panel")).toHaveAttribute(
    "data-running",
    "false",
  );
  await expect(
    tauriPage.locator('[aria-label="Enable ATS readiness"]'),
  ).toHaveAttribute("aria-checked", "true");
  const runAts = tauriPage.locator(
    '[aria-label="Run ATS readiness"]:not(:disabled)',
  );
  await expect(runAts).toBeVisible({ timeout: 20_000 });
  await runAts.click();
  await expect(tauriPage.getByTestId("preflight-panel")).toHaveAttribute(
    "data-running",
    "false",
    { timeout: 60_000 },
  );
  await expect(tauriPage.getByTestId("preflight-panel")).toHaveAttribute(
    "data-error",
    "",
  );
  await expect(tauriPage.getByTestId("preflight-panel")).toHaveAttribute(
    "data-report",
    "true",
  );

  await expect(tauriPage.getByText("What a parser extracted")).toBeVisible();
  const projectsChip = tauriPage.getByTestId("ats-section-projects");
  await expect(projectsChip).toHaveAttribute("data-present", "true");
  await expect(projectsChip).toHaveAttribute("data-required", "false");
  await expect(projectsChip).toHaveAttribute(
    "aria-label",
    "Projects: detected",
  );
  await tauriPage.getByText("Show what the reader sees").click();
  await expect(tauriPage.locator("pre").getByText("GitHub Projects")).toBeVisible();
});
