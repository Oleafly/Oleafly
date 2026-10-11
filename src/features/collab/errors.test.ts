import { beforeAll, describe, expect, it } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import {
  COLLAB_ERROR_CODES,
  COLLAB_ERROR_CODES_COMPLETE,
  collabErrorCode,
  collabErrorMessage,
} from "./errors";

beforeAll(async () => {
  await loadNamespace("collab");
});

describe("collab errors", () => {
  it("lists every error code the backend can send, and the catalog has each one", () => {
    expect(COLLAB_ERROR_CODES_COMPLETE).toBe(true);
    expect([...COLLAB_ERROR_CODES].sort()).toEqual(Object.keys(enCollab.errors).sort());
  });

  it.each(COLLAB_ERROR_CODES)("reads %s from an IPC error and says it in words", (code) => {
    expect(collabErrorCode({ code, message: "raw" })).toBe(code);
    expect(collabErrorMessage(code)).toBe(enCollab.errors[code]);
  });

  it("treats anything else as an internal error", () => {
    for (const value of [null, undefined, "unreachable", new Error("boom"), { code: "nope" }, { code: 7 }, {}]) {
      expect(collabErrorCode(value)).toBe("internal");
    }
  });

  it("explains a conflict in the words of the list it came from", () => {
    expect(collabErrorMessage("conflict", "members")).toBe(enCollab.admin.members.lastAdmin);
    expect(collabErrorMessage("conflict", "allowlist")).toBe(enCollab.admin.allowlist.duplicate);
    expect(collabErrorMessage("conflict", "domains")).toBe(enCollab.admin.domains.duplicate);
    expect(collabErrorMessage("conflict")).toBe(enCollab.errors.conflict);
    expect(collabErrorMessage("forbidden", "members")).toBe(enCollab.errors.forbidden);
  });
});
