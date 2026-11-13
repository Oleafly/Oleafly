import { expect, type NotesPage, test } from "../notes-page";

const ABSTRACT_ID = "2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3e02";

const PLAN = `---
title: Abstract draft
kind: note
id: ${ABSTRACT_ID}
---

- [ ] Rerun the sweep [due:: 2026-11-02] [priority:: high]
- [ ] Write the abstract
`;

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function inDays(days: number): string {
  const now = new Date();
  return iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}

async function openPlan(notes: NotesPage): Promise<void> {
  await notes.open();
  await notes.writeFromDisk("abstract", PLAN);
  await notes.openNote("Abstract draft");
}

test.describe("Notes task fields", () => {
  test("shows inline fields as chips and keeps their Markdown", async ({ notes }) => {
    await openPlan(notes);
    const chips = notes.editor.locator(".note-field");
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toHaveAttribute("data-when", "past");
    await expect(chips.nth(0).locator("svg.note-field-icon")).toBeVisible();
    await expect(chips.nth(0)).not.toContainText("Due");
    await expect(chips.nth(0)).toHaveAccessibleName(/^Due: /u);
    await expect(chips.nth(1)).toHaveAccessibleName("Priority: High");
    expect(await notes.text("abstract")).toBe(PLAN);
  });

  test("adds a due date and a priority to a task from the @ menu", async ({ notes }) => {
    await openPlan(notes);
    await notes.caretAtEnd(notes.editor.locator("li").nth(1).locator("p"));
    await notes.page.keyboard.type(" @tom");
    const menu = notes.page.getByRole("listbox", { name: "Insert a date, field, tag or note" });
    await expect(menu.getByRole("group", { name: "Due date" })).toBeVisible();
    await expect(menu.getByRole("option").first()).toContainText("Tomorrow");
    await notes.page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await notes.page.keyboard.type("@prio");
    await notes.page.keyboard.press("Enter");
    await expect(menu.getByRole("option")).toHaveText(["High", "Medium", "Low"]);
    await notes.page.keyboard.type("lo");
    await notes.page.keyboard.press("Enter");
    await expect.poll(() => notes.text("abstract")).toContain(`- [ ] Write the abstract [due:: ${inDays(1)}] [priority:: low]`);
  });

  test("changes a date by clicking its chip", async ({ notes }) => {
    await openPlan(notes);
    await notes.editor.locator(".note-field").first().click();
    const editor = notes.page.getByRole("dialog", { name: "Edit Due" });
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: /November 20th, 2026/u }).click();
    await expect(editor).toHaveCount(0);
    await expect.poll(() => notes.text("abstract")).toContain("[due:: 2026-11-20]");
  });
});

const TASKS = `---
title: Abstract draft
kind: note
id: ${ABSTRACT_ID}
---

- [ ] Rerun the sweep [due:: 2026-11-02] [priority:: low]
- [ ] Write the abstract [priority:: high] #writing
- [x] Book the cluster
`;

test.describe("Notes tasks list", () => {
  test("lists tasks from every note on Home, filters them and checks one off", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.writeFromDisk("abstract", TASKS);
    await page.getByRole("tab", { name: "Tasks" }).click();
    const rows = page.getByRole("list", { name: "Tasks" }).getByRole("listitem");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Rerun the sweep");
    await expect(rows.nth(0).locator('.note-field[data-field-key="due"][data-when="past"]')).toBeVisible();

    await page.getByRole("button", { name: "Due date", exact: true }).click();
    await page.getByRole("menuitem", { name: "Priority" }).click();
    await expect(rows.nth(0)).toContainText("Write the abstract");
    await expect(rows.nth(0).getByText("#writing")).toBeVisible();
    await expect(rows.nth(1).getByText("#writing")).toHaveCount(0);

    await page.getByRole("button", { name: "Due: Any due date" }).click();
    await page.getByRole("menuitem", { name: "Overdue" }).click();
    await expect(rows).toHaveCount(1);
    await rows.nth(0).getByRole("checkbox", { name: 'Mark "Rerun the sweep" as done' }).click();
    await expect.poll(() => notes.text("abstract")).toContain("- [x] Rerun the sweep");
    await expect(rows).toHaveCount(0);
    await expect(page.getByText("No tasks match these filters.")).toBeVisible();

    await page.getByRole("button", { name: "Clear filters" }).click();
    await rows.filter({ hasText: "Write the abstract" }).getByRole("button", { name: "Open Abstract draft" }).click();
    await expect(notes.title).toHaveValue("Abstract draft");
  });

  test("checks a task off in an open note without leaving a suggestion", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.writeFromDisk("abstract", TASKS);
    await notes.openNote("Abstract draft");
    await page.getByRole("tab", { name: "Home" }).click();
    await page.getByRole("tab", { name: "Tasks" }).click();
    await page.getByRole("checkbox", { name: 'Mark "Write the abstract" as done' }).click();
    await expect.poll(() => notes.text("abstract")).toContain("- [x] Write the abstract");
    await page.getByRole("tab", { name: "Abstract draft" }).click();
    await expect(notes.editor.locator('li[data-checked="true"]')).toHaveCount(2);
    await expect(notes.diffs).toHaveCount(0);
  });
});

test.describe("Notes calendar", () => {
  test("opens daily, weekly and monthly notes from the sidebar and marks the days", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.sidebar.getByRole("button", { name: "Calendar", exact: true }).click();
    const calendar = notes.sidebar.locator("[data-notes-calendar]");
    await expect(calendar).toBeVisible();
    const today = new Date();
    const dayLabel = new Intl.DateTimeFormat("en", { dateStyle: "full" }).format(today);
    const day = calendar.getByRole("button", { name: new RegExp(`^${dayLabel}`, "u") });
    await expect(day).not.toHaveAttribute("data-day-note", "true");
    await day.click();
    await expect(notes.title).toHaveValue(inDays(0));
    await expect(day).toHaveAttribute("data-day-note", "true");
    await expect(day).toHaveAccessibleName(`${dayLabel}, has a daily note`);

    const week = calendar.getByRole("row").filter({ has: page.getByRole("button", { name: new RegExp(`^${dayLabel}`, "u") }) }).locator("[data-week]");
    const number = Number(await week.getAttribute("data-week"));
    await week.click();
    await expect(notes.title).toHaveValue(new RegExp(`^\\d{4}-W${String(number).padStart(2, "0")}$`, "u"));
    expect(await notes.text("new-2")).toContain("tags: [weekly]");

    await expect(day).toHaveClass(/(^|\s)bg-primary(\s|$)/u);
    await expect(calendar.getByText("Daily note", { exact: true })).toHaveCount(0);

    const month = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(today);
    await calendar.getByRole("button", { name: month, exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Choose a month" });
    await picker.getByRole("button", { name: "Create monthly note" }).click();
    await expect(picker).toBeHidden();
    await expect(notes.title).toHaveValue(inDays(0).slice(0, 7));

    const lastYear = new Date(today.getFullYear() - 1, 2, 1);
    const march = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(lastYear);
    await calendar.getByRole("button", { name: month, exact: true }).click();
    await expect(picker.getByRole("button", { name: month, exact: true })).toBeFocused();
    await picker.getByRole("button", { name: "Previous year" }).click();
    await picker.getByRole("button", { name: march, exact: true }).click();
    await expect(picker).toBeHidden();
    await expect(calendar.getByRole("button", { name: march, exact: true })).toBeVisible();
    await calendar.getByRole("button", { name: "Today", exact: true }).click();
    await expect(calendar.getByRole("button", { name: month, exact: true })).toBeVisible();
    await page.reload();
    await expect(notes.sidebar.locator("[data-notes-calendar]")).toBeVisible();
  });

  test("keeps its height when Today comes and goes with the month", async ({ notes }) => {
    await notes.open();
    await notes.sidebar.getByRole("button", { name: "Calendar", exact: true }).click();
    const calendar = notes.sidebar.locator("[data-notes-calendar]");
    const height = async () => (await calendar.boundingBox())?.height;
    const start = await height();
    await expect(calendar.getByRole("button", { name: "Today", exact: true })).toHaveCount(0);
    await calendar.getByRole("button", { name: /next month/iu }).click();
    await expect(calendar.getByRole("button", { name: "Today", exact: true })).toBeVisible();
    expect(await height()).toBe(start);
    await calendar.getByRole("button", { name: "Today", exact: true }).click();
    await expect(calendar.getByRole("button", { name: "Today", exact: true })).toHaveCount(0);
    expect(await height()).toBe(start);
  });

  test("shows a mark on days with tasks due", async ({ notes }) => {
    await notes.open();
    await notes.writeFromDisk("abstract", TASKS.replace("[priority:: high]", `[due:: ${inDays(1)}]`));
    await notes.sidebar.getByRole("button", { name: "Calendar", exact: true }).click();
    const label = new Intl.DateTimeFormat("en", { dateStyle: "full" }).format(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1));
    const tomorrow = notes.sidebar.locator("[data-notes-calendar]").getByRole("button", { name: new RegExp(`^${label}`, "u") });
    await expect(tomorrow).toHaveAttribute("data-day-due", "1");
  });

  test("marks a due date typed into an open note right away", async ({ notes }) => {
    await notes.open();
    await notes.writeFromDisk("abstract", TASKS);
    await notes.openNote("Abstract draft");
    await notes.sidebar.getByRole("button", { name: "Calendar", exact: true }).click();
    const now = new Date();
    const label = new Intl.DateTimeFormat("en", { dateStyle: "full" }).format(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const tomorrow = notes.sidebar.locator("[data-notes-calendar]").getByRole("button", { name: new RegExp(`^${label}`, "u") });
    await expect(tomorrow).not.toHaveAttribute("data-day-due", /\d/u);
    await notes.caretAtEnd(notes.editor.locator("li").nth(1).locator("p"));
    await notes.page.keyboard.type(" @tom");
    await notes.page.keyboard.press("Enter");
    await expect.poll(() => notes.text("abstract")).toContain(`[due:: ${inDays(1)}]`);
    await expect(tomorrow).toHaveAttribute("data-day-due", "1");
  });
});
