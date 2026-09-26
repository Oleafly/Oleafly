import { describe, expect, it } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import type { DetectionCandidate, FolderDetection } from "@/lib/folder-detection";
import {
  ALL_MAIN_EXTENSIONS,
  candidateReasonLine,
  compactDocumentPath,
  documentKindLabel,
  isLinkedHome,
  mainDocumentMissing,
  otherDocuments,
  sameDocumentPath,
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

function detection(candidates: DetectionCandidate[], main: string | null): FolderDetection {
  return {
    main,
    decision: main ? "auto" : "ask",
    source: "scan",
    candidates,
    truncated: false,
    compile_dir: null,
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
    expect(sameDocumentPath("Paper/Main.tex", "paper/main.tex")).toBe(true);
    expect(sameDocumentPath(composed, decomposed)).toBe(true);
    expect(sameDocumentPath("paper/main.tex", "paper/intro.tex")).toBe(false);
  });

  it("shortens a long main path from the folder side and keeps the file name whole", () => {
    expect(compactDocumentPath("paper/main.tex")).toBe("paper/main.tex");
    expect(compactDocumentPath("thesis/chapters/part-one/appendices/final/main.tex")).toBe(
      "…/appendices/final/main.tex",
    );
    expect(compactDocumentPath("a-very-long-folder-name-for-the-thesis/main.tex")).toBe("…/main.tex");
    expect(compactDocumentPath("a-file-name-that-is-longer-than-the-whole-budget.tex")).toBe(
      "a-file-name-that-is-longer-than-the-whole-budget.tex",
    );
    expect(
      compactDocumentPath("folder/a-file-name-that-is-longer-than-the-whole-budget.tex"),
    ).toBe("a-file-name-that-is-longer-than-the-whole-budget.tex");
  });

  it("does not list the main again when its spelling differs from the scan", () => {
    const found = detection(
      [candidate("Paper/Main.tex"), candidate("slides/talk.tex", { kind: "presentation" })],
      "Paper/Main.tex",
    );
    expect(otherDocuments(found, "paper/main.tex").map((entry) => entry.path)).toEqual([
      "slides/talk.tex",
    ]);
  });

  it("lists the other real documents, not fragments or the current main", () => {
    const found = detection(
      [
        candidate("paper/main.tex", { kind: "document" }),
        candidate("slides/talk.tex", { kind: "presentation", class: "beamer" }),
        candidate("poster/poster.tex", { kind: "poster" }),
        candidate("notes.typ", { family: "typst", tier: "a", kind: "typst", class: null }),
        candidate("figures/plot.tex", { tier: "w", kind: "standalone", class: "standalone" }),
      ],
      "paper/main.tex",
    );
    expect(otherDocuments(found, "paper/main.tex").map((entry) => entry.path)).toEqual([
      "slides/talk.tex",
      "poster/poster.tex",
      "notes.typ",
    ]);
    expect(otherDocuments(found, "slides/talk.tex").map((entry) => entry.path)).toEqual([
      "paper/main.tex",
      "poster/poster.tex",
      "notes.typ",
    ]);
    expect(otherDocuments(null, "paper/main.tex")).toEqual([]);
  });

  it("names each document kind", () => {
    expect(documentKindLabel("presentation")).toBe(labels.kind.presentation);
    expect(documentKindLabel("typst")).toBe(labels.kind.typst);
    expect(documentKindLabel("unknown")).toBe(labels.kind.unknown);
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
