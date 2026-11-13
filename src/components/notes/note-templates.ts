import { i18n } from "@/i18n";
import { frontMatterKey, splitFrontMatter } from "@/lib/front-matter";
import { appendEntries, withFrontMatter } from "@/lib/front-matter-yaml";
import { CITEKEY_PROPERTY, citationAuthors, citationTitle, citationVenue, citationYear } from "./note-citations";
import { readNoteFacts } from "./note-file";
import { removeProperty, setProperty } from "./note-properties";
import type { NoteDraft } from "./notes-data";
import type { CitationItem, NoteColor, NoteItem } from "./types";

export type TemplateId =
  | "daily"
  | "experimentLog"
  | "paperReading"
  | "literatureMatrix"
  | "meeting"
  | "labProtocol"
  | "weeklyLog"
  | "proposal"
  | "proof"
  | "dataAnalysis"
  | "interview"
  | "screeningLog"
  | "labNotebook";

export type TemplateTitle = "name" | "nameDate" | "date";

export interface NoteTemplate {
  id: TemplateId;
  icon: string;
  color: NoteColor;
  title: TemplateTitle;
  properties: string;
}

export interface TemplateVars {
  title: string;
  date: string;
  time: string;
  weekday: string;
}

const TEMPLATE_KEY = "template";

const MANAGED = new Set(["title", "kind", "id", "icon", "color", "agent", TEMPLATE_KEY]);
const VARIABLE = /\{\{\s*(title|date|time|weekday)\s*\}\}/gu;
const PLAIN_TAG = /^[\p{L}\p{N}_\-/]+$/u;

export const NOTE_TEMPLATES: readonly NoteTemplate[] = [
  {
    id: "daily",
    icon: "lucide:calendar",
    color: "cream",
    title: "date",
    properties: "tags: [daily]\ndate: {{date}}",
  },
  {
    id: "experimentLog",
    icon: "lucide:flask-conical",
    color: "mint",
    title: "nameDate",
    properties: "tags: [experiment]\nstatus: running\nstarted: {{date}}",
  },
  {
    id: "paperReading",
    icon: "lucide:book-open",
    color: "blue",
    title: "name",
    properties: "tags: [paper]\nstatus: to read\nauthors: []\nyear:\nvenue:\ndoi:\ncitekey:",
  },
  {
    id: "literatureMatrix",
    icon: "lucide:library",
    color: "lilac",
    title: "name",
    properties: "tags: [literature-review]\nstatus: in progress\nquestion:",
  },
  {
    id: "meeting",
    icon: "lucide:presentation",
    color: "peach",
    title: "nameDate",
    properties: "tags: [meeting]\ndate: {{date}}\nattendees: []",
  },
  {
    id: "labProtocol",
    icon: "lucide:clipboard-list",
    color: "aqua",
    title: "name",
    properties: "tags: [protocol]\nstatus: draft\nversion: 1",
  },
  {
    id: "weeklyLog",
    icon: "lucide:list-checks",
    color: "sky",
    title: "nameDate",
    properties: "tags: [weekly]\nweek-of: {{date}}",
  },
  {
    id: "proposal",
    icon: "lucide:lightbulb",
    color: "cream",
    title: "name",
    properties: "tags: [proposal]\nstatus: draft\ndeadline:",
  },
  {
    id: "proof",
    icon: "lucide:sigma",
    color: "lilac",
    title: "name",
    properties: "tags: [math]\nstatus: draft",
  },
  {
    id: "dataAnalysis",
    icon: "lucide:chart-column",
    color: "cyan",
    title: "name",
    properties: "tags: [analysis]\nstatus: draft\ndataset:",
  },
  {
    id: "interview",
    icon: "lucide:quote",
    color: "rose",
    title: "nameDate",
    properties: "tags: [interview]\ndate: {{date}}\nparticipant:\nconsent: false",
  },
  {
    id: "screeningLog",
    icon: "lucide:funnel",
    color: "pink",
    title: "name",
    properties: "tags: [systematic-review]\nstatus: screening\nreviewers: []",
  },
  {
    id: "labNotebook",
    icon: "lucide:notebook-pen",
    color: "spring",
    title: "nameDate",
    properties: "tags: [lab-notebook]\ndate: {{date}}\nsamples: []",
  },
];

export const TEMPLATES_BY_ID = Object.fromEntries(NOTE_TEMPLATES.map((template) => [template.id, template])) as Readonly<
  Record<TemplateId, NoteTemplate>
>;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function templateVars(now: Date, locale: string, title = ""): TemplateVars {
  return {
    title,
    date: localDate(now),
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    weekday: new Intl.DateTimeFormat(locale, { weekday: "long" }).format(now),
  };
}

export function expandTemplate(text: string, vars: TemplateVars): string {
  return text.replaceAll(VARIABLE, (_match, name: keyof TemplateVars) => vars[name]);
}

export function templateTitle(template: NoteTemplate, name: string, vars: TemplateVars): string {
  if (template.title === "date") return vars.date;
  if (template.title === "nameDate") return `${name} ${vars.date}`;
  return name;
}

function templateBody(template: NoteTemplate, vars: TemplateVars): string {
  return i18n.t(($) => $.notes.vault.templates.bodies[template.id], { ...vars });
}

export function draftFromTemplate(template: NoteTemplate, name: string, now: Date, locale: string): NoteDraft {
  const base = templateVars(now, locale);
  const vars = { ...base, title: templateTitle(template, name, base) };
  return {
    title: vars.title,
    body: templateBody(template, vars),
    properties: expandTemplate(template.properties, vars),
    icon: template.icon,
    color: template.color,
  };
}

export function draftFromReference(reference: CitationItem, now: Date, locale: string): NoteDraft {
  const draft = draftFromTemplate(TEMPLATES_BY_ID.paperReading, citationTitle(reference), now, locale);
  const fields = reference.fields ?? {};
  const year = Number(citationYear(fields));
  const values: [string, string | number | string[]][] = [
    ["authors", citationAuthors(fields)],
    ["year", Number.isInteger(year) && year > 0 ? year : ""],
    ["venue", citationVenue(fields)],
    ["doi", (fields.doi ?? "").trim()],
    [CITEKEY_PROPERTY, reference.key],
  ];
  const block = values.reduce(
    (current, [key, value]) => (value === "" || (Array.isArray(value) && value.length === 0) ? current : setProperty(current, key, value)),
    `---\n${draft.properties ?? ""}\n---`,
  );
  return { ...draft, properties: block.slice(4, -4) };
}

export function splitNoteSource(text: string): { frontMatter: string; body: string } {
  const front = splitFrontMatter(text);
  return front ? { frontMatter: front.lines.join("\n"), body: front.body } : { frontMatter: "", body: text };
}

export function extraFrontMatter(frontMatter: string): string {
  const kept: string[] = [];
  let keep = false;
  for (const line of frontMatter.split(/\r?\n/u)) {
    const key = frontMatterKey(line);
    if (key !== null) keep = !MANAGED.has(key);
    else if (line.trim() !== "" && !/^[\s-]/u.test(line) && !line.startsWith("#")) keep = false;
    if (keep) kept.push(line);
  }
  while (kept.at(-1)?.trim() === "") kept.pop();
  return kept.join("\n");
}

export function draftFromNote(title: string, text: string, now: Date, locale: string): NoteDraft {
  const base = templateVars(now, locale);
  const expandedTitle = expandTemplate(title, base);
  const vars = { ...base, title: expandedTitle };
  const { frontMatter, body } = splitNoteSource(text);
  const { icon, color } = readNoteFacts(text);
  const draft: NoteDraft = {
    title: expandedTitle,
    body: expandTemplate(body, vars),
    properties: expandTemplate(extraFrontMatter(frontMatter), vars),
    color,
  };
  if (icon) draft.icon = icon;
  return draft;
}

function tagItem(tag: string): string {
  return PLAIN_TAG.test(tag) ? tag : JSON.stringify(tag);
}

export function composeNoteSource(base: string, properties?: string, tags?: readonly string[]): string {
  const extra = extraFrontMatter(properties ?? "");
  const cleanTags = (tags ?? []).map((tag) => tag.trim().replace(/^#+/u, "")).filter(Boolean);
  const tagLine = cleanTags.length > 0 && !extra.split("\n").some((line) => frontMatterKey(line) === "tags") ? `tags: [${cleanTags.map(tagItem).join(", ")}]` : "";
  const lines = [extra, tagLine].filter(Boolean).join("\n");
  return lines && splitFrontMatter(base) ? withFrontMatter(base, (block) => appendEntries(block, lines)) : base;
}

export function isTemplateNote(note: NoteItem): boolean {
  return note.properties?.[TEMPLATE_KEY] === true;
}

export function withTemplateFlag(text: string, on: boolean): string {
  return withFrontMatter(text, (block) => (on ? setProperty(block, TEMPLATE_KEY, true) : removeProperty(block, TEMPLATE_KEY)));
}
