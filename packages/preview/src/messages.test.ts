import { describe, expect, it } from "vitest";
import { catalogProblems } from "@oleafly/i18n-contract/testing";
import { PREVIEW_MESSAGE_KEYS } from "./messages";

describe("preview package messages", () => {
  it("declares exactly the keys its English catalog carries", () => {
    expect(catalogProblems("preview", PREVIEW_MESSAGE_KEYS)).toEqual({
      missing: [],
      undeclared: [],
      duplicated: [],
    });
  });
});
