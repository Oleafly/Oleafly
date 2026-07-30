import { ShikiStreamTokenizerEnqueueResult, ShikiStreamTokenizerOptions } from "./types.js";
import { GrammarState, ThemedToken } from "shiki/core";

//#region src/shiki-stream/tokenizer.d.ts
declare class ShikiStreamTokenizer {
  readonly options: ShikiStreamTokenizerOptions;
  tokensStable: ThemedToken[];
  tokensUnstable: ThemedToken[];
  lastUnstableCodeChunk: string;
  lastStableGrammarState: GrammarState | undefined;
  constructor(options: ShikiStreamTokenizerOptions);
  /**
   * Enqueue a chunk of code to the buffer.
   */
  enqueue(chunk: string): Promise<ShikiStreamTokenizerEnqueueResult>;
  close(): {
    stable: ThemedToken[];
  };
  clear(): void;
  clone(): ShikiStreamTokenizer;
}
//#endregion
export { ShikiStreamTokenizer };
//# sourceMappingURL=tokenizer.d.ts.map