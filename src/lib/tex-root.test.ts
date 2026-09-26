import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseTexMagicComments,
  resolveEffectiveMainDoc,
  resolveTexRootPath,
} from "./tex-root";
import type { ProjectInfo, ProjectLocationInfo } from "@/lib/tauri";
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

  it("reads CRLF files and trims the value under both rules", () => {
    expect(
      parseTexMagicComments("% !TEX root = main.tex \r\n\\section{A}\r\n"),
    ).toEqual({ root: "main.tex", program: null });
    expect(
      parseTexMagicComments("% !TEX program =  lualatex\t\r\n", "library"),
    ).toEqual({ root: null, program: "lualatex" });
    expect(parseTexMagicComments("% !TEX root =   \r\n", "library")).toEqual({
      root: null,
      program: null,
    });
  });

  it("only scans the first 50 lines", () => {
    const filler = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const text = [...filler, "% !TEX root = late.tex"].join("\n");
    expect(parseTexMagicComments(text)).toEqual({ root: null, program: null });
    const inRange = [...filler.slice(0, 49), "% !TEX root = fiftieth.tex"].join("\n");
    expect(parseTexMagicComments(inRange).root).toBe("fiftieth.tex");
  });

  it("accepts an indented comment without a bang and with loose spacing", () => {
    expect(parseTexMagicComments("  % TeX  root  =  main.tex  \n").root).toBe("main.tex");
  });

  it("skips an empty root and keeps looking", () => {
    expect(parseTexMagicComments("% !TEX root = \n% !TEX root = main.tex\n").root).toBe("main.tex");
  });

  it("parses every shared case the same way as the Rust detector", () => {
    const cases = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "crates/oleafly-core/tests/fixtures/tex-magic-comments.json"),
        "utf8",
      ),
    ) as { text: string; root: string | null; program: string | null }[];
    expect(cases.length).toBeGreaterThanOrEqual(15);
    for (const { text, root, program } of cases) {
      expect(parseTexMagicComments(text), JSON.stringify(text)).toEqual({ root, program });
    }
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
    projects: [],
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
        reason: "missing",
      },
    });
  });

  it("rejects a root comment that points at a file LaTeX can't compile", () => {
    useFilesStore.setState({
      projectId: "project",
      mainDoc: "thesis.tex",
      activePath: "chapters/ch1.tex",
      tree: [
        { path: "chapters/ch1.tex", is_dir: false },
        { path: "notes.md", is_dir: false },
        { path: "thesis.tex", is_dir: false },
      ],
      files: {
        "chapters/ch1.tex": { content: "% !TEX root = ../notes.md\n", dirty: false },
      },
    });
    expect(resolveEffectiveMainDoc()).toEqual({
      mainDoc: "thesis.tex",
      overriddenBy: null,
      brokenRoot: { declaredIn: "chapters/ch1.tex", target: "../notes.md", reason: "not_tex" },
    });
  });

  it("keeps the strict parser for library projects and the shared one for linked folders", () => {
    const project = (id: string, location?: ProjectLocationInfo): ProjectInfo => ({
      id,
      name: id,
      main_doc: "thesis.tex",
      kind: "",
      created_at: 0,
      updated_at: 0,
      has_preview: false,
      exports: [],
      forked_from: null,
      recovery_pending: false,
      location,
    });
    const linked = project("linked-thesis", {
      kind: "linked",
      display_path: "~/thesis",
      availability: "ok",
    });
    const filler = Array.from({ length: 20 }, (_, index) => `% line ${index}`);
    for (const content of [
      "  % TeX root = ../main.tex\n",
      "% TeX root = ../main.tex\n",
      [...filler, "% !TEX root = ../main.tex"].join("\n"),
    ]) {
      const state = {
        mainDoc: "thesis.tex",
        activePath: "chapters/ch1.tex",
        tree: [
          { path: "chapters/ch1.tex", is_dir: false },
          { path: "main.tex", is_dir: false },
          { path: "thesis.tex", is_dir: false },
        ],
        files: { "chapters/ch1.tex": { content, dirty: false } },
        projects: [project("library"), linked],
      };
      for (const projectId of ["library", "unlisted"]) {
        useFilesStore.setState({ ...state, projectId });
        expect(resolveEffectiveMainDoc(), `${projectId} ${content}`).toEqual({
          mainDoc: "thesis.tex",
          overriddenBy: null,
          brokenRoot: null,
        });
      }
      useFilesStore.setState({ ...state, projectId: "linked-thesis" });
      expect(resolveEffectiveMainDoc(), content).toEqual({
        mainDoc: "main.tex",
        overriddenBy: "chapters/ch1.tex",
        brokenRoot: null,
      });
    }
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
