export type BibtexFieldGroup = readonly string[];

export interface BibtexEntryType {
  readonly name: string;
  readonly required: readonly BibtexFieldGroup[];
  readonly optional: readonly string[];
}

const CREATOR = ["author", "editor"] as const;
const JOURNAL = ["journal", "journaltitle"] as const;
const SCHOOL = ["school", "institution"] as const;
const WEB_LOCATOR = ["url", "doi", "eprint"] as const;
const YEAR = ["year", "date"] as const;

const GENERAL_FIELDS = [
  "addendum",
  "doi",
  "eprint",
  "eprintclass",
  "eprinttype",
  "key",
  "keywords",
  "language",
  "month",
  "note",
  "pubstate",
  "url",
  "urldate",
];
const TITLE_FIELDS = ["shorttitle", "subtitle", "titleaddon"];
const LINK_FIELDS = ["crossref", "entryset", "related", "xdata", "xref"];
const CONTRIBUTOR_FIELDS = [
  "afterword",
  "annotator",
  "commentator",
  "editor",
  "foreword",
  "introduction",
  "translator",
];
const IMPRINT_FIELDS = [
  "address",
  "edition",
  "isbn",
  "location",
  "number",
  "pages",
  "pagetotal",
  "part",
  "publisher",
  "series",
  "volume",
  "volumes",
];
const PERIODICAL_FIELDS = [
  "issn",
  "issue",
  "issuetitle",
  "journalsubtitle",
  "number",
  "pages",
  "volume",
];
const EVENT_FIELDS = ["eventdate", "eventtitle", "organization", "venue"];
const WORK_FIELDS = ["booktitle", "chapter", "howpublished", "type", "version"];

const byName = (left: string, right: string): number =>
  Number(left > right) - Number(left < right);

function entryType(
  name: string,
  required: readonly BibtexFieldGroup[],
  extraOptional: readonly (readonly string[])[] = [],
): BibtexEntryType {
  const requiredNames = new Set(required.flat());
  const optional = [
    ...new Set([
      ...GENERAL_FIELDS,
      ...TITLE_FIELDS,
      ...LINK_FIELDS,
      ...extraOptional.flat(),
    ]),
  ]
    .filter((field) => !requiredNames.has(field))
    .sort(byName);
  return { name, required, optional };
}

function aliasOf(name: string, source: BibtexEntryType): BibtexEntryType {
  return { name, required: source.required, optional: source.optional };
}

const ARTICLE = entryType(
  "article",
  [["author"], ["title"], JOURNAL, YEAR],
  [PERIODICAL_FIELDS, CONTRIBUTOR_FIELDS, ["series"]],
);
const BOOK = entryType(
  "book",
  [CREATOR, ["title"], ["publisher"], YEAR],
  [IMPRINT_FIELDS, CONTRIBUTOR_FIELDS, ["maintitle", "chapter"]],
);
const INBOOK = entryType(
  "inbook",
  [CREATOR, ["title"], ["chapter", "pages"], ["publisher"], YEAR],
  [IMPRINT_FIELDS, CONTRIBUTOR_FIELDS, ["booktitle", "maintitle"]],
);
const INPROCEEDINGS = entryType(
  "inproceedings",
  [["author"], ["title"], ["booktitle"], YEAR],
  [IMPRINT_FIELDS, CONTRIBUTOR_FIELDS, EVENT_FIELDS],
);
const PROCEEDINGS = entryType(
  "proceedings",
  [["title"], YEAR],
  [IMPRINT_FIELDS, CONTRIBUTOR_FIELDS, EVENT_FIELDS],
);
const COLLECTION = entryType(
  "collection",
  [["editor"], ["title"], YEAR],
  [IMPRINT_FIELDS, CONTRIBUTOR_FIELDS, ["maintitle"]],
);
const THESIS = entryType(
  "thesis",
  [["author"], ["title"], SCHOOL, YEAR],
  [IMPRINT_FIELDS, WORK_FIELDS],
);
const REPORT = entryType(
  "report",
  [["author"], ["title"], ["institution"], YEAR],
  [IMPRINT_FIELDS, WORK_FIELDS, ["isrn"]],
);
const ONLINE = entryType(
  "online",
  [["title"], WEB_LOCATOR],
  [CONTRIBUTOR_FIELDS, WORK_FIELDS, ["author", "organization", ...YEAR]],
);
const DATASET = entryType(
  "dataset",
  [["title"], YEAR],
  [CONTRIBUTOR_FIELDS, WORK_FIELDS, ["author", "publisher", "organization"]],
);

const ENTRY_TYPES: readonly BibtexEntryType[] = [
  ARTICLE,
  BOOK,
  entryType("booklet", [["title"]], [IMPRINT_FIELDS, ["author", ...YEAR, "howpublished"]]),
  aliasOf("bookinbook", INBOOK),
  COLLECTION,
  aliasOf("conference", INPROCEEDINGS),
  DATASET,
  aliasOf("electronic", ONLINE),
  INBOOK,
  entryType(
    "incollection",
    [["author"], ["title"], ["booktitle"], ["publisher"], YEAR],
    [IMPRINT_FIELDS, CONTRIBUTOR_FIELDS, ["maintitle"]],
  ),
  INPROCEEDINGS,
  entryType(
    "inreference",
    [CREATOR, ["title"], ["booktitle"], YEAR],
    [IMPRINT_FIELDS, CONTRIBUTOR_FIELDS, ["maintitle"]],
  ),
  entryType("manual", [["title"]], [IMPRINT_FIELDS, WORK_FIELDS, ["author", "organization", ...YEAR]]),
  aliasOf("mastersthesis", THESIS),
  entryType(
    "misc",
    [],
    [IMPRINT_FIELDS, CONTRIBUTOR_FIELDS, WORK_FIELDS, ["author", "organization", ...YEAR]],
  ),
  entryType("mvbook", [["author"], ["title"], YEAR], [IMPRINT_FIELDS, CONTRIBUTOR_FIELDS, ["maintitle"]]),
  ONLINE,
  entryType(
    "patent",
    [["author"], ["title"], ["number"], YEAR],
    [IMPRINT_FIELDS, WORK_FIELDS, ["holder", "version"]],
  ),
  entryType("periodical", [["editor"], ["title"], YEAR], [PERIODICAL_FIELDS, ["issuesubtitle", "series"]]),
  aliasOf("phdthesis", THESIS),
  PROCEEDINGS,
  aliasOf("reference", COLLECTION),
  REPORT,
  entryType("software", [["title"], YEAR], [IMPRINT_FIELDS, WORK_FIELDS, ["author", "organization"]]),
  aliasOf("suppbook", INBOOK),
  aliasOf("techreport", REPORT),
  THESIS,
  entryType("unpublished", [["author"], ["title"], ["note"]], [WORK_FIELDS, [...YEAR, "pages"]]),
  aliasOf("www", ONLINE),
].sort((left, right) => byName(left.name, right.name));

const ENTRY_TYPES_BY_NAME = new Map(
  ENTRY_TYPES.map((type) => [type.name, type]),
);

export const BIBTEX_ENTRY_TYPES = ENTRY_TYPES;

export const BIBTEX_DIRECTIVES = ["comment", "preamble", "string"] as const;

export function bibtexEntryType(name: string): BibtexEntryType | null {
  return ENTRY_TYPES_BY_NAME.get(name.toLowerCase()) ?? null;
}

export function isBibtexDirective(name: string): boolean {
  return (BIBTEX_DIRECTIVES as readonly string[]).includes(name.toLowerCase());
}

export function bibtexEntryFields(name: string): readonly string[] {
  const type = bibtexEntryType(name);
  if (!type) return [];
  return [...new Set([...type.required.flat(), ...type.optional])];
}

export function missingBibtexRequiredFields(
  name: string,
  present: ReadonlySet<string>,
): readonly BibtexFieldGroup[] {
  const type = bibtexEntryType(name);
  if (!type) return [];
  return type.required.filter(
    (group) => !group.some((field) => present.has(field)),
  );
}
