import { beforeEach, describe, expect, it, vi } from "vitest";

const readFileContentMock = vi.hoisted(() =>
  vi.fn<(projectId: string, path: string) => Promise<string>>(() =>
    Promise.reject(new Error("no aux configured")),
  ),
);

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readFileContent: readFileContentMock,
}));

import {
  auxNumberFor,
  clearAuxNumbers,
  installAuxNumbers,
  parseAuxLabels,
  refreshAuxNumbers,
} from "./aux-numbers";
import { createCompileSuccessCheckpoint } from "@/lib/compile-checkpoint";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";

const ENTRY_PATH = ".oleafly/build/_oleafly_entry.aux";

/** Routes mocked reads by build-relative path; unknown paths reject. */
function serveAuxFiles(files: Record<string, string>): void {
  readFileContentMock.mockImplementation((_projectId, path) => {
    const content = files[path];
    return content === undefined
      ? Promise.reject(new Error(`missing ${path}`))
      : Promise.resolve(content);
  });
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
    Promise.reject(new Error("no aux configured")),
  );
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
      "\\newlabel{broken", // unbalanced name group
      "\\newlabel{no-payload}", // missing payload group
      "\\newlabel{half}{{1}", // unbalanced payload
      "\\newlabel{}{{1}{1}}", // empty name
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
    serveAuxFiles({ [ENTRY_PATH]: "\\newlabel{sec:intro}{{1}{2}}\n" });
    seedFilesStore("p1", "main.tex");
    await refreshAuxNumbers("p1", "main.tex", "out-1");
    expect(readFileContentMock).toHaveBeenCalledWith("p1", ENTRY_PATH);
    expect(auxNumberFor("sec:intro")).toEqual({ number: "1", page: "2" });
  });

  it("is a no-op when the cached output identity matches", async () => {
    serveAuxFiles({ [ENTRY_PATH]: "\\newlabel{a}{{1}{1}}\n" });
    seedFilesStore("p1", "main.tex");
    await refreshAuxNumbers("p1", "main.tex", "out-1");
    expect(readFileContentMock).toHaveBeenCalledTimes(1);
    await refreshAuxNumbers("p1", "main.tex", "out-1");
    expect(readFileContentMock).toHaveBeenCalledTimes(1);
    // A new output id re-reads.
    await refreshAuxNumbers("p1", "main.tex", "out-2");
    expect(readFileContentMock).toHaveBeenCalledTimes(2);
  });

  it("follows \\@input references cycle-safely and merges labels", async () => {
    serveAuxFiles({
      [ENTRY_PATH]:
        "\\newlabel{root}{{1}{1}}\n\\@input{chapters/ch1.aux}\n\\@input{_oleafly_entry.aux}\n",
      ".oleafly/build/chapters/ch1.aux":
        "\\newlabel{ch1:label}{{2.1}{14}}\n\\@input{chapters/ch1.aux}\n",
    });
    seedFilesStore("p1", "main.tex");
    await refreshAuxNumbers("p1", "main.tex", "out-1");
    // Entry + child exactly once each despite both cycles.
    expect(readFileContentMock).toHaveBeenCalledTimes(2);
    expect(auxNumberFor("root")).toEqual({ number: "1", page: "1" });
    expect(auxNumberFor("ch1:label")).toEqual({ number: "2.1", page: "14" });
  });

  it("survives a missing child aux and keeps the readable labels", async () => {
    serveAuxFiles({
      [ENTRY_PATH]: "\\newlabel{root}{{1}{1}}\n\\@input{missing.aux}\n",
    });
    seedFilesStore("p1", "main.tex");
    await refreshAuxNumbers("p1", "main.tex", "out-1");
    expect(auxNumberFor("root")).toEqual({ number: "1", page: "1" });
  });

  it("keeps the old cache silently when the entry aux is unreadable", async () => {
    serveAuxFiles({ [ENTRY_PATH]: "\\newlabel{keep}{{1}{1}}\n" });
    seedFilesStore("p1", "main.tex");
    await refreshAuxNumbers("p1", "main.tex", "out-1");
    expect(auxNumberFor("keep")).toEqual({ number: "1", page: "1" });

    serveAuxFiles({}); // every read now fails
    await refreshAuxNumbers("p1", "main.tex", "out-2");
    expect(auxNumberFor("keep")).toEqual({ number: "1", page: "1" });
  });
});

describe("auxNumberFor identity guards", () => {
  beforeEach(async () => {
    serveAuxFiles({ [ENTRY_PATH]: "\\newlabel{sec:x}{{3}{9}}\n" });
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
    serveAuxFiles({ [ENTRY_PATH]: "\\newlabel{fig:one}{{1}{5}}\n" });
    seedFilesStore("p1", "main.tex");
    installAuxNumbers();
    installAuxNumbers(); // second install must not double-subscribe

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
    expect(readFileContentMock).toHaveBeenCalledTimes(1);

    // Unrelated store updates with the same checkpoint do not re-read.
    useCompileStore.setState({ log: "noise" });
    await Promise.resolve();
    expect(readFileContentMock).toHaveBeenCalledTimes(1);
  });
});
