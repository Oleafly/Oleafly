import { describe, expect, it } from "vitest";
import type { CollabCommentMember } from "@/lib/tauri";
import { insertMention, matchMembers, mentionQuery, mentionSegments } from "./mentions";

const ALICE: CollabCommentMember = { accountId: "alice", displayName: "Alice Chen", login: "alice-chen" };
const BOB: CollabCommentMember = { accountId: "bob", displayName: "Bob Smith", login: "bobsmith" };
const CAROL: CollabCommentMember = { accountId: "carol", displayName: "Carol Diaz", login: "carol" };
const MEMBERS = [CAROL, ALICE, BOB];

describe("finding a mention being typed", () => {
  it.each([
    ["Hi @bo", 6, { start: 3, query: "bo" }],
    ["@", 1, { start: 0, query: "" }],
    ["Hi @Bob Smith", 13, { start: 3, query: "Bob Smith" }],
    ["(@car", 5, { start: 1, query: "car" }],
  ])("reads %j at %i", (text, caret, expected) => {
    expect(mentionQuery(text, caret)).toEqual(expected);
  });

  it.each([
    ["mail me at a@b", 14],
    ["Hi @bob\nthere", 13],
    ["Hi @ bob", 8],
    ["Hi @@bob", 8],
    ["no at sign", 5],
  ])("ignores %j at %i", (text, caret) => {
    expect(mentionQuery(text, caret)).toBeNull();
  });
});

describe("matching project members", () => {
  it("offers everyone but the writer, best matches first", () => {
    expect(matchMembers(MEMBERS, "", "alice").map((member) => member.displayName)).toEqual(["Bob Smith", "Carol Diaz"]);
    expect(matchMembers(MEMBERS, "s", "alice").map((member) => member.displayName)).toEqual(["Bob Smith"]);
    expect(matchMembers(MEMBERS, "bobs", "alice").map((member) => member.displayName)).toEqual(["Bob Smith"]);
    expect(matchMembers(MEMBERS, "CAR", "alice").map((member) => member.displayName)).toEqual(["Carol Diaz"]);
    expect(matchMembers(MEMBERS, "ch", null).map((member) => member.displayName)).toEqual(["Alice Chen"]);
    expect(matchMembers(MEMBERS, "zz", "alice")).toEqual([]);
    expect(matchMembers(MEMBERS, "Bob ", "alice").map((member) => member.displayName)).toEqual(["Bob Smith"]);
    expect(matchMembers(MEMBERS, "Carol Diaz ", "alice")).toEqual([]);
  });

  it("matches inside names and logins, and members without a login by name only", () => {
    const dana: CollabCommentMember = { accountId: "dana", displayName: "Dana Ito", login: null };
    expect(matchMembers([...MEMBERS, dana], "mit", null).map((member) => member.displayName)).toEqual(["Bob Smith"]);
    expect(matchMembers([...MEMBERS, dana], "-ch", null).map((member) => member.displayName)).toEqual(["Alice Chen"]);
    expect(matchMembers([...MEMBERS, dana], "it", null).map((member) => member.displayName)).toEqual([
      "Dana Ito",
      "Bob Smith",
    ]);
    expect(matchMembers([dana, { ...BOB, displayName: "  " }], "", null)).toEqual([dana]);
  });
});

describe("inserting a mention", () => {
  it("replaces the typed handle with the full name and a space", () => {
    expect(insertMention("Hi @bo", 3, 6, BOB)).toEqual({ text: "Hi @Bob Smith ", caret: 14 });
  });

  it("does not double the space before text that follows", () => {
    expect(insertMention("Hi @bo and you", 3, 6, BOB)).toEqual({ text: "Hi @Bob Smith and you", caret: 14 });
  });
});

describe("showing mentions in a comment", () => {
  it("splits out the names that were mentioned", () => {
    expect(mentionSegments("Thanks @Bob Smith and @carol!", [BOB, CAROL])).toEqual([
      { text: "Thanks ", mention: false },
      { text: "@Bob Smith", mention: true },
      { text: " and ", mention: false },
      { text: "@carol", mention: true },
      { text: "!", mention: false },
    ]);
  });

  it("leaves addresses, unknown names and longer words alone", () => {
    expect(mentionSegments("Mail a@Bob Smith or @Bobby or @dave", [BOB])).toEqual([
      { text: "Mail a@Bob Smith or @Bobby or @dave", mention: false },
    ]);
    expect(mentionSegments("Plain text", [])).toEqual([{ text: "Plain text", mention: false }]);
  });

  it("marks a mention at the very start and skips a name that runs on into a longer word", () => {
    const dana: CollabCommentMember = { accountId: "dana", displayName: "Dana", login: null };
    expect(mentionSegments("@Dana see @carolyn and @carol", [dana, CAROL])).toEqual([
      { text: "@Dana", mention: true },
      { text: " see @carolyn and ", mention: false },
      { text: "@carol", mention: true },
    ]);
    expect(mentionSegments("", [dana])).toEqual([{ text: "", mention: false }]);
  });
});
