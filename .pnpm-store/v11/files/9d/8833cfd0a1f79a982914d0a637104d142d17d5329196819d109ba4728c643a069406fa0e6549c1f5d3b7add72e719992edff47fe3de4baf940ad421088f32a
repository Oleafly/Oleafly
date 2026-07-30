import * as _ai_sdk_provider_utils from '@ai-sdk/provider-utils';
import { InferSchema, FetchFunction } from '@ai-sdk/provider-utils';
import { ProviderV4, LanguageModelV4, ImageModelV4, EmbeddingModelV4, Experimental_VideoModelV4, SpeechModelV4, FilesV4, Experimental_RealtimeFactoryV4, Experimental_RealtimeModelV4, Experimental_RealtimeModelV4ClientSecretOptions, Experimental_RealtimeModelV4ClientSecretResult, Experimental_RealtimeModelV4ServerEvent, Experimental_RealtimeModelV4ClientEvent, Experimental_RealtimeModelV4SessionConfig } from '@ai-sdk/provider';

declare const googleErrorDataSchema: _ai_sdk_provider_utils.LazySchema<{
    error: {
        code: number | null;
        message: string;
        status: string;
    };
}>;
type GoogleErrorData = InferSchema<typeof googleErrorDataSchema>;

type GoogleModelId = 'gemini-2.0-flash' | 'gemini-2.0-flash-001' | 'gemini-2.0-flash-lite' | 'gemini-2.0-flash-lite-001' | 'gemini-2.5-pro' | 'gemini-2.5-flash' | 'gemini-2.5-flash-image' | 'gemini-2.5-flash-lite' | 'gemini-2.5-flash-preview-tts' | 'gemini-2.5-pro-preview-tts' | 'gemini-2.5-flash-native-audio-latest' | 'gemini-2.5-flash-native-audio-preview-09-2025' | 'gemini-2.5-flash-native-audio-preview-12-2025' | 'gemini-2.5-computer-use-preview-10-2025' | 'gemini-3-pro-preview' | 'gemini-3-pro-image-preview' | 'gemini-3-flash-preview' | 'gemini-3.1-pro-preview' | 'gemini-3.1-pro-preview-customtools' | 'gemini-3.1-flash-image-preview' | 'gemini-3.1-flash-lite-preview' | 'gemini-3.1-flash-tts-preview' | 'gemini-3.5-flash' | 'gemini-3.5-flash-lite' | 'gemini-3.6-flash' | 'gemini-pro-latest' | 'gemini-flash-latest' | 'gemini-flash-lite-latest' | 'deep-research-pro-preview-12-2025' | 'deep-research-max-preview-04-2026' | 'deep-research-preview-04-2026' | 'nano-banana-pro-preview' | 'aqa' | 'gemini-robotics-er-1.5-preview' | 'gemma-3-1b-it' | 'gemma-3-4b-it' | 'gemma-3n-e4b-it' | 'gemma-3n-e2b-it' | 'gemma-3-12b-it' | 'gemma-3-27b-it' | (string & {});
declare const googleLanguageModelOptions: _ai_sdk_provider_utils.LazySchema<{
    responseModalities?: ("TEXT" | "IMAGE")[] | undefined;
    thinkingConfig?: {
        thinkingBudget?: number | undefined;
        includeThoughts?: boolean | undefined;
        thinkingLevel?: "minimal" | "low" | "medium" | "high" | undefined;
    } | undefined;
    cachedContent?: string | undefined;
    structuredOutputs?: boolean | undefined;
    safetySettings?: {
        category: "HARM_CATEGORY_UNSPECIFIED" | "HARM_CATEGORY_HATE_SPEECH" | "HARM_CATEGORY_DANGEROUS_CONTENT" | "HARM_CATEGORY_HARASSMENT" | "HARM_CATEGORY_SEXUALLY_EXPLICIT" | "HARM_CATEGORY_CIVIC_INTEGRITY";
        threshold: "HARM_BLOCK_THRESHOLD_UNSPECIFIED" | "BLOCK_LOW_AND_ABOVE" | "BLOCK_MEDIUM_AND_ABOVE" | "BLOCK_ONLY_HIGH" | "BLOCK_NONE" | "OFF";
    }[] | undefined;
    threshold?: "HARM_BLOCK_THRESHOLD_UNSPECIFIED" | "BLOCK_LOW_AND_ABOVE" | "BLOCK_MEDIUM_AND_ABOVE" | "BLOCK_ONLY_HIGH" | "BLOCK_NONE" | "OFF" | undefined;
    audioTimestamp?: boolean | undefined;
    labels?: Record<string, string> | undefined;
    mediaResolution?: "MEDIA_RESOLUTION_UNSPECIFIED" | "MEDIA_RESOLUTION_LOW" | "MEDIA_RESOLUTION_MEDIUM" | "MEDIA_RESOLUTION_HIGH" | undefined;
    imageConfig?: {
        aspectRatio?: "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9" | "1:8" | "8:1" | "1:4" | "4:1" | undefined;
        imageSize?: "1K" | "2K" | "4K" | "512" | undefined;
        personGeneration?: "PERSON_GENERATION_UNSPECIFIED" | "ALLOW_ALL" | "ALLOW_ADULT" | "ALLOW_NONE" | undefined;
        prominentPeople?: "PROMINENT_PEOPLE_UNSPECIFIED" | "ALLOW_PROMINENT_PEOPLE" | "BLOCK_PROMINENT_PEOPLE" | undefined;
        imageOutputOptions?: {
            mimeType?: "image/jpeg" | "image/png" | undefined;
            compressionQuality?: number | undefined;
        } | undefined;
    } | undefined;
    retrievalConfig?: {
        latLng?: {
            latitude: number;
            longitude: number;
        } | undefined;
    } | undefined;
    streamFunctionCallArguments?: boolean | undefined;
    serviceTier?: "standard" | "flex" | "priority" | undefined;
    sharedRequestType?: "standard" | "flex" | "priority" | undefined;
    requestType?: "shared" | undefined;
}>;
type GoogleLanguageModelOptions = InferSchema<typeof googleLanguageModelOptions>;

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

type GoogleGroundingMetadata = GroundingMetadataSchema;
type GoogleUrlContextMetadata = UrlContextMetadataSchema;
type GoogleSafetyRating = SafetyRatingSchema;
type GooglePromptFeedback = PromptFeedbackSchema;
type GoogleUsageMetadata = UsageMetadataSchema;
interface GoogleProviderMetadata {
    promptFeedback: GooglePromptFeedback | null;
    groundingMetadata: GoogleGroundingMetadata | null;
    urlContextMetadata: GoogleUrlContextMetadata | null;
    safetyRatings: GoogleSafetyRating[] | null;
    usageMetadata: GoogleUsageMetadata | null;
    finishMessage: string | null;
    serviceTier: string | null;
}

declare const googleImageModelOptionsSchema: _ai_sdk_provider_utils.LazySchema<{
    personGeneration?: "dont_allow" | "allow_adult" | "allow_all" | null | undefined;
    aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9" | null | undefined;
    googleSearch?: {
        [x: string]: unknown;
        searchTypes?: {
            webSearch?: Record<string, never> | undefined;
            imageSearch?: Record<string, never> | undefined;
        } | undefined;
        timeRangeFilter?: {
            startTime: string;
            endTime: string;
        } | undefined;
    } | undefined;
}>;
type GoogleImageModelOptions = InferSchema<typeof googleImageModelOptionsSchema>;

type GoogleEmbeddingModelId = 'gemini-embedding-001' | 'gemini-embedding-2' | 'gemini-embedding-2-preview' | (string & {});
declare const googleEmbeddingModelOptions: _ai_sdk_provider_utils.LazySchema<{
    outputDimensionality?: number | undefined;
    taskType?: "SEMANTIC_SIMILARITY" | "CLASSIFICATION" | "CLUSTERING" | "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "QUESTION_ANSWERING" | "FACT_VERIFICATION" | "CODE_RETRIEVAL_QUERY" | undefined;
    content?: (({
        text: string;
    } | {
        inlineData: {
            mimeType: string;
            data: string;
        };
    } | {
        fileData: {
            fileUri: string;
            mimeType: string;
        };
    })[] | null)[] | undefined;
}>;
type GoogleEmbeddingModelOptions = InferSchema<typeof googleEmbeddingModelOptions>;

type GoogleVideoModelOptions = {
    pollIntervalMs?: number | null;
    pollTimeoutMs?: number | null;
    personGeneration?: 'dont_allow' | 'allow_adult' | 'allow_all' | null;
    negativePrompt?: string | null;
    referenceImages?: Array<{
        bytesBase64Encoded?: string;
        gcsUri?: string;
    }> | null;
    [key: string]: unknown;
};

type GoogleVideoModelId = 'veo-3.1-fast-generate-preview' | 'veo-3.1-generate-preview' | 'veo-3.1-generate' | 'veo-3.1-lite-generate-preview' | 'veo-3.0-generate-001' | 'veo-3.0-fast-generate-001' | 'veo-2.0-generate-001' | (string & {});

type GoogleSpeechModelId = 'gemini-2.5-flash-preview-tts' | 'gemini-2.5-pro-preview-tts' | 'gemini-3.1-flash-tts-preview' | (string & {});
declare const googleSpeechProviderOptionsSchema: _ai_sdk_provider_utils.LazySchema<{
    multiSpeakerVoiceConfig?: {
        speakerVoiceConfigs: {
            speaker: string;
            voiceConfig: {
                prebuiltVoiceConfig: {
                    voiceName: string;
                };
            };
        }[];
    } | undefined;
}>;
type GoogleSpeechModelOptions = InferSchema<typeof googleSpeechProviderOptionsSchema>;

type GoogleFilesUploadOptions = {
    displayName?: string | null;
    pollIntervalMs?: number | null;
    pollTimeoutMs?: number | null;
    [key: string]: unknown;
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
/**
 * Provider-options schema for `google.interactions(...)` calls. Read from the
 * shared `providerOptions.google.*` namespace (per PRD); per-call options that
 * the AI SDK doesn't natively expose live here.
 *
 * All fields are `.nullish()` per the existing google provider convention.
 */
declare const googleInteractionsLanguageModelOptions: _ai_sdk_provider_utils.LazySchema<{
    previousInteractionId?: string | null | undefined;
    store?: boolean | null | undefined;
    agent?: string | null | undefined;
    agentConfig?: {
        [x: string]: unknown;
        type: "dynamic";
    } | {
        type: "deep-research";
        thinkingSummaries?: "auto" | "none" | null | undefined;
        visualization?: "auto" | "off" | null | undefined;
        collaborativePlanning?: boolean | null | undefined;
    } | null | undefined;
    thinkingLevel?: "minimal" | "low" | "medium" | "high" | null | undefined;
    thinkingSummaries?: "auto" | "none" | null | undefined;
    responseFormat?: ({
        [x: string]: unknown;
        type: "text";
        mimeType?: string | null | undefined;
        schema?: unknown;
    } | {
        [x: string]: unknown;
        type: "image";
        mimeType?: string | null | undefined;
        aspectRatio?: "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9" | "1:8" | "8:1" | "1:4" | "4:1" | null | undefined;
        imageSize?: "1K" | "2K" | "4K" | "512" | null | undefined;
    } | {
        [x: string]: unknown;
        type: "audio";
        mimeType?: string | null | undefined;
    })[] | null | undefined;
    imageConfig?: {
        aspectRatio?: "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9" | "1:8" | "8:1" | "1:4" | "4:1" | null | undefined;
        imageSize?: "1K" | "2K" | "4K" | "512" | null | undefined;
    } | null | undefined;
    mediaResolution?: "low" | "medium" | "high" | "ultra_high" | null | undefined;
    responseModalities?: ("text" | "image" | "document" | "audio" | "video")[] | null | undefined;
    serviceTier?: "standard" | "flex" | "priority" | null | undefined;
    systemInstruction?: string | null | undefined;
    signature?: string | null | undefined;
    interactionId?: string | null | undefined;
    pollingTimeoutMs?: number | null | undefined;
    background?: boolean | null | undefined;
    environment?: string | {
        type: "remote";
        sources?: ({
            type: "gcs";
            source: string;
            target?: string | null | undefined;
        } | {
            type: "repository";
            source: string;
            target?: string | null | undefined;
        } | {
            type: "inline";
            content: string;
            target: string;
        })[] | null | undefined;
        network?: "disabled" | {
            allowlist: {
                domain: string;
                transform?: Record<string, string>[] | null | undefined;
            }[];
        } | null | undefined;
    } | null | undefined;
}>;
type GoogleLanguageModelInteractionsOptions = InferSchema<typeof googleInteractionsLanguageModelOptions>;

/**
 * Provider-metadata shape that the Gemini Interactions language model writes
 * onto `result.providerMetadata.google` (and reads back from input messages on
 * the next turn for stateful chaining and signature round-trip).
 */
type GoogleInteractionsProviderMetadata = {
    /**
     * Gemini-server-side interaction id (`Interaction.id`). Pass back in
     * `providerOptions.google.previousInteractionId` to chain stateful turns.
     */
    interactionId?: string;
    /**
     * Service tier used for this interaction (passthrough for observability).
     */
    serviceTier?: string;
    /**
     * Output token counts keyed by modality (e.g. `{ video: 57920 }`), sourced
     * from the Interactions API `output_tokens_by_modality`. Present only when
     * the response reports a breakdown. Preview surface for per-modality billing;
     * may be promoted to a first-class usage field later.
     */
    outputTokensByModality?: Record<string, number>;
    /**
     * Per-block signature hash for backend validation. Set by the SDK on output
     * reasoning / tool-call parts and round-tripped on input parts.
     */
    signature?: string;
};

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

type GoogleImageModelId = 'imagen-4.0-generate-001' | 'imagen-4.0-ultra-generate-001' | 'imagen-4.0-fast-generate-001' | 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview' | 'gemini-3.1-flash-image-preview' | (string & {});
interface GoogleImageSettings {
    /**
     * Override the maximum number of images per call (default 4)
     */
    maxImagesPerCall?: number;
}

interface GoogleProvider extends ProviderV4 {
    (modelId: GoogleModelId): LanguageModelV4;
    languageModel(modelId: GoogleModelId): LanguageModelV4;
    chat(modelId: GoogleModelId): LanguageModelV4;
    /**
     * Creates a model for image generation.
     */
    image(modelId: GoogleImageModelId, settings?: GoogleImageSettings): ImageModelV4;
    /**
     * @deprecated Use `chat()` instead.
     */
    generativeAI(modelId: GoogleModelId): LanguageModelV4;
    /**
     * Creates a model for text embeddings.
     */
    embedding(modelId: GoogleEmbeddingModelId): EmbeddingModelV4;
    /**
     * Creates a model for text embeddings.
     */
    embeddingModel(modelId: GoogleEmbeddingModelId): EmbeddingModelV4;
    /**
     * @deprecated Use `embedding` instead.
     */
    textEmbedding(modelId: GoogleEmbeddingModelId): EmbeddingModelV4;
    /**
     * @deprecated Use `embeddingModel` instead.
     */
    textEmbeddingModel(modelId: GoogleEmbeddingModelId): EmbeddingModelV4;
    /**
     * Creates a model for video generation.
     */
    video(modelId: GoogleVideoModelId): Experimental_VideoModelV4;
    /**
     * Creates a model for video generation.
     */
    videoModel(modelId: GoogleVideoModelId): Experimental_VideoModelV4;
    /**
     * Creates a model for speech generation (text-to-speech).
     */
    speech(modelId: GoogleSpeechModelId): SpeechModelV4;
    /**
     * Creates a model for speech generation (text-to-speech).
     */
    speechModel(modelId: GoogleSpeechModelId): SpeechModelV4;
    files(): FilesV4;
    /**
     * Creates a language model targeting the Gemini Interactions API
     * (`POST /v1beta/interactions`). Pass:
     *   - a model ID (string),
     *   - `{ agent: <name> }` to use a known Gemini agent preset, or
     *   - `{ managedAgent: <name> }` to use a user-defined agent created via
     *     the `/v1beta/agents` endpoint.
     */
    interactions(modelIdOrAgent: GoogleInteractionsModelId | {
        agent: GoogleInteractionsAgentName;
    } | {
        managedAgent: string;
    }): LanguageModelV4;
    experimental_realtime: Experimental_RealtimeFactoryV4;
    tools: typeof googleTools;
}
interface GoogleProviderSettings {
    /**
     * Use a different URL prefix for API calls, e.g. to use proxy servers.
     * The default prefix is `https://generativelanguage.googleapis.com/v1beta`.
     */
    baseURL?: string;
    /**
     * API key that is being send using the `x-goog-api-key` header.
     * It defaults to the `GOOGLE_GENERATIVE_AI_API_KEY` environment variable.
     */
    apiKey?: string;
    /**
     * Custom headers to include in the requests.
     */
    headers?: Record<string, string | undefined>;
    /**
     * Custom fetch implementation. You can use it as a middleware to intercept requests,
     * or to provide a custom fetch implementation for e.g. testing.
     */
    fetch?: FetchFunction;
    /**
     * Optional function to generate a unique ID for each request.
     */
    generateId?: () => string;
    /**
     * Custom provider name
     * Defaults to 'google.generative-ai'.
     */
    name?: string;
}
/**
 * Create a Google provider instance.
 */
declare function createGoogle(options?: GoogleProviderSettings): GoogleProvider;
/**
 * Default Google Generative AI provider instance.
 */
declare const google: GoogleProvider;

type GoogleRealtimeModelConfig = {
    provider: string;
    baseURL: string;
    headers: () => Record<string, string | undefined>;
    fetch?: FetchFunction;
};
declare class GoogleRealtimeModel implements Experimental_RealtimeModelV4 {
    readonly specificationVersion: "v4";
    readonly provider: string;
    readonly modelId: string;
    private readonly config;
    private readonly mapper;
    constructor(modelId: string, config: GoogleRealtimeModelConfig);
    doCreateClientSecret(options: Experimental_RealtimeModelV4ClientSecretOptions): Promise<Experimental_RealtimeModelV4ClientSecretResult>;
    getWebSocketConfig(options: {
        token: string;
        url: string;
    }): {
        url: string;
        protocols?: string[];
    };
    parseServerEvent(raw: unknown): Experimental_RealtimeModelV4ServerEvent | Experimental_RealtimeModelV4ServerEvent[];
    serializeClientEvent(event: Experimental_RealtimeModelV4ClientEvent): ReturnType<Experimental_RealtimeModelV4['serializeClientEvent']>;
    buildSessionConfig(config: Experimental_RealtimeModelV4SessionConfig): Record<string, unknown>;
}

type GoogleRealtimeModelId = string;
type GoogleRealtimeModelOptions = {
    /**
     * Gemini Live Translation configuration.
     *
     * Required for `gemini-3.5-live-translate-preview` when translating speech
     * to a target language.
     */
    translationConfig?: {
        /**
         * BCP-47 language code of the language to translate into.
         * Defaults to `en` in the Gemini API.
         */
        targetLanguageCode?: string;
        /**
         * Whether input audio already in the target language should be echoed
         * instead of producing silence.
         */
        echoTargetLanguage?: boolean;
    };
};

declare const VERSION: string;

export { GoogleRealtimeModel as Experimental_GoogleRealtimeModel, type GoogleRealtimeModelConfig as Experimental_GoogleRealtimeModelConfig, type GoogleRealtimeModelId as Experimental_GoogleRealtimeModelId, type GoogleRealtimeModelOptions as Experimental_GoogleRealtimeModelOptions, type GoogleEmbeddingModelOptions, type GoogleErrorData, type GoogleFilesUploadOptions, type GoogleEmbeddingModelOptions as GoogleGenerativeAIEmbeddingProviderOptions, type GoogleImageModelOptions as GoogleGenerativeAIImageProviderOptions, type GoogleProvider as GoogleGenerativeAIProvider, type GoogleProviderMetadata as GoogleGenerativeAIProviderMetadata, type GoogleLanguageModelOptions as GoogleGenerativeAIProviderOptions, type GoogleProviderSettings as GoogleGenerativeAIProviderSettings, type GoogleVideoModelId as GoogleGenerativeAIVideoModelId, type GoogleVideoModelOptions as GoogleGenerativeAIVideoProviderOptions, type GoogleImageModelOptions, type GoogleInteractionsAgentName, type GoogleInteractionsModelId, type GoogleInteractionsProviderMetadata, type GoogleLanguageModelInteractionsOptions, type GoogleLanguageModelOptions, type GoogleProvider, type GoogleProviderMetadata, type GoogleProviderSettings, type GoogleSpeechModelId, type GoogleSpeechModelOptions, type GoogleVideoModelId, type GoogleVideoModelOptions, VERSION, createGoogle, createGoogle as createGoogleGenerativeAI, google };
