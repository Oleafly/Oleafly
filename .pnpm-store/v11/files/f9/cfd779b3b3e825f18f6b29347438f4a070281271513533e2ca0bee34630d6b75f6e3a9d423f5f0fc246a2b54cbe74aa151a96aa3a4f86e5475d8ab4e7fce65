import { CodeToTokenTransformStreamOptions, RecallToken } from "./types.js";
import { ShikiStreamTokenizer } from "./tokenizer.js";
import { ThemedToken } from "shiki/core";

//#region src/shiki-stream/stream.d.ts
/**
 * Create a transform stream that takes code chunks and emits themed tokens.
 */
declare class CodeToTokenTransformStream extends TransformStream<string, ThemedToken | RecallToken> {
  readonly tokenizer: ShikiStreamTokenizer;
  readonly options: CodeToTokenTransformStreamOptions;
  constructor(options: CodeToTokenTransformStreamOptions);
}
//#endregion
export { CodeToTokenTransformStream };
//# sourceMappingURL=stream.d.ts.map