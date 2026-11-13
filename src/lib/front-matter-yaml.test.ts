import { describe, expect, it } from "vitest";
import { setScalar } from "./front-matter-yaml";

function front(...lines: string[]): string {
  return ["---", ...lines, "---", "", "# Intro", "", "Body.", ""].join("\n");
}

describe("single front matter keys", () => {
  it("replaces a value in place and keeps its quotes", () => {
    expect(setScalar(front("title: 'Old'", "icon: x"), "title", "It's new")).toBe(front("title: 'It''s new'", "icon: x"));
    expect(setScalar(front('title: "Old"'), "title", "New")).toBe(front('title: "New"'));
  });

  it("fills a key that has no value yet, and edits the last of two", () => {
    expect(setScalar(front("icon:", "title: T"), "icon", "🧪")).toBe(front("icon: 🧪", "title: T"));
    expect(setScalar(front("title: A", "title: B"), "title", "C")).toBe(front("title: A", "title: C"));
  });

  it("adds a missing key at the end of the front matter or starts one", () => {
    expect(setScalar(front("title: T"), "icon", "lucide:flask")).toBe(front("title: T", "icon: lucide:flask"));
    expect(setScalar("Body.\n", "title", "Notes")).toBe("---\ntitle: Notes\n---\n\nBody.\n");
    expect(setScalar("﻿Body.\r\n", "title", "Notes")).toBe("﻿---\r\ntitle: Notes\r\n---\r\n\r\nBody.\r\n");
  });

  it("quotes values YAML would read as something else", () => {
    expect(setScalar(front("title: T"), "title", "yes")).toBe(front('title: "yes"'));
    expect(setScalar(front("title: T"), "title", " padded")).toBe(front('title: " padded"'));
    expect(setScalar(front("title: T"), "title", "")).toBe(front('title: ""'));
    expect(setScalar(front("title: T"), "title", "3.5")).toBe(front('title: "3.5"'));
    expect(setScalar(front("title: T"), "title", "Run 3: results")).toBe(front('title: "Run 3: results"'));
  });

  it("removes a key and leaves the text alone when the key is absent", () => {
    expect(setScalar(front("title: T", "icon: x"), "icon", null)).toBe(front("title: T"));
    expect(setScalar(front("title: T"), "icon", null)).toBe(front("title: T"));
    expect(setScalar("Body.\n", "icon", null)).toBe("Body.\n");
  });

  it("edits a line YAML cannot read and leaves lists and unclosed front matter untouched", () => {
    expect(setScalar(front("title: Run 3: results", "id: x"), "title", "Run 4")).toBe(front("title: Run 4", "id: x"));
    const list = front("icon: [a, b]");
    expect(setScalar(list, "icon", "🧪")).toBe(list);
    const unclosedList = front("title: [Mask");
    expect(setScalar(unclosedList, "title", "Mask ratios")).toBe(unclosedList);
    const unclosed = "---\ntitle: T\n\nBody.\n";
    expect(setScalar(unclosed, "title", "New")).toBe(unclosed);
  });
});
