import { describe, expect, it } from "vitest";
import {
  DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS,
  absoluteProjectPath,
  languageServiceStartupKey,
  tinymistConfiguration,
} from "./tinymist-configuration";

describe("tinymistConfiguration", () => {
  it("keeps the base options and lets the editor settings win", () => {
    expect(
      tinymistConfiguration(
        { formatterMode: "disable", outputPath: "$root/out" },
        { ...DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS, lint: true },
      ),
    ).toEqual({
      formatterMode: "typstyle",
      outputPath: "$root/out",
      formatterPrintWidth: 120,
      formatterIndentSize: 2,
      lint: { enabled: true, when: "onSave" },
    });
  });

  it("starts from nothing when there is no base", () => {
    expect(tinymistConfiguration(null, DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS)).toEqual({
      formatterMode: "typstyle",
      formatterPrintWidth: 120,
      formatterIndentSize: 2,
      lint: { enabled: false, when: "onSave" },
    });
  });
});

describe("languageServiceStartupKey", () => {
  it("encodes lint and fonts for Tinymist only", () => {
    const lint = { ...DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS, lint: true };
    expect(languageServiceStartupKey("tinymist", lint)).toBe("lint:1");
    expect(languageServiceStartupKey("tinymist", { ...lint, fontPaths: ["/f"], systemFonts: false })).toBe(
      "lint:1|fonts:0:/f",
    );
    expect(languageServiceStartupKey("texlab", lint)).toBe("");
  });
});

describe("absoluteProjectPath", () => {
  it("drops every trailing separator from the root", () => {
    expect(absoluteProjectPath("/a/b///", "main.typ")).toBe("/a/b/main.typ");
    expect(absoluteProjectPath("C:\\Papers\\/\\", "src/main.typ")).toBe("C:\\Papers\\src\\main.typ");
    expect(absoluteProjectPath("\\\\server\\share\\", "/a\\b.typ")).toBe("\\\\server\\share\\a\\b.typ");
    expect(absoluteProjectPath("/", "main.typ")).toBe("/main.typ");
    expect(absoluteProjectPath("", "main.typ")).toBe("/main.typ");
  });

  it("splits the relative path on either separator", () => {
    expect(absoluteProjectPath("/a", "//src\\\\ch/one.typ")).toBe("/a/src/ch/one.typ");
  });
});
