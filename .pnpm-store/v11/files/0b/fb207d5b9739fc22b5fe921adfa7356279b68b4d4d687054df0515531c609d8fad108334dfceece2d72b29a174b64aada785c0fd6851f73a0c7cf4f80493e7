import * as _ai_sdk_provider_utils from '@ai-sdk/provider-utils';
import { WORKFLOW_SERIALIZE, WORKFLOW_DESERIALIZE, Resolvable, FetchFunction, InferSchema } from '@ai-sdk/provider-utils';
import * as _ai_sdk_provider from '@ai-sdk/provider';
import { LanguageModelV4, JSONObject, LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4StreamResult, SpeechModelV4 } from '@ai-sdk/provider';
import { z } from 'zod/v4';

type GoogleModelId = 'gemini-2.0-flash' | 'gemini-2.0-flash-001' | 'gemini-2.0-flash-lite' | 'gemini-2.0-flash-lite-001' | 'gemini-2.5-pro' | 'gemini-2.5-flash' | 'gemini-2.5-flash-image' | 'gemini-2.5-flash-lite' | 'gemini-2.5-flash-preview-tts' | 'gemini-2.5-pro-preview-tts' | 'gemini-2.5-flash-native-audio-latest' | 'gemini-2.5-flash-native-audio-preview-09-2025' | 'gemini-2.5-flash-native-audio-preview-12-2025' | 'gemini-2.5-computer-use-preview-10-2025' | 'gemini-3-pro-preview' | 'gemini-3-pro-image-preview' | 'gemini-3-flash-preview' | 'gemini-3.1-pro-preview' | 'gemini-3.1-pro-preview-customtools' | 'gemini-3.1-flash-image-preview' | 'gemini-3.1-flash-lite-preview' | 'gemini-3.1-flash-tts-preview' | 'gemini-3.5-flash' | 'gemini-3.5-flash-lite' | 'gemini-3.6-flash' | 'gemini-pro-latest' | 'gemini-flash-latest' | 'gemini-flash-lite-latest' | 'deep-research-pro-preview-12-2025' | 'deep-research-max-preview-04-2026' | 'deep-research-preview-04-2026' | 'nano-banana-pro-preview' | 'aqa' | 'gemini-robotics-er-1.5-preview' | 'gemma-3-1b-it' | 'gemma-3-4b-it' | 'gemma-3n-e4b-it' | 'gemma-3n-e2b-it' | 'gemma-3-12b-it' | 'gemma-3-27b-it' | (string & {});

type GoogleConfig = {
    provider: string;
    baseURL: string;
    headers?: Resolvable<Record<string, string | undefined>>;
    fetch?: FetchFunction;
    generateId: () => string;
    /**
     * The supported URLs for the model.
     */
    supportedUrls?: () => LanguageModelV4['supportedUrls'];
};
declare class GoogleLanguageModel implements LanguageModelV4 {
    readonly specificationVersion = "v4";
    readonly modelId: GoogleModelId;
    private readonly config;
    private readonly generateId;
    static [WORKFLOW_SERIALIZE](model: GoogleLanguageModel): {
        modelId: string;
        config: JSONObject;
    };
    static [WORKFLOW_DESERIALIZE](options: {
        modelId: string;
        config: GoogleConfig;
    }): GoogleLanguageModel;
    constructor(modelId: GoogleModelId, config: GoogleConfig);
    get provider(): string;
    get supportedUrls(): Record<string, RegExp[]> | PromiseLike<Record<string, RegExp[]>>;
    private getArgs;
    doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult>;
    doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult>;
}
declare const getGroundingMetadataSchema: () => z.ZodObject<{
    webSearchQueries: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    imageSearchQueries: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    retrievalQueries: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    searchEntryPoint: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        renderedContent: z.ZodString;
    }, z.core.$strip>>>;
    groundingChunks: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        web: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            uri: z.ZodString;
            title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            sourceUri: z.ZodString;
            imageUri: z.ZodString;
            title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            domain: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>>;
        retrievedContext: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            uri: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            fileSearchStore: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>>;
        maps: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            uri: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            placeId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>>>;
    groundingSupports: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        segment: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            startIndex: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            endIndex: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>>;
        segment_text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        groundingChunkIndices: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodNumber>>>;
        supportChunkIndices: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodNumber>>>;
        confidenceScores: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodNumber>>>;
        confidenceScore: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodNumber>>>;
    }, z.core.$strip>>>>;
    retrievalMetadata: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodObject<{
        webDynamicRetrievalScore: z.ZodNumber;
    }, z.core.$strip>, z.ZodObject<{}, z.core.$strip>]>>>;
}, z.core.$strip>;
declare const getUrlContextMetadataSchema: () => z.ZodObject<{
    urlMetadata: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        retrievedUrl: z.ZodString;
        urlRetrievalStatus: z.ZodString;
    }, z.core.$strip>>>>;
}, z.core.$strip>;
declare const responseSchema: _ai_sdk_provider_utils.LazySchema<{
    candidates: {
        content?: Record<string, never> | {
            parts?: ({
                functionCall: {
                    id?: string | null | undefined;
                    name?: string | null | undefined;
                    args?: unknown;
                    partialArgs?: {
                        jsonPath: string;
                        stringValue?: string | null | undefined;
                        numberValue?: number | null | undefined;
                        boolValue?: boolean | null | undefined;
                        nullValue?: unknown;
                        willContinue?: boolean | null | undefined;
                    }[] | null | undefined;
                    willContinue?: boolean | null | undefined;
                };
                thoughtSignature?: string | null | undefined;
            } | {
                inlineData: {
                    mimeType: string;
                    data: string;
                };
                thought?: boolean | null | undefined;
                thoughtSignature?: string | null | undefined;
            } | {
                toolCall: {
                    toolType: string;
                    id: string;
                    args?: unknown;
                };
                thoughtSignature?: string | null | undefined;
            } | {
                toolResponse: {
                    toolType: string;
                    id: string;
                    response?: unknown;
                };
                thoughtSignature?: string | null | undefined;
            } | {
                executableCode?: {
                    language: string;
                    code: string;
                } | null | undefined;
                codeExecutionResult?: {
                    outcome: string;
                    output?: string | null | undefined;
                } | null | undefined;
                text?: string | null | undefined;
                thought?: boolean | null | undefined;
                thoughtSignature?: string | null | undefined;
            })[] | null | undefined;
        } | null | undefined;
        finishReason?: string | null | undefined;
        finishMessage?: string | null | undefined;
        safetyRatings?: {
            category?: string | null | undefined;
            probability?: string | null | undefined;
            probabilityScore?: number | null | undefined;
            severity?: string | null | undefined;
            severityScore?: number | null | undefined;
            blocked?: boolean | null | undefined;
        }[] | null | undefined;
        groundingMetadata?: {
            webSearchQueries?: string[] | null | undefined;
            imageSearchQueries?: string[] | null | undefined;
            retrievalQueries?: string[] | null | undefined;
            searchEntryPoint?: {
                renderedContent: string;
            } | null | undefined;
            groundingChunks?: {
                web?: {
                    uri: string;
                    title?: string | null | undefined;
                } | null | undefined;
                image?: {
                    sourceUri: string;
                    imageUri: string;
                    title?: string | null | undefined;
                    domain?: string | null | undefined;
                } | null | undefined;
                retrievedContext?: {
                    uri?: string | null | undefined;
                    title?: string | null | undefined;
                    text?: string | null | undefined;
                    fileSearchStore?: string | null | undefined;
                } | null | undefined;
                maps?: {
                    uri?: string | null | undefined;
                    title?: string | null | undefined;
                    text?: string | null | undefined;
                    placeId?: string | null | undefined;
                } | null | undefined;
            }[] | null | undefined;
            groundingSupports?: {
                segment?: {
                    startIndex?: number | null | undefined;
                    endIndex?: number | null | undefined;
                    text?: string | null | undefined;
                } | null | undefined;
                segment_text?: string | null | undefined;
                groundingChunkIndices?: number[] | null | undefined;
                supportChunkIndices?: number[] | null | undefined;
                confidenceScores?: number[] | null | undefined;
                confidenceScore?: number[] | null | undefined;
            }[] | null | undefined;
            retrievalMetadata?: Record<string, never> | {
                webDynamicRetrievalScore: number;
            } | null | undefined;
        } | null | undefined;
        urlContextMetadata?: {
            urlMetadata?: {
                retrievedUrl: string;
                urlRetrievalStatus: string;
            }[] | null | undefined;
        } | null | undefined;
    }[];
    responseId?: string | null | undefined;
    usageMetadata?: {
        cachedContentTokenCount?: number | null | undefined;
        thoughtsTokenCount?: number | null | undefined;
        promptTokenCount?: number | null | undefined;
        candidatesTokenCount?: number | null | undefined;
        totalTokenCount?: number | null | undefined;
        trafficType?: string | null | undefined;
        serviceTier?: string | null | undefined;
        promptTokensDetails?: {
            modality: string;
            tokenCount: number;
        }[] | null | undefined;
        candidatesTokensDetails?: {
            modality: string;
            tokenCount: number;
        }[] | null | undefined;
    } | null | undefined;
    promptFeedback?: {
        blockReason?: string | null | undefined;
        safetyRatings?: {
            category?: string | null | undefined;
            probability?: string | null | undefined;
            probabilityScore?: number | null | undefined;
            severity?: string | null | undefined;
            severityScore?: number | null | undefined;
            blocked?: boolean | null | undefined;
        }[] | null | undefined;
    } | null | undefined;
}>;
type GroundingMetadataSchema = NonNullable<InferSchema<typeof responseSchema>['candidates'][number]['groundingMetadata']>;
type UrlContextMetadataSchema = NonNullable<InferSchema<typeof responseSchema>['candidates'][number]['urlContextMetadata']>;
type SafetyRatingSchema = NonNullable<InferSchema<typeof responseSchema>['candidates'][number]['safetyRatings']>[number];
type PromptFeedbackSchema = NonNullable<InferSchema<typeof responseSchema>['promptFeedback']>;
type UsageMetadataSchema = NonNullable<InferSchema<typeof responseSchema>['usageMetadata']>;

type GoogleSpeechModelId = 'gemini-2.5-flash-preview-tts' | 'gemini-2.5-pro-preview-tts' | 'gemini-3.1-flash-tts-preview' | (string & {});

interface GoogleSpeechModelConfig {
    provider: string;
    baseURL: string;
    headers?: Resolvable<Record<string, string | undefined>>;
    fetch?: FetchFunction;
    _internal?: {
        currentDate?: () => Date;
    };
}
declare class GoogleSpeechModel implements SpeechModelV4 {
    readonly modelId: GoogleSpeechModelId;
    private readonly config;
    readonly specificationVersion = "v4";
    static [WORKFLOW_SERIALIZE](model: GoogleSpeechModel): {
        modelId: string;
        config: _ai_sdk_provider.JSONObject;
    };
    static [WORKFLOW_DESERIALIZE](options: {
        modelId: GoogleSpeechModelId;
        config: GoogleSpeechModelConfig;
    }): GoogleSpeechModel;
    get provider(): string;
    constructor(modelId: GoogleSpeechModelId, config: GoogleSpeechModelConfig);
    private getArgs;
    doGenerate(options: Parameters<SpeechModelV4['doGenerate']>[0]): Promise<Awaited<ReturnType<SpeechModelV4['doGenerate']>>>;
}

declare const googleTools: {
    /**
     * Creates a Google search tool that gives Google direct access to real-time web content.
     * Must have name "google_search".
     */
    googleSearch: _ai_sdk_provider_utils.ProviderExecutedToolFactory<{}, {}, {
        [x: string]: unknown;
        searchTypes?: {
            webSearch?: Record<string, never> | undefined;
            imageSearch?: Record<string, never> | undefined;
        } | undefined;
        timeRangeFilter?: {
            startTime: string;
            endTime: string;
        } | undefined;
    }, {}>;
    /**
     * Creates an Enterprise Web Search tool for grounding responses using a compliance-focused web index.
     * Designed for highly-regulated industries (finance, healthcare, public sector).
     * Does not log customer data and supports VPC service controls.
     * Must have name "enterprise_web_search".
     *
     * @note Only available on Vertex AI. Requires Gemini 2.0 or newer.
     *
     * @see https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/web-grounding-enterprise
     */
    enterpriseWebSearch: _ai_sdk_provider_utils.ProviderExecutedToolFactory<{}, {}, {}, {}>;
    /**
     * Creates a Google Maps grounding tool that gives the model access to Google Maps data.
     * Must have name "google_maps".
     *
     * @see https://ai.google.dev/gemini-api/docs/maps-grounding
     * @see https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-maps
     */
    googleMaps: _ai_sdk_provider_utils.ProviderExecutedToolFactory<{}, {}, {}, {}>;
    /**
     * Creates a URL context tool that gives Google direct access to real-time web content.
     * Must have name "url_context".
     */
    urlContext: _ai_sdk_provider_utils.ProviderExecutedToolFactory<{}, {}, {}, {}>;
    /**
     * Enables Retrieval Augmented Generation (RAG) via the Gemini File Search tool.
     * Must have name "file_search".
     *
     * @param fileSearchStoreNames - Fully-qualified File Search store resource names.
     * @param metadataFilter - Optional filter expression to restrict the files that can be retrieved.
     * @param topK - Optional result limit for the number of chunks returned from File Search.
     *
     * @see https://ai.google.dev/gemini-api/docs/file-search
     */
    fileSearch: _ai_sdk_provider_utils.ProviderExecutedToolFactory<{}, {}, {
        [x: string]: unknown;
        fileSearchStoreNames: string[];
        topK?: number | undefined;
        metadataFilter?: string | undefined;
    }, {}>;
    /**
     * A tool that enables the model to generate and run Python code.
     * Must have name "code_execution".
     *
     * @note Ensure the selected model supports Code Execution.
     * Multi-tool usage with the code execution tool is typically compatible with Gemini >=2 models.
     *
     * @see https://ai.google.dev/gemini-api/docs/code-execution (Google AI)
     * @see https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/code-execution-api (Vertex AI)
     */
    codeExecution: _ai_sdk_provider_utils.ProviderExecutedToolFactory<{
        language: string;
        code: string;
    }, {
        outcome: string;
        output: string;
    }, {}, {}>;
    /**
     * Creates a Vertex RAG Store tool that enables the model to perform RAG searches against a Vertex RAG Store.
     * Must have name "vertex_rag_store".
     */
    vertexRagStore: _ai_sdk_provider_utils.ProviderExecutedToolFactory<{}, {}, {
        ragCorpus: string;
        topK?: number;
    }, {}>;
};

/**
 * Type-only union of Gemini model IDs that the Interactions API accepts via
 * `model:`. Mirrors `Model` from `googleapis/js-genai`
 * `src/interactions/resources/interactions.ts`.
 *
 * Kept as a separate type from `GoogleModelId` even though most IDs overlap;
 * the two surfaces (`:generateContent` vs `/interactions`) are independent and
 * may diverge over time.
 */
type GoogleInteractionsModelId = 'gemini-2.5-computer-use-preview-10-2025' | 'gemini-2.5-flash' | 'gemini-2.5-flash-image' | 'gemini-2.5-flash-lite' | 'gemini-2.5-flash-lite-preview-09-2025' | 'gemini-2.5-flash-native-audio-preview-12-2025' | 'gemini-2.5-flash-preview-09-2025' | 'gemini-2.5-flash-preview-tts' | 'gemini-2.5-pro' | 'gemini-2.5-pro-preview-tts' | 'gemini-3-flash-preview' | 'gemini-3-pro-image-preview' | 'gemini-3-pro-preview' | 'gemini-3.1-pro-preview' | 'gemini-3.1-flash-image-preview' | 'gemini-3.1-flash-lite-preview' | 'gemini-3.1-flash-tts-preview' | 'gemini-3.5-flash' | 'gemini-3.5-flash-lite' | 'gemini-3.6-flash' | 'lyria-3-clip-preview' | 'lyria-3-pro-preview' | (string & {});

type GoogleInteractionsConfig = {
    provider: string;
    baseURL: string;
    headers?: Resolvable<Record<string, string | undefined>>;
    fetch?: FetchFunction;
    generateId: () => string;
    supportedUrls?: () => LanguageModelV4['supportedUrls'];
};
type GoogleInteractionsModelInput = GoogleInteractionsModelId | {
    agent: string;
} | {
    managedAgent: string;
};
declare class GoogleInteractionsLanguageModel implements LanguageModelV4 {
    readonly specificationVersion = "v4";
    readonly modelId: string;
    /**
     * Optional agent name. When provided, the request body sends `agent:` instead
     * of `model:` and rejects `generation_config` (warned, not thrown).
     */
    readonly agent: string | undefined;
    private readonly config;
    static [WORKFLOW_SERIALIZE](model: GoogleInteractionsLanguageModel): {
        agent: string | undefined;
        modelId: string;
        config: _ai_sdk_provider.JSONObject;
    };
    static [WORKFLOW_DESERIALIZE](options: {
        modelId: string;
        agent?: string;
        config: GoogleInteractionsConfig;
    }): GoogleInteractionsLanguageModel;
    constructor(modelOrAgent: GoogleInteractionsModelInput, config: GoogleInteractionsConfig);
    get provider(): string;
    get supportedUrls(): Record<string, RegExp[]> | PromiseLike<Record<string, RegExp[]>>;
    private getArgs;
    doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult>;
    doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult>;
    private doStreamBackground;
}

/**
 * Type-only module: declares the union of supported Gemini Interactions agent
 * names. Used by the `google.interactions({ agent })` factory branch.
 *
 * Strict string-literal union: unknown agent names are a compile-time error.
 * User-defined agents (created via the `/agents` endpoint) are addressed by
 * a separate `{ managedAgent: string }` factory shape — see
 * `GoogleInteractionsModelInput`.
 */
type GoogleInteractionsAgentName = 'deep-research-pro-preview-12-2025' | 'deep-research-preview-04-2026' | 'deep-research-max-preview-04-2026' | 'antigravity-preview-05-2026';

export { type GoogleInteractionsAgentName, GoogleInteractionsLanguageModel, type GoogleInteractionsModelId, type GoogleInteractionsModelInput, GoogleLanguageModel, type GoogleModelId, GoogleSpeechModel, type GroundingMetadataSchema, type PromptFeedbackSchema, type SafetyRatingSchema, type UrlContextMetadataSchema, type UsageMetadataSchema, getGroundingMetadataSchema, getUrlContextMetadataSchema, googleTools };
