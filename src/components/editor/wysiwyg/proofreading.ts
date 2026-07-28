import {
  PROOFREADING_LIMITS,
  scanMathExpressions,
} from "@oleafly/editor";
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
import {
  ignoreWordForProject,
  ignoreWordGlobally,
  useDictionary,
} from "@/lib/dictionary";
import { useFilesStore } from "@/store/files";
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
  blockedPrefix: number[];
  gapPrefix: number[];
}

const visualProofreadingKey =
  new PluginKey<VisualProofreadingState>("visualProofreading");
const VISUAL_PROOFREADING_DEBOUNCE_MS = 800;
const VISUAL_PROOFREADING_COMPOSITION_RETRY_MS = 250;
const MAX_VISUAL_PROOFREADING_DECORATIONS = 500;
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

function extractedProse(
  doc: ProseMirrorNode,
  format: ProofreadingFormat,
  maxCharacters: number,
): ExtractedProse {
  let text = "";
  const map: number[] = [];
  const blocked: boolean[] = [];
  let previousEnd = -1;

  doc.descendants((node, position, parent) => {
    if (text.length >= maxCharacters) return false;
    if (
      node.type.name === "rawInline" ||
      node.type.name === "rawBlock" ||
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
      blocked.push(true);
    }
    const remaining = maxCharacters - text.length;
    if (remaining <= 0) return false;
    const visibleText = node.text.slice(0, remaining);
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
    gapPrefix[index + 1] =
      gapPrefix[index] +
      (index > 0 && map[index] !== map[index - 1] + 1 ? 1 : 0);
  }
  return {
    text: characters.join(""),
    map,
    blockedPrefix,
    gapPrefix,
  };
}

function issuesAndDecorations(
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
  for (const diagnostic of diagnostics.slice(
    0,
    MAX_VISUAL_PROOFREADING_DECORATIONS,
  )) {
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
    const from = extraction.map[diagnostic.from];
    const to =
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
    };
    issues.push(issue);
    decorations.push(
      Decoration.inline(from, to, {
        class: `wysiwyg-proofreading is-${diagnostic.source}`,
        role: "button",
        tabindex: "0",
        "aria-label": `${diagnostic.message}. Open proofreading suggestions.`,
        "aria-keyshortcuts": "Enter Space",
        "data-proofreading-issue": id,
        title: diagnostic.message,
      }),
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
                ? "grammar"
                : "spelling";
              const characterLimit =
                mode === "grammar"
                  ? PROOFREADING_LIMITS.grammarCharacters
                  : PROOFREADING_LIMITS.spellingCharacters;
              const extraction = extractedProse(
                doc,
                identity.format,
                characterLimit + 1,
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
                    result.status !== "ready" ||
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
                      editorView.state.doc === doc &&
                      requestGeneration === request
                    ) {
                      paintEmpty(doc, revision, request);
                    }
                    return;
                  }
                  const painted = issuesAndDecorations(
                    doc,
                    result.diagnostics,
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

          window.addEventListener(
            "oleafly:proofreading-retry",
            onRetry,
          );
          window.addEventListener(
            "oleafly:proofreading-settings-changed",
            onSettingsChanged,
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
  transaction
    .setSelection(
      TextSelection.near(
        transaction.doc.resolve(
          Math.min(cursor, transaction.doc.content.size),
        ),
      ),
    )
    .scrollIntoView();
  editor.view.dispatch(transaction);
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
