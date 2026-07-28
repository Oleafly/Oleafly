import {
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  forceLinting,
  linter,
  type Diagnostic as CodeMirrorDiagnostic,
} from "@codemirror/lint";
import {
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  hoverTooltip,
  ViewPlugin,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import {
  currentInteractiveLanguageService,
  subscribeInteractiveLanguageService,
  type InteractiveLanguageServiceDocument,
  type InteractiveLanguageServiceSession,
} from "@/lib/analysis/interactive-language-service";
import {
  TextPositionIndex,
  type PositionEncoding,
} from "@/lib/language-service";
import { useFilesStore } from "@/store/files";
import { useProjectAnalysisStore } from "@/store/project-analysis";

const LANGUAGE_SERVICE_PATH =
  /\.(?:tex|latex|ltx|sty|cls|typ)$/i;
const COMPLETION_TIMEOUT_MS = 2_500;
const HOVER_TIMEOUT_MS = 3_000;
const SEMANTIC_TOKENS_TIMEOUT_MS = 5_000;
const MAX_COMPLETION_ITEMS = 500;
const MAX_COMPLETION_TEXT = 20_000;
const MAX_HOVER_TEXT = 6_000;

const isRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value);

function boundedText(
  value: unknown,
  limit: number,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\0/g, "");
  if (!normalized) return null;
  return normalized.slice(0, limit);
}

function currentDocument(
  path: string,
  text: string,
): {
  session: InteractiveLanguageServiceSession;
  document: InteractiveLanguageServiceDocument;
} | null {
  const files = useFilesStore.getState();
  const session = currentInteractiveLanguageService();
  if (
    !session ||
    !files.projectId ||
    files.projectId !== session.projectId ||
    files.activePath !== path ||
    files.files[path]?.content !== text
  ) {
    return null;
  }
  const document = session.documentForPath(path);
  if (!document || document.text !== text) return null;
  return { session, document };
}

function requestStillCurrent(
  session: InteractiveLanguageServiceSession,
  document: InteractiveLanguageServiceDocument,
  text: string,
): boolean {
  const current = currentDocument(document.path, text);
  return Boolean(
    current &&
      current.session.owner === session.owner &&
      current.session.projectRevision === session.projectRevision &&
      current.session.client.generation === session.client.generation &&
      current.document.uri === document.uri &&
      current.document.version === document.version,
  );
}

function completionType(kind: unknown): string | undefined {
  if (kind === 2 || kind === 3 || kind === 4) return "function";
  if (kind === 5 || kind === 22) return "type";
  if (kind === 6 || kind === 8 || kind === 10) return "variable";
  if (kind === 7) return "class";
  if (kind === 9) return "namespace";
  if (kind === 12) return "property";
  if (kind === 13 || kind === 21) return "constant";
  if (kind === 14) return "keyword";
  if (kind === 15) return "snippet";
  if (kind === 17 || kind === 18 || kind === 19) return "text";
  if (kind === 20) return "variable";
  if (kind === 23 || kind === 24) return "type";
  return undefined;
}

/** Trims the package extension: the column already reads as "where from". */
function completionDetail(detail: unknown): string | undefined {
  const text = boundedText(detail, 1_000);
  return text ? text.replace(/\.sty$/u, "") : undefined;
}

function completionDocumentation(value: unknown): string | undefined {
  if (typeof value === "string") {
    return boundedText(value, 2_000) ?? undefined;
  }
  if (isRecord(value)) {
    return boundedText(value.value, 2_000) ?? undefined;
  }
  return undefined;
}

/**
 * LSP snippets and CodeMirror snippets use different placeholder grammars.
 * Server defaults are retained, while tabstop/control syntax is removed so a
 * completion can never insert raw `${1:...}` markers into the document.
 */
function plainTextFromLspSnippet(value: string): string {
  const input = value.slice(0, MAX_COMPLETION_TEXT);
  let output = "";
  for (let cursor = 0; cursor < input.length; cursor += 1) {
    const char = input[cursor];
    if (char === "\\" && cursor + 1 < input.length) {
      const next = input[cursor + 1];
      if (next === "$" || next === "}" || next === "\\") {
        output += next;
        cursor += 1;
        continue;
      }
    }
    if (char !== "$") {
      output += char;
      continue;
    }
    if (/\d/.test(input[cursor + 1] ?? "")) {
      while (/\d/.test(input[cursor + 1] ?? "")) cursor += 1;
      continue;
    }
    if (input[cursor + 1] !== "{") {
      output += char;
      continue;
    }
    const close = input.indexOf("}", cursor + 2);
    if (close < 0) {
      output += input.slice(cursor);
      break;
    }
    const placeholder = input.slice(cursor + 2, close);
    const defaultSeparator = placeholder.indexOf(":");
    const choiceSeparator = placeholder.indexOf("|");
    if (defaultSeparator >= 0) {
      output += placeholder.slice(defaultSeparator + 1);
    } else if (
      choiceSeparator >= 0 &&
      placeholder.endsWith("|")
    ) {
      output +=
        placeholder
          .slice(choiceSeparator + 1, -1)
          .split(",", 1)[0] ?? "";
    }
    cursor = close;
  }
  return output;
}

function codeMirrorSnippetFromLsp(value: string): string {
  return value
    .slice(0, MAX_COMPLETION_TEXT)
    .replace(
      /\$\{(\d+)\|([^}]*)\|\}/g,
      (_match, index: string, choices: string) =>
        `\${${index}:${choices.split(",", 1)[0] ?? ""}}`,
    )
    .replace(/\$(\d+)/g, (_match, index: string) => `\${${index}}`);
}

interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

function strictOffset(
  index: TextPositionIndex,
  position: { line: number; character: number },
  encoding: PositionEncoding,
): number | null {
  if (
    position.line < 0 ||
    position.line >= index.lineCount ||
    position.character < 0
  ) {
    return null;
  }
  const offset = index.positionToOffset(position, encoding);
  const roundTrip = index.offsetToPosition(offset, encoding);
  return roundTrip.line === position.line &&
    roundTrip.character === position.character
    ? offset
    : null;
}

function rangeFromValue(
  value: unknown,
  index: TextPositionIndex,
  encoding: PositionEncoding,
): { from: number; to: number } | null {
  if (
    !isRecord(value) ||
    !isRecord(value.start) ||
    !isRecord(value.end)
  ) {
    return null;
  }
  const lineStart = value.start.line;
  const charStart = value.start.character;
  const lineEnd = value.end.line;
  const charEnd = value.end.character;
  if (
    typeof lineStart !== "number" ||
    typeof charStart !== "number" ||
    typeof lineEnd !== "number" ||
    typeof charEnd !== "number" ||
    !Number.isInteger(lineStart) ||
    !Number.isInteger(charStart) ||
    !Number.isInteger(lineEnd) ||
    !Number.isInteger(charEnd) ||
    (lineStart as number) < 0 ||
    (charStart as number) < 0 ||
    (lineEnd as number) < 0 ||
    (charEnd as number) < 0
  ) {
    return null;
  }
  const from = strictOffset(
    index,
    {
      line: lineStart as number,
      character: charStart as number,
    },
    encoding,
  );
  const to = strictOffset(
    index,
    {
      line: lineEnd as number,
      character: charEnd as number,
    },
    encoding,
  );
  return from !== null && to !== null && to >= from
    ? { from, to }
    : null;
}

function editFromValue(
  value: unknown,
  index: TextPositionIndex,
  encoding: PositionEncoding,
  snippetFormat: boolean,
): TextEdit | null {
  if (!isRecord(value)) return null;
  const range =
    rangeFromValue(value.range, index, encoding) ??
    rangeFromValue(value.insert, index, encoding);
  const newText = boundedText(value.newText, MAX_COMPLETION_TEXT);
  if (!range || newText === null) return null;
  return {
    ...range,
    insert: snippetFormat
      ? plainTextFromLspSnippet(newText)
      : newText,
  };
}

function editsDoNotOverlap(edits: readonly TextEdit[]): boolean {
  const sorted = [...edits].sort(
    (left, right) => left.from - right.from || left.to - right.to,
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (
      sorted[index].from < sorted[index - 1].to ||
      (sorted[index].from === sorted[index - 1].from &&
        sorted[index].to === sorted[index - 1].to)
    ) {
      return false;
    }
  }
  return true;
}

function guardedCompletionApply(
  session: InteractiveLanguageServiceSession,
  document: InteractiveLanguageServiceDocument,
  originalText: string,
  mainEdit: TextEdit,
  additionalEdits: readonly TextEdit[],
  snippetTemplate: string | null,
): NonNullable<Completion["apply"]> {
  return (view, completion) => {
    if (
      view.state.doc.toString() !== originalText ||
      !requestStillCurrent(session, document, originalText)
    ) {
      return;
    }
    const edits = [mainEdit, ...additionalEdits];
    if (!editsDoNotOverlap(edits)) return;
    if (snippetTemplate && additionalEdits.length === 0) {
      snippet(snippetTemplate)(
        view,
        completion,
        mainEdit.from,
        mainEdit.to,
      );
      return;
    }
    view.dispatch({
      changes: edits
        .sort((left, right) => left.from - right.from)
        .map((edit) => ({
          from: edit.from,
          to: edit.to,
          insert: edit.insert,
        })),
      userEvent: "input.complete",
    });
  };
}

function completionItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.items)) {
    return value.items;
  }
  return [];
}

function normalizeCompletion(
  value: unknown,
  session: InteractiveLanguageServiceSession,
  document: InteractiveLanguageServiceDocument,
  text: string,
  fallbackFrom: number,
  position: number,
): Completion[] {
  const index = new TextPositionIndex(text);
  const seen = new Set<string>();
  const options: Completion[] = [];
  for (const raw of completionItems(value)) {
    if (options.length >= MAX_COMPLETION_ITEMS || !isRecord(raw)) break;
    const label = boundedText(raw.label, 500);
    if (!label) continue;
    const snippetFormat = raw.insertTextFormat === 2;
    const insertedValue =
      boundedText(raw.insertText, MAX_COMPLETION_TEXT) ?? label;
    const textEditValue = isRecord(raw.textEdit)
      ? boundedText(raw.textEdit.newText, MAX_COMPLETION_TEXT)
      : null;
    const snippetTemplate = snippetFormat
      ? codeMirrorSnippetFromLsp(
          textEditValue ?? insertedValue,
        )
      : null;
    const inserted = snippetFormat
      ? plainTextFromLspSnippet(insertedValue)
      : insertedValue;
    const mainEdit =
      editFromValue(
        raw.textEdit,
        index,
        session.positionEncoding,
        snippetFormat,
      ) ?? {
        from: fallbackFrom,
        to: position,
        insert: inserted,
      };
    if (
      mainEdit.from < 0 ||
      mainEdit.to < mainEdit.from ||
      mainEdit.to > text.length
    ) {
      continue;
    }
    const additionalEdits = Array.isArray(raw.additionalTextEdits)
      ? raw.additionalTextEdits
          .slice(0, 50)
          .map((edit) =>
            editFromValue(
              edit,
              index,
              session.positionEncoding,
              false,
            ),
          )
          .filter((edit): edit is TextEdit => edit !== null)
      : [];
    const key = `${label}\0${mainEdit.from}\0${mainEdit.to}\0${mainEdit.insert}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      label,
      type: completionType(raw.kind),
      detail: completionDetail(raw.detail),
      info: completionDocumentation(raw.documentation),
      boost:
        typeof raw.sortText === "string"
          ? Math.max(-99, 99 - options.length)
          : undefined,
      apply: guardedCompletionApply(
        session,
        document,
        text,
        mainEdit,
        additionalEdits,
        snippetTemplate,
      ),
    });
  }
  return options;
}

function shouldRequestCompletion(
  context: CompletionContext,
  path: string,
): boolean {
  if (context.explicit) return true;
  const before = context.state.sliceDoc(
    Math.max(0, context.pos - 300),
    context.pos,
  );
  if (/\.typ$/i.test(path)) {
    return /(?:#|@|<)[\p{L}\p{N}_:.-]*$/u.test(before);
  }
  return (
    /\\[\p{L}@]*$/u.test(before) ||
    /\\(?:begin|end|usepackage|documentclass)\s*(?:\[[^\]]*\])?\{[^{}]*$/u.test(
      before,
    )
  );
}

export const languageServiceCompletion: CompletionSource = async (
  context,
): Promise<CompletionResult | null> => {
  const files = useFilesStore.getState();
  const path = files.activePath;
  if (
    !path ||
    !LANGUAGE_SERVICE_PATH.test(path) ||
    !shouldRequestCompletion(context, path)
  ) {
    return null;
  }
  const text = context.state.doc.toString();
  const current = currentDocument(path, text);
  if (
    !current ||
    !current.session.client.supports("completion")
  ) {
    return null;
  }
  const token = context.matchBefore(
    /[\\#@<]?(?:[\p{L}\p{N}_:./@-]*)$/u,
  );
  const fallbackFrom = token?.from ?? context.pos;
  const positions = new TextPositionIndex(text);
  const abort = new AbortController();
  context.addEventListener("abort", () => abort.abort(), {
    onDocChange: true,
  });
  try {
    const response =
      await current.session.client.requestCompletion(
        {
          textDocument: { uri: current.document.uri },
          position: positions.offsetToPosition(
            context.pos,
            current.session.positionEncoding,
          ),
          context: { triggerKind: 1 },
        },
        {
          signal: abort.signal,
          timeoutMs: COMPLETION_TIMEOUT_MS,
          projectRevision: current.session.projectRevision,
          documentUri: current.document.uri,
          documentVersion: current.document.version,
        },
      );
    if (
      abort.signal.aborted ||
      !requestStillCurrent(
        current.session,
        current.document,
        text,
      )
    ) {
      return null;
    }
    const options = normalizeCompletion(
      response,
      current.session,
      current.document,
      text,
      fallbackFrom,
      context.pos,
    );
    return options.length > 0
      ? { from: fallbackFrom, options, filter: false }
      : null;
  } catch {
    // Static and project-index completion remain available while the service
    // is starting, synchronizing, unsupported, or recovering.
    return null;
  }
};

function hoverText(value: unknown): string | null {
  if (typeof value === "string") {
    return boundedText(value, MAX_HOVER_TEXT);
  }
  if (Array.isArray(value)) {
    const text = value
      .map((part) => {
        if (typeof part === "string") return part;
        if (isRecord(part)) {
          return (
            boundedText(part.value, MAX_HOVER_TEXT) ??
            boundedText(part.language, 100) ??
            ""
          );
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
    return boundedText(text, MAX_HOVER_TEXT);
  }
  if (isRecord(value)) {
    return boundedText(value.value, MAX_HOVER_TEXT);
  }
  return null;
}

function hoverTooltipForText(
  position: number,
  text: string,
): Tooltip {
  return {
    pos: position,
    above: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-language-service-hover";
      dom.textContent = text;
      return { dom };
    },
  };
}

const languageServiceHoverSource = async (
  view: EditorView,
  position: number,
): Promise<Tooltip | null> => {
  const files = useFilesStore.getState();
  const path = files.activePath;
  if (!path || !LANGUAGE_SERVICE_PATH.test(path)) return null;
  const text = view.state.doc.toString();
  const current = currentDocument(path, text);
  if (!current || !current.session.client.supports("hover")) {
    return null;
  }
  const abort = new AbortController();
  try {
    const response = await current.session.client.requestHover(
      {
        textDocument: { uri: current.document.uri },
        position: new TextPositionIndex(text).offsetToPosition(
          position,
          current.session.positionEncoding,
        ),
      },
      {
        signal: abort.signal,
        timeoutMs: HOVER_TIMEOUT_MS,
        projectRevision: current.session.projectRevision,
        documentUri: current.document.uri,
        documentVersion: current.document.version,
      },
    );
    if (
      view.state.doc.toString() !== text ||
      !requestStillCurrent(
        current.session,
        current.document,
        text,
      ) ||
      !isRecord(response)
    ) {
      return null;
    }
    const content = hoverText(response.contents);
    return content
      ? hoverTooltipForText(position, content)
      : null;
  } catch {
    return null;
  }
};

export function languageServiceHover(): Extension {
  return hoverTooltip(languageServiceHoverSource, {
    hoverTime: 350,
  });
}

const refreshLanguageServiceDiagnostics =
  StateEffect.define<number>();

function diagnosticsNeedRefresh(update: ViewUpdate): boolean {
  return update.transactions.some((transaction) =>
    transaction.effects.some((effect) =>
      effect.is(refreshLanguageServiceDiagnostics),
    ),
  );
}

function currentLanguageServiceDiagnostics(
  view: EditorView,
): CodeMirrorDiagnostic[] {
  const files = useFilesStore.getState();
  const path = files.activePath;
  if (!path || !LANGUAGE_SERVICE_PATH.test(path)) return [];
  const text = view.state.doc.toString();
  const current = currentDocument(path, text);
  if (!current) return [];
  const snapshot = useProjectAnalysisStore.getState().snapshot;
  const entry =
    snapshot.diagnosticsByUri[current.document.uri];
  if (
    !entry ||
    entry.status !== "acknowledged" ||
    snapshot.identity.projectId !== current.session.projectId ||
    snapshot.identity.projectRevision !==
      current.session.projectRevision ||
    snapshot.identity.languageServiceGeneration !==
      current.session.client.generation ||
    entry.request.projectRevision !==
      current.session.projectRevision ||
    entry.request.documentVersion !== current.document.version
  ) {
    return [];
  }
  const positions = new TextPositionIndex(text);
  return entry.data.flatMap((diagnostic) => {
    if (
      diagnostic.projectRevision !==
        current.session.projectRevision ||
      (diagnostic.documentVersion !== undefined &&
        diagnostic.documentVersion !== current.document.version)
    ) {
      return [];
    }
    const from = strictOffset(
      positions,
      diagnostic.range.start,
      current.session.positionEncoding,
    );
    const to = strictOffset(
      positions,
      diagnostic.range.end,
      current.session.positionEncoding,
    );
    if (from === null || to === null || to < from) return [];
    return [
      {
        from,
        to,
        severity:
          diagnostic.severity === "information"
            ? "info"
            : diagnostic.severity,
        message: diagnostic.message,
        source: diagnostic.source || "language service",
      } satisfies CodeMirrorDiagnostic,
    ];
  });
}

function diagnosticsRevision(): number {
  return useProjectAnalysisStore.getState().snapshot.updatedAt;
}

export function languageServiceDiagnostics(): Extension[] {
  const diagnostics = linter(currentLanguageServiceDiagnostics, {
    delay: 0,
    needsRefresh: diagnosticsNeedRefresh,
    // Diagnostics render through the shared hover card, so the stock lint
    // tooltip must not also appear.
    tooltipFilter: () => [],
  });
  const lifecycle = ViewPlugin.define((view) => {
    let disposed = false;
    let queued = false;
    let revision = diagnosticsRevision();
    const refresh = () => {
      if (queued || disposed) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (disposed || !view.dom.isConnected) return;
        revision = diagnosticsRevision();
        view.dispatch({
          effects:
            refreshLanguageServiceDiagnostics.of(revision),
        });
        forceLinting(view);
      });
    };
    const unsubscribeStore =
      useProjectAnalysisStore.subscribe((state) => {
        if (state.snapshot.updatedAt !== revision) refresh();
      });
    const unsubscribeRuntime =
      subscribeInteractiveLanguageService(refresh);
    return {
      destroy() {
        disposed = true;
        unsubscribeStore();
        unsubscribeRuntime();
      },
    };
  });
  return [diagnostics, lifecycle];
}

interface SemanticTokenRange {
  from: number;
  to: number;
  className: string;
}

interface SemanticTokenPayload {
  text: string;
  ranges: SemanticTokenRange[];
}

const installSemanticTokens =
  StateEffect.define<SemanticTokenPayload | null>();

const semanticTokenField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let replaced = false;
    if (transaction.docChanged) {
      value = Decoration.none;
      replaced = true;
    }
    for (const effect of transaction.effects) {
      if (!effect.is(installSemanticTokens)) continue;
      replaced = true;
      if (
        !effect.value ||
        transaction.state.doc.toString() !== effect.value.text
      ) {
        value = Decoration.none;
        continue;
      }
      value = Decoration.set(
        effect.value.ranges.map((range) =>
          Decoration.mark({
            class: range.className,
          }).range(range.from, range.to),
        ),
        true,
      );
    }
    return replaced ? value : value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function semanticClass(tokenType: string): string | null {
  if (tokenType === "keyword" || tokenType === "modifier") {
    return "cm-semantic-keyword";
  }
  if (tokenType === "comment") return "cm-semantic-comment";
  if (tokenType === "string") return "cm-semantic-string";
  if (tokenType === "number") return "cm-semantic-number";
  if (
    tokenType === "function" ||
    tokenType === "method" ||
    tokenType === "macro"
  ) {
    return "cm-semantic-function";
  }
  if (
    tokenType === "type" ||
    tokenType === "class" ||
    tokenType === "struct" ||
    tokenType === "enum" ||
    tokenType === "interface" ||
    tokenType === "typeParameter"
  ) {
    return "cm-semantic-type";
  }
  if (
    tokenType === "property" ||
    tokenType === "enumMember"
  ) {
    return "cm-semantic-property";
  }
  if (
    tokenType === "variable" ||
    tokenType === "parameter"
  ) {
    return "cm-semantic-variable";
  }
  if (tokenType === "operator") return "cm-semantic-operator";
  if (tokenType === "namespace") return "cm-semantic-namespace";
  if (tokenType === "decorator") return "cm-semantic-decorator";
  if (tokenType === "regexp") return "cm-semantic-regexp";
  return null;
}

function semanticTokenData(value: unknown): number[] | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.data) ||
    value.data.length % 5 !== 0 ||
    !value.data.every(
      (item) =>
        Number.isInteger(item) && (item as number) >= 0,
    )
  ) {
    return null;
  }
  return value.data as number[];
}

function decodeSemanticTokens(
  value: unknown,
  session: InteractiveLanguageServiceSession,
  text: string,
): SemanticTokenRange[] | null {
  const data = semanticTokenData(value);
  const legend =
    session.client.capabilities.semanticTokens.legend;
  if (
    !data ||
    !legend ||
    data.length > (text.length + 1) * 5
  ) {
    return null;
  }
  const positions = new TextPositionIndex(text);
  const ranges: SemanticTokenRange[] = [];
  let line = 0;
  let character = 0;
  for (let cursor = 0; cursor < data.length; cursor += 5) {
    const deltaLine = data[cursor];
    const deltaStart = data[cursor + 1];
    const length = data[cursor + 2];
    const typeIndex = data[cursor + 3];
    if (deltaLine > 0) {
      line += deltaLine;
      character = deltaStart;
    } else {
      character += deltaStart;
    }
    const tokenType = legend.tokenTypes[typeIndex];
    const className = tokenType
      ? semanticClass(tokenType)
      : null;
    if (!className || length === 0) continue;
    const from = strictOffset(
      positions,
      { line, character },
      session.positionEncoding,
    );
    const to = strictOffset(
      positions,
      { line, character: character + length },
      session.positionEncoding,
    );
    if (from === null || to === null) return null;
    if (to > from) {
      ranges.push({ from, to, className });
    }
  }
  return ranges;
}

const semanticTheme = EditorView.baseTheme({
  ".cm-semantic-keyword": {
    color: "var(--cm-keyword) !important",
  },
  ".cm-semantic-comment": {
    color: "var(--cm-comment) !important",
    fontStyle: "italic",
  },
  ".cm-semantic-string, .cm-semantic-regexp": {
    color: "var(--cm-string) !important",
  },
  ".cm-semantic-number": {
    color: "var(--cm-number) !important",
  },
  ".cm-semantic-function": {
    color: "var(--cm-tag) !important",
  },
  ".cm-semantic-type, .cm-semantic-namespace": {
    color: "var(--cm-meta) !important",
  },
  ".cm-semantic-property, .cm-semantic-variable": {
    color: "var(--cm-variable) !important",
  },
  ".cm-semantic-operator, .cm-semantic-decorator": {
    color: "var(--cm-operator) !important",
  },
  ".cm-language-service-hover": {
    maxWidth: "min(36rem, 80vw)",
    maxHeight: "20rem",
    overflow: "auto",
    whiteSpace: "pre-wrap",
    padding: "0.5rem 0.625rem",
    fontFamily: "var(--font-mono)",
    fontSize: "0.75rem",
    lineHeight: "1.45",
  },
});

function semanticTokensPlugin(): Extension {
  return ViewPlugin.define((view) => {
    let disposed = false;
    let generation = 0;
    let abort: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      timer = null;
      const requestGeneration = ++generation;
      abort?.abort();
      abort = null;
      const files = useFilesStore.getState();
      const path = files.activePath;
      const text = view.state.doc.toString();
      if (!path || !LANGUAGE_SERVICE_PATH.test(path)) {
        view.dispatch({ effects: installSemanticTokens.of(null) });
        return;
      }
      const current = currentDocument(path, text);
      if (
        !current ||
        !current.session.client.supports("semanticTokensFull")
      ) {
        view.dispatch({ effects: installSemanticTokens.of(null) });
        return;
      }
      const controller = new AbortController();
      abort = controller;
      const requestOptions = {
        signal: controller.signal,
        timeoutMs: SEMANTIC_TOKENS_TIMEOUT_MS,
        projectRevision: current.session.projectRevision,
        documentUri: current.document.uri,
        documentVersion: current.document.version,
      };
      const rangeSupported = current.session.client.supports(
        "semanticTokensRange",
      );
      const visibleFrom =
        view.visibleRanges[0]?.from ?? 0;
      const visibleTo =
        view.visibleRanges.at(-1)?.to ?? text.length;
      const positionIndex = new TextPositionIndex(text);
      const request = rangeSupported
        ? current.session.client.requestSemanticTokensRange(
            {
              textDocument: { uri: current.document.uri },
              range: {
                start: positionIndex.offsetToPosition(
                  visibleFrom,
                  current.session.positionEncoding,
                ),
                end: positionIndex.offsetToPosition(
                  visibleTo,
                  current.session.positionEncoding,
                ),
              },
            },
            requestOptions,
          )
        : current.session.client.requestSemanticTokensFull(
            { textDocument: { uri: current.document.uri } },
            requestOptions,
          );
      void request
        .then((response) => {
          if (
            disposed ||
            controller.signal.aborted ||
            generation !== requestGeneration ||
            view.state.doc.toString() !== text ||
            !requestStillCurrent(
              current.session,
              current.document,
              text,
            )
          ) {
            return;
          }
          const ranges = decodeSemanticTokens(
            response,
            current.session,
            text,
          );
          view.dispatch({
            effects: installSemanticTokens.of(
              ranges ? { text, ranges } : null,
            ),
          });
        })
        .catch(() => {
          if (
            !disposed &&
            !controller.signal.aborted &&
            generation === requestGeneration
          ) {
            view.dispatch({
              effects: installSemanticTokens.of(null),
            });
          }
        });
    };

    const schedule = (delay: number) => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(refresh, delay);
    };
    const unsubscribe =
      subscribeInteractiveLanguageService(() => schedule(0));
    queueMicrotask(() => schedule(0));
    return {
      update(update: ViewUpdate) {
        if (update.docChanged) {
          ++generation;
          abort?.abort();
          abort = null;
          if (timer !== null) clearTimeout(timer);
          timer = null;
        } else if (
          update.viewportChanged &&
          currentInteractiveLanguageService()?.client.supports(
            "semanticTokensRange",
          )
        ) {
          schedule(80);
        }
      },
      destroy() {
        disposed = true;
        ++generation;
        abort?.abort();
        if (timer !== null) clearTimeout(timer);
        unsubscribe();
      },
    };
  });
}

export function languageServiceEditorExtensions(): Extension[] {
  return [
    ...languageServiceDiagnostics(),
    languageServiceHover(),
    semanticTokenField,
    semanticTokensPlugin(),
    semanticTheme,
  ];
}
