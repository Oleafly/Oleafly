import { expect, INFO_PLACES, test } from "../notes-page";

test.describe("Notes workspace", () => {
  test("lists notes as cards on Home and artifacts in the sidebar", async ({ notes }) => {
    await notes.open();
    await expect(notes.page.getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(notes.sidebar.getByRole("heading", { name: "SSL masking" })).toBeVisible();
    await expect(notes.sidebar.getByRole("button", { name: /Masking strategy report/ })).toBeVisible();
    await expect(notes.sidebar.getByRole("button", { name: /Run 3, mask ratio 0.60/ })).toBeVisible();
    await expect(notes.shown.locator("[data-note-card]")).toHaveCount(4);
    await expect(notes.shown.getByText("Run 3, mask ratio 0.60")).toHaveCount(0);
  });

  test("shows a pointer over sidebar rows and folds a project group from its header", async ({ notes }) => {
    await notes.open();
    const sidebar = notes.sidebar;
    const row = sidebar.getByRole("button", { name: /Masking strategy report/ });
    const group = () => sidebar.getByRole("heading", { name: "SSL masking" }).getByRole("button");
    await expect(row).toHaveCSS("cursor", "pointer");
    await expect(group()).toHaveCSS("cursor", "pointer");
    await expect(group()).toHaveAttribute("aria-expanded", "true");
    await group().click();
    await expect(group()).toHaveAttribute("aria-expanded", "false");
    await expect(row).toHaveCount(0);
    await notes.page.reload();
    await expect(group()).toHaveAttribute("aria-expanded", "false");
    await group().click();
    await expect(row).toBeVisible();
  });

  test("filters the sidebar by kind, author and search", async ({ notes }) => {
    await notes.open();
    const sidebar = notes.sidebar;
    await sidebar.getByRole("button", { name: "Tags" }).click();
    const kinds = sidebar.getByRole("group", { name: "Kind" });
    const authors = sidebar.getByRole("group", { name: "Written by" });
    await kinds.getByRole("button", { name: "Data", exact: true }).click();
    await expect(sidebar.getByRole("button", { name: /Run 3, mask ratio 0.60/ })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /Masking strategy report/ })).toHaveCount(0);
    await kinds.getByRole("button", { name: "All", exact: true }).click();
    await expect(sidebar.getByRole("button", { name: "Clear filters" })).toHaveCount(0);
    await authors.getByRole("button", { name: "You", exact: true }).click();
    await expect(sidebar.getByRole("button", { name: /Abstract draft/ })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /Masking strategy report/ })).toHaveCount(0);
    const clear = await sidebar.getByRole("button", { name: "Clear filters" }).boundingBox();
    const you = await authors.getByRole("button", { name: "You", exact: true }).boundingBox();
    const filters = await sidebar.getByTestId("notes-filters").boundingBox();
    expect(clear && you && filters).toBeTruthy();
    if (clear && you && filters) {
      expect(Math.abs(clear.y + clear.height / 2 - (you.y + you.height / 2))).toBeLessThan(2);
      expect(clear.x).toBeGreaterThan(you.x + you.width);
      expect(filters.x + filters.width - (clear.x + clear.width)).toBeLessThan(16);
    }
    await authors.getByRole("button", { name: "All", exact: true }).click();
    await expect(sidebar.getByRole("button", { name: "Clear filters" })).toHaveCount(0);
    await (await notes.searchBox()).fill("zzz");
    await expect(sidebar.getByText('No notes match "zzz".')).toBeVisible();
  });

  test("shows tags as wrapping badges, narrows them with the box and toggles one from the keyboard", async ({ notes }) => {
    const { page } = await notes.open();
    const topics = Array.from({ length: 30 }, (_, index) => `topic-${String(index + 1).padStart(2, "0")}`);
    const text = await notes.text("abstract");
    await notes.writeFromDisk("abstract", text.replace("## Contributions", `${["ablation", "lab/todo", ...topics].map((tag) => `#${tag}`).join(" ")}\n\n## Contributions`));
    const sidebar = notes.sidebar;
    await sidebar.getByRole("button", { name: "Tags" }).click();
    const list = sidebar.getByRole("list", { name: "Tags in your notes" });
    const badges = list.getByRole("button");
    await expect(badges).toHaveCount(30);
    await expect(list.getByRole("button", { name: "Show notes tagged lab/todo" })).toHaveText("#lab/todo1");
    const tops = await badges.evaluateAll((all) => all.map((badge) => Math.round(badge.getBoundingClientRect().top)));
    expect(tops[1]).toBe(tops[0]);
    expect(new Set(tops).size).toBeGreaterThan(1);

    await sidebar.getByRole("button", { name: "Show all 33" }).click();
    await expect(badges).toHaveCount(33);
    await sidebar.getByRole("button", { name: "Show fewer" }).click();
    await expect(badges).toHaveCount(30);

    const box = sidebar.getByRole("searchbox", { name: "Filter tags" });
    await box.fill("LAB");
    await expect(badges).toHaveText(["#lab1", "#lab/todo1"]);
    await box.fill("zzz");
    await expect(sidebar.getByText('No tags match "zzz".')).toBeVisible();
    await box.press("Escape");
    await expect(box).toHaveValue("");
    await expect(badges).toHaveCount(30);

    await box.press("Tab");
    const first = list.getByRole("button", { name: "Show notes tagged ablation" });
    await expect(first).toBeFocused();
    await expect(first).toHaveCSS("outline-style", "none");
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("aria-pressed", "true");
    await expect(sidebar.getByRole("button", { name: "Stop filtering by ablation" })).toBeVisible();
    await expect(sidebar.getByRole("option", { name: /Abstract draft/ })).toBeVisible();
    await page.keyboard.press(" ");
    await expect(first).toHaveAttribute("aria-pressed", "false");
    await expect(sidebar.getByRole("button", { name: "Stop filtering by ablation" })).toHaveCount(0);
    const writtenBy = await sidebar.getByRole("group", { name: "Written by" }).boundingBox();
    const listBox = await list.boundingBox();
    if (!writtenBy || !listBox) throw new Error("no geometry");
    expect(writtenBy.y).toBeGreaterThan(listBox.y + listBox.height);
  });

  test("previews task files and copies one into the note", async ({ notes }) => {
    await notes.open();
    await notes.openNote("Masking strategy report");
    await notes.page.getByRole("button", { name: "Artifacts, 4" }).click();
    const panel = notes.page.getByRole("complementary", { name: "Artifacts" });
    await expect(panel.getByText("From the task Review run 3")).toBeVisible();
    await expect(panel.getByText("figures/loss-curve.svg")).toBeVisible();
    await expect(panel.getByRole("img", { name: "Validation curve, runs 1 to 3" })).toBeVisible();
    await panel.getByRole("button", { name: "Insert in note" }).click();
    await expect(notes.editor.locator(".note-image img")).toHaveAttribute("src", /^data:image\/svg\+xml/);
    await expect.poll(() => notes.text("masking")).toContain("![Validation curve, runs 1 to 3](assets/loss-curve.svg)");

    await panel.getByRole("button", { name: /Run 3, mask ratio 0.60/ }).click();
    await expect(panel.getByRole("cell", { name: "64.1%" })).toBeVisible();
    await panel.getByRole("button", { name: /Weekly progress report/ }).click();
    await expect(panel.getByText("Three runs finished.", { exact: false })).toBeVisible();
    await panel.getByRole("button", { name: /Mask sampler explorer/ }).click();
    await expect(panel.getByText("To run this figure, paste its code into an HTML block in a note and press Run.")).toBeVisible();
    await panel.getByRole("button", { name: "Insert in note" }).click();
    await expect.poll(() => notes.text("masking")).toContain("[Mask sampler explorer](assets/mask-sampler.html)");
  });

  test("changes the note's project from the title bar", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Reading notes: masked autoencoders");
    await page.getByRole("button", { name: /^Artifacts/ }).click();
    const panel = page.getByRole("complementary", { name: "Artifacts" });
    await expect(panel.getByText("Files that research tasks in Literature make will show up here.", { exact: false })).toBeVisible();
    const crumbs = notes.shown.getByRole("navigation", { name: "Breadcrumb" });
    await crumbs.getByRole("button", { name: "Project: Literature" }).click();
    await page.getByRole("menuitemradio", { name: "No project" }).click();
    await expect(crumbs.getByRole("button", { name: "Project: Choose project" })).toHaveText("Choose project");
    await expect(panel.getByText("Choose the project this note is about", { exact: false })).toBeVisible();
    await crumbs.getByRole("button", { name: "Project: Choose project" }).click();
    await page.getByRole("menuitemradio", { name: "SSL masking" }).click();
    await expect(page.getByRole("button", { name: "Artifacts, 4" })).toBeVisible();
    await expect(panel.getByRole("button", { name: /Weekly progress report/ })).toBeVisible();
  });

  test("reads Home, the project and the title in the note's breadcrumb, and opens Home in the same tab", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Reading notes: masked autoencoders");
    const crumbs = notes.shown.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("listitem")).toHaveText(["", "Literature", "Reading notes: masked autoencoders"]);
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText("Reading notes: masked autoencoders");
    await expect(notes.tabs).toHaveText(["Home", "Reading notes: masked autoencoders"]);
    await crumbs.getByRole("button", { name: "Notes Home", exact: true }).click();
    await expect(notes.tabs).toHaveText(["Home", "Home"]);
    await expect(notes.tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(notes.shown.getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  });

  test("keeps both the project and the title in view when the breadcrumb runs out of room", async ({ notes }) => {
    await notes.open();
    await notes.openNote("Reading notes: masked autoencoders");
    const crumbs = notes.shown.getByRole("navigation", { name: "Breadcrumb" });
    await crumbs.evaluate((nav) => {
      nav.style.flex = "none";
      nav.style.width = "140px";
    });
    const project = await crumbs.getByRole("button", { name: "Project: Literature" }).boundingBox();
    const title = await crumbs.locator('[aria-current="page"]').boundingBox();
    if (!project || !title) throw new Error("no geometry");
    expect(project.width).toBeGreaterThan(16);
    expect(title.width).toBeGreaterThan(32);
  });

  test("starts a new note", async ({ notes }) => {
    await notes.open();
    await notes.sidebar.getByRole("button", { name: "New note" }).click();
    await expect(notes.title).toHaveValue("Untitled");
    await expect(notes.sidebar.getByRole("button", { name: /Untitled/ })).toBeVisible();
  });

  test("keeps notes open as tabs, docks one beside another and restores the layout and the text", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Abstract draft");
    await notes.firstParagraph.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Draft two.");
    await notes.openNote("Dataloader rewrite: what changed");
    await expect(notes.tabs).toHaveText(["Home", "Abstract draft", "Dataloader rewrite: what changed"]);

    await page.getByRole("tab", { name: "Abstract draft" }).click();
    await expect(notes.firstParagraph).toContainText("Draft two.");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(notes.firstParagraph).not.toContainText("Draft two.");
    await notes.firstParagraph.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Draft three.");
    await expect.poll(() => notes.text("abstract")).toContain("up to a point. Draft three.");

    await notes.dockRight("Dataloader rewrite: what changed");
    await expect(page.getByRole("tabpanel", { name: "Abstract draft" })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "Dataloader rewrite: what changed" })).toBeVisible();

    await notes.reload();
    await expect(page.locator("[data-group] > [data-slot]")).toHaveCount(2);
    await expect(page.getByRole("tab", { name: "Dataloader rewrite: what changed" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: "Abstract draft" }).locator(".ProseMirror > p").first()).toContainText(
      "up to a point. Draft three.",
    );
  });

  test("fills Home with the note background in light and dark", async ({ notes }) => {
    for (const query of ["", "?theme=dark"]) {
      await notes.open(query);
      const fill = await notes.shown.evaluate((view) => {
        const scroller = view.firstElementChild as HTMLElement;
        return {
          view: getComputedStyle(view).backgroundColor,
          home: getComputedStyle(scroller).backgroundColor,
          gap: view.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom,
        };
      });
      expect(fill.home).toBe(fill.view);
      expect(Math.abs(fill.gap)).toBeLessThan(1);
    }
  });

  test("fills an empty panel with a greeting, templates and the notes edited last", async ({ notes }) => {
    const { page } = await notes.open();
    await page.getByRole("button", { name: "Close Home" }).click();
    const empty = page.locator("[data-empty-panel]");
    await expect(empty.locator("time")).toBeVisible();
    await expect(empty.getByRole("heading", { level: 2 })).toHaveText(
      /^(Where should we begin\?|Ready when you are\.|What's on your mind today\?|Pick up where you left off\?|What are you working on\?)$/,
    );
    const grid = empty.locator(".grid");
    await expect(grid.getByRole("button")).toHaveCount(6);
    await expect(grid.getByRole("button").first()).toHaveAccessibleName("Blank note");
    expect(await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(3);
    const recent = empty.getByRole("region", { name: "Continue" });
    const pills = recent.locator("[data-recent-notes] > button");
    await expect(pills).toHaveText([/Masking strategy report$/, "Abstract draft", "Reading notes: masked autoencoders", "Dataloader rewrite: what changed"]);
    const centring = await recent.locator("[data-recent-notes]").evaluate((row) => {
      const box = row.getBoundingClientRect();
      const items = [...row.children].map((child) => child.getBoundingClientRect());
      const top = Math.min(...items.map((item) => item.top));
      const first = items.filter((item) => item.top === top);
      const left = Math.min(...first.map((item) => item.left));
      const right = Math.max(...first.map((item) => item.right));
      return left - box.left - (box.right - right);
    });
    expect(Math.abs(centring)).toBeLessThan(2);
    await empty.getByRole("button", { name: "More templates" }).click();
    const picker = page.getByRole("dialog", { name: "New note from a template" });
    await expect(picker.getByRole("combobox")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await empty.getByRole("button", { name: "Search all notes" }).click();
    await expect(notes.sidebar.getByRole("combobox", { name: "Search notes and artifacts" })).toBeFocused();
    await pills.filter({ hasText: "Abstract draft" }).click();
    await expect(notes.tabs).toHaveText(["Abstract draft"]);
    await expect(empty).toHaveCount(0);
  });

  test("keeps the empty panel inside a narrow panel and works from the keyboard", async ({ notes }) => {
    const { page } = await notes.open();
    await page.getByRole("button", { name: "Close Home" }).click();
    const empty = page.locator("[data-empty-panel]");
    const columns = () => empty.locator(".grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
    const overflow = () => empty.evaluate((element) => element.scrollWidth - element.clientWidth);
    await page.setViewportSize({ width: 860, height: 800 });
    await expect.poll(columns).toBe(2);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 600, height: 800 });
    await expect.poll(columns).toBe(1);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await empty.getByRole("button", { name: "Home", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(empty.getByRole("button", { name: "New note", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(empty.getByRole("button", { name: "Blank note" })).toBeFocused();
    await empty.getByRole("button", { name: "Reading notes: masked autoencoders" }).focus();
    await page.keyboard.press("Enter");
    await expect(notes.tabs).toHaveText(["Reading notes: masked autoencoders"]);
  });

  test("shows a greeting and three rows of templates over the rings when the vault is empty", async ({ notes }) => {
    const { page } = await notes.open();
    await Promise.all(["masking", "abstract", "reading", "dataloader"].map((id) => notes.removeFromDisk(id)));
    await page.getByRole("button", { name: "Close Home" }).click();
    const empty = page.locator("[data-empty-panel]");
    await expect(empty.getByRole("heading", { level: 2 })).toHaveText(
      /^(Where should we begin\?|Ready when you are\.|What would you like to write first\?|What's on your mind today\?|Start with a blank page or a template\.)$/,
    );
    await expect(empty.locator("time")).toHaveCount(0);
    await expect(empty.getByRole("region", { name: "Continue" })).toHaveCount(0);
    await expect(empty.locator(".grid").getByRole("button")).toHaveCount(9);
    await expect(empty.getByRole("button", { name: /^Research proposal/ })).toBeVisible();
    await expect(empty.locator("> [data-rings-pattern]")).toHaveCount(1);
    await expect(empty.getByRole("button", { name: "Blank note" })).not.toHaveClass(/primary/);
    await empty.getByRole("button", { name: /^Meeting notes/ }).click();
    await expect(notes.tabs).toHaveText([/^Meeting notes/]);
  });

  test("greets an empty vault on Home with the templates and an import", async ({ notes }) => {
    const { page } = await notes.open();
    await Promise.all(["masking", "abstract", "reading", "dataloader"].map((id) => notes.removeFromDisk(id)));
    const start = page.locator("[data-notes-start]");
    await expect(start.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(start.locator(".grid").getByRole("button")).toHaveCount(9);
    await expect(start.getByRole("button", { name: "Import Markdown" })).toBeVisible();
    await expect(page.locator("[data-rings-pattern]")).toHaveCount(1);
    await start.getByRole("button", { name: /^Daily note/ }).click();
    await expect(notes.tabs).toHaveText([/^\d{4}-\d{2}-\d{2}$/]);
  });

  test("closes an empty panel and keeps working in the one left", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Abstract draft");
    await notes.dockRight("Abstract draft");
    await page.getByRole("button", { name: "Close Home" }).click();
    const empty = page.locator("[data-group]", { has: page.locator("[data-empty-panel]") });
    await expect(empty.getByRole("button", { name: "New note", exact: true })).toBeVisible();
    await expect(empty.getByRole("button", { name: "Home", exact: true })).toBeVisible();
    await empty.getByRole("button", { name: "Close panel" }).click();
    await expect(page.locator("[data-empty-panel]")).toHaveCount(0);
    await expect(page.locator("[data-group] > [data-slot]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Close panel" })).toHaveCount(0);
    await notes.openNote("Masking strategy report");
    await expect(notes.tabs).toHaveText(["Abstract draft", /Masking strategy report$/]);
  });

  test("opens a new Home tab and replaces it with the note picked there", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    await page.getByRole("button", { name: "New tab" }).click();
    await expect(notes.tabs).toHaveText(["Home", /Masking strategy report$/, "Home"]);
    await expect(notes.tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await notes.shown.getByRole("button", { name: /Abstract draft/ }).click();
    await expect(notes.tabs).toHaveText(["Home", /Masking strategy report$/, "Abstract draft"]);
    await expect(page.getByRole("tab", { name: "Abstract draft" })).toHaveAttribute("aria-selected", "true");
    await expect(notes.title).toHaveValue("Abstract draft");
  });

  test("folds the filters at the bottom of the sidebar, counts the ones on and remembers the fold", async ({ notes }) => {
    const { page } = await notes.open();
    const sidebar = notes.sidebar;
    const toggle = sidebar.getByRole("button", { name: "Tags" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar.getByRole("button", { name: "Figures", exact: true })).toHaveCount(0);
    const search = await sidebar.getByRole("button", { name: "Search notes and artifacts" }).boundingBox();
    const fold = await toggle.boundingBox();
    const footer = await notes.sidebarFooter.boundingBox();
    if (!search || !fold || !footer) throw new Error("no geometry");
    expect(fold.y).toBeGreaterThan(search.y);
    expect(fold.y + fold.height).toBeGreaterThan(footer.y - 8);
    expect(fold.y + fold.height).toBeLessThanOrEqual(footer.y + 1);

    await toggle.click();
    await sidebar.getByRole("button", { name: "Figures", exact: true }).click();
    await sidebar.getByRole("button", { name: "Agents", exact: true }).click();
    const count = page.getByTestId("notes-filters").locator("output");
    await expect(count).toHaveText("2");
    await expect(count).toHaveAttribute("aria-label", "2 filters on");
    await expect(sidebar.getByRole("button", { name: /Validation curve, runs 1 to 3/ })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /Abstract draft/ })).toHaveCount(0);

    await notes.reload();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar.getByRole("button", { name: "Figures", exact: true })).toBeVisible();
    await toggle.click();
    await notes.reload();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("keeps the brand, Search and New note in the header and the vault actions in a footer pinned to the bottom", async ({ notes }) => {
    const { page } = await notes.open();
    const sidebar = notes.sidebar;
    const header = sidebar.locator("[data-tauri-drag-region]");
    const names = await header.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
    expect(names).toEqual(["Go to Notes Home", "Search notes and artifacts", "New note"]);
    await expect(header.locator("[data-brand-label]").first()).toHaveText("Oleafly Notes");
    expect(await header.evaluate((element) => [getComputedStyle(element).borderBottomWidth, element.getBoundingClientRect().height])).toEqual([
      "0px",
      48,
    ]);
    const footerNames = await notes.sidebarFooter
      .getByRole("button")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
    expect(footerNames).toEqual(["Today's note", "Go to note", "Graph view", "New from template", "More", "Switch to dark theme", "Settings"]);

    const aside = await sidebar.boundingBox();
    const footer = await notes.sidebarFooter.boundingBox();
    const gear = await sidebar.getByRole("button", { name: "Settings" }).boundingBox();
    if (!aside || !footer || !gear) throw new Error("no geometry");
    expect(Math.abs(footer.y + footer.height - (aside.y + aside.height))).toBeLessThan(2);
    expect(gear.x + gear.width).toBeLessThanOrEqual(aside.x + aside.width - 4);
    for (const part of [header, notes.sidebarFooter]) {
      expect(await part.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    }

    await sidebar.getByRole("button", { name: "Settings" }).click();
    await expect.poll(() => notes.settingsOpened()).toBe(1);

    const box = await notes.searchBox();
    const add = await sidebar.getByRole("button", { name: "New note" }).boundingBox();
    const field = await box.boundingBox();
    if (!add || !field) throw new Error("no geometry");
    expect(add.x).toBeGreaterThan(field.x + field.width - 1);
    expect(Math.abs(add.y + add.height / 2 - (field.y + field.height / 2))).toBeLessThan(4);
    expect(await header.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.getByRole("button", { name: "Go to Notes Home" })).toHaveCount(0);
  });

  test("folds the search field out of the Search button and back", async ({ notes }) => {
    const { page } = await notes.open();
    const sidebar = notes.sidebar;
    const searchButton = sidebar.getByRole("button", { name: "Search notes and artifacts" });
    const box = sidebar.getByRole("combobox", { name: "Search notes and artifacts" });
    await expect(box).toBeHidden();

    await notes.searchBox();
    await expect(sidebar.locator("kbd")).toHaveText("esc");
    const suggestions = sidebar.getByTestId("query-search-menu");
    await expect(suggestions).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(suggestions).toBeHidden();
    await expect(box).toBeHidden();
    await expect(searchButton).toBeFocused();

    await (await notes.searchBox()).fill("kind:");
    await expect(suggestions).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(suggestions).toBeHidden();
    await expect(box).toHaveValue("kind:");
    await expect(box).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(box).toBeHidden();
    await expect(searchButton).toBeFocused();

    await notes.searchBox();
    await page.getByRole("heading", { name: "Home" }).click();
    await expect(box).toBeHidden();

    await (await notes.searchBox()).fill("masking");
    const results = sidebar.getByRole("listbox", { name: "Matching notes" });
    await expect(results.getByRole("option", { name: /Masking strategy report/ })).toBeVisible();
    await page.getByRole("heading", { name: "Home" }).click();
    await expect(box).toHaveValue("masking");
    await results.getByRole("option", { name: /Masking strategy report/ }).click();
    await expect(notes.title).toHaveValue("Masking strategy report");
    await expect(box).toHaveValue("masking");
    await expect(results).toBeVisible();
    await box.focus();
    await page.keyboard.press("Escape");
    await expect(box).toBeHidden();
    await expect(searchButton).toBeFocused();
    await expect(sidebar.getByRole("button", { name: /Masking strategy report/ })).toBeVisible();
  });

  for (const place of INFO_PLACES) {
    test(`runs the Notes shortcuts: search, bookmark, note info (${place}) and new note`, async ({ notes }) => {
      const chord = (mac: string, other: string) => (process.platform === "darwin" ? `Meta+Alt+${mac}` : `Control+Shift+${other}`);
      await notes.placeInfo(place);
      const { page } = await notes.open();
      await notes.openNote("Abstract draft");
      await page.keyboard.press(chord("f", "a"));
      await expect(notes.sidebar.getByRole("combobox", { name: "Search notes and artifacts" })).toBeFocused();
      await notes.caretAtEnd();
      const prefs = () => page.evaluate(() => JSON.parse(localStorage.getItem("oleafly.notes.prefs") ?? "{}").state ?? {});
      await page.keyboard.press(chord("b", "y"));
      await expect.poll(async () => (await prefs()).favorites?.length ?? 0).toBe(1);
      await page.keyboard.press(chord("b", "y"));
      await expect.poll(async () => (await prefs()).favorites?.length ?? 0).toBe(0);
      const properties = async () => (await prefs()).propertiesOpen;
      const before = await properties();
      await page.keyboard.press(chord("i", "t"));
      if (place === "side") {
        await expect(notes.infoPanel).toBeVisible();
        await expect(notes.infoButton).toHaveAttribute("aria-pressed", "true");
        await notes.caretAtEnd();
        await page.keyboard.press(chord("i", "t"));
        await expect(notes.infoPanel).toHaveCount(0);
        expect(await properties()).toBe(before);
      } else {
        await expect.poll(properties).toBe(before === false);
        await expect(notes.infoButton).toHaveCount(0);
      }
      const tabs = await notes.tabs.count();
      await page.keyboard.press(chord("n", "n"));
      await expect(notes.tabs).toHaveCount(tabs + 1);
    });
  }

  test("shows a note's More button on hover and renames the note in its row and in its file", async ({ notes }) => {
    const { page } = await notes.open();
    const row = notes.sidebar.locator("[data-note-row]", { hasText: "Abstract draft" });
    const more = row.getByRole("button", { name: "More" });
    await expect(more).toHaveCSS("opacity", "0");
    await row.hover();
    await expect(more).toHaveCSS("opacity", "1");
    await more.click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const field = page.getByRole("textbox", { name: "Rename note" });
    await expect(field).toBeFocused();
    await field.fill("Abstract, second pass");
    await field.press("Enter");
    await expect(notes.sidebar.getByRole("button", { name: /Abstract, second pass/ })).toBeVisible();
    await expect(field).toHaveCount(0);
    await expect.poll(() => notes.text("abstract")).toContain("title: Abstract, second pass\n");

    await notes.sidebar.getByRole("button", { name: /Abstract, second pass/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByRole("textbox", { name: "Rename note" }).fill("Thrown away");
    await page.getByRole("textbox", { name: "Rename note" }).press("Escape");
    await expect(notes.sidebar.getByRole("button", { name: /Abstract, second pass/ })).toBeVisible();
  });

  test("tints the open note's whole row around its More button and gives the tab icon room", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Abstract draft");
    const row = notes.sidebar.locator("[data-note-row]", { hasText: "Abstract draft" });
    await row.hover();
    await expect
      .poll(() =>
        row.evaluate((element) => {
          const current = element.querySelector('[aria-current="page"]');
          const more = element.querySelector('[aria-label="More"]');
          let painted = current;
          while (painted && getComputedStyle(painted).backgroundColor === "rgba(0, 0, 0, 0)") painted = painted.parentElement;
          if (!painted || !more || !element.contains(painted)) return false;
          const box = painted.getBoundingClientRect();
          const button = more.getBoundingClientRect();
          return button.left >= box.left && button.right <= box.right && button.top >= box.top && button.bottom <= box.bottom;
        }),
      )
      .toBe(true);

    const tile = page.getByRole("tab", { name: "Abstract draft" }).locator("[data-note-color]");
    const room = await tile.evaluate((element) => {
      const glyph = element.querySelector("svg")?.getBoundingClientRect();
      return glyph ? (element.getBoundingClientRect().height - glyph.height) / 2 : 0;
    });
    expect(room).toBeGreaterThanOrEqual(3);
  });

  test("moves a note to another project from its row menu", async ({ notes }) => {
    const { page } = await notes.open();
    const row = notes.sidebar.locator("[data-note-row]", { hasText: "Reading notes: masked autoencoders" });
    await row.hover();
    await row.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Link to project" }).click();
    await page.getByRole("menuitem", { name: "Thesis" }).click();
    await expect(notes.sidebar.locator("section", { has: page.getByRole("heading", { name: "Thesis" }) })).toContainText(
      "Reading notes: masked autoencoders",
    );
  });

  test("asks before moving a note to the Recycle Bin, and a restored note comes back unchanged", async ({ notes }) => {
    const { page } = await notes.open();
    const before = await notes.text("dataloader");
    const row = notes.sidebar.locator("[data-note-row]", { hasText: "Dataloader rewrite: what changed" });
    await row.hover();
    await row.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading", { name: 'Move "Dataloader rewrite: what changed" to the Recycle Bin?' })).toBeVisible();
    await dialog.getByRole("button", { name: /^Cancel/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(notes.sidebar.getByRole("button", { name: /Dataloader rewrite: what changed/ })).toBeVisible();

    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await dialog.getByRole("button", { name: "Move to Recycle Bin" }).click();
    await expect(notes.sidebar.getByRole("button", { name: /Dataloader rewrite: what changed/ })).toHaveCount(0);
    expect(await notes.has("dataloader")).toBe(false);
    expect(await notes.recycled()).toEqual(["dataloader"]);

    await notes.restore("dataloader");
    await expect(notes.sidebar.getByRole("button", { name: /Dataloader rewrite: what changed/ })).toBeVisible();
    await notes.openNote("Dataloader rewrite: what changed");
    await expect(notes.editor).toContainText("streams shards");
    expect(await notes.text("dataloader")).toBe(before);
  });

  test("opens a note in a new tab from its row menu without replacing Home", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    await page.getByRole("button", { name: "New tab" }).click();
    const row = notes.sidebar.locator("[data-note-row]", { hasText: "Abstract draft" });
    await row.hover();
    await row.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Open in new tab" }).click();
    await expect(notes.tabs).toHaveText(["Home", /Masking strategy report$/, "Home", "Abstract draft"]);
    await expect(page.getByRole("tab", { name: "Abstract draft" })).toHaveAttribute("aria-selected", "true");

    await notes.sidebar.locator("[data-note-row]", { hasText: "Masking strategy report" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Open in new tab" }).click();
    await expect(notes.tabs).toHaveText(["Home", /Masking strategy report$/, "Home", "Abstract draft"]);
    await expect(page.getByRole("tab", { name: /Masking strategy report$/ })).toHaveAttribute("aria-selected", "true");
  });

  test("closes the tab of an open note when it is deleted", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Dataloader rewrite: what changed");
    const row = notes.sidebar.locator("[data-note-row]", { hasText: "Dataloader rewrite: what changed" });
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Move to Recycle Bin" }).click();
    await expect(notes.tabs).toHaveText(["Home"]);
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(page.getByText("This note is no longer in your library.")).toHaveCount(0);
  });

  test("closes the background tab of a note deleted from its card on Home", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Abstract draft");
    await page.getByRole("button", { name: "New tab" }).click();
    await expect(notes.tabs).toHaveText(["Home", "Abstract draft", "Home"]);
    const card = notes.shown.locator("[data-note-card='abstract']");
    await card.hover();
    await card.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Move to Recycle Bin" }).click();
    await expect(notes.tabs).toHaveText(["Home", "Home"]);
    await expect(notes.tabs.last()).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("This note is no longer in your library.")).toHaveCount(0);
  });

  test("closes the tab from the note's own menu and shows the empty panel when it was the last one", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Abstract draft");
    await page.getByRole("button", { name: "Close Home" }).click();
    await expect(notes.tabs).toHaveText(["Abstract draft"]);
    await notes.shown.locator("[data-note-view] > :first-child").getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Move to Recycle Bin" }).click();
    await expect(notes.tabs).toHaveCount(0);
    await expect(page.locator("[data-empty-panel]")).toBeVisible();
    await expect(page.getByText("This note is no longer in your library.")).toHaveCount(0);
  });

  test("keeps the tab of a note removed outside the app and says it is gone", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Dataloader rewrite: what changed");
    await notes.removeFromDisk("dataloader");
    await expect(notes.shown.getByText("This note is no longer in your library.")).toBeVisible();
    await expect(notes.tabs).toHaveText(["Home", "Untitled"]);
    await notes.shown.getByRole("button", { name: "Close tab" }).click();
    await expect(notes.tabs).toHaveText(["Home"]);
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  });
});
