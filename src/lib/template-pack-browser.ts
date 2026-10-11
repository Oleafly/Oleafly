import type { PackGroup, PackInfo, PackTemplateInfo } from "@oleafly/backend-port";

export const PACK_GROUPS: readonly PackGroup[] = ["curated", "community", "typst", "university"];

const ENGINE_LABELS: Readonly<Record<string, string>> = {
  pdflatex: "pdfLaTeX",
  latex: "LaTeX",
  xelatex: "XeLaTeX",
  xetex: "XeLaTeX",
  lualatex: "LuaLaTeX",
  luatex: "LuaLaTeX",
  uplatex: "upLaTeX",
  platex: "pLaTeX",
  latexmk: "latexmk",
  tectonic: "Tectonic",
  typst: "Typst",
  typ: "Typst",
  markdown: "Markdown",
  md: "Markdown",
  pandoc: "Markdown",
};

export function engineLabel(engine: string): string {
  const key = engine.trim().toLowerCase();
  return ENGINE_LABELS[key] ?? engine.trim();
}

export interface PackGroupSection {
  readonly group: PackGroup;
  readonly packs: readonly PackInfo[];
}

export function packMatches(pack: PackInfo, query: string): boolean {
  if (!query) return true;
  return `${pack.label}\n${pack.description}\n${pack.category}`.toLowerCase().includes(query);
}

export function groupPacks(packs: readonly PackInfo[], rawQuery: string): PackGroupSection[] {
  const query = rawQuery.trim().toLowerCase();
  const sections: PackGroupSection[] = [];
  for (const group of PACK_GROUPS) {
    const members = packs.filter((pack) => pack.group === group && packMatches(pack, query));
    if (members.length > 0) sections.push({ group, packs: members });
  }
  return sections;
}

export function templateSearchText(template: PackTemplateInfo): string {
  return [
    template.name,
    template.description,
    template.category,
    template.engine,
    engineLabel(template.engine),
    template.kind ?? "",
    template.languages.join(" "),
    template.country ?? "",
    template.institution ?? "",
    template.license.label,
    template.id,
  ]
    .join("\n")
    .toLowerCase();
}

export interface TemplateFilter {
  readonly query: string;
  readonly engine: string;
  readonly kind: string;
  readonly language: string;
}

export const NO_FILTER = "";

export function filterTemplates(
  templates: readonly PackTemplateInfo[],
  search: readonly string[],
  filter: TemplateFilter,
): readonly PackTemplateInfo[] {
  const query = filter.query.trim().toLowerCase();
  if (!query && !filter.engine && !filter.kind && !filter.language) return templates;
  const matches: PackTemplateInfo[] = [];
  for (let index = 0; index < templates.length; index += 1) {
    const template = templates[index];
    if (filter.engine && engineLabel(template.engine) !== filter.engine) continue;
    if (filter.kind && template.kind !== filter.kind) continue;
    if (filter.language && !template.languages.includes(filter.language)) continue;
    if (query && !(search[index] ?? "").includes(query)) continue;
    matches.push(template);
  }
  return matches;
}

export interface TemplateFacets {
  readonly engines: readonly string[];
  readonly kinds: readonly string[];
  readonly languages: readonly string[];
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function templateFacets(templates: readonly PackTemplateInfo[]): TemplateFacets {
  const engines = new Set<string>();
  const kinds = new Set<string>();
  const languages = new Set<string>();
  for (const template of templates) {
    const engine = engineLabel(template.engine);
    if (engine) engines.add(engine);
    if (template.kind) kinds.add(template.kind);
    for (const language of template.languages) languages.add(language);
  }
  return { engines: sorted(engines), kinds: sorted(kinds), languages: sorted(languages) };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function sameTemplate(left: PackTemplateInfo, right: PackTemplateInfo): boolean {
  return (
    left.id === right.id &&
    left.installed === right.installed &&
    left.name === right.name &&
    left.description === right.description &&
    left.category === right.category &&
    left.engine === right.engine &&
    left.license.spdx === right.license.spdx &&
    left.license.label === right.license.label &&
    left.credit?.url === right.credit?.url &&
    left.credit?.author === right.credit?.author &&
    left.thumb_url === right.thumb_url &&
    left.preview_url === right.preview_url &&
    left.kind === right.kind &&
    sameStrings(left.languages, right.languages) &&
    left.country === right.country &&
    left.institution === right.institution &&
    left.bytes === right.bytes &&
    left.file_count === right.file_count
  );
}

export function displayName(
  code: string,
  type: "language" | "region",
  locale: string,
): string {
  try {
    return new Intl.DisplayNames([locale], { type, fallback: "code" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function capitalized(value: string): string {
  return value ? value.charAt(0).toLocaleUpperCase() + value.slice(1) : value;
}
