import { describe, expect, it } from "vitest";
import {
  artifactId,
  artifactKind,
  artifactPreview,
  artifactSnippet,
  artifactsForNote,
  csvRows,
  noteForProject,
} from "./note-artifacts";
import type { ArtifactItem, NoteItem } from "./types";

function note(overrides: Partial<NoteItem> = {}): NoteItem {
  return {
    id: "note-1",
    title: "Masking",
    project: "SSL paper",
    relatedProjectId: "paper",
    updatedAt: 1_000,
    author: "you",
    summary: "",
    ...overrides,
  };
}

function artifact(overrides: Partial<ArtifactItem> = {}): ArtifactItem {
  return {
    id: "a",
    taskId: "task-1",
    path: "figs/loss.png",
    title: "Loss",
    kind: "figure",
    projectId: "paper",
    project: "SSL paper",
    updatedAt: 1_000,
    chat: "Sweep",
    summary: "",
    ...overrides,
  };
}

function content(overrides: Partial<Parameters<typeof artifactPreview>[1]> = {}): Parameters<typeof artifactPreview>[1] {
  return {
    exists: true,
    text: null,
    base64: null,
    mediaType: null,
    binary: false,
    truncated: false,
    ...overrides,
  };
}

describe("artifactKind", () => {
  it("treats Jupyter files as notebooks before anything else", () => {
    expect(artifactKind(file("runs/analysis.ipynb"))).toBe("notebook");
    expect(artifactKind(file("runs/ANALYSIS.IPYNB", "", "application/json"))).toBe("notebook");
    expect(artifactKind(file("runs/analysis", "", "application/x-ipynb+json"))).toBe("notebook");
  });

  it("treats HTML by extension or media type as a page", () => {
    expect(artifactKind(file("out/report.html"))).toBe("html");
    expect(artifactKind(file("out/REPORT.HTM"))).toBe("html");
    expect(artifactKind(file("out/page", "", "text/html"))).toBe("html");
  });

  it("treats images and PDFs as figures", () => {
    for (const path of ["a.png", "a.jpg", "a.JPEG", "a.gif", "a.webp", "a.svg", "paper.pdf"]) {
      expect(artifactKind(file(path))).toBe("figure");
    }
    expect(artifactKind(file("plot", "", "image/webp"))).toBe("figure");
  });

  it("treats tables and arrays as data", () => {
    for (const path of ["r.csv", "r.tsv", "r.json", "r.jsonl", "r.parquet", "r.npy", "r.npz", "r.h5", "r.hdf5", "r.xls", "r.xlsx"]) {
      expect(artifactKind(file(path))).toBe("data");
    }
    expect(artifactKind(file("rows", "", "text/csv"))).toBe("data");
    expect(artifactKind(file("rows", "", "application/json"))).toBe("data");
  });

  it("treats prose and logs as reports", () => {
    for (const path of ["a.md", "a.markdown", "a.txt", "a.tex", "a.typ", "run.log", "a.rst"]) {
      expect(artifactKind(file(path))).toBe("report");
    }
    expect(artifactKind(file("notes", "", "text/plain"))).toBe("report");
  });

  it("falls back to a plain file", () => {
    expect(artifactKind(file("model.bin"))).toBe("file");
    expect(artifactKind(file("model.bin", "", "application/octet-stream"))).toBe("file");
  });
});

describe("artifactId", () => {
  it("joins the task and the path", () => {
    expect(artifactId("task-1", "figs/loss.png")).toBe("task-1\nfigs/loss.png");
  });
});

describe("artifactsForNote", () => {
  const items = [artifact({ id: "a", projectId: "paper" }), artifact({ id: "b", projectId: "other" })];

  it("keeps the files of the note's related project", () => {
    expect(artifactsForNote(items, note()).map((item) => item.id)).toEqual(["a"]);
  });

  it("shows nothing for a missing note or one without a related project", () => {
    expect(artifactsForNote(items, null)).toEqual([]);
    expect(artifactsForNote(items, undefined)).toEqual([]);
    expect(artifactsForNote(items, note({ relatedProjectId: undefined }))).toEqual([]);
  });
});

describe("noteForProject", () => {
  it("picks the most recently updated note of the project", () => {
    const notes = [
      note({ id: "older", updatedAt: 1_000 }),
      note({ id: "elsewhere", relatedProjectId: "other", updatedAt: 9_000 }),
      note({ id: "newest", updatedAt: 3_000 }),
      note({ id: "middle", updatedAt: 2_000 }),
    ];
    expect(noteForProject(notes, "paper")?.id).toBe("newest");
  });

  it("finds nothing when no note belongs to the project", () => {
    expect(noteForProject([note({ relatedProjectId: undefined })], "paper")).toBeUndefined();
  });
});

describe("csvRows", () => {
  it("splits rows and cells", () => {
    expect(csvRows("a,b\n1,2\n", ",")).toEqual({ rows: [["a", "b"], ["1", "2"]], truncated: false });
  });

  it("reads quoted cells with separators, escaped quotes and line breaks", () => {
    expect(csvRows('"a,b",c\n"say ""hi""",d\n"two\nlines",e\n', ",")).toEqual({
      rows: [["a,b", "c"], ['say "hi"', "d"], ["two\nlines", "e"]],
      truncated: false,
    });
  });

  it("ignores carriage returns and drops blank rows", () => {
    expect(csvRows("a,b\r\n\r\n,\r\n1,2\r\n", ",")).toEqual({ rows: [["a", "b"], ["1", "2"]], truncated: false });
  });

  it("keeps a last row that has no line break, even an empty last cell", () => {
    expect(csvRows("a,b\n1,2", ",")).toEqual({ rows: [["a", "b"], ["1", "2"]], truncated: false });
    expect(csvRows("a,", ",")).toEqual({ rows: [["a", ""]], truncated: false });
  });

  it("reads nothing from empty text", () => {
    expect(csvRows("", ",")).toEqual({ rows: [], truncated: false });
  });

  it("cuts wide rows to eight columns", () => {
    expect(csvRows("1,2,3,4,5,6,7,8,9,10\n", ",")).toEqual({
      rows: [["1", "2", "3", "4", "5", "6", "7", "8"]],
      truncated: true,
    });
  });

  it("keeps twelve rows exactly without marking them cut", () => {
    const text = Array.from({ length: 12 }, (_, index) => `${index}`).join("\n");
    expect(csvRows(`${text}\n`, ",")).toEqual({ rows: Array.from({ length: 12 }, (_, index) => [`${index}`]), truncated: false });
  });

  it("cuts long tables to twelve rows", () => {
    const rows = Array.from({ length: 20 }, (_, index) => `${index},x`);
    const twelve = Array.from({ length: 12 }, (_, index) => [`${index}`, "x"]);
    expect(csvRows(`${rows.join("\n")}\n`, ",")).toEqual({ rows: twelve, truncated: true });
    expect(csvRows(rows.slice(0, 13).join("\n"), ",")).toEqual({ rows: twelve, truncated: true });
  });

  it("reads tab separated text", () => {
    expect(csvRows("a\tb,c\n1\t2", "\t")).toEqual({ rows: [["a", "b,c"], ["1", "2"]], truncated: false });
  });

  it("reads a quote inside a cell as text, like the table block does", () => {
    expect(csvRows('size,label\n5" screen,x\nnext,y\n', ",")).toEqual({
      rows: [["size", "label"], ['5" screen', "x"], ["next", "y"]],
      truncated: false,
    });
  });

  it("reads a file saved with Windows line endings, also inside quoted cells", () => {
    expect(csvRows('\uFEFFa,b\r\n"two\r\nlines",c\r\n', ",")).toEqual({
      rows: [["a", "b"], ["two\nlines", "c"]],
      truncated: false,
    });
  });
});

describe("artifactPreview", () => {
  const figure = { kind: "figure" as const, path: "figs/loss.png" };

  it("says when the file is gone", () => {
    expect(artifactPreview(figure, content({ exists: false }))).toEqual({ type: "none", reason: "missing" });
  });

  it("hands a notebook's text to the notebook view", () => {
    const notebook = { kind: "notebook" as const, path: "runs/a.ipynb" };
    expect(artifactPreview(notebook, content({ text: '{"nbformat": 4}' }))).toEqual({ type: "notebook", text: '{"nbformat": 4}' });
  });

  it("says a notebook without text is too large to preview", () => {
    const notebook = { kind: "notebook" as const, path: "runs/a.ipynb" };
    expect(artifactPreview(notebook, content({ text: null, binary: true, truncated: true }))).toEqual({
      type: "none",
      reason: "large",
    });
    expect(artifactPreview(notebook, content({ exists: false }))).toEqual({ type: "none", reason: "missing" });
  });

  it("never previews HTML", () => {
    expect(artifactPreview({ kind: "html", path: "out/page.html" }, content({ text: "<p>x</p>" }))).toEqual({
      type: "none",
      reason: "html",
    });
  });

  it("shows images as data URLs", () => {
    expect(artifactPreview(figure, content({ base64: "AAAA", mediaType: "image/png" }))).toEqual({
      type: "image",
      src: "data:image/png;base64,AAAA",
    });
  });

  it("shows SVG sent as text as an image", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    expect(artifactPreview({ kind: "figure", path: "figs/a.svg" }, content({ text: svg, mediaType: "image/svg+xml" }))).toEqual({
      type: "image",
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    });
  });

  it("calls files without text binary", () => {
    expect(artifactPreview(figure, content({ binary: true }))).toEqual({ type: "none", reason: "binary" });
    expect(artifactPreview({ kind: "figure", path: "paper.pdf" }, content({ base64: "JVBE", mediaType: "application/pdf" }))).toEqual({
      type: "none",
      reason: "binary",
    });
    expect(artifactPreview({ kind: "figure", path: "a.svg" }, content({ mediaType: "image/svg+xml" }))).toEqual({
      type: "none",
      reason: "binary",
    });
  });

  it("shows CSV and TSV files as tables", () => {
    expect(artifactPreview({ kind: "data", path: "r.csv" }, content({ text: "a,b\n1,2\n", mediaType: "text/csv" }))).toEqual({
      type: "table",
      rows: [["a", "b"], ["1", "2"]],
      truncated: false,
    });
    expect(artifactPreview({ kind: "data", path: "r.TSV" }, content({ text: "a\tb\n", truncated: true }))).toEqual({
      type: "table",
      rows: [["a", "b"]],
      truncated: true,
    });
    expect(artifactPreview({ kind: "data", path: "r.csv" }, content({ text: "1,2,3,4,5,6,7,8,9\n" }))).toEqual({
      type: "table",
      rows: [["1", "2", "3", "4", "5", "6", "7", "8"]],
      truncated: true,
    });
  });

  it("falls back to text for a table with no rows", () => {
    expect(artifactPreview({ kind: "data", path: "r.csv" }, content({ text: "\n,\n" }))).toEqual({
      type: "text",
      text: "\n,\n",
      truncated: false,
    });
  });

  it("shows text and cuts it at 4000 characters", () => {
    const report = { kind: "report" as const, path: "notes.md" };
    expect(artifactPreview(report, content({ text: "hello", mediaType: "text/markdown" }))).toEqual({
      type: "text",
      text: "hello",
      truncated: false,
    });
    expect(artifactPreview(report, content({ text: "hello", truncated: true }))).toEqual({
      type: "text",
      text: "hello",
      truncated: true,
    });
    expect(artifactPreview(report, content({ text: "x".repeat(4001) }))).toEqual({
      type: "text",
      text: "x".repeat(4000),
      truncated: true,
    });
    expect(artifactPreview(report, content({ text: "x".repeat(4000) }))).toEqual({
      type: "text",
      text: "x".repeat(4000),
      truncated: false,
    });
  });
});

describe("artifactSnippet", () => {
  it("embeds notebooks as a notebook block", () => {
    expect(artifactSnippet({ kind: "notebook", title: "Run [3]" }, "assets/analysis-1a2b3c4d.ipynb")).toBe(
      "```notebook\nassets/analysis-1a2b3c4d.ipynb\n```",
    );
  });

  it("embeds figures as images", () => {
    expect(artifactSnippet({ kind: "figure", title: "Loss curve" }, "assets/loss.png")).toBe("![Loss curve](assets/loss.png)");
  });

  it("links PDFs and other files", () => {
    expect(artifactSnippet({ kind: "figure", title: "Plot" }, "assets/plot.PDF")).toBe("[Plot](assets/plot.PDF)");
    expect(artifactSnippet({ kind: "report", title: "Report" }, "assets/report.md")).toBe("[Report](assets/report.md)");
  });

  it("escapes brackets and backslashes in the title", () => {
    expect(artifactSnippet({ kind: "data", title: "a [b] \\ c" }, "r.csv")).toBe("[a \\[b\\] \\\\ c](r.csv)");
  });

  it("wraps paths with spaces, parentheses or angle brackets", () => {
    expect(artifactSnippet({ kind: "figure", title: "Plot" }, "assets/my plot.png")).toBe("![Plot](<assets/my plot.png>)");
    expect(artifactSnippet({ kind: "report", title: "Run" }, "assets/run(1).md")).toBe("[Run](<assets/run(1).md>)");
  });
});

function file(path: string, label = "", mediaType: string | null = null) { return { path, label, mediaType }; }
