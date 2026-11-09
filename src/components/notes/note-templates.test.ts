import { beforeAll, describe, expect, it } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { NOTE_COLORS, newNoteSource } from "./note-file";
import { LINE_ICON_PREFIX, LINE_ICONS } from "./note-icons";
import { readProperties } from "./note-properties";
import { frontMatterList, noteTags } from "./note-tags";
import {
  composeNoteSource,
  draftFromNote,
  draftFromTemplate,
  expandTemplate,
  extraFrontMatter,
  isTemplateNote,
  localDate,
  NOTE_TEMPLATES,
  splitNoteSource,
  templateTitle,
  templateVars,
  TEMPLATES_BY_ID,
  withTemplateFlag,
} from "./note-templates";
import type { NoteItem } from "./types";

const NOW = new Date(2026, 10, 8, 9, 5);

beforeAll(async () => {
  await loadNamespace("notes");
});

function note(properties?: Record<string, unknown>): NoteItem {
  return { id: "n", title: "T", project: "Notes", updatedAt: 0, author: "you", summary: "", properties };
}

describe("template variables", () => {
  it("formats the local date, time and weekday", () => {
    expect(localDate(new Date(2026, 0, 3))).toBe("2026-01-03");
    expect(templateVars(NOW, "en", "Plan")).toEqual({ title: "Plan", date: "2026-11-08", time: "09:05", weekday: "Sunday" });
    expect(templateVars(NOW, "de").weekday).toBe("Sonntag");
  });

  it("expands known variables and leaves the rest", () => {
    const vars = templateVars(NOW, "en", "Plan");
    expect(expandTemplate("{{title}} on {{ date }} at {{time}}, {{weekday}} {{other}}", vars)).toBe(
      "Plan on 2026-11-08 at 09:05, Sunday {{other}}",
    );
  });

  it("titles notes by name, name and date, or date", () => {
    const vars = templateVars(NOW, "en");
    expect(templateTitle(TEMPLATES_BY_ID.daily, "Daily note", vars)).toBe("2026-11-08");
    expect(templateTitle(TEMPLATES_BY_ID.meeting, "Meeting notes", vars)).toBe("Meeting notes 2026-11-08");
    expect(templateTitle(TEMPLATES_BY_ID.proof, "Proof", vars)).toBe("Proof");
  });
});

describe("built-in templates", () => {
  it("has eleven distinct research templates, each a real body with properties and tags", () => {
    expect(NOTE_TEMPLATES).toHaveLength(11);
    expect(new Set(NOTE_TEMPLATES.map((template) => template.id)).size).toBe(11);
    for (const template of NOTE_TEMPLATES) {
      expect(TEMPLATES_BY_ID[template.id]).toBe(template);
      const draft = draftFromTemplate(template, "Name", NOW, "en");
      expect(draft.body).not.toMatch(/\{\{/u);
      expect(draft.properties).not.toMatch(/\{\{/u);
      expect(draft.body?.length).toBeGreaterThan(80);
      expect(draft.body).toMatch(/^## /mu);
      expect(draft.body).not.toMatch(/—/u);
      const source = composeNoteSource(newNoteSource(draft.title, draft.body), draft.properties);
      expect(frontMatterList(source, "tags").length).toBeGreaterThan(0);
      const block = /^---\n[\s\S]*?\n---/u.exec(source)?.[0] ?? "";
      expect(readProperties(block)?.length).toBeGreaterThan(0);
    }
  });

  it("gives every template its own icon from the note icon set and a note colour, and passes both to the draft", () => {
    const icons = NOTE_TEMPLATES.map((template) => template.icon);
    expect(new Set(icons).size).toBe(NOTE_TEMPLATES.length);
    for (const template of NOTE_TEMPLATES) {
      expect(template.icon.startsWith(LINE_ICON_PREFIX)).toBe(true);
      expect(LINE_ICONS[template.icon.slice(LINE_ICON_PREFIX.length)]).toBeDefined();
      expect(NOTE_COLORS).toContain(template.color);
      const draft = draftFromTemplate(template, "Name", NOW, "en");
      expect(draft.icon).toBe(template.icon);
      expect(draft.color).toBe(template.color);
    }
  });

  it("reads every body from the notes translations and fills in its variables", () => {
    for (const template of NOTE_TEMPLATES) {
      const draft = draftFromTemplate(template, "Name", NOW, "en");
      const vars = { ...templateVars(NOW, "en"), title: draft.title };
      expect(draft.body).toBe(expandTemplate(enNotes.vault.templates.bodies[template.id], vars));
    }
    expect(Object.keys(enNotes.vault.templates.bodies).sort()).toEqual(NOTE_TEMPLATES.map(({ id }) => id).sort());
  });

  it("covers callouts, task lists and tables across the set", () => {
    const bodies = NOTE_TEMPLATES.map((template) => draftFromTemplate(template, "Name", NOW, "en").body).join("\n");
    expect(bodies).toMatch(/^> \[!\w+\]/mu);
    expect(bodies).toMatch(/^- \[ \] /mu);
    expect(bodies).toMatch(/^\| --- \|/mu);
  });

  it("makes a daily note tagged daily and titled with the date", () => {
    const draft = draftFromTemplate(TEMPLATES_BY_ID.daily, "Daily note", NOW, "en");
    expect(draft.title).toBe("2026-11-08");
    expect(draft.body).toContain("**Sunday**");
    expect(draft.properties).toBe("tags: [daily]\ndate: 2026-11-08");
  });
});

describe("user templates", () => {
  const source = [
    "---",
    "title: Meeting {{date}}",
    "kind: note",
    "id: abc",
    "icon: lucide:atom",
    "template: true",
    "status: open",
    "attendees:",
    "  - Ana",
    "- Bo",
    "# a comment",
    "",
    "agent: Codex",
    "notes: |",
    "  keep {{title}}",
    "---",
    "Body for {{title}} on {{date}}.",
  ].join("\n");

  it("splits front matter from the body", () => {
    expect(splitNoteSource("No front matter")).toEqual({ frontMatter: "", body: "No front matter" });
    expect(splitNoteSource("---\na: 1\n---\nBody")).toEqual({ frontMatter: "a: 1", body: "Body" });
  });

  it("keeps the user's keys and drops the managed ones", () => {
    expect(extraFrontMatter(splitNoteSource(source).frontMatter)).toBe(
      "status: open\nattendees:\n  - Ana\n- Bo\n# a comment\n\nnotes: |\n  keep {{title}}",
    );
    expect(extraFrontMatter("title: x\n\n")).toBe("");
    expect(extraFrontMatter("plain text line\nkey: v")).toBe("key: v");
    expect(extraFrontMatter("\"status\": open\n'title': x\nid : y")).toBe("\"status\": open");
  });

  it("expands variables in the title, body and kept properties", () => {
    const draft = draftFromNote("Meeting {{date}}", source, NOW, "en");
    expect(draft).toEqual({
      title: "Meeting 2026-11-08",
      body: "Body for Meeting 2026-11-08 on 2026-11-08.",
      properties: "status: open\nattendees:\n  - Ana\n- Bo\n# a comment\n\nnotes: |\n  keep Meeting 2026-11-08",
    });
  });

  it("recognises notes marked as templates", () => {
    expect(isTemplateNote(note({ template: true }))).toBe(true);
    expect(isTemplateNote(note({ template: "true" }))).toBe(false);
    expect(isTemplateNote(note())).toBe(false);
  });
});

describe("composeNoteSource", () => {
  const base = newNoteSource("Plan", "Body", undefined, "id-1");

  it("adds properties and tags inside the existing front matter", () => {
    const source = composeNoteSource(base, "status: draft\nid: nope", ["ml", "#Paper Review", " "]);
    expect(source).toMatch(/^---\n[\s\S]*status: draft\ntags: \[ml, "Paper Review"\]\n---\n/u);
    expect(source).not.toContain("id: nope");
    expect(source.endsWith("Body")).toBe(true);
    expect(noteTags(source)).toEqual(["ml", "paper review"]);
    expect(frontMatterList(source, "id")).toEqual(["id-1"]);
  });

  it("keeps the properties' own tags over the separate list", () => {
    const source = composeNoteSource(base, "tags: [a]\n", ["b"]);
    expect(frontMatterList(source, "tags")).toEqual(["a"]);
  });

  it("leaves the source alone without extras or front matter", () => {
    expect(composeNoteSource(base)).toBe(base);
    expect(composeNoteSource(base, "", [])).toBe(base);
    expect(composeNoteSource("No front matter", "a: 1")).toBe("No front matter");
    expect(composeNoteSource("---\nnever closed", "a: 1")).toBe("---\nnever closed");
  });
});

describe("marking a note as a template", () => {
  const text = "---\nkind: note\nid: n1\ntitle: Weekly sync\n---\n\nAgenda";

  it("adds and removes the template flag and keeps the rest of the note", () => {
    const marked = withTemplateFlag(text, true);
    expect(marked).toBe("---\nkind: note\nid: n1\ntitle: Weekly sync\ntemplate: true\n---\n\nAgenda");
    const block = /^---\n[\s\S]*?\n---/u.exec(marked)?.[0] ?? "";
    expect(readProperties(block)?.find((property) => property.key === "template")?.value).toBe(true);
    expect(withTemplateFlag(marked, false)).toBe(text);
    expect(withTemplateFlag(text, false)).toBe(text);
  });

  it("keeps Windows line endings and starts front matter when the note has none", () => {
    const crlf = text.replace(/\n/gu, "\r\n");
    expect(withTemplateFlag(crlf, true)).toBe(
      "---\r\nkind: note\r\nid: n1\r\ntitle: Weekly sync\r\ntemplate: true\r\n---\r\n\r\nAgenda",
    );
    expect(withTemplateFlag("Just text", true)).toBe("---\ntemplate: true\n---\n\nJust text");
    expect(withTemplateFlag("Just text", false)).toBe("Just text");
  });
});
