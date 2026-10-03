import { beforeEach, describe, expect, it } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";
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
  useFilesStore.setState({ engine: LATEX_ENGINE });
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
    const diagnostics = await preflightDiagnostics("\\includegraphics{plot.png}", "latex");
    expect(diagnostics.map((diagnostic) => diagnostic.from)).toEqual([0]);
  });
});
