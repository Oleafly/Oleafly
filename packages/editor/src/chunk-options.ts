import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import { createCompletionRequestGuard } from "./completion-request";
import { shouldRunCompletionSource, type CompletionSyntax } from "./completion-trigger";
import { guardCompletionForSource } from "./latex";
import { editorMessage, type EditorMessageKey } from "./messages";

export const QUARTO_CHUNK_OPTIONS: readonly string[] = [
  "label",
  "echo",
  "eval",
  "output",
  "warning",
  "error",
  "include",
  "message",
  "fig-cap",
  "fig-alt",
  "fig-width",
  "fig-height",
  "fig-align",
  "fig-format",
  "fig-dpi",
  "tbl-cap",
  "layout-ncol",
  "layout-nrow",
  "code-fold",
  "code-summary",
  "code-line-numbers",
  "cache",
  "freeze",
  "file",
  "classes",
];

export const CALEPIN_CHUNK_OPTIONS: readonly string[] = [
  "echo",
  "eval",
  "error",
  "warning",
  "message",
  "results",
  "results-location",
  "fig-device-format",
  "fig-device-dpi",
  "fig-device-width",
  "fig-device-height",
  "fig-device-aspect",
  "fig-width",
  "fig-height",
  "fig-align",
  "fig-responsive",
  "engine",
  "body",
  "label",
  "fig-link",
  "fig-caption",
  "fig-cap-location",
  "fig-alt-text",
  "fig-subcaptions",
  "fig-layout-columns",
  "fig-layout-rows",
  "kind",
  "script",
];

interface ChunkOptionSet {
  readonly syntax: CompletionSyntax;
  readonly names: readonly string[];
  readonly detail: EditorMessageKey;
  readonly opener: RegExp;
}

const OPTION_LINE = /^[ \t]*#\|/u;
const OPTION_PREFIX = /^[ \t]*#\|[ \t]*([\p{L}\p{N}_-]*)$/u;
const OPTION_NAME = /^[ \t]*#\|[ \t]*([\p{L}\p{N}_-]+)[ \t]*:/u;

const QUARTO_OPTIONS: ChunkOptionSet = {
  syntax: "markdown",
  names: QUARTO_CHUNK_OPTIONS,
  detail: "quarto.completion.chunkOption",
  opener: /^[ \t]*(?:`{3,}|~{3,})[ \t]*\{[ \t]*[A-Za-z]/u,
};

const CALEPIN_OPTIONS: ChunkOptionSet = {
  syntax: "typst",
  names: CALEPIN_CHUNK_OPTIONS,
  detail: "calepin.completion.chunkOption",
  opener: /`{3,}[A-Za-z][\w+-]*[ \t]*$/u,
};

function optionBlockStart(state: EditorState, lineNumber: number): number {
  let number = lineNumber;
  while (number > 1 && OPTION_LINE.test(state.doc.line(number - 1).text)) number--;
  return number;
}

function usedOptions(state: EditorState, first: number, current: number): Set<string> {
  const used = new Set<string>();
  for (let number = first; number <= state.doc.lines; number++) {
    const text = state.doc.line(number).text;
    if (!OPTION_LINE.test(text)) break;
    const name = number === current ? null : OPTION_NAME.exec(text)?.[1];
    if (name) used.add(name);
  }
  return used;
}

function chunkOptionCompletions(set: ChunkOptionSet): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    if (!shouldRunCompletionSource(context, set.syntax)) return null;
    const { state } = context;
    const line = state.doc.lineAt(context.pos);
    const match = OPTION_PREFIX.exec(line.text.slice(0, context.pos - line.from));
    if (!match) return null;
    const first = optionBlockStart(state, line.number);
    if (first === 1 || !set.opener.test(state.doc.line(first - 1).text)) return null;
    const used = usedOptions(state, first, line.number);
    const guard = createCompletionRequestGuard(context);
    return {
      from: context.pos - match[1].length,
      options: set.names
        .filter((name) => !used.has(name))
        .map((name) =>
          guardCompletionForSource(guard, {
            label: name,
            type: "property",
            detail: editorMessage(set.detail),
            apply: `${name}: `,
          } satisfies Completion),
        ),
    };
  };
}

export const quartoChunkOptionCompletions: CompletionSource = chunkOptionCompletions(QUARTO_OPTIONS);

export const calepinChunkOptionCompletions: CompletionSource = chunkOptionCompletions(CALEPIN_OPTIONS);
