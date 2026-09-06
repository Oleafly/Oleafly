import { describe, expect, it } from "vitest";
import {
  activeMentionQuery,
  composerMentionPaths,
  mentionInsertText,
  mentionTokenEnd,
  tokenizeComposer,
} from "./composer-tokens";

const PATHS = [
  "main.tex",
  "sections",
  "sections/intro.tex",
  "research/notes",
  "my notes",
  "figures/plot one.pdf",
];

function kinds(text: string, sources: Parameters<typeof tokenizeComposer>[1]) {
  return tokenizeComposer(text, sources).map((token) => `${token.kind}:${token.value}`);
}

describe("tokenizeComposer", () => {
  it("returns one plain run when nothing matches", () => {
    expect(tokenizeComposer("just some prose", { skillIds: ["a"], paths: PATHS })).toEqual([
      { kind: "text", start: 0, end: 15, value: "just some prose" },
    ]);
  });

  it("marks a leading slash token that names a valid skill", () => {
    expect(kinds("/proof-review check table 2", { skillIds: ["proof-review"] })).toEqual([
      "skill:proof-review",
      "text: check table 2",
    ]);
  });

  it("prefers the longest matching skill id", () => {
    expect(
      kinds("/paper-lookup-plus go", { skillIds: ["paper-lookup", "paper-lookup-plus"] }),
    ).toEqual(["skill:paper-lookup-plus", "text: go"]);
  });

  it("leaves an unknown slash word and a mid-text slash alone", () => {
    expect(kinds("/nope go", { skillIds: ["proof-review"] })).toEqual(["text:/nope go"]);
    expect(kinds("run /proof-review now", { skillIds: ["proof-review"] })).toEqual([
      "text:run /proof-review now",
    ]);
  });

  it("recognizes a mention anywhere in the text", () => {
    expect(kinds("please read @main.tex today", { paths: PATHS })).toEqual([
      "text:please read ",
      "mention:main.tex",
      "text: today",
    ]);
  });

  it("recognizes a folder mention with or without a trailing slash", () => {
    expect(kinds("@sections/", { paths: PATHS })).toEqual(["mention:sections"]);
    expect(kinds("@sections", { paths: PATHS })).toEqual(["mention:sections"]);
  });

  it("recognizes a quoted mention that contains spaces", () => {
    expect(kinds('look at @"my notes" now', { paths: PATHS })).toEqual([
      "text:look at ",
      "mention:my notes",
      "text: now",
    ]);
    expect(kinds('@"figures/plot one.pdf"', { paths: PATHS })).toEqual([
      "mention:figures/plot one.pdf",
    ]);
  });

  it("ignores sentence punctuation that trails a mention", () => {
    const tokens = tokenizeComposer("check @main.tex.", { paths: PATHS });
    expect(tokens.map((token) => `${token.kind}:${token.value}`)).toEqual([
      "text:check ",
      "mention:main.tex",
      "text:.",
    ]);
  });

  it("does not treat an email address as a mention", () => {
    expect(kinds("write to a@b.c and main.tex", { paths: [...PATHS, "b.c"] })).toEqual([
      "text:write to a@b.c and main.tex",
    ]);
  });

  it("leaves an unresolved mention as plain text", () => {
    expect(kinds("read @nowhere.tex", { paths: PATHS })).toEqual(["text:read @nowhere.tex"]);
  });

  it("marks a skill and a mention in the same message", () => {
    expect(
      kinds("/proof-review look at @sections/intro.tex", {
        skillIds: ["proof-review"],
        paths: PATHS,
      }),
    ).toEqual(["skill:proof-review", "text: look at ", "mention:sections/intro.tex"]);
  });

  it("reports offsets that slice back to the original text", () => {
    const text = "read @main.tex please";
    for (const token of tokenizeComposer(text, { paths: PATHS })) {
      expect(text.slice(token.start, token.end).length).toBe(token.end - token.start);
    }
    expect(tokenizeComposer(text, { paths: PATHS }).map((t) => t.end - t.start).reduce(
      (sum, size) => sum + size,
      0,
    )).toBe(text.length);
  });
});

describe("composerMentionPaths", () => {
  it("collects each resolved mention once, in order", () => {
    expect(
      composerMentionPaths("@main.tex and @sections/ and @main.tex again", PATHS),
    ).toEqual(["main.tex", "sections"]);
  });

  it("returns nothing when no mention resolves", () => {
    expect(composerMentionPaths("no mentions here", PATHS)).toEqual([]);
  });
});

describe("mentionInsertText", () => {
  it("appends a trailing slash for a folder and a space after every insert", () => {
    expect(mentionInsertText("sections", true)).toBe("@sections/ ");
    expect(mentionInsertText("main.tex", false)).toBe("@main.tex ");
  });

  it("quotes a path that contains a space", () => {
    expect(mentionInsertText("my notes", true)).toBe('@"my notes/" ');
    expect(mentionInsertText("figures/plot one.pdf", false)).toBe('@"figures/plot one.pdf" ');
  });
});

describe("activeMentionQuery", () => {
  it("reports the fragment typed after an opening at sign", () => {
    expect(activeMentionQuery("read @sec", 9)).toEqual({ start: 5, query: "sec" });
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("reports a quoted fragment that still contains spaces", () => {
    expect(activeMentionQuery('read @"my no', 12)).toEqual({ start: 5, query: "my no" });
  });

  it("stays closed for an email, a finished token, and a closed quote", () => {
    expect(activeMentionQuery("mail a@b.c", 10)).toBeNull();
    expect(activeMentionQuery("read @main.tex now", 18)).toBeNull();
    expect(activeMentionQuery('read @"my notes" ', 17)).toBeNull();
  });
});

describe("mentionTokenEnd", () => {
  it("ends an unquoted token at the next space", () => {
    expect(mentionTokenEnd("read @main.tex now", 5)).toBe(14);
  });

  it("ends a quoted token at the closing quote", () => {
    expect(mentionTokenEnd('read @"my notes" now', 5)).toBe(16);
  });
});
