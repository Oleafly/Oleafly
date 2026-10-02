import { describe, expect, it } from "vitest";
import { catalogProblems } from "@oleafly/i18n-contract/testing";
import { TEMPLATES_MESSAGE_KEYS } from "./messages";

describe("templates package messages", () => {
  it("declares exactly the keys its English catalog carries", () => {
    expect(catalogProblems("templates", TEMPLATES_MESSAGE_KEYS)).toEqual({
      missing: [],
      undeclared: [],
      duplicated: [],
    });
  });
});
