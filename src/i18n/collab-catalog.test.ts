import { describe, expect, it } from "vitest";
import { flattenCatalog } from "@oleafly/i18n-contract";
import collab from "./locales/en/collab.json" with { type: "json" };
import context from "./context/collab.json" with { type: "json" };

const ERROR_CODES = [
  "unreachable",
  "not_https",
  "client_too_old",
  "server_too_old",
  "not_admitted",
  "sign_in_cancelled",
  "sign_in_timed_out",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "setup_code_invalid",
  "server",
  "internal",
  "server_changed",
  "duplicate_server",
  "device_in_use",
  "server_unknown",
  "too_large",
];
const CHECKS = ["reachable", "https", "protocol", "webSocket", "signInProviders", "email", "clock"];
const STATUSES = ["pass", "fail", "info", "skipped"];
const EVENT_KINDS = [
  "setupCompleted",
  "signIn",
  "signInRefused",
  "deviceAdded",
  "deviceSignedOut",
  "refreshReuseDetected",
  "memberAdded",
  "memberRemoved",
  "memberSuspended",
  "memberReactivated",
  "roleChanged",
  "allowlistAdded",
  "allowlistRemoved",
  "domainRuleAdded",
  "domainRuleRemoved",
  "settingsChanged",
  "unknown",
];
const RUNTIME_SETTINGS = [
  "guestsEnabled",
  "guestApprovalRequired",
  "directoryVisible",
  "directoryShowsEmail",
  "linkSharingAllowed",
  "accessLogsAllowed",
  "emailNotifications",
];

const flat = flattenCatalog(collab);

describe("collab catalog", () => {
  it("has one message per error code the backend sends", () => {
    expect(Object.keys(collab.errors).sort()).toEqual([...ERROR_CODES].sort());
  });

  it("has a label and a sentence for every check and every status", () => {
    expect(Object.keys(collab.section.checks.items).sort()).toEqual([...CHECKS].sort());
    expect(Object.keys(collab.section.checks.status).sort()).toEqual([...STATUSES].sort());
    for (const id of CHECKS) {
      for (const key of ["label", ...STATUSES]) {
        expect(flat.get(`section.checks.items.${id}.${key}`), `${id}.${key}`).toBeTruthy();
      }
    }
  });

  it("names every server role, security event and runtime setting", () => {
    expect(Object.keys(collab.roles)).toEqual(["admin", "maintainer", "member", "guest"]);
    expect(Object.keys(collab.admin.log.kinds).sort()).toEqual([...EVENT_KINDS].sort());
    for (const key of RUNTIME_SETTINGS) {
      expect(flat.get(`admin.settings.${key}.label`), key).toBeTruthy();
      expect(flat.get(`admin.settings.${key}.description`), key).toBeTruthy();
    }
  });

  it("writes plain sentences with no dashes, semicolons, stray spaces or plural forms", () => {
    for (const [key, value] of flat) {
      expect(value, key).not.toMatch(/[—–;；]/u);
      expect(value.trim(), key).toBe(value);
      expect(key, key).not.toMatch(/_(zero|one|two|few|many|other)$/u);
    }
  });

  it("only explains keys the catalog has", () => {
    for (const key of flattenCatalog(context).keys()) {
      expect(flat.has(key), key).toBe(true);
    }
  });
});
