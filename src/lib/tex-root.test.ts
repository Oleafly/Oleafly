import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseTexMagicComments,
  resolveEffectiveMainDoc,
  resolveTexRootPath,
} from "./tex-root";
import { useFilesStore } from "@/store/files";

describe("parseTexMagicComments", () => {
  it("parses a root comment on the first line", () => {
    expect(
      parseTexMagicComments(
        "% !TEX root = ../main.tex\n\\section{Intro}\n",
      ),
    ).toEqual({ root: "../main.tex", program: null });
  });

  it("matches keywords case-insensitively", () => {
    expect(parseTexMagicComments("% !tex ROOT=main.tex\n")).toEqual({
      root: "main.tex",
      program: null,
    });
  });

  it("tolerates missing spaces around the marker and equals sign", () => {
    expect(parseTexMagicComments("%!TEX root=x.tex\n")).toEqual({
      root: "x.tex",
      program: null,
    });
  });

  it("only scans the first 10 lines", () => {
    const filler = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    const text = [...filler, "% !TEX root = late.tex"].join("\n");
    expect(parseTexMagicComments(text)).toEqual({
      root: null,
      program: null,
    });

    const nine = Array.from({ length: 9 }, (_, i) => `line ${i}`);
    const inRange = [...nine, "% !TEX root = tenth.tex"].join("\n");
    expect(parseTexMagicComments(inRange).root).toBe("tenth.tex");
  });

  it("keeps the first occurrence of each key", () => {
    const text = [
      "% !TEX root = first.tex",
      "% !TEX root = second.tex",
    ].join("\n");
    expect(parseTexMagicComments(text).root).toBe("first.tex");
  });

  it("parses program without inventing a root", () => {
    expect(
      parseTexMagicComments("% !TEX program = lualatex\n\\relax\n"),
    ).toEqual({ root: null, program: "lualatex" });
  });

  it("returns nulls when no magic comments exist", () => {
    expect(parseTexMagicComments("\\documentclass{article}\n")).toEqual({
      root: null,
      program: null,
    });
  });
});

describe("resolveTexRootPath", () => {
  it("resolves a relative parent path from a nested file", () => {
    expect(resolveTexRootPath("chapters/ch1.tex", "../main.tex")).toBe(
      "main.tex",
    );
  });

  it("resolves a nested descendant path", () => {
    expect(resolveTexRootPath("main.tex", "sub/dir/file.tex")).toBe(
      "sub/dir/file.tex",
    );
  });

  it("rejects targets that escape the project root", () => {
    expect(resolveTexRootPath("ch1.tex", "../../x.tex")).toBeNull();
  });

  it("rejects absolute paths", () => {
    expect(resolveTexRootPath("chapters/ch1.tex", "/etc/main.tex")).toBeNull();
  });
});

describe("resolveEffectiveMainDoc", () => {
  const resetState = {
    projectId: null,
    projectName: "",
    mainDoc: "main.tex",
    activePath: null,
    tree: [],
    files: {},
  };

  beforeEach(() => {
    useFilesStore.setState(resetState);
  });

  afterEach(() => {
    useFilesStore.setState(resetState);
  });

  it("overrides the stored main document with a valid magic root", () => {
    useFilesStore.setState({
      projectId: "project",
      mainDoc: "thesis.tex",
      activePath: "chapters/ch1.tex",
      tree: [
        { path: "chapters", is_dir: true },
        { path: "chapters/ch1.tex", is_dir: false },
        { path: "main.tex", is_dir: false },
        { path: "thesis.tex", is_dir: false },
      ],
      files: {
        "chapters/ch1.tex": {
          content: "% !TEX root = ../main.tex\n\\section{One}\n",
          dirty: false,
        },
      },
    });
    expect(resolveEffectiveMainDoc()).toEqual({
      mainDoc: "main.tex",
      overriddenBy: "chapters/ch1.tex",
      brokenRoot: null,
    });
  });

  it("falls back to the stored main document and reports a broken root", () => {
    useFilesStore.setState({
      projectId: "project",
      mainDoc: "thesis.tex",
      activePath: "chapters/ch1.tex",
      tree: [
        { path: "chapters/ch1.tex", is_dir: false },
        { path: "thesis.tex", is_dir: false },
      ],
      files: {
        "chapters/ch1.tex": {
          content: "% !TEX root = ../missing.tex\n",
          dirty: false,
        },
      },
    });
    expect(resolveEffectiveMainDoc()).toEqual({
      mainDoc: "thesis.tex",
      overriddenBy: null,
      brokenRoot: {
        declaredIn: "chapters/ch1.tex",
        target: "../missing.tex",
      },
    });
  });

  it("ignores magic-looking comments in non-TeX active files", () => {
    useFilesStore.setState({
      projectId: "project",
      mainDoc: "thesis.tex",
      activePath: "notes.typ",
      tree: [
        { path: "notes.typ", is_dir: false },
        { path: "main.tex", is_dir: false },
        { path: "thesis.tex", is_dir: false },
      ],
      files: {
        "notes.typ": {
          content: "% !TEX root = main.tex\n",
          dirty: false,
        },
      },
    });
    expect(resolveEffectiveMainDoc()).toEqual({
      mainDoc: "thesis.tex",
      overriddenBy: null,
      brokenRoot: null,
    });
  });

  it("uses the stored main document when no magic comment is present", () => {
    useFilesStore.setState({
      projectId: "project",
      mainDoc: "thesis.tex",
      activePath: "chapters/ch1.tex",
      tree: [
        { path: "chapters/ch1.tex", is_dir: false },
        { path: "thesis.tex", is_dir: false },
      ],
      files: {
        "chapters/ch1.tex": {
          content: "\\section{No magic here}\n",
          dirty: false,
        },
      },
    });
    expect(resolveEffectiveMainDoc()).toEqual({
      mainDoc: "thesis.tex",
      overriddenBy: null,
      brokenRoot: null,
    });
  });
});
