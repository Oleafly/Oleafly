export type BibliographyEngine = "latex" | "biblatex" | "markdown" | "typst";

export type BibliographyCommand = "bibliography" | "addbibresource";

export interface BibliographyDeclaration {
  raw: string;
  from: number;
  to: number;
  command: BibliographyCommand;
}

const DECLARATION =
  /\\(bibliography|addbibresource)\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g;

const HAS_EXTENSION = /\.[a-z0-9]+$/i;
const BIB_SUFFIX = /\.bib$/i;
const URL_LIKE = /^[a-z][a-z0-9+.-]*:/i;

function normalizeRelativePath(path: string): string | null {
  const replaced = path.replaceAll("\\", "/");
  const hasControlCharacter = [...replaced].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  if (
    replaced.startsWith("/") ||
    /^[A-Za-z]:\//.test(replaced) ||
    hasControlCharacter
  ) {
    return null;
  }
  const parts: string[] = [];
  for (const part of replaced.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

function spellingsFor(base: string, engine: BibliographyEngine): string[] {
  if (engine === "biblatex") return [base];
  if (BIB_SUFFIX.test(base)) return [base];
  if (engine === "latex") return [base, `${base}.bib`];
  return HAS_EXTENSION.test(base) ? [base] : [base, `${base}.bib`];
}

function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function normalizeBibliographyTarget(rawTarget: string): string {
  return rawTarget.trim().replace(/^["']|["']$/g, "");
}

export function bibliographyEngineForCommand(
  command: BibliographyCommand,
): BibliographyEngine {
  return command === "addbibresource" ? "biblatex" : "latex";
}

export function bibliographyDisplayName(
  rawTarget: string,
  engine: BibliographyEngine = "latex",
): string {
  const raw = normalizeBibliographyTarget(rawTarget);
  if (engine === "biblatex") return raw;
  return HAS_EXTENSION.test(raw) ? raw : `${raw}.bib`;
}

export function bibliographyDeclarations(
  source: string,
): BibliographyDeclaration[] {
  const declarations: BibliographyDeclaration[] = [];
  const pattern = new RegExp(DECLARATION.source, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const command: BibliographyCommand =
      match[1] === "addbibresource" ? "addbibresource" : "bibliography";
    for (const declared of match[2].split(",")) {
      const raw = normalizeBibliographyTarget(declared);
      if (!raw || URL_LIKE.test(raw)) continue;
      declarations.push({
        raw,
        from: match.index,
        to: match.index + match[0].length,
        command,
      });
    }
  }
  return declarations;
}

export function bibliographyCandidatePaths(
  rawTarget: string,
  fromFile: string,
  engine: BibliographyEngine = "latex",
): readonly string[] {
  const raw = normalizeBibliographyTarget(rawTarget);
  if (
    !raw ||
    raw.startsWith("#") ||
    raw.startsWith("@") ||
    raw.startsWith("/") ||
    URL_LIKE.test(raw)
  ) {
    return [];
  }
  const relative = raw.replace(/^\.\//, "");
  const directory = directoryOf(fromFile);
  const rootFirst = engine === "latex" || engine === "biblatex";
  let bases: string[];
  if (!directory) {
    bases = [relative];
  } else if (rootFirst) {
    bases = [relative, `${directory}/${relative}`];
  } else {
    bases = [`${directory}/${relative}`, relative];
  }
  const candidates: string[] = [];
  for (const base of bases) {
    for (const spelling of spellingsFor(base, engine)) {
      const normalized = normalizeRelativePath(spelling);
      if (normalized && !candidates.includes(normalized)) {
        candidates.push(normalized);
      }
    }
  }
  return candidates;
}

export function resolveBibliographyPath(
  rawTarget: string,
  fromFile: string,
  knownFiles: readonly string[],
  engine: BibliographyEngine = "latex",
): string | null {
  const known = new Set(knownFiles);
  const byLower = new Map<string, string>();
  for (const file of knownFiles) {
    const key = file.toLowerCase();
    if (!byLower.has(key)) byLower.set(key, file);
  }
  for (const candidate of bibliographyCandidatePaths(rawTarget, fromFile, engine)) {
    if (known.has(candidate)) return candidate;
    const insensitive = byLower.get(candidate.toLowerCase());
    if (insensitive) return insensitive;
  }
  return null;
}
