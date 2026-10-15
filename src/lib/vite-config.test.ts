import { describe, expect, it } from "vitest";
import { LAZY_NAMESPACES, NAMESPACES } from "@/i18n/resources";
import { LEGAL_COMMENT_PATTERN, localeChunk } from "../../vite.config";

describe("translated catalog chunks", () => {
  it.each(["ru", "pt-BR", "zh-Hans"])("give %s one startup chunk and one chunk per lazy namespace", (locale) => {
    for (const namespace of NAMESPACES) {
      const expected = LAZY_NAMESPACES.includes(namespace) ? `locale-${locale}-${namespace}` : `locale-${locale}`;
      expect(localeChunk(`/repo/src/i18n/locales/${locale}/${namespace}.json`), namespace).toBe(expected);
    }
  });

  it("leave English catalogs and other modules to the default chunking", () => {
    expect(localeChunk("/repo/src/i18n/locales/en/collab.json")).toBeUndefined();
    expect(localeChunk("/repo/src/i18n/locales/en/shell.json")).toBeUndefined();
    expect(localeChunk("/repo/src/features/collab/store.ts")).toBeUndefined();
  });
});

describe("production legal-comment retention", () => {
  it.each([
    "! MIT License",
    "@license Apache-2.0",
    "Copyright Example\n@preserve",
    "@cc_on",
  ])("retains %j", (comment) => {
    expect(LEGAL_COMMENT_PATTERN.test(comment)).toBe(true);
  });

  it.each([
    "ordinary implementation note",
    "TODO: remove this",
    "source map hint",
  ])("continues to remove %j", (comment) => {
    expect(LEGAL_COMMENT_PATTERN.test(comment)).toBe(false);
  });
});
