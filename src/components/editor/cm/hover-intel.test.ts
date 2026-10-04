// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/intelligence.json" with { type: "json" };
import type {
  ProjectDefinition,
  ProjectIntelligenceSnapshot,
  ProjectUse,
  SourceRange,
} from "@/lib/project-intelligence/types";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

const intelligence = vi.hoisted(() => ({
  currentSourceProjectIntelligence: vi.fn(),
}));

const selectors = vi.hoisted(() => ({
  symbolAt: vi.fn(),
  definitionsForUse: vi.fn(() => [] as unknown[]),
  referencesFor: vi.fn(() => [] as unknown[]),
  safeLinePreview: vi.fn(() => "\\label{fig:one}"),
}));

const aux = vi.hoisted(() => ({ auxNumberFor: vi.fn(() => null as unknown) }));
const asset = vi.hoisted(() => ({
  loadAssetThumbnail: vi.fn(async () => "data:image/png;base64,AA"),
}));
const math = vi.hoisted(() => ({
  renderMathSource: vi.fn(() => ({ status: "ready", html: "<span>x</span>" })),
}));
const enclosing = vi.hoisted(() => ({
  enclosingMathEnvironment: vi.fn(() => ({ body: "x = 1", environment: "equation" })),
}));

vi.mock("@/lib/project-intelligence/current", () => intelligence);
vi.mock("@/lib/project-intelligence/selectors", () => selectors);
vi.mock("@/lib/aux-numbers", () => aux);
vi.mock("@oleafly/editor/math-render", () => math);
vi.mock("./hover-asset", () => asset);
vi.mock("./hover-math", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hover-math")>()),
  ...enclosing,
}));

import { clearProjectHoverIntel, hoverIntel, kindNoun, projectHoverCard } from "./hover-intel";

const hover = en.hover;
const kinds = en.symbolKind;

const RANGE: SourceRange = {
  from: 10,
  to: 20,
  startLine: 4,
  startColumn: 0,
  endLine: 4,
  endColumn: 10,
};

const SNAPSHOT = { identity: { projectId: "project" } } as unknown as ProjectIntelligenceSnapshot;

function definition(overrides: Partial<ProjectDefinition> = {}): ProjectDefinition {
  return {
    id: "def:fig:one",
    source: "local",
    engine: "latex",
    kind: "label",
    name: "fig:one",
    location: { file: "chapters/intro.tex", range: RANGE },
    ...overrides,
  } as ProjectDefinition;
}

function use(overrides: Partial<ProjectUse> = {}): ProjectUse {
  return {
    id: "use:fig:one",
    source: "local",
    engine: "latex",
    kind: "reference",
    name: "fig:one",
    location: { file: "main.tex", range: RANGE },
    resolution: "resolved",
    definitionIds: ["def:fig:one"],
    ...overrides,
  } as ProjectUse;
}

const view = { state: { doc: { toString: () => "\\ref{fig:one}" } } } as unknown as EditorView;

function card(symbol: ProjectDefinition | ProjectUse | null) {
  intelligence.currentSourceProjectIntelligence.mockReturnValue(
    symbol ? { path: "main.tex", snapshot: SNAPSHOT } : null,
  );
  selectors.symbolAt.mockReturnValue(symbol);
  return projectHoverCard(view, 12);
}

function dom(symbol: ProjectDefinition | ProjectUse) {
  const tooltip = card(symbol);
  if (!tooltip) throw new Error("no tooltip");
  return tooltip.create().dom;
}

describe("kindNoun", () => {
  it("names every indexed symbol kind and passes an unknown kind through", () => {
    for (const [kind, noun] of Object.entries(kinds)) {
      expect(kindNoun(kind)).toBe(noun);
    }
    expect(kindNoun("sorcery")).toBe("sorcery");
  });
});

describe("projectHoverCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectors.definitionsForUse.mockReturnValue([]);
    selectors.referencesFor.mockReturnValue([]);
    selectors.safeLinePreview.mockReturnValue("\\label{fig:one}");
    aux.auxNumberFor.mockReturnValue(null);
    asset.loadAssetThumbnail.mockResolvedValue("data:image/png;base64,AA");
    useIndexStore.setState({ texts: { "chapters/intro.tex": "\\label{fig:one}" } });
    useFilesStore.setState({ projectId: "project" });
  });

  it("offers nothing without a snapshot or a symbol", () => {
    intelligence.currentSourceProjectIntelligence.mockReturnValue(null);
    expect(projectHoverCard(view, 12)).toBeNull();

    intelligence.currentSourceProjectIntelligence.mockReturnValue({
      path: "main.tex",
      snapshot: SNAPSHOT,
    });
    selectors.symbolAt.mockReturnValue(null);
    expect(projectHoverCard(view, 12)).toBeNull();
  });

  it("reports a use with no definition as unresolved", () => {
    const node = dom(use());

    expect(node.textContent).toContain(
      hover.unresolved.replace("{{kind}}", kinds.reference).replace("{{name}}", "fig:one"),
    );
    expect(node.textContent).toContain(hover.unresolvedDetail);
  });

  it("reports a use with several definitions as duplicated", () => {
    selectors.definitionsForUse.mockReturnValue([definition(), definition({ id: "def:2" })]);

    const node = dom(use({ kind: "citation" }));

    expect(node.textContent).toContain(
      hover.duplicate.replace("{{kind}}", kinds.citation).replace("{{name}}", "fig:one"),
    );
    expect(node.textContent).toContain(hover.duplicateDetail_other.replace("{{count}}", "2"));
  });

  it("shows the definition, its rendered math and its aux number", () => {
    selectors.definitionsForUse.mockReturnValue([definition({ detail: "Figure one" })]);
    aux.auxNumberFor.mockReturnValue({ number: "1.2", page: "7" });

    const node = dom(use());

    expect(node.querySelector(".cm-code-hover-title")?.textContent).toBe(
      hover.definition.replace("{{kind}}", kinds.label).replace("{{name}}", "fig:one"),
    );
    expect(node.querySelector(".cm-code-hover-math")?.innerHTML).toBe("<span>x</span>");
    expect(math.renderMathSource).toHaveBeenCalledWith("\\begin{equation}x = 1\\end{equation}", true);
    expect(node.querySelector(".cm-code-hover-detail")?.textContent).toContain("Figure one");
    expect(node.querySelector(".cm-code-hover-detail")?.textContent).toContain("intro.tex:4");
    expect(node.querySelector(".cm-code-hover-aux")?.textContent).toBe(
      hover.auxNumber.replace("{{number}}", "1.2").replace("{{page}}", "7"),
    );
  });

  it("renders the whole environment around a label, not only its rows", () => {
    selectors.definitionsForUse.mockReturnValue([definition()]);
    enclosing.enclosingMathEnvironment.mockReturnValueOnce({
      body: "a &= b \\label{fig:one} \\\\ c &= d",
      environment: "align",
    });

    dom(use());

    expect(math.renderMathSource).toHaveBeenCalledWith(
      "\\begin{align}a &= b \\label{fig:one} \\\\ c &= d\\end{align}",
      true,
    );
  });

  it("renders no math for a definition that is not a label", () => {
    selectors.definitionsForUse.mockReturnValue([definition({ kind: "macro", name: "\\eq" })]);

    const node = dom(use({ kind: "macro", name: "\\eq" }));

    expect(node.querySelector(".cm-code-hover-math")).toBeNull();
    expect(node.querySelector(".cm-code-hover-title")?.textContent).toBe(
      hover.definition.replace("{{kind}}", kinds.macro).replace("{{name}}", "\\eq"),
    );
  });

  it("bundles the field, handlers, tooltip and theme into one extension", () => {
    expect(hoverIntel()).toHaveLength(4);
  });

  it("counts the references to a definition under the cursor", () => {
    selectors.referencesFor.mockReturnValue([use(), use({ id: "use:2" })]);

    const node = dom(definition({ kind: "section", name: "Introduction" }));

    expect(node.textContent).toContain(
      hover.definition.replace("{{kind}}", kinds.section).replace("{{name}}", "Introduction"),
    );
    expect(node.textContent).toContain(hover.referenceCount_other.replace("{{count}}", "2"));
  });

  it("says nothing about a definition that nothing references", () => {
    selectors.referencesFor.mockReturnValue([]);

    expect(card(definition())).toBeNull();
  });

  it("thumbnails a resolved image asset", async () => {
    const node = dom(
      use({ kind: "asset", target: "figures/plot.png", resolution: "resolved" }),
    );

    expect(node.textContent).toContain(hover.figure.replace("{{name}}", "plot.png"));
    const thumb = node.querySelector(".cm-code-hover-thumb") as HTMLElement;
    expect(thumb.textContent).toBe(hover.loadingPreview);

    document.body.appendChild(node);
    await vi.waitFor(() => expect(thumb.querySelector("img")).not.toBeNull());
    expect(thumb.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AA");
  });

  it("says a preview is unavailable when the thumbnail cannot be built", async () => {
    asset.loadAssetThumbnail.mockResolvedValue("");

    const node = dom(
      use({ kind: "asset", target: "figures/plot.png", resolution: "resolved" }),
    );
    document.body.appendChild(node);
    const thumb = node.querySelector(".cm-code-hover-thumb") as HTMLElement;

    await vi.waitFor(() => expect(thumb.textContent).toBe(hover.previewUnavailable));
  });

  it("says a preview is unavailable with no project open", () => {
    useFilesStore.setState({ projectId: "" });

    const node = dom(
      use({ kind: "asset", target: "figures/plot.png", resolution: "resolved" }),
    );

    expect(node.querySelector(".cm-code-hover-thumb")?.textContent).toBe(
      hover.previewUnavailable,
    );
  });

  it("ignores an asset use that resolves to something with no preview", () => {
    expect(card(use({ kind: "asset", target: "data/table.csv", resolution: "resolved" }))).toBeNull();
    expect(card(use({ kind: "asset", resolution: "unresolved" }))).toBeNull();
  });
});

describe("projectHoverCard edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectors.definitionsForUse.mockReturnValue([]);
    selectors.referencesFor.mockReturnValue([]);
    math.renderMathSource.mockReturnValue({ status: "ready", html: "<span>x</span>" });
    aux.auxNumberFor.mockReturnValue(null);
    useIndexStore.setState({ texts: { "chapters/intro.tex": "\\label{fig:one}" } });
    useFilesStore.setState({ projectId: "project" });
  });

  it("looks one character back when the cursor sits just after a symbol", () => {
    intelligence.currentSourceProjectIntelligence.mockReturnValue({ path: "main.tex", snapshot: SNAPSHOT });
    selectors.symbolAt.mockReturnValueOnce(null).mockReturnValueOnce(use());
    expect(projectHoverCard(view, 12)?.pos).toBe(RANGE.from);
    expect(selectors.symbolAt).toHaveBeenLastCalledWith(SNAPSHOT, "main.tex", 11);

    selectors.symbolAt.mockReset();
    selectors.symbolAt.mockReturnValue(null);
    expect(projectHoverCard(view, 0)).toBeNull();
    expect(selectors.symbolAt).toHaveBeenCalledOnce();
  });

  it("shows the compiled number of a referenced label definition", () => {
    selectors.referencesFor.mockReturnValue([use()]);
    aux.auxNumberFor.mockReturnValue({ number: "3", page: "2" });
    const node = dom(definition());
    expect(node.querySelector(".cm-code-hover-aux")?.textContent).toBe(
      hover.auxNumber.replace("{{number}}", "3").replace("{{page}}", "2"),
    );
  });

  it("skips math that the source text or the renderer cannot provide", () => {
    selectors.definitionsForUse.mockReturnValue([definition({ location: { file: "missing.tex", range: RANGE } })]);
    expect(dom(use()).querySelector(".cm-code-hover-math")).toBeNull();

    selectors.definitionsForUse.mockReturnValue([definition()]);
    enclosing.enclosingMathEnvironment.mockReturnValueOnce({ body: "   ", environment: "equation" });
    expect(dom(use()).querySelector(".cm-code-hover-math")).toBeNull();

    math.renderMathSource.mockReturnValueOnce({ status: "error", html: "" });
    expect(dom(use()).querySelector(".cm-code-hover-math")).toBeNull();
  });

  it("leaves a detached thumbnail alone when its preview arrives late", async () => {
    let resolve: (url: string) => void = () => {};
    asset.loadAssetThumbnail.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    const node = dom(use({ kind: "asset", target: "figures/plot.png", resolution: "resolved" }));
    const thumb = node.querySelector(".cm-code-hover-thumb") as HTMLElement;
    resolve("data:image/png;base64,AA");
    await Promise.resolve();
    await Promise.resolve();
    expect(thumb.textContent).toBe(hover.loadingPreview);
    expect(thumb.querySelector("img")).toBeNull();
  });
});

describe("modifier-hover links", () => {
  let editor: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    intelligence.currentSourceProjectIntelligence.mockReturnValue({ path: "main.tex", snapshot: SNAPSHOT });
    selectors.symbolAt.mockReturnValue(use({ location: { file: "main.tex", range: { ...RANGE, from: 5, to: 12 } } }));
    selectors.definitionsForUse.mockReturnValue([definition()]);
    editor = new EditorView({
      state: EditorState.create({ doc: "\\ref{fig:one} and more", extensions: hoverIntel() }),
      parent: document.body,
    });
  });

  afterEach(() => {
    editor.destroy();
  });

  function links(): string[] {
    return [...editor.contentDOM.querySelectorAll(".cm-cmd-link")].map((node) => node.textContent ?? "");
  }

  function move(init: MouseEventInit, pos: number | null = 7) {
    vi.spyOn(editor, "posAtCoords").mockReturnValue(pos as number);
    editor.contentDOM.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, ...init }));
  }

  it("underlines a resolvable symbol while Ctrl or Cmd is held", () => {
    move({ ctrlKey: true });
    expect(links()).toEqual(["fig:one"]);
    const dispatch = vi.spyOn(editor, "dispatch");
    move({ metaKey: true });
    expect(dispatch).not.toHaveBeenCalled();
    expect(links()).toEqual(["fig:one"]);
    move({});
    expect(links()).toEqual([]);
  });

  it("does not underline an unresolved use or empty space", () => {
    selectors.definitionsForUse.mockReturnValue([]);
    move({ ctrlKey: true });
    expect(links()).toEqual([]);

    selectors.definitionsForUse.mockReturnValue([definition()]);
    move({ ctrlKey: true });
    expect(links()).toHaveLength(1);
    move({ ctrlKey: true }, null);
    expect(links()).toEqual([]);

    selectors.symbolAt.mockReturnValue(null);
    move({ ctrlKey: true });
    expect(links()).toEqual([]);
  });

  it("underlines a definition that has references", () => {
    selectors.symbolAt.mockReturnValue(definition({ location: { file: "main.tex", range: { ...RANGE, from: 0, to: 4 } } }));
    move({ ctrlKey: true });
    expect(links()).toEqual(["\\ref"]);
  });

  it("clears the underline when the pointer leaves, the modifier is released or the effect is sent", () => {
    move({ ctrlKey: true });
    editor.contentDOM.dispatchEvent(new MouseEvent("mouseleave"));
    expect(links()).toEqual([]);

    move({ ctrlKey: true });
    editor.contentDOM.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
    expect(links()).toHaveLength(1);
    editor.contentDOM.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", bubbles: true }));
    expect(links()).toEqual([]);

    move({ metaKey: true });
    editor.contentDOM.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta", bubbles: true }));
    expect(links()).toEqual([]);

    move({ ctrlKey: true });
    editor.dispatch({ effects: clearProjectHoverIntel.of(null) });
    expect(links()).toEqual([]);
  });
});
