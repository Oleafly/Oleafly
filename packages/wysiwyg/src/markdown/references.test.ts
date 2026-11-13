// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { markdownReferences } from "./references";

describe("markdownReferences", () => {
  it("finds images, links and fences with their source lines, counting the front matter", () => {
    const source = [
      "---",
      "title: Lab",
      "---",
      "",
      "Intro with ![plot](assets/plot.png) and [the data](<assets/my data.csv>).",
      "",
      "- item",
      "",
      "  ```csv",
      "  path: assets/table.csv",
      "  ```",
      "",
      "> ![talk](assets/talk.mp4)",
    ].join("\n");
    expect(markdownReferences(source)).toEqual([
      { kind: "image", target: "assets/plot.png", line: 5 },
      { kind: "link", target: "assets/my%20data.csv", line: 5 },
      { kind: "fence", info: "csv", content: "path: assets/table.csv\n", line: 9 },
      { kind: "image", target: "assets/talk.mp4", line: 13 },
    ]);
  });

  it("skips code and inline code that only look like references", () => {
    const source = "`![x](assets/a.png)`\n\n    ![y](assets/b.png)\n\n![z](assets/c.png)\n";
    expect(markdownReferences(source)).toEqual([{ kind: "image", target: "assets/c.png", line: 5 }]);
  });
});
