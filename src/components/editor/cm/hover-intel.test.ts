// @vitest-environment jsdom

import type { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  renderMathExpression: vi.fn(() => ({ status: "ready", html: "<span>x</span>" })),
}));

vi.mock("@/lib/project-intelligence/current", () => intelligence);
vi.mock("@/lib/project-intelligence/selectors", () => selectors);
vi.mock("@/lib/aux-numbers", () => aux);
vi.mock("@oleafly/editor/math-render", () => math);
vi.mock("./hover-asset", () => ({
  ...asset,
  THUMBNAIL_TARGET_RE: /\.(png|jpe?g|gif|webp|bmp|svg|pdf)$/i,
}));
vi.mock("./hover-math", () => ({
  enclosingMathEnvironment: vi.fn(() => ({ body: "x = 1" })),
}));

import { hoverIntel, kindNoun, projectHoverCard } from "./hover-intel";

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
    expect(node.querySelector(".cm-code-hover-detail")?.textContent).toContain("Figure one");
    expect(node.querySelector(".cm-code-hover-detail")?.textContent).toContain("intro.tex:4");
    expect(node.querySelector(".cm-code-hover-aux")?.textContent).toBe(
      hover.auxNumber.replace("{{number}}", "1.2").replace("{{page}}", "7"),
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
