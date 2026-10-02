import { describe, expect, it } from "vitest";
import { catalogProblems } from "@oleafly/i18n-contract/testing";
import { PREFLIGHT_MESSAGE_KEYS } from "./messages";

describe("preflight package messages", () => {
  it("declares exactly the keys its English catalog carries", () => {
    expect(catalogProblems("preflight", PREFLIGHT_MESSAGE_KEYS)).toEqual({
      missing: [],
      undeclared: [],
      duplicated: [],
    });
  });
});
