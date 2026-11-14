import { beforeEach, describe, expect, it, vi } from "vitest";

const readFileContentMock = vi.hoisted(() =>
  vi.fn<(projectId: string, path: string) => Promise<string>>(() =>
    Promise.reject(new Error("the project sandbox must not serve build output")),
  ),
);
const readBuildArtifactMock = vi.hoisted(() =>
  vi.fn<(projectId: string, name: string) => Promise<string | null>>(async () => null),
);

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readFileContent: readFileContentMock,
  readBuildArtifact: readBuildArtifactMock,
}));

import {
  auxNumberFor,
  auxNumberForDefinition,
  clearAuxNumbers,
  currentAuxToc,
  installAuxNumbers,
  parseAuxLabels,
  parseAuxToc,
  refreshAuxNumbers,
  subscribeAuxNumbers,
} from "./aux-numbers";
import { createCompileSuccessCheckpoint } from "@/lib/compile-checkpoint";
import type { LatexUnitScope } from "@/lib/project-intelligence/latex-units";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";

const ENTRY_AUX = "_oleafly_entry.aux";

function serveAuxFiles(files: Record<string, string>): void {
  readBuildArtifactMock.mockImplementation(async (_projectId, name) => files[name] ?? null);
}

function seedFilesStore(projectId: string | null, mainDoc: string): void {
  useFilesStore.setState({
    projectId,
    mainDoc,
    activePath: null,
    tree: [],
    files: {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearAuxNumbers();
  readFileContentMock.mockImplementation(() =>
    Promise.reject(new Error("the project sandbox must not serve build output")),
  );
  readBuildArtifactMock.mockImplementation(async () => null);
  seedFilesStore(null, "main.tex");
});

describe("parseAuxLabels", () => {
  it("parses a plain \\newlabel record", () => {
    const map = parseAuxLabels("\\newlabel{sec:intro}{{1.2}{7}}\n");
    expect(map.get("sec:intro")).toEqual({ number: "1.2", page: "7" });
  });

  it("parses hyperref records and skips the @cref sibling", () => {
    const aux = [
      "\\newlabel{eq:a}{{3}{12}{}{equation.3}{}}",
      "\\newlabel{eq:a@cref}{{[equation][3][]3}{[1][12][]12}}",
    ].join("\n");
    const map = parseAuxLabels(aux);
    expect(map.get("eq:a")).toEqual({ number: "3", page: "12" });
    expect(map.has("eq:a@cref")).toBe(false);
    expect(map.size).toBe(1);
  });

  it("handles nested braces in the number group", () => {
    const map = parseAuxLabels("\\newlabel{app:b}{{A.1.b}{33}}\n\\newlabel{fig:x}{{{\\relax 2.1}}{9}}");
    expect(map.get("app:b")).toEqual({ number: "A.1.b", page: "33" });
    expect(map.get("fig:x")).toEqual({ number: "{\\relax 2.1}", page: "9" });
  });

  it("tolerates a \\relax tail after the payload", () => {
    const map = parseAuxLabels("\\newlabel{thm:main}{{4}{21}}\\relax\n");
    expect(map.get("thm:main")).toEqual({ number: "4", page: "21" });
  });

  it("ignores malformed and unrelated lines", () => {
    const aux = [
      "\\relax",
      "\\@writefile{toc}{\\contentsline {section}{Intro}{1}}",
      "\\newlabel{broken",
      "\\newlabel{no-payload}",
      "\\newlabel{half}{{1}",
      "\\newlabel{}{{1}{1}}",
      "\\newlabel{good}{{5}{6}}",
    ].join("\n");
    const map = parseAuxLabels(aux);
    expect(map.size).toBe(1);
    expect(map.get("good")).toEqual({ number: "5", page: "6" });
  });

  it("slices the input head at 1 MB", () => {
    const early = "\\newlabel{early}{{1}{1}}\n";
    const padding = "%".repeat(1024 * 1024);
    const late = "\n\\newlabel{late}{{2}{2}}\n";
    const map = parseAuxLabels(early + padding + late);
    expect(map.has("early")).toBe(true);
    expect(map.has("late")).toBe(false);
  });
});

describe("refreshAuxNumbers", () => {
  it("reads the entry aux and caches its labels", async () => {
    serveAuxFiles({ [ENTRY_AUX]: "\\newlabel{sec:intro}{{1}{2}}\n" });
    seedFilesStore("p1", "main.tex");
    await refreshAuxNumbers("p1", "main.tex", "out-1");
    expect(readBuildArtifactMock).toHaveBeenCalledWith("p1", ENTRY_AUX);
    expect(auxNumberFor("sec:intro")).toEqual({ number: "1", page: "2" });
  });

  it("numbers a label only in the document that was compiled", async () => {
    serveAuxFiles({ [ENTRY_AUX]: "\\newlabel{sec:a}{{1}{2}}\n" });
    seedFilesStore("p1", "main.tex");
    await refreshAuxNumbers("p1", "main.tex", "out-1");
    const scope = {
      sharesScope: (left: string, right: string) => left === right,
    } as LatexUnitScope;
    expect(auxNumberForDefinition("sec:a", "main.tex", scope)).toEqual({ number: "1", page: "2" });
    expect(auxNumberForDefinition("sec:a", "manuscript_v1.tex", scope)).toBeNull();
    expect(auxNumberForDefinition("sec:a", "manuscript_v1.tex", undefined)).toEqual({
      number: "1",
      page: "2",
    });
  });

  it("is a no-op when the cached output identity matches", async () => {
    serveAuxFiles({ [ENTRY_AUX]: "\\newlabel{a}{{1}{1}}\n" });
    seedFilesStore("p1", "main.tex");
    await refreshAuxNumbers("p1", "main.tex", "out-1");
    expect(readBuildArtifactMock).toHaveBeenCalledTimes(1);
    await refreshAuxNumbers("p1", "main.tex", "out-1");
    expect(readBuildArtifactMock).toHaveBeenCalledTimes(1);
    await refreshAuxNumbers("p1", "main.tex", "out-2");
    expect(readBuildArtifactMock).toHaveBeenCalledTimes(2);
  });

  it("follows \\@input references cycle-safely and merges labels", async () => {
    serveAuxFiles({
      [ENTRY_AUX]:
        "\\newlabel{root}{{1}{1}}\n\\@input{chapters/ch1.aux}\n\\@input{_oleafly_entry.aux}\n",
      "chapters/ch1.aux":
        "\\newlabel{ch1:label}{{2.1}{14}}\n\\@input{chapters/ch1.aux}\n",
    });
    seedFilesStore("p1", "main.tex");
    await refreshAuxNumbers("p1", "main.tex", "out-1");
    expect(readBuildArtifactMock).toHaveBeenCalledTimes(2);
    expect(auxNumberFor("root")).toEqual({ number: "1", page: "1" });
    expect(auxNumberFor("ch1:label")).toEqual({ number: "2.1", page: "14" });
  });

  it("survives a missing child aux and keeps the readable labels", async () => {
    serveAuxFiles({
      [ENTRY_AUX]: "\\newlabel{root}{{1}{1}}\n\\@input{missing.aux}\n",
    });
    seedFilesStore("p1", "main.tex");
    await refreshAuxNumbers("p1", "main.tex", "out-1");
    expect(auxNumberFor("root")).toEqual({ number: "1", page: "1" });
  });

  it("keeps the old cache silently when the entry aux is unreadable", async () => {
    serveAuxFiles({ [ENTRY_AUX]: "\\newlabel{keep}{{1}{1}}\n" });
    seedFilesStore("p1", "main.tex");
    await refreshAuxNumbers("p1", "main.tex", "out-1");
    expect(auxNumberFor("keep")).toEqual({ number: "1", page: "1" });

    serveAuxFiles({});
    await refreshAuxNumbers("p1", "main.tex", "out-2");
    expect(auxNumberFor("keep")).toEqual({ number: "1", page: "1" });
  });

  it("reads a linked folder's aux chain from its build output, not its files", async () => {
    const projectId = "linked-0123456789abcdef0123456789abcdef";
    serveAuxFiles({
      [ENTRY_AUX]: "\\newlabel{root}{{1}{1}}\n\\@input{chapters/ch1.aux}\n",
      "chapters/ch1.aux": "\\newlabel{ch1}{{2.1}{14}}\n",
    });
    seedFilesStore(projectId, "main.tex");
    await refreshAuxNumbers(projectId, "main.tex", "out-1");
    expect(readBuildArtifactMock.mock.calls).toEqual([
      [projectId, ENTRY_AUX],
      [projectId, "chapters/ch1.aux"],
    ]);
    expect(readFileContentMock).not.toHaveBeenCalled();
    expect(auxNumberFor("ch1")).toEqual({ number: "2.1", page: "14" });
  });

  it("keeps the old cache silently when the build output read is refused", async () => {
    serveAuxFiles({ [ENTRY_AUX]: "\\newlabel{keep}{{1}{1}}\n" });
    seedFilesStore("p1", "main.tex");
    await refreshAuxNumbers("p1", "main.tex", "out-1");
    readBuildArtifactMock.mockRejectedValue(new Error("not a readable build artifact"));
    await refreshAuxNumbers("p1", "main.tex", "out-2");
    expect(auxNumberFor("keep")).toEqual({ number: "1", page: "1" });
  });
});

const tocLine = (kind: string, text: string, anchor = "x") =>
  String.raw`\@writefile{toc}{\contentsline {${kind}}{${text}}{1}{${anchor}}\protected@file@percent }`;

describe("parseAuxToc", () => {
  it("reads numbered and unnumbered headings and ignores other lists", () => {
    const aux = [
      String.raw`\relax`,
      tocLine("section", String.raw`\numberline {1}Introduction`, "section.1"),
      tocLine("section", "Acknowledgments", "section*.2"),
      String.raw`\@writefile{lof}{\contentsline {figure}{\numberline {1}{\ignorespaces A plot}}{3}{figure.1}}`,
      String.raw`\@writefile{toc}{\boolfalse {citerequest}}`,
      tocLine("subsection", String.raw`\numberline {6.2}Results on a {\em small} dataset`),
      tocLine("theorem", String.raw`\numberline {3}Not a heading`),
      String.raw`\newlabel{sec:a}{{1}{1}}`,
    ].join("\n");
    expect(parseAuxToc(new Map([[ENTRY_AUX, aux]]))).toEqual([
      { level: 2, number: "1", title: "Introduction" },
      { level: 2, number: null, title: "Acknowledgments" },
      { level: 3, number: "6.2", title: String.raw`Results on a {\em small} dataset` },
    ]);
  });

  it("reads the numbers of parts and of the AMS and memoir classes", () => {
    const aux = [
      tocLine("part", String.raw`II\hspace {1em}Applications`),
      tocLine("chapter", String.raw`\chapternumberline {3}Flows`),
      tocLine("section", String.raw`\tocsection {Appendix}{A}{Proofs}`),
      tocLine("chapter", String.raw`\numberline {}Preface`),
    ].join("\n");
    expect(parseAuxToc(new Map([[ENTRY_AUX, aux]]))).toEqual([
      { level: 0, number: "II", title: "Applications" },
      { level: 1, number: "3", title: "Flows" },
      { level: 2, number: "A", title: "Proofs" },
      { level: 1, number: null, title: "Preface" },
    ]);
  });

  it("reads an included file's headings where it is included, once", () => {
    const files = new Map([
      [
        ENTRY_AUX,
        [
          tocLine("chapter", String.raw`\numberline {1}One`),
          String.raw`\@input{chapters/two.aux}`,
          tocLine("chapter", String.raw`\numberline {3}Three`),
          String.raw`\@input{chapters/two.aux}`,
          String.raw`\@input{../outside.aux}`,
        ].join("\n"),
      ],
      ["chapters/two.aux", tocLine("chapter", String.raw`\numberline {2}Two`)],
      ["../outside.aux", tocLine("chapter", String.raw`\numberline {9}Outside`)],
    ]);
    expect(parseAuxToc(files).map((entry) => entry.number)).toEqual(["1", "2", "3"]);
  });

  it("stops at a record that never closes, so a crafted aux stays fast", () => {
    const truncated = [
      tocLine("section", String.raw`\numberline {1}Intro`),
      String.raw`\@writefile{toc}{\contentsline {section}{\numberline {2}Cut`,
    ].join("\n");
    expect(parseAuxToc(new Map([[ENTRY_AUX, truncated]])).map((entry) => entry.number)).toEqual(["1"]);
    const crafted = String.raw`\@writefile{toc}{`.repeat(60_000);
    const started = performance.now();
    expect(parseAuxToc(new Map([[ENTRY_AUX, crafted]]))).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("currentAuxToc", () => {
  it("holds the compiled contents and tells subscribers when they change", async () => {
    serveAuxFiles({
      [ENTRY_AUX]: `${tocLine("section", String.raw`\numberline {1}Intro`)}\n\\@input{ch.aux}\n`,
      "ch.aux": tocLine("section", String.raw`\numberline {2}Body`),
    });
    seedFilesStore("p1", "main.tex");
    const listener = vi.fn();
    const unsubscribe = subscribeAuxNumbers(listener);
    await refreshAuxNumbers("p1", "main.tex", "out-1");
    const toc = currentAuxToc();
    expect(toc).toEqual({
      projectId: "p1",
      mainDocument: "main.tex",
      entries: [
        { level: 2, number: "1", title: "Intro" },
        { level: 2, number: "2", title: "Body" },
      ],
    });
    expect(currentAuxToc()).toBe(toc);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    clearAuxNumbers();
    expect(currentAuxToc()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("auxNumberFor identity guards", () => {
  beforeEach(async () => {
    serveAuxFiles({ [ENTRY_AUX]: "\\newlabel{sec:x}{{3}{9}}\n" });
    await refreshAuxNumbers("p1", "main.tex", "out-1");
  });

  it("returns hits only for the current project", () => {
    seedFilesStore("p1", "main.tex");
    expect(auxNumberFor("sec:x")).toEqual({ number: "3", page: "9" });
    seedFilesStore("p2", "main.tex");
    expect(auxNumberFor("sec:x")).toBeNull();
    seedFilesStore(null, "main.tex");
    expect(auxNumberFor("sec:x")).toBeNull();
  });

  it("returns null when the effective main document differs", () => {
    seedFilesStore("p1", "thesis.tex");
    expect(auxNumberFor("sec:x")).toBeNull();
    seedFilesStore("p1", "main.tex");
    expect(auxNumberFor("sec:x")).toEqual({ number: "3", page: "9" });
  });

  it("returns null for unknown labels and after clearAuxNumbers", () => {
    seedFilesStore("p1", "main.tex");
    expect(auxNumberFor("nope")).toBeNull();
    clearAuxNumbers();
    expect(auxNumberFor("sec:x")).toBeNull();
  });
});

describe("installAuxNumbers", () => {
  it("refreshes on a new successful compile checkpoint, idempotently", async () => {
    serveAuxFiles({ [ENTRY_AUX]: "\\newlabel{fig:one}{{1}{5}}\n" });
    seedFilesStore("p1", "main.tex");
    installAuxNumbers();
    installAuxNumbers();

    const checkpoint = createCompileSuccessCheckpoint({
      projectId: "p1",
      mainDocument: "main.tex",
      outputKind: "standard",
      producerId: "test-producer",
      outputRevision: 1,
      outputId: "pdf-v1:10:0123456789abcdef",
      previousCompletedAt: null,
    });
    useCompileStore.setState({
      status: "success",
      lastCompileCheckpoint: checkpoint,
    });

    await vi.waitFor(() =>
      expect(auxNumberFor("fig:one")).toEqual({ number: "1", page: "5" }),
    );
    expect(readBuildArtifactMock).toHaveBeenCalledTimes(1);

    useCompileStore.setState({ log: "noise" });
    await Promise.resolve();
    expect(readBuildArtifactMock).toHaveBeenCalledTimes(1);
  });
});

describe("installAuxNumbers after a compile", () => {
  it("reads the aux of a compile that finished before the install", async () => {
    vi.resetModules();
    const aux = await import("./aux-numbers");
    const { useCompileStore: compileStore } = await import("@/store/compile");
    const { useFilesStore: filesStore } = await import("@/store/files");
    serveAuxFiles({ [ENTRY_AUX]: "\\newlabel{fig:one}{{1}{5}}\n" });
    filesStore.setState({ projectId: "p1", mainDoc: "main.tex", activePath: null, tree: [], files: {} });
    compileStore.setState({
      status: "success",
      lastCompileCheckpoint: createCompileSuccessCheckpoint({
        projectId: "p1",
        mainDocument: "main.tex",
        outputKind: "standard",
        producerId: "test-producer",
        outputRevision: 1,
        outputId: "pdf-v1:10:0123456789abcdef",
        previousCompletedAt: null,
      }),
    });

    aux.installAuxNumbers();

    await vi.waitFor(() => expect(aux.auxNumberFor("fig:one")).toEqual({ number: "1", page: "5" }));
  });
});
