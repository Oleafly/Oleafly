import { describe, expect, it } from "vitest";
import { parseNoteEdits } from "./note-agent";

describe("reading the agent's reply", () => {
  it("reads find and replace blocks, multi-line text and an empty find", () => {
    const reply = [
      "Here are the edits.",
      "```",
      "<<<<<<< FIND",
      "The ratio is 0.75.",
      "=======",
      "The ratio is 0.60.",
      "",
      "A new line.",
      ">>>>>>> REPLACE",
      "```",
      "<<<<<<< FIND",
      "=======",
      "Appended.",
      ">>>>>>> REPLACE",
    ].join("\n");
    expect(parseNoteEdits(reply)).toEqual({
      edits: [
        { find: "The ratio is 0.75.", replace: "The ratio is 0.60.\n\nA new line." },
        { find: "", replace: "Appended." },
      ],
      noChanges: false,
    });
  });

  it("drops edits that change nothing and blocks that never close", () => {
    const reply = "<<<<<<< FIND\nsame\n=======\nsame\n>>>>>>> REPLACE\n<<<<<<< FIND\nopen\n=======\nnever closed";
    expect(parseNoteEdits(reply)).toEqual({ edits: [], noChanges: false });
  });

  it("knows when the agent has nothing to change", () => {
    expect(parseNoteEdits("NO CHANGES")).toEqual({ edits: [], noChanges: true });
    expect(parseNoteEdits("I would not change anything.")).toEqual({ edits: [], noChanges: false });
  });

  it("accepts Windows line endings", () => {
    expect(parseNoteEdits("<<<<<<< FIND\r\na\r\n=======\r\nb\r\n>>>>>>> REPLACE\r\n").edits).toEqual([
      { find: "a", replace: "b" },
    ]);
  });
});
