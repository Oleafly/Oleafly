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

describe("Typst multiple bibliography completion in the editor", () => {
  it("offers target values for projects on Typst 0.15", async () => {
    useFilesStore.setState({ activePath: "main.typ", projectId: "typst-project" });
    setTypstStyleVersionProvider(() => "0.15.1");
    const doc = '#bibliography("refs.bib", target: ';
    const result = await complete(doc, () => null);
    expect(result?.options.map((option) => option.label)).toContain("selector(cite).within(<label>)");
    expect(result?.from).toBe(doc.length);
  });

  it("stays quiet for projects pinned before Typst 0.15", async () => {
    useFilesStore.setState({ activePath: "main.typ", projectId: "typst-project" });
    setTypstStyleVersionProvider(() => "0.13.1");
    const result = await complete('#bibliography("refs.bib", group: ', () => null);
    expect(result?.options.map((option) => option.label) ?? []).not.toContain("none");
  });

  it("keeps the language server's parameter names first without duplicates", async () => {
    useFilesStore.setState({ activePath: "main.typ", projectId: "typst-project" });
    setTypstStyleVersionProvider(() => "0.15.1");
    const doc = '#bibliography("refs.bib", t';
    const result = await complete(doc, (context) => ({
      from: context.pos - 1,
      options: [{ label: "target", detail: "from Tinymist" }, { label: "title", detail: "from Tinymist" }],
    }));
    const labels = result?.options.map((option) => option.label) ?? [];
    expect(labels.slice(0, 2)).toEqual(["target", "title"]);
    expect(labels.filter((label) => label === "target")).toHaveLength(1);
    expect(labels).toContain("group");
  });
});
