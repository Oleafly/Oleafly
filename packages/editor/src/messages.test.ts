import { describe, expect, it } from "vitest";
import { catalogProblems } from "@oleafly/i18n-contract/testing";
import { EDITOR_MESSAGE_KEYS } from "./messages";

describe("editor package messages", () => {
  it("declares exactly the keys its English catalog carries", () => {
    expect(catalogProblems("editor", EDITOR_MESSAGE_KEYS)).toEqual({
      missing: [],
      undeclared: [],
      duplicated: [],
    });
  });
});
