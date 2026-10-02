import { describe, expect, it } from "vitest";
import { catalogProblems } from "@oleafly/i18n-contract/testing";
import { WYSIWYG_MESSAGE_KEYS } from "./messages";

describe("wysiwyg package messages", () => {
  it("declares exactly the keys its English catalog carries", () => {
    expect(catalogProblems("wysiwyg", WYSIWYG_MESSAGE_KEYS)).toEqual({
      missing: [],
      undeclared: [],
      duplicated: [],
    });
  });
});
