import { describe, expect, it } from "vitest";
import { catalogProblems } from "@oleafly/i18n-contract/testing";
import { DIAGRAM_MESSAGE_KEYS } from "./messages";

describe("diagram package messages", () => {
  it("declares exactly the keys its English catalog carries", () => {
    expect(catalogProblems("diagram", DIAGRAM_MESSAGE_KEYS)).toEqual({
      missing: [],
      undeclared: [],
      duplicated: [],
    });
  });
});
