import { CodeToTokensOptions, HighlighterCore, HighlighterGeneric, ThemedToken } from "shiki/core";

//#region src/shiki-stream/types.d.ts
/**
 * A special token that indicates the number of tokens to be removed from the previous streamed tokens.
 *
 * Pass `allowRecalls: true` to the `CodeToTokenTransformStream` to enable recall tokens.
 */
interface RecallToken {
  /**
   * Number of tokens to be removed from the previous streamed tokens.
   */
  recall: number;
}
type CodeToTokenTransformStreamOptions = ShikiStreamTokenizerOptions & {
  /**
   * Whether to allow recall tokens to be emitted.
   *
   * A recall token is a special token that indicates the number of tokens to be removed from the previous streamed tokens.
   *
   * @default false
   */
  allowRecalls?: boolean;
};
type ShikiStreamTokenizerOptions = CodeToTokensOptions<string, string> & {
  highlighter: HighlighterCore | HighlighterGeneric<any, any>;
};
interface ShikiStreamTokenizerEnqueueResult {
  /**
   * Number of last tokens to be recalled
   */
  recall: number;
  /**
   * Stable tokens
   */
  stable: ThemedToken[];
  /**
   * Unstable tokens, they might or might not be recalled
   */
  unstable: ThemedToken[];
}
//#endregion
export { CodeToTokenTransformStreamOptions, RecallToken, ShikiStreamTokenizerEnqueueResult, ShikiStreamTokenizerOptions };
//# sourceMappingURL=types.d.ts.map