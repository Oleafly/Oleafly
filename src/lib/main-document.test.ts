import { describe, expect, it } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import type { DetectionCandidate } from "@/lib/folder-detection";
import {
  ALL_MAIN_EXTENSIONS,
  candidateReasonLine,
  documentKindLabel,
  isLinkedHome,
  mainDocumentMissing,
} from "./main-document";

const labels = enShell.openedFolder;

function candidate(path: string, overrides: Partial<DetectionCandidate> = {}): DetectionCandidate {
  return {
    path,
    family: "latex",
    tier: "s",
    kind: "document",
    class: "article",
    title: null,
    depth: path.split("/").length - 1,
    reasons: [],
    ...overrides,
  };
}

describe("main document helpers", () => {
  it("treats every manifest home except the library as an opened folder", () => {
    expect(isLinkedHome("library")).toBe(false);
    expect(isLinkedHome("device")).toBe(true);
    expect(isLinkedHome("device_foreign")).toBe(true);
    expect(isLinkedHome("folder")).toBe(true);
  });

  it("offers every source family for a main document", () => {
    expect(ALL_MAIN_EXTENSIONS).toEqual(["tex", "ltx", "latex", "typ", "md", "markdown"]);
  });

  it("reports a missing main only for an opened folder whose main file is not in the tree", () => {
    const tree = [
      { path: "notes", is_dir: true },
      { path: "notes/draft.md", is_dir: false },
    ];
    expect(
      mainDocumentMissing({ projectId: "linked-a", manifestHome: "device", tree, mainDoc: "main.tex" }),
    ).toBe(true);
    expect(
      mainDocumentMissing({
        projectId: "linked-a",
        manifestHome: "device",
        tree,
        mainDoc: "notes/draft.md",
      }),
    ).toBe(false);
    expect(
      mainDocumentMissing({ projectId: "linked-a", manifestHome: "device", tree, mainDoc: "notes" }),
    ).toBe(true);
    expect(
      mainDocumentMissing({ projectId: "paper", manifestHome: "library", tree, mainDoc: "main.tex" }),
    ).toBe(false);
    expect(
      mainDocumentMissing({ projectId: null, manifestHome: "device", tree: [], mainDoc: "main.tex" }),
    ).toBe(false);
  });

  it("finds a main whose spelling differs from the file on disk the way the file system allows", () => {
    const composed = "th\u00e8se/main.tex";
    const decomposed = "the\u0300se/main.tex";
    const tree = [
      { path: "Paper", is_dir: true },
      { path: "Paper/Main.tex", is_dir: false },
      { path: composed, is_dir: false },
    ];
    const view = (mainDoc: string) => ({
      projectId: "linked-a",
      manifestHome: "folder" as const,
      tree,
      mainDoc,
    });
    expect(mainDocumentMissing(view("paper/main.tex"))).toBe(false);
    expect(mainDocumentMissing(view(decomposed))).toBe(false);
    expect(mainDocumentMissing(view("paper"))).toBe(true);
    expect(mainDocumentMissing(view("paper\\main.tex"))).toBe(true);
  });

  it("names each document kind", () => {
    for (const kind of ["document", "book", "presentation", "poster", "standalone", "typst", "markdown", "unknown"] as const) {
      expect(documentKindLabel(kind), kind).toBe(labels.kind[kind]);
    }
  });

  it("names every detection reason in strength order", () => {
    const reasons = [
      "placeholder",
      "no_begin_document",
      "standalone_figure",
      "has_bibliography",
      "includes_files",
      "top_level",
      "named_after_folder",
      "named_main",
      "declared",
    ] as const;
    expect(candidateReasonLine(candidate("main.tex", { reasons: [...reasons] }))).toBe(
      [...reasons].reverse().map((reason) => labels.reason[reason]).join(" · "),
    );
  });

  it("builds one reason line, strongest reason first", () => {
    expect(
      candidateReasonLine(
        candidate("main.tex", {
          reasons: ["top_level", "has_bibliography", "named_main", "includes_files"],
        }),
      ),
    ).toBe(
      [
        labels.reason.named_main,
        labels.reason.top_level,
        labels.reason.includes_files,
        labels.reason.has_bibliography,
      ].join(" · "),
    );
    expect(candidateReasonLine(candidate("x.tex", { reasons: [] }))).toBe("");
    expect(
      candidateReasonLine(candidate("figure.tex", { reasons: ["standalone_figure", "declared"] })),
    ).toBe([labels.reason.declared, labels.reason.standalone_figure].join(" · "));
  });
});
