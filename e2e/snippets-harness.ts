import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { buildLibrary, parseSnippetFile, type ParsedSnippetFile, type SnippetLibrary } from "/packages/snippets/src/index.ts";
import { requestedGhostCompletion } from "/packages/editor/src/ghost-completion.ts";
import { latexLanguage } from "/packages/editor/src/latex.ts";
import { latexPairInputHandler, latexPairKeymap } from "/packages/editor/src/latex-pairs.ts";
import { latexScriptGroups } from "/packages/editor/src/latex-scripts.ts";
import { snippetEditorExtensions } from "/packages/editor/src/snippets/runtime.ts";
import type { SnippetPort } from "/packages/editor/src/snippets/port.ts";

type Options = { fastMath: boolean; ai: string | null };

let view: EditorView | null = null;
let library: SnippetLibrary | null = null;
let aiRequests = 0;
const expanded: string[] = [];

async function packs(): Promise<ParsedSnippetFile[]> {
  const files = ["fast-math-latex", "paper-structure"];
  const texts = await Promise.all(files.map((name) => fetch(`/snippets/${name}.json`).then((response) => response.text())));
  return files.map((name, index) => parseSnippetFile(texts[index], name, "pack"));
}

function port(options: Options, files: ParsedSnippetFile[]): SnippetPort {
  library = buildLibrary({
    files,
    disabledCollections: new Set(options.fastMath ? [] : ["fast-math-latex"]),
    overrides: [],
    disabledRegex: new Set(),
  });
  const current = library;
  return {
    library: () => current,
    language: () => "latex",
    filePath: () => "main.tex",
    projectName: () => "Harness",
    typstVersion: () => undefined,
    enabled: () => ({ list: true, tab: true, auto: true, hint: true }),
    projectItems: () => [],
    useCount: () => 0,
    recordUse: () => undefined,
    readClipboard: async () => "",
    fieldHintsLeft: () => 0,
    consumeFieldHint: () => undefined,
    onAutoExpanded: (record) => {
      expanded.push(record.id);
    },
    onHandTypedFraction: () => undefined,
    reportSlowRegex: () => undefined,
  };
}

function aiExtension(suggestion: string | null): Extension {
  if (suggestion === null) return [];
  return requestedGhostCompletion(
    async ({ onText }) => {
      aiRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
      onText(suggestion);
    },
    { delayMs: 10 },
  );
}

async function mount(doc: string, caret: number, options: Options): Promise<void> {
  view?.destroy();
  aiRequests = 0;
  expanded.length = 0;
  const host = document.getElementById("host");
  if (!host) throw new Error("host is missing");
  const snippets = port(options, await packs());
  view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: [
        history(),
        closeBrackets(),
        latexLanguage(),
        latexScriptGroups(),
        snippetEditorExtensions(snippets),
        latexPairInputHandler({ math: true, brackets: true }),
        Prec.highest(keymap.of(latexPairKeymap)),
        aiExtension(options.ai),
        keymap.of([...closeBracketsKeymap, indentWithTab, ...defaultKeymap, ...historyKeymap]),
      ],
    }),
  });
  view.focus();
}

function snapshot(): { doc: string; head: number; ghost: string | null; chip: string | null; aiRequests: number; expanded: string[] } {
  if (!view) throw new Error("no editor is mounted");
  const ghost = view.dom.querySelector(".cm-ghostCompletion");
  const chip = view.dom.querySelector(".cm-ghostSnippet");
  return {
    doc: view.state.doc.toString(),
    head: view.state.selection.main.head,
    ghost: ghost?.textContent ?? null,
    chip: chip?.textContent ?? null,
    aiRequests,
    expanded: [...expanded],
  };
}

Object.assign(window, { __snippets: { mount, snapshot } });
document.body.dataset.fixtureState = "mounted";
