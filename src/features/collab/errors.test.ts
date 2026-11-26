import { beforeAll, describe, expect, it } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import {
  COLLAB_ERROR_CODES,
  COLLAB_ERROR_CODES_COMPLETE,
  collabErrorCode,
  collabErrorMessage,
  collabErrorParams,
  collabErrorText,
} from "./errors";

beforeAll(async () => {
  await loadNamespace("collab");
  await loadNamespace("errors");
});

const CATALOG_CODES = COLLAB_ERROR_CODES;

describe("collab errors", () => {
  it("lists every error code the backend can send, and the catalog has each one", () => {
    expect(COLLAB_ERROR_CODES_COMPLETE).toBe(true);
    expect([...CATALOG_CODES].sort()).toEqual(Object.keys(enCollab.errors).sort());
  });

  it.each(CATALOG_CODES)("reads %s from an IPC error and says it in words", (code) => {
    expect(collabErrorCode({ code, message: "raw" })).toBe(code);
    expect(collabErrorMessage(code)).toBe(
      enCollab.errors[code as keyof typeof enCollab.errors],
    );
  });

  it("names a role refusal that came back as one of the app's own errors", () => {
    const refused = '@oleafly/error:{"code":"collab.suggestion_role","params":{}}';
    expect(collabErrorCode(refused)).toBe("suggestion_role");
    expect(collabErrorText(new Error(refused))).toBe(enCollab.errors.suggestion_role);
    expect(collabErrorCode('@oleafly/error:{"code":"project.not_found"}')).toBe("internal");
  });

  it("knows the refusals for a cloud-synced library and an owner who is away", () => {
    expect(collabErrorText({ code: "cloud_synced", message: "synced" })).toBe(enCollab.errors.cloud_synced);
    expect(collabErrorText({ code: "owner_away", message: "away" })).toBe(enCollab.errors.owner_away);
    expect(collabErrorText({ code: "wrong_server", message: "elsewhere" })).toBe(enCollab.errors.wrong_server);
    expect(collabErrorText({ code: "already_member", message: "" }, "allowlist")).toBe(enCollab.errors.already_member);
    expect(enCollab.errors.already_member).toContain(enCollab.admin.tabs.members);
  });

  it("names the command line and its process when it holds a live project", () => {
    const cli = { code: "live_elsewhere", message: "live on the command line", params: { by: "cli", pid: "41" } };
    const named = enCollab.liveElsewhere.cli.replace("{{pid}}", "41");
    expect(collabErrorParams(cli)).toEqual({ by: "cli", pid: "41" });
    expect(collabErrorText(cli)).toBe(named);
    expect(collabErrorMessage("live_elsewhere", undefined, cli.params)).toBe(named);
    const app = { code: "live_elsewhere", message: "live in the app", params: { by: "app", pid: "7" } };
    expect(collabErrorText(app)).toBe(enCollab.errors.live_elsewhere);
    expect(collabErrorText({ code: "live_elsewhere", message: "live somewhere" })).toBe(enCollab.errors.live_elsewhere);
    expect(collabErrorParams({ code: "live_elsewhere", message: "" })).toEqual({});
    expect(collabErrorParams(new Error("boom"))).toEqual({});
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
