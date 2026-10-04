import { describe, expect, it, vi } from "vitest";
import { base64ToBytes, bytesToBase64 } from "@/lib/base64";
import type { AdHocConversionRequest, CompileResult } from "@/lib/tauri";
import {
  carrySharedDefinitions,
  fixImagePaths,
  fixUnconvertedMath,
  numberLabelledEquations,
  prepareLatexProject,
  runLatexToTypstMigration,
  splitConvertedIncludes,
  typstStyleForBibtex,
  type MigrationDeps,
} from "./latex-to-typst-migration";

const NUMBERING = '#set math.equation(numbering: "(1)")';

function encode(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

const INCLUDES = prepareLatexProject(
  "main.tex",
  new Map([
    ["main.tex", [String.raw`\begin{document}`, String.raw`\include{one}`, String.raw`\end{document}`].join("\n")],
    ["one.tex", "One."],
  ]),
).includes;

describe("splitting converted includes that Pandoc damaged", () => {
  it("drops placeholders and markers that ended up inside a line", () => {
    const split = splitConvertedIncludes(
      ["Text OLEAFLYRAW0 more", "OLEAFLYRAW7", "Before OLEAFLYINCLUDEBEGIN0 after"].join("\n"),
      INCLUDES,
      ["#outline()"],
    );

    expect(split.main).toBe(["Text  more", "", "Before  after"].join("\n"));
    expect(split.lost).toEqual([0]);
  });

  it("keeps the text of unknown and unopened includes in place", () => {
    const split = splitConvertedIncludes(["OLEAFLYINCLUDEBEGIN9", "Kept.", "OLEAFLYINCLUDEEND0", "Tail."].join("\n"), INCLUDES);

    expect(split.main).toBe("Kept.\nTail.");
    expect(split.parts).toEqual([]);
    expect([...split.lost].sort((a, b) => a - b)).toEqual([0, 9]);
  });
});

describe("fixing converted Typst", () => {
  it("leaves web and absolute image paths alone", () => {
    const text = 'image("https://example.com/a.png") image("/abs/b.png")';

    expect(fixImagePaths(text, "main.typ", new Set(), [])).toEqual({ text, missing: [], unsupported: [] });
  });

  it("converts inline math and leaves display math it does not need or cannot convert", () => {
    const text = [
      String.raw`Inline \$\\alpha + 1\$ here.`,
      String.raw`\$\$x + y\$\$`,
      String.raw`\$\$\\weirdmacro{a}\$\$`,
      String.raw`\$\$\\beta\$\$`,
    ].join("\n\n");

    const result = fixUnconvertedMath(text, null);

    expect(result.text.split("\n\n")).toEqual([
      "Inline $alpha + 1$ here.",
      String.raw`\$\$x + y\$\$`,
      String.raw`\$\$\\weirdmacro{a}\$\$`,
      "$ beta $",
    ]);
    expect(result.fixed).toEqual([String.raw`\beta`, String.raw`\alpha + 1`]);
    expect(result.remaining).toEqual([String.raw`\weirdmacro{a}`]);
  });

  it("puts equation numbering where the template call ends", () => {
    const labelled = ["$ x $<eq:a>"];

    expect(numberLabelledEquations("= Intro", labelled)).toBe(`${NUMBERING}\n= Intro`);
    expect(numberLabelledEquations("#show: doc => conf(\n  doc,", labelled)).toBe(`${NUMBERING}\n#show: doc => conf(\n  doc,`);
    expect(numberLabelledEquations('#show: doc => conf(title: "a ) \\" b", doc)', labelled)).toBe(
      `#show: doc => conf(title: "a ) \\" b", doc)\n${NUMBERING}`,
    );
  });

  it("knows no style without a BibTeX style and copies nothing without a template call", () => {
    expect(typstStyleForBibtex(null)).toBeNull();
    expect(carrySharedDefinitions("#let x = 1\n= Body", "Uses #x")).toBe("Uses #x");
  });
});

describe("migration notes", () => {
  const LONG = "a".repeat(200);

  function deps(typst: string, compile: CompileResult): MigrationDeps {
    const texts: Record<string, string> = {
      "main.tex": [String.raw`\begin{document}`, String.raw`\include{one}`, String.raw`\end{document}`].join("\n"),
      "one.tex": "One.",
    };
    return {
      listFiles: vi.fn(async () => Object.keys(texts).map((path) => ({ path, is_dir: false }))),
      readFileBase64: vi.fn(async (_id: string, path: string) => encode(texts[path] ?? "")),
      ensurePandoc: vi.fn(async () => true),
      convert: vi.fn(async (_request: AdHocConversionRequest) => ({
        kind: "text" as const,
        text: typst,
        dataBase64: null,
        fileName: "converted.typ",
        mediaType: "text/x-typst",
        files: [],
        report: [],
      })),
      createProject: vi.fn(async () => "new-project"),
      compile: vi.fn(async () => compile),
    };
  }

  const compiled: CompileResult = {
    ok: false,
    has_pdf: false,
    output_id: null,
    output_revision: null,
    log: "",
    errors: [
      { file: null, line: null, message: "general", kind: "warning", explanation: null },
      { file: "./main.typ", line: 1, message: "relative", kind: "error", explanation: null },
      { file: "/tmp/build/one.typ", line: 2, message: "absolute", kind: "error", explanation: null },
    ],
    diagnostics: [{ severity: "error", message: "not a warning", file: "main.typ", line: 1, category: "error" }],
    synctex_path: null,
    out_dir: null,
    compile_time_ms: 1,
  };

  it("notes a lost include, shortens long math and maps compile problems to the new files", async () => {
    const typst = ["= Intro", "OLEAFLYINCLUDEBEGIN0", "One.", String.raw`\$\\weirdmacro{${LONG}}\$`].join("\n\n");
    const fake = deps(typst, compiled);

    const report = await runLatexToTypstMigration(
      { projectId: "p", mainDoc: "./main.tex", name: "Paper", typstVersion: null },
      fake,
    );

    expect(report.attention).toContainEqual({ kind: "lostInclude", detail: "one.tex", source: { file: "main.tex", line: 2 } });
    const math = report.attention.find((note) => note.kind === "math");
    expect(math?.detail).toHaveLength(160);
    expect(math?.detail.endsWith("...")).toBe(true);
    expect(report.compile?.problems).toEqual([
      { severity: "warning", message: "general", file: null, line: null },
      { severity: "error", message: "relative", file: "main.typ", line: 1 },
      { severity: "error", message: "absolute", file: "/tmp/build/one.typ", line: 2 },
    ]);
    const created = vi.mocked(fake.createProject).mock.calls[0][0];
    const main = new TextDecoder().decode(base64ToBytes(created.files.find((file) => file.path === "main.typ")?.dataBase64 ?? ""));
    expect(main).toContain("One.");
  });
});
