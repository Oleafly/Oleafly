import { describe, expect, it } from "vitest";
import {
  extractPlaceholders,
  extractTags,
  flattenCatalog,
  pluralCategories,
  pluralSuffix,
  validateCatalog,
  validateSourceCatalog,
} from "./catalog";

const flat = (value: unknown) => flattenCatalog(value);

describe("catalog helpers", () => {
  it("flattens nested objects into dotted keys", () => {
    expect([...flat({ a: { b: "x", c: { d: "y" } }, e: "z" }).entries()]).toEqual([
      ["a.b", "x"],
      ["a.c.d", "y"],
      ["e", "z"],
    ]);
  });

  it("extracts placeholders and tags", () => {
    expect(extractPlaceholders("Deleted {{name}} from {{ folder }}")).toEqual(["folder", "name"]);
    expect(extractTags("Read the <docsLink>guide</docsLink> or <br/>")).toEqual(["br", "docsLink", "docsLink"]);
  });

  it("reads plural suffixes and CLDR categories", () => {
    expect(pluralSuffix("files_one")).toBe("one");
    expect(pluralSuffix("files")).toBeNull();
    expect(pluralCategories("zh-Hans")).toEqual(["other"]);
    expect(pluralCategories("en")).toEqual(["one", "other"]);
  });
});

describe("validateCatalog", () => {
  const source = flat({
    save: "Save",
    deleted: "Deleted {{name}}",
    files_one: "{{count}} file",
    files_other: "{{count}} files",
    link: "Open the <docsLink>guide</docsLink>",
  });

  it("accepts a complete, consistent translation", () => {
    const target = flat({
      save: "保存",
      deleted: "已删除 {{name}}",
      files_other: "{{count}} 个文件",
      link: "打开<docsLink>指南</docsLink>",
    });
    expect(validateCatalog("common", "zh-Hans", source, target, {})).toEqual([]);
  });

  it("reports missing, extra, empty and mismatched entries", () => {
    const target = flat({
      save: "",
      deleted: "已删除 {{title}}",
      files_one: "{{count}} 个文件",
      files_other: "{{count}} 个文件",
      link: "打开指南",
      extra: "多余",
    });
    const messages = validateCatalog("common", "zh-Hans", source, target, {}).map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("empty"),
        expect.stringContaining("placeholders"),
        expect.stringContaining('plural category "one"'),
        expect.stringContaining("tags"),
        expect.stringContaining("not in the source"),
      ]),
    );
  });

  it("enforces the Chinese style rules", () => {
    const target = flat({
      save: "保存 ",
      deleted: "已删除{{name}},请检查",
      files_other: "{{count}}个文件",
      link: "打开<docsLink>「指南」</docsLink>——现在",
    });
    const messages = validateCatalog("common", "zh-Hans", source, target, {}).map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("whitespace"),
        expect.stringContaining("half-width"),
        expect.stringContaining("corner brackets"),
        expect.stringContaining("em dash"),
      ]),
    );
  });

  it("keeps do-not-translate terms verbatim", () => {
    const src = flat({ tip: "Compile with LaTeX" });
    const target = flat({ tip: "使用乳胶编译" });
    const issues = validateCatalog("common", "zh-Hans", src, target, { doNotTranslate: ["LaTeX"] });
    expect(issues.map((i) => i.message)).toEqual([expect.stringContaining("LaTeX")]);
  });

  it("validates the English source on its own", () => {
    const src = flat({ a: "Bad — dash", b: "Trailing ", files_many: "x" });
    const messages = validateSourceCatalog("common", "en", src, {}).map((i) => i.message);
    expect(messages).toHaveLength(3);
  });
});
