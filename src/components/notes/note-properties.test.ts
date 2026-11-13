import { describe, expect, it } from "vitest";
import {
  canAddProperty,
  conversionLoss,
  convertValue,
  emptyValue,
  inferType,
  mergeFrontMatter,
  readProperties,
  removeProperty,
  renameProperty,
  setProperty,
} from "./note-properties";

const FM = [
  "---",
  "title: Masking",
  "# keep this comment",
  "status: draft # inline note",
  "tags: [ml, vision]",
  "aliases:",
  "  - MAE",
  "id: n1",
  "done: false",
  "score: 4.5",
  "when: 2024-03-01",
  "source: oleafly://note/n2",
  "meta:",
  "  a: 1",
  "matrix: [[1, 2]]",
  "empty:",
  "---",
].join("\n");

describe("reading properties", () => {
  it("reads user keys with inferred types and skips managed ones", () => {
    expect(readProperties(FM)).toEqual([
      { key: "status", type: "text", value: "draft", readOnly: false },
      { key: "tags", type: "list", value: ["ml", "vision"], readOnly: false },
      { key: "aliases", type: "list", value: ["MAE"], readOnly: false },
      { key: "done", type: "checkbox", value: false, readOnly: false },
      { key: "score", type: "number", value: 4.5, readOnly: false },
      { key: "when", type: "date", value: "2024-03-01", readOnly: false },
      { key: "source", type: "link", value: "oleafly://note/n2", readOnly: false },
      { key: "meta", type: "text", value: '{"a":1}', readOnly: true },
      { key: "matrix", type: "text", value: "[[1,2]]", readOnly: true },
      { key: "empty", type: "text", value: null, readOnly: false },
    ]);
    expect(readProperties("---\ntitle: x\n---")).toEqual([]);
  });

  it("shows an alias as the value its anchor holds", () => {
    expect(readProperties("---\nbase: &b x\nother: *b\n---")).toEqual([
      { key: "base", type: "text", value: "x", readOnly: false },
      { key: "other", type: "text", value: "x", readOnly: false },
    ]);
    expect(readProperties("---\nm: &m {k: 1}\nn: *m\ns: &s [x, y]\nt: *s\nb: [*s, *s]\n---")).toEqual([
      { key: "m", type: "text", value: '{"k":1}', readOnly: true },
      { key: "n", type: "text", value: '{"k":1}', readOnly: true },
      { key: "s", type: "list", value: ["x", "y"], readOnly: false },
      { key: "t", type: "list", value: ["x", "y"], readOnly: false },
      { key: "b", type: "text", value: '[["x","y"],["x","y"]]', readOnly: true },
    ]);
  });

  it("shows an alias written before its anchor as JSON rather than [object Object]", () => {
    expect(readProperties("---\nearly: *b\nbase: &b x\n---")).toEqual([
      { key: "early", type: "text", value: '{"source":"b"}', readOnly: false },
      { key: "base", type: "text", value: "x", readOnly: false },
    ]);
  });

  it("shows an alias that loops back into its own anchor as JSON rather than failing", () => {
    expect(readProperties("---\na: &a [*a]\nm: &m {self: *m}\n---")).toEqual([
      { key: "a", type: "text", value: '[{"source":"a"}]', readOnly: true },
      { key: "m", type: "text", value: '{"self":{"source":"m"}}', readOnly: true },
    ]);
  });

  it("keeps the JSON of a map that has a list for a key when nothing in it is an alias", () => {
    expect(readProperties("---\nm: {? [a, b] : c}\n---")).toEqual([{ key: "m", type: "text", value: '{"[\\"a\\",\\"b\\"]":"c"}', readOnly: true }]);
  });

  it("reads a quoted list item that holds a comma as one value, as the tag index does", () => {
    expect(readProperties('---\ntags: ["a, b", c]\n---')).toEqual([{ key: "tags", type: "list", value: ["a, b", "c"], readOnly: false }]);
  });

  it("reads only a whole front matter block, closed by --- or ...", () => {
    expect(readProperties("---\nstatus: x\n...")).toEqual([{ key: "status", type: "text", value: "x", readOnly: false }]);
    expect(readProperties("---\nstatus: x\n---\nbody")).toEqual([]);
  });

  it("treats tags and aliases as lists even when written as text, split the way the tag index splits them", () => {
    expect(readProperties("---\ntags: a, b\naliases:\n---")).toEqual([
      { key: "tags", type: "list", value: ["a", "b"], readOnly: false },
      { key: "aliases", type: "list", value: [], readOnly: false },
    ]);
    expect(readProperties("---\ntags: methods results\naliases: Mask study, MAE run\n---")).toEqual([
      { key: "tags", type: "list", value: ["methods", "results"], readOnly: false },
      { key: "aliases", type: "list", value: ["Mask study", "MAE run"], readOnly: false },
    ]);
  });

  it("uses a remembered type when the value fits it", () => {
    expect(readProperties("---\nrank:\nnote: 3\n---", { rank: "number", note: "date" })).toEqual([
      { key: "rank", type: "number", value: null, readOnly: false },
      { key: "note", type: "number", value: 3, readOnly: false },
    ]);
  });

  it("refuses broken YAML and front matter that is not a map", () => {
    expect(readProperties("---\na: [\n---")).toBeNull();
    expect(readProperties("---\n- a\n---")).toBeNull();
    expect(readProperties("")).toEqual([]);
    expect(readProperties("---\n---")).toEqual([]);
  });
});

describe("types and values", () => {
  it.each([
    ["x", ["a"], undefined, "list"],
    ["x", true, undefined, "checkbox"],
    ["x", 2, undefined, "number"],
    ["x", "2024-01-01", undefined, "date"],
    ["x", "oleafly://note/a#h", undefined, "link"],
    ["x", "words", undefined, "text"],
    ["x", "words", "list", "text"],
    ["x", "", "checkbox", "checkbox"],
    ["x", true, "text", "text"],
    ["x", "1999-01-01", "date", "date"],
    ["x", "oleafly://note/b", "link", "link"],
    ["x", ["z"], "list", "list"],
    ["x", 1, "number", "number"],
    ["x", false, "checkbox", "checkbox"],
    ["tags", "a", "text", "list"],
  ] as const)("infers %s=%j with %s as %s", (key, value, known, type) => {
    expect(inferType(key, value, known)).toBe(type);
  });

  it("converts values between types", () => {
    expect(convertValue("Smith, J.", "list")).toEqual(["Smith, J."]);
    expect(convertValue("", "list")).toEqual([]);
    expect(convertValue(["a"], "list")).toEqual(["a"]);
    expect(convertValue(null, "list")).toEqual([]);
    expect(convertValue(4, "list")).toEqual(["4"]);
    expect(convertValue("yes", "checkbox")).toBe(true);
    expect(convertValue(true, "checkbox")).toBe(true);
    expect(convertValue("no", "checkbox")).toBe(false);
    expect(convertValue("3.5", "number")).toBe(3.5);
    expect(convertValue(7, "number")).toBe(7);
    expect(convertValue("x", "number")).toBeNull();
    expect(convertValue(null, "number")).toBeNull();
    expect(convertValue(" 2024-01-02 ", "date")).toBe("2024-01-02");
    expect(convertValue("soon", "date")).toBeNull();
    expect(convertValue("oleafly://note/a", "link")).toBe("oleafly://note/a");
    expect(convertValue("x", "link")).toBeNull();
    expect(convertValue(["first", "second"], "text")).toBe("first");
    expect(convertValue([], "text")).toBeNull();
    expect(convertValue(false, "text")).toBe("false");
    expect(emptyValue("list")).toEqual([]);
    expect(emptyValue("checkbox")).toBe(false);
    expect(emptyValue("text")).toBeNull();
  });
});

describe("lossy type changes", () => {
  it("flags dropped list items and values the new type can't hold", () => {
    expect(conversionLoss(["a", "b"], "text")).toBe("items");
    expect(conversionLoss(["a"], "text")).toBeNull();
    expect(conversionLoss(["x"], "number")).toBe("value");
    expect(conversionLoss([], "number")).toBeNull();
    expect(conversionLoss("a, b", "list")).toBeNull();
    expect(conversionLoss("hello", "number")).toBe("value");
    expect(conversionLoss("2026-01-01", "number")).toBe("value");
    expect(conversionLoss("5", "number")).toBeNull();
    expect(conversionLoss("hello", "date")).toBe("value");
    expect(conversionLoss("hello", "checkbox")).toBe("value");
    expect(conversionLoss("yes", "checkbox")).toBeNull();
    expect(conversionLoss(5, "checkbox")).toBe("value");
    expect(conversionLoss(1, "checkbox")).toBeNull();
    expect(conversionLoss(true, "text")).toBeNull();
    expect(conversionLoss(null, "number")).toBeNull();
    expect(conversionLoss("", "date")).toBeNull();
  });
});

describe("writing properties", () => {
  it("changes one value and keeps comments, order and managed keys", () => {
    const next = setProperty(FM, "status", "final");
    expect(next).toBe(FM.replace("status: draft # inline note", "status: final # inline note"));
    expect(setProperty(FM, "tags", ["ml", "vision", "ssl"])).toBe(FM.replace("tags: [ml, vision]", "tags: [ml, vision, ssl]"));
    expect(setProperty(FM, "aliases", ["MAE", "Masked AE"])).toBe(FM.replace("  - MAE", "  - MAE\n  - Masked AE"));
    expect(setProperty(FM, "aliases", [])).toBe(FM.replace("aliases:\n  - MAE", "aliases: []"));
    expect(setProperty(FM, "empty", true)).toBe(FM.replace("empty:", "empty: true"));
    expect(setProperty(FM, "title", "x")).toBe(FM);
  });

  it("adds new keys at the end and builds front matter when there is none", () => {
    expect(setProperty(FM, "new key", 3)).toBe(FM.replace("empty:\n---", "empty:\nnew key: 3\n---"));
    expect(setProperty("", "status", "idea")).toBe("---\nstatus: idea\n---");
    expect(setProperty("---\n---", "a", "b")).toBe("---\na: b\n---");
    expect(setProperty("---\r\ntitle: A\r\n---", "list", ["x"])).toBe("---\r\ntitle: A\r\nlist:\r\n  - x\r\n---");
    expect(setProperty("---\r\na: 1\r\nb: 2\r\n---", "a", 5)).toBe("---\r\na: 5\r\nb: 2\r\n---");
  });

  it("quotes values that need it", () => {
    expect(setProperty("---\n---", "note", "a: b")).toBe('---\nnote: "a: b"\n---');
    expect(setProperty("---\n---", "n", "#hash")).toBe('---\nn: "#hash"\n---');
  });

  it("removes and renames keys", () => {
    expect(removeProperty(FM, "aliases")).toBe(FM.replace("aliases:\n  - MAE\n", ""));
    expect(removeProperty(FM, "empty")).toBe(FM.replace("\nempty:", ""));
    expect(removeProperty("---\nonly: 1\n---", "only")).toBe("---\n---");
    expect(removeProperty("---\r\na: 1\r\nb: 2\r\n---", "b")).toBe("---\r\na: 1\r\n---");
    expect(removeProperty(FM, "id")).toBe(FM);
    expect(removeProperty(FM, "missing")).toBe(FM);
    expect(renameProperty(FM, "status", "state")).toBe(FM.replace("status: draft", "state: draft"));
    expect(renameProperty(FM, "status", "needs: quotes")).toBe(FM.replace("status: draft", '"needs: quotes": draft'));
    expect(renameProperty(FM, "status", "tags")).toBe(FM);
    expect(renameProperty(FM, "status", " ")).toBe(FM);
    expect(renameProperty(FM, "status", "id")).toBe(FM);
    expect(renameProperty(FM, "missing", "x")).toBe(FM);
    expect(renameProperty("---\na: [\n---", "a", "b")).toBe("---\na: [\n---");
  });

  it("checks names for new properties", () => {
    expect(canAddProperty(FM, "status")).toBe(false);
    expect(canAddProperty(FM, "kind")).toBe(false);
    expect(canAddProperty(FM, " ")).toBe(false);
    expect(canAddProperty(FM, "owner")).toBe(true);
    expect(canAddProperty("---\na: [\n---", "owner")).toBe(false);
  });
});

describe("merging front matter", () => {
  const BASE = "---\ntitle: Masking\nkind: note\nid: n1\nstatus: draft # check\ntags: [ml]\n---";

  it("keeps the local change and the disk change to different keys", () => {
    const mine = BASE.replace("status: draft # check", "status: final");
    const theirs = BASE.replace("tags: [ml]", "tags: [ml, vision]");
    expect(mergeFrontMatter(BASE, mine, theirs)).toBe(
      "---\ntitle: Masking\nkind: note\nid: n1\nstatus: final\ntags: [ml, vision]\n---",
    );
  });

  it("lets the local value win when both sides changed the same key", () => {
    const mine = BASE.replace("status: draft # check", "status: final");
    const theirs = BASE.replace("status: draft # check", "status: review").replace("title: Masking", "title: Masks");
    expect(mergeFrontMatter(BASE, mine, theirs)).toBe(
      "---\ntitle: Masks\nkind: note\nid: n1\nstatus: final\ntags: [ml]\n---",
    );
  });

  it("removes keys removed here and adds keys added here, keeping what the disk added", () => {
    const mine = BASE.replace("tags: [ml]", "aliases:\n  - MAE");
    const theirs = BASE.replace("tags: [ml]", "tags: [ml]\nowner: Ada");
    expect(mergeFrontMatter(BASE, mine, theirs)).toBe(
      "---\ntitle: Masking\nkind: note\nid: n1\nstatus: draft # check\naliases:\n  - MAE\nowner: Ada\n---",
    );
  });

  it("puts a key added here next to the key it follows here", () => {
    const base = "---\r\ntitle: Masking\r\nid: n1\r\n---";
    const mine = "---\r\nlead: yes\r\ntitle: Masking\r\nicon: x\r\nid: n1\r\n---";
    const theirs = "---\r\ntitle: Masks\r\nid: n1\r\nowner: Ada\r\n---";
    expect(mergeFrontMatter(base, mine, theirs)).toBe(
      "---\r\nlead: yes\r\ntitle: Masks\r\nicon: x\r\nid: n1\r\nowner: Ada\r\n---",
    );
  });

  it("keeps the identity the disk already has", () => {
    const base = "---\ntitle: Masking\n---";
    const mine = "---\ntitle: Masking\nkind: note\nid: local\nicon: x\n---";
    const theirs = "---\ntitle: Masking\nkind: note\nid: disk\n---";
    expect(mergeFrontMatter(base, mine, theirs)).toBe("---\ntitle: Masking\nkind: note\nid: disk\nicon: x\n---");
    expect(mergeFrontMatter(base, mine, "---\ntitle: Masking\n---")).toBe(mine);
  });

  it("writes local changes with the disk's line endings and fences", () => {
    const theirs = "\uFEFF---\r\ntitle: Masking\r\nstatus: draft\r\nnote: |\r\n  a\r\n  b\r\n...";
    const base = "---\ntitle: Masking\nstatus: draft\n---";
    const mine = "---\ntitle: Masking\nstatus: final\nnote: |\n  c\n---";
    expect(mergeFrontMatter(base, mine, theirs)).toBe(
      "\uFEFF---\r\ntitle: Masking\r\nstatus: final\r\nnote: |\r\n  c\r\n...",
    );
  });

  it("builds front matter when the disk copy has none", () => {
    const mine = "---\ntitle: Masking\nstatus: final\n---";
    expect(mergeFrontMatter("---\ntitle: Masking\n---", mine, "")).toBe("---\nstatus: final\n---");
  });

  it("takes either side whole when only one side changed, and the local copy when YAML is broken", () => {
    const changed = BASE.replace("status: draft # check", "status: final");
    expect(mergeFrontMatter(BASE, BASE, changed)).toBe(changed);
    expect(mergeFrontMatter(BASE, changed, BASE)).toBe(changed);
    expect(mergeFrontMatter(BASE, changed, changed)).toBe(changed);
    expect(mergeFrontMatter(BASE, changed, "---\na: [\n---")).toBe(changed);
    const complex = "---\n? [a, b]\n: 1\nstatus: draft\n---";
    expect(mergeFrontMatter(complex, complex.replace("draft", "final"), complex.replace(": 1", ": 2"))).toBe(
      "---\n? [a, b]\n: 2\nstatus: final\n---",
    );
  });
});
