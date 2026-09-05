// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComposerHighlight } from "./ComposerHighlight";

const PATHS = ["main.tex", "sections"];

function layer() {
  return screen.getByTestId("ai-composer-highlight");
}

function tokenSpans(kind: string) {
  return Array.from(layer().querySelectorAll(`[data-token="${kind}"]`));
}

describe("ComposerHighlight", () => {
  it("mirrors plain text with no colored token", () => {
    render(
      <ComposerHighlight text="just prose" skillIds={["proof-review"]} paths={PATHS} />,
    );

    expect(layer().textContent).toContain("just prose");
    expect(tokenSpans("skill")).toHaveLength(0);
    expect(tokenSpans("mention")).toHaveLength(0);
  });

  it("tints a leading skill token blue", () => {
    render(
      <ComposerHighlight
        text="/proof-review check table 2"
        skillIds={["proof-review"]}
        paths={PATHS}
      />,
    );

    const [skill] = tokenSpans("skill");
    expect(skill.textContent).toBe("/proof-review");
    expect(skill.className).toContain("bg-blue-500/15");
    expect(skill.className).toContain("dark:text-blue-300");
  });

  it("tints every resolvable mention teal and leaves unknown paths plain", () => {
    render(
      <ComposerHighlight
        text="read @main.tex and @nowhere.tex and @sections/"
        skillIds={[]}
        paths={PATHS}
      />,
    );

    const mentions = tokenSpans("mention");
    expect(mentions.map((span) => span.textContent)).toEqual(["@main.tex", "@sections/"]);
    for (const mention of mentions) {
      expect(mention.className).toContain("bg-teal-500/15");
      expect(mention.className).toContain("dark:text-teal-300");
    }
    expect(layer().textContent).toContain("@nowhere.tex");
  });

  it("colors a skill and a mention in the same line with different tints", () => {
    render(
      <ComposerHighlight
        text="/proof-review look at @main.tex"
        skillIds={["proof-review"]}
        paths={PATHS}
      />,
    );

    const skill = tokenSpans("skill")[0];
    const mention = tokenSpans("mention")[0];
    expect(skill.className).not.toBe(mention.className);
    expect(layer().textContent).toContain("/proof-review look at @main.tex");
  });

  it("stays out of the accessibility tree and out of pointer events", () => {
    render(<ComposerHighlight text="hello" skillIds={[]} paths={PATHS} />);

    expect(layer()).toHaveAttribute("aria-hidden", "true");
    expect(layer().className).toContain("pointer-events-none");
    expect(layer().className).toContain("whitespace-pre-wrap");
  });
});
