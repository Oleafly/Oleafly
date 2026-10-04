// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { clearHighlightCache, HighlightedCode, isHighlightCached } from "./code-highlighter";

const SAMPLES: Array<[string, string]> = [
  ["c", "int main(void) { return 0; }"],
  ["cpp", "int main() { return 0; }"],
  ["csharp", "class A { int x = 1; }"],
  ["css", "a { color: red; }"],
  ["diff", "+added line"],
  ["go", "func main() { return }"],
  ["html", "<div class=\"x\">text</div>"],
  ["java", "class A { int x = 1; }"],
  ["json", "{\"key\": 1}"],
  ["kotlin", "fun main() { val x = 1 }"],
  ["python", "def f():\n    return 1"],
  ["ruby", "def f\n  1\nend"],
  ["rust", "fn main() { let x = 1; }"],
  ["sass", "$color: red"],
  ["shell", "echo \"hello\""],
  ["sql", "SELECT 1 FROM t"],
  ["toml", "key = \"value\""],
  ["xml", "<a href=\"x\">y</a>"],
  ["yaml", "key: value"],
  ["bash", "if true; then echo 1; fi"],
];

beforeEach(() => {
  clearHighlightCache();
});

describe("code highlighting languages", () => {
  it.each(SAMPLES)("colors %s code and keeps its text", async (language, source) => {
    const { container } = render(<HighlightedCode language={language} source={source} />);

    await waitFor(() => expect(container.querySelector("code span[class*='tok-']")).not.toBeNull());

    expect(container.querySelector("code")?.textContent).toBe(source);
    expect(container.querySelector("code")?.getAttribute("data-language")).toBe(language);
    expect(isHighlightCached(language, source)).toBe(true);
  });

  it("shows unknown languages and unlabelled code as plain text", async () => {
    const { container, rerender } = render(<HighlightedCode language="brainfuck" source="+++." />);
    rerender(<HighlightedCode source="plain text" />);

    expect(container.querySelector("code")?.textContent).toBe("plain text");
    expect(container.querySelector("code span")).toBeNull();
    expect(isHighlightCached(undefined, "plain text")).toBe(false);
  });

  it("reuses highlighted tokens from the cache on the next render", async () => {
    const first = render(<HighlightedCode language="py" source="x = 1" />);
    await waitFor(() => expect(first.container.querySelector("span[class*='tok-']")).not.toBeNull());
    first.unmount();

    const second = render(<HighlightedCode language="py" source="x = 1" />);

    expect(second.container.querySelector("span[class*='tok-']")).not.toBeNull();
  });
});
