import { describe, expect, it } from "vitest";
import { type FenceRole, markdownLines } from "@/lib/markdown-fences";

// One role per line: "." prose, "o" opener, "c" code, "x" closer.
const MARKS: Record<FenceRole, string> = { open: "o", code: "c", close: "x" };
const roles = (markdown: string) =>
  markdownLines(markdown)
    .map((line) => (line.fence ? MARKS[line.fence] : "."))
    .join("");

describe("markdownLines", () => {
  it("keeps every line and its ending so the text can be rebuilt", () => {
    for (const text of ["", "a", "a\n", "a\r\nb\nc", "a\r\n```\r\nb\r\n```\r\n", "a\r"]) {
      expect(
        markdownLines(text)
          .map((line) => line.text + line.eol)
          .join(""),
      ).toBe(text);
    }
    expect(markdownLines("a\r\nb\nc").map((line) => [line.text, line.eol])).toEqual([
      ["a", "\r\n"],
      ["b", "\n"],
      ["c", ""],
    ]);
  });

  it("finds backtick and tilde fences of three or more", () => {
    expect(roles("a\n```\nb\n```\nc")).toBe(".ocx.");
    expect(roles("a\n~~~~\nb\n~~~~\nc")).toBe(".ocx.");
    expect(roles("``\nb\n``")).toBe("...");
  });

  it("reads CRLF and lone LF line endings the same way", () => {
    expect(roles("a\r\n```sh\r\nb\r\n```\r\nc")).toBe(".ocx.");
    expect(roles("a\r\n~~~\nb\r\n~~~\nc")).toBe(".ocx.");
  });

  it("accepts an info string, but no backtick in a backtick fence's info string", () => {
    expect(roles("```bash title=x\nb\n```")).toBe("ocx");
    expect(roles("```latex``` is the class.\nPlan:")).toBe("..");
    expect(roles("~~~ a`b\nc\n~~~")).toBe("ocx");
  });

  it("closes only on the same character, at least as long, with nothing after", () => {
    expect(roles("````\nb\n```\n````\nc")).toBe("occx.");
    expect(roles("```\nb\n~~~\n``` not yet\n```   \nc")).toBe("occcx.");
  });

  it("allows up to three spaces of indent, counted from the list item that holds the fence", () => {
    expect(roles("   ```\nb\n   ```\nc")).toBe("ocx.");
    expect(roles("text\n\n    ```\nb\n    ```")).toBe(".....");
    expect(roles("\t```\nb")).toBe("..");
    // A list item's content starts after "1. ", so four spaces are one more.
    expect(roles("1. a\n\n    ```\n    b\n    ```\nc")).toBe("..ocx.");
    expect(roles("1. a\n\t```\n\tb\n\t```")).toBe(".ocx");
    expect(roles("- a\n\n      ```\n      b")).toBe("....");
    expect(roles("1. a\n   - b\n\n     ```\n     c\n     ```")).toBe("...ocx");
  });

  it("runs an unclosed fence to the end of the text", () => {
    expect(roles("a\n```sh\nb\n\nc")).toBe(".occc");
    expect(roles("```")).toBe("o");
  });

  it("ends an unclosed fence with the list item that holds it", () => {
    expect(roles("1. Run\n   ```sh\n   make\n2. Compile\n   more")).toBe(".oc..");
    expect(roles("1. Run\n   ```sh\n\n   make\n   ```\n2. Compile")).toBe(".occx.");
  });

  it("finds a fence that starts a list item", () => {
    expect(roles("- ```sh\n  make\n  ```\nafter")).toBe("ocx.");
    expect(roles("1. ```\n   a\nb")).toBe("oc.");
  });

  it("finds fences inside blockquotes and ends them with the blockquote", () => {
    expect(roles("> ```\n> b\n> ```\nc")).toBe("ocx.");
    expect(roles(">```\n>b\n>```")).toBe("ocx");
    expect(roles("> > ~~~\n> > b\n> > ~~~")).toBe("ocx");
    expect(roles("> ```\n> b\n\nc")).toBe("oc..");
    expect(roles("> ```\n> b\nc")).toBe("oc.");
    // Inside a top-level fence a ">" line is code, not a new blockquote.
    expect(roles("```\n> b\n```")).toBe("ocx");
  });

  it("lets a fence interrupt a paragraph and keeps a list item open across a lazy line", () => {
    expect(roles("para\n```\nb\n```")).toBe(".ocx");
    expect(roles("1. a\nlazy line\n     ```\n     b")).toBe("..oc");
  });

  it("finds fences in blockquotes inside list items, and after a tab", () => {
    expect(roles("1. > ```\n   > b\n   > ```\nc")).toBe("ocx.");
    expect(roles("-\t```\n\tb\n\t```")).toBe("ocx");
  });

  // micromark, behind the chat's Markdown renderer, reads these the same way.
  it("starts a list in the middle of a paragraph only with a bullet or 1.", () => {
    expect(roles("text\n10. ```\nb")).toBe("...");
    expect(roles("text\n1. ```\nb")).toBe(".o.");
    expect(roles("text\n- ```")).toBe(".o");
    // A new item in a list that is already open may have any number.
    expect(roles("9. a\n10. ```\n    b")).toBe(".oc");
    // Indented code stays open across a blank line.
    expect(roles("    code\n\n10. ```")).toBe("...");
  });

  it("applies that rule to every list marker the line opens", () => {
    expect(roles("text\n> 2) ```\n>    b")).toBe("...");
    expect(roles("Run this:\n> 2) ```sh\n>    ls /x\n\nDone.")).toBe(".....");
    expect(roles("text\n> > 2) ```\n> >    b")).toBe("...");
    expect(roles("text\n- 2) ```\n       b")).toBe("...");
    expect(roles("text\n> 1. ```\n>    b")).toBe(".oc");
    expect(roles("text\n> - ```\n>   b")).toBe(".oc");
    // A line that leaves a container behind is not held to it.
    expect(roles("> text\n2) ```\nb")).toBe(".o.");
    expect(roles("- text\n10. ```\n    b")).toBe(".oc");
  });

  it("ends a list item that began empty once a blank line follows it", () => {
    expect(roles("-\n    ```\n    b")).toBe(".oc");
    expect(roles("-\n\n    ```\n    b")).toBe("....");
  });
});
