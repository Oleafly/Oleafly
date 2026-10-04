import { beforeAll, describe, expect, it } from "vitest";
import { applyLocale } from "@/i18n";
import enIntelligence from "@/i18n/locales/en/intelligence.json" with { type: "json" };
import {
  analysisReasonEnglishText,
  analysisReasonError,
  analysisReasonText,
} from "./reason";

beforeAll(async () => {
  await applyLocale("en");
});

describe("analysis reasons", () => {
  it("returns nothing for a missing reason and literal text as written", () => {
    expect(analysisReasonText(undefined)).toBeUndefined();
    expect(analysisReasonText(null)).toBeUndefined();
    expect(analysisReasonText({ text: "Server said hello" })).toBe(
      "Server said hello",
    );
  });

  it("translates language-service and analysis reason keys with their parameters", () => {
    expect(analysisReasonText({ key: "processExited" })).toBe(
      enIntelligence.languageService.reasons.processExited,
    );
    expect(
      analysisReasonText({
        key: "exitedRestartScheduled",
        params: { attempt: 2 },
      }),
    ).toBe(
      "Language service exited unexpectedly. Restart 2 is scheduled.",
    );
    expect(analysisReasonText({ key: "identityMismatch" })).toBe(
      enIntelligence.analysis.reasons.identityMismatch,
    );
  });

  it("builds English errors that carry their structured reason", () => {
    expect(analysisReasonEnglishText({ text: "Plain" })).toBe("Plain");
    const error = analysisReasonError({ key: "identityMismatch" });
    expect(error.message).toBe(
      enIntelligence.analysis.reasons.identityMismatch,
    );
    expect(error).toMatchObject({
      analysisReason: { key: "identityMismatch" },
    });
  });
});
