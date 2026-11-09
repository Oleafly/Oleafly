import { expect, type Page, test } from "@playwright/test";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";

interface Write {
  projectId: string;
  path: string;
  content: string;
}

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${BASE_URL}/e2e/project-notes-harness.html`);
  await page.waitForFunction(() => document.body.dataset.fixtureState === "mounted", null, { timeout: 60_000 });
  return errors;
}

function writes(page: Page): Promise<Write[]> {
  return page.evaluate(() => (window as unknown as { __writes: Write[] }).__writes);
}

function editorBody(page: Page) {
  return page.locator("main .ProseMirror:visible");
}

test.describe("project notes in the project view", () => {
  test("opens a project note file in the Notes editor and saves typing to the file", async ({ page }) => {
    const errors = await open(page);
    await expect(page.getByTestId("editor-note-tab-title")).toHaveText("Lab plan");
    await expect(page.getByTestId("project-note-tab")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Lab plan");
    await expect(page.getByTestId("note-tab-bar")).toContainText("Project note");
    await expect(editorBody(page)).toContainText("Run the sweep twice.");

    await editorBody(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Then compare.");
    await expect
      .poll(async () => (await writes(page)).filter((write) => write.path === "notes/Plan.md").at(-1)?.content ?? "", {
        timeout: 10_000,
      })
      .toContain("Run the sweep twice. Then compare.");
    const saved = (await writes(page)).filter((write) => write.path === "notes/Plan.md").at(-1);
    expect(saved?.content).toContain("kind: note");
    expect(saved?.content).toContain("title: Lab plan");
    expect(errors).toEqual([]);
  });

  test("switches a note file to Markdown from the tab menu and back", async ({ page }) => {
    await open(page);
    await page.getByTestId("editor-note-tab-title").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Edit as Markdown" }).click();
    await expect(page.getByTestId("project-note-tab")).toHaveCount(0);
    await expect(page.locator("main .cm-editor")).toBeVisible();
    await page.getByText("Plan.md", { exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Edit as note" }).click();
    await expect(page.getByTestId("project-note-tab")).toBeVisible();
  });

  test("lists both kinds of notes and opens a personal note as its own tab", async ({ page }) => {
    await open(page);
    const panel = page.getByTestId("project-notes-panel");
    await expect(panel.getByTestId("project-note-file")).toHaveText(/Lab plan/);
    await expect(panel.getByTestId("project-note")).toHaveText(/Reading list/);
    await panel.getByRole("button", { name: "Reading list", exact: true }).click();
    await expect(page.getByTestId("editor-personal-note-tab-title")).toHaveText("Reading list");
    await expect(page.getByTestId("personal-note-tab")).toBeVisible();
    await expect(page.locator('[data-testid="note-tab-bar"]:visible')).toContainText("Only you can see it");
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Reading list");

    await page.getByTestId("editor-note-tab-title").click();
    await expect(page.getByTestId("project-note-tab")).toBeVisible();
    await expect(page.getByTestId("personal-note-tab")).toBeHidden();
  });

  test("opens a project note from the panel", async ({ page }) => {
    await open(page);
    await page.getByText("main.tex", { exact: true }).click();
    await expect(page.getByTestId("project-note-tab")).toBeHidden();
    await page.getByTestId("project-notes-panel").getByRole("button", { name: "Lab plan", exact: true }).click();
    await expect(page.getByTestId("project-note-tab")).toBeVisible();
  });
});
