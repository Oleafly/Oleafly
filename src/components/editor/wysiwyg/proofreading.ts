import { maskToProse, scanMathExpressions } from "@oleafly/editor";
import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@tiptap/pm/view";
import type {
  ProofreadingDiagnostic,
  ProofreadingFormat,
  ProofreadingSuggestion,
} from "@oleafly/editor";
import {
  cancelProofreading,
  proofreadDocument,
} from "@/lib/proofreading/client";
import { scrollVisualSelectionLocally } from "./scroll";
import {
  ignoreWordForProject,
  ignoreWordGlobally,
  useDictionary,
} from "@/lib/dictionary";
import { useFilesStore } from "@/store/files";
import { proofreadingPresentationDiagnostics } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";
import { isWysiwygActive } from "./controller";

export interface VisualProofreadingIssue
  extends ProofreadingDiagnostic {
  id: string;
  path: string;
  projectId: string | null;
  documentVersion: number;
  revision: number;
  requestGeneration: number;
  rawBlockSource?: {
    nodePosition: number;
    sourceFrom: number;
    sourceTo: number;
    sourceSnapshot: string;
  };
}

export interface VisualProofreadingIssueGroup {
  current: VisualProofreadingIssue;
  index: number;
  count: number;
  previous: VisualProofreadingIssue | null;
  next: VisualProofreadingIssue | null;
}

interface VisualProofreadingState {
  decorations: DecorationSet;
  issues: VisualProofreadingIssue[];
  dirty: boolean;
  revision: number;
  requestGeneration: number;
}

type VisualProofreadingMeta =
  | { type: "refresh" }
  | {
      type: "paint";
      doc: ProseMirrorNode;
      revision: number;
      requestGeneration: number;
      decorations: DecorationSet;
      issues: VisualProofreadingIssue[];
    };

interface ExtractedProse {
  text: string;
  map: number[];
  rawBlockIndex: number[];
  rawSourceOffset: number[];
  rawBlocks: {
    nodeFrom: number;
    nodeTo: number;
    source: string;
  }[];
  blockedPrefix: number[];
  gapPrefix: number[];
}

const visualProofreadingKey =
  new PluginKey<VisualProofreadingState>("visualProofreading");
const VISUAL_PROOFREADING_DEBOUNCE_MS = 800;
const VISUAL_PROOFREADING_COMPOSITION_RETRY_MS = 250;
let issueListener:
  | ((issue: VisualProofreadingIssue | null) => void)
  | null = null;

function formatForPath(path: string): ProofreadingFormat | null {
  if (/\.(?:tex|latex|ltx)$/iu.test(path)) return "latex";
  if (/\.(?:md|markdown)$/iu.test(path)) return "markdown";
  return null;
}

function currentIdentity(): {
  path: string;
  projectId: string | null;
  documentVersion: number;
  format: ProofreadingFormat;
} | null {
  const files = useFilesStore.getState();
  const path = files.activePath;
  if (!path) return null;
  const format = formatForPath(path);
  return format
    ? {
        path,
        projectId: files.projectId,
        documentVersion: files.docVersion,
        format,
      }
    : null;
}

export function extractVisualProofreadingProse(
  doc: ProseMirrorNode,
  format: ProofreadingFormat,
): ExtractedProse {
  let text = "";
  const map: number[] = [];
  const rawBlockIndex: number[] = [];
  const rawSourceOffset: number[] = [];
  const rawBlocks: ExtractedProse["rawBlocks"] = [];
  const blocked: boolean[] = [];
  let previousEnd = -1;

  doc.descendants((node, position, parent) => {
    if (node.type.name === "rawBlock") {
      const source = String(node.attrs.source ?? "");
      const prose = maskToProse(source);
      if (!prose.prose.trim()) return false;
      if (text && position > previousEnd) {
        text += "\n";
        map.push(position);
        rawBlockIndex.push(-1);
        rawSourceOffset.push(-1);
        blocked.push(true);
      }
      const region = rawBlocks.push({
        nodeFrom: position,
        nodeTo: position + node.nodeSize,
        source,
      }) - 1;
      for (let index = 0; index < prose.prose.length; index++) {
        text += prose.prose[index];
        map.push(position);
        rawBlockIndex.push(region);
        rawSourceOffset.push(prose.map[index] ?? -1);
        blocked.push(false);
      }
      previousEnd = position + node.nodeSize;
      return false;
    }
    if (
      node.type.name === "rawInline" ||
      node.type.name === "codeBlock" ||
      (node.isAtom && !node.isText)
    ) {
      return false;
    }
    if (!node.isText || !node.text) return true;
    if (
      parent?.type.name === "codeBlock" ||
      node.marks.some((mark) => mark.type.name === "code")
    ) {
      return false;
    }

    if (text && position > previousEnd) {
      text += "\n";
      map.push(position);
      rawBlockIndex.push(-1);
      rawSourceOffset.push(-1);
      blocked.push(true);
    }
    const visibleText = node.text;
    const mathRanges = scanMathExpressions(visibleText, {
      format: format === "latex" ? "latex" : "markdown",
    });
    let mathRangeIndex = 0;
    for (let index = 0; index < visibleText.length; index++) {
      while (
        mathRangeIndex < mathRanges.length &&
        mathRanges[mathRangeIndex].to <= index
      ) {
        mathRangeIndex++;
      }
      const mathRange = mathRanges[mathRangeIndex];
      const hidden =
        mathRange !== undefined &&
        index >= mathRange.from &&
        index < mathRange.to;
      // Keep one UTF-16 code unit for every visible document position.
      // Opaque inline math becomes whitespace so neighboring prose cannot be
      // joined into a false word while worker ranges still map exactly back
      // to ProseMirror positions.
      text += hidden ? " " : visibleText[index];
      map.push(position + index);
      rawBlockIndex.push(-1);
      rawSourceOffset.push(-1);
      blocked.push(hidden);
    }
    previousEnd = position + visibleText.length;
    return true;
  });
  const characters = text.split("");
  const protectedPatterns = [
    /(?:https?:\/\/|www\.)[^\s<>()]+/giu,
    /\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}\b/giu,
  ];
  for (const pattern of protectedPatterns) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const end = Math.min(
        characters.length,
        match.index + match[0].length,
      );
      for (let index = match.index; index < end; index++) {
        if (!/\s/u.test(characters[index])) characters[index] = " ";
        blocked[index] = true;
      }
    }
  }

  const blockedPrefix = new Array<number>(map.length + 1).fill(0);
  const gapPrefix = new Array<number>(map.length + 1).fill(0);
  for (let index = 0; index < map.length; index++) {
    blockedPrefix[index + 1] =
      blockedPrefix[index] + (blocked[index] ? 1 : 0);
    const sameRawBlock =
      index > 0 &&
      rawBlockIndex[index] >= 0 &&
      rawBlockIndex[index] === rawBlockIndex[index - 1] &&
      rawSourceOffset[index] === rawSourceOffset[index - 1] + 1;
    const contiguousDocumentText =
      index > 0 &&
      rawBlockIndex[index] < 0 &&
      rawBlockIndex[index - 1] < 0 &&
      map[index] === map[index - 1] + 1;
    gapPrefix[index + 1] =
      gapPrefix[index] +
      (index > 0 && !sameRawBlock && !contiguousDocumentText ? 1 : 0);
  }
  return {
    text: characters.join(""),
    map,
    rawBlockIndex,
    rawSourceOffset,
    rawBlocks,
    blockedPrefix,
    gapPrefix,
  };
}

export function mapVisualProofreadingDiagnostics(
  doc: ProseMirrorNode,
  diagnostics: ProofreadingDiagnostic[],
  extraction: ExtractedProse,
  identity: {
    path: string;
    projectId: string | null;
    documentVersion: number;
  },
  revision: number,
  requestGeneration: number,
): {
  issues: VisualProofreadingIssue[];
  decorations: DecorationSet;
} {
  const issues: VisualProofreadingIssue[] = [];
  const decorations: Decoration[] = [];
  const rawBlockDecorations = new Map<
    number,
    {
      from: number;
      to: number;
      firstIssue: VisualProofreadingIssue;
      count: number;
    }
  >();
  const decorationAttributes = (
    issue: VisualProofreadingIssue,
    count = 1,
  ) => ({
    class: `wysiwyg-proofreading is-${issue.source}`,
    role: "button",
    tabindex: "0",
    "aria-label":
      count > 1
        ? `${count} proofreading findings in this raw block. ${issue.message}. Open suggestions.`
        : `${issue.message}. Open proofreading suggestions.`,
    "aria-keyshortcuts": "Enter Space",
    "data-proofreading-issue": issue.id,
    "data-proofreading-count": String(count),
    title: issue.message,
  });
  for (const diagnostic of diagnostics) {
    if (
      diagnostic.from < 0 ||
      diagnostic.to <= diagnostic.from ||
      diagnostic.from >= extraction.map.length ||
      diagnostic.to > extraction.map.length
    ) {
      continue;
    }
    const blocked =
      extraction.blockedPrefix[diagnostic.to] -
      extraction.blockedPrefix[diagnostic.from];
    const firstInternalIndex = Math.min(
      diagnostic.from + 1,
      diagnostic.to,
    );
    const structuralGaps =
      extraction.gapPrefix[diagnostic.to] -
      extraction.gapPrefix[firstInternalIndex];
    // Never underline or mutate through an opaque/math/URL span or across a
    // ProseMirror structural boundary. A suggestion must apply to one exact,
    // contiguous, editable range.
    if (blocked > 0 || structuralGaps > 0) continue;
    const mappedRawBlock = extraction.rawBlockIndex[diagnostic.from];
    const rawBlock =
      mappedRawBlock >= 0
        ? extraction.rawBlocks[mappedRawBlock]
        : undefined;
    const from = rawBlock?.nodeFrom ?? extraction.map[diagnostic.from];
    const to =
      rawBlock?.nodeTo ??
      (extraction.map[
        Math.min(diagnostic.to, extraction.map.length) - 1
      ] ?? from) + 1;
    if (to <= from || to > doc.content.size) continue;
    const id = `${revision}:${requestGeneration}:${issues.length}`;
    const issue: VisualProofreadingIssue = {
      ...diagnostic,
      id,
      from,
      to,
      path: identity.path,
      projectId: identity.projectId,
      documentVersion: identity.documentVersion,
      revision,
      requestGeneration,
      ...(rawBlock
        ? {
            rawBlockSource: {
              nodePosition: rawBlock.nodeFrom,
              sourceFrom:
                extraction.rawSourceOffset[diagnostic.from],
              sourceTo:
                extraction.rawSourceOffset[diagnostic.to - 1] + 1,
              sourceSnapshot: rawBlock.source,
            },
          }
        : {}),
    };
    issues.push(issue);
    if (rawBlock) {
      const existing = rawBlockDecorations.get(mappedRawBlock);
      if (existing) {
        existing.count += 1;
      } else {
        rawBlockDecorations.set(mappedRawBlock, {
          from,
          to,
          firstIssue: issue,
          count: 1,
        });
      }
    } else {
      decorations.push(
        Decoration.inline(from, to, decorationAttributes(issue)),
      );
    }
  }
  for (const rawBlock of rawBlockDecorations.values()) {
    decorations.push(
      Decoration.node(
        rawBlock.from,
        rawBlock.to,
        decorationAttributes(rawBlock.firstIssue, rawBlock.count),
        { proofreadingCount: rawBlock.count },
      ),
    );
  }
  return {
    issues,
    decorations: DecorationSet.create(doc, decorations),
  };
}

function issueFromTarget(
  view: EditorView,
  target: EventTarget | null,
): VisualProofreadingIssue | null {
  if (!(target instanceof Element)) return null;
  const id = target
    .closest<HTMLElement>("[data-proofreading-issue]")
    ?.dataset.proofreadingIssue;
  if (!id) return null;
  return (
    visualProofreadingKey
      .getState(view.state)
      ?.issues.find((issue) => issue.id === id) ?? null
  );
}

function applyVisualProofreadingState(
  transaction: Transaction,
  previous: VisualProofreadingState,
  nextState: EditorState,
): VisualProofreadingState {
  const meta = transaction.getMeta(
    visualProofreadingKey,
  ) as VisualProofreadingMeta | null;
  if (transaction.docChanged || meta?.type === "refresh") {
    return {
      decorations: DecorationSet.empty,
      issues: [],
      dirty: true,
      revision: previous.revision + 1,
      requestGeneration: previous.requestGeneration,
    };
  }
  if (
    meta?.type === "paint" &&
    meta.doc === nextState.doc &&
    meta.revision === previous.revision &&
    meta.requestGeneration >= previous.requestGeneration
  ) {
    return {
      decorations: meta.decorations,
      issues: meta.issues,
      dirty: false,
      revision: previous.revision,
      requestGeneration: meta.requestGeneration,
    };
  }
  return previous;
}

function publishIssue(issue: VisualProofreadingIssue | null) {
  issueListener?.(issue);
}

export const VisualProofreading = Extension.create({
  name: "visualProofreading",

  addProseMirrorPlugins() {
    return [
      new Plugin<VisualProofreadingState>({
        key: visualProofreadingKey,
        state: {
          init: () => ({
            decorations: DecorationSet.empty,
            issues: [],
            dirty: true,
            revision: 0,
            requestGeneration: 0,
          }),
          apply: (transaction, previous, _oldState, nextState) =>
            applyVisualProofreadingState(
              transaction,
              previous,
              nextState,
            ),
        },
        props: {
          decorations(state) {
            return (
              visualProofreadingKey.getState(state)?.decorations ??
              DecorationSet.empty
            );
          },
          handleDOMEvents: {
            click(view, event) {
              const issue = issueFromTarget(view, event.target);
              if (!issue) return false;
              event.preventDefault();
              event.stopPropagation();
              publishIssue(issue);
              return true;
            },
            keydown(view, event) {
              if (event.key !== "Enter" && event.key !== " ") {
                return false;
              }
              const issue = issueFromTarget(view, event.target);
              if (!issue) return false;
              event.preventDefault();
              event.stopPropagation();
              publishIssue(issue);
              return true;
            },
          },
        },
        view(editorView) {
          let timer: ReturnType<typeof setTimeout> | null = null;
          let requestGeneration = 0;
          let requestedPath: string | null = null;
          let destroyed = false;

          const paintEmpty = (
            doc: ProseMirrorNode,
            revision: number,
            request: number,
          ) => {
            if (destroyed || editorView.state.doc !== doc) return;
            editorView.dispatch(
              editorView.state.tr.setMeta(visualProofreadingKey, {
                type: "paint",
                doc,
                revision,
                requestGeneration: request,
                decorations: DecorationSet.empty,
                issues: [],
              } satisfies VisualProofreadingMeta),
            );
          };

          const schedule = (
            delay = VISUAL_PROOFREADING_DEBOUNCE_MS,
          ) => {
            if (timer !== null) clearTimeout(timer);
            const state = visualProofreadingKey.getState(
              editorView.state,
            );
            if (!state) return;
            const doc = editorView.state.doc;
            const revision = state.revision;
            const request = ++requestGeneration;
            timer = setTimeout(() => {
              timer = null;
              const identity = currentIdentity();
              const settings = useSettingsStore.getState();
              if (
                destroyed ||
                editorView.state.doc !== doc ||
                visualProofreadingKey.getState(editorView.state)
                  ?.revision !== revision ||
                requestGeneration !== request
              ) {
                return;
              }
              if (editorView.composing) {
                schedule(VISUAL_PROOFREADING_COMPOSITION_RETRY_MS);
                return;
              }
              if (
                !identity ||
                !isWysiwygActive() ||
                (!settings.spellcheck && !settings.harper)
              ) {
                cancelProofreading(
                  "visual",
                  requestedPath ?? identity?.path,
                );
                requestedPath = null;
                paintEmpty(doc, revision, request);
                return;
              }

              const mode = settings.harper
                ? settings.spellcheck
                  ? "combined"
                  : "grammar"
                : "spelling";
              const extraction = extractVisualProofreadingProse(
                doc,
                identity.format,
              );
              const dictionary = useDictionary.getState();
              const ignoredWords = [
                ...dictionary.global,
                ...(identity.projectId
                  ? (dictionary.ignored[identity.projectId] ?? [])
                  : []),
              ];
              requestedPath = identity.path;
              void proofreadDocument({
                identity: {
                  projectId: identity.projectId,
                  path: identity.path,
                  revision,
                  surface: "visual",
                },
                text: extraction.text,
                // This is already display prose rather than serialized
                // LaTeX/Markdown. The worker's plaintext path additionally
                // masks visible URLs and email addresses while retaining its
                // own exact offset map.
                format: "plaintext",
                mode,
                ignoredWords,
                preferences: {
                  showRegionalism: settings.showRegionalism,
                  showWordChoice: settings.showWordChoice,
                },
              })
                .then((result) => {
                  const current = currentIdentity();
                  if (
                    destroyed ||
                    (result.status !== "ready" &&
                      result.status !== "partial") ||
                    editorView.state.doc !== doc ||
                    requestGeneration !== request ||
                    visualProofreadingKey.getState(editorView.state)
                      ?.revision !== revision ||
                    current?.path !== identity.path ||
                    current?.projectId !== identity.projectId ||
                    current?.documentVersion !==
                      identity.documentVersion ||
                    !isWysiwygActive()
                  ) {
                    if (
                      result.status !== "ready" &&
                      result.status !== "partial" &&
                      editorView.state.doc === doc &&
                      requestGeneration === request
                    ) {
                      paintEmpty(doc, revision, request);
                    }
                    return;
                  }
                  const painted = mapVisualProofreadingDiagnostics(
                    doc,
                    proofreadingPresentationDiagnostics(result),
                    extraction,
                    identity,
                    revision,
                    request,
                  );
                  editorView.dispatch(
                    editorView.state.tr.setMeta(
                      visualProofreadingKey,
                      {
                        type: "paint",
                        doc,
                        revision,
                        requestGeneration: request,
                        ...painted,
                      } satisfies VisualProofreadingMeta,
                    ),
                  );
                })
                .catch(() => {
                  // The client owns unavailable/cancelled status. Stale
                  // failures must not repaint this document.
                });
            }, delay);
          };

          const onRetry = (event: Event) => {
            const detail = (
              event as CustomEvent<{
                surface?: string;
                path?: string;
              }>
            ).detail;
            if (
              detail?.surface !== "visual" ||
              (detail.path && detail.path !== currentIdentity()?.path)
            ) {
              return;
            }
            schedule(0);
          };
          const onSettingsChanged = () => {
            cancelProofreading(
              "visual",
              requestedPath ?? currentIdentity()?.path,
            );
            requestedPath = null;
            publishIssue(null);
            schedule(0);
          };
          const onPresentationChanged = () => {
            schedule(0);
          };

          window.addEventListener(
            "oleafly:proofreading-retry",
            onRetry,
          );
          window.addEventListener(
            "oleafly:proofreading-settings-changed",
            onSettingsChanged,
          );
          window.addEventListener(
            "oleafly:proofreading-presentation-changed",
            onPresentationChanged,
          );
          schedule(0);
          return {
            update(view, previousState) {
              const current = visualProofreadingKey.getState(view.state);
              const previous =
                visualProofreadingKey.getState(previousState);
              if (current?.dirty && current.issues.length === 0) {
                publishIssue(null);
              }
              if (
                view.state.doc !== previousState.doc ||
                current?.revision !== previous?.revision ||
                (current?.dirty && !previous?.dirty)
              ) {
                if (
                  view.state.doc !== previousState.doc ||
                  current?.revision !== previous?.revision
                ) {
                  cancelProofreading(
                    "visual",
                    requestedPath ?? undefined,
                  );
                }
                schedule();
              }
            },
            destroy() {
              destroyed = true;
              requestGeneration++;
              if (timer !== null) clearTimeout(timer);
              timer = null;
              window.removeEventListener(
                "oleafly:proofreading-retry",
                onRetry,
              );
              window.removeEventListener(
                "oleafly:proofreading-settings-changed",
                onSettingsChanged,
              );
              window.removeEventListener(
                "oleafly:proofreading-presentation-changed",
                onPresentationChanged,
              );
              cancelProofreading(
                "visual",
                requestedPath ?? currentIdentity()?.path,
              );
              requestedPath = null;
              publishIssue(null);
            },
          };
        },
      }),
    ];
  },
});

export function setVisualProofreadingIssueListener(
  listener:
    | ((issue: VisualProofreadingIssue | null) => void)
    | null,
) {
  issueListener = listener;
}

export function refreshVisualProofreading(editor: Editor) {
  editor.view.dispatch(
    editor.state.tr.setMeta(visualProofreadingKey, {
      type: "refresh",
    } satisfies VisualProofreadingMeta),
  );
}

function currentIssue(
  editor: Editor,
  issue: VisualProofreadingIssue,
): VisualProofreadingIssue | null {
  const state = visualProofreadingKey.getState(editor.state);
  const identity = currentIdentity();
  if (
    !state ||
    !identity ||
    identity.path !== issue.path ||
    identity.projectId !== issue.projectId ||
    identity.documentVersion !== issue.documentVersion ||
    !isWysiwygActive() ||
    state.dirty ||
    state.revision !== issue.revision ||
    state.requestGeneration !== issue.requestGeneration
  ) {
    return null;
  }
  return (
    state.issues.find((candidate) => candidate.id === issue.id) ?? null
  );
}

/**
 * Groups findings sharing one semantic raw block while retaining one bounded
 * ProseMirror node decoration for that block. The returned neighbors make
 * every exact source-mapped finding keyboard accessible from its popover.
 */
export function groupVisualProofreadingIssues(
  issues: readonly VisualProofreadingIssue[],
  issue: VisualProofreadingIssue,
): VisualProofreadingIssueGroup {
  const siblings = issue.rawBlockSource
    ? issues.filter(
        (candidate) =>
          candidate.rawBlockSource?.nodePosition ===
          issue.rawBlockSource?.nodePosition,
      )
    : [issue];
  const index = Math.max(
    0,
    siblings.findIndex((candidate) => candidate.id === issue.id),
  );
  return {
    current: siblings[index] ?? issue,
    index,
    count: siblings.length,
    previous: index > 0 ? (siblings[index - 1] ?? null) : null,
    next:
      index + 1 < siblings.length
        ? (siblings[index + 1] ?? null)
        : null,
  };
}

export function visualProofreadingIssueGroup(
  editor: Editor,
  issue: VisualProofreadingIssue,
): VisualProofreadingIssueGroup | null {
  const active = currentIssue(editor, issue);
  const state = visualProofreadingKey.getState(editor.state);
  if (!active || !state) return null;
  return groupVisualProofreadingIssues(state.issues, active);
}

export function isVisualProofreadingIssueCurrent(
  editor: Editor,
  issue: VisualProofreadingIssue,
): boolean {
  return currentIssue(editor, issue) !== null;
}

export function applyVisualProofreadingSuggestion(
  editor: Editor,
  issue: VisualProofreadingIssue,
  suggestion: ProofreadingSuggestion,
): boolean {
  const active = currentIssue(editor, issue);
  if (!active) return false;
  if (active.rawBlockSource) {
    const {
      nodePosition,
      sourceFrom,
      sourceTo,
      sourceSnapshot,
    } = active.rawBlockSource;
    const node = editor.state.doc.nodeAt(nodePosition);
    const liveSource = String(node?.attrs.source ?? "");
    if (
      node?.type.name !== "rawBlock" ||
      liveSource !== sourceSnapshot ||
      sourceFrom < 0 ||
      sourceTo <= sourceFrom ||
      sourceTo > liveSource.length
    ) {
      return false;
    }
    const replacement =
      suggestion.kind === 1 ? "" : suggestion.text;
    const insertionPoint =
      suggestion.kind === 2 ? sourceTo : sourceFrom;
    const nextSource =
      liveSource.slice(0, insertionPoint) +
      replacement +
      liveSource.slice(sourceTo);
    const transaction = editor.state.tr.setNodeMarkup(
      nodePosition,
      undefined,
      { ...node.attrs, source: nextSource },
    );
    transaction.setSelection(
      TextSelection.near(
        transaction.doc.resolve(
          Math.min(
            nodePosition + 1,
            transaction.doc.content.size,
          ),
        ),
      ),
    );
    editor.view.dispatch(transaction);
    scrollVisualSelectionLocally(editor.view);
    editor.view.focus();
    publishIssue(null);
    return true;
  }
  const transaction = editor.state.tr;
  if (suggestion.kind === 2) {
    transaction.insertText(suggestion.text, active.to);
  } else if (suggestion.kind === 1) {
    transaction.delete(active.from, active.to);
  } else {
    transaction.insertText(
      suggestion.text,
      active.from,
      active.to,
    );
  }
  const cursor =
    suggestion.kind === 1
      ? active.from
      : suggestion.kind === 2
        ? active.to + suggestion.text.length
        : active.from + suggestion.text.length;
  transaction.setSelection(
    TextSelection.near(
      transaction.doc.resolve(
        Math.min(cursor, transaction.doc.content.size),
      ),
    ),
  );
  editor.view.dispatch(transaction);
  scrollVisualSelectionLocally(editor.view);
  editor.view.focus();
  publishIssue(null);
  return true;
}

export function ignoreVisualProofreadingIssue(
  editor: Editor,
  issue: VisualProofreadingIssue,
  scope: "project" | "global",
): boolean {
  const active = currentIssue(editor, issue);
  const ignoredWord = active?.word
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")
    .trim();
  if (!active || !ignoredWord) return false;
  if (scope === "project") {
    if (!active.projectId) return false;
    ignoreWordForProject(active.projectId, ignoredWord);
  } else {
    ignoreWordGlobally(ignoredWord);
  }
  refreshVisualProofreading(editor);
  publishIssue(null);
  return true;
}
