import { beforeAll, describe, expect, it } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import {
  COLLAB_ERROR_CODES,
  COLLAB_ERROR_CODES_COMPLETE,
  collabErrorCode,
  collabErrorMessage,
  collabErrorText,
} from "./errors";

beforeAll(async () => {
  await loadNamespace("collab");
  await loadNamespace("errors");
});

// The switch's refusal reuses the sentence the app's other errors already use.
const SHARED_MESSAGES = new Set<string>(["turned_off"]);
const CATALOG_CODES = COLLAB_ERROR_CODES.filter((code) => !SHARED_MESSAGES.has(code));

describe("collab errors", () => {
  it("lists every error code the backend can send, and the catalog has each one", () => {
    expect(COLLAB_ERROR_CODES_COMPLETE).toBe(true);
    expect([...CATALOG_CODES].sort()).toEqual(Object.keys(enCollab.errors).sort());
  });

  it.each(CATALOG_CODES)("reads %s from an IPC error and says it in words", (code) => {
    expect(collabErrorCode({ code, message: "raw" })).toBe(code);
    expect(collabErrorMessage(code as Exclude<typeof code, "turned_off">)).toBe(
      enCollab.errors[code as keyof typeof enCollab.errors],
    );
  });

  it("says live collaboration is turned off in the words the rest of the app uses", () => {
    expect(collabErrorCode({ code: "turned_off", message: "" })).toBe("turned_off");
    expect(collabErrorMessage("turned_off")).toBe(enErrors.collab.turned_off);
  });

  it("names the switch being off when the command was refused as one of the app's own errors", () => {
    const refused = '@oleafly/error:{"code":"collab.turned_off","params":{}}';
    expect(collabErrorCode(refused)).toBe("turned_off");
    expect(collabErrorText(new Error(refused))).toBe(enErrors.collab.turned_off);
    expect(collabErrorCode('@oleafly/error:{"code":"project.not_found"}')).toBe("internal");
  });

  it("shows the server's own sentence for a refusal it has no code for", () => {
    const refusal = { code: "invalid", message: "That isn't a domain name. Use a form like cs.example.edu." };
    expect(collabErrorText(refusal)).toBe(refusal.message);
    expect(collabErrorText({ code: "invalid", message: "  " })).toBe(enCollab.errors.invalid);
    expect(collabErrorText({ code: "server", message: "stack trace" })).toBe(enCollab.errors.server);
    expect(collabErrorText(new Error("boom"))).toBe(enCollab.errors.internal);
  });

  it("explains a duplicate in the words of the list it came from", () => {
    expect(collabErrorText({ code: "duplicate_entry", message: "" }, "allowlist")).toBe(
      enCollab.admin.allowlist.duplicate,
    );
    expect(collabErrorText({ code: "duplicate_entry", message: "" }, "domains")).toBe(enCollab.admin.domains.duplicate);
    expect(collabErrorText({ code: "duplicate_entry", message: "" })).toBe(enCollab.errors.duplicate_entry);
    expect(collabErrorText({ code: "last_admin", message: "" }, "members")).toBe(enCollab.errors.last_admin);
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
