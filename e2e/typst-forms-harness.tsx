import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import { setEditorTranslator } from "/packages/editor/src/messages.ts";
import { editorTheme } from "/packages/editor/src/theme.ts";
import { loadTypstParser, typstLanguage } from "/packages/editor/src/typst.ts";
import { EMPTY_TYPST_FORM_CATALOG, staticTypstForms, type TypstFormCatalog } from "/packages/editor/src/typst-forms.ts";
import { typstVisualMode } from "/packages/editor/src/visual/typst/index.ts";
import golden from "/test/fixtures/typst-forms/expected/catalog.json";
import edgeCases from "/test/fixtures/typst-forms/project/edge-cases.typ?raw";
import report from "/test/fixtures/typst-forms/project/report.typ?raw";
import { i18n } from "/src/i18n";
import { prepareHarnessI18n } from "./harness-i18n";
import "/src/styles/globals.css";

const catalog = { version: "harness", watch: ["oleafly-forms.toml"], ...golden } as unknown as TypstFormCatalog;

function largeReport(cards: number): string {
  const header = report.split("\n").slice(0, 5).join("\n");
  const sections: string[] = [header, ""];
  for (let index = 0; index < cards; index += 1) {
    sections.push(
      `= Section ${index + 1}`,
      "",
      `#info-box(title: "Finding ${index + 1}", tone: "${index % 2 === 0 ? "note" : "risk"}")[Body text for finding ${index + 1}.]`,
      "",
      `The status is #badge("${["draft", "review", "approved"][index % 3]}") for now.`,
      "",
    );
  }
  return sections.join("\n");
}

function documentText(name: string): string {
  if (name === "edge-cases") return edgeCases;
  if (name === "large") return largeReport(300);
  return report;
}

const port = staticTypstForms(catalog);
const emptyPort = staticTypstForms(EMPTY_TYPST_FORM_CATALOG);
let emptyCatalog = false;
const host = document.getElementById("editor") as HTMLElement;
const sourcePane = document.getElementById("source") as HTMLTextAreaElement;
const documentSelect = document.getElementById("document") as HTMLSelectElement;
const formsToggle = document.getElementById("forms") as HTMLInputElement;
const themeToggle = document.getElementById("dark") as HTMLInputElement;
let view: EditorView | null = null;

function showSource(): void {
  if (view) sourcePane.value = view.state.doc.toString();
}

function mount(): void {
  const doc = view?.state.doc.toString() ?? documentText(documentSelect.value);
  view?.destroy();
  const ports = {
    resolveImage: async () => null,
    typstForms: emptyCatalog ? emptyPort : formsToggle.checked ? port : undefined,
  };
  view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        editorTheme(),
        typstLanguage(),
        typstVisualMode(ports, "report.typ"),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) showSource();
        }),
      ],
    }),
  });
  showSource();
}

documentSelect.addEventListener("change", () => {
  view?.destroy();
  view = null;
  mount();
});
formsToggle.addEventListener("change", mount);
themeToggle.addEventListener("change", () => {
  document.documentElement.classList.toggle("dark", themeToggle.checked);
});

await prepareHarnessI18n();
setEditorTranslator((key, params) => i18n.t(`editor:package.${key}`, params) as string);
await loadTypstParser();
const params = new URLSearchParams(location.search);
documentSelect.value = params.get("doc") ?? "report";
formsToggle.checked = params.get("forms") !== "off";
emptyCatalog = params.get("forms") === "empty";
themeToggle.checked = params.get("theme") === "dark";
document.documentElement.classList.toggle("dark", themeToggle.checked);
mount();

(window as unknown as { __typstForms: unknown }).__typstForms = {
  view: () => view,
  port,
  setDocument(text: string) {
    view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  },
};
document.body.dataset.fixtureState = "mounted";
