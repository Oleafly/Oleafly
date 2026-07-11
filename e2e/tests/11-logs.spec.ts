import { test, expect } from "../fixtures";
import { openProject, pressGlobal, typeInEditorAfter } from "../helpers";

// The compile log and the full error -> fix -> recover loop, all through the
// real Tectonic compiler.

// Unique per run so leftovers from earlier runs can never collide (defining
// the same \newcommand twice is itself a LaTeX error).
const CMD = `notacmd${Date.now().toString(36)}`;

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

  // Break the document with an undefined command.
  await typeInEditorAfter(tauriPage, "here.", ` \\${CMD}`);
  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "error", {
    timeout: 90_000,
  });

  // Fix it by defining the command before its use (\providecommand is
  // idempotent, so a rerun against the same document stays green).
  await typeInEditorAfter(tauriPage, "maketitle", `\n\\providecommand{\\${CMD}}{}`);
  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 90_000,
  });
});
