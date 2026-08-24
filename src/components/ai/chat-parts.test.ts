import { describe, expect, it } from "vitest";
import { formatError, formatToolOutput, friendlyHint } from "./chat-parts";

describe("formatToolOutput", () => {
  it("shows a text payload's content field as readable text", () => {
    const out = formatToolOutput({
      path: "bare_adv.tex",
      truncated: false,
      content: "% The publisher's ID mark\n\\IEEEpubid{0000}",
    });
    expect(out).toBe("% The publisher's ID mark\n\\IEEEpubid{0000}");
  });

  it("keeps plain strings and surfaces errors", () => {
    expect(formatToolOutput("done")).toBe("done");
    expect(formatToolOutput({ error: "file not found" })).toBe("Error: file not found");
  });

  it("pretty-prints structured payloads without a content field", () => {
    const out = formatToolOutput({ files: [{ path: "a.tex" }] });
    expect(out).toContain('"a.tex"');
    expect(out).toContain("\n");
  });
});

describe("friendlyHint", () => {
  it("explains a retired or restricted model", () => {
    const hint = friendlyHint(
      "The provider returned 404. This model models/gemini-2.5-pro is no longer available to new users. Please update your code to use models/gemini-3.1-pro-preview for the latest features and improvements.",
      404,
    );
    expect(hint).toContain("retired or restricted this model");

    expect(friendlyHint("The model `grok-2` was deprecated on 2026-01-01.")).toContain(
      "retired or restricted",
    );
    expect(friendlyHint("model_not_found: deepseek-chat")).toContain("retired or restricted");
  });

  it("keeps credential problems ahead of model problems", () => {
    expect(friendlyHint("invalid api key", 401)).toContain("API key");
  });

  it("explains a capacity spike", () => {
    const hint = friendlyHint(
      "The provider returned 503. This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
      503,
    );
    expect(hint).toContain("overloaded");
  });

  it("stays quiet on errors it does not recognize", () => {
    expect(friendlyHint("something odd happened")).toBeNull();
  });
});

describe("formatError", () => {
  it("formats string overload errors returned as run outcomes", () => {
    const formatted = formatError(
      "The provider returned 503. This model is currently experiencing high demand.",
      "Google Gemini",
    );
    expect(formatted).toContain("Google Gemini");
    expect(formatted).toContain("overloaded");
  });
});
