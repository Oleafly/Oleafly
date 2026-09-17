import { parse as parseLatexAst } from "@unified-latex/unified-latex-util-parse";
import type { JSONContent } from "@tiptap/core";
import {
  normalizePreservedRanges,
  protectInlineSources,
  restoreInlineSources,
  type PreservedInlineRange,
} from "../preserve-inline";
import { normalizeDisplayMath } from "./display-math";
import { blocksFromNodes } from "./parse-blocks";
import type { ParseContext } from "./parse-inline";
import { theoremEnvironmentSet } from "./theorem-environments";

export interface ParseLatexBodyOptions {
  preservedInlineRanges?: readonly PreservedInlineRange[];
  theoremEnvironments?: readonly string[];
}

export function parseLatexBody(
  body: string,
  options: ParseLatexBodyOptions = {},
): JSONContent {
  const ranges = normalizePreservedRanges(
    body,
    0,
    options.preservedInlineRanges ?? [],
  );
  const { protectedContent, tokenPrefix, sources } = protectInlineSources(
    body,
    ranges,
  );
  const context: ParseContext = {
    source: protectedContent,
    theoremEnvironments: theoremEnvironmentSet(options.theoremEnvironments),
  };
  const content = blocksFromNodes(parseLatexAst(protectedContent).content, context);
  const restored = restoreInlineSources(
    {
      type: "doc",
      content: content.length ? content : [{ type: "paragraph" }],
    },
    tokenPrefix,
    sources,
  );
  return normalizeDisplayMath(restored);
}
