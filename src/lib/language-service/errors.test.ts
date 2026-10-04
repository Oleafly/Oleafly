import { describe, expect, it } from "vitest";
import {
  isLanguageServiceCancellation,
  isLanguageServiceStaleError,
  LanguageServiceAbortError,
  LanguageServiceExitedError,
  LanguageServiceTimeoutError,
  StaleLanguageServiceResultError,
} from "./errors";

const identity = { session: "s", generation: 1, requestGeneration: 2 };

describe("language-service error guards", () => {
  it("recognizes stale results only", () => {
    expect(
      isLanguageServiceStaleError(
        new StaleLanguageServiceResultError(identity, "document closed"),
      ),
    ).toBe(true);
    expect(isLanguageServiceStaleError(new Error("other"))).toBe(false);
  });

  it("treats aborts and timeouts as cancellations but not exits", () => {
    expect(
      isLanguageServiceCancellation(new LanguageServiceAbortError("hover")),
    ).toBe(true);
    expect(
      isLanguageServiceCancellation(
        new LanguageServiceTimeoutError("hover", 50),
      ),
    ).toBe(true);
    expect(isLanguageServiceCancellation(new LanguageServiceExitedError())).toBe(
      false,
    );
    expect(isLanguageServiceCancellation("timeout")).toBe(false);
  });

  it("describes the request each error belongs to", () => {
    expect(new LanguageServiceTimeoutError("hover", 50)).toMatchObject({
      method: "hover",
      timeoutMs: 50,
      message: "Language service request hover timed out after 50 ms",
    });
    expect(new StaleLanguageServiceResultError(identity, "late")).toMatchObject({
      identity,
      message: "Discarded stale language service result: late",
    });
    expect(new LanguageServiceExitedError().message).toBe(
      "Language service exited",
    );
  });
});
