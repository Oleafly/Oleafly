import * as _ai_sdk_provider from '@ai-sdk/provider';
import { SharedV4ProviderMetadata, LanguageModelV4, LanguageModelV4Usage, LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4StreamResult, EmbeddingModelV4, ImageModelV4, ProviderV4 } from '@ai-sdk/provider';
import { FetchFunction, WORKFLOW_SERIALIZE, WORKFLOW_DESERIALIZE } from '@ai-sdk/provider-utils';
import { ZodType, z } from 'zod/v4';

declare const openaiCompatibleErrorDataSchema: z.ZodObject<{
    error: z.ZodObject<{
        message: z.ZodString;
        type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        param: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
        code: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>>;
    }, z.core.$strip>;
}, z.core.$strip>;
type OpenAICompatibleErrorData = z.infer<typeof openaiCompatibleErrorDataSchema>;
type ProviderErrorStructure<T> = {
    errorSchema: ZodType<T>;
    errorToMessage: (error: T) => string;
    isRetryable?: (response: Response, error?: T) => boolean;
};

type OpenAICompatibleChatModelId = string;
declare const openaiCompatibleLanguageModelChatOptions: z.ZodObject<{
    user: z.ZodOptional<z.ZodString>;
    reasoningEffort: z.ZodOptional<z.ZodString>;
    textVerbosity: z.ZodOptional<z.ZodString>;
    strictJsonSchema: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
type OpenAICompatibleLanguageModelChatOptions = z.infer<typeof openaiCompatibleLanguageModelChatOptions>;

/**
 * Extracts provider-specific metadata from API responses.
 * Used to standardize metadata handling across different LLM providers while allowing
 * provider-specific metadata to be captured.
 */
type MetadataExtractor = {
    /**
     * Extracts provider metadata from a complete, non-streaming response.
     *
     * @param parsedBody - The parsed response JSON body from the provider's API.
     *
     * @returns Provider-specific metadata or undefined if no metadata is available.
     *          The metadata should be under a key indicating the provider id.
     */
    extractMetadata: ({ parsedBody, }: {
        parsedBody: unknown;
    }) => Promise<SharedV4ProviderMetadata | undefined>;
    /**
     * Creates an extractor for handling streaming responses. The returned object provides
     * methods to process individual chunks and build the final metadata from the accumulated
     * stream data.
     *
     * @returns An object with methods to process chunks and build metadata from a stream
     */
    createStreamExtractor: () => {
        /**
         * Process an individual chunk from the stream. Called for each chunk in the response stream
         * to accumulate metadata throughout the streaming process.
         *
         * @param parsedChunk - The parsed JSON response chunk from the provider's API
         */
        processChunk(parsedChunk: unknown): void;
        /**
         * Builds the metadata object after all chunks have been processed.
         * Called at the end of the stream to generate the complete provider metadata.
         *
         * @returns Provider-specific metadata or undefined if no metadata is available.
         *          The metadata should be under a key indicating the provider id.
         */
        buildMetadata(): SharedV4ProviderMetadata | undefined;
    };
};

type OpenAICompatibleChatConfig = {
    provider: string;
    headers?: () => Record<string, string | undefined>;
    url: (options: {
        modelId: string;
        path: string;
    }) => string;
    fetch?: FetchFunction;
    includeUsage?: boolean;
    errorStructure?: ProviderErrorStructure<any>;
    metadataExtractor?: MetadataExtractor;
    /**
     * Whether the model supports structured outputs.
     */
    supportsStructuredOutputs?: boolean;
    /**
     * The supported URLs for the model.
     */
    supportedUrls?: () => LanguageModelV4['supportedUrls'];
    /**
     * Optional function to transform the request body before sending it to the API.
     * This is useful for proxy providers that may require a different request format
     * than the official OpenAI API.
     */
    transformRequestBody?: (args: Record<string, any>) => Record<string, any>;
    /**
     * Optional usage converter for OpenAI-compatible providers with different
     * token accounting semantics.
     */
    convertUsage?: (usage: z.infer<typeof openaiCompatibleTokenUsageSchema>) => LanguageModelV4Usage;
};
declare class OpenAICompatibleChatLanguageModel implements LanguageModelV4 {
    readonly specificationVersion = "v4";
    readonly supportsStructuredOutputs: boolean;
    readonly modelId: OpenAICompatibleChatModelId;
    protected readonly config: OpenAICompatibleChatConfig;
    private readonly failedResponseHandler;
    private readonly chunkSchema;
    static [WORKFLOW_SERIALIZE](model: OpenAICompatibleChatLanguageModel): {
        modelId: string;
        config: _ai_sdk_provider.JSONObject;
    };
    static [WORKFLOW_DESERIALIZE](options: {
        modelId: string;
        config: OpenAICompatibleChatConfig;
    }): OpenAICompatibleChatLanguageModel;
    constructor(modelId: OpenAICompatibleChatModelId, config: OpenAICompatibleChatConfig);
    get provider(): string;
    private get providerOptionsName();
    get supportedUrls(): Record<string, RegExp[]> | PromiseLike<Record<string, RegExp[]>>;
    private transformRequestBody;
    private convertUsage;
    private getArgs;
    doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult>;
    doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult>;
}
declare const openaiCompatibleTokenUsageSchema: z.ZodOptional<z.ZodNullable<z.ZodObject<{
    prompt_tokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    completion_tokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    total_tokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    prompt_tokens_details: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        cached_tokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>>>;
    completion_tokens_details: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        reasoning_tokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        accepted_prediction_tokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        rejected_prediction_tokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>>>;
}, z.core.$loose>>>;

type OpenAICompatibleCompletionModelId = string;
declare const openaiCompatibleLanguageModelCompletionOptions: z.ZodObject<{
    echo: z.ZodOptional<z.ZodBoolean>;
    logitBias: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    suffix: z.ZodOptional<z.ZodString>;
    user: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type OpenAICompatibleLanguageModelCompletionOptions = z.infer<typeof openaiCompatibleLanguageModelCompletionOptions>;

type OpenAICompatibleCompletionConfig = {
    provider: string;
    includeUsage?: boolean;
    headers?: () => Record<string, string | undefined>;
    url: (options: {
        modelId: string;
        path: string;
    }) => string;
    fetch?: FetchFunction;
    errorStructure?: ProviderErrorStructure<any>;
    /**
     * The supported URLs for the model.
     */
    supportedUrls?: () => LanguageModelV4['supportedUrls'];
};
declare class OpenAICompatibleCompletionLanguageModel implements LanguageModelV4 {
    readonly specificationVersion = "v4";
    readonly modelId: OpenAICompatibleCompletionModelId;
    private readonly config;
    private readonly failedResponseHandler;
    private readonly chunkSchema;
    static [WORKFLOW_SERIALIZE](model: OpenAICompatibleCompletionLanguageModel): {
        modelId: string;
        config: _ai_sdk_provider.JSONObject;
    };
    static [WORKFLOW_DESERIALIZE](options: {
        modelId: string;
        config: OpenAICompatibleCompletionConfig;
    }): OpenAICompatibleCompletionLanguageModel;
    constructor(modelId: OpenAICompatibleCompletionModelId, config: OpenAICompatibleCompletionConfig);
    get provider(): string;
    private get providerOptionsName();
    get supportedUrls(): Record<string, RegExp[]> | PromiseLike<Record<string, RegExp[]>>;
    private getArgs;
    doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult>;
    doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult>;
}

type OpenAICompatibleEmbeddingModelId = string;
declare const openaiCompatibleEmbeddingModelOptions: z.ZodObject<{
    dimensions: z.ZodOptional<z.ZodNumber>;
    user: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type OpenAICompatibleEmbeddingModelOptions = z.infer<typeof openaiCompatibleEmbeddingModelOptions>;

type OpenAICompatibleEmbeddingConfig = {
    /**
     * Override the maximum number of embeddings per call.
     */
    maxEmbeddingsPerCall?: number;
    /**
     * Override the parallelism of embedding calls.
     */
    supportsParallelCalls?: boolean;
    provider: string;
    url: (options: {
        modelId: string;
        path: string;
    }) => string;
    headers?: () => Record<string, string | undefined>;
    fetch?: FetchFunction;
    errorStructure?: ProviderErrorStructure<any>;
};
declare class OpenAICompatibleEmbeddingModel implements EmbeddingModelV4 {
    readonly specificationVersion = "v4";
    readonly modelId: OpenAICompatibleEmbeddingModelId;
    private readonly config;
    get provider(): string;
    get maxEmbeddingsPerCall(): number;
    get supportsParallelCalls(): boolean;
    static [WORKFLOW_SERIALIZE](model: OpenAICompatibleEmbeddingModel): {
        modelId: string;
        config: _ai_sdk_provider.JSONObject;
    };
    static [WORKFLOW_DESERIALIZE](options: {
        modelId: string;
        config: OpenAICompatibleEmbeddingConfig;
    }): OpenAICompatibleEmbeddingModel;
    constructor(modelId: OpenAICompatibleEmbeddingModelId, config: OpenAICompatibleEmbeddingConfig);
    private get providerOptionsName();
    doEmbed({ values, headers, abortSignal, providerOptions, }: Parameters<EmbeddingModelV4['doEmbed']>[0]): Promise<Awaited<ReturnType<EmbeddingModelV4['doEmbed']>>>;
}

type OpenAICompatibleImageModelId = string;

type OpenAICompatibleImageModelConfig = {
    provider: string;
    headers?: () => Record<string, string | undefined>;
    url: (options: {
        modelId: string;
        path: string;
    }) => string;
    fetch?: FetchFunction;
    errorStructure?: ProviderErrorStructure<any>;
    _internal?: {
        currentDate?: () => Date;
    };
};
declare class OpenAICompatibleImageModel implements ImageModelV4 {
    readonly modelId: OpenAICompatibleImageModelId;
    private readonly config;
    readonly specificationVersion = "v4";
    readonly maxImagesPerCall = 10;
    get provider(): string;
    /**
     * The provider options key used to extract provider-specific options.
     */
    private get providerOptionsKey();
    static [WORKFLOW_SERIALIZE](model: OpenAICompatibleImageModel): {
        modelId: string;
        config: _ai_sdk_provider.JSONObject;
    };
    static [WORKFLOW_DESERIALIZE](options: {
        modelId: string;
        config: OpenAICompatibleImageModelConfig;
    }): OpenAICompatibleImageModel;
    constructor(modelId: OpenAICompatibleImageModelId, config: OpenAICompatibleImageModelConfig);
    private getArgs;
    doGenerate({ prompt, n, size, aspectRatio, seed, providerOptions, headers, abortSignal, files, mask, }: Parameters<ImageModelV4['doGenerate']>[0]): Promise<Awaited<ReturnType<ImageModelV4['doGenerate']>>>;
}

/**
 * Common provider options for OpenAI-compatible image models.
 *
 * Additional provider-specific options are passed through to the API.
 */
declare const openaiCompatibleImageModelOptions: z.ZodObject<{
    /**
     * Dimensions of the generated image.
     *
     * Supported values depend on the provider and model.
     */
    size: z.ZodOptional<z.ZodString>;
    /**
     * Quality of the generated image.
     *
     * Supported values depend on the provider and model.
     */
    quality: z.ZodOptional<z.ZodString>;
    /**
     * File format of the generated image.
     *
     * Supported values depend on the provider and model.
     */
    output_format: z.ZodOptional<z.ZodString>;
    /**
     * Compression level for JPEG and WebP images.
     */
    output_compression: z.ZodOptional<z.ZodNumber>;
    /**
     * Background behavior for the generated image.
     *
     * Supported values depend on the provider and model.
     */
    background: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
type OpenAICompatibleImageModelOptions = z.infer<typeof openaiCompatibleImageModelOptions>;

interface OpenAICompatibleProvider<CHAT_MODEL_IDS extends string = string, COMPLETION_MODEL_IDS extends string = string, EMBEDDING_MODEL_IDS extends string = string, IMAGE_MODEL_IDS extends string = string> extends ProviderV4 {
    (modelId: CHAT_MODEL_IDS): LanguageModelV4;
    languageModel(modelId: CHAT_MODEL_IDS, config?: Partial<OpenAICompatibleChatConfig>): LanguageModelV4;
    chatModel(modelId: CHAT_MODEL_IDS): LanguageModelV4;
    completionModel(modelId: COMPLETION_MODEL_IDS): LanguageModelV4;
    embeddingModel(modelId: EMBEDDING_MODEL_IDS): EmbeddingModelV4;
    /**
     * @deprecated Use `embeddingModel` instead.
     */
    textEmbeddingModel(modelId: EMBEDDING_MODEL_IDS): EmbeddingModelV4;
    imageModel(modelId: IMAGE_MODEL_IDS): ImageModelV4;
}
interface OpenAICompatibleProviderSettings {
    /**
     * Base URL for the API calls.
     */
    baseURL: string;
    /**
     * Provider name.
     */
    name: string;
    /**
     * API key for authenticating requests. If specified, adds an `Authorization`
     * header to request headers with the value `Bearer <apiKey>`. This will be added
     * before any headers potentially specified in the `headers` option.
     */
    apiKey?: string;
    /**
     * Optional custom headers to include in requests. These will be added to request headers
     * after any headers potentially added by use of the `apiKey` option.
     */
    headers?: Record<string, string>;
    /**
     * Optional custom url query parameters to include in request urls.
     */
    queryParams?: Record<string, string>;
    /**
     * Custom fetch implementation. You can use it as a middleware to intercept requests,
     * or to provide a custom fetch implementation for e.g. testing.
     */
    fetch?: FetchFunction;
    /**
     * Include usage information in streaming responses.
     */
    includeUsage?: boolean;
    /**
     * Whether the provider supports structured outputs in chat models.
     */
    supportsStructuredOutputs?: boolean;
    /**
     * Optional function to transform the request body before sending it to the API.
     * This is useful for proxy providers that may require a different request format
     * than the official OpenAI API.
     */
    transformRequestBody?: (args: Record<string, any>) => Record<string, any>;
    /**
     * Optional metadata extractor to capture provider-specific metadata from API responses.
     * This is useful for extracting non-standard fields, experimental features,
     * or provider-specific metrics from both streaming and non-streaming responses.
     */
    metadataExtractor?: MetadataExtractor;
    /**
     * The supported URLs for chat models.
     */
    supportedUrls?: OpenAICompatibleChatConfig['supportedUrls'];
    /**
     * Optional usage converter for providers with token accounting semantics that
     * differ from the default OpenAI-compatible shape.
     */
    convertUsage?: OpenAICompatibleChatConfig['convertUsage'];
}
/**
 * Create an OpenAICompatible provider instance.
 */
declare function createOpenAICompatible<CHAT_MODEL_IDS extends string, COMPLETION_MODEL_IDS extends string, EMBEDDING_MODEL_IDS extends string, IMAGE_MODEL_IDS extends string>(options: OpenAICompatibleProviderSettings): OpenAICompatibleProvider<CHAT_MODEL_IDS, COMPLETION_MODEL_IDS, EMBEDDING_MODEL_IDS, IMAGE_MODEL_IDS>;

declare const VERSION: string;

export { type MetadataExtractor, OpenAICompatibleChatLanguageModel, type OpenAICompatibleChatModelId, OpenAICompatibleCompletionLanguageModel, type OpenAICompatibleCompletionModelId, type OpenAICompatibleLanguageModelCompletionOptions as OpenAICompatibleCompletionProviderOptions, OpenAICompatibleEmbeddingModel, type OpenAICompatibleEmbeddingModelId, type OpenAICompatibleEmbeddingModelOptions, type OpenAICompatibleEmbeddingModelOptions as OpenAICompatibleEmbeddingProviderOptions, type OpenAICompatibleErrorData, OpenAICompatibleImageModel, type OpenAICompatibleImageModelOptions, type OpenAICompatibleLanguageModelChatOptions, type OpenAICompatibleLanguageModelCompletionOptions, type OpenAICompatibleProvider, type OpenAICompatibleLanguageModelChatOptions as OpenAICompatibleProviderOptions, type OpenAICompatibleProviderSettings, type ProviderErrorStructure, VERSION, createOpenAICompatible };
