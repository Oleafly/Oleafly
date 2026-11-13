import { expect, type NotesPage, test } from "../notes-page";

interface Write {
  projectId: string;
  path: string;
  content: string;
}

interface ProjectHarness {
  __writes: Write[];
  __disk: Map<string, string>;
  __created: { name: string; source: string; relatedProject: string | null }[];
  __recycled: string[];
  __writeFromDisk(path: string, text: string): void;
}

function harness<T>(notes: NotesPage, read: (window: ProjectHarness) => T): Promise<T> {
  return notes.page.evaluate(`(${read.toString()})(window)`) as Promise<T>;
}

function lastWrite(notes: NotesPage, path: string): Promise<string> {
  return notes.page.evaluate(
    (file) => (window as unknown as ProjectHarness).__writes.filter((write) => write.path === file).at(-1)?.content ?? "",
    path,
  );
}

function body(notes: NotesPage) {
  return notes.page.locator("main .ProseMirror:visible");
}

function panel(notes: NotesPage) {
  return notes.page.getByTestId("project-notes-panel");
}

async function rowAction(notes: NotesPage, title: string, action: string): Promise<void> {
  await panel(notes).getByRole("button", { name: `Actions for ${title}` }).click();
  await notes.page.getByRole("menuitem", { name: action }).click();
}

test.describe("project notes in the project view", () => {
  test("opens a project note file in the Notes editor and saves typing to the file", async ({ notes }) => {
    const { page } = await notes.open("", "project-notes-harness");
    await expect(page.getByTestId("editor-note-tab-title")).toHaveText("Lab plan");
    await expect(page.getByTestId("project-note-tab")).toBeVisible();
    await expect(notes.title).toHaveValue("Lab plan");
    await expect(page.getByTestId("note-tab-bar")).toContainText("Project note");
    await expect(body(notes)).toContainText("Run the sweep twice.");

    await body(notes).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Then compare.");
    await expect.poll(() => lastWrite(notes, "notes/Plan.md"), { timeout: 10_000 }).toContain("Run the sweep twice. Then compare.");
    const saved = await lastWrite(notes, "notes/Plan.md");
    expect(saved).toContain("kind: note");
    expect(saved).toContain("title: Lab plan");
  });

  test("switches a note file to Markdown from the tab menu and back", async ({ notes }) => {
    const { page } = await notes.open("", "project-notes-harness");
    await page.getByTestId("editor-note-tab-title").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Edit as Markdown" }).click();
    await expect(page.getByTestId("project-note-tab")).toHaveCount(0);
    await expect(page.locator("main .cm-editor")).toBeVisible();
    await page.getByText("Plan.md", { exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Edit as note" }).click();
    await expect(page.getByTestId("project-note-tab")).toBeVisible();
  });

  test("lists both kinds of notes and opens a personal note as its own tab", async ({ notes }) => {
    const { page } = await notes.open("", "project-notes-harness");
    await expect(panel(notes).getByTestId("project-note-file")).toHaveText(/Lab plan/);
    await expect(panel(notes).getByTestId("project-note")).toHaveText(/Reading list/);
    await panel(notes).getByRole("button", { name: "Reading list", exact: true }).click();
    await expect(page.getByTestId("editor-personal-note-tab-title")).toHaveText("Reading list");
    await expect(page.getByTestId("personal-note-tab")).toBeVisible();
    await expect(page.locator('[data-testid="note-tab-bar"]:visible')).toContainText("Only you can see it");
    await expect(notes.title).toHaveValue("Reading list");

    await page.getByTestId("editor-note-tab-title").click();
    await expect(page.getByTestId("project-note-tab")).toBeVisible();
    await expect(page.getByTestId("personal-note-tab")).toBeHidden();
  });

  test("opens a project note from the panel", async ({ notes }) => {
    const { page } = await notes.open("", "project-notes-harness");
    await page.getByText("main.tex", { exact: true }).click();
    await expect(page.getByTestId("project-note-tab")).toBeHidden();
    await panel(notes).getByRole("button", { name: "Lab plan", exact: true }).click();
    await expect(page.getByTestId("project-note-tab")).toBeVisible();
  });

  test("renames a project note in its file and moves the file, and the tab follows", async ({ notes }) => {
    const { page } = await notes.open("", "project-notes-harness");
    await rowAction(notes, "Lab plan", "Rename");
    const field = panel(notes).getByRole("textbox");
    await field.fill("Sweep plan");
    await field.press("Enter");
    await expect.poll(() => harness(notes, (window) => [...window.__disk.keys()])).toContain("paper/notes/Sweep plan.md");
    expect(await harness(notes, (window) => window.__disk.get("paper/notes/Sweep plan.md") ?? "")).toContain("title: Sweep plan");
    await expect(page.getByTestId("editor-note-tab-title")).toHaveText("Sweep plan");
  });

  test("copies a project note to my notes as a new personal note", async ({ notes }) => {
    const { page } = await notes.open("", "project-notes-harness");
    await rowAction(notes, "Lab plan", "Copy to my notes");
    await expect.poll(() => harness(notes, (window) => window.__created.length)).toBe(1);
    const [copy] = await harness(notes, (window) => window.__created);
    expect(copy.name).toBe("Lab plan");
    expect(copy.relatedProject).toBe("paper");
    expect(copy.source).toContain("Run the sweep twice.");
    expect(copy.source).not.toContain("id: 6f1e2d3c-1111-4a2b-8c9d-0e1f2a3b4c5d");
    await expect(page.getByTestId("personal-note-tab")).toBeVisible();
    expect(await harness(notes, (window) => window.__disk.has("paper/notes/Plan.md"))).toBe(true);
  });

  test("moves a personal note into the project as a file and recycles the personal copy", async ({ notes }) => {
    const { page } = await notes.open("", "project-notes-harness");
    await rowAction(notes, "Reading list", "Move into project");
    await page.getByRole("alertdialog").getByRole("button", { name: "Move into project" }).click();
    await expect.poll(() => harness(notes, (window) => window.__recycled)).toEqual(["mine"]);
    const moved = await harness(notes, (window) => window.__disk.get("paper/notes/Reading list.md") ?? "");
    expect(moved).toContain("title: Reading list");
    expect(moved).toContain("Papers to read.");
  });

  test("shows an outside change to a project note as a suggestion", async ({ notes }) => {
    const { page } = await notes.open("", "project-notes-harness");
    await expect(body(notes)).toContainText("Run the sweep twice.");
    const plan = await harness(notes, (window) => window.__disk.get("paper/notes/Plan.md") ?? "");
    await page.evaluate(
      (text) => (window as unknown as ProjectHarness).__writeFromDisk("notes/Plan.md", text),
      plan.replace("Run the sweep twice.", "Run the sweep three times."),
    );
    await expect(body(notes).locator(".note-diff-insert")).toContainText("three times");
    await notes.button("Accept").click();
    await expect(body(notes)).toContainText("Run the sweep three times.");
  });
});
