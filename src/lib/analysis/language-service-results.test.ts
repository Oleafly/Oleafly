import { describe, expect, it } from "vitest";
import {
  applyOffsetEdits,
  locationsFromValue,
  offsetEdits,
  projectPathForUri,
  workspaceEditFromValue,
} from "./language-service-results";

const range = (line: number, from: number, to: number) => ({
  start: { line, character: from },
  end: { line, character: to },
});

describe("locationsFromValue", () => {
  it("reads a location, a location list and location links", () => {
    expect(
      locationsFromValue({ uri: "file:///p/a.typ", range: range(0, 1, 2) }),
    ).toEqual([{ uri: "file:///p/a.typ", range: range(0, 1, 2) }]);
    expect(
      locationsFromValue([
        {
          originSelectionRange: range(4, 29, 34),
          targetUri: "file:///p/util.typ",
          targetRange: range(0, 0, 40),
          targetSelectionRange: range(0, 5, 10),
        },
      ]),
    ).toEqual([{ uri: "file:///p/util.typ", range: range(0, 5, 10) }]);
    expect(locationsFromValue(null)).toEqual([]);
  });
});

describe("offsetEdits", () => {
  it("converts and applies UTF-16 text edits", () => {
    const text = "#let x = 1\n#x";
    const edits = offsetEdits(
      [
        { range: range(0, 5, 6), newText: "y" },
        { range: range(1, 1, 2), newText: "y" },
      ],
      text,
      "utf-16",
    );
    expect(edits).not.toBeNull();
    expect(applyOffsetEdits(text, edits ?? [])).toBe("#let y = 1\n#y");
  });

  it("rejects overlapping or out-of-range edits", () => {
    expect(
      offsetEdits(
        [
          { range: range(0, 0, 4), newText: "a" },
          { range: range(0, 2, 5), newText: "b" },
        ],
        "abcdef",
        "utf-16",
      ),
    ).toBeNull();
    expect(
      offsetEdits([{ range: range(3, 0, 1), newText: "x" }], "one", "utf-16"),
    ).toBeNull();
    expect(offsetEdits(null, "one", "utf-16")).toEqual([]);
  });
});

describe("projectPathForUri", () => {
  it("maps file URIs inside the project root", () => {
    expect(projectPathForUri("/p", "file:///p/sub/a%20b.typ")).toBe(
      "sub/a b.typ",
    );
    expect(projectPathForUri("C:\\Papers", "file:///c:/Papers/main.typ")).toBe(
      "main.typ",
    );
  });

  it("refuses paths outside the project", () => {
    expect(projectPathForUri("/p", "file:///other/a.typ")).toBeNull();
    expect(projectPathForUri("/p", "file:///p/../x.typ")).toBeNull();
    expect(projectPathForUri("/p", "https://typst.app")).toBeNull();
  });

  it("ignores trailing slashes on the root and the file path", () => {
    expect(projectPathForUri("/p///", "file:///p/a.typ")).toBe("a.typ");
    expect(projectPathForUri("C:\\Papers\\", "file:///c:/Papers/main.typ")).toBe("main.typ");
    expect(projectPathForUri("/p", "file:///p/sub//")).toBe("sub");
    expect(projectPathForUri("/p", "file:///p///")).toBeNull();
    expect(projectPathForUri("/", "file:///a.typ")).toBe("a.typ");
  });
});

describe("workspaceEditFromValue", () => {
  it("reads the changes map", () => {
    expect(
      workspaceEditFromValue({
        changes: {
          "file:///p/a.typ": [{ range: range(0, 0, 1), newText: "x" }],
        },
      }),
    ).toEqual({
      operations: [
        {
          kind: "edit",
          uri: "file:///p/a.typ",
          edits: [{ range: range(0, 0, 1), newText: "x" }],
        },
      ],
      unsupported: false,
    });
  });

  it("reads document changes with annotated edits and file renames in order", () => {
    const parsed = workspaceEditFromValue({
      changeAnnotations: { a: { label: "Typst Rename Labels" } },
      documentChanges: [
        {
          textDocument: { uri: "file:///p/main.typ", version: null },
          edits: [
            {
              annotationId: "a",
              range: range(6, 9, 22),
              newText: "\"chap.typ\"",
            },
          ],
        },
        {
          kind: "rename",
          oldUri: "file:///p/chapter.typ",
          newUri: "file:///p/chap.typ",
        },
      ],
    });
    expect(parsed?.operations.map((operation) => operation.kind)).toEqual([
      "edit",
      "rename",
    ]);
    expect(parsed?.unsupported).toBe(false);
  });

  it("flags file creation and deletion as unsupported", () => {
    expect(
      workspaceEditFromValue({
        documentChanges: [{ kind: "delete", uri: "file:///p/a.typ" }],
      })?.unsupported,
    ).toBe(true);
    expect(workspaceEditFromValue("nope")).toBeNull();
  });

  it("returns an empty edit when neither form is present", () => {
    expect(workspaceEditFromValue({})).toEqual({ operations: [], unsupported: false });
    expect(workspaceEditFromValue({ changes: [] })).toEqual({ operations: [], unsupported: false });
  });

  it("prefers document changes over the changes map", () => {
    expect(
      workspaceEditFromValue({
        documentChanges: [],
        changes: { "file:///p/a.typ": [{ range: range(0, 0, 1), newText: "x" }] },
      }),
    ).toEqual({ operations: [], unsupported: false });
  });

  it("rejects the whole edit when one entry is malformed", () => {
    expect(
      workspaceEditFromValue({
        documentChanges: [
          { kind: "create", uri: "file:///p/b.typ" },
          { textDocument: { uri: "file:///p/a.typ" }, edits: [{ newText: "x" }] },
        ],
      }),
    ).toBeNull();
    expect(workspaceEditFromValue({ documentChanges: ["nope"] })).toBeNull();
    expect(workspaceEditFromValue({ changes: { "file:///p/a.typ": "x" } })).toBeNull();
  });
});

describe("language-service result edge cases", () => {
  it("rejects edit positions that do not land exactly on a character boundary", () => {
    expect(
      offsetEdits([{ range: range(0, 0, 9), newText: "x" }], "short", "utf-16"),
    ).toBeNull();
    expect(
      offsetEdits([{ range: range(0, 1, 2), newText: "x" }], "𝒜b", "utf-16"),
    ).toBeNull();
  });

  it("rejects malformed edit lists and edit entries", () => {
    expect(offsetEdits({}, "text", "utf-16")).toBeNull();
    expect(offsetEdits(["edit"], "text", "utf-16")).toBeNull();
    expect(offsetEdits([{ range: range(0, 0, 1) }], "text", "utf-16")).toBeNull();
    expect(
      offsetEdits([{ range: { start: 0 }, newText: "x" }], "text", "utf-16"),
    ).toBeNull();
  });

  it("allows an insertion at the start of a replaced range but not duplicate edits", () => {
    const text = "abcdef";
    const edits = offsetEdits(
      [
        { range: range(0, 2, 4), newText: "XY" },
        { range: range(0, 2, 2), newText: ">" },
      ],
      text,
      "utf-16",
    );
    expect(edits).toEqual([
      { from: 2, to: 4, insert: "XY" },
      { from: 2, to: 2, insert: ">" },
    ]);
    expect(
      offsetEdits(
        [
          { range: range(0, 1, 1), newText: "a" },
          { range: range(0, 1, 1), newText: "b" },
        ],
        text,
        "utf-16",
      ),
    ).toBeNull();
  });

  it("falls back to the target range of a location link and skips unusable links", () => {
    expect(
      locationsFromValue([
        { targetUri: "file:///p/a.typ", targetRange: range(1, 0, 4) },
        { targetUri: "file:///p/b.typ", targetRange: "nowhere" },
        { targetUri: 3, targetRange: range(0, 0, 1) },
        "not a location",
      ]),
    ).toEqual([{ uri: "file:///p/a.typ", range: range(1, 0, 4) }]);
  });

  it("refuses file URIs with broken percent-encoding", () => {
    expect(projectPathForUri("/p", "file:///p/%E0%A4%A")).toBeNull();
  });

  it("rejects document changes of an unknown kind", () => {
    expect(
      workspaceEditFromValue({
        documentChanges: [{ kind: "move", uri: "file:///p/a.typ" }],
      }),
    ).toBeNull();
  });
});
