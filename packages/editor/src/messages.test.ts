import { describe, expect, it } from "vitest";
import { catalogProblems, testCatalogTranslator } from "@oleafly/i18n-contract/testing";
import { EDITOR_MESSAGE_KEYS, editorMessageOr } from "./message-keys";
import { setEditorTranslator } from "./messages";

describe("editor package messages", () => {
  it("declares exactly the keys its English catalog carries", () => {
    expect(catalogProblems("editor", EDITOR_MESSAGE_KEYS)).toEqual({
      missing: [],
      undeclared: [],
      duplicated: [],
    });
  });

  it("falls back to the given text for unknown keys and when no translator is set", () => {
    expect(editorMessageOr("snippets.records.figure", "Fig")).toBe("Fig");
    setEditorTranslator(testCatalogTranslator("editor"));
    try {
      expect(editorMessageOr("snippets.records.figure", "Fig")).toBe("Figure");
      expect(editorMessageOr("not.a.key", "Mine")).toBe("Mine");
      expect(editorMessageOr(undefined, "Mine")).toBe("Mine");
    } finally {
      setEditorTranslator(null);
    }
  });
});
