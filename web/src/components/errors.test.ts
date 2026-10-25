import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { OfflineError } from "../controller";
import en from "../i18n/en.json";
import { errorKey, failureKey } from "./errors";

const SERVER_CODES = [
  "project_too_large",
  "server_busy",
  "not_open",
  "cross_site",
  "too_large",
  "conflict",
  "comment_empty",
  "account_storage_full",
  "too_many_uploads",
];

describe("refusal messages", () => {
  it.each(SERVER_CODES)("has its own words for %s", (code) => {
    expect(errorKey(code)).toBe(code);
    expect(en.errors[errorKey(code)]).not.toBe(en.errors.generic);
  });

  it("falls back to the general message for a code it doesn't know", () => {
    expect(errorKey("something_new")).toBe("generic");
  });

  it("reads the code of a refused request", () => {
    expect(failureKey(new ApiError(403, "cross_site", "no"))).toBe("cross_site");
    expect(failureKey(new ApiError(500, "boom", ""))).toBe("generic");
    expect(failureKey(new OfflineError())).toBe("offline");
    expect(failureKey(new Error("x"))).toBe("generic");
  });
});
