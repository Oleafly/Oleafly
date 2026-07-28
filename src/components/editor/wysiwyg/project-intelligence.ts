import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@tiptap/pm/view";
import { currentProjectIntelligence } from "@/lib/project-intelligence/current";
import { latexCommandKeyTokens } from "@/lib/project-intelligence/analyze-file";
import { navigateToProjectRange } from "@/lib/project-intelligence/navigation";
import {
  referencesFor,
} from "@/lib/project-intelligence/selectors";
import type {
  ProjectDefinition,
  ProjectIntelligenceSnapshot,
  ProjectUse,
} from "@/lib/project-intelligence/types";
import { toast } from "@/lib/toast";
import { useIndexStore } from "@/store/project-index";
import { useReferencesStore } from "@/store/references";
import { useSettingsStore } from "@/store/settings";
import { setWysiwygProjectIntelligenceCurrent } from "./controller";

type VisualTokenKind = "citation" | "reference" | "ambiguous";

interface VisualToken {
  key: string;
  kind: VisualTokenKind;
  useId?: string;
  sourceFrom?: number;
  sourceTo?: number;
}

interface VisualPluginState {
  dirty: boolean;
  revision: string;
}

interface VisualLookup {
  definitionsById: ReadonlyMap<string, ProjectDefinition>;
  definitionsByName: ReadonlyMap<string, readonly ProjectDefinition[]>;
  usesById: ReadonlyMap<string, ProjectUse>;
  usesByFileAndName: ReadonlyMap<string, readonly ProjectUse[]>;
}

const visualProjectIntelligenceKey =
  new PluginKey<VisualPluginState>("visualProjectIntelligence");
const visualLookupCache = new WeakMap<
  ProjectIntelligenceSnapshot,
  VisualLookup
>();

function lookupKey(file: string, name: string): string {
  return `${file}\0${name}`;
}

function lookupFor(snapshot: ProjectIntelligenceSnapshot): VisualLookup {
  const cached = visualLookupCache.get(snapshot);
  if (cached) return cached;

  const definitionsByName = new Map<string, ProjectDefinition[]>();
  const definitionsById = new Map<string, ProjectDefinition>();
  for (const definition of snapshot.definitions) {
    definitionsById.set(definition.id, definition);
    const sameName = definitionsByName.get(definition.name) ?? [];
    sameName.push(definition);
    definitionsByName.set(definition.name, sameName);
  }
  const usesByFileAndName = new Map<string, ProjectUse[]>();
  const usesById = new Map<string, ProjectUse>();
  for (const use of snapshot.uses) {
    usesById.set(use.id, use);
    const key = lookupKey(use.location.file, use.name);
    const sameName = usesByFileAndName.get(key) ?? [];
    sameName.push(use);
    usesByFileAndName.set(key, sameName);
  }
  const lookup: VisualLookup = {
    definitionsById,
    definitionsByName,
    usesById,
    usesByFileAndName,
  };
  visualLookupCache.set(snapshot, lookup);
  return lookup;
}


export function tokensFromRawInline(source: string): readonly VisualToken[] {
  return latexCommandKeyTokens(source).map((token) => ({
    key: token.name,
    kind: token.kind,
    sourceFrom: token.from,
    sourceTo: token.to,
  }));
}

function usesForToken(
  snapshot: ProjectIntelligenceSnapshot,
  path: string,
  token: VisualToken,
): readonly ProjectUse[] {
  const lookup = lookupFor(snapshot);
  const acceptedKinds =
    token.kind === "citation"
      ? new Set<ProjectUse["kind"]>(["citation"])
      : token.kind === "reference"
        ? new Set<ProjectUse["kind"]>(["reference", "link"])
        : new Set<ProjectUse["kind"]>(["citation", "reference", "link"]);
  return [...(lookup.usesByFileAndName.get(lookupKey(path, token.key)) ?? [])]
    .filter((use) => acceptedKinds.has(use.kind))
    .sort(
      (left, right) =>
        (left.resolution === "resolved" ? 0 : 1) -
          (right.resolution === "resolved" ? 0 : 1) ||
        left.location.range.from - right.location.range.from ||
        left.id.localeCompare(right.id),
    );
}

function resolvedToken(
  snapshot: ProjectIntelligenceSnapshot,
  path: string,
  token: VisualToken,
): VisualToken {
  const use = usesForToken(snapshot, path, token)[0];
  return use ? { ...token, useId: use.id } : token;
}

function definitionsForToken(
  snapshot: ProjectIntelligenceSnapshot,
  path: string,
  token: VisualToken,
): readonly ProjectDefinition[] {
  const lookup = lookupFor(snapshot);
  if (token.useId) {
    const use = lookup.usesById.get(token.useId);
    const definitions =
      use?.definitionIds.flatMap((id) => {
        const definition = lookup.definitionsById.get(id);
        return definition ? [definition] : [];
      }) ?? [];
    if (definitions.length > 0) return definitions;
  }
  const kinds =
    token.kind === "citation"
      ? new Set<ProjectDefinition["kind"]>(["bibentry"])
      : token.kind === "reference"
        ? new Set<ProjectDefinition["kind"]>([
            "label",
            "anchor",
            "section",
          ])
        : new Set<ProjectDefinition["kind"]>([
            "bibentry",
            "label",
            "anchor",
            "section",
          ]);
  const candidates = (
    lookup.definitionsByName.get(token.key) ?? []
  ).filter((definition) => kinds.has(definition.kind));
  if (candidates.length > 0) return candidates;

  const fallbackUse = usesForToken(snapshot, path, token)[0];
  return fallbackUse
    ? fallbackUse.definitionIds.flatMap((id) => {
        const definition = lookup.definitionsById.get(id);
        return definition ? [definition] : [];
      })
    : [];
}

function resolutionFor(
  snapshot: ProjectIntelligenceSnapshot,
  path: string,
  token: VisualToken,
): "resolved" | "unresolved" | "duplicate" {
  const definitions = definitionsForToken(snapshot, path, token);
  if (definitions.length === 0) return "unresolved";
  if (definitions.length > 1) return "duplicate";
  return "resolved";
}

function tokenAttributes(
  snapshot: ProjectIntelligenceSnapshot,
  path: string,
  input: VisualToken,
): Record<string, string> {
  const token = resolvedToken(snapshot, path, input);
  const resolution = resolutionFor(snapshot, path, token);
  const noun =
    token.kind === "citation"
      ? "Citation"
      : token.kind === "reference"
        ? "Reference"
        : "Citation or reference";
  const state =
    resolution === "duplicate"
      ? "multiple definitions"
      : resolution === "unresolved"
        ? "unresolved"
        : "resolved";
  return {
    class: `wysiwyg-project-intelligence is-${resolution}`,
    role: "link",
    tabindex: "0",
    "aria-label": `${noun} ${token.key}, ${state}. Enter or F12 to go to definition; Shift+Enter or Shift+F12 to find references.`,
    "aria-keyshortcuts": "Enter F12 Shift+Enter Shift+F12",
    title: `${noun} “${token.key}” · ${state}\nClick/F12: go to definition · Shift-click/Shift-F12: find references`,
    "data-project-intelligence-key": token.key,
    "data-project-intelligence-kind": token.kind,
    ...(token.sourceFrom !== undefined
      ? {
          "data-project-intelligence-source-from": String(
            token.sourceFrom,
          ),
        }
      : {}),
    ...(token.sourceTo !== undefined
      ? {
          "data-project-intelligence-source-to": String(token.sourceTo),
        }
      : {}),
    ...(token.useId
      ? { "data-project-intelligence-use-id": token.useId }
      : {}),
  };
}

export function rawInlineTokenAttributes(
  snapshot: ProjectIntelligenceSnapshot,
  path: string,
  source: string,
): Record<string, string> | null {
  const tokens = tokensFromRawInline(source);
  if (tokens.length === 0) return null;
  const states = tokens.map((input) => {
    const token = resolvedToken(snapshot, path, input);
    return {
      token,
      resolution: resolutionFor(snapshot, path, token),
    };
  });
  const rank = {
    unresolved: 0,
    duplicate: 1,
    resolved: 2,
  } as const;
  const selected = [...states].sort(
    (left, right) => rank[left.resolution] - rank[right.resolution],
  )[0];
  return {
    ...tokenAttributes(snapshot, path, selected.token),
    "data-project-intelligence-token-states": JSON.stringify(
      states.map(({ token, resolution }) => ({
        key: token.key,
        kind: token.kind,
        from: token.sourceFrom,
        to: token.sourceTo,
        resolution,
      })),
    ),
    "aria-label": states
      .map(
        ({ token, resolution }) =>
          `${token.kind === "citation" ? "Citation" : "Reference"} ${token.key}, ${resolution}`,
      )
      .join(". "),
  };
}

function textTokens(
  text: string,
): Array<{ from: number; to: number; token: VisualToken }> {
  const tokens: Array<{ from: number; to: number; token: VisualToken }> = [];
  const at = /(?:^|[\s[(;,])@([\p{L}\p{N}_:.+/-]+)/gu;
  for (const match of text.matchAll(at)) {
    const key = match[1];
    if (!key || match.index === undefined) continue;
    const atOffset = match[0].lastIndexOf("@");
    const from = match.index + atOffset;
    tokens.push({
      from,
      to: from + key.length + 1,
      token: { key, kind: "ambiguous" },
    });
  }
  return tokens;
}

function decorationsFor(state: EditorState): DecorationSet {
  const pluginState = visualProjectIntelligenceKey.getState(state);
  if (pluginState?.dirty) return DecorationSet.empty;
  const current = currentProjectIntelligence();
  if (!current || !/\.(?:tex|latex|ltx|md|markdown)$/i.test(current.path)) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];
  state.doc.descendants((node, position) => {
    if (node.type.name === "rawInline") {
      const attributes = rawInlineTokenAttributes(
        current.snapshot,
        current.path,
        String(node.attrs.source ?? ""),
      );
      if (attributes) {
        decorations.push(
          Decoration.node(
            position,
            position + node.nodeSize,
            attributes,
          ),
        );
      }
      return false;
    }
    if (!node.isText || !node.text) return true;

    const anchor = node.marks.find(
      (mark) =>
        mark.type.name === "link" &&
        typeof mark.attrs.href === "string" &&
        mark.attrs.href.startsWith("#"),
    );
    if (anchor) {
      const key = String(anchor.attrs.href).slice(1);
      if (key) {
        decorations.push(
          Decoration.inline(
            position,
            position + node.nodeSize,
            tokenAttributes(current.snapshot, current.path, {
              key,
              kind: "reference",
            }),
          ),
        );
      }
      return true;
    }

    if (node.marks.some((mark) => mark.type.name === "code")) return true;
    for (const match of textTokens(node.text)) {
      decorations.push(
        Decoration.inline(
          position + match.from,
          position + match.to,
          tokenAttributes(current.snapshot, current.path, match.token),
        ),
      );
    }
    return true;
  });
  return DecorationSet.create(state.doc, decorations);
}

function tokenFromElement(target: EventTarget | null): VisualToken | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>(
    "[data-project-intelligence-key]",
  );
  const key = element?.dataset.projectIntelligenceKey;
  const kind = element?.dataset.projectIntelligenceKind as
    | VisualTokenKind
    | undefined;
  if (!key || !kind) return null;
  const useId = element.dataset.projectIntelligenceUseId;
  return { key, kind, ...(useId ? { useId } : {}) };
}

function tokenAtSelection(view: EditorView): VisualToken | null {
  const selection = view.state.selection;
  const node = selection.$from.nodeAfter ?? selection.$from.nodeBefore;
  if (node?.type.name === "rawInline") {
    const tokens = tokensFromRawInline(String(node.attrs.source ?? ""));
    if (tokens.length === 0) return null;
    const current = currentProjectIntelligence();
    if (!current) return tokens[0];
    return [...tokens].sort(
      (left, right) => {
        const leftResolution = resolutionFor(
          current.snapshot,
          current.path,
          left,
        );
        const rightResolution = resolutionFor(
          current.snapshot,
          current.path,
          right,
        );
        const rank = {
          unresolved: 0,
          duplicate: 1,
          resolved: 2,
        } as const;
        return rank[leftResolution] - rank[rightResolution];
      },
    )[0];
  }

  const parent = selection.$from.parent;
  if (!parent.isTextblock) return null;
  const offset = selection.$from.parentOffset;
  let found: VisualToken | null = null;
  parent.descendants((child, position) => {
    if (found || !child.isText || !child.text) return false;
    const link = child.marks.find(
      (mark) =>
        mark.type.name === "link" &&
        typeof mark.attrs.href === "string" &&
        mark.attrs.href.startsWith("#"),
    );
    if (link && offset >= position && offset <= position + child.nodeSize) {
      found = {
        key: String(link.attrs.href).slice(1),
        kind: "reference",
      };
      return false;
    }
    for (const match of textTokens(child.text)) {
      if (
        offset >= position + match.from &&
        offset <= position + match.to
      ) {
        found = match.token;
        return false;
      }
    }
    return true;
  });
  return found;
}

function openReferencesPanel() {
  const settings = useSettingsStore.getState();
  settings.setRailTab("refs");
  if (!settings.showTree) settings.toggleTree();
}

function showQuery(
  snapshot: ProjectIntelligenceSnapshot,
  mode: "references" | "definitions",
  targetId: string,
  title: string,
) {
  useReferencesStore.getState().show({
    ...snapshot.identity,
    mode,
    targetId,
    title,
  });
  openReferencesPanel();
}

function activateVisualToken(
  token: VisualToken,
  findAllReferences: boolean,
): boolean {
  const current = currentProjectIntelligence();
  if (!current) {
    const state = useIndexStore.getState().intelligenceState;
    if (state.status === "error" || state.status === "unavailable") {
      toast.error(
        state.failure?.message ??
          state.reason ??
          "Project reference analysis is unavailable.",
      );
    } else {
      toast.info("Project references are updating.");
    }
    return true;
  }

  const resolved = resolvedToken(current.snapshot, current.path, token);
  const use = resolved.useId
    ? lookupFor(current.snapshot).usesById.get(resolved.useId)
    : usesForToken(current.snapshot, current.path, resolved)[0];
  const definitions = definitionsForToken(
    current.snapshot,
    current.path,
    resolved,
  );

  if (definitions.length === 0) {
    toast.info(`No definition found for “${resolved.key}”.`);
    return true;
  }
  if (definitions.length > 1) {
    if (use) {
      showQuery(
        current.snapshot,
        "definitions",
        use.id,
        `Definitions for ${resolved.key}`,
      );
    } else {
      toast.info(
        `“${resolved.key}” has ${definitions.length} definitions. Open References to inspect them.`,
      );
      openReferencesPanel();
    }
    return true;
  }

  const definition = definitions[0];
  if (findAllReferences) {
    const uses = referencesFor(current.snapshot, definition.id);
    if (uses.length === 0) {
      toast.info(`No references to “${definition.name}”.`);
      return true;
    }
    showQuery(
      current.snapshot,
      "references",
      definition.id,
      `References to ${definition.name}`,
    );
    return true;
  }

  void navigateToProjectRange({
    path: definition.location.file,
    range: definition.location.range,
    source: "editor",
  });
  return true;
}

function visualAnalysisIsCurrent(view: EditorView): boolean {
  if (
    !visualProjectIntelligenceKey.getState(view.state)?.dirty &&
    currentProjectIntelligence()
  ) {
    return true;
  }
  toast.info("Project references are updating.");
  return false;
}

function publishVisualCurrent(view: EditorView) {
  setWysiwygProjectIntelligenceCurrent(
    !visualProjectIntelligenceKey.getState(view.state)?.dirty &&
      currentProjectIntelligence() !== null,
  );
}

export const VisualProjectIntelligence = Extension.create({
  name: "visualProjectIntelligence",

  addProseMirrorPlugins() {
    return [
      new Plugin<VisualPluginState>({
        key: visualProjectIntelligenceKey,
        state: {
          init: () => ({ dirty: false, revision: "" }),
          apply(transaction, value) {
            const revision = transaction.getMeta(
              visualProjectIntelligenceKey,
            ) as string | undefined;
            if (revision !== undefined) {
              return { dirty: false, revision };
            }
            return transaction.docChanged
              ? { ...value, dirty: true }
              : value;
          },
        },
        props: {
          decorations: decorationsFor,
          handleDOMEvents: {
            click(view, event) {
              const token = tokenFromElement(event.target);
              if (!token) return false;
              event.preventDefault();
              if (!visualAnalysisIsCurrent(view)) return true;
              return activateVisualToken(token, event.shiftKey);
            },
            keydown(view, event) {
              const isGoToDefinition =
                event.key === "F12" && !event.shiftKey;
              const isFindReferences =
                (event.key === "F12" && event.shiftKey) ||
                (event.key === "Enter" && event.shiftKey);
              const isKeyboardActivation =
                event.key === "Enter" && !event.shiftKey;
              if (
                !isGoToDefinition &&
                !isFindReferences &&
                !isKeyboardActivation
              ) {
                return false;
              }
              if (!visualAnalysisIsCurrent(view)) {
                event.preventDefault();
                return true;
              }
              const token =
                tokenFromElement(event.target) ?? tokenAtSelection(view);
              if (!token) return false;
              event.preventDefault();
              return activateVisualToken(token, isFindReferences);
            },
          },
        },
        view(view) {
          publishVisualCurrent(view);
          return {
            update(nextView) {
              publishVisualCurrent(nextView);
            },
            destroy() {
              setWysiwygProjectIntelligenceCurrent(false);
            },
          };
        },
      }),
    ];
  },
});

export function refreshVisualProjectIntelligence(
  editor: Editor,
  revision: string,
) {
  editor.view.dispatch(
    editor.state.tr.setMeta(visualProjectIntelligenceKey, revision),
  );
}

export function goToVisualDefinition(editor: Editor): boolean {
  if (!visualAnalysisIsCurrent(editor.view)) return true;
  const token = tokenAtSelection(editor.view);
  return token ? activateVisualToken(token, false) : false;
}

export function findVisualReferences(editor: Editor): boolean {
  if (!visualAnalysisIsCurrent(editor.view)) return true;
  const token = tokenAtSelection(editor.view);
  return token ? activateVisualToken(token, true) : false;
}
