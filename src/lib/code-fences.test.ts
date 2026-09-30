import { describe, expect, it } from "vitest";
import { lineInsideFence, scanFences } from "@/lib/code-fences";

// One mark per line: "c" for a line of a fenced code block, "." otherwise.
const marks = (markdown: string) => {
  const fences = scanFences(markdown);
  let lineFrom = 0;
  return markdown
    .split("\n")
    .map((line) => {
      const inside = lineInsideFence(fences, lineFrom, lineFrom + line.length);
      lineFrom += line.length + 1;
      return inside ? "c" : ".";
    })
    .join("");
};

describe("scanFences", () => {
  it("finds backtick and tilde fences of three or more", () => {
    expect(marks("a\n```\nb\n```\nc")).toBe(".ccc.");
    expect(marks("a\n~~~~\nb\n~~~~\nc")).toBe(".ccc.");
    expect(marks("``\nb\n``")).toBe("...");
    expect(marks("a\r\n```sh\r\nb\r\n```\r\nc")).toBe(".ccc.");
    expect(marks("a\r\n~~~\nb\r\n~~~\nc")).toBe(".ccc.");
  });

  it("accepts an info string, but no backtick in a backtick fence's info string", () => {
    expect(marks("```bash title=x\nb\n```")).toBe("ccc");
    expect(marks("```latex``` is the class.\nb")).toBe("..");
    expect(marks("~~~ a`b\nc\n~~~")).toBe("ccc");
  });

  it("closes only on the same character, at least as long, with nothing after", () => {
    expect(marks("````\nb\n```\n````\nc")).toBe("cccc.");
    expect(marks("```\nb\n~~~\n``` not yet\n```   \nc")).toBe("ccccc.");
  });

  it("runs an unclosed fence to the end of the text", () => {
    expect(marks("a\n```sh\nb\n\nc")).toBe(".cccc");
    expect(marks("```")).toBe("c");
  });

  it("allows up to three spaces of indent, counted from the list item that holds the fence", () => {
    expect(marks("   ```\nb\n   ```\nc")).toBe("ccc.");
    expect(marks("text\n\n    ```\nb\n    ```")).toBe(".....");
    expect(marks("1. a\n\n    ```\n    b\n    ```\nc")).toBe("..ccc.");
    expect(marks("1.  Run:\n    ```sh\n    make\n    ```\n2.  Done")).toBe(".ccc.");
    expect(marks("- a\n\n      ```\n      b")).toBe("....");
    expect(marks("1. a\n   - b\n\n     ```\n     c\n     ```")).toBe("...ccc");
    expect(marks("1. Run\n   ```sh\n\n   make\n   ```\n2. Compile")).toBe(".cccc.");
    // A fence under an outer item, after a nested one.
    expect(marks("*   a\n    *   b\n    ```sh\n    cd x\n    ```\n*   c")).toBe("..ccc.");
    expect(marks("10. a\n    - b\n    ```\n    x\n    ```")).toBe("..ccc");
    // Text back at the margin ends the list, so four spaces are indented code.
    expect(marks("1. a\n\ntext\n\n    ```\n    b\n    ```")).toBe(".......");
  });

  it("finds a fence that starts a list item, or sits in a blockquote", () => {
    expect(marks("- ```sh\n  make\n  ```\nafter")).toBe("ccc.");
    expect(marks("> ```\n> b\n> ```\nc")).toBe("ccc.");
    expect(marks(">```\n>b\n>```")).toBe("ccc");
    expect(marks("> > ~~~\n> > b\n> > ~~~")).toBe("ccc");
    // Inside a top-level fence a ">" line is code, not a new blockquote.
    expect(marks("```\n> b\n```")).toBe("ccc");
    expect(marks("para\n```\nb\n```")).toBe(".ccc");
  });
});
