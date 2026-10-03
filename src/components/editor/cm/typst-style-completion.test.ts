// @vitest-environment jsdom

import { CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { setTypstStyleVersionProvider } from "@oleafly/editor";
import { afterEach, describe, expect, it } from "vitest";
import { useFilesStore } from "@/store/files";
import { typstCompletionWithLanguageService } from "./project-intelligence";

afterEach(() => setTypstStyleVersionProvider(() => null));

async function complete(doc: string, languageService: CompletionSource): Promise<CompletionResult | null> {
  const source = typstCompletionWithLanguageService(languageService);
  return source(new CompletionContext(EditorState.create({ doc }), doc.length, false));
}

describe("Typst bibliography style completion in the editor", () => {
  it("offers built-in styles inside a bibliography style string", async () => {
    useFilesStore.setState({ activePath: "main.typ", projectId: "typst-project" });
    const result = await complete('#bibliography("refs.bib", style: "iee', () => null);
    expect(result?.options.map((option) => option.label)).toContain("ieee");
    expect(result?.from).toBe('#bibliography("refs.bib", style: "'.length);
  });

  it("keeps Tinymist's own style suggestions and adds only the missing ones", async () => {
    useFilesStore.setState({ activePath: "main.typ", projectId: "typst-project" });
    const doc = '#set cite(style: "a';
    const result = await complete(doc, (context) => ({
      from: context.pos - 1,
      options: [{ label: "apa", detail: "from Tinymist" }],
    }));
    const labels = result?.options.map((option) => option.label) ?? [];
    expect(labels[0]).toBe("apa");
    expect(labels.filter((label) => label === "apa")).toHaveLength(1);
    expect(labels).toContain("alphanumeric");
  });
});
