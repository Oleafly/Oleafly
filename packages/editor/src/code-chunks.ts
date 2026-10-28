import {
  LanguageDescription,
  LanguageSupport,
  ParseContext,
  StreamLanguage,
  type StreamParser,
} from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import type { Parser } from "@lezer/common";

const OPTION_LINE = /^\s*#\|/u;
const OPTION_MARKER = /^\s*#\|\s*/u;
const OPTION_KEY = /^[\p{L}\p{N}_.-]+(?=\s*:)/u;
const CHUNK_LANGUAGE = /^\{?\s*\.?([A-Za-z][\w+-]*)/u;

export function withChunkOptionLines<State>(parser: StreamParser<State>): StreamParser<State> {
  return {
    ...parser,
    token(stream, state) {
      if (!OPTION_LINE.test(stream.string)) return parser.token(stream, state);
      if (stream.sol() && stream.match(OPTION_MARKER)) return "meta";
      if (stream.match(OPTION_KEY)) return "propertyName";
      stream.skipToEnd();
      return "meta";
    },
  };
}

function chunkSupport(parser: StreamParser<unknown>): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(withChunkOptionLines(parser)));
}

function lazyChunkLanguage(
  name: string,
  alias: readonly string[],
  load: () => Promise<StreamParser<unknown>>,
): LanguageDescription {
  return LanguageDescription.of({ name, alias, load: () => load().then(chunkSupport) });
}

export const CODE_CHUNK_LANGUAGES: readonly LanguageDescription[] = [
  lazyChunkLanguage("R", ["rscript"], () => import("@codemirror/legacy-modes/mode/r").then((mode) => mode.r)),
  lazyChunkLanguage("Python", ["py", "python3"], () =>
    import("@codemirror/legacy-modes/mode/python").then((mode) => mode.python),
  ),
  lazyChunkLanguage("Julia", ["jl"], () =>
    import("@codemirror/legacy-modes/mode/julia").then((mode) => mode.julia),
  ),
  lazyChunkLanguage("OJS", ["js", "javascript"], () =>
    import("@codemirror/legacy-modes/mode/javascript").then((mode) => mode.javascript),
  ),
  LanguageDescription.of({ name: "Bash", alias: ["sh", "shell", "zsh"], support: chunkSupport(shell) }),
];

export function codeChunkLanguage(info: string): LanguageDescription | null {
  const name = CHUNK_LANGUAGE.exec(info.trim())?.[1];
  return name ? LanguageDescription.matchLanguageName(CODE_CHUNK_LANGUAGES, name, false) : null;
}

export function codeChunkParser(info: string): Parser | null {
  const description = codeChunkLanguage(info);
  if (!description) return null;
  return description.support?.language.parser ?? ParseContext.getSkippingParser(description.load());
}
