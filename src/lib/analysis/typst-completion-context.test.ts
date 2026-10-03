import { describe, expect, it } from "vitest";
import {
  typstCompletionTrigger,
  typstCursorContext,
} from "./typst-completion-context";

const TINYMIST_TRIGGERS = ["#", "(", "<", ",", ".", ":", "/", "\"", "@"];

function trigger(before: string, explicit = false) {
  return typstCompletionTrigger(before, explicit, TINYMIST_TRIGGERS);
}

describe("typstCursorContext", () => {
  it.each([
    ["Plain prose", "markup"],
    ["#calc.", "code"],
    ["#text(fill: ", "code"],
    ["#let x = ", "code"],
    ["#let x = 1\nprose", "markup"],
    ["$ alpha + ", "math"],
    ["$x$ prose", "markup"],
    ["#box[inner ", "markup"],
    ["#{\n  let x = ", "code"],
    ["#if x {\n  [content ", "markup"],
    ["See #x. Next", "markup"],
    ["#str(x).", "code"],
  ])("reads %j as %s", (before, mode) => {
    expect(typstCursorContext(before).mode).toBe(mode);
  });

  it("knows strings, comments and raw text", () => {
    expect(typstCursorContext("#image(\"fig").inString).toBe(true);
    expect(typstCursorContext("// a note").inComment).toBe(true);
    expect(typstCursorContext("/* open").inComment).toBe(true);
    expect(typstCursorContext("see https://typst.app").inComment).toBe(false);
    expect(typstCursorContext("`#raw").inRaw).toBe(true);
    expect(typstCursorContext("```\n#code").inRaw).toBe(true);
    expect(typstCursorContext("`done` #x").inRaw).toBe(false);
  });

  it("knows when the cursor sits in an argument list", () => {
    expect(typstCursorContext("#text(red, ").inArguments).toBe(true);
    expect(typstCursorContext("#text(red)[x, ").inArguments).toBe(false);
  });
});

describe("typstCompletionTrigger", () => {
  it("opens after # in markup with the trigger character", () => {
    expect(trigger("Hello #")).toEqual({
      triggerKind: 2,
      triggerCharacter: "#",
    });
    expect(trigger("Hello #ima")).toEqual({ triggerKind: 1 });
    expect(trigger("Price \\#")).toBeNull();
  });

  it("opens for field access in code but not at the end of a sentence", () => {
    expect(trigger("#calc.")).toEqual({
      triggerKind: 2,
      triggerCharacter: ".",
    });
    expect(trigger("#calc.ab")).toEqual({ triggerKind: 1 });
    expect(trigger("#let x = sym.")).toEqual({
      triggerKind: 2,
      triggerCharacter: ".",
    });
    expect(trigger("The end.")).toBeNull();
    expect(trigger("#v(1.")).toBeNull();
  });

  it("opens on ( and , inside argument lists", () => {
    expect(trigger("#text(")).toEqual({
      triggerKind: 2,
      triggerCharacter: "(",
    });
    expect(trigger("#text(red,")).toEqual({
      triggerKind: 2,
      triggerCharacter: ",",
    });
    expect(trigger("Apples, pears,")).toBeNull();
    expect(trigger("Note (aside")).toBeNull();
  });

  it("opens on : after a named argument and import items", () => {
    expect(trigger("#text(fill:")).toEqual({
      triggerKind: 2,
      triggerCharacter: ":",
    });
    expect(trigger("#import \"util.typ\":")).toEqual({
      triggerKind: 2,
      triggerCharacter: ":",
    });
    expect(trigger("Note:")).toBeNull();
  });

  it("opens inside path strings of path-taking calls", () => {
    expect(trigger("#image(\"")).toEqual({
      triggerKind: 2,
      triggerCharacter: "\"",
    });
    expect(trigger("#include \"")).toEqual({
      triggerKind: 2,
      triggerCharacter: "\"",
    });
    expect(trigger("#image(\"figures/")).toEqual({
      triggerKind: 2,
      triggerCharacter: "/",
    });
    expect(trigger("#import \"@pre")).toEqual({ triggerKind: 1 });
    expect(trigger("#text(\"plain")).toBeNull();
  });

  it("opens for labels and references", () => {
    expect(trigger("See @")).toEqual({
      triggerKind: 2,
      triggerCharacter: "@",
    });
    expect(trigger("See @int")).toEqual({ triggerKind: 1 });
    expect(trigger("= Intro <")).toEqual({
      triggerKind: 2,
      triggerCharacter: "<",
    });
    expect(trigger("mail me@example")).toBeNull();
  });

  it("opens in math after a letter", () => {
    expect(trigger("$ al")).toEqual({ triggerKind: 1 });
    expect(trigger("$ arrow.")).toEqual({
      triggerKind: 2,
      triggerCharacter: ".",
    });
    expect(trigger("$ 1 + ")).toBeNull();
  });

  it("stays quiet in comments and raw text unless asked", () => {
    expect(trigger("// #text(")).toBeNull();
    expect(trigger("`#text(")).toBeNull();
    expect(trigger("// #text(", true)).toEqual({ triggerKind: 1 });
  });

  it("reports an explicit request as invoked", () => {
    expect(trigger("Hello #", true)).toEqual({ triggerKind: 1 });
    expect(trigger("plain words", true)).toEqual({ triggerKind: 1 });
  });

  it("opens field access after calls, content blocks and any identifier tail", () => {
    const dot = { triggerKind: 2, triggerCharacter: "." };
    expect(trigger("#f(x).")).toEqual(dot);
    expect(trigger("#f(x)[a].")).toEqual(dot);
    expect(trigger("#let x = 𝒜.")).toEqual(dot);
    expect(trigger("#let x = 1a-.")).toEqual(dot);
    expect(trigger("#let x = _1.")).toEqual(dot);
    expect(trigger("#let x = 12-3.")).toBeNull();
    expect(trigger("#let x = (1 + 2) * 3.")).toBeNull();
    expect(trigger("#let x = \uD835.")).toBeNull();
  });

  it("opens on : only after an identifier inside arguments", () => {
    const colon = { triggerKind: 2, triggerCharacter: ":" };
    expect(trigger("#f(𝒜:")).toEqual(colon);
    expect(trigger("#f(1a:")).toEqual(colon);
    expect(trigger("#f(1:")).toBeNull();
    expect(trigger("#f(a :")).toBeNull();
    expect(trigger("#let d = (a:")).toEqual(colon);
    expect(trigger("#{ a:")).toBeNull();
  });

  it("recognises every path-taking call and keyword", () => {
    for (const call of ["image", "read", "json", "yaml", "toml", "csv", "xml", "cbor", "bibliography", "plugin"]) {
      expect(trigger(`#${call}(  "dir/`)).toEqual({ triggerKind: 2, triggerCharacter: "/" });
    }
    expect(trigger("#import  \"a/")).toEqual({ triggerKind: 2, triggerCharacter: "/" });
    expect(trigger("#include\"a/")).toBeNull();
    expect(trigger("#myimage(\"a/")).toBeNull();
    expect(trigger("#reimport \"a/")).toBeNull();
    expect(trigger("#text(\"plain", true)).toEqual({ triggerKind: 1 });
  });

  it("falls back to an invoked request for characters the server does not list", () => {
    expect(typstCompletionTrigger("#calc.", false, ["#"])).toEqual({
      triggerKind: 1,
    });
  });
});
