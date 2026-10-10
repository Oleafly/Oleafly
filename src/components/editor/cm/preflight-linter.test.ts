import { beforeEach, describe, expect, it } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { preflightDiagnostics } from "./preflight-linter";

const TYPST_ENGINE = {
  ...LATEX_ENGINE,
  id: "typst" as const,
  label: "Typst",
  source_format: "typst" as const,
  main_document: "main.typ",
  source_extensions: ["typ"],
  capabilities: {
    ...LATEX_ENGINE.capabilities,
    formatting_profile: "typst" as const,
    source_preflight_profile: "typst" as const,
  },
};

beforeEach(() => {
  useFilesStore.setState({ engine: LATEX_ENGINE, mainDoc: "main.tex" });
  useIndexStore.setState({ texts: {} });
});

describe("preflightDiagnostics", () => {
  it("marks Typst findings that have a source range", async () => {
    useFilesStore.setState({ engine: TYPST_ENGINE });
    const text = 'Intro\n#image("plot.png")\n==\n';
    const diagnostics = await preflightDiagnostics(text, "typst");
    expect(diagnostics.map((diagnostic) => text.slice(diagnostic.from, diagnostic.to))).toEqual([
      'image("plot.png")',
      "==",
    ]);
    expect(diagnostics.every((diagnostic) => diagnostic.source === "preflight")).toBe(true);
    expect(diagnostics[0].message).toContain("alt text");
  });

  it("follows the project's Typst version for figure alt text", async () => {
    const text = '#figure(image("plot.png"), alt: "A chart")';
    useFilesStore.setState({ engine: { ...TYPST_ENGINE, typst_resolved: { version: "0.13.1", source: "system" } } });
    expect(await preflightDiagnostics(text, "typst")).toHaveLength(1);
    useFilesStore.setState({ engine: TYPST_ENGINE });
    expect(await preflightDiagnostics(text, "typst")).toHaveLength(0);
  });

  it("runs only the rules of the project's source language", async () => {
    expect(await preflightDiagnostics('#image("plot.png")', "typst")).toEqual([]);
    useFilesStore.setState({ engine: TYPST_ENGINE });
    expect(await preflightDiagnostics("\\includegraphics{plot.png}", "latex")).toEqual([]);
  });

  it("keeps the LaTeX markers", async () => {
    const text = "See \\href{https://example.com}{click here}.";
    const diagnostics = await preflightDiagnostics(text, "latex");
    expect(diagnostics.map((diagnostic) => diagnostic.from)).toEqual([text.indexOf("\\href")]);
  });

  it("leaves LaTeX alt text out of the editor until the document asks for a tagged PDF", async () => {
    expect(await preflightDiagnostics("\\includegraphics{plot.png}", "latex")).toEqual([]);
    expect(
      await preflightDiagnostics("\\DocumentMetadata{pdfversion=2.0}\n\\includegraphics{plot.png}", "latex"),
    ).toEqual([]);
    const tagged = "\\DocumentMetadata{lang=en,tagging=on}\n\\includegraphics{plot.png}";
    const diagnostics = await preflightDiagnostics(tagged, "latex");
    expect(diagnostics.map((diagnostic) => tagged.slice(diagnostic.from, diagnostic.to))).toEqual([
      "\\includegraphics{plot.png}",
    ]);
    expect(diagnostics[0].message).toContain("alt text");
    const universal = await preflightDiagnostics(
      "\\DocumentMetadata{pdfstandard=ua-2}\n\\includegraphics{plot.png}",
      "latex",
    );
    expect(universal.some((diagnostic) => diagnostic.message.includes("alt text"))).toBe(true);
    expect(
      await preflightDiagnostics("% \\DocumentMetadata{tagging=on}\n\\includegraphics{plot.png}", "latex"),
    ).toEqual([]);
  });

  it("asks for alt text in a chapter when the main document is tagged", async () => {
    useFilesStore.setState({ mainDoc: "main.tex" });
    useIndexStore.setState({
      texts: { "main.tex": "\\DocumentMetadata{tagging=on}\n\\documentclass{article}" },
    });
    expect(await preflightDiagnostics("\\includegraphics{plot.png}", "latex")).toHaveLength(1);
    useIndexStore.setState({ texts: { "main.tex": "\\documentclass{article}" } });
    expect(await preflightDiagnostics("\\includegraphics{plot.png}", "latex")).toEqual([]);
  });
});
