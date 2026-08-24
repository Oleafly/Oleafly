import { describe, expect, it } from "vitest";
import { friendlyHint } from "./chat-parts";

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
