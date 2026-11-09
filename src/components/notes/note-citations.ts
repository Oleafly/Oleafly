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

export async function projectCitations(projectId: string): Promise<CitationItem[]> {
  const files = (await listFiles(projectId)).filter(
    (entry) => !entry.is_dir && !entry.unreadable && entry.path.toLowerCase().endsWith(".bib"),
  );
  const sources = await Promise.all(files.map((file) => readFileContent(projectId, file.path).catch(() => "")));
  const seen = new Set<string>();
  const items: CitationItem[] = [];
  for (const source of sources) {
    for (const entry of parseBib(source).entries) {
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
      items.push({ key: entry.key, label: citationLabel(entry.key, entry.fields) });
    }
  }
  return items;
}
