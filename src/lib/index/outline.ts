import { basename } from "@/lib/path-utils";
import type { ProjectIndex, Sym } from "./types";

export interface OutlineItem {
  level: number;
  title: string;
  line: number;
  file: string;
  kind: "section" | "file";
  from: number;
  to: number;
}

export interface ExtraOutlineSection {
  readonly level: number;
  readonly title: string;
  readonly line: number;
  readonly from: number;
  readonly to: number;
}

/**
 * The files whose macros reach a viewer's headings. Two revisions can define
 * the same macro differently, and one must not render with the other's.
 */
export function outlineSources(
  texts: Readonly<Record<string, string>>,
  index: ProjectIndex,
  viewer: string | null | undefined,
): Readonly<Record<string, string>> {
  const scope = index.unitScope;
  if (!scope || !viewer) return texts;
  const entries = Object.entries(texts).filter(([file]) => scope.reaches(viewer, file));
  // The last definition wins, so the viewer's own document goes last.
  return Object.fromEntries([
    ...entries.filter(([file]) => !scope.sharesScope(viewer, file)),
    ...entries.filter(([file]) => scope.sharesScope(viewer, file)),
  ]);
}

export function outlineFromIndex(
  index: ProjectIndex,
  activeFile: string,
  extraSections?: (file: string) => readonly ExtraOutlineSection[],
): OutlineItem[] {
  const out: OutlineItem[] = [];
  const visited = new Set<string>();

  const walk = (file: string, depth: number) => {
    if (depth > 8 || visited.has(file)) return;
    visited.add(file);

    const extra: Sym[] = (extraSections?.(file) ?? []).map((section) => ({
      kind: "section",
      name: section.title,
      file,
      line: section.line,
      from: section.from,
      to: section.to,
      nameFrom: section.from,
      nameTo: section.to,
      level: section.level,
    }));
    const syms: Sym[] = [
      ...index.defs.filter((d) => d.kind === "section" && d.file === file && d.name.trim() !== ""),
      ...extra,
      ...index.uses.filter((u) => u.kind === "inputedge" && u.file === file),
    ].sort((a, b) => a.from - b.from);

    for (const s of syms) {
      if (s.kind === "section") {
        out.push({
          level: s.level ?? 2,
          title: s.name,
          line: s.line,
          file,
          kind: "section",
          from: s.from,
          to: s.to,
        });
      } else {
        const target = s.target ?? s.name;
        const before = out.length;
        walk(target, depth + 1);
        if (out.length === before) {
          out.push({
            level: 2,
            title: basename(target),
            line: s.line,
            file: target,
            kind: "file",
            from: 0,
            to: 0,
          });
        }
      }
    }
  };

  walk(activeFile, 0);
  return out;
}

function headingBefore(headings: readonly { from: number; title: string }[], offset: number): string | undefined {
  let owner: string | undefined;
  for (const heading of headings) {
    if (heading.from > offset) break;
    owner = heading.title;
  }
  return owner;
}

export function headingTitlesByLabel(
  index: ProjectIndex,
  extraSections?: (file: string) => readonly ExtraOutlineSection[],
  viewer?: string,
): ReadonlyMap<string, string> {
  const headings = new Map<string, { from: number; title: string }[]>();
  const add = (file: string, from: number, title: string) => {
    if (title.trim() === "") return;
    const list = headings.get(file) ?? [];
    list.push({ from, title });
    headings.set(file, list);
  };
  for (const section of index.defs) {
    if (section.kind === "section") add(section.file, section.from, section.name);
  }
  const labels = index.defs.filter((definition) => definition.kind === "label");
  for (const file of new Set(labels.map((label) => label.file))) {
    for (const section of extraSections?.(file) ?? []) add(file, section.from, section.title);
  }
  for (const list of headings.values()) list.sort((left, right) => left.from - right.from);
  const sameName = new Map<string, Sym[]>();
  for (const label of labels) {
    const named = sameName.get(label.name);
    if (named) named.push(label);
    else sameName.set(label.name, [label]);
  }
  const titles = new Map<string, string>();
  const { unitScope } = index;
  for (const [name, named] of sameName) {
    // Another document's copy of the label sits under another heading.
    const visible =
      unitScope && viewer !== undefined
        ? unitScope.select(viewer, named, (label) => label.file).items
        : named;
    const title = firstHeadingTitle(visible, headings);
    if (title !== undefined) titles.set(name, title);
  }
  return titles;
}

function firstHeadingTitle(
  labels: readonly Sym[],
  headings: ReadonlyMap<string, readonly { from: number; title: string }[]>,
): string | undefined {
  for (const label of labels) {
    const owner = headingBefore(headings.get(label.file) ?? [], label.from);
    if (owner !== undefined) return owner;
  }
  return undefined;
}
