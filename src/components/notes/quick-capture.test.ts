import { describe, expect, it } from "vitest";
import { captureDraft, countCharacters, isCaptureRequest } from "./quick-capture";

describe("captureDraft", () => {
  it.each([
    ["Call Sam about the dataset", "Call Sam about the dataset", ""],
    ["Reading list\n\n- Attention is all you need\n- BERT", "Reading list", "- Attention is all you need\n- BERT"],
    ["  # Lab meeting  \r\nMove to Thursday", "Lab meeting", "Move to Thursday"],
    ["- [ ] Order reagents\n- [ ] Book the scope", "Order reagents", "- [ ] Order reagents\n- [ ] Book the scope"],
    ["> Measure twice", "Measure twice", "> Measure twice"],
    ["1. Draft the intro", "Draft the intro", "1. Draft the intro"],
    ["Ratio a\\*b \\[draft\\] &lt;v2&gt;\n\nNext", "Ratio a*b [draft] <v2>", "Next"],
    ["\\# not a heading", "# not a heading", ""],
  ])("turns %j into a title and a body", (text, title, body) => {
    expect(captureDraft(text)).toEqual({ title, body });
  });

  it("cuts a long first line at a word and keeps the whole text in the body", () => {
    const line = `${"word ".repeat(30)}end`;
    const draft = captureDraft(line);
    expect(draft.title.length).toBeLessThanOrEqual(80);
    expect(draft.title.endsWith("word")).toBe(true);
    expect(draft.body).toBe(line);
  });
});

describe("countCharacters", () => {
  it("counts what a reader sees as one character once", () => {
    expect(countCharacters("")).toBe(0);
    expect(countCharacters("Grant idea")).toBe(10);
    expect(countCharacters("café 👩‍🔬")).toBe(6);
    expect(countCharacters("かな")).toBe(2);
  });
});

describe("isCaptureRequest", () => {
  it("accepts only a request with an id, text and a known target", () => {
    expect(isCaptureRequest({ id: "1", text: "hi", target: "today" })).toBe(true);
    expect(isCaptureRequest({ id: "1", text: "hi", target: "inbox" })).toBe(false);
    expect(isCaptureRequest({ id: 1, text: "hi", target: "new" })).toBe(false);
    expect(isCaptureRequest(null)).toBe(false);
  });
});
