import { test, expect } from "../fixtures";
import { openProject, pressGlobal, typeInEditorAfter, type Page } from "../helpers";

// Unique per run: leftovers from earlier runs colliding would themselves
// cause a LaTeX error (redefining the same \newcommand).
const CMD = `notacmd${Date.now().toString(36)}`;

async function recoverDocument(tauriPage: Page) {
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const source = await tauriPage.evaluate<string>(
    `document.querySelector('.cm-content')?.textContent ?? ''`,
  );
  if (source.includes(`\\${CMD}`) && !source.includes(`\\providecommand{\\${CMD}}{}`)) {
    await typeInEditorAfter(tauriPage, "maketitle", `\n\\providecommand{\\${CMD}}{}`);
    await pressGlobal(tauriPage, "Enter", { meta: true });
    await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
      timeout: 90_000,
    });
  }
}

test("the Logs tab shows the real compile log", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 90_000,
  });
  await tauriPage.getByText("Logs").click();
  const logText = await tauriPage.evaluate<string>(`document.body.innerText`);
  expect(logText).toContain("tex"); // tectonic's log mentions the entry file
});

test("a LaTeX error surfaces as an error status, and fixing it recovers", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  try {
    await typeInEditorAfter(tauriPage, "here.", ` \\${CMD}`);
    await pressGlobal(tauriPage, "Enter", { meta: true });
    await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "error", {
      timeout: 90_000,
    });
  } finally {
    await recoverDocument(tauriPage);
  }
});
