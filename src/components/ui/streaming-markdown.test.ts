import { describe, expect, it } from "vitest";
import {
  partitionStreamingMarkdown,
  updateStreamingMarkdown,
} from "./streaming-markdown";

describe("partitionStreamingMarkdown", () => {
  it("keeps settled blocks stable while only the tail grows", () => {
    const first = partitionStreamingMarkdown("First paragraph.\n\nSecond");
    const second = partitionStreamingMarkdown("First paragraph.\n\nSecond paragraph.");

    expect(first.settled).toEqual(second.settled);
    expect(first.settled).toEqual([
      { key: "0", source: "First paragraph.\n\n" },
    ]);
    expect(first.tail).toEqual({ raw: false, source: "Second" });
    expect(second.tail).toEqual({ raw: false, source: "Second paragraph." });
  });

  it("reuses settled block objects across append-only updates", () => {
    const first = updateStreamingMarkdown(null, "First paragraph.\n\nSecond");
    const second = updateStreamingMarkdown(first, "First paragraph.\n\nSecond paragraph.\n\nThird");

    expect(second.settled[0]).toBe(first.settled[0]);
    expect(second.settled.map((block) => block.source)).toEqual([
      "First paragraph.\n\n",
      "Second paragraph.\n\n",
    ]);
    expect(second.tail).toEqual({ raw: false, source: "Third" });
  });

  it("rebuilds safely when a retry rewinds or replaces streamed text", () => {
    const first = updateStreamingMarkdown(null, "Old paragraph.\n\nOld tail");
    const retried = updateStreamingMarkdown(first, "Replacement **answer**");

    expect(retried.source).toBe("Replacement **answer**");
    expect(retried.settled).toEqual([]);
    expect(retried.tail).toEqual({ raw: false, source: "Replacement **answer**" });
  });

  it.each([
    ["inline math", "Text $x^2"],
    ["display math", "Text\n\n$$\n\\frac{1}{2}"],
    ["backtick fence", "Text\n\n```ts\nconst x = 1;"],
    ["tilde fence", "Text\n\n~~~mermaid\nflowchart TD"],
  ])("marks an unclosed %s block as raw", (_label, source) => {
    const result = partitionStreamingMarkdown(source);

    expect(result.tail).toEqual({ raw: true, source: result.tail.source });
    expect(result.tail.source).toContain(source.includes("\n\n") ? source.split("\n\n")[1] : source);
  });

  it.each([
    ["quoted Mermaid", "> ```mermaid\n> flowchart TD\n>   A --> B"],
    ["listed Mermaid", "- ```mermaid\n  flowchart TD\n    A --> B"],
    ["nested quoted list", "> - ```mermaid\n>   flowchart TD"],
    ["quoted fake close", "```mermaid\nflowchart TD\n> ```"],
  ])("keeps an unfinished %s fence raw", (_label, source) => {
    expect(partitionStreamingMarkdown(source).tail.raw).toBe(true);
  });

  it.each([
    ["three-dollar flow", "$$$\nx^2"],
    ["mid-line pseudo-close", "$$\nx^2\nnot a close $$"],
    ["quoted fake close", "$$\nx^2\n> $$"],
  ])("keeps unfinished %s math raw", (_label, source) => {
    expect(partitionStreamingMarkdown(source).tail.raw).toBe(true);
  });

  it("accepts a line-level flow-math close with at least the opening run", () => {
    expect(partitionStreamingMarkdown("$$$\nx^2\n$$$$").tail.raw).toBe(false);
  });

  it.each([
    "> ```mermaid\n> flowchart TD\n>   A --> B\n> ```",
    "- ```mermaid\n  flowchart TD\n    A --> B\n  ```",
  ])("accepts a closed container Mermaid fence in %j", (source) => {
    expect(partitionStreamingMarkdown(source).tail.raw).toBe(false);
  });

  it.each([
    "Price: $20",
    String.raw`Escaped \$x`,
    "Inline `$x` code",
    "```text\n$x\n```",
  ])("does not mistake protected dollars for unfinished math in %j", (source) => {
    expect(partitionStreamingMarkdown(source).tail.raw).toBe(false);
  });

  it("promotes math and fences as soon as their closing delimiters arrive", () => {
    expect(partitionStreamingMarkdown("Text $x^2$").tail.raw).toBe(false);
    expect(partitionStreamingMarkdown("$$\n\\frac{1}{2}\n$$").tail.raw).toBe(false);
    expect(partitionStreamingMarkdown("```ts\nconst x = 1;\n```").tail.raw).toBe(false);
    expect(partitionStreamingMarkdown("~~~mermaid\nflowchart TD\n~~~").tail.raw).toBe(false);
  });

  it("keeps list, quote, table, math, and fenced content together", () => {
    const source = [
      "- one",
      "- two",
      "",
      "> quoted",
      "> line",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "$$",
      "x^2",
      "$$",
      "",
      "```ts",
      "const x = 1;",
      "```",
    ].join("\n");
    const result = partitionStreamingMarkdown(source);

    expect(result.settled).toEqual([]);
    expect(result.tail).toEqual({ raw: false, source });
  });

  it.each([
    "1. First\n\n   continuation\n\n2. Second",
    "[guide][g]\n\n[g]: https://example.com",
  ])("keeps cross-block Markdown in one document for %j", (source) => {
    const result = partitionStreamingMarkdown(source);

    expect(result.settled).toEqual([]);
    expect(result.tail.source).toBe(source);
  });

  it("degrades only a pathological growing tail to raw text", () => {
    const result = partitionStreamingMarkdown(`Settled.\n\n${"x".repeat(24_001)}`);

    expect(result.settled).toHaveLength(1);
    expect(result.tail.raw).toBe(true);
  });

  it("freezes the last rich snapshot and appends raw overflow without flicker", () => {
    const rich = `**Ready** ${"x".repeat(5_980)}`;
    const first = updateStreamingMarkdown(null, rich);
    const second = updateStreamingMarkdown(first, `${rich}${"y".repeat(40)}`);
    const third = updateStreamingMarkdown(second, `${rich}${"y".repeat(80)}`);

    expect(first.tail.raw).toBe(false);
    expect(second.settled.at(-1)?.source).toBe(rich);
    expect(second.tail).toEqual({ raw: true, source: "y".repeat(40) });
    expect(third.settled.at(-1)).toBe(second.settled.at(-1));
    expect(third.tail).toEqual({ raw: true, source: "y".repeat(80) });
  });

  it("settles ordinary prose before a cross-block-sensitive list tail", () => {
    const result = partitionStreamingMarkdown(
      "Introduction.\n\n- First\n\n  continuation",
    );

    expect(result.settled.map((block) => block.source)).toEqual(["Introduction.\n\n"]);
    expect(result.tail.source).toBe("- First\n\n  continuation");
  });
});
