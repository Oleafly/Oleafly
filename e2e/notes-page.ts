import { test as base, expect, type Locator, type Page } from "@playwright/test";
import type { RecordedRun } from "./notes-agent-mock";
import type { WriteFailure } from "./notes-fixtures";

export const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";
export type InfoPlace = "side" | "inline";
export const INFO_PLACES: readonly InfoPlace[] = ["side", "inline"];
const SANDBOXED_FRAME_PROBE = "Blocked script execution in 'about:srcdoc'";

interface HarnessWindow {
  __notes: {
    text(id: string): string;
    has(id: string): boolean;
    writeFromDisk(id: string, text: string): void;
    removeFromDisk(id: string): void;
    failNextWrite(kind: WriteFailure): void;
    recycled(): string[];
    restore(id: string): void;
    saves(id: string): number;
    settingsOpened(): number;
  };
  __agent: { runs: RecordedRun[]; unhandled: string[] };
}

export class NotesPage {
  readonly errors: string[] = [];
  private harness = "notes-harness";
  private infoPlace: InfoPlace = "side";

  constructor(readonly page: Page) {
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith(SANDBOXED_FRAME_PROBE)) this.errors.push(message.text());
    });
    page.on("pageerror", (error) => this.errors.push(error.message));
  }

  async open(query = "", harness = "notes-harness"): Promise<this> {
    this.harness = harness;
    await this.page.goto(`${BASE_URL}/e2e/${harness}.html${query}`);
    await this.mounted();
    return this;
  }

  async reload(): Promise<void> {
    await this.page.reload();
    await this.mounted();
  }

  private mounted(): Promise<unknown> {
    return this.page.waitForFunction(() => document.body.dataset.fixtureState === "mounted", null, { timeout: 60_000 });
  }

  get sidebar(): Locator {
    return this.page.locator("aside");
  }

  async placeInfo(place: InfoPlace): Promise<void> {
    this.infoPlace = place;
    await this.page.addInitScript((value) => {
      if (window === window.top) localStorage.setItem("oleafly.notes.info", value);
    }, place);
  }

  get infoButton(): Locator {
    return this.page.getByRole("button", { name: "Note info", exact: true }).filter({ visible: true });
  }

  get infoPanel(): Locator {
    return this.page.getByRole("region", { name: "Info", exact: true });
  }

  async showInfo(): Promise<Locator> {
    if (this.infoPlace === "inline") return this.page.locator("article").filter({ visible: true });
    if ((await this.infoButton.getAttribute("aria-pressed")) !== "true") await this.infoButton.click();
    await expect(this.infoButton).toHaveAttribute("aria-pressed", "true");
    await expect(this.infoPanel).toBeVisible();
    return this.infoPanel;
  }

  get sidebarFooter(): Locator {
    return this.sidebar.locator("footer");
  }

  async searchBox(name = "Search notes and artifacts"): Promise<Locator> {
    const box = this.sidebar.getByRole("combobox", { name });
    if (!(await box.isVisible())) await this.sidebar.getByRole("button", { name }).click();
    await expect(box).toBeFocused();
    return box;
  }

  get shown(): Locator {
    return this.page.locator('[role="tabpanel"][data-shown="true"]');
  }

  get tabs(): Locator {
    return this.page.locator('main [data-tab-view] [role="tab"]');
  }

  get editor(): Locator {
    return this.page.locator(".ProseMirror:visible");
  }

  get firstParagraph(): Locator {
    return this.page.locator(".ProseMirror:visible > p").first();
  }

  get title(): Locator {
    return this.page.locator('input[aria-label="Note title"]:visible');
  }

  get toolbar(): Locator {
    return this.page.getByRole("toolbar", { name: "Formatting" }).filter({ visible: true });
  }

  get composer(): Locator {
    return this.page.getByRole("combobox", { name: "Assistant", exact: true });
  }

  get conversation(): Locator {
    return this.page.getByRole("region", { name: "Conversation with the assistant" });
  }

  get diffs(): Locator {
    return this.page.locator(".note-diff-insert, .note-diff-delete, .note-diff-block");
  }

  button(name: string): Locator {
    return this.page.getByRole("button", { name, exact: true });
  }

  drawn(block: string): Locator {
    return this.editor.locator(`[data-block="${block}"]`);
  }

  async openNote(title: string): Promise<void> {
    await this.sidebar.getByRole("button", { name: new RegExp(title) }).first().click();
    await expect(this.title).toHaveValue(title);
    await expect(this.editor).toBeVisible();
  }

  async caretAtEnd(block: Locator = this.firstParagraph): Promise<void> {
    await block.evaluate((element) => {
      (element.closest(".ProseMirror") as HTMLElement | null)?.focus();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    });
    await expect.poll(() => block.evaluate((element) => element.contains(window.getSelection()?.focusNode ?? null))).toBe(true);
  }

  async newParagraph(): Promise<void> {
    await this.caretAtEnd();
    await this.page.keyboard.press("Enter");
  }

  async selectText(text: string): Promise<void> {
    await this.editor.evaluate((root, needle) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(needle) ?? -1;
        if (at < 0) continue;
        (root as HTMLElement).focus();
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
        return;
      }
      throw new Error(`"${needle}" is not in the note`);
    }, text);
    await expect.poll(() => this.page.evaluate(() => window.getSelection()?.toString())).toBe(text);
  }

  async slash(query: string, option: string | RegExp): Promise<void> {
    await this.page.keyboard.type(`/${query}`);
    const menu = this.page.getByRole("listbox").filter({ visible: true });
    await expect(menu.getByRole("option").first()).toHaveAccessibleName(option);
    await this.page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
  }

  menuEntry(label: string): Locator {
    const name = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:$|\\s*[^\\p{L}\\s])`, "u");
    return this.page
      .getByRole("menuitem", { name })
      .or(this.page.getByRole("menuitemcheckbox", { name }))
      .or(this.page.getByRole("menuitemradio", { name }));
  }

  async tool(name: string, item?: string): Promise<void> {
    const onBar = this.toolbar.getByRole("button", { name, exact: true });
    if (await onBar.isVisible()) {
      await onBar.click();
      if (item) await this.menuEntry(item).click();
      return;
    }
    await this.toolbar.getByRole("button", { name: "More", exact: true }).click();
    if (!item) {
      await this.menuEntry(name).click();
      return;
    }
    if (await this.menuEntry(item).isVisible()) {
      await this.menuEntry(item).click();
      return;
    }
    await this.menuEntry(name).focus();
    await this.page.keyboard.press("ArrowRight");
    await this.menuEntry(item).focus();
    await this.page.keyboard.press("Enter");
  }

  async runAction(filter: string, label: string): Promise<void> {
    await this.composer.fill(`/${filter}`);
    await expect(this.page.getByRole("option", { name: label })).toBeVisible();
    await this.composer.press("Enter");
  }

  async ask(text: string): Promise<void> {
    await this.composer.fill(text);
    await this.composer.press("Enter");
  }

  async dockRight(title: string): Promise<void> {
    const tab = this.page.getByRole("tab", { name: title });
    const slot = this.page.locator("[data-group] > [data-slot]").first();
    const from = await tab.boundingBox();
    const area = await slot.boundingBox();
    if (!from || !area) throw new Error("no geometry");
    await this.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(area.x + area.width * 0.7, area.y + area.height / 2, { steps: 4 });
    await this.page.mouse.move(area.x + area.width - 12, area.y + area.height / 2, { steps: 4 });
    await expect(this.page.locator('[data-drop-indicator="right"]')).toBeVisible();
    await this.page.mouse.up();
    await expect(this.page.locator("[data-group] > [data-slot]")).toHaveCount(2);
  }

  text(id: string): Promise<string> {
    return this.page.evaluate((noteId) => (window as unknown as HarnessWindow).__notes.text(noteId), id);
  }

  has(id: string): Promise<boolean> {
    return this.page.evaluate((noteId) => (window as unknown as HarnessWindow).__notes.has(noteId), id);
  }

  saves(id: string): Promise<number> {
    return this.page.evaluate((noteId) => (window as unknown as HarnessWindow).__notes.saves(noteId), id);
  }

  recycled(): Promise<string[]> {
    return this.page.evaluate(() => (window as unknown as HarnessWindow).__notes.recycled());
  }

  restore(id: string): Promise<void> {
    return this.page.evaluate((noteId) => (window as unknown as HarnessWindow).__notes.restore(noteId), id);
  }

  settingsOpened(): Promise<number> {
    return this.page.evaluate(() => (window as unknown as HarnessWindow).__notes.settingsOpened());
  }

  writeFromDisk(id: string, text: string): Promise<void> {
    return this.page.evaluate(([noteId, next]) => (window as unknown as HarnessWindow).__notes.writeFromDisk(noteId, next), [id, text]);
  }

  removeFromDisk(id: string): Promise<void> {
    return this.page.evaluate((noteId) => (window as unknown as HarnessWindow).__notes.removeFromDisk(noteId), id);
  }

  failNextWrite(kind: WriteFailure): Promise<void> {
    return this.page.evaluate((failure) => (window as unknown as HarnessWindow).__notes.failNextWrite(failure), kind);
  }

  runs(): Promise<RecordedRun[]> {
    return this.page.evaluate(() => (window as unknown as HarnessWindow).__agent.runs);
  }

  unhandled(): Promise<string[]> {
    return this.page.evaluate(() => (window as unknown as Partial<HarnessWindow>).__agent?.unhandled ?? []);
  }

  async checkClean(): Promise<void> {
    expect(this.errors, `console errors in ${this.harness}`).toEqual([]);
    if (!this.page.isClosed()) expect(await this.unhandled(), "IPC commands the harness mock does not answer").toEqual([]);
  }
}

export const test = base.extend<{ notes: NotesPage }>({
  notes: async ({ page }, use, testInfo) => {
    testInfo.setTimeout(90_000);
    const notes = new NotesPage(page);
    await use(notes);
    await notes.checkClean();
  },
});

export { expect };
