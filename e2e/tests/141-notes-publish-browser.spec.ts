import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, expect, test, webkit, type Page } from "@playwright/test";

const BASE = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";
const SHOTS = process.env.NOTES_PUBLISH_SHOTS ?? "";
const PANDOC_HTML = readFileSync(join(process.cwd(), "e2e/fixture-files/published-note.html"), "utf8");
const COPY = JSON.parse(readFileSync(join(process.cwd(), "src/i18n/locales/en/collab.json"), "utf8")) as {
  publish: {
    tabs: { publish: string };
    intro: string;
    contents: string;
    publish: string;
    republish: string;
    unpublish: string;
    stale: string;
    unpublishConfirm: { confirm: string };
    list: { title: string };
  };
  admin: { settings: { publicNotesAllowed: { label: string } } };
  console: {
    pages: {
      takenDown: string;
      takeDownNamed: string;
      restoreNamed: string;
      takeDownConfirm: { confirm: string };
    };
  };
};
const NOTE_TEXT = [
  "---",
  "id: n-42",
  "title: Coral survey notes",
  "---",
  "",
  "Field notes.",
  "",
  "```typst",
  "$ sum_(i=1)^n x_i $",
  "```",
  "",
  "```molecule",
  "format: xyz",
  "style: stick",
  "3",
  "water",
  "O 0.000 0.000 0.000",
  "H 0.757 0.586 0.000",
  "H -0.757 0.586 0.000",
  "```",
  "",
].join("\n");
const TYPST_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 12" width="40" height="12"><path d="M2 2h36v8H2z" fill="#000"/></svg>';

interface Upload {
  serverId: string;
  source: string;
  title: string;
  html: string;
}

const PUBLISHED = {
  id: "0192a0b0-0000-7000-8000-0000000000f1",
  source: "n-42",
  title: "Coral survey notes",
  url: "https://collab.uni.edu/n/Kq3vZ8wLmN2pRt5x",
  size: 10_471,
  published_at: 1_762_000_500_000,
  updated_at: 1_762_000_500_000,
};

async function setup(
  page: Page,
  view: "share" | "settings" | "console",
  allowed: boolean,
  published: readonly Record<string, unknown>[] = [],
): Promise<void> {
  page.setDefaultTimeout(15_000);
  await page.addInitScript(
    ({ html, allowed, published, note, typst }) => {
      const serverId = "0192a0b0-0000-7000-8000-0000000000a1";
      const state = {
        allowed,
        notes: [...published] as Record<string, unknown>[],
        uploads: [] as Record<string, unknown>[],
        converted: [] as string[],
        calls: [] as string[],
      };
      const settings = {
        guests_enabled: false,
        guest_approval_required: true,
        directory_visible: true,
        directory_shows_email: true,
        link_sharing_allowed: true,
        access_logs_allowed: true,
        email_notifications: true,
        comments_allowed: true,
        email_link_sign_in: false,
        public_notes_allowed: allowed,
      };
      const server = {
        server_id: serverId,
        url: "https://collab.uni.edu",
        name: "Smith Lab",
        icon_url: null,
        account: {
          account_id: "0192a0b0-0000-7000-8000-0000000000c1",
          display_name: "Bob Ito",
          avatar_url: null,
          server_role: "admin",
          emails: ["bob@uni.edu"],
          logins: ["bob"],
        },
        added_at: 1_760_000_000_000,
        signed_in: true,
      };
      Object.assign(window, {
        __publishTest: state,
        isTauri: true,
        __TAURI_INTERNALS__: {
          transformCallback: () => 1,
          unregisterCallback: () => {},
          invoke: async (command: string, args: Record<string, unknown> = {}) => {
            state.calls.push(command);
            if (command === "collab_servers_list") return [server];
            if (command === "collab_share_info") return null;
            if (command === "collab_share_check")
              return {
                server_name: "Smith Lab",
                file_count: 3,
                total_bytes: 40_960,
                excluded: [],
                too_large: [],
                renamed: [],
                max_file_mb: 50,
                cloud_synced: false,
              };
            if (command === "collab_published_notes") return { allowed: state.allowed, notes: state.notes };
            if (command === "read_file") return note;
            if (command === "notes_render_typst") return typst;
            if (command === "has_pandoc") return true;
            if (command === "convert_ad_hoc") {
              state.converted.push(String((args.request as { text?: unknown }).text ?? ""));
              await new Promise((resolve) => setTimeout(resolve, 300));
              return { text: html };
            }
            if (command === "collab_publish_note") {
              state.uploads.push(args);
              const note = {
                id: "0192a0b0-0000-7000-8000-0000000000f1",
                source: args.source,
                title: args.title,
                url: "https://collab.uni.edu/n/Kq3vZ8wLmN2pRt5x",
                size: String(args.html).length,
                published_at: 1_762_000_500_000,
                updated_at: 1_762_000_500_000,
              };
              state.notes = [note];
              return note;
            }
            if (command === "collab_unpublish_note") {
              state.notes = state.notes.filter((note) => note.id !== args.noteId);
              return null;
            }
            if (command === "collab_admin_published_notes")
              return state.notes.map((entry) => ({
                note: entry,
                author: {
                  account_id: "0192a0b0-0000-7000-8000-0000000000c2",
                  display_name: "Alice Chen",
                  avatar_url: null,
                  email: "alice@uni.edu",
                  login: "alice",
                  guest: false,
                  active: true,
                },
              }));
            if (command === "collab_admin_set_note_taken_down") {
              const found = state.notes.find((entry) => entry.id === args.noteId);
              if (found) found.taken_down = args.takenDown;
              return {
                note: found,
                author: {
                  account_id: "0192a0b0-0000-7000-8000-0000000000c2",
                  display_name: "Alice Chen",
                  avatar_url: null,
                  email: "alice@uni.edu",
                  login: "alice",
                  guest: false,
                  active: true,
                },
              };
            }
            if (command === "collab_admin_settings") return settings;
            if (command === "collab_admin_patch_settings") {
              Object.assign(settings, args.patch);
              state.allowed = settings.public_notes_allowed;
              return settings;
            }
            if (command.startsWith("plugin:")) return 1;
            return null;
          },
        },
      });
    },
    { html: PANDOC_HTML, allowed, published, note: NOTE_TEXT, typst: TYPST_SVG },
  );
  await page.goto(`${BASE}/e2e/notes-publish-harness.html${view === "share" ? "" : `?view=${view}`}`);
}

async function shoot(page: Page, name: string): Promise<void> {
  const shot = await page.screenshot();
  await test.info().attach(name, { body: shot, contentType: "image/png" });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const uploads = (page: Page) =>
  page.evaluate(() => (window as unknown as { __publishTest: { uploads: Upload[] } }).__publishTest.uploads);

const converted = (page: Page) =>
  page.evaluate(() => (window as unknown as { __publishTest: { converted: string[] } }).__publishTest.converted);

for (const browserType of [chromium, webkit]) {
  test.describe(`${browserType.name()}: publishing a note`, () => {
    test.skip(!existsSync(browserType.executablePath()), "Browser executable is not installed");

    test("publishes the rendered note body, shows its link and unpublishes it", async () => {
      const browser = await browserType.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
        await setup(page, "share", true);
        await page.getByRole("tab", { name: COPY.publish.tabs.publish }).click();
        await expect(page.getByText(COPY.publish.intro)).toBeVisible();
        await expect(page.getByText(COPY.publish.contents)).toBeVisible();
        await shoot(page, `${browserType.name()}-publish-tab`);

        await page.getByRole("button", { name: COPY.publish.publish, exact: true }).click();
        await expect(page.getByTestId("note-public-link")).toHaveText("https://collab.uni.edu/n/Kq3vZ8wLmN2pRt5x");
        await expect(page.getByRole("button", { name: COPY.publish.republish })).toBeEnabled();
        await shoot(page, `${browserType.name()}-published`);

        const [sent] = await uploads(page);
        expect(sent.serverId).toBe("0192a0b0-0000-7000-8000-0000000000a1");
        expect(sent.source).toBe("n-42");
        expect(sent.title).toBe("Coral survey notes");
        expect(sent.html).not.toContain("title-block-header");
        expect(sent.html).not.toContain("<input");
        expect(sent.html).toContain("☑ Count bleached");
        expect(sent.html).toContain("<math");
        expect(sent.html).toContain("data:image/svg+xml;base64,");
        expect(sent.html.startsWith("<p>Field notes")).toBe(true);
        const [markdown] = await converted(page);
        expect(markdown).toContain(`data:image/svg+xml;base64,${Buffer.from(TYPST_SVG).toString("base64")}`);
        expect(markdown).toMatch(/data:image\/png;base64,[A-Za-z0-9+/]{200,}/u);

        await page.getByRole("button", { name: COPY.publish.unpublish, exact: true }).click();
        const dialog = page.getByRole("alertdialog");
        await dialog.getByRole("button", { name: COPY.publish.unpublishConfirm.confirm }).click();
        await expect(page.getByTestId("note-public-link")).toHaveCount(0);
        await expect(page.getByRole("button", { name: COPY.publish.publish, exact: true })).toBeEnabled();
      } finally {
        await browser.close();
      }
    });

    test("staff take a published note down from the admin console and put it back", async () => {
      const browser = await browserType.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
        await setup(page, "console", true, [PUBLISHED]);
        await expect(page.getByText("Alice Chen")).toBeVisible();
        await shoot(page, `${browserType.name()}-console`);
        await page.getByRole("button", { name: COPY.console.pages.takeDownNamed.replace("{{title}}", "Coral survey notes") }).click();
        await page.getByRole("alertdialog").getByRole("button", { name: COPY.console.pages.takeDownConfirm.confirm }).click();
        await expect(page.getByText(COPY.console.pages.takenDown, { exact: true })).toBeVisible();
        await shoot(page, `${browserType.name()}-console-taken-down`);
        await page.getByRole("button", { name: COPY.console.pages.restoreNamed.replace("{{title}}", "Coral survey notes") }).click();
        await expect(page.getByText(COPY.console.pages.takenDown, { exact: true })).toHaveCount(0);
      } finally {
        await browser.close();
      }
    });

    test("an admin turns public note links on and the server card lists published notes", async () => {
      const browser = await browserType.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
        await setup(page, "settings", false);
        const toggle = page.getByRole("switch", { name: COPY.admin.settings.publicNotesAllowed.label });
        await expect(toggle).toHaveAttribute("aria-checked", "false");
        await expect(page.getByRole("heading", { name: COPY.publish.list.title })).toHaveCount(0);
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-checked", "true");

        const later = await browser.newPage({ viewport: { width: 900, height: 900 } });
        await setup(later, "settings", true, [PUBLISHED]);
        await expect(later.getByRole("heading", { name: COPY.publish.list.title })).toBeVisible();
        await expect(later.getByText("Coral survey notes")).toBeVisible();
        await shoot(later, `${browserType.name()}-settings`);
      } finally {
        await browser.close();
      }
    });
  });
}
