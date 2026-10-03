import {
  defineLanguageFacet,
  foldService,
  HighlightStyle,
  Language,
  languageDataProp,
  LanguageSupport,
  ParseContext,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  type Input,
  NodeType,
  Parser,
  type PartialParse,
  Tree,
  type TreeFragment,
} from "@lezer/common";
import { tags as t } from "@lezer/highlight";

export const typstLanguageData = defineLanguageFacet({
  commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
  indentOnInput: /^\s*[\]})]$/u,
});

export type TypstTools = typeof import("./typst-tools");

let loadedParser: Parser | null = null;
let loadedTools: TypstTools | null = null;
let loadingParser: Promise<Parser> | null = null;

export function typstTools(): TypstTools | null {
  return loadedTools;
}

export function loadTypstParser(): Promise<Parser> {
  loadingParser ??= import("./typst-tools").then(
    (module) => {
      loadedTools = module;
      loadedParser = module.typstParser;
      return module.typstParser;
    },
    (error: unknown) => {
      loadingParser = null;
      throw error;
    },
  );
  return loadingParser;
}

const placeholderTop = NodeType.define({
  id: 1,
  name: "PendingSource",
  top: true,
  props: [[languageDataProp, typstLanguageData]],
});

class LazyTypstParser extends Parser {
  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[],
  ): PartialParse {
    if (loadedParser) return loadedParser.createParse(input, fragments, ranges);
    const skipping = ParseContext.getSkippingParser(loadTypstParser()).createParse(
      input,
      fragments,
      ranges,
    );
    return {
      get parsedPos() {
        return skipping.parsedPos;
      },
      get stoppedAt() {
        return skipping.stoppedAt;
      },
      advance() {
        const tree = skipping.advance();
        return tree ? new Tree(placeholderTop, [], [], tree.length) : null;
      },
      stopAt(pos: number) {
        skipping.stopAt(pos);
      },
    };
  }
}

export const typstLanguageDefinition = new Language(
  typstLanguageData,
  new LazyTypstParser(),
  [],
  "typst",
);

const typstMarkupStyle = syntaxHighlighting(
  HighlightStyle.define(
    [
      { tag: t.strong, fontWeight: "600" },
      { tag: t.emphasis, fontStyle: "italic" },
      { tag: [t.list, t.processingInstruction], color: "var(--cm-meta)" },
    ],
    { scope: typstLanguageDefinition },
  ),
);

const typstHeadingFolding = foldService.of(
  (state, lineStart, lineEnd) => loadedTools?.typstHeadingFold(state, lineStart, lineEnd) ?? null,
);

export function typstLanguage(): LanguageSupport {
  loadTypstParser().catch(() => undefined);
  return new LanguageSupport(typstLanguageDefinition, [typstHeadingFolding, typstMarkupStyle]);
}
