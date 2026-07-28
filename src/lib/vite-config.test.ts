import { describe, expect, it } from "vitest";
import { LEGAL_COMMENT_PATTERN } from "../../vite.config";

describe("production legal-comment retention", () => {
  it.each([
    "! MIT License",
    "@license Apache-2.0",
    "Copyright Example\n@preserve",
    "@cc_on",
  ])("retains %j", (comment) => {
    expect(LEGAL_COMMENT_PATTERN.test(comment)).toBe(true);
  });

  it.each([
    "ordinary implementation note",
    "TODO: remove this",
    "source map hint",
  ])("continues to remove %j", (comment) => {
    expect(LEGAL_COMMENT_PATTERN.test(comment)).toBe(false);
  });
});
