import { buildLibrary, parseSnippetFile, type SnippetLibrary, type SnippetRecord, serializeBody } from "@oleafly/snippets";
import { setEditorTranslator } from "@oleafly/editor";
import { testCatalogTranslator } from "@oleafly/i18n-contract/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bodyKeys,
  draftFromRecord,
  draftRecord,
  newDraft,
  nextFieldIndex,
  type SnippetDraft,
  snippetClashes,
  uniqueRecordId,
} from "./draft";

function file(collection: string, layer: "user" | "pack" | "builtin", entries: Record<string, unknown>) {
  return parseSnippetFile(JSON.stringify(entries), collection, layer);
}

function libraryOf(...files: ReturnType<typeof file>[]): SnippetLibrary {
  return buildLibrary({ files, disabledCollections: new Set(), overrides: [], disabledRegex: new Set() });
}

const PAPER = file("paper-structure", "pack", {
  "paper.figure": { name: "Figure", prefix: "fig", body: { latex: "\\begin{figure}$1\\end{figure}", typst: "#figure($1)" } },
  "paper.figures": { name: "Subfigures", prefix: "figs", body: { latex: "\\begin{figure}$1\\end{figure}" } },
});
const MINE = file("my-snippets", "user", {
  "user.figref": { name: "Figure reference", prefix: "figref", body: "Figure~\\ref{$1}", languages: ["latex"] },
  "user.slash": { name: "Slashed", prefix: "re:x/", body: "y", languages: ["latex"] },
});
const SLASH = file("builtin-latex-slash", "builtin", {
  "latex.slash.section": { name: "Section", nameKey: "latex.snippet.section", prefix: "/section", body: "\\section{$1}", languages: ["latex"], where: "text", expand: "list", inWord: true, priority: 2 },
});
const FIGURE = PAPER.records[0];
const SECTION = SLASH.records[0];

function draft(patch: Partial<SnippetDraft>): SnippetDraft {
  return { ...newDraft("latex"), name: "Results table", bodies: { latex: "\\begin{table}$1\\end{table}" }, ...patch };
}

beforeAll(() => setEditorTranslator(testCatalogTranslator("editor")));
afterAll(() => setEditorTranslator(null));

describe("snippet drafts", () => {
  it("starts a new snippet in the open file's language, or for any language", () => {
    expect(newDraft("typst")).toMatchObject({ collection: "my-snippets", languages: ["typst"], expand: "tab", place: "any", wholeWord: true });
    expect(newDraft(null, "imported").languages).toBe("any");
    expect(newDraft(null, "imported").collection).toBe("imported");
    expect(bodyKeys("any")).toEqual(["default"]);
    expect(bodyKeys(["typst", "latex"])).toEqual(["latex", "typst"]);
  });

  it("opens a record with one body per language and the translated name", () => {
    expect(draftFromRecord(FIGURE)).toMatchObject({
      collection: "paper-structure",
      name: "Figure",
      trigger: "fig",
      regex: false,
      languages: ["latex", "typst"],
      bodies: { latex: "\\begin{figure}$1\\end{figure}", typst: "#figure($1)" },
    });
    expect(draftFromRecord(SECTION)).toMatchObject({ name: "Section", wholeWord: false, bodies: { latex: "\\section{$1}" } });
    expect(draftFromRecord(MINE.records[1])).toMatchObject({ regex: true, trigger: "x/" });
    expect(draftFromRecord({ ...SECTION, bodies: {} }).bodies).toEqual({});
  });

  it("builds a user record from the form", () => {
    const result = draftRecord(draft({ trigger: "rtab", expand: "list", place: "text", lineStart: true }), null, "user.results-table");
    expect(result.missing).toBeNull();
    expect(result.record).toMatchObject({
      id: "user.results-table",
      name: "Results table",
      trigger: "rtab",
      expand: "list",
      place: "text",
      lineStart: true,
      inWord: false,
      languages: ["latex"],
      layer: "user",
      collection: "my-snippets",
    });
    expect(serializeBody(result.record?.bodies.default ?? [])).toBe("\\begin{table}$1\\end{table}");
  });

  it("writes one body per language when they differ and a shared body when they do not", () => {
    const shared = draftRecord(draft({ languages: ["latex", "typst"], bodies: { latex: "a", typst: "a" } }), null, "user.a");
    expect(Object.keys(shared.record?.bodies ?? {})).toEqual(["default"]);
    expect(shared.record?.languages).toEqual(["latex", "typst"]);
    const split = draftRecord(draft({ languages: ["latex", "typst"], bodies: { latex: "a", typst: "b" } }), null, "user.b");
    expect(Object.keys(split.record?.bodies ?? {}).sort()).toEqual(["latex", "typst"]);
    const partly = draftRecord(draft({ languages: ["latex", "typst"], bodies: { latex: "a" } }), null, "user.c");
    expect(Object.keys(partly.record?.bodies ?? {})).toEqual(["latex"]);
    const anywhere = draftRecord(draft({ languages: "any", bodies: { default: "z" } }), null, "user.d");
    expect(anywhere.record?.languages).toBe("any");
    const kept = draftRecord(draftFromRecord(FIGURE), FIGURE, FIGURE.id);
    expect(Object.keys(kept.record?.bodies ?? {}).sort()).toEqual(["latex", "typst"]);
  });

  it("keeps what the form does not show when it saves an existing record", () => {
    const result = draftRecord(draftFromRecord(SECTION), SECTION, SECTION.id);
    expect(result.record).toMatchObject({ name: "Section", nameKey: "latex.snippet.section", priority: 2, inWord: true, layer: "builtin" });
    const renamed = draftRecord({ ...draftFromRecord(SECTION), name: "Heading" }, SECTION, SECTION.id);
    expect(renamed.record?.name).toBe("Heading");
    expect(renamed.record?.nameKey).toBeUndefined();
    const typst = file("t", "pack", {
      "t.x": { prefix: ["tx", "tex"], description: "kept", body: "x", typstSince: [0, 12], languages: ["typst"] },
    }).records[0];
    expect(draftRecord(draftFromRecord(typst), typst, typst.id).record).toMatchObject({
      aliases: ["tex"],
      description: "kept",
      typstSince: [0, 12],
    });
  });

  it("asks for a name and a body before anything else", () => {
    expect(draftRecord(draft({ name: "  " }), null, "user.x").missing).toBe("name");
    expect(draftRecord(draft({ bodies: { latex: " " } }), null, "user.x").missing).toBe("body");
    expect(draftRecord(draft({ bodies: {} }), null, "user.x").missing).toBe("body");
  });

  it("reports broken field syntax and broken regular expressions", () => {
    const syntax = draftRecord(draft({ bodies: { latex: "${1:open" } }), null, "user.x");
    expect(syntax.record).toBeNull();
    expect(syntax.errors[0]).toMatch(/never closed/u);
    const regex = draftRecord(draft({ trigger: "(", regex: true }), null, "user.x");
    expect(regex.record).toBeNull();
    expect(regex.errors[0]).toMatch(/not a valid regular expression/u);
  });

  it("keeps a literal trigger that starts like a regular expression literal", () => {
    const result = draftRecord(draft({ trigger: "re:x" }), null, "user.x");
    expect(result.record?.regex).toBeNull();
    expect(result.record?.trigger).toBe("re:x");
    const regex = draftRecord(draft({ trigger: "re:\\d", regex: true }), null, "user.y");
    expect(regex.record?.regex).not.toBeNull();
    expect(draftRecord(draft({ trigger: "  " }), null, "user.z").record?.trigger).toBeNull();
  });

  it("warns when an auto trigger in text is an ordinary word", () => {
    const result = draftRecord(draft({ trigger: "in", expand: "auto", place: "text" }), null, "user.x");
    expect(result.record).not.toBeNull();
    expect(result.warnings).toEqual(['"in" could expand while you write ordinary words']);
  });

  it("finds the next free field number", () => {
    expect(nextFieldIndex("")).toBe(1);
    expect(nextFieldIndex("$0")).toBe(1);
    expect(nextFieldIndex(`\${1:a \${3:b}} \${2|x,y|} \${4@image} \${4/slug} \${SELECTION:\${5}}`)).toBe(6);
  });

  it("makes record ids from the name without taking one that exists", () => {
    const taken = new Set(["user.results-table", "user.results-table-2"]);
    expect(uniqueRecordId("Results table", (id) => taken.has(id))).toBe("user.results-table-3");
    expect(uniqueRecordId("Fresh one", (id) => taken.has(id))).toBe("user.fresh-one");
    expect(uniqueRecordId("???", () => false)).toBe("user.snippet");
  });

  it("finds snippets that share a trigger or its start in the same languages", () => {
    const library = libraryOf(PAPER, MINE, SLASH);
    const clashes = snippetClashes(draft({ trigger: "fig" }), library, null);
    expect(clashes.map((clash) => clash.kind)).toEqual(["duplicate", "shared-start"]);
    expect(clashes[0].records.map((record: SnippetRecord) => record.id)).toEqual(["paper.figure"]);
    expect(clashes[1].records.map((record: SnippetRecord) => record.id).sort()).toEqual(["paper.figures", "user.figref"]);
    expect(snippetClashes(draft({ trigger: "figu" }), library, null)).toEqual([
      { kind: "shared-start", records: [FIGURE] },
    ]);
    expect(snippetClashes(draftFromRecord(FIGURE), library, FIGURE).map((clash) => clash.kind)).toEqual(["shared-start"]);
    expect(snippetClashes(draft({ trigger: "fig", languages: ["markdown"] }), library, null)).toEqual([]);
    expect(snippetClashes(draft({ trigger: "" }), library, null)).toEqual([]);
    expect(snippetClashes(draft({ trigger: "fig", regex: true }), library, null)).toEqual([]);
  });

  it("never finds a snippet clashing with itself after it moves to another collection", () => {
    const library = libraryOf(PAPER, MINE, SLASH);
    const figref = MINE.records[0];
    const moved = { ...draftFromRecord(figref), collection: "imported" };
    expect(snippetClashes(moved, library, figref)).toEqual([{ kind: "shared-start", records: [FIGURE] }]);
    expect(snippetClashes(moved, library, null).map((clash) => clash.kind)).toEqual(["duplicate", "shared-start"]);
  });
});
