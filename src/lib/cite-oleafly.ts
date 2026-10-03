export const OLEAFLY_CITATION_KEY = "oleafly";
export const OLEAFLY_CITATION_YEAR = 2026;
export const OLEAFLY_REPOSITORY_URL = "https://github.com/Oleafly/Oleafly";
export const OLEAFLY_CITATION_TITLE =
  "Oleafly: a local-first desktop workspace for research writing";
export const OLEAFLY_CITATION_AUTHOR =
  "Venkateshmurthy, Prajwal S. and {The Oleafly contributors}";
export const OLEAFLY_CITATION_LICENSE = "AGPL-3.0-or-later";

export type BibtexTokenKind = "entry" | "key" | "field" | "punctuation" | "value";

export interface BibtexToken {
  readonly text: string;
  readonly kind: BibtexTokenKind;
}

export function oleaflyBibtexFields(version: string): readonly (readonly [string, string])[] {
  const cleaned = version.trim();
  return [
    ["author", OLEAFLY_CITATION_AUTHOR],
    ["title", OLEAFLY_CITATION_TITLE],
    ["year", String(OLEAFLY_CITATION_YEAR)],
    ...(cleaned ? [["version", cleaned] as const] : []),
    ["url", OLEAFLY_REPOSITORY_URL],
    ["license", OLEAFLY_CITATION_LICENSE],
  ];
}

export function oleaflyBibtexTokens(version: string): readonly (readonly BibtexToken[])[] {
  const fields = oleaflyBibtexFields(version);
  const width = Math.max(...fields.map(([name]) => name.length));
  const lines: BibtexToken[][] = [
    [
      { text: "@software", kind: "entry" },
      { text: "{", kind: "punctuation" },
      { text: OLEAFLY_CITATION_KEY, kind: "key" },
      { text: ",", kind: "punctuation" },
    ],
  ];
  fields.forEach(([name, value], index) => {
    lines.push([
      { text: `  ${name.padEnd(width)} = `, kind: "field" },
      { text: "{", kind: "punctuation" },
      { text: value, kind: "value" },
      { text: index === fields.length - 1 ? "}" : "},", kind: "punctuation" },
    ]);
  });
  lines.push([{ text: "}", kind: "punctuation" }]);
  return lines;
}

export function oleaflyBibtex(version: string): string {
  return oleaflyBibtexTokens(version)
    .map((line) => line.map((token) => token.text).join(""))
    .join("\n");
}

export function bibtexHasOleaflyEntry(bibtex: string): boolean {
  return new RegExp(String.raw`@\w+\s*\{\s*${OLEAFLY_CITATION_KEY}\s*,`, "iu").test(bibtex);
}

export const OLEAFLY_HAYAGRIVA_AUTHORS = ["Venkateshmurthy, Prajwal S."] as const;
export const OLEAFLY_HAYAGRIVA_GROUP = "The Oleafly contributors";

function yamlString(value: string): string {
  const escaped = value.replaceAll("\\", String.raw`\\`).replaceAll('"', String.raw`\"`);
  return `"${escaped}"`;
}

export function oleaflyHayagriva(version: string): string {
  const cleaned = version.trim();
  const note = `Version ${cleaned}`;
  return [
    `${OLEAFLY_CITATION_KEY}:`,
    "  type: repository",
    `  title: ${yamlString(OLEAFLY_CITATION_TITLE)}`,
    "  author:",
    ...OLEAFLY_HAYAGRIVA_AUTHORS.map((author) => `    - ${yamlString(author)}`),
    `    - name: ${yamlString(OLEAFLY_HAYAGRIVA_GROUP)}`,
    `  date: ${OLEAFLY_CITATION_YEAR}`,
    `  url: ${yamlString(OLEAFLY_REPOSITORY_URL)}`,
    ...(cleaned ? [`  note: ${yamlString(note)}`] : []),
  ].join("\n");
}

