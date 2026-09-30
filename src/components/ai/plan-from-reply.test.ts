import { describe, expect, it } from "vitest";
import { lastNumberedList, planTodos, replyEndsWithQuestion } from "./plan-from-reply";

describe("lastNumberedList", () => {
  it("reads the items of a numbered list", () => {
    expect(
      lastNumberedList(
        "Here is the plan:\n1. Rename the intro section in main.tex\n2. Tighten the abstract in main.tex\n\nApprove it and I will start.",
      ),
    ).toEqual(["Rename the intro section in main.tex", "Tighten the abstract in main.tex"]);
    expect(lastNumberedList("1. Rename the intro\n2. Compile")).toEqual([
      "Rename the intro",
      "Compile",
    ]);
  });

  it("accepts the 1) style and a single item", () => {
    expect(lastNumberedList("Plan:\n1) Fix the title\n2) Compile")).toEqual([
      "Fix the title",
      "Compile",
    ]);
    expect(lastNumberedList("Plan:\n1. Fix the title")).toEqual(["Fix the title"]);
  });

  it("reads CRLF line endings", () => {
    expect(lastNumberedList("Plan:\r\n1. Rename the intro\r\n2. Compile\r\n")).toEqual([
      "Rename the intro",
      "Compile",
    ]);
    expect(
      lastNumberedList("Plan:\r\n\r\n1. Rename the intro\r\n   Change the heading.\r\n\r\n2. Compile\r\n"),
    ).toEqual(["Rename the intro: Change the heading.", "Compile"]);
  });

  it("reads a list that numbers every item 1.", () => {
    expect(lastNumberedList("Plan:\n1. Rename the intro\n1. Tighten the abstract\n1. Compile")).toEqual([
      "Rename the intro",
      "Tighten the abstract",
      "Compile",
    ]);
    expect(
      lastNumberedList("Plan:\n1. Rename the intro\n   Change the heading.\n\n1. Compile\n   Check the PDF."),
    ).toEqual(["Rename the intro: Change the heading.", "Compile: Check the PDF."]);
  });

  it("keeps one list across blank lines between items", () => {
    expect(lastNumberedList("Plan:\n1. Rename the intro\n\n2. Tighten the abstract")).toEqual([
      "Rename the intro",
      "Tighten the abstract",
    ]);
  });

  it("folds the description lines under an item into it", () => {
    // Indented under the item.
    expect(
      lastNumberedList("1. Rename the intro\n   Change the heading to Background.\n2. Compile"),
    ).toEqual(["Rename the intro: Change the heading to Background.", "Compile"]);
    // Straight under the item without an indent: Markdown shows it inside the item.
    expect(
      lastNumberedList(
        "Here is the plan:\n\n1. **Rename the intro**\nChange the heading to Background.\n\n2. **Tighten the abstract**\nCut it to about 150 words.",
      ),
    ).toEqual([
      "Rename the intro: Change the heading to Background.",
      "Tighten the abstract: Cut it to about 150 words.",
    ]);
    // Indented after a blank line.
    expect(lastNumberedList("1. Rename the intro\n\n   Change the heading.\n\n2. Compile")).toEqual([
      "Rename the intro: Change the heading.",
      "Compile",
    ]);
    // Nested bullets and sub-steps.
    expect(
      lastNumberedList(
        "Plan:\n1. **main.tex**\n   - Rename the introduction\n   - Cut the abstract\n2. **refs.bib**\n   1. Remove duplicates",
      ),
    ).toEqual(["main.tex: Rename the introduction; Cut the abstract", "refs.bib: Remove duplicates"]);
    // A title that already ends a sentence, and a tab indent.
    expect(lastNumberedList("1. Update the intro.\n\tKeep the citations.")).toEqual([
      "Update the intro. Keep the citations.",
    ]);
  });

  it("goes on at the next number after a paragraph between items", () => {
    expect(
      lastNumberedList(
        "Plan:\n\n1. **Rename the intro**\n\nChange the heading.\n\n2. **Tighten the abstract**\n\nCut it.",
      ),
    ).toEqual(["Rename the intro", "Tighten the abstract"]);
    expect(lastNumberedList("1. Edit main.tex:\n```latex\n\\section{Background}\n```\n2. Compile")).toEqual([
      "Edit main.tex:",
      "Compile",
    ]);
  });

  it("uses the last numbered list in the reply", () => {
    expect(
      lastNumberedList(
        "Findings:\n1. Intro repeats abstract\n2. Conclusion lacks cites\n\nPlan:\n1. Rewrite the intro\n2. Add cites",
      ),
    ).toEqual(["Rewrite the intro", "Add cites"]);
    expect(lastNumberedList("1. Rewrite the intro\n\nThat is all.\n\n1. Another list")).toEqual([
      "Another list",
    ]);
    expect(
      lastNumberedList("Findings:\n1. Intro repeats abstract\n\n## Plan\n1. Rewrite the intro"),
    ).toEqual(["Rewrite the intro"]);
  });

  it("skips a list of questions and a list that starts past 1", () => {
    expect(
      lastNumberedList(
        "Plan:\n1. Rewrite the intro\n2. Add cites\n\nBefore I start:\n1. Should I keep the current title?",
      ),
    ).toEqual(["Rewrite the intro", "Add cites"]);
    expect(lastNumberedList("1. Rename the intro\n2. Should I also shorten the title?")).toEqual([
      "Rename the intro",
    ]);
    expect(lastNumberedList("I changed one step:\n\n2. Tighten the abstract")).toEqual([]);
    expect(
      lastNumberedList(
        "Plan:\n1. Rename the intro\n2. Tighten the abstract\n\nI changed step 2:\n\n2. Tighten it to 100 words",
      ),
    ).toEqual(["Rename the intro", "Tighten the abstract"]);
  });

  it("reads a number after a line of text as text, as Markdown does", () => {
    expect(lastNumberedList("I've updated step 2 as you asked:\n2. Tighten the abstract")).toEqual([]);
    expect(lastNumberedList("Plan:\n2026. Was a busy year for the venue.")).toEqual([]);
  });

  it("ignores numbered lines inside code fences", () => {
    expect(lastNumberedList("```\n1. not a plan\n```\nNo plan here.")).toEqual([]);
    expect(lastNumberedList("Plan:\n~~~\n1. not a step\n~~~\n")).toEqual([]);
    expect(
      lastNumberedList("Plan:\n1. Rename the intro\n   ```tex\n   1. \\section{Background}\n   ```\n2. Compile"),
    ).toEqual(["Rename the intro", "Compile"]);
    expect(lastNumberedList("```\r\n1. not a step\r\n```\r\nPlan:\r\n1. Rename the intro\r\n")).toEqual([
      "Rename the intro",
    ]);
    expect(lastNumberedList("Plan:\n1. Rename the intro\n\n```\n1. code\n2. more code\n```")).toEqual([
      "Rename the intro",
    ]);
  });

  // The chat bubble reads fences with the same scanner, so a line the bubble
  // shows as prose is never skipped here as code, and the other way round.
  it("reads code fences the way the chat bubble does", () => {
    // Inline code at the start of a line does not open a fence.
    expect(
      lastNumberedList("```main.tex``` has two intros.\n\nHere is the plan:\n1. Rename the intro\n2. Compile"),
    ).toEqual(["Rename the intro", "Compile"]);
    // A closer with text after it does not close the fence.
    expect(lastNumberedList("```\n1. a\n``` not a closer\nPlan:\n1. still code\n```")).toEqual([]);
    // An unclosed fence in a list item ends with the item.
    expect(
      lastNumberedList("Plan:\n1. Run the build\n   ```sh\n   make\n2. Compile the PDF"),
    ).toEqual(["Run the build", "Compile the PDF"]);
  });

  it("removes markdown emphasis and code marks", () => {
    expect(
      lastNumberedList("Plan:\n1. **Intro:** rename `main.tex` section\n2. Tighten the *abstract*"),
    ).toEqual(["Intro: rename main.tex section", "Tighten the abstract"]);
    expect(
      lastNumberedList(
        "Plan:\n1. _Rename_ the intro\n2. __Tighten__ the abstract\n3. Keep update_todos and `my_var` as they are",
      ),
    ).toEqual(["Rename the intro", "Tighten the abstract", "Keep update_todos and my_var as they are"]);
  });

  it("reads no list from headings, bullets, or indented code", () => {
    expect(lastNumberedList("## Plan\n### 1. Rename the intro\n### 2. Compile")).toEqual([]);
    expect(lastNumberedList("Plan:\n- Rename the intro\n- Tighten the abstract")).toEqual([]);
    expect(lastNumberedList("Plan:\n**Step 1:** Rename the intro")).toEqual([]);
    expect(lastNumberedList("See below.\n\n    1. indented code")).toEqual([]);
    expect(lastNumberedList("> 1. quoted")).toEqual([]);
    expect(lastNumberedList("Planned")).toEqual([]);
    expect(lastNumberedList("")).toEqual([]);
  });
});

describe("planTodos", () => {
  it("makes pending plan items", () => {
    expect(planTodos(["Rename the intro", "Compile"])).toEqual([
      { id: "plan-1", content: "Rename the intro", status: "pending" },
      { id: "plan-2", content: "Compile", status: "pending" },
    ]);
  });

  it("applies the same limits as update_todos", () => {
    const todos = planTodos(Array.from({ length: 35 }, () => "x".repeat(300)));
    expect(todos).toHaveLength(30);
    expect(todos.every((todo) => todo.content.length === 240)).toBe(true);
    expect(todos.at(-1)?.id).toBe("plan-30");
  });
});

describe("replyEndsWithQuestion", () => {
  it("is true when the last line asks something", () => {
    expect(replyEndsWithQuestion("I read the intro.\n\nShould I keep the title?")).toBe(true);
    expect(replyEndsWithQuestion("Which section should I start with?**\n\n")).toBe(true);
    expect(replyEndsWithQuestion("Which section?\r\n")).toBe(true);
  });

  it("is false for a statement or an empty reply", () => {
    expect(replyEndsWithQuestion("Does it read well? I think so.")).toBe(false);
    expect(replyEndsWithQuestion("")).toBe(false);
  });
});
