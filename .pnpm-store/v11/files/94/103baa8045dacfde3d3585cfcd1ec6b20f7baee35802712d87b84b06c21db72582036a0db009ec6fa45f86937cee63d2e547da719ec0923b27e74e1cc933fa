export { convertArrayToAsyncIterable, convertArrayToReadableStream, convertReadableStreamToArray, mockId } from '@ai-sdk/provider-utils/test';
import { EmbeddingModelV3, EmbeddingModelV4, ImageModelV3, ImageModelV4, LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3GenerateResult, LanguageModelV3StreamResult, LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4StreamResult, ProviderV3, TranscriptionModelV3, SpeechModelV3, RerankingModelV3, ProviderV4, TranscriptionModelV4, SpeechModelV4, RerankingModelV4, Experimental_VideoModelV3, Experimental_VideoModelV4 } from '@ai-sdk/provider';

/**
 * Creates a ReadableStream that emits the provided values with an optional delay between each value.
 *
 * @param options - The configuration options
 * @param options.chunks - Array of values to be emitted by the stream
 * @param options.initialDelayInMs - Optional initial delay in milliseconds before emitting the first value (default: 0). Can be set to `null` to skip the initial delay. The difference between `initialDelayInMs: null` and `initialDelayInMs: 0` is that `initialDelayInMs: null` will emit the values without any delay, while `initialDelayInMs: 0` will emit the values with a delay of 0 milliseconds.
 * @param options.chunkDelayInMs - Optional delay in milliseconds between emitting each value (default: 0). Can be set to `null` to skip the delay. The difference between `chunkDelayInMs: null` and `chunkDelayInMs: 0` is that `chunkDelayInMs: null` will emit the values without any delay, while `chunkDelayInMs: 0` will emit the values with a delay of 0 milliseconds.
 * @returns A ReadableStream that emits the provided values
 */
declare function simulateReadableStream$1<T>({ chunks, initialDelayInMs, chunkDelayInMs, _internal, }: {
    chunks: T[];
    initialDelayInMs?: number | null;
    chunkDelayInMs?: number | null;
    _internal?: {
        delay?: (ms: number | null) => Promise<void>;
    };
}): ReadableStream<T>;

declare class MockEmbeddingModelV3 implements EmbeddingModelV3 {
    readonly specificationVersion = "v3";
    readonly provider: EmbeddingModelV3['provider'];
    readonly modelId: EmbeddingModelV3['modelId'];
    readonly maxEmbeddingsPerCall: EmbeddingModelV3['maxEmbeddingsPerCall'];
    readonly supportsParallelCalls: EmbeddingModelV3['supportsParallelCalls'];
    doEmbed: EmbeddingModelV3['doEmbed'];
    doEmbedCalls: Parameters<EmbeddingModelV3['doEmbed']>[0][];
    constructor({ provider, modelId, maxEmbeddingsPerCall, supportsParallelCalls, doEmbed, }?: {
        provider?: EmbeddingModelV3['provider'];
        modelId?: EmbeddingModelV3['modelId'];
        maxEmbeddingsPerCall?: EmbeddingModelV3['maxEmbeddingsPerCall'] | null;
        supportsParallelCalls?: EmbeddingModelV3['supportsParallelCalls'];
        doEmbed?: EmbeddingModelV3['doEmbed'] | Awaited<ReturnType<EmbeddingModelV3['doEmbed']>> | Awaited<ReturnType<EmbeddingModelV3['doEmbed']>>[];
    });
}

declare class MockEmbeddingModelV4 implements EmbeddingModelV4 {
    readonly specificationVersion = "v4";
    readonly provider: EmbeddingModelV4['provider'];
    readonly modelId: EmbeddingModelV4['modelId'];
    readonly maxEmbeddingsPerCall: EmbeddingModelV4['maxEmbeddingsPerCall'];
    readonly supportsParallelCalls: EmbeddingModelV4['supportsParallelCalls'];
    doEmbed: EmbeddingModelV4['doEmbed'];
    doEmbedCalls: Parameters<EmbeddingModelV4['doEmbed']>[0][];
    constructor({ provider, modelId, maxEmbeddingsPerCall, supportsParallelCalls, doEmbed, }?: {
        provider?: EmbeddingModelV4['provider'];
        modelId?: EmbeddingModelV4['modelId'];
        maxEmbeddingsPerCall?: EmbeddingModelV4['maxEmbeddingsPerCall'] | null;
        supportsParallelCalls?: EmbeddingModelV4['supportsParallelCalls'];
        doEmbed?: EmbeddingModelV4['doEmbed'] | Awaited<ReturnType<EmbeddingModelV4['doEmbed']>> | Awaited<ReturnType<EmbeddingModelV4['doEmbed']>>[];
    });
}

declare class MockImageModelV3 implements ImageModelV3 {
    readonly specificationVersion = "v3";
    readonly provider: ImageModelV3['provider'];
    readonly modelId: ImageModelV3['modelId'];
    readonly maxImagesPerCall: ImageModelV3['maxImagesPerCall'];
    doGenerate: ImageModelV3['doGenerate'];
    constructor({ provider, modelId, maxImagesPerCall, doGenerate, }?: {
        provider?: ImageModelV3['provider'];
        modelId?: ImageModelV3['modelId'];
        maxImagesPerCall?: ImageModelV3['maxImagesPerCall'];
        doGenerate?: ImageModelV3['doGenerate'];
    });
}

declare class MockImageModelV4 implements ImageModelV4 {
    readonly specificationVersion = "v4";
    readonly provider: ImageModelV4['provider'];
    readonly modelId: ImageModelV4['modelId'];
    readonly maxImagesPerCall: ImageModelV4['maxImagesPerCall'];
    doGenerate: ImageModelV4['doGenerate'];
    constructor({ provider, modelId, maxImagesPerCall, doGenerate, }?: {
        provider?: ImageModelV4['provider'];
        modelId?: ImageModelV4['modelId'];
        maxImagesPerCall?: ImageModelV4['maxImagesPerCall'];
        doGenerate?: ImageModelV4['doGenerate'];
    });
}

declare class MockLanguageModelV3 implements LanguageModelV3 {
    readonly specificationVersion = "v3";
    private _supportedUrls;
    readonly provider: LanguageModelV3['provider'];
    readonly modelId: LanguageModelV3['modelId'];
    doGenerate: LanguageModelV3['doGenerate'];
    doStream: LanguageModelV3['doStream'];
    doGenerateCalls: LanguageModelV3CallOptions[];
    doStreamCalls: LanguageModelV3CallOptions[];
    constructor({ provider, modelId, supportedUrls, doGenerate, doStream, }?: {
        provider?: LanguageModelV3['provider'];
        modelId?: LanguageModelV3['modelId'];
        supportedUrls?: LanguageModelV3['supportedUrls'] | (() => LanguageModelV3['supportedUrls']);
        doGenerate?: LanguageModelV3['doGenerate'] | LanguageModelV3GenerateResult | LanguageModelV3GenerateResult[];
        doStream?: LanguageModelV3['doStream'] | LanguageModelV3StreamResult | LanguageModelV3StreamResult[];
    });
    get supportedUrls(): Record<string, RegExp[]> | PromiseLike<Record<string, RegExp[]>>;
}

declare class MockLanguageModelV4 implements LanguageModelV4 {
    readonly specificationVersion = "v4";
    private _supportedUrls;
    readonly provider: LanguageModelV4['provider'];
    readonly modelId: LanguageModelV4['modelId'];
    doGenerate: LanguageModelV4['doGenerate'];
    doStream: LanguageModelV4['doStream'];
    doGenerateCalls: LanguageModelV4CallOptions[];
    doStreamCalls: LanguageModelV4CallOptions[];
    constructor({ provider, modelId, supportedUrls, doGenerate, doStream, }?: {
        provider?: LanguageModelV4['provider'];
        modelId?: LanguageModelV4['modelId'];
        supportedUrls?: LanguageModelV4['supportedUrls'] | (() => LanguageModelV4['supportedUrls']);
        doGenerate?: LanguageModelV4['doGenerate'] | LanguageModelV4GenerateResult | LanguageModelV4GenerateResult[];
        doStream?: LanguageModelV4['doStream'] | LanguageModelV4StreamResult | LanguageModelV4StreamResult[];
    });
    get supportedUrls(): Record<string, RegExp[]> | PromiseLike<Record<string, RegExp[]>>;
}

declare class MockProviderV3 implements ProviderV3 {
    readonly specificationVersion: "v3";
    languageModel: ProviderV3['languageModel'];
    embeddingModel: ProviderV3['embeddingModel'];
    imageModel: ProviderV3['imageModel'];
    transcriptionModel: ProviderV3['transcriptionModel'];
    speechModel: ProviderV3['speechModel'];
    rerankingModel: ProviderV3['rerankingModel'];
    constructor({ languageModels, embeddingModels, imageModels, transcriptionModels, speechModels, rerankingModels, }?: {
        languageModels?: Record<string, LanguageModelV3>;
        embeddingModels?: Record<string, EmbeddingModelV3>;
        imageModels?: Record<string, ImageModelV3>;
        transcriptionModels?: Record<string, TranscriptionModelV3>;
        speechModels?: Record<string, SpeechModelV3>;
        rerankingModels?: Record<string, RerankingModelV3>;
    });
}

declare class MockProviderV4 implements ProviderV4 {
    readonly specificationVersion: "v4";
    languageModel: ProviderV4['languageModel'];
    embeddingModel: ProviderV4['embeddingModel'];
    imageModel: ProviderV4['imageModel'];
    transcriptionModel: ProviderV4['transcriptionModel'];
    speechModel: ProviderV4['speechModel'];
    rerankingModel: ProviderV4['rerankingModel'];
    constructor({ languageModels, embeddingModels, imageModels, transcriptionModels, speechModels, rerankingModels, }?: {
        languageModels?: Record<string, LanguageModelV4>;
        embeddingModels?: Record<string, EmbeddingModelV4>;
        imageModels?: Record<string, ImageModelV4>;
        transcriptionModels?: Record<string, TranscriptionModelV4>;
        speechModels?: Record<string, SpeechModelV4>;
        rerankingModels?: Record<string, RerankingModelV4>;
    });
}

declare class MockSpeechModelV3 implements SpeechModelV3 {
    readonly specificationVersion = "v3";
    readonly provider: SpeechModelV3['provider'];
    readonly modelId: SpeechModelV3['modelId'];
    doGenerate: SpeechModelV3['doGenerate'];
    constructor({ provider, modelId, doGenerate, }?: {
        provider?: SpeechModelV3['provider'];
        modelId?: SpeechModelV3['modelId'];
        doGenerate?: SpeechModelV3['doGenerate'];
    });
}

declare class MockSpeechModelV4 implements SpeechModelV4 {
    readonly specificationVersion = "v4";
    readonly provider: SpeechModelV4['provider'];
    readonly modelId: SpeechModelV4['modelId'];
    doGenerate: SpeechModelV4['doGenerate'];
    constructor({ provider, modelId, doGenerate, }?: {
        provider?: SpeechModelV4['provider'];
        modelId?: SpeechModelV4['modelId'];
        doGenerate?: SpeechModelV4['doGenerate'];
    });
}

declare class MockTranscriptionModelV3 implements TranscriptionModelV3 {
    readonly specificationVersion = "v3";
    readonly provider: TranscriptionModelV3['provider'];
    readonly modelId: TranscriptionModelV3['modelId'];
    doGenerate: TranscriptionModelV3['doGenerate'];
    constructor({ provider, modelId, doGenerate, }?: {
        provider?: TranscriptionModelV3['provider'];
        modelId?: TranscriptionModelV3['modelId'];
        doGenerate?: TranscriptionModelV3['doGenerate'];
    });
}

declare class MockTranscriptionModelV4 implements TranscriptionModelV4 {
    readonly specificationVersion = "v4";
    readonly provider: TranscriptionModelV4['provider'];
    readonly modelId: TranscriptionModelV4['modelId'];
    doGenerate: TranscriptionModelV4['doGenerate'];
    doStream: TranscriptionModelV4['doStream'];
    constructor({ provider, modelId, doGenerate, doStream, }?: {
        provider?: TranscriptionModelV4['provider'];
        modelId?: TranscriptionModelV4['modelId'];
        doGenerate?: TranscriptionModelV4['doGenerate'];
        doStream?: TranscriptionModelV4['doStream'];
    });
}

declare class MockRerankingModelV3 implements RerankingModelV3 {
    readonly specificationVersion = "v3";
    readonly provider: RerankingModelV3['provider'];
    readonly modelId: RerankingModelV3['modelId'];
    doRerank: RerankingModelV3['doRerank'];
    constructor({ provider, modelId, doRerank, }?: {
        provider?: RerankingModelV3['provider'];
        modelId?: RerankingModelV3['modelId'];
        doRerank?: RerankingModelV3['doRerank'];
    });
}

declare class MockRerankingModelV4 implements RerankingModelV4 {
    readonly specificationVersion = "v4";
    readonly provider: RerankingModelV4['provider'];
    readonly modelId: RerankingModelV4['modelId'];
    doRerank: RerankingModelV4['doRerank'];
    constructor({ provider, modelId, doRerank, }?: {
        provider?: RerankingModelV4['provider'];
        modelId?: RerankingModelV4['modelId'];
        doRerank?: RerankingModelV4['doRerank'];
    });
}

declare class MockVideoModelV3 implements Experimental_VideoModelV3 {
    readonly specificationVersion = "v3";
    readonly provider: Experimental_VideoModelV3['provider'];
    readonly modelId: Experimental_VideoModelV3['modelId'];
    readonly maxVideosPerCall: Experimental_VideoModelV3['maxVideosPerCall'];
    doGenerate: Experimental_VideoModelV3['doGenerate'];
    constructor({ provider, modelId, maxVideosPerCall, doGenerate, }?: {
        provider?: Experimental_VideoModelV3['provider'];
        modelId?: Experimental_VideoModelV3['modelId'];
        maxVideosPerCall?: Experimental_VideoModelV3['maxVideosPerCall'];
        doGenerate?: Experimental_VideoModelV3['doGenerate'];
    });
}

declare class MockVideoModelV4 implements Experimental_VideoModelV4 {
    readonly specificationVersion = "v4";
    readonly provider: Experimental_VideoModelV4['provider'];
    readonly modelId: Experimental_VideoModelV4['modelId'];
    readonly maxVideosPerCall: Experimental_VideoModelV4['maxVideosPerCall'];
    doGenerate: Experimental_VideoModelV4['doGenerate'];
    constructor({ provider, modelId, maxVideosPerCall, doGenerate, }?: {
        provider?: Experimental_VideoModelV4['provider'];
        modelId?: Experimental_VideoModelV4['modelId'];
        maxVideosPerCall?: Experimental_VideoModelV4['maxVideosPerCall'];
        doGenerate?: Experimental_VideoModelV4['doGenerate'];
    });
}

declare function mockValues<T>(...values: T[]): () => T;

/**
 * @deprecated Use `simulateReadableStream` from `ai` instead.
 */
declare const simulateReadableStream: typeof simulateReadableStream$1;

export { MockEmbeddingModelV3, MockEmbeddingModelV4, MockImageModelV3, MockImageModelV4, MockLanguageModelV3, MockLanguageModelV4, MockProviderV3, MockProviderV4, MockRerankingModelV3, MockRerankingModelV4, MockSpeechModelV3, MockSpeechModelV4, MockTranscriptionModelV3, MockTranscriptionModelV4, MockVideoModelV3, MockVideoModelV4, mockValues, simulateReadableStream };
