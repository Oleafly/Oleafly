import { ThemedToken, GrammarState } from '@shikijs/core';
import { S as ShikiStreamTokenizerOptions, a as ShikiStreamTokenizerEnqueueResult, R as RecallToken, C as CodeToTokenTransformStreamOptions } from './shared/stream.v8L1RTbz.mjs';

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

/**
 * Create a transform stream that takes code chunks and emits themed tokens.
 */
declare class CodeToTokenTransformStream extends TransformStream<string, ThemedToken | RecallToken> {
    readonly tokenizer: ShikiStreamTokenizer;
    readonly options: CodeToTokenTransformStreamOptions;
    constructor(options: CodeToTokenTransformStreamOptions);
}

export { CodeToTokenTransformStream, CodeToTokenTransformStreamOptions, RecallToken, ShikiStreamTokenizer, ShikiStreamTokenizerEnqueueResult, ShikiStreamTokenizerOptions };
