import { type HayagrivaEntry, hayagrivaEntries, isHayagrivaPath, looksLikeHayagriva } from "@/lib/citation/hayagriva";
import { parseBib } from "@/lib/latex-tools";
import { listFiles, readFileContent } from "@/lib/tauri";
import type { CitationItem } from "./types";

function plain(value: string | undefined): string {
  return (value ?? "").replace(/[{}]/gu, "").replace(/\s+/gu, " ").trim();
}

function familyName(person: string): string {
  const name = plain(person);
  if (name.includes(",")) return name.slice(0, name.indexOf(",")).trim();
  if (/^\{.*\}$/u.test(person.trim())) return name;
  return name.split(" ").at(-1) ?? name;
}

function people(field: string | undefined): string {
  if (!field?.trim()) return "";
  const names = field.split(/\s+and\s+/u);
  const first = familyName(names[0]);
  return names.length > 1 ? `${first} et al.` : first;
}

export function citationLabel(key: string, fields: Readonly<Record<string, string>>): string {
  const who = people(fields.author ?? fields.editor);
  const year = plain(fields.year) || (/^\d{4}/u.exec(plain(fields.date))?.[0] ?? "");
  const lead = [who, year].filter(Boolean).join(" ");
  const title = plain(fields.title);
  if (lead && title) return `${lead}, ${title}`;
  return lead || title || key;
}

interface CitedEntry {
  readonly key: string;
  readonly fields: Readonly<Record<string, string>>;
}

function isBibPath(path: string): boolean {
  return path.toLowerCase().endsWith(".bib");
}

function hayagrivaFields(entry: HayagrivaEntry): Record<string, string> {
  const fields: Record<string, string> = {};
  if (entry.author?.value) fields.author = entry.author.value;
  if (entry.title?.value) fields.title = entry.title.value;
  if (entry.date?.value) fields.date = entry.date.value;
  return fields;
}

function entriesIn(path: string, source: string): CitedEntry[] {
  if (isBibPath(path)) return parseBib(source).entries;
  if (!looksLikeHayagriva(source)) return [];
  return hayagrivaEntries(source)
    .filter((entry) => entry.isEntry)
    .map((entry) => ({ key: entry.key, fields: hayagrivaFields(entry) }));
}

export async function projectCitations(projectId: string): Promise<CitationItem[]> {
  const files = (await listFiles(projectId)).filter(
    (entry) => !entry.is_dir && !entry.unreadable && (isBibPath(entry.path) || isHayagrivaPath(entry.path)),
  );
  const sources = await Promise.all(files.map((file) => readFileContent(projectId, file.path).catch(() => "")));
  const seen = new Set<string>();
  const items: CitationItem[] = [];
  files.forEach((file, index) => {
    for (const entry of entriesIn(file.path, sources[index])) {
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
      items.push({ key: entry.key, label: citationLabel(entry.key, entry.fields) });
    }
  });
  return items;
}
