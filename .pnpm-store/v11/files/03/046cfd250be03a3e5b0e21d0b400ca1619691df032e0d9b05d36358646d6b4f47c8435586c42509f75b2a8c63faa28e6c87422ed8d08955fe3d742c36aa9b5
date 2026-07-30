import * as _ai_sdk_provider from '@ai-sdk/provider';
import { EmbeddingModelV4Embedding, LanguageModelV4, LanguageModelV3, LanguageModelV2, SharedV4Warning, LanguageModelV4Source, SharedV4ProviderMetadata, LanguageModelV4Usage, JSONObject, LanguageModelV4CallOptions, LanguageModelV4Prompt, AISDKError, LanguageModelV4ToolCall, JSONSchema7, ProviderV4, ProviderV3, ProviderV2, LanguageModelV4ToolResultOutput, LanguageModelV4ToolChoice, LanguageModelV4FunctionTool, LanguageModelV4ProviderTool } from '@ai-sdk/provider';
import { GatewayModelId } from '@ai-sdk/gateway';
import { ModelMessage, AssistantModelMessage, ToolModelMessage, ProviderOptions, ToolSet, SystemModelMessage, Context, InferToolSetContext, Arrayable, InferToolInput, InferToolOutput, ReasoningPart, ReasoningFilePart, InferToolContext, ToolExecutionOptions, MaybePromiseLike, ToolResultOutput, Tool, Experimental_SandboxSession, RetryFunction, ToolApprovalRequest, ToolApprovalResponse, ToolResultPart } from '@ai-sdk/provider-utils';
export { convertAsyncIteratorToReadableStream } from '@ai-sdk/provider-utils';

/**
 * Embedding.
 */
type Embedding = EmbeddingModelV4Embedding;

declare global {
    /**
     * Global interface that can be augmented by third-party packages to register custom model IDs.
     *
     * You can register model IDs in two ways:
     *
     * 1. Register based on Model IDs from a provider package:
     * @example
     * ```typescript
     * import { openai } from '@ai-sdk/openai';
     * type OpenAIResponsesModelId = Parameters<typeof openai>[0];
     *
     * declare global {
     *   interface RegisteredProviderModels {
     *     openai: OpenAIResponsesModelId;
     *   }
     * }
     * ```
     *
     * 2. Register individual model IDs directly as keys:
     * @example
     * ```typescript
     * declare global {
     *   interface RegisteredProviderModels {
     *     'my-provider:my-model': any;
     *     'my-provider:another-model': any;
     *   }
     * }
     * ```
     */
    interface RegisteredProviderModels {
    }
}
/**
 * Global provider model ID type that defaults to GatewayModelId but can be augmented
 * by third-party packages via declaration merging.
 */
type GlobalProviderModelId = [keyof RegisteredProviderModels] extends [
    never
] ? GatewayModelId : keyof RegisteredProviderModels | RegisteredProviderModels[keyof RegisteredProviderModels];
/**
 * Language model that is used by the AI SDK.
 */
type LanguageModel = GlobalProviderModelId | LanguageModelV4 | LanguageModelV3 | LanguageModelV2;
/**
 * Reason why a language model finished generating a response.
 *
 * Can be one of the following:
 * - `stop`: model generated stop sequence
 * - `length`: model generated maximum number of tokens
 * - `content-filter`: content filter violation stopped the model
 * - `tool-calls`: model triggered tool calls
 * - `error`: model stopped because of an error
 * - `other`: model stopped for other reasons
 */
type FinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other';
/**
 * Warning from the model provider for this call. The call will proceed, but e.g.
 * some settings might not be supported, which can lead to suboptimal results.
 */
type CallWarning = SharedV4Warning;
/**
 * A source that has been used as input to generate the response.
 */
type Source = LanguageModelV4Source;
/**
 * Tool choice for the generation. It supports the following settings:
 *
 * - `auto` (default): the model can choose whether and which tools to call.
 * - `required`: the model must call a tool. It can choose which tool to call.
 * - `none`: the model must not call tools
 * - `{ type: 'tool', toolName: string (typed) }`: the model must call the specified tool
 */
type ToolChoice<TOOLS extends Record<string, unknown>> = 'auto' | 'none' | 'required' | {
    type: 'tool';
    toolName: Extract<keyof TOOLS, string>;
};

/**
 * Metadata for a language model request.
 */
type LanguageModelRequestMetadata = {
    /**
     * The input messages that were sent to the model for this step.
     */
    readonly messages?: Array<ModelMessage>;
    /**
     * Request HTTP body that was sent to the provider API.
     */
    readonly body?: unknown;
};

/**
 * A message that was generated during the generation process.
 * It can be either an assistant message or a tool message.
 */
type ResponseMessage = AssistantModelMessage | ToolModelMessage;

/**
 * Metadata for a language model response.
 */
type LanguageModelResponseMetadata = {
    /**
     * The response messages that were generated during the call.
     * Response messages can be either assistant messages or tool messages.
     * They contain a generated id.
     */
    readonly messages: Array<ResponseMessage>;
    /**
     * ID for the generated response.
     */
    readonly id: string;
    /**
     * Timestamp for the start of the generated response.
     */
    readonly timestamp: Date;
    /**
     * The ID of the response model that was used to generate the response.
     */
    readonly modelId: string;
    /**
     * Response headers (available only for providers that use HTTP requests).
     */
    readonly headers?: Record<string, string>;
    /**
     * Response body (available only for providers that use HTTP requests).
     */
    readonly body?: unknown;
};

/**
 * Additional provider-specific metadata that is returned from the provider.
 *
 * This is needed to enable provider-specific functionality that can be
 * fully encapsulated in the provider.
 */
type ProviderMetadata = SharedV4ProviderMetadata;

/**
 * Represents the number of tokens used in a prompt and completion.
 */
type LanguageModelUsage = {
    /**
     * The total number of input (prompt) tokens used.
     */
    inputTokens: number | undefined;
    /**
     * Detailed information about the input tokens.
     */
    inputTokenDetails: {
        /**
         * The number of non-cached input (prompt) tokens used.
         */
        noCacheTokens: number | undefined;
        /**
         * The number of cached input (prompt) tokens read.
         */
        cacheReadTokens: number | undefined;
        /**
         * The number of cached input (prompt) tokens written.
         */
        cacheWriteTokens: number | undefined;
    };
    /**
     * The number of total output (completion) tokens used.
     */
    outputTokens: number | undefined;
    /**
     * Detailed information about the output tokens.
     */
    outputTokenDetails: {
        /**
         * The number of text tokens used.
         */
        textTokens: number | undefined;
        /**
         * The number of reasoning tokens used.
         */
        reasoningTokens: number | undefined;
    };
    /**
     * The total number of tokens used.
     */
    totalTokens: number | undefined;
    /**
     * Raw usage information from the provider.
     *
     * This is the usage information in the shape that the provider returns.
     * It can include additional information that is not part of the standard usage information.
     */
    raw?: JSONObject;
};
/**
 * Represents the number of tokens used in an embedding.
 */
type EmbeddingModelUsage = {
    /**
     * The number of tokens used in the embedding.
     */
    tokens: number;
};
declare function asLanguageModelUsage(usage: LanguageModelV4Usage): LanguageModelUsage;
declare function createNullLanguageModelUsage(): LanguageModelUsage;
declare function addLanguageModelUsage(usage1: LanguageModelUsage, usage2: LanguageModelUsage): LanguageModelUsage;

/**
 * Warning from the model provider for this call. The call will proceed, but e.g.
 * some settings might not be supported, which can lead to suboptimal results.
 */
type Warning = SharedV4Warning;

/**
 * A function for logging warnings.
 *
 * You can assign it to the `AI_SDK_LOG_WARNINGS` global variable to use it as the default warning logger.
 *
 * @example
 * ```ts
 * globalThis.AI_SDK_LOG_WARNINGS = (options) => {
 *   console.log('WARNINGS:', options.warnings, options.provider, options.model);
 * };
 * ```
 */
type LogWarningsFunction = (options: {
    /**
     * The warnings returned by the model provider.
     */
    warnings: Warning[];
    /**
     * The provider id used for the call, if scoped to a specific provider.
     */
    provider?: string;
    /**
     * The model id used for the call, if scoped to a specific provider.
     */
    model?: string;
}) => void;

/**
 * Event passed to the `onStart` callback for embed and embedMany operations.
 *
 * Called when the operation begins, before the embedding model is called.
 */
type EmbedStartEvent = {
    /** Unique identifier for this embed call, used to correlate events. */
    readonly callId: string;
    /** Identifies the operation type (e.g. 'ai.embed' or 'ai.embedMany'). */
    readonly operationId: string;
    /** The provider identifier (e.g., 'openai', 'anthropic'). */
    readonly provider: string;
    /** The specific model identifier (e.g., 'text-embedding-3-small'). */
    readonly modelId: string;
    /** The value(s) being embedded. A string for embed, an array for embedMany. */
    readonly value: string | Array<string>;
    /** Maximum number of retries for failed requests. */
    readonly maxRetries: number;
    /** Additional HTTP headers sent with the request. */
    readonly headers: Record<string, string | undefined> | undefined;
    /** Additional provider-specific options. */
    readonly providerOptions: ProviderOptions | undefined;
};
/**
 * Event passed to the `onEnd` callback for embed and embedMany operations.
 *
 * Called when the operation completes, after the embedding model returns.
 */
type EmbedEndEvent = {
    /** Unique identifier for this embed call, used to correlate events. */
    readonly callId: string;
    /** Identifies the operation type (e.g. 'ai.embed' or 'ai.embedMany'). */
    readonly operationId: string;
    /** The provider identifier (e.g., 'openai', 'anthropic'). */
    readonly provider: string;
    /** The specific model identifier (e.g., 'text-embedding-3-small'). */
    readonly modelId: string;
    /** The value(s) that were embedded. A string for embed, an array for embedMany. */
    readonly value: string | Array<string>;
    /** The resulting embedding(s). A single vector for embed, an array for embedMany. */
    readonly embedding: Embedding | Array<Embedding>;
    /** Token usage for the embedding operation. */
    readonly usage: EmbeddingModelUsage;
    /** Warnings from the embedding model, e.g. unsupported settings. */
    readonly warnings: Array<Warning>;
    /** Optional provider-specific metadata. */
    readonly providerMetadata: ProviderMetadata | undefined;
    /** Response data including headers and body. A single response for embed, an array for embedMany. */
    readonly response: {
        headers?: Record<string, string>;
        body?: unknown;
    } | Array<{
        headers?: Record<string, string>;
        body?: unknown;
    } | undefined> | undefined;
};
/**
 * Event fired when an individual embedding model call (inner operation doEmbed) begins.
 *
 * For `embed`, there is one call. For `embedMany`, there may be multiple
 * calls when values are chunked.
 */
type EmbeddingModelCallStartEvent = {
    /** Unique identifier for this embed call, used to correlate events. */
    readonly callId: string;
    /** Unique identifier for this individual doEmbed invocation, used to correlate start/finish within parallel chunks. */
    readonly embedCallId: string;
    /** Identifies the inner operation (e.g. 'ai.embed.doEmbed' or 'ai.embedMany.doEmbed'). */
    readonly operationId: string;
    /** The provider identifier. */
    readonly provider: string;
    /** The specific model identifier. */
    readonly modelId: string;
    /** The values being embedded in this particular model call. */
    readonly values: Array<string>;
};
/**
 * Event fired when an individual embedding model call (doEmbed) completes.
 *
 * Contains the embeddings, usage, and any warnings from the model response.
 */
type EmbeddingModelCallEndEvent = {
    /** Unique identifier for this embed call, used to correlate events. */
    readonly callId: string;
    /** Unique identifier for this individual doEmbed invocation, used to correlate start/finish within parallel chunks. */
    readonly embedCallId: string;
    /** Identifies the inner operation (e.g. 'ai.embed.doEmbed' or 'ai.embedMany.doEmbed'). */
    readonly operationId: string;
    /** The provider identifier. */
    readonly provider: string;
    /** The specific model identifier. */
    readonly modelId: string;
    /** The values that were embedded in this particular model call. */
    readonly values: Array<string>;
    /** The resulting embeddings from the model call. */
    readonly embeddings: Array<Embedding>;
    /** Token usage for this model call. */
    readonly usage: EmbeddingModelUsage;
};

/**
 * Model-facing generation controls. These settings influence how the model
 * generates its response (token limits, sampling, penalties, stop sequences,
 * seed, reasoning).
 */
type LanguageModelCallOptions = {
    /**
     * Maximum number of tokens to generate.
     */
    maxOutputTokens?: number;
    /**
     * Temperature setting. The range depends on the provider and model.
     *
     * It is recommended to set either `temperature` or `topP`, but not both.
     */
    temperature?: number;
    /**
     * Nucleus sampling. This is a number between 0 and 1.
     *
     * E.g. 0.1 would mean that only tokens with the top 10% probability mass
     * are considered.
     *
     * It is recommended to set either `temperature` or `topP`, but not both.
     */
    topP?: number;
    /**
     * Only sample from the top K options for each subsequent token.
     *
     * Used to remove "long tail" low probability responses.
     * Recommended for advanced use cases only. You usually only need to use temperature.
     */
    topK?: number;
    /**
     * Presence penalty setting. It affects the likelihood of the model to
     * repeat information that is already in the prompt.
     *
     * The presence penalty is a number between -1 (increase repetition)
     * and 1 (maximum penalty, decrease repetition). 0 means no penalty.
     */
    presencePenalty?: number;
    /**
     * Frequency penalty setting. It affects the likelihood of the model
     * to repeatedly use the same words or phrases.
     *
     * The frequency penalty is a number between -1 (increase repetition)
     * and 1 (maximum penalty, decrease repetition). 0 means no penalty.
     */
    frequencyPenalty?: number;
    /**
     * Stop sequences.
     * If set, the model will stop generating text when one of the stop sequences is generated.
     * Providers may have limits on the number of stop sequences.
     */
    stopSequences?: string[];
    /**
     * The seed (integer) to use for random sampling. If set and supported
     * by the model, calls will generate deterministic results.
     */
    seed?: number;
    /**
     * Reasoning effort level for the model. Controls how much reasoning
     * the model performs before generating a response.
     *
     * Use `'provider-default'` to use the provider's default reasoning level.
     * Use `'none'` to disable reasoning (if supported by the provider).
     */
    reasoning?: LanguageModelV4CallOptions['reasoning'];
};

/**
 * Timeout configuration for API calls. Can be specified as:
 * - A number representing milliseconds
 * - An object with `totalMs` property for the total timeout in milliseconds
 * - An object with `stepMs` property for the timeout of each step in milliseconds
 * - An object with `firstChunkMs` property for the timeout until the first content chunk of each step (streaming only)
 * - An object with `chunkMs` property for the timeout between content chunks (streaming only)
 * - An object with `toolMs` property for the default timeout for all tool executions
 * - An object with `tools` property for per-tool timeout overrides using `{toolName}Ms` keys
 */
type TimeoutConfiguration<TOOLS extends ToolSet> = number | {
    totalMs?: number;
    stepMs?: number;
    firstChunkMs?: number;
    chunkMs?: number;
    toolMs?: number;
    tools?: Partial<Record<`${keyof TOOLS & string}Ms`, number>>;
};

/**
 * Instructions to include in the prompt. Can be used with `prompt` or `messages`.
 */
type Instructions = string | SystemModelMessage | Array<SystemModelMessage>;
/**
 * Prompt part of the AI function options.
 * It contains instructions, a simple text prompt, or a list of messages.
 */
type Prompt = {
    /**
     * Instructions to include in the prompt. Can be used with `prompt` or `messages`.
     */
    instructions?: Instructions;
    /**
     * Instructions to include in the prompt. Can be used with `prompt` or `messages`.
     *
     * @deprecated Use `instructions` instead.
     */
    system?: Instructions;
    /**
     * Whether system messages are allowed in the `prompt` or `messages` fields.
     *
     * When disabled, system messages must be provided through the `instructions`
     * option.
     *
     * @default false
     */
    allowSystemInMessages?: boolean;
} & ({
    /**
     * A prompt. It can be either a text prompt or a list of messages.
     *
     * You can either use `prompt` or `messages` but not both.
     */
    prompt: string | Array<ModelMessage>;
    /**
     * A list of messages.
     *
     * You can either use `prompt` or `messages` but not both.
     */
    messages?: never;
} | {
    /**
     * A list of messages.
     *
     * You can either use `prompt` or `messages` but not both.
     */
    messages: Array<ModelMessage>;
    /**
     * A prompt. It can be either a text prompt or a list of messages.
     *
     * You can either use `prompt` or `messages` but not both.
     */
    prompt?: never;
});

/**
 * Event passed to the `onStart` callback of
 * `generateObject` and `streamObject`.
 *
 * Called when the operation begins, before any LLM call.
 *
 * @deprecated
 */
interface GenerateObjectStartEvent {
    /** Unique identifier for this generation call, used to correlate events. */
    readonly callId: string;
    /** Identifies the operation type (e.g. `'ai.generateObject'` or `'ai.streamObject'`). */
    readonly operationId: string;
    /** The provider identifier (e.g., 'openai', 'anthropic'). */
    readonly provider: string;
    /** The specific model identifier (e.g., 'gpt-4o'). */
    readonly modelId: string;
    /** The system message(s) provided to the model. */
    readonly system: Instructions | undefined;
    /** The prompt string or array of messages if using the prompt option. */
    readonly prompt: string | Array<ModelMessage> | undefined;
    /** The messages array if using the messages option. */
    readonly messages: Array<ModelMessage> | undefined;
    /** Maximum number of tokens to generate. */
    readonly maxOutputTokens: number | undefined;
    /** Sampling temperature for generation. */
    readonly temperature: number | undefined;
    /** Top-p (nucleus) sampling parameter. */
    readonly topP: number | undefined;
    /** Top-k sampling parameter. */
    readonly topK: number | undefined;
    /** Presence penalty for generation. */
    readonly presencePenalty: number | undefined;
    /** Frequency penalty for generation. */
    readonly frequencyPenalty: number | undefined;
    /** Random seed for reproducible generation. */
    readonly seed: number | undefined;
    /** Maximum number of retries for failed requests. */
    readonly maxRetries: number;
    /** Additional HTTP headers sent with the request. */
    readonly headers: Record<string, string | undefined> | undefined;
    /** Additional provider-specific options. */
    readonly providerOptions: ProviderOptions | undefined;
    /** The output strategy type. */
    readonly output: 'object' | 'array' | 'enum' | 'no-schema';
    /** The JSON Schema used for object generation, if any. */
    readonly schema: Record<string, unknown> | undefined;
    /** Optional name of the schema. */
    readonly schemaName: string | undefined;
    /** Optional description of the schema. */
    readonly schemaDescription: string | undefined;
}
/**
 * Event passed to the `onStepStart` callback of
 * `generateObject` and `streamObject`.
 *
 * Called when the model call (step) begins, before the provider is called.
 * For object generation, there is always exactly one step (step 0).
 *
 * @deprecated
 */
interface GenerateObjectStepStartEvent {
    /** Unique identifier for this generation call, used to correlate events. */
    readonly callId: string;
    /** Zero-based index of the current step. Always `0` for object generation. */
    readonly stepNumber: 0;
    /** The provider identifier (e.g., 'openai', 'anthropic'). */
    readonly provider: string;
    /** The specific model identifier (e.g., 'gpt-4o'). */
    readonly modelId: string;
    /** Additional provider-specific options. */
    readonly providerOptions: ProviderOptions | undefined;
    /** Additional HTTP headers sent with the request. */
    readonly headers: Record<string, string | undefined> | undefined;
    /** The prompt messages in provider format (for telemetry). */
    readonly promptMessages?: LanguageModelV4Prompt;
}
/**
 * Event passed to the `onStepEnd` callback of
 * `generateObject` and `streamObject`.
 *
 * Called when the model call (step) completes, with the raw result
 * before JSON parsing and schema validation.
 *
 * @deprecated
 */
interface GenerateObjectStepEndEvent {
    /** Unique identifier for this generation call, used to correlate events. */
    readonly callId: string;
    /** Zero-based index of the current step. Always `0` for object generation. */
    readonly stepNumber: 0;
    /** The provider identifier (e.g., 'openai', 'anthropic'). */
    readonly provider: string;
    /** The specific model identifier (e.g., 'gpt-4o'). */
    readonly modelId: string;
    /** The unified reason why the generation finished. */
    readonly finishReason: FinishReason;
    /** The token usage of the generated response. */
    readonly usage: LanguageModelUsage;
    /** The raw text output from the model (before JSON parsing). */
    readonly objectText: string;
    /** The reasoning generated by the model, if any. */
    readonly reasoning: string | undefined;
    /** Warnings from the model provider (e.g. unsupported settings). */
    readonly warnings: CallWarning[] | undefined;
    /** Additional request information. */
    readonly request: Omit<LanguageModelRequestMetadata, 'messages'>;
    /** Additional response information. */
    readonly response: Omit<LanguageModelResponseMetadata, 'messages'>;
    /** Additional provider-specific metadata. */
    readonly providerMetadata: ProviderMetadata | undefined;
    /** Milliseconds from the start of the stream to the first chunk (streaming only). */
    readonly msToFirstChunk: number | undefined;
}
/**
 * Event passed to the `onFinish` callback of
 * `generateObject` and `streamObject`.
 *
 * Called when the entire operation completes, including JSON parsing
 * and schema validation. For `streamObject`, the object may be undefined
 * if validation failed (the error is provided in that case).
 *
 * @deprecated
 */
interface GenerateObjectEndEvent<RESULT> {
    /** Unique identifier for this generation call, used to correlate events. */
    readonly callId: string;
    /**
     * The generated object (typed according to the schema).
     * Always defined for `generateObject`. May be `undefined` for `streamObject`
     * when parsing or validation fails.
     */
    readonly object: RESULT | undefined;
    /**
     * Error from parsing or schema validation, if any.
     * Always `undefined` for `generateObject` (which throws instead).
     */
    readonly error: unknown | undefined;
    /** The reasoning generated by the model, if any. */
    readonly reasoning: string | undefined;
    /** The unified reason why the generation finished. */
    readonly finishReason: FinishReason;
    /** The token usage of the generated response. */
    readonly usage: LanguageModelUsage;
    /** Warnings from the model provider (e.g. unsupported settings). */
    readonly warnings: CallWarning[] | undefined;
    /** Additional request information. */
    readonly request: Omit<LanguageModelRequestMetadata, 'messages'>;
    /** Additional response information. */
    readonly response: Omit<LanguageModelResponseMetadata, 'messages'>;
    /** Additional provider-specific metadata. */
    readonly providerMetadata: ProviderMetadata | undefined;
}

type StandardizedPrompt = {
    /**
     * Instructions.
     */
    instructions: Instructions | undefined;
    /**
     * Messages.
     */
    messages: ModelMessage[];
};
/**
 * Converts a prompt input into a standardized prompt with validated model
 * messages.
 *
 * @param prompt - The prompt definition to standardize.
 * Set `allowSystemInMessages` to true to allow system messages in the
 * `prompt` or `messages` fields. System messages in the `instructions`
 * option are always allowed.
 * @returns The standardized prompt.
 * @throws {InvalidPromptError} When the prompt is invalid.
 */
declare function standardizePrompt({ allowSystemInMessages, system, instructions, prompt, messages, }: Prompt): Promise<StandardizedPrompt>;

/**
 * A callback function that can be used with `notify`.
 */
type Callback<EVENT> = (event: EVENT) => PromiseLike<void> | void;

/**
 * Tool names that are enabled for a generation step.
 *
 * `undefined` means no tool restriction is applied. Tool names are object keys
 * at runtime, so the type is restricted to the string keys of the configured
 * tool set.
 */
type ActiveTools<TOOLS extends ToolSet> = ReadonlyArray<keyof TOOLS & string> | undefined;

type IncludedContext<CONTEXT extends Context | unknown | never> = {
    [KEY in keyof NoInfer<CONTEXT>]?: boolean;
} | undefined;
type IncludedToolsContext<TOOLS extends ToolSet> = {
    [TOOL_NAME in keyof NoInfer<InferToolSetContext<TOOLS>>]?: IncludedContext<NoInfer<InferToolSetContext<TOOLS>[TOOL_NAME]>>;
} | undefined;
/**
 * Telemetry configuration.
 */
type TelemetryOptions<RUNTIME_CONTEXT extends Context = Context, TOOLS extends ToolSet = ToolSet> = {
    /**
     * Enable or disable telemetry. Enabled by default when a telemetry
     * integration is registered. Set to `false` to opt out.
     */
    isEnabled?: boolean;
    /**
     * Enable or disable input recording. Enabled by default.
     *
     * You might want to disable input recording to avoid recording sensitive
     * information, to reduce data transfers, or to increase performance.
     */
    recordInputs?: boolean;
    /**
     * Enable or disable output recording. Enabled by default.
     *
     * You might want to disable output recording to avoid recording sensitive
     * information, to reduce data transfers, or to increase performance.
     */
    recordOutputs?: boolean;
    /**
     * Identifier for this function. Used to group telemetry data by function.
     */
    functionId?: string;
    /**
     * Top-level runtime context properties that should be included in telemetry.
     * Runtime context properties are excluded unless they are explicitly set to `true`.
     */
    includeRuntimeContext?: IncludedContext<RUNTIME_CONTEXT>;
    /**
     * Top-level tool context properties that should be included in telemetry,
     * configured per tool.
     *
     * Tool context properties are excluded unless they are explicitly set to `true`.
     */
    includeToolsContext?: IncludedToolsContext<TOOLS>;
    /**
     * Per-call telemetry integrations that receive lifecycle events during generation.
     *
     * When provided, these integrations will take precedence over the globally registered
     * integrations for this call.
     */
    integrations?: Arrayable<Telemetry>;
};

/**
 * Download a file from a URL.
 *
 * @param url - The URL to download from.
 * @param maxBytes - Maximum allowed download size in bytes. Defaults to 100 MiB.
 * @param abortSignal - An optional abort signal to cancel the download.
 * @returns The downloaded data and media type.
 *
 * @throws DownloadError if the download fails or exceeds maxBytes.
 */
declare const download: ({ url, maxBytes, abortSignal, }: {
    url: URL;
    maxBytes?: number;
    abortSignal?: AbortSignal;
}) => Promise<{
    data: Uint8Array<ArrayBufferLike>;
    mediaType: string | undefined;
}>;

/**
 * Experimental. Can change in patch versions without warning.
 *
 * Download function. Called with the array of URLs and a boolean indicating
 * whether the URL is supported by the model.
 *
 * The download function can decide for each URL:
 * - to return null (which means that the URL should be passed to the model)
 * - to download the asset and return the data (incl. retries, authentication, etc.)
 *
 * Should throw DownloadError if the download fails.
 *
 * Should return an array of objects sorted by the order of the requested downloads.
 * For each object, the data should be a Uint8Array if the URL was downloaded.
 * For each object, the mediaType should be the media type of the downloaded asset.
 * For each object, the data should be null if the URL should be passed through as is.
 */
type DownloadFunction = (options: Array<{
    url: URL;
    isUrlSupportedByModel: boolean;
}>) => PromiseLike<Array<{
    data: Uint8Array;
    mediaType: string | undefined;
} | null>>;
/**
 * Default download function.
 * Downloads the file if it is not supported by the model.
 */
declare const createDefaultDownloadFunction: (download?: typeof download) => DownloadFunction;

/**
 * A generated file.
 */
interface GeneratedFile {
    /**
     * File as a base64 encoded string.
     */
    readonly base64: string;
    /**
     * File as a Uint8Array.
     */
    readonly uint8Array: Uint8Array;
    /**
     * The IANA media type of the file.
     *
     * @see https://www.iana.org/assignments/media-types/media-types.xhtml
     */
    readonly mediaType: string;
}

/**
 * Reasoning output of a text generation. It contains a reasoning.
 */
interface ReasoningOutput {
    type: 'reasoning';
    /**
     * The reasoning text.
     */
    text: string;
    /**
     * Additional provider-specific metadata. They are passed through
     * to the provider from the AI SDK and enable provider-specific
     * functionality that can be fully encapsulated in the provider.
     */
    providerMetadata?: ProviderMetadata;
}
/**
 * Reasoning file output of a text generation.
 * It contains a file generated as part of reasoning.
 */
interface ReasoningFileOutput {
    type: 'reasoning-file';
    /**
     * The generated file.
     */
    file: GeneratedFile;
    /**
     * Additional provider-specific metadata. They are passed through
     * to the provider from the AI SDK and enable provider-specific
     * functionality that can be fully encapsulated in the provider.
     */
    providerMetadata?: ProviderMetadata;
}

/**
 * Create a union of the given object's values, and optionally specify which keys to get the values from.
 *
 * Please upvote [this issue](https://github.com/microsoft/TypeScript/issues/31438) if you want to have this type as a built-in in TypeScript.
 *
 * @example
 * ```
 * // data.json
 * {
 * 	'foo': 1,
 * 	'bar': 2,
 * 	'biz': 3
 * }
 *
 * // main.ts
 * import type {ValueOf} from 'type-fest';
 * import data = require('./data.json');
 *
 * export function getData(name: string): ValueOf<typeof data> {
 * 	return data[name];
 * }
 *
 * export function onlyBar(name: string): ValueOf<typeof data, 'bar'> {
 * 	return data[name];
 * }
 *
 * // file.ts
 * import {getData, onlyBar} from './main';
 *
 * getData('foo');
 * //=> 1
 *
 * onlyBar('foo');
 * //=> TypeError ...
 *
 * onlyBar('bar');
 * //=> 2
 * ```
 * @see https://github.com/sindresorhus/type-fest/blob/main/source/value-of.d.ts
 */
type ValueOf<ObjectType, ValueType extends keyof ObjectType = keyof ObjectType> = ObjectType[ValueType];

type BaseToolCall = {
    type: 'tool-call';
    toolCallId: string;
    providerExecuted?: boolean;
    providerMetadata?: ProviderMetadata;
    toolMetadata?: JSONObject;
};
/**
 * A tool call whose `toolName` maps to a tool in the declared tool set,
 * with an `input` type inferred from that tool's input schema.
 */
type StaticToolCall<TOOLS extends ToolSet> = ValueOf<{
    [NAME in keyof TOOLS]: BaseToolCall & {
        toolName: NAME & string;
        input: InferToolInput<TOOLS[NAME]>;
        dynamic?: false | undefined;
        invalid?: false | undefined;
        error?: never;
        title?: string;
    };
}>;
/**
 * A tool call whose `toolName` is only known at runtime, such as an invalid
 * or otherwise untyped call that cannot be matched to the declared tool set.
 */
type DynamicToolCall = BaseToolCall & {
    toolName: string;
    input: unknown;
    dynamic: true;
    title?: string;
    /**
     * True if this is caused by an unparsable tool call or
     * a tool that does not exist.
     */
    invalid?: boolean;
    /**
     * The error that caused the tool call to be invalid.
     */
    error?: unknown;
};
/**
 * A tool call returned by text generation, either statically typed from the
 * declared tool set or dynamically typed when the tool cannot be inferred.
 */
type TypedToolCall<TOOLS extends ToolSet> = StaticToolCall<TOOLS> | DynamicToolCall;

/**
 * Output part that indicates that a tool approval request has been made.
 *
 * The tool approval request can be approved or denied in the next tool message.
 */
type ToolApprovalRequestOutput<TOOLS extends ToolSet> = {
    type: 'tool-approval-request';
    /**
     * ID of the tool approval request.
     */
    approvalId: string;
    /**
     * Tool call that the approval request is for.
     */
    toolCall: TypedToolCall<TOOLS>;
    /**
     * Flag indicating whether the tool was automatically approved or denied.
     *
     * @default false
     */
    isAutomatic?: boolean;
    /**
     * HMAC-SHA256 signature binding this approval request to its tool call.
     */
    signature?: string;
};

/**
 * Output part that indicates that a tool approval response is available.
 */
type ToolApprovalResponseOutput<TOOLS extends ToolSet> = {
    type: 'tool-approval-response';
    /**
     * ID of the tool approval.
     */
    approvalId: string;
    /**
     * Tool call that the approval response is for.
     */
    toolCall: TypedToolCall<TOOLS>;
    /**
     * Flag indicating whether the approval was granted or denied.
     */
    approved: boolean;
    /**
     * Optional reason for the approval or denial.
     */
    reason?: string;
    /**
     * Flag indicating whether the tool call is provider-executed.
     * Only provider-executed tool approval responses should be sent to the model.
     */
    providerExecuted?: boolean;
};

type StaticToolError<TOOLS extends ToolSet> = ValueOf<{
    [NAME in keyof TOOLS]: {
        type: 'tool-error';
        toolCallId: string;
        toolName: NAME & string;
        input: InferToolInput<TOOLS[NAME]>;
        error: unknown;
        providerExecuted?: boolean;
        providerMetadata?: ProviderMetadata;
        toolMetadata?: JSONObject;
        dynamic?: false | undefined;
        title?: string;
    };
}>;
type DynamicToolError = {
    type: 'tool-error';
    toolCallId: string;
    toolName: string;
    input: unknown;
    error: unknown;
    providerExecuted?: boolean;
    providerMetadata?: ProviderMetadata;
    toolMetadata?: JSONObject;
    dynamic: true;
    title?: string;
};
type TypedToolError<TOOLS extends ToolSet> = StaticToolError<TOOLS> | DynamicToolError;

type StaticToolResult<TOOLS extends ToolSet> = ValueOf<{
    [NAME in keyof TOOLS]: {
        type: 'tool-result';
        toolCallId: string;
        toolName: NAME & string;
        input: InferToolInput<TOOLS[NAME]>;
        output: InferToolOutput<TOOLS[NAME]>;
        providerExecuted?: boolean;
        providerMetadata?: ProviderMetadata;
        toolMetadata?: JSONObject;
        dynamic?: false | undefined;
        preliminary?: boolean;
        title?: string;
    };
}>;
type DynamicToolResult = {
    type: 'tool-result';
    toolCallId: string;
    toolName: string;
    input: unknown;
    output: unknown;
    providerExecuted?: boolean;
    providerMetadata?: ProviderMetadata;
    toolMetadata?: JSONObject;
    dynamic: true;
    preliminary?: boolean;
    title?: string;
};
type TypedToolResult<TOOLS extends ToolSet> = StaticToolResult<TOOLS> | DynamicToolResult;

type ContentPart<TOOLS extends ToolSet> = {
    type: 'text';
    text: string;
    providerMetadata?: ProviderMetadata;
} | {
    type: 'custom';
    kind: `${string}.${string}`;
    providerMetadata?: ProviderMetadata;
} | ReasoningOutput | ReasoningFileOutput | ({
    type: 'source';
} & Source) | {
    type: 'file';
    file: GeneratedFile;
    providerMetadata?: ProviderMetadata;
} | ({
    type: 'tool-call';
} & TypedToolCall<TOOLS> & {
    providerMetadata?: ProviderMetadata;
}) | ({
    type: 'tool-result';
} & TypedToolResult<TOOLS> & {
    providerMetadata?: ProviderMetadata;
}) | ({
    type: 'tool-error';
} & TypedToolError<TOOLS> & {
    providerMetadata?: ProviderMetadata;
}) | ToolApprovalRequestOutput<TOOLS> | ToolApprovalResponseOutput<TOOLS>;

/**
 * Timing statistics for the gaps between generated output chunks.
 */
type OutputChunkTimingStats = {
    /** Shortest observed time between output chunks in milliseconds. */
    readonly min: number;
    /** 10th percentile time between output chunks in milliseconds. */
    readonly p10: number;
    /** Median time between output chunks in milliseconds. */
    readonly median: number;
    /** Average time between output chunks in milliseconds. */
    readonly avg: number;
    /** 90th percentile time between output chunks in milliseconds. */
    readonly p90: number;
    /** Longest observed time between output chunks in milliseconds. */
    readonly max: number;
};
/**
 * Performance metrics for a single step in the generation process.
 */
type StepResultPerformance = {
    /**
     * Effective number of output tokens per second over the full language model
     * response.
     *
     * Calculated as `outputTokens / requestSeconds`.
     */
    readonly effectiveOutputTokensPerSecond: number;
    /**
     * Number of output tokens per second after the first generated output chunk
     * was received.
     *
     * Only available for streaming steps.
     *
     * Calculated as `outputTokens / outputStreamSeconds`.
     */
    readonly outputTokensPerSecond: number | undefined;
    /**
     * Number of input tokens processed per second before the first generated
     * output chunk was received.
     *
     * Only available for streaming steps.
     *
     * Calculated as `inputTokens / ttftSeconds`.
     */
    readonly inputTokensPerSecond: number | undefined;
    /**
     * Effective number of input and output tokens per second over the full
     * language model response.
     *
     * Calculated as `(inputTokens + outputTokens) / requestSeconds`.
     */
    readonly effectiveTotalTokensPerSecond: number;
    /**
     * Total time spent on the step in milliseconds.
     */
    readonly stepTimeMs: number;
    /**
     * Time spent waiting for the language model response in milliseconds.
     */
    readonly responseTimeMs: number;
    /**
     * Time spent executing each client-side tool call in milliseconds, keyed by
     * tool call ID.
     */
    readonly toolExecutionMs: Readonly<Record<string, number>>;
    /**
     * Time until the first generated output chunk was received in milliseconds.
     *
     * This includes text deltas, reasoning deltas, generated files, reasoning
     * files, tool input deltas, and tool calls.
     *
     * Only available for streaming steps.
     */
    readonly timeToFirstOutputMs: number | undefined;
    /**
     * Timing statistics for the gaps between generated output chunks in
     * milliseconds.
     *
     * Only available for streaming steps with at least two generated output
     * chunks.
     */
    readonly timeBetweenOutputChunksMs?: OutputChunkTimingStats;
};
/**
 * The result of a single step in the generation process.
 */
type StepResult<TOOLS extends ToolSet, RUNTIME_CONTEXT extends Context = Context> = {
    /**
     * Unique identifier for the generation call this step belongs to.
     */
    readonly callId: string;
    /**
     * Zero-based index of this step.
     */
    readonly stepNumber: number;
    /**
     * Information about the model that produced this step.
     */
    readonly model: {
        /** The provider of the model. */
        readonly provider: string;
        /** The ID of the model. */
        readonly modelId: string;
    };
    /**
     * Tool context.
     */
    readonly toolsContext: InferToolSetContext<TOOLS>;
    /**
     * The runtime context that was used as input for the step.
     */
    readonly runtimeContext: RUNTIME_CONTEXT;
    /**
     * The content that was generated in the last step.
     */
    readonly content: Array<ContentPart<TOOLS>>;
    /**
     * The generated text. Can be an empty string if the model has not generated any text.
     */
    readonly text: string;
    /**
     * The reasoning that was generated during the generation.
     */
    readonly reasoning: Array<ReasoningPart | ReasoningFilePart>;
    /**
     * The reasoning text that was generated during the generation.
     *
     * It is a concatenation of all reasoning parts (but excluding reasoning file parts).
     * Can be undefined if the model has only generated text.
     */
    readonly reasoningText: string | undefined;
    /**
     * The files that were generated during the generation.
     */
    readonly files: Array<GeneratedFile>;
    /**
     * The sources that were used to generate the text.
     */
    readonly sources: Array<Source>;
    /**
     * The tool calls that were made during the generation.
     */
    readonly toolCalls: Array<TypedToolCall<TOOLS>>;
    /**
     * The static tool calls that were made in the last step.
     */
    readonly staticToolCalls: Array<StaticToolCall<TOOLS>>;
    /**
     * The dynamic tool calls that were made in the last step.
     */
    readonly dynamicToolCalls: Array<DynamicToolCall>;
    /**
     * The results of the tool calls.
     */
    readonly toolResults: Array<TypedToolResult<TOOLS>>;
    /**
     * The static tool results that were made in the last step.
     */
    readonly staticToolResults: Array<StaticToolResult<TOOLS>>;
    /**
     * The dynamic tool results that were made in the last step.
     */
    readonly dynamicToolResults: Array<DynamicToolResult>;
    /**
     * The unified reason why the generation finished.
     */
    readonly finishReason: FinishReason;
    /**
     * The raw reason why the generation finished (from the provider).
     */
    readonly rawFinishReason: string | undefined;
    /**
     * The token usage of the generated text.
     */
    readonly usage: LanguageModelUsage;
    /**
     * Performance metrics for the step.
     */
    readonly performance: StepResultPerformance;
    /**
     * Warnings from the model provider (e.g. unsupported settings).
     */
    readonly warnings: CallWarning[] | undefined;
    /**
     * Additional request information.
     */
    readonly request: LanguageModelRequestMetadata;
    /**
     * Additional response information.
     */
    readonly response: LanguageModelResponseMetadata;
    /**
     * Additional provider-specific metadata. They are passed through
     * from the provider to the AI SDK and enable provider-specific
     * results that can be fully encapsulated in the provider.
     */
    readonly providerMetadata: ProviderMetadata | undefined;
};
declare class DefaultStepResult<TOOLS extends ToolSet, RUNTIME_CONTEXT extends Context = Context> implements StepResult<TOOLS, RUNTIME_CONTEXT> {
    readonly callId: StepResult<TOOLS, RUNTIME_CONTEXT>['callId'];
    readonly stepNumber: StepResult<TOOLS, RUNTIME_CONTEXT>['stepNumber'];
    readonly model: StepResult<TOOLS, RUNTIME_CONTEXT>['model'];
    readonly toolsContext: StepResult<TOOLS, RUNTIME_CONTEXT>['toolsContext'];
    readonly runtimeContext: StepResult<TOOLS, RUNTIME_CONTEXT>['runtimeContext'];
    readonly content: StepResult<TOOLS, RUNTIME_CONTEXT>['content'];
    readonly finishReason: StepResult<TOOLS, RUNTIME_CONTEXT>['finishReason'];
    readonly rawFinishReason: StepResult<TOOLS, RUNTIME_CONTEXT>['rawFinishReason'];
    readonly usage: StepResult<TOOLS, RUNTIME_CONTEXT>['usage'];
    readonly performance: StepResult<TOOLS, RUNTIME_CONTEXT>['performance'];
    readonly warnings: StepResult<TOOLS, RUNTIME_CONTEXT>['warnings'];
    readonly request: StepResult<TOOLS, RUNTIME_CONTEXT>['request'];
    readonly response: StepResult<TOOLS, RUNTIME_CONTEXT>['response'];
    readonly providerMetadata: StepResult<TOOLS, RUNTIME_CONTEXT>['providerMetadata'];
    constructor({ callId, stepNumber, provider, modelId, runtimeContext, toolsContext, content, finishReason, rawFinishReason, usage, performance, warnings, request, response, providerMetadata, }: {
        callId: StepResult<TOOLS, RUNTIME_CONTEXT>['callId'];
        stepNumber: StepResult<TOOLS, RUNTIME_CONTEXT>['stepNumber'];
        provider: StepResult<TOOLS, RUNTIME_CONTEXT>['model']['provider'];
        modelId: StepResult<TOOLS, RUNTIME_CONTEXT>['model']['modelId'];
        runtimeContext: StepResult<TOOLS, RUNTIME_CONTEXT>['runtimeContext'];
        toolsContext: StepResult<TOOLS, RUNTIME_CONTEXT>['toolsContext'];
        content: StepResult<TOOLS, RUNTIME_CONTEXT>['content'];
        finishReason: StepResult<TOOLS, RUNTIME_CONTEXT>['finishReason'];
        rawFinishReason: StepResult<TOOLS, RUNTIME_CONTEXT>['rawFinishReason'];
        usage: StepResult<TOOLS, RUNTIME_CONTEXT>['usage'];
        performance: StepResult<TOOLS, RUNTIME_CONTEXT>['performance'];
        warnings: StepResult<TOOLS, RUNTIME_CONTEXT>['warnings'];
        request: StepResult<TOOLS, RUNTIME_CONTEXT>['request'];
        response: StepResult<TOOLS, RUNTIME_CONTEXT>['response'];
        providerMetadata: StepResult<TOOLS, RUNTIME_CONTEXT>['providerMetadata'];
    });
    get text(): string;
    get reasoning(): Array<ReasoningPart | ReasoningFilePart>;
    get reasoningText(): string | undefined;
    get files(): GeneratedFile[];
    get sources(): (({
        type: "source";
    } & {
        type: "source";
        sourceType: "url";
        id: string;
        url: string;
        title?: string;
        providerMetadata?: _ai_sdk_provider.SharedV4ProviderMetadata;
    }) | ({
        type: "source";
    } & {
        type: "source";
        sourceType: "document";
        id: string;
        mediaType: string;
        title: string;
        filename?: string;
        providerMetadata?: _ai_sdk_provider.SharedV4ProviderMetadata;
    }))[];
    get toolCalls(): (({
        type: "tool-call";
    } & {
        type: "tool-call";
        toolCallId: string;
        providerExecuted?: boolean;
        providerMetadata?: ProviderMetadata;
        toolMetadata?: _ai_sdk_provider.JSONObject;
    } & {
        toolName: string;
        input: unknown;
        dynamic: true;
        title?: string;
        invalid?: boolean;
        error?: unknown;
    } & {
        providerMetadata?: ProviderMetadata;
    }) | ({
        type: "tool-call";
    } & StaticToolCall<TOOLS> & {
        providerMetadata?: ProviderMetadata;
    }))[];
    get staticToolCalls(): StaticToolCall<TOOLS>[];
    get dynamicToolCalls(): DynamicToolCall[];
    get toolResults(): (({
        type: "tool-result";
    } & DynamicToolResult & {
        providerMetadata?: ProviderMetadata;
    }) | ({
        type: "tool-result";
    } & StaticToolResult<TOOLS> & {
        providerMetadata?: ProviderMetadata;
    }))[];
    get staticToolResults(): StaticToolResult<TOOLS>[];
    get dynamicToolResults(): DynamicToolResult[];
}

/**
 * Common model information used across callback events.
 */
type ModelInfo = {
    /** The provider identifier (e.g., 'openai', 'anthropic'). */
    readonly provider: string;
    /** The specific model identifier (e.g., 'gpt-4o'). */
    readonly modelId: string;
};
/**
 * Event passed to the `onLanguageModelCallStart` callback.
 *
 * Called immediately before the provider model call begins.
 * Unlike `onStepStart`, this only represents model invocation work.
 */
type LanguageModelCallStartEvent = ModelInfo & {
    /** Unique identifier for this generation call, used to correlate events. */
    readonly callId: string;
    /** Prepared tool definitions for the model call, if any. */
    readonly tools: ReadonlyArray<Record<string, unknown>> | undefined;
} & StandardizedPrompt & LanguageModelCallOptions;
/**
 * Event passed to the `onLanguageModelCallEnd` callback.
 *
 * Called after the model response has been normalized and parsed, but before
 * any client-side tool execution begins.
 */
type LanguageModelCallEndEvent<TOOLS extends ToolSet = ToolSet> = ModelInfo & {
    /** Unique identifier for this generation call, used to correlate events. */
    readonly callId: string;
    /** The unified reason why the model call finished. */
    readonly finishReason: FinishReason;
    /** The token usage reported by the model call. */
    readonly usage: LanguageModelUsage;
    /** The content parts produced by the model call. */
    readonly content: ReadonlyArray<ContentPart<TOOLS>>;
    /** The provider-returned response id for this model call. */
    readonly responseId: string;
    /** Performance metrics for the model call. */
    readonly performance: {
        /** Time spent waiting for the language model response in milliseconds. */
        readonly responseTimeMs: number;
        /**
         * Effective number of output tokens per second over the full language
         * model response.
         */
        readonly effectiveOutputTokensPerSecond: number;
        /**
         * Number of output tokens per second after the first generated output
         * chunk was received.
         *
         * Only available for streaming calls.
         */
        readonly outputTokensPerSecond: number | undefined;
        /**
         * Number of input tokens processed per second before the first generated
         * output chunk was received.
         *
         * Only available for streaming calls.
         */
        readonly inputTokensPerSecond: number | undefined;
        /**
         * Effective number of input and output tokens per second over the full
         * language model response.
         */
        readonly effectiveTotalTokensPerSecond: number;
        /**
         * Time until the first generated output chunk was received in
         * milliseconds.
         */
        readonly timeToFirstOutputMs: number | undefined;
        /**
         * Timing statistics for the gaps between generated output chunks in
         * milliseconds.
         *
         * Only available for streaming calls with at least two output chunks.
         */
        readonly timeBetweenOutputChunksMs?: OutputChunkTimingStats;
    };
};
/**
 * Callback that is set using the `onLanguageModelCallStart` option.
 *
 * Called immediately before the provider model call begins.
 * Unlike step-start callbacks, this is scoped to model work only and
 * excludes any later client-side tool execution.
 *
 * @param event - The event object containing model-call-specific inputs.
 */
type OnLanguageModelCallStartCallback = Callback<LanguageModelCallStartEvent>;
/**
 * Callback that is set using the `onLanguageModelCallEnd` option.
 *
 * Called after the model response has been normalized and parsed, but before
 * any client-side tool execution begins.
 *
 * @param event - The event object containing model-call-specific outputs.
 */
type OnLanguageModelCallEndCallback<TOOLS extends ToolSet = ToolSet> = Callback<LanguageModelCallEndEvent<TOOLS>>;

/**
 * Tool names that define the order in which tools are sent to the provider.
 *
 * Tool names are object keys at runtime, so the type is restricted to the
 * string keys of the configured tool set. The list can be partial; tools not
 * listed in `toolOrder` are sent after the listed tools, sorted alphabetically.
 */
type ToolOrder<TOOLS extends ToolSet> = ReadonlyArray<keyof TOOLS & string> | undefined;

/**
 * A type that combines AsyncIterable and ReadableStream.
 * This allows a ReadableStream to be consumed using for-await-of syntax.
 */
type AsyncIterableStream<T> = AsyncIterable<T> & ReadableStream<T>;
/**
 * Wraps a ReadableStream and returns an object that is both a ReadableStream and an AsyncIterable.
 * This enables consumption of the stream using for-await-of, with proper resource cleanup on early exit or error.
 *
 * @template T The type of the stream's chunks.
 * @param source The source ReadableStream to wrap.
 * @returns An AsyncIterableStream that can be used as both a ReadableStream and an AsyncIterable.
 */
declare function createAsyncIterableStream<T>(source: ReadableStream<T>): AsyncIterableStream<T>;

/**
 * Tool output when the tool execution has been denied (for static tools).
 */
type StaticToolOutputDenied<TOOLS extends ToolSet> = ValueOf<{
    [NAME in keyof TOOLS]: {
        type: 'tool-output-denied';
        toolCallId: string;
        toolName: NAME & string;
        providerExecuted?: boolean;
        dynamic?: false | undefined;
    };
}>;

type TextStreamTextDeltaPart = {
    type: 'text-delta';
    id: string;
    providerMetadata?: ProviderMetadata;
    text: string;
};
type TextStreamTextStartPart = {
    type: 'text-start';
    id: string;
    providerMetadata?: ProviderMetadata;
};
type TextStreamTextEndPart = {
    type: 'text-end';
    id: string;
    providerMetadata?: ProviderMetadata;
};
type TextStreamReasoningStartPart = {
    type: 'reasoning-start';
    id: string;
    providerMetadata?: ProviderMetadata;
};
type TextStreamReasoningEndPart = {
    type: 'reasoning-end';
    id: string;
    providerMetadata?: ProviderMetadata;
};
type TextStreamReasoningDeltaPart = {
    type: 'reasoning-delta';
    providerMetadata?: ProviderMetadata;
    id: string;
    text: string;
};
type TextStreamCustomPart = {
    type: 'custom';
    kind: `${string}.${string}`;
    providerMetadata?: ProviderMetadata;
};
type TextStreamToolInputStartPart = {
    type: 'tool-input-start';
    id: string;
    toolName: string;
    providerMetadata?: ProviderMetadata;
    toolMetadata?: JSONObject;
    providerExecuted?: boolean;
    dynamic?: boolean;
    title?: string;
};
type TextStreamToolInputEndPart = {
    type: 'tool-input-end';
    id: string;
    providerMetadata?: ProviderMetadata;
};
type TextStreamToolInputDeltaPart = {
    type: 'tool-input-delta';
    id: string;
    delta: string;
    providerMetadata?: ProviderMetadata;
};
type TextStreamSourcePart = {
    type: 'source';
} & Source;
type TextStreamFilePart = {
    type: 'file';
    file: GeneratedFile;
    providerMetadata?: ProviderMetadata;
};
type TextStreamReasoningFilePart = {
    type: 'reasoning-file';
    file: GeneratedFile;
    providerMetadata?: ProviderMetadata;
};
type TextStreamToolCallPart<TOOLS extends ToolSet> = {
    type: 'tool-call';
} & TypedToolCall<TOOLS>;
type TextStreamToolResultPart<TOOLS extends ToolSet> = {
    type: 'tool-result';
} & TypedToolResult<TOOLS>;
type TextStreamToolErrorPart<TOOLS extends ToolSet> = {
    type: 'tool-error';
} & TypedToolError<TOOLS>;
type TextStreamToolOutputDeniedPart<TOOLS extends ToolSet> = {
    type: 'tool-output-denied';
} & StaticToolOutputDenied<TOOLS>;
type TextStreamToolApprovalRequestPart<TOOLS extends ToolSet> = ToolApprovalRequestOutput<TOOLS>;
type TextStreamToolApprovalResponsePart<TOOLS extends ToolSet> = ToolApprovalResponseOutput<TOOLS>;
type TextStreamStartStepPart = {
    type: 'start-step';
    request: LanguageModelRequestMetadata;
    warnings: CallWarning[];
};
type TextStreamFinishStepPart = {
    type: 'finish-step';
    response: Omit<LanguageModelResponseMetadata, 'messages' | 'body'>;
    usage: LanguageModelUsage;
    performance: StepResultPerformance;
    finishReason: FinishReason;
    rawFinishReason: string | undefined;
    providerMetadata: ProviderMetadata | undefined;
};
type TextStreamStartPart = {
    type: 'start';
};
type TextStreamFinishPart = {
    type: 'finish';
    finishReason: FinishReason;
    rawFinishReason: string | undefined;
    totalUsage: LanguageModelUsage;
};
type TextStreamAbortPart = {
    type: 'abort';
    reason?: string;
};
type TextStreamErrorPart = {
    type: 'error';
    error: unknown;
};
type TextStreamRawPart = {
    type: 'raw';
    rawValue: unknown;
};
type TextStreamPart<TOOLS extends ToolSet> = TextStreamTextStartPart | TextStreamTextEndPart | TextStreamTextDeltaPart | TextStreamReasoningStartPart | TextStreamReasoningEndPart | TextStreamReasoningDeltaPart | TextStreamCustomPart | TextStreamToolInputStartPart | TextStreamToolInputEndPart | TextStreamToolInputDeltaPart | TextStreamSourcePart | TextStreamFilePart | TextStreamReasoningFilePart | TextStreamToolCallPart<TOOLS> | TextStreamToolResultPart<TOOLS> | TextStreamToolErrorPart<TOOLS> | TextStreamToolOutputDeniedPart<TOOLS> | TextStreamToolApprovalRequestPart<TOOLS> | TextStreamToolApprovalResponsePart<TOOLS> | TextStreamStartStepPart | TextStreamFinishStepPart | TextStreamStartPart | TextStreamFinishPart | TextStreamAbortPart | TextStreamErrorPart | TextStreamRawPart;

/**
 * The approval status of a tool configuration. This can be one of the following:
 *
 * - 'not-applicable': The tool does not require approval.
 * - 'approved': The tool is automatically approved.
 * - 'denied': The tool is automatically denied.
 * - 'user-approval': The tool requires user approval.
 *
 * In addition to the string statuses, you can also use object statuses with a reason property.
 *
 * `undefined` is treated as the `not-applicable` status.
 */
type ToolApprovalStatus = undefined | 'not-applicable' | 'approved' | 'denied' | 'user-approval' | {
    type: 'not-applicable';
    reason?: never;
} | {
    type: 'approved';
    reason?: string;
} | {
    type: 'denied';
    reason?: string;
} | {
    type: 'user-approval';
    reason?: never;
};
/**
 * Function that is called to determine if the tool needs approval before it can be executed.
 *
 * Return `undefined` for the same effect as the `not-applicable` status.
 */
type SingleToolApprovalFunction<INPUT, TOOL_CONTEXT extends Context | unknown | never, RUNTIME_CONTEXT extends Context | unknown | never> = (input: INPUT, options: Omit<ToolExecutionOptions<TOOL_CONTEXT>, 'abortSignal' | 'context'> & {
    toolContext: TOOL_CONTEXT;
    runtimeContext: RUNTIME_CONTEXT;
}) => MaybePromiseLike<ToolApprovalStatus>;
/**
 * Function that is called to determine if a tool call needs approval before it can be executed.
 *
 * Return `undefined` for the same effect as the `not-applicable` status.
 */
type GenericToolApprovalFunction<TOOLS extends ToolSet, TOOLS_CONTEXT extends InferToolSetContext<TOOLS>, RUNTIME_CONTEXT extends Context | unknown | never> = (options: {
    /**
     * The tool call that needs approval.
     */
    toolCall: TypedToolCall<TOOLS>;
    /**
     * All tools that are available for the model to call.
     */
    tools: TOOLS | undefined;
    /**
     * Tool context for all tools that are available for the model to call.
     */
    toolsContext: TOOLS_CONTEXT;
    /**
     * Runtime context.
     */
    runtimeContext: RUNTIME_CONTEXT;
    /**
     * Messages that were sent to the language model to initiate the response that contained the tool call.
     * The messages **do not** include the system prompt nor the assistant response that contained the tool call.
     */
    messages: ModelMessage[];
}) => MaybePromiseLike<ToolApprovalStatus>;
/**
 * Configure whether individual tools require approval before they can run.
 *
 * You can either use a generic function that is called for all tool calls,
 * or you can use a per-tool function.
 *
 * For the per-tool functions, each tool can be assigned either an approval status
 * or a function that produces an approval status at runtime.
 *
 * The approval status can be one of the following:
 * - 'not-applicable': The tool does not require approval.
 * - 'approved': The tool is automatically approved.
 * - 'denied': The tool is automatically denied.
 * - 'user-approval': The tool requires user approval.
 *
 * In addition to the string statuses, you can also use object statuses with a reason property.
 */
type ToolApprovalConfiguration<TOOLS extends ToolSet, RUNTIME_CONTEXT extends Context | unknown | never> = GenericToolApprovalFunction<TOOLS, InferToolSetContext<TOOLS>, RUNTIME_CONTEXT> | {
    [key in keyof TOOLS]?: ToolApprovalStatus | SingleToolApprovalFunction<InferToolInput<TOOLS[key]>, InferToolContext<TOOLS[key]>, RUNTIME_CONTEXT>;
};

declare const symbol$1: unique symbol;
declare class InvalidToolInputError extends AISDKError {
    private readonly [symbol$1];
    readonly toolName: string;
    readonly toolInput: string;
    constructor({ toolInput, toolName, cause, message, }: {
        message?: string;
        toolInput: string;
        toolName: string;
        cause: unknown;
    });
    static isInstance(error: unknown): error is InvalidToolInputError;
}

declare const symbol: unique symbol;
declare class NoSuchToolError extends AISDKError {
    private readonly [symbol];
    readonly toolName: string;
    readonly availableTools: string[] | undefined;
    constructor({ toolName, availableTools, message, }: {
        toolName: string;
        availableTools?: string[] | undefined;
        message?: string;
    });
    static isInstance(error: unknown): error is NoSuchToolError;
}

/**
 * A function that attempts to repair a tool call that failed to parse.
 *
 * It receives the error and the context as arguments and returns the repair
 * tool call JSON as text.
 *
 * @param options.instructions - The instructions provided to the model.
 * @param options.system - The instructions provided to the model.
 * @param options.messages - The messages in the current generation step.
 * @param options.toolCall - The tool call that failed to parse.
 * @param options.tools - The tools that are available.
 * @param options.inputSchema - A function that returns the JSON Schema for a tool.
 * @param options.error - The error that occurred while parsing the tool call.
 */
type ToolCallRepairFunction<TOOLS extends ToolSet> = (options: {
    instructions: Instructions | undefined;
    /**
     * @deprecated Use `instructions` instead.
     */
    system: Instructions | undefined;
    messages: ModelMessage[];
    toolCall: LanguageModelV4ToolCall;
    tools: TOOLS;
    inputSchema: (options: {
        toolName: string;
    }) => PromiseLike<JSONSchema7>;
    error: NoSuchToolError | InvalidToolInputError;
}) => Promise<LanguageModelV4ToolCall | null>;

type ToolOutput<TOOLS extends ToolSet> = TypedToolResult<TOOLS> | TypedToolError<TOOLS>;

/**
 * Resolves a single tool's context type, falling back to `undefined` when the
 * tool does not declare a `contextSchema`.
 */
type ToolContextFor<TOOL extends ToolSet[keyof ToolSet]> = [
    InferToolContext<TOOL>
] extends [never] ? undefined : InferToolContext<TOOL>;
type BaseToolExecutionStartFields = {
    /** Unique identifier for this generation call, used to correlate events. */
    readonly callId: string;
    /**
     * Messages that were sent to the language model to initiate the response that contained the tool call.
     * The messages **do not** include the system prompt nor the assistant response that contained the tool call.
     */
    readonly messages: ModelMessage[];
};
/**
 * Precise start event union for statically known tools.
 *
 * Each union member ties a specific `toolCall.toolName` to that tool's
 * validated `toolContext` type.
 */
type StaticToolExecutionStartEvent<TOOLS extends ToolSet> = ValueOf<{
    [NAME in keyof TOOLS]: BaseToolExecutionStartFields & {
        readonly toolCall: Extract<StaticToolCall<TOOLS>, {
            toolName: NAME;
        }>;
        readonly toolContext: ToolContextFor<TOOLS[NAME]>;
    };
}>;
/**
 * Start event shape for dynamic or untyped tool calls.
 */
type DynamicToolExecutionStartEvent = BaseToolExecutionStartFields & {
    readonly toolCall: DynamicToolCall;
    readonly toolContext: unknown;
};
/**
 * Broad start event shape used for the default `ToolSet` specialization.
 *
 * This keeps generic collectors ergonomic when the caller is not working with
 * a concrete tool set and therefore cannot benefit from per-tool narrowing.
 */
type WidenedToolExecutionStartEvent = BaseToolExecutionStartFields & {
    readonly toolCall: StaticToolCall<ToolSet> | DynamicToolCall;
    readonly toolContext: unknown;
};
/**
 * Event passed to the `onToolExecutionStart` callback.
 *
 * Called when a tool execution begins, before the tool's `execute` function is invoked.
 */
type ToolExecutionStartEvent<TOOLS extends ToolSet = ToolSet> = [
    ToolSet
] extends [TOOLS] ? WidenedToolExecutionStartEvent : StaticToolExecutionStartEvent<TOOLS> | DynamicToolExecutionStartEvent;
type BaseToolExecutionEndFields = {
    /** Unique identifier for this generation call, used to correlate events. */
    readonly callId: string;
    /** Execution time of the tool call in milliseconds. */
    readonly toolExecutionMs: number;
    /**
     * Messages that were sent to the language model to initiate the response that contained the tool call.
     * The messages **do not** include the system prompt nor the assistant response that contained the tool call.
     */
    readonly messages: ModelMessage[];
};
/**
 * Precise end event union for statically known tools.
 *
 * Each union member preserves the link between `toolCall.toolName`, the
 * corresponding validated `toolContext`, and the tool execution result.
 */
type StaticToolExecutionEndEvent<TOOLS extends ToolSet> = ValueOf<{
    [NAME in keyof TOOLS]: BaseToolExecutionEndFields & {
        readonly toolCall: Extract<StaticToolCall<TOOLS>, {
            toolName: NAME;
        }>;
        readonly toolContext: ToolContextFor<TOOLS[NAME]>;
        readonly toolOutput: ToolOutput<TOOLS>;
    };
}>;
/**
 * End event shape for dynamic or untyped tool calls.
 */
type DynamicToolExecutionEndEvent<TOOLS extends ToolSet> = BaseToolExecutionEndFields & {
    readonly toolCall: DynamicToolCall;
    readonly toolContext: unknown;
    readonly toolOutput: ToolOutput<TOOLS>;
};
/**
 * Broad end event shape used for the default `ToolSet` specialization.
 *
 * This provides an assignable catch-all event type for generic consumers while
 * the concrete-tool specialization retains full per-tool narrowing.
 */
type WidenedToolExecutionEndEvent = BaseToolExecutionEndFields & {
    readonly toolCall: StaticToolCall<ToolSet> | DynamicToolCall;
    readonly toolContext: unknown;
    readonly toolOutput: ToolOutput<ToolSet>;
};
/**
 * Event passed to the `onToolExecutionEnd` callback.
 *
 * Called when a tool execution completes, either successfully or with an error.
 * Uses the `toolOutput.type` discriminator to distinguish success and error.
 */
type ToolExecutionEndEvent<TOOLS extends ToolSet = ToolSet> = [
    ToolSet
] extends [TOOLS] ? WidenedToolExecutionEndEvent : StaticToolExecutionEndEvent<TOOLS> | DynamicToolExecutionEndEvent<TOOLS>;
/**
 * Callback that is set using the `onToolExecutionStart` option.
 *
 * Called when a tool execution begins, before the tool's `execute` function is invoked.
 * Use this for logging tool invocations, tracking tool usage, or pre-execution validation.
 *
 * @param event - The event object containing tool call information.
 */
type OnToolExecutionStartCallback<TOOLS extends ToolSet = ToolSet> = Callback<ToolExecutionStartEvent<TOOLS>>;
/**
 * Callback that is set using the `onToolExecutionEnd` option.
 *
 * Called when a tool execution completes, either successfully or with an error.
 * Use this for logging tool results, tracking execution time, or error handling.
 *
 * The event uses a discriminated union on `toolOutput.type`:
 * - When `toolOutput.type === 'tool-result'`: `toolOutput.output` contains the tool result.
 * - When `toolOutput.type === 'tool-error'`: `toolOutput.error` contains the error.
 *
 * @param event - The event object containing tool call result information.
 */
type OnToolExecutionEndCallback<TOOLS extends ToolSet = ToolSet> = Callback<ToolExecutionEndEvent<TOOLS>>;

/**
 * Mapping of tool names to functions that refine parsed tool inputs.
 *
 * Each refinement function receives the typed input for its tool and must return
 * an input with the same type shape. Refined inputs are used for tool execution,
 * output parts, lifecycle callbacks, and telemetry.
 */
type ToolInputRefinement<TOOLS extends ToolSet> = {
    [NAME in keyof TOOLS]?: (input: InferToolInput<TOOLS[NAME]>) => MaybePromiseLike<InferToolInput<TOOLS[NAME]>>;
};

type EnrichedStreamPart<TOOLS extends ToolSet, PARTIAL_OUTPUT> = {
    part: TextStreamPart<TOOLS>;
    partialOutput: PARTIAL_OUTPUT | undefined;
};

interface Output<OUTPUT = any, PARTIAL = any, ELEMENT = any> {
    /**
     * The name of the output mode.
     */
    name: string;
    /**
     * The response format to use for the model.
     */
    responseFormat: PromiseLike<LanguageModelV4CallOptions['responseFormat']>;
    /**
     * Parses the complete output of the model.
     */
    parseCompleteOutput(options: {
        text: string;
    }, context: {
        response: Omit<LanguageModelResponseMetadata, 'messages' | 'body'>;
        usage: LanguageModelUsage;
        finishReason: FinishReason;
    }): Promise<OUTPUT>;
    /**
     * Parses the partial output of the model.
     */
    parsePartialOutput(options: {
        text: string;
    }): Promise<{
        partial: PARTIAL;
    } | undefined>;
    /**
     * Creates a stream transform that emits individual elements as they complete.
     */
    createElementStreamTransform(): TransformStream<EnrichedStreamPart<any, PARTIAL>, ELEMENT> | undefined;
}

/**
 * Event passed to the `onStart` callback.
 *
 * Called when the generation operation begins, before any LLM calls.
 */
type GenerateTextStartEvent<TOOLS extends ToolSet = ToolSet, RUNTIME_CONTEXT extends Context = Context, OUTPUT extends Output = Output> = {
    /** Unique identifier for this generation call, used to correlate events. */
    readonly callId: string;
    /** Identifies the operation type (e.g. 'ai.generateText' or 'ai.streamText'). */
    readonly operationId: string;
    /** The provider identifier (e.g., 'openai', 'anthropic'). */
    readonly provider: string;
    /** The specific model identifier (e.g., 'gpt-4o'). */
    readonly modelId: string;
    /** The tools available for this generation. */
    readonly tools: TOOLS | undefined;
    /** The tool choice strategy for this generation. */
    readonly toolChoice: ToolChoice<NoInfer<TOOLS>> | undefined;
    /** Limits which tools are available for the model to call. */
    readonly activeTools: ActiveTools<TOOLS>;
    /** Controls the order in which tools are sent to the provider. */
    readonly toolOrder: ToolOrder<TOOLS>;
    /** Maximum number of retries for failed requests. */
    readonly maxRetries: number;
    /**
     * Timeout configuration for the generation.
     * Can be a number (milliseconds) or an object with totalMs, stepMs,
     * firstChunkMs (streaming only), chunkMs, toolMs, and per-tool overrides via tools.
     */
    readonly timeout: TimeoutConfiguration<TOOLS> | undefined;
    /** Additional HTTP headers sent with the request. */
    readonly headers: Record<string, string | undefined> | undefined;
    /** Additional provider-specific options. */
    readonly providerOptions: ProviderOptions | undefined;
    /** The output specification for structured outputs, if configured. */
    readonly output: OUTPUT | undefined;
    /**
     * Tool context.
     */
    readonly toolsContext: InferToolSetContext<TOOLS>;
    /**
     * User-defined runtime context.
     */
    readonly runtimeContext: RUNTIME_CONTEXT;
} & LanguageModelCallOptions & StandardizedPrompt;
/**
 * Event passed to the `onStepStart` callback.
 *
 * Called when a step (LLM call) begins, before the provider is called.
 * Each step represents a single LLM invocation.
 */
type GenerateTextStepStartEvent<TOOLS extends ToolSet = ToolSet, RUNTIME_CONTEXT extends Context = Context, OUTPUT extends Output = Output> = {
    /** Unique identifier for this generation call, used to correlate events. */
    readonly callId: string;
    /** The provider identifier (e.g., 'openai', 'anthropic'). */
    readonly provider: string;
    /** The specific model identifier (e.g., 'gpt-4o'). */
    readonly modelId: string;
    /** Zero-based index of the current step. */
    readonly stepNumber: number;
    /** The tools available for this generation. */
    readonly tools: TOOLS | undefined;
    /** The tool choice configuration for this step. */
    readonly toolChoice: ToolChoice<NoInfer<TOOLS>> | undefined;
    /** Limits which tools are available for this step. */
    readonly activeTools: ActiveTools<TOOLS>;
    /** Controls the order in which tools are sent to the provider for this step. */
    readonly toolOrder: ToolOrder<TOOLS>;
    /** Array of results from previous steps (empty for first step). */
    readonly steps: ReadonlyArray<StepResult<TOOLS, RUNTIME_CONTEXT>>;
    /** Additional provider-specific options for this step. */
    readonly providerOptions: ProviderOptions | undefined;
    /** The output specification for structured outputs, if configured. */
    readonly output: OUTPUT | undefined;
    /**
     * Runtime context. May be updated from `prepareStep` between steps.
     */
    readonly runtimeContext: RUNTIME_CONTEXT;
    /**
     * Tool context. May be updated from `prepareStep` between steps.
     */
    readonly toolsContext: InferToolSetContext<TOOLS>;
} & StandardizedPrompt;
/**
 * Event passed to the `onStepEnd` callback.
 *
 * Called when a step (LLM call) completes.
 * Includes the StepResult for that step along with the call identifier.
 */
type GenerateTextStepEndEvent<TOOLS extends ToolSet = ToolSet, RUNTIME_CONTEXT extends Context = Context> = StepResult<TOOLS, RUNTIME_CONTEXT>;
/**
 * Event passed to the `onEnd` callback.
 *
 * Called when the entire generation completes (all steps finished).
 * Includes the final step's result along with aggregated data from all steps.
 */
type GenerateTextEndEvent<TOOLS extends ToolSet = ToolSet, RUNTIME_CONTEXT extends Context = Context> = {
    /** Unique identifier for this generation call, used to correlate events. */
    readonly callId: string;
    /** Zero-based index of the final step. */
    readonly stepNumber: number;
    /** Information about the model that produced the final step. */
    readonly model: StepResult<TOOLS, RUNTIME_CONTEXT>['model'];
    /**
     * Tool context from the final step.
     *
     * @deprecated Use `finalStep.toolsContext` instead.
     */
    readonly toolsContext: InferToolSetContext<TOOLS>;
    /**
     * Runtime context from the final step.
     *
     * @deprecated Use `finalStep.runtimeContext` instead.
     */
    readonly runtimeContext: RUNTIME_CONTEXT;
    /** The content that was generated in all steps. */
    readonly content: StepResult<TOOLS, RUNTIME_CONTEXT>['content'];
    /** The text that was generated in the final step. */
    readonly text: StepResult<TOOLS, RUNTIME_CONTEXT>['text'];
    /**
     * The reasoning that was generated in the final step.
     *
     * @deprecated Use `finalStep.reasoning` instead.
     */
    readonly reasoning: StepResult<TOOLS, RUNTIME_CONTEXT>['reasoning'];
    /**
     * The reasoning text that was generated in the final step.
     *
     * @deprecated Use `finalStep.reasoningText` instead.
     */
    readonly reasoningText: StepResult<TOOLS, RUNTIME_CONTEXT>['reasoningText'];
    /** Files that were generated in all steps. */
    readonly files: StepResult<TOOLS, RUNTIME_CONTEXT>['files'];
    /** Sources that were used as references in all steps. */
    readonly sources: StepResult<TOOLS, RUNTIME_CONTEXT>['sources'];
    /** Tool calls that were made in all steps. */
    readonly toolCalls: StepResult<TOOLS, RUNTIME_CONTEXT>['toolCalls'];
    /** Static tool calls that were made in all steps. */
    readonly staticToolCalls: StepResult<TOOLS, RUNTIME_CONTEXT>['staticToolCalls'];
    /** Dynamic tool calls that were made in all steps. */
    readonly dynamicToolCalls: StepResult<TOOLS, RUNTIME_CONTEXT>['dynamicToolCalls'];
    /** Tool results that were generated in all steps. */
    readonly toolResults: StepResult<TOOLS, RUNTIME_CONTEXT>['toolResults'];
    /** Static tool results that were generated in all steps. */
    readonly staticToolResults: StepResult<TOOLS, RUNTIME_CONTEXT>['staticToolResults'];
    /** Dynamic tool results that were generated in all steps. */
    readonly dynamicToolResults: StepResult<TOOLS, RUNTIME_CONTEXT>['dynamicToolResults'];
    /** The unified reason why the generation finished. Taken from the final step. */
    readonly finishReason: StepResult<TOOLS, RUNTIME_CONTEXT>['finishReason'];
    /** The raw reason why the generation finished. Taken from the final step. */
    readonly rawFinishReason: StepResult<TOOLS, RUNTIME_CONTEXT>['rawFinishReason'];
    /** Aggregated token usage across all steps. */
    readonly usage: LanguageModelUsage;
    /**
     * Aggregated token usage across all steps.
     *
     * @deprecated Use `usage` instead.
     */
    readonly totalUsage: LanguageModelUsage;
    /** Warnings from the model provider in all steps. */
    readonly warnings: StepResult<TOOLS, RUNTIME_CONTEXT>['warnings'];
    /**
     * Additional request information from the final step.
     *
     * @deprecated Use `finalStep.request` instead.
     */
    readonly request: StepResult<TOOLS, RUNTIME_CONTEXT>['request'];
    /**
     * Additional response information from the final step.
     *
     * @deprecated Use `finalStep.response` instead.
     */
    readonly response: StepResult<TOOLS, RUNTIME_CONTEXT>['response'];
    /**
     * Additional provider-specific metadata from the final step.
     *
     * @deprecated Use `finalStep.providerMetadata` instead.
     */
    readonly providerMetadata: StepResult<TOOLS, RUNTIME_CONTEXT>['providerMetadata'];
    /** The response messages that were generated during the call. */
    readonly responseMessages: ResponseMessage[];
    /** Array containing results from all steps in the generation. */
    readonly steps: StepResult<TOOLS, RUNTIME_CONTEXT>[];
    /** The final step. This is a shortcut for `steps.at(-1)`. */
    readonly finalStep: StepResult<TOOLS, RUNTIME_CONTEXT>;
};
/**
 * Event passed to the telemetry `onAbort` callback.
 *
 * Called when a streaming text generation operation is aborted before it
 * completes.
 */
type GenerateTextAbortEvent<TOOLS extends ToolSet = ToolSet, RUNTIME_CONTEXT extends Context = Context> = {
    /** Unique identifier for this generation call, used to correlate events. */
    readonly callId: string;
    /** Details for all previously finished steps. */
    readonly steps: StepResult<TOOLS, RUNTIME_CONTEXT>[];
    /** The abort reason from the AbortSignal, when one is available. */
    readonly reason?: unknown;
};
/**
 * Callback that is set using the `onStart` option.
 *
 * Called when the generateText operation begins, before any LLM calls.
 * Use this callback for logging, analytics, or initializing state at the
 * start of a generation.
 *
 * @param event - The event object containing generation configuration.
 */
type GenerateTextOnStartCallback<TOOLS extends ToolSet = ToolSet, RUNTIME_CONTEXT extends Context = Context, OUTPUT extends Output = Output> = Callback<GenerateTextStartEvent<TOOLS, RUNTIME_CONTEXT, OUTPUT>>;
/**
 * Callback that is set using the `onStepStart` option.
 *
 * Called when a step (LLM call) begins, before the provider is called.
 * Each step represents a single LLM invocation. Multiple steps occur when
 * using tool calls (the model may be called multiple times in a loop).
 *
 * @param event - The event object containing step configuration.
 */
type GenerateTextOnStepStartCallback<TOOLS extends ToolSet = ToolSet, RUNTIME_CONTEXT extends Context = Context, OUTPUT extends Output = Output> = Callback<GenerateTextStepStartEvent<TOOLS, RUNTIME_CONTEXT, OUTPUT>>;
/**
 * Callback that is set using the `onStepEnd` option.
 *
 * Called when a step (LLM call) completes. The event includes all step result
 * properties (text, tool calls, usage, etc.) along with additional metadata.
 *
 * @param stepResult - The result of the step.
 */
type GenerateTextOnStepEndCallback<TOOLS extends ToolSet = ToolSet, RUNTIME_CONTEXT extends Context = Context> = Callback<GenerateTextStepEndEvent<TOOLS, RUNTIME_CONTEXT>>;
/**
 * Callback that is set using the `onStepFinish` option.
 *
 * @deprecated Use `GenerateTextOnStepEndCallback` instead.
 */
type GenerateTextOnStepFinishCallback<TOOLS extends ToolSet = ToolSet, RUNTIME_CONTEXT extends Context = Context> = GenerateTextOnStepEndCallback<TOOLS, RUNTIME_CONTEXT>;
/**
 * Callback that is set using the `onEnd` option.
 *
 * Called when the entire generation completes (all steps finished).
 * The event includes the final step's result properties along with
 * aggregated data from all steps.
 *
 * @param event - The final result along with aggregated step data.
 */
type GenerateTextOnEndCallback<TOOLS extends ToolSet = ToolSet, RUNTIME_CONTEXT extends Context = Context> = Callback<GenerateTextEndEvent<TOOLS, RUNTIME_CONTEXT>>;
/**
 * Callback that is set using the telemetry `onAbort` option.
 *
 * Called when a streaming text generation operation is aborted before it
 * completes.
 *
 * @param event - The abort event, including finished steps and abort reason.
 */
type GenerateTextOnAbortCallback<TOOLS extends ToolSet = ToolSet, RUNTIME_CONTEXT extends Context = Context> = Callback<GenerateTextAbortEvent<TOOLS, RUNTIME_CONTEXT>>;

/**
 * Event passed to the `onStart` callback for rerank operations.
 *
 * Called when the operation begins, before the reranking model is called.
 */
type RerankStartEvent = {
    /** Unique identifier for this rerank call, used to correlate events. */
    readonly callId: string;
    /** Identifies the operation type ('ai.rerank'). */
    readonly operationId: string;
    readonly provider: string;
    /** The specific model identifier (e.g., 'gpt-4o'). */
    readonly modelId: string;
    /** The documents being reranked. */
    readonly documents: Array<JSONObject | string>;
    /** The query to rerank the documents against. */
    readonly query: string;
    /** Number of top documents to return. */
    readonly topN: number | undefined;
    /** Maximum number of retries for failed requests. */
    readonly maxRetries: number;
    /** Additional HTTP headers sent with the request. */
    readonly headers: Record<string, string | undefined> | undefined;
    /** Additional provider-specific options. */
    readonly providerOptions: ProviderOptions | undefined;
};
/**
 * Event passed to the `onEnd` callback for rerank operations.
 *
 * Called when the operation completes, after the reranking model returns.
 */
type RerankEndEvent = {
    /** Unique identifier for this rerank call, used to correlate events. */
    readonly callId: string;
    /** Identifies the operation type ('ai.rerank'). */
    readonly operationId: string;
    readonly provider: string;
    /** The specific model identifier (e.g., 'gpt-4o'). */
    readonly modelId: string;
    /** The documents that were reranked. */
    readonly documents: Array<JSONObject | string>;
    /** The query that documents were reranked against. */
    readonly query: string;
    /** The reranked results sorted by relevance score in descending order. */
    readonly ranking: Array<{
        originalIndex: number;
        score: number;
        document: JSONObject | string;
    }>;
    /** Warnings from the reranking model. */
    readonly warnings: Array<Warning>;
    /** Optional provider-specific metadata. */
    readonly providerMetadata: ProviderMetadata | undefined;
    /** Response data including headers and body. */
    readonly response: {
        id?: string;
        timestamp: Date;
        modelId: string;
        headers?: Record<string, string>;
        body?: unknown;
    };
};
/**
 * Event fired when an individual reranking model call (inner doRerank) begins.
 */
type RerankingModelCallStartEvent = {
    /** Unique identifier for this rerank call, used to correlate events. */
    readonly callId: string;
    /** Identifies the inner operation ('ai.rerank.doRerank'). */
    readonly operationId: string;
    /** The provider identifier. */
    readonly provider: string;
    /** The specific model identifier. */
    readonly modelId: string;
    /** The documents being reranked. */
    readonly documents: Array<JSONObject | string>;
    /** The type of documents ('text' or 'object'). */
    readonly documentsType: string;
    /** The query to rerank against. */
    readonly query: string;
    /** Number of top documents to return. */
    readonly topN: number | undefined;
};
/**
 * Event fired when an individual reranking model call (doRerank) completes.
 *
 * Contains the ranking results from the model response.
 */
type RerankingModelCallEndEvent = {
    /** Unique identifier for this rerank call, used to correlate events. */
    readonly callId: string;
    /** Identifies the inner operation ('ai.rerank.doRerank'). */
    readonly operationId: string;
    /** The provider identifier. */
    readonly provider: string;
    /** The specific model identifier. */
    readonly modelId: string;
    /** The type of documents ('text' or 'object'). */
    readonly documentsType: string;
    /** The ranking results from the model. */
    readonly ranking: Array<{
        index: number;
        relevanceScore: number;
    }>;
};

type TelemetryTracingEventType = 'generateText' | 'streamText' | 'step' | 'languageModelCall' | 'executeTool' | 'embed' | 'embedMany' | 'rerank';

type TracingChannelContext = {
    run<T>(execute: () => T): T;
};

type InferTelemetryEvent<EVENT> = EVENT & Omit<TelemetryOptions, 'integrations' | 'isEnabled' | 'includeRuntimeContext'>;
type OperationStartEvent = GenerateTextStartEvent | GenerateObjectStartEvent | EmbedStartEvent | RerankStartEvent;
type OperationEndEvent = GenerateTextEndEvent<ToolSet> | GenerateObjectEndEvent<unknown> | EmbedEndEvent | RerankEndEvent;
interface TelemetryDispatcher {
    /**
     * Runs awaited work inside a diagnostics-channel tracing span.
     */
    runInTracingChannelSpan?: <T>(options: {
        type: TelemetryTracingEventType;
        event: unknown;
        execute: () => PromiseLike<T>;
    }) => Promise<T>;
    /**
     * Opens a tracing span context whose completion is observed separately.
     * This is used by streamed operations that must preserve stream timing while
     * still creating child spans with the correct parent.
     */
    startTracingChannelContext?: (options: {
        type: TelemetryTracingEventType;
        event: unknown;
        completion: PromiseLike<unknown>;
    }) => TracingChannelContext | undefined;
    onStart?: Callback<OperationStartEvent>;
    onStepStart?: Callback<GenerateTextStepStartEvent>;
    onLanguageModelCallStart?: OnLanguageModelCallStartCallback;
    onLanguageModelCallEnd?: OnLanguageModelCallEndCallback;
    onToolExecutionStart?: Callback<ToolExecutionStartEvent>;
    onToolExecutionEnd?: Callback<ToolExecutionEndEvent>;
    onStepEnd?: Callback<GenerateTextStepEndEvent>;
    /** @deprecated Use `onStepEnd` instead. */
    onStepFinish?: Callback<GenerateTextStepEndEvent>;
    onObjectStepStart?: Callback<GenerateObjectStepStartEvent>;
    onObjectStepEnd?: Callback<GenerateObjectStepEndEvent>;
    onEmbedStart?: Callback<EmbeddingModelCallStartEvent>;
    onEmbedEnd?: Callback<EmbeddingModelCallEndEvent>;
    onRerankStart?: Callback<RerankingModelCallStartEvent>;
    onRerankEnd?: Callback<RerankingModelCallEndEvent>;
    onEnd?: Callback<OperationEndEvent>;
    onAbort?: Callback<GenerateTextAbortEvent<ToolSet>>;
    onError?: Callback<unknown>;
    executeLanguageModelCall?: Telemetry['executeLanguageModelCall'];
    executeTool?: Telemetry['executeTool'];
}
/**
 * Implement this interface to create custom telemetry integrations.
 * Methods can be sync or return a PromiseLike.
 */
interface Telemetry {
    /**
     * Called when an operation begins. Fired for text generation
     * (generateText/streamText), object generation (generateObject/streamObject),
     * embedding (embed/embedMany), and reranking operations.
     *
     * Use the `operationId` field to distinguish between operation types.
     */
    onStart?: Callback<InferTelemetryEvent<OperationStartEvent>>;
    /**
     * Called when an individual step (single LLM invocation) begins.
     * A generation may consist of multiple steps (e.g. when tool calls trigger
     * follow-up LLM calls). Use this to create per-step spans or record
     * step-level inputs.
     *
     * The event includes the step number, accumulated previous step results,
     * and the messages that will be sent to the model.
     */
    onStepStart?: Callback<InferTelemetryEvent<GenerateTextStepStartEvent>>;
    /**
     * Called immediately before the provider model call begins.
     * Unlike `onStepStart`, this callback is scoped to model work only and
     * excludes any later client-side tool execution.
     */
    onLanguageModelCallStart?: Callback<InferTelemetryEvent<LanguageModelCallStartEvent>>;
    /**
     * Called after the model response has been normalized and parsed, but before
     * any client-side tool execution begins.
     */
    onLanguageModelCallEnd?: Callback<InferTelemetryEvent<LanguageModelCallEndEvent>>;
    /**
     * Called when a tool execution begins, before the tool's `execute` function
     * is invoked. Use this to create tool-level spans or log tool invocations.
     */
    onToolExecutionStart?: Callback<InferTelemetryEvent<ToolExecutionStartEvent>>;
    /**
     * Called when a tool execution completes, either successfully or with an error.
     * The event uses a discriminated union on the `success` field — check
     * `event.success` to determine whether `output` or `error` is available.
     *
     * The event includes execution time (`toolExecutionMs`) for performance tracking.
     */
    onToolExecutionEnd?: Callback<InferTelemetryEvent<ToolExecutionEndEvent>>;
    /**
     * Called when an individual step (single LLM invocation) completes.
     * The event is a `StepResult` containing the model's response, tool calls
     * and results, usage statistics, finish reason, and optional request/response
     * bodies.
     */
    onStepEnd?: Callback<InferTelemetryEvent<GenerateTextStepEndEvent>>;
    /**
     * Called when an individual step (single LLM invocation) completes.
     *
     * @deprecated Use `onStepEnd` instead.
     */
    onStepFinish?: Callback<InferTelemetryEvent<GenerateTextStepEndEvent>>;
    /**
     * Called when an object generation step (single LLM invocation) begins.
     * For generateObject/streamObject there is always exactly one step.
     *
     * @deprecated
     */
    onObjectStepStart?: Callback<InferTelemetryEvent<GenerateObjectStepStartEvent>>;
    /**
     * Called when an object generation step (single LLM invocation) completes,
     * with the raw result before JSON parsing and schema validation.
     *
     * @deprecated
     */
    onObjectStepEnd?: Callback<InferTelemetryEvent<GenerateObjectStepEndEvent>>;
    /**
     * Called when an individual embedding model call (doEmbed) begins.
     * For `embed`, there is one call. For `embedMany`, there may be multiple
     * calls when values are chunked.
     */
    onEmbedStart?: Callback<InferTelemetryEvent<EmbeddingModelCallStartEvent>>;
    /**
     * Called when an individual embedding model call (doEmbed) completes.
     * Contains the embeddings, usage, and any warnings from the model response.
     */
    onEmbedEnd?: Callback<InferTelemetryEvent<EmbeddingModelCallEndEvent>>;
    /**
     * Called when an individual reranking model call (doRerank) begins.
     * There is one call per `rerank` invocation.
     */
    onRerankStart?: Callback<InferTelemetryEvent<RerankingModelCallStartEvent>>;
    /**
     * Called when an individual reranking model call (doRerank) completes.
     * Contains the ranking results from the model response.
     */
    onRerankEnd?: Callback<InferTelemetryEvent<RerankingModelCallEndEvent>>;
    /**
     * Called when an operation completes. Fired for text generation
     * (generateText/streamText), object generation (generateObject/streamObject),
     * embedding (embed/embedMany), and reranking operations.
     *
     * Use the event shape or `operationId` to distinguish between operation types.
     */
    onEnd?: Callback<InferTelemetryEvent<OperationEndEvent>>;
    /**
     * Called when a streaming text generation operation is aborted before it
     * completes.
     */
    onAbort?: Callback<InferTelemetryEvent<GenerateTextAbortEvent<ToolSet>>>;
    /**
     * Called when an unrecoverable error occurs during the generation lifecycle.
     * The error value is untyped — it may be an `Error` instance, an `AISDKError`,
     * or any thrown value.
     *
     * Use this to record error details on telemetry spans and set error status.
     */
    onError?: Callback<unknown>;
    /**
     * Optionally runs the language model call in a telemetry-integration-specific context. This enables
     * auto-instrumented model provider requests to become children of the current
     * model-call span.
     *
     * The options carry the model-call start-event content as context (the event
     * fields are optional), alongside the always-present `callId` and the
     * `execute` function that performs the model call.
     */
    executeLanguageModelCall?: <T>(options: Partial<InferTelemetryEvent<LanguageModelCallStartEvent>> & {
        callId: string;
        execute: () => PromiseLike<T>;
    }) => PromiseLike<T>;
    /**
     * Optionally runs the tool execute function in a telemetry-integration-specific context. This enables
     * nested traces — e.g. when a tool's `execute` function calls `generateText`,
     * the inner call's spans become children of the tool span.
     *
     * The options carry the tool-execution start-event content as context (the
     * event fields are optional), alongside the always-present `callId`,
     * `toolCallId`, and the `execute` function to run.
     */
    executeTool?: <T>(options: Partial<InferTelemetryEvent<ToolExecutionStartEvent>> & {
        callId: string;
        toolCallId: string;
        execute: () => PromiseLike<T>;
    }) => PromiseLike<T>;
}

declare global {
    /**
     * The default provider to use for the AI SDK.
     * String model ids are resolved to the default provider and model id.
     *
     * If not set, the default provider is the Vercel AI gateway provider.
     *
     * @see https://ai-sdk.dev/docs/ai-sdk-core/provider-management#global-provider-configuration
     */
    var AI_SDK_DEFAULT_PROVIDER: ProviderV4 | ProviderV3 | ProviderV2 | undefined;
    /**
     * The warning logger to use for the AI SDK.
     *
     * If not set, the default logger is the console.warn function.
     *
     * If set to false, no warnings are logged.
     */
    var AI_SDK_LOG_WARNINGS: LogWarningsFunction | undefined | false;
    /**
     * Globally registered telemetry integrations for the AI SDK.
     *
     * Integrations registered here receive lifecycle events (onStart, onStepStart,
     * etc.) from every `generateText`, `streamText`, and similar call.
     *
     * Prefer using `registerTelemetry()` from `'ai'` instead of
     * assigning this directly.
     */
    var AI_SDK_TELEMETRY_INTEGRATIONS: Telemetry[] | undefined;
}

declare function convertToLanguageModelPrompt({ prompt, supportedUrls, download, provider, }: {
    prompt: StandardizedPrompt;
    supportedUrls: Record<string, RegExp[]>;
    download: DownloadFunction | undefined;
    provider?: string;
}): Promise<LanguageModelV4Prompt>;
/**
 * Downloads files from URLs in the user messages.
 */
declare function downloadAssets(messages: ModelMessage[], download: DownloadFunction, supportedUrls: Record<string, RegExp[]>): Promise<Record<string, {
    mediaType: string | undefined;
    data: Uint8Array;
}>>;
declare function mapToolResultOutput({ output, provider, warnings, downloadedAssets, }: {
    output: ToolResultOutput;
    provider?: string;
    warnings?: Warning[];
    downloadedAssets: Record<string, {
        mediaType: string | undefined;
        data: Uint8Array;
    }>;
}): LanguageModelV4ToolResultOutput;

declare function createToolModelOutput({ toolCallId, input, output, tool, errorMode, }: {
    toolCallId: string;
    input: unknown;
    output: unknown;
    tool: Tool | undefined;
    errorMode: 'none' | 'text' | 'json';
}): Promise<ToolResultOutput>;

declare function prepareToolChoice({ toolChoice, }: {
    toolChoice: ToolChoice<any> | undefined;
}): LanguageModelV4ToolChoice;

declare function prepareTools<TOOLS extends ToolSet>({ tools, toolOrder, toolsContext, experimental_sandbox: sandbox, }: {
    tools: TOOLS | undefined;
    toolOrder?: ToolOrder<TOOLS>;
    toolsContext?: InferToolSetContext<TOOLS>;
    experimental_sandbox?: Experimental_SandboxSession;
}): Promise<Array<LanguageModelV4FunctionTool | LanguageModelV4ProviderTool> | undefined>;

/**
 * Validates model call options and returns a new object with normalized values.
 */
declare function prepareLanguageModelCallOptions({ maxOutputTokens, temperature, topP, topK, presencePenalty, frequencyPenalty, seed, stopSequences, reasoning, }: LanguageModelCallOptions): LanguageModelCallOptions;

/**
 * Validate and prepare retries.
 */
declare function prepareRetries({ maxRetries, abortSignal, }: {
    maxRetries: number | undefined;
    abortSignal: AbortSignal | undefined;
}): {
    maxRetries: number;
    retry: RetryFunction;
};

declare function resolveLanguageModel(model: LanguageModel): LanguageModelV4;

/**
 * Merges multiple abort sources into a single `AbortSignal`.
 * The returned signal will abort when any input signal aborts or when any
 * numeric timeout elapses, using the reason from the first source to abort.
 *
 * @param signals - Abort signals or timeout durations in milliseconds.
 * `null` and `undefined` values are ignored.
 * @returns An `AbortSignal` that aborts when any valid source aborts,
 * or `undefined` if no valid sources are provided.
 */
declare function mergeAbortSignals(...signals: (AbortSignal | null | undefined | number)[]): AbortSignal | undefined;

/**
 * Creates an async callback that invokes the provided callbacks in parallel.
 * Undefined callbacks are skipped, and thrown or rejected callback errors are
 * ignored.
 *
 * @param callbacks The callbacks to invoke for each event.
 * @returns A callback that forwards each event to all callbacks and waits for
 * them to settle.
 */
declare function mergeCallbacks<EVENT>(...callbacks: Array<Callback<EVENT> | undefined>): Callback<EVENT>;

/**
 * Creates a telemetry dispatcher that sends telemetry events
 * to the resolved set of integrations.
 *
 * When per-call integrations are provided, they take precedence over the globally
 * registered integrations for that call. When no per-call integrations are
 * provided, the globally registered integrations are used.
 *
 * @param args.telemetry - Optional per-call telemetry settings and integrations.
 *
 * @returns A telemetry dispatcher that fans out lifecycle events to the
 * resolved set of integrations.
 */
declare function createTelemetryDispatcher({ telemetry, }: {
    telemetry?: TelemetryOptions;
}): TelemetryDispatcher;

/**
 * Telemetry dispatcher for text generation with callbacks typed to the
 * operation-specific tool set, runtime context, and output shape.
 */
type RestrictedTelemetryDispatcher<TOOLS extends ToolSet, RUNTIME_CONTEXT extends Context, OUTPUT extends Output> = Omit<TelemetryDispatcher, 'onStart' | 'onStepStart' | 'onStepEnd' | 'onStepFinish' | 'onEnd' | 'onAbort' | 'onToolExecutionStart' | 'onToolExecutionEnd'> & {
    onStart: GenerateTextOnStartCallback<TOOLS, RUNTIME_CONTEXT, OUTPUT>;
    onStepStart: GenerateTextOnStepStartCallback<TOOLS, RUNTIME_CONTEXT, OUTPUT>;
    onStepEnd: GenerateTextOnStepEndCallback<TOOLS, RUNTIME_CONTEXT>;
    /** @deprecated Use `onStepEnd` instead. */
    onStepFinish: GenerateTextOnStepFinishCallback<TOOLS, RUNTIME_CONTEXT>;
    onEnd: GenerateTextOnEndCallback<TOOLS, RUNTIME_CONTEXT>;
    onAbort?: GenerateTextOnAbortCallback<TOOLS, RUNTIME_CONTEXT>;
    onToolExecutionStart?: OnToolExecutionStartCallback<TOOLS>;
    onToolExecutionEnd?: OnToolExecutionEndCallback<TOOLS>;
};
/**
 * Creates a telemetry dispatcher that only includes configured runtime context
 * properties in text-generation lifecycle events before dispatching them.
 */
declare function createRestrictedTelemetryDispatcher<TOOLS extends ToolSet, RUNTIME_CONTEXT extends Context, OUTPUT extends Output>({ telemetry, includeRuntimeContext, includeToolsContext, }: {
    telemetry?: TelemetryOptions<RUNTIME_CONTEXT, TOOLS>;
    includeRuntimeContext: IncludedContext<RUNTIME_CONTEXT>;
    includeToolsContext?: IncludedToolsContext<TOOLS>;
}): RestrictedTelemetryDispatcher<TOOLS, RUNTIME_CONTEXT, OUTPUT>;

declare function parseToolCall<TOOLS extends ToolSet>({ toolCall, tools, repairToolCall, refineToolInput, messages, instructions, }: {
    toolCall: LanguageModelV4ToolCall;
    tools: TOOLS | undefined;
    repairToolCall: ToolCallRepairFunction<TOOLS> | undefined;
    refineToolInput?: ToolInputRefinement<TOOLS> | undefined;
    instructions: Instructions | undefined;
    messages: ModelMessage[];
}): Promise<TypedToolCall<TOOLS>>;

type CollectedToolApprovals<TOOLS extends ToolSet> = {
    approvalRequest: ToolApprovalRequest;
    approvalResponse: ToolApprovalResponse;
    toolCall: TypedToolCall<TOOLS>;
    existingToolResult?: ToolResultPart;
};
/**
 * If the last message is a tool message, this function collects all tool approvals
 * from that message.
 */
declare function collectToolApprovals<TOOLS extends ToolSet>({ messages, }: {
    messages: ModelMessage[];
}): {
    approvedToolApprovals: Array<CollectedToolApprovals<TOOLS>>;
    deniedToolApprovals: Array<CollectedToolApprovals<TOOLS>>;
};

/**
 * Re-validates approved tool approvals reconstructed from client-supplied
 * message history before they are executed. Checks HMAC signature (when
 * configured), input schema, and approval policy.
 */
declare function validateApprovedToolApprovals<TOOLS extends ToolSet, RUNTIME_CONTEXT extends Context | unknown | never>({ approvedToolApprovals, tools, toolApproval, messages, toolsContext, runtimeContext, toolApprovalSecret, }: {
    approvedToolApprovals: Array<CollectedToolApprovals<TOOLS>>;
    tools: TOOLS | undefined;
    toolApproval: ToolApprovalConfiguration<TOOLS, RUNTIME_CONTEXT> | undefined;
    messages: ModelMessage[];
    toolsContext: InferToolSetContext<TOOLS>;
    runtimeContext: RUNTIME_CONTEXT;
    toolApprovalSecret?: string | Uint8Array;
}): Promise<{
    approvedToolApprovals: Array<CollectedToolApprovals<TOOLS>>;
    deniedToolApprovals: Array<CollectedToolApprovals<TOOLS>>;
}>;

/**
 * Converts the result of a `generateText` or `streamText` call to a list of response messages.
 */
declare function toResponseMessages<TOOLS extends ToolSet>({ content: inputContent, tools, }: {
    content: Array<ContentPart<TOOLS>>;
    tools: TOOLS | undefined;
}): Promise<Array<AssistantModelMessage | ToolModelMessage>>;

export { CollectedToolApprovals, DefaultStepResult, DownloadFunction, addLanguageModelUsage, asLanguageModelUsage, collectToolApprovals, convertToLanguageModelPrompt, createAsyncIterableStream, createDefaultDownloadFunction, createNullLanguageModelUsage, createRestrictedTelemetryDispatcher, createTelemetryDispatcher, createToolModelOutput, downloadAssets, mapToolResultOutput, mergeAbortSignals, mergeCallbacks, parseToolCall, prepareLanguageModelCallOptions as prepareCallSettings, prepareLanguageModelCallOptions, prepareRetries, prepareToolChoice, prepareTools, resolveLanguageModel, standardizePrompt, toResponseMessages, validateApprovedToolApprovals };
