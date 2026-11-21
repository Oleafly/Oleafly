import { test, expect } from "../fixtures";
import {
  createBlankProject,
  editorSource,
  fillCommandPalette,
  openRailTab,
  paletteItems,
  pressGlobal,
  replaceEditorSource,
  writeProjectText,
} from "../helpers";

const PAPER = String.raw`\documentclass{article}
\usepackage{booktabs}
\newcommand{\NetName}{PS-FCN}
\begin{document}
\section{Introduction}
Convolutional neural network(CNN) has been applied to many vision problems .
A proposes a method B for this problem \cite{chen2018}. Are you "okay"?
We train PS-FCN on synthetic data, and PSFCN generalizes to real data.
More results are in the supplementary material.
Here $n$ is the surface normal of a pixel, and later $n$ denotes the noise level.
\begin{table}[t]
  \centering
  \begin{tabular}{lc}
    \toprule
    Method & MAE $\downarrow$ \\
    \midrule
    A & 10.2 \\
    B & 8.9 \\
    Ours & \textbf{9.4} \\
    \bottomrule
  \end{tabular}
  \caption{Results.}
\end{table}
\end{document}
`;

const REVIEWS = "# Reviewer 1\n1. Table 1 should report the runtime.\n";

test("writing checks underline, list and fix paper style problems", async ({ tauriPage }) => {
  await createBlankProject(tauriPage, "E2E Writing");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await writeProjectText(tauriPage, "reviews.md", REVIEWS);
  await replaceEditorSource(tauriPage, PAPER);

  await expect(tauriPage.locator(".cm-lintRange-info").first()).toBeVisible({ timeout: 30_000 });

  await openRailTab(tauriPage, "Preflight Checks");
  await expect(tauriPage.getByText("Writing style", { exact: true })).toBeVisible();
  const run = tauriPage.locator('[aria-label="Run Writing style"]:not(:disabled)');
  await expect(run).toBeVisible();
  await run.click();
  const panel = tauriPage.getByTestId("preflight-panel");
  await expect(panel).toHaveAttribute("data-running", "false", { timeout: 60_000 });
  await expect(panel).toHaveAttribute("data-report", "true", { timeout: 60_000 });

  const findingTitles = () =>
    tauriPage.evaluate<string[]>(
      `Array.from(document.querySelectorAll('[data-testid="preflight-finding-title"]')).map((element) => element.textContent ?? "")`,
    );
  for (const title of [
    "Add a space before the parenthesis",
    "Bold value is not the best",
    "Promise with no reference",
    "Same name, different spellings",
    "Symbol defined twice",
    "Reviewer point R1.1",
  ]) {
    await expect.poll(findingTitles, { timeout: 20_000 }).toContain(title);
  }
  await expect(tauriPage.getByTestId("preflight-writing-options")).toBeVisible();

  await tauriPage.click('[data-testid="preflight-writing-fix-all"]');
  await expect
    .poll(() => editorSource(tauriPage), { timeout: 30_000 })
    .toContain("network (CNN)");
  const fixed = await editorSource(tauriPage);
  expect(fixed).toContain("problems.");
  expect(fixed).toContain("problem~\\cite{chen2018}");
  expect(fixed).toContain("``okay''");

  await tauriPage.click('[data-testid="preflight-writing-add-rule"]');
  await expect(tauriPage.getByTestId("style-rule-dialog")).toBeVisible();
  await tauriPage.fill('[data-testid="style-rule-find"]', "synthetic data");
  await tauriPage.fill('[data-testid="style-rule-replace"]', "simulated data");
  await expect(tauriPage.getByTestId("style-rule-matches")).toContainText("1", { timeout: 10_000 });
  await tauriPage.click('[data-testid="style-rule-save"]');
  await expect(tauriPage.getByTestId("style-rule-dialog")).toBeHidden({ timeout: 10_000 });
  await expect
    .poll(
      () =>
        tauriPage.evaluate<string[]>(
          `Array.from(document.querySelectorAll('[data-testid="preflight-writing-rule"]')).map((element) => element.textContent ?? "")`,
        ),
      { timeout: 10_000 },
    )
    .toContain("synthetic data");

  await pressGlobal(tauriPage, "k", { meta: true });
  await fillCommandPalette(tauriPage, "notation");
  await expect
    .poll(async () => (await paletteItems(tauriPage)).some((item) => item.includes("Notation table")), { timeout: 10_000 })
    .toBe(true);
  await fillCommandPalette(tauriPage, "chapter from");
  await expect
    .poll(
      async () => (await paletteItems(tauriPage)).some((item) => item.includes("Add chapter from another project")),
      { timeout: 10_000 },
    )
    .toBe(true);
});
