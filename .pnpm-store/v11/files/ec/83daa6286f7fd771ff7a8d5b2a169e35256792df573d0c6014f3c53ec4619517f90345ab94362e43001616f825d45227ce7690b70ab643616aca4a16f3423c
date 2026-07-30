import { SharedV4FileDataUrl, SharedV4FileDataReference, SharedV4FileDataText, SharedV4ProviderOptions, SharedV4ProviderReference, JSONValue, ImageModelV4File, LanguageModelV4FunctionTool, LanguageModelV4ProviderTool, AISDKError, JSONSchema7, JSONParseError, TypeValidationError, APICallError, LanguageModelV4Prompt, LanguageModelV4CallOptions, SharedV4Warning, JSONObject, LanguageModelV4FilePart, LanguageModelV4StreamPart, SharedV4ProviderMetadata, Experimental_TranscriptionModelV4StreamPart, TypeValidationContext } from '@ai-sdk/provider';
export { getErrorMessage } from '@ai-sdk/provider';
import { StandardSchemaV1, StandardJSONSchemaV1 } from '@standard-schema/spec';
export * from '@standard-schema/spec';
import * as z3 from 'zod/v3';
import * as z4 from 'zod/v4';
export { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from '@workflow/serde';
export { EventSourceMessage, EventSourceParserStream } from 'eventsource-parser/stream';

/**
 * A value that can be provided either as a single item, an array of items,
 * or be left undefined.
 */
type Arrayable<T> = T | T[] | undefined;
/**
 * Normalizes a possibly undefined or non-array value into an array.
 */
declare function asArray<T>(value: Arrayable<T>): T[];

declare function combineHeaders(...headers: Array<Record<string, string | undefined> | undefined>): Record<string, string | undefined>;

type WebSocketLike = {
    readyState: number;
    /** Bytes queued by `send` but not yet transmitted (native + `ws`). */
    readonly bufferedAmount?: number;
    send(data: string | Uint8Array | ArrayBuffer): void;
    close(code?: number, reason?: string): void;
    onopen: ((event: unknown) => void) | null;
    onmessage: ((event: {
        data: unknown;
    }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onclose: ((event: unknown) => void) | null;
};
type WebSocketConstructor = new (url: string | URL, protocols?: string | string[], options?: {
    headers?: Record<string, string | undefined>;
}) => WebSocketLike;
declare function getWebSocketConstructor(webSocket: WebSocketConstructor | undefined): WebSocketConstructor;
/**
 * Converts an http(s) URL to the corresponding ws(s) URL.
 */
declare function toWebSocketUrl(url: string | URL): URL;
/**
 * Reads WebSocket message data as text, handling string, binary,
 * and Blob payloads.
 */
declare function readWebSocketMessageText(data: unknown): Promise<string>;
/**
 * Waits until the socket's send buffer drains below `highWaterMark` bytes.
 * No-op for implementations that do not expose `bufferedAmount`. There is no
 * portable drain event, so this polls. Returns as soon as the socket is no
 * longer open or the signal aborts — `bufferedAmount` never drains on a
 * closed socket, so waiting on would poll forever.
 */
declare function waitForWebSocketBufferDrain(socket: WebSocketLike, { highWaterMark, pollIntervalMs, abortSignal, }?: {
    highWaterMark?: number;
    pollIntervalMs?: number;
    abortSignal?: AbortSignal;
}): Promise<void>;

interface WebSocketConnection {
    /** Undefined when the constructor threw or the signal was already aborted. */
    socket: WebSocketLike | undefined;
    /**
     * Unregisters the abort listener and closes the socket. Never throws.
     * Handlers stay attached; callers guard their own terminal state.
     */
    close: (code?: number) => void;
}
/**
 * Opens a WebSocket for a provider model, owning the transport-generic layer
 * (analogous to `postToApi` for HTTP): constructor resolution, header hygiene,
 * abort wiring, and message decoding. Callers own the URL, the auth channel
 * (subprotocols vs headers), and the wire protocol.
 */
declare function connectToWebSocket({ url, protocols, headers, webSocket, abortSignal, onOpen, onMessageText, onProcessingError, onSocketError, onClose, onAbort, }: {
    url: string | URL;
    protocols?: string | string[];
    headers?: Record<string, string | undefined>;
    webSocket?: WebSocketConstructor;
    abortSignal?: AbortSignal;
    onOpen?: (socket: WebSocketLike) => void;
    /** One decoded message. Throws and rejections go to `onProcessingError`. */
    onMessageText: (text: string) => void | PromiseLike<void>;
    /** Constructor throws and message decoding/processing failures. */
    onProcessingError: (error: unknown) => void;
    onSocketError?: () => void;
    onClose?: () => void;
    /** Also called (without opening a socket) when the signal is already aborted. */
    onAbort?: (reason: unknown) => void;
}): WebSocketConnection;

/**
 * Converts an AsyncIterator to a ReadableStream.
 *
 * @template T - The type of elements produced by the AsyncIterator.
 * @param { <T>} iterator - The AsyncIterator to convert.
 * @returns {ReadableStream<T>} - A ReadableStream that provides the same data as the AsyncIterator.
 */
declare function convertAsyncIteratorToReadableStream<T>(iterator: AsyncIterator<T>): ReadableStream<T>;

/**
 * Data content. Can either be a base64-encoded string, a Uint8Array, an ArrayBuffer, or a Buffer.
 */
type DataContent = string | Uint8Array | ArrayBuffer | Buffer;

/**
 * File data variant containing raw bytes (`Uint8Array`, `ArrayBuffer`, or
 * `Buffer`) or a base64-encoded string.
 *
 * This is slightly more permissive than `SharedV4FileDataData`.
 */
interface FileDataData {
    type: 'data';
    data: DataContent;
}
/**
 * File data variant containing a URL that points to the file.
 */
type FileDataUrl = SharedV4FileDataUrl;
/**
 * File data variant containing a provider reference (`{ [provider]: id }`).
 */
type FileDataReference = SharedV4FileDataReference;
/**
 * File data variant containing inline text content (e.g. an inline text
 * document).
 */
type FileDataText = SharedV4FileDataText;
/**
 * File data as a tagged discriminated union:
 *
 * - `{ type: 'data', data }`: raw bytes (`Uint8Array`, `ArrayBuffer`, or
 *   `Buffer`) or a base64-encoded string.
 * - `{ type: 'url', url }`: a URL that points to the file.
 * - `{ type: 'reference', reference }`: a provider reference (`{ [provider]: id }`).
 * - `{ type: 'text', text }`: inline text content (e.g. an inline text document).
 */
type FileData = FileDataData | FileDataUrl | FileDataReference | FileDataText;

/**
 * Additional provider-specific options.
 *
 * They are passed through to the provider from the AI SDK and enable
 * provider-specific functionality that can be fully encapsulated in the provider.
 */
type ProviderOptions = SharedV4ProviderOptions;

/**
 * A mapping of provider names to provider-specific file identifiers.
 *
 * Provider references allow files to be identified across different
 * providers without re-uploading, by storing each provider's own
 * identifier for the same logical file.
 */
type ProviderReference = SharedV4ProviderReference;

/**
 * Text content part of a prompt. It contains a string of text.
 */
interface TextPart {
    type: 'text';
    /**
     * The text content.
     */
    text: string;
    /**
     * Additional provider-specific metadata. They are passed through
     * to the provider from the AI SDK and enable provider-specific
     * functionality that can be fully encapsulated in the provider.
     */
    providerOptions?: ProviderOptions;
}
/**
 * Image content part of a prompt. It contains an image.
 *
 * @deprecated Use `FilePart` with `mediaType: 'image'` instead:
 * `{ type: 'file', mediaType: 'image', data: { type: 'data', data } }`.
 */
interface ImagePart {
    type: 'image';
    /**
     * Image data. Can either be:
     *
     * - data: a base64-encoded string, a Uint8Array, an ArrayBuffer, or a Buffer
     * - URL: a URL that points to the image
     * - ProviderReference: a provider reference from `uploadFile`
     */
    image: DataContent | URL | ProviderReference;
    /**
     * Optional IANA media type of the image.
     *
     * @see https://www.iana.org/assignments/media-types/media-types.xhtml
     */
    mediaType?: string;
    /**
     * Additional provider-specific metadata. They are passed through
     * to the provider from the AI SDK and enable provider-specific
     * functionality that can be fully encapsulated in the provider.
     */
    providerOptions?: ProviderOptions;
}
/**
 * File content part of a prompt. It contains a file.
 */
interface FilePart {
    type: 'file';
    /**
     * File data. Either a tagged shape or a bare shorthand:
     *
     * - `{ type: 'data', data }` or bare `DataContent`: raw bytes
     *   (base64 string, Uint8Array, ArrayBuffer, Buffer)
     * - `{ type: 'url', url }` or bare `URL`: a URL that points to the file
     * - `{ type: 'reference', reference }` or bare `ProviderReference`:
     *   a provider reference from `uploadFile`
     * - `{ type: 'text', text }`: inline text content (tagged only)
     */
    data: FileData | DataContent | URL | ProviderReference;
    /**
     * Optional filename of the file.
     */
    filename?: string;
    /**
     * Either a full IANA media type (`type/subtype`, e.g. `image/png`) or just
     * the top-level IANA segment (e.g. `image`, `audio`, `video`, `text`).
     *
     * `*`-subtype wildcards (e.g. `image/*`) are normalized as equivalent to the
     * top-level segment alone (e.g. `image`). Providers can use the helpers in
     * `@ai-sdk/provider-utils` (`isFullMediaType`, `getTopLevelMediaType`,
     * `detectMediaType`) to resolve the field according to their API
     * requirements.
     *
     * @see https://www.iana.org/assignments/media-types/media-types.xhtml
     */
    mediaType: string;
    /**
     * Additional provider-specific metadata. They are passed through
     * to the provider from the AI SDK and enable provider-specific
     * functionality that can be fully encapsulated in the provider.
     */
    providerOptions?: ProviderOptions;
}
/**
 * Reasoning content part of a prompt. It contains a reasoning.
 */
interface ReasoningPart {
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
    providerOptions?: ProviderOptions;
}
/**
 * Custom content part of a prompt. It contains no standardized payload beyond
 * provider-specific options.
 */
interface CustomPart {
    type: 'custom';
    /**
     * The kind of custom content, in the format `{provider}.{provider-type}`.
     */
    kind: `${string}.${string}`;
    /**
     * Additional provider-specific metadata. They are passed through
     * to the provider from the AI SDK and enable provider-specific
     * functionality that can be fully encapsulated in the provider.
     */
    providerOptions?: ProviderOptions;
}
/**
 * Reasoning file content part of a prompt. It contains a file generated as part of reasoning.
 */
interface ReasoningFilePart {
    type: 'reasoning-file';
    /**
     * Reasoning file data.
     *
     * Reasoning files originate from a model's reasoning output and are always
     * raw bytes or a fetchable URL. Unlike `FilePart.data`, the `reference` and
     * `text` shapes are not supported here: provider references describe files
     * uploaded by the user (not produced as model output), and reasoning text is
     * carried by `ReasoningPart` rather than as a file.
     *
     * Either a tagged shape or a bare shorthand:
     *
     * - `{ type: 'data', data }` or bare `DataContent`: raw bytes
     *   (base64 string, Uint8Array, ArrayBuffer, Buffer)
     * - `{ type: 'url', url }` or bare `URL`: a URL that points to the file
     */
    data: FileDataData | FileDataUrl | DataContent | URL;
    /**
     * IANA media type of the file.
     *
     * @see https://www.iana.org/assignments/media-types/media-types.xhtml
     */
    mediaType: string;
    /**
     * Additional provider-specific metadata. They are passed through
     * to the provider from the AI SDK and enable provider-specific
     * functionality that can be fully encapsulated in the provider.
     */
    providerOptions?: ProviderOptions;
}
/**
 * Tool call content part of a prompt. It contains a tool call (usually generated by the AI model).
 */
interface ToolCallPart {
    type: 'tool-call';
    /**
     * ID of the tool call. This ID is used to match the tool call with the tool result.
     */
    toolCallId: string;
    /**
     * Name of the tool that is being called.
     */
    toolName: string;
    /**
     * Arguments of the tool call. This is a JSON-serializable object that matches the tool's input schema.
     */
    input: unknown;
    /**
     * Additional provider-specific metadata. They are passed through
     * to the provider from the AI SDK and enable provider-specific
     * functionality that can be fully encapsulated in the provider.
     */
    providerOptions?: ProviderOptions;
    /**
     * Whether the tool call was executed by the provider.
     */
    providerExecuted?: boolean;
}
/**
 * Tool result content part of a prompt. It contains the result of the tool call with the matching ID.
 */
interface ToolResultPart {
    type: 'tool-result';
    /**
     * ID of the tool call that this result is associated with.
     */
    toolCallId: string;
    /**
     * Name of the tool that generated this result.
     */
    toolName: string;
    /**
     * Result of the tool call. This is a JSON-serializable object.
     */
    output: ToolResultOutput;
    /**
     * Additional provider-specific metadata. They are passed through
     * to the provider from the AI SDK and enable provider-specific
     * functionality that can be fully encapsulated in the provider.
     */
    providerOptions?: ProviderOptions;
}
/**
 * Output of a tool result.
 */
type ToolResultOutput = {
    /**
     * Text tool output that should be directly sent to the API.
     */
    type: 'text';
    value: string;
    /**
     * Provider-specific options.
     */
    providerOptions?: ProviderOptions;
} | {
    type: 'json';
    value: JSONValue;
    /**
     * Provider-specific options.
     */
    providerOptions?: ProviderOptions;
} | {
    /**
     * Type when the user has denied the execution of the tool call.
     */
    type: 'execution-denied';
    /**
     * Optional reason for the execution denial.
     */
    reason?: string;
    /**
     * Provider-specific options.
     */
    providerOptions?: ProviderOptions;
} | {
    type: 'error-text';
    value: string;
    /**
     * Provider-specific options.
     */
    providerOptions?: ProviderOptions;
} | {
    type: 'error-json';
    value: JSONValue;
    /**
     * Provider-specific options.
     */
    providerOptions?: ProviderOptions;
} | {
    type: 'content';
    value: Array<{
        type: 'text';
        /**
         * Text content.
         */
        text: string;
        /**
         * Provider-specific options.
         */
        providerOptions?: ProviderOptions;
    } | {
        type: 'file';
        /**
         * File data as a tagged discriminated union:
         *
         * - `{ type: 'data', data }`: raw bytes
         *   (base64 string, Uint8Array, ArrayBuffer, Buffer)
         * - `{ type: 'url', url }`: a URL that points to the file
         * - `{ type: 'reference', reference }`: a provider reference
         *   from `uploadFile`
         * - `{ type: 'text', text }`: inline text content (e.g. an inline
         *   text document)
         */
        data: FileData;
        /**
         * Either a full IANA media type (`type/subtype`, e.g. `image/png`) or just
         * the top-level IANA segment (e.g. `image`, `audio`, `video`, `text`).
         *
         * `*`-subtype wildcards (e.g. `image/*`) are normalized as equivalent to the
         * top-level segment alone (e.g. `image`). Providers can use the helpers in
         * `@ai-sdk/provider-utils` (`isFullMediaType`, `getTopLevelMediaType`,
         * `detectMediaType`) to resolve the field according to their API
         * requirements.
         *
         * @see https://www.iana.org/assignments/media-types/media-types.xhtml
         */
        mediaType: string;
        /**
         * Optional filename of the file.
         */
        filename?: string;
        /**
         * Provider-specific options.
         */
        providerOptions?: ProviderOptions;
    } | {
        /**
         * @deprecated Use 'file' with mediaType + tagged data instead:
         * `{ type: 'file', mediaType, data: { type: 'data', data } }`.
         */
        type: 'file-data';
        /**
         * Base-64 encoded media data.
         */
        data: string;
        /**
         * IANA media type.
         * @see https://www.iana.org/assignments/media-types/media-types.xhtml
         */
        mediaType: string;
        /**
         * Optional filename of the file.
         */
        filename?: string;
        /**
         * Provider-specific options.
         */
        providerOptions?: ProviderOptions;
    } | {
        /**
         * @deprecated Use 'file' with mediaType and tagged data instead:
         * `{ type: 'file', mediaType, data: { type: 'url', url: new URL(url) } }`.
         */
        type: 'file-url';
        /**
         * URL of the file.
         */
        url: string;
        /**
         * IANA media type.
         * @see https://www.iana.org/assignments/media-types/media-types.xhtml
         */
        mediaType?: string;
        /**
         * Provider-specific options.
         */
        providerOptions?: ProviderOptions;
    } | {
        /**
         * @deprecated Use 'file' with tagged data instead:
         * `{ type: 'file', mediaType, data: { type: 'reference', reference } }`.
         */
        type: 'file-id';
        /**
         * ID of the file.
         *
         * If you use multiple providers, you need to
         * specify the provider specific ids using
         * the Record option. The key is the provider
         * name, e.g. 'openai' or 'anthropic'.
         */
        fileId: string | Record<string, string>;
        /**
         * Provider-specific options.
         */
        providerOptions?: ProviderOptions;
    } | {
        /**
         * @deprecated Use 'file' with tagged data instead:
         * `{ type: 'file', mediaType, data: { type: 'reference', reference } }`.
         */
        type: 'file-reference';
        /**
         * Provider-specific references for the file.
         * The key is the provider name, e.g. 'openai' or 'anthropic'.
         */
        providerReference: ProviderReference;
        /**
         * Provider-specific options.
         */
        providerOptions?: ProviderOptions;
    } | {
        /**
         * @deprecated Use 'file' with mediaType (e.g. 'image' or a specific
         * `image/*` subtype) and tagged data instead:
         * `{ type: 'file', mediaType: 'image', data: { type: 'data', data } }`.
         */
        type: 'image-data';
        /**
         * Base-64 encoded image data.
         */
        data: string;
        /**
         * IANA media type.
         * @see https://www.iana.org/assignments/media-types/media-types.xhtml
         */
        mediaType: string;
        /**
         * Provider-specific options.
         */
        providerOptions?: ProviderOptions;
    } | {
        /**
         * @deprecated Use 'file' with `mediaType: 'image'` (or a specific
         * `image/*` subtype) and tagged data instead:
         * `{ type: 'file', mediaType: 'image', data: { type: 'url', url: new URL(url) } }`.
         */
        type: 'image-url';
        /**
         * URL of the image.
         */
        url: string;
        /**
         * Provider-specific options.
         */
        providerOptions?: ProviderOptions;
    } | {
        /**
         * @deprecated Use 'file' with `mediaType: 'image'` (or a specific
         * `image/*` subtype) and tagged data instead:
         * `{ type: 'file', mediaType: 'image', data: { type: 'reference', reference } }`.
         */
        type: 'image-file-id';
        /**
         * Image that is referenced using a provider file id.
         *
         * If you use multiple providers, you need to
         * specify the provider specific ids using
         * the Record option. The key is the provider
         * name, e.g. 'openai' or 'anthropic'.
         */
        fileId: string | Record<string, string>;
        /**
         * Provider-specific options.
         */
        providerOptions?: ProviderOptions;
    } | {
        /**
         * @deprecated Use 'file' with `mediaType: 'image'` (or a specific
         * `image/*` subtype) and tagged data instead:
         * `{ type: 'file', mediaType: 'image', data: { type: 'reference', reference } }`.
         */
        type: 'image-file-reference';
        /**
         * Provider-specific references for the image file.
         * The key is the provider name, e.g. 'openai' or 'anthropic'.
         */
        providerReference: ProviderReference;
        /**
         * Provider-specific options.
         */
        providerOptions?: ProviderOptions;
    } | {
        /**
         * Custom content part. This can be used to implement
         * provider-specific content parts.
         */
        type: 'custom';
        /**
         * Provider-specific options.
         */
        providerOptions?: ProviderOptions;
    }>;
};

type InlineFileData = Extract<FilePart['data'], {
    type: 'data';
} | {
    type: 'text';
}>;
/**
 * Converts inline file data (a tagged `data` or `text` shape) into raw bytes.
 *
 * - `{ type: 'text', text }` → UTF-8 encoded bytes
 * - `{ type: 'data', data: Uint8Array | Buffer }` → returned as-is
 * - `{ type: 'data', data: ArrayBuffer }` → wrapped in a `Uint8Array`
 * - `{ type: 'data', data: string }` → decoded as base64
 */
declare function convertInlineFileDataToUint8Array(data: InlineFileData): Uint8Array;

/**
 * Convert an ImageModelV4File to a URL or data URI string.
 *
 * If the file is a URL, it returns the URL as-is.
 * If the file is base64 data, it returns a data URI with the base64 data.
 * If the file is a Uint8Array, it converts it to base64 and returns a data URI.
 */
declare function convertImageModelFileToDataUri(file: ImageModelV4File): string;

/**
 * Converts an input object to FormData for multipart/form-data requests.
 *
 * Handles the following cases:
 * - `null` or `undefined` values are skipped
 * - Arrays with a single element are appended as a single value
 * - Arrays with multiple elements are appended with `[]` suffix (e.g., `image[]`)
 *   unless `useArrayBrackets` is set to `false`
 * - All other values are appended directly
 *
 * @param input - The input object to convert. Use a generic type for type validation.
 * @param options - Optional configuration object.
 * @param options.useArrayBrackets - Whether to add `[]` suffix for multi-element arrays.
 *   Defaults to `true`. Set to `false` for APIs that expect repeated keys without brackets.
 * @returns A FormData object containing the input values.
 *
 * @example
 * ```ts
 * type MyInput = {
 *   model: string;
 *   prompt: string;
 *   images: Blob[];
 * };
 *
 * const formData = convertToFormData<MyInput>({
 *   model: 'gpt-image-1',
 *   prompt: 'A cat',
 *   images: [blob1, blob2],
 * });
 * ```
 */
declare function convertToFormData<T extends Record<string, unknown>>(input: T, options?: {
    useArrayBrackets?: boolean;
}): FormData;

/**
 * Interface for mapping between custom tool names and provider tool names.
 */
interface ToolNameMapping {
    /**
     * Maps a custom tool name (used by the client) to the provider's tool name.
     * If the custom tool name does not have a mapping, returns the input name.
     *
     * @param customToolName - The custom name of the tool defined by the client.
     * @returns The corresponding provider tool name, or the input name if not mapped.
     */
    toProviderToolName: (customToolName: string) => string;
    /**
     * Maps a provider tool name to the custom tool name used by the client.
     * If the provider tool name does not have a mapping, returns the input name.
     *
     * @param providerToolName - The name of the tool as understood by the provider.
     * @returns The corresponding custom tool name, or the input name if not mapped.
     */
    toCustomToolName: (providerToolName: string) => string;
}
/**
 * @param tools - Tools that were passed to the language model.
 * @param providerToolNames - Maps the provider tool ids to the provider tool names.
 */
declare function createToolNameMapping({ tools, providerToolNames, }: {
    /**
     * Tools that were passed to the language model.
     */
    tools: Array<LanguageModelV4FunctionTool | LanguageModelV4ProviderTool> | undefined;
    /**
     * Maps the provider tool ids to the provider tool names.
     */
    providerToolNames: Record<`${string}.${string}`, string>;
}): ToolNameMapping;

/**
 * Creates a Promise that resolves after a specified delay
 * @param delayInMs - The delay duration in milliseconds. If null or undefined, resolves immediately.
 * @param signal - Optional AbortSignal to cancel the delay
 * @returns A Promise that resolves after the specified delay
 * @throws {DOMException} When the signal is aborted
 */
declare function delay(delayInMs?: number | null, options?: {
    abortSignal?: AbortSignal;
}): Promise<void>;

/**
 * Delayed promise. It is only constructed once the value is accessed.
 * This is useful to avoid unhandled promise rejections when the promise is created
 * but not accessed.
 */
declare class DelayedPromise<T> {
    private status;
    private _promise;
    private _resolve;
    private _reject;
    get promise(): Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
    isResolved(): boolean;
    isRejected(): boolean;
    isPending(): boolean;
}

/**
 * Detect the IANA media type of a file from its raw bytes or base64 string.
 *
 * - When `topLevelType` is omitted, every known signature is considered
 *   (image, audio, video, and application). Returns `undefined` when the
 *   bytes do not match any known signature.
 * - When `topLevelType` is provided, only signatures for that top-level
 *   segment are considered. Returns `undefined` for unsupported segments
 *   (e.g. `"text"`) or when no signature matches.
 */
declare function detectMediaType({ data, topLevelType, }: {
    data: Uint8Array | string;
    topLevelType?: string;
}): string | undefined;
/**
 * Returns the top-level segment of a media type (the portion before `/`).
 *
 * Examples:
 *   - `"image/png"` -> `"image"`
 *   - `"image/*"` -> `"image"`
 *   - `"image"` -> `"image"`
 *   - `"image/"` -> `"image"`
 *   - `""` -> `""`
 *   - `"/"` -> `""`
 */
declare function getTopLevelMediaType(mediaType: string): string;
/**
 * Returns `true` only when the given media type has a non-empty, non-wildcard
 * subtype (i.e. matches the form `type/subtype`, and `subtype` is not `*`).
 *
 * Examples:
 *   - `"image/png"` -> `true`
 *   - `"image/*"` -> `false`
 *   - `"image"` -> `false`
 *   - `"image/"` -> `false`
 *   - `""` -> `false`
 *   - `"/"` -> `false`
 */
declare function isFullMediaType(mediaType: string): boolean;

/**
 * Download a file from a URL and return it as a Blob.
 *
 * @param url - The URL to download from.
 * @param options - Optional settings for the download.
 * @param options.maxBytes - Maximum allowed download size in bytes. Defaults to 100 MiB.
 * @param options.abortSignal - An optional abort signal to cancel the download.
 * @returns A Promise that resolves to the downloaded Blob.
 *
 * @throws DownloadError if the download fails or exceeds maxBytes.
 */
declare function downloadBlob(url: string, options?: {
    maxBytes?: number;
    abortSignal?: AbortSignal;
}): Promise<Blob>;

declare const symbol: unique symbol;
declare class DownloadError extends AISDKError {
    private readonly [symbol];
    readonly url: string;
    readonly statusCode?: number;
    readonly statusText?: string;
    constructor({ url, statusCode, statusText, cause, message, }: {
        url: string;
        statusCode?: number;
        statusText?: string;
        message?: string;
        cause?: unknown;
    });
    static isInstance(error: unknown): error is DownloadError;
}

/**
 * Fetch function type (standardizes the version of fetch used).
 */
type FetchFunction = typeof globalThis.fetch;

/**
 * Fetches a URL while enforcing the download guard on every hop.
 *
 * Redirects are followed manually (`redirect: 'manual'`) so each hop is
 * validated with {@link validateDownloadUrl} *before* it is requested. Relying
 * on the default `redirect: 'follow'` would issue the request to a redirect
 * target (e.g. an internal address) before we ever see its URL, defeating the
 * guard.
 *
 * Request headers are also protected: {@link sanitizeRequestHeaders} strips
 * proxy/metadata/cookie/hop-by-hop headers before the first request, and all
 * caller headers except `User-Agent` are dropped on a cross-origin redirect.
 * The fetch spec only strips `Authorization` on cross-origin redirects because
 * in a browser, CORS preflighting protects custom headers; there is no CORS on
 * the server, so provider API keys carried in custom headers (e.g. `x-key`)
 * must be dropped here as well.
 *
 * A `redirect: 'manual'` request yields an unreadable opaque response in the
 * browser (and in other spec-compliant fetch implementations), so the redirect
 * target cannot be validated here. In a real browser this is safe to follow
 * natively because reaching an internal network is not possible (fetch is
 * constrained by CORS and cannot reach a server's internal network or
 * cloud-metadata). On any other runtime we cannot validate the hop, so we fail
 * closed rather than follow it blindly and bypass the guard.
 *
 * A hop that is same-origin with `trustedOrigin` (the developer-configured
 * provider endpoint) skips target validation: that origin is exactly what an
 * unvalidated, config-derived request would fetch anyway, and validating it
 * would break legitimate self-hosted / localhost deployments whose response
 * URLs point back at the configured host. Hops on any other origin are always
 * validated.
 *
 * The returned response is the final (non-redirect) response. The caller is
 * responsible for checking `response.ok` and reading the body.
 *
 * Not solved here: this does string/literal checks only and does not resolve
 * DNS, so a hostname that *resolves* to a private address, and DNS rebinding
 * (the resolved IP flipping between validation and connect), are not blocked.
 * Server deployments fetching untrusted URLs should constrain egress at the
 * network layer or inject a Node `fetch` that pins the resolved IP at connect
 * time — those need DNS/socket APIs not available on all target runtimes
 * (edge, browser, Bun), so they are intentionally not built in.
 *
 * @throws DownloadError if a hop is unsafe, the redirect limit is exceeded, or
 * a redirect cannot be validated on a non-browser runtime.
 */
declare function fetchWithValidatedRedirects({ url, headers, abortSignal, maxRedirects, fetch, trustedOrigin, }: {
    url: string;
    headers?: HeadersInit;
    abortSignal?: AbortSignal;
    maxRedirects?: number;
    fetch?: FetchFunction;
    /**
     * A developer-configured origin (e.g. the provider's `baseURL`) whose hops
     * skip target validation. Must never be derived from response data.
     */
    trustedOrigin?: string;
}): Promise<Response>;

/**
 * Extracts a 1-based inclusive line range from `text`, auto-detecting the
 * file's line ending (`\r\n`, `\n`, or `\r`, in that priority).
 *
 * Mixed line endings are not supported: detection picks one and uses it for
 * both the split and the rejoin, so files that mix conventions will not slice
 * cleanly. When neither `startLine` nor `endLine` is provided, the input is
 * returned unchanged. `endLine` past EOF clamps to the last line.
 */
declare function extractLines({ text, startLine, endLine, }: {
    text: string;
    startLine?: number;
    endLine?: number;
}): string;

/**
 * Extracts the headers from a response object and returns them as a key-value object.
 *
 * @param response - The response object to extract headers from.
 * @returns The headers as a key-value object.
 */
declare function extractResponseHeaders(response: Response): {
    [k: string]: string;
};

/**
 * Filters `null` and `undefined` values out of a list of values.
 *
 * @param values - The values to filter.
 * @returns A new array containing only non-nullish values.
 */
declare function filterNullable<T>(...values: Array<T | undefined | null>): Array<T>;

/**
 * Creates an ID generator.
 * The total length of the ID is the sum of the prefix, separator, and random part length.
 * Not cryptographically secure.
 *
 * @param alphabet - The alphabet to use for the ID. Default: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.
 * @param prefix - The prefix of the ID to generate. Optional.
 * @param separator - The separator between the prefix and the random part of the ID. Default: '-'.
 * @param size - The size of the random part of the ID to generate. Default: 16.
 */
declare const createIdGenerator: ({ prefix, size, alphabet, separator, }?: {
    prefix?: string;
    separator?: string;
    size?: number;
    alphabet?: string;
}) => IdGenerator;
/**
 * A function that generates an ID.
 */
type IdGenerator = () => string;
/**
 * Generates a 16-character random string to use for IDs.
 * Not cryptographically secure.
 */
declare const generateId: IdGenerator;

/**
 * Used to mark schemas so we can support both Zod and custom schemas.
 */
declare const schemaSymbol: unique symbol;
type ValidationResult<OBJECT> = {
    success: true;
    value: OBJECT;
} | {
    success: false;
    error: Error;
};
type Schema<OBJECT = unknown> = {
    /**
     * Used to mark schemas so we can support both Zod and custom schemas.
     */
    [schemaSymbol]: true;
    /**
     * Schema type for inference.
     */
    _type: OBJECT;
    /**
     * Optional. Validates that the structure of a value matches this schema,
     * and returns a typed version of the value if it does.
     */
    readonly validate?: (value: unknown) => ValidationResult<OBJECT> | PromiseLike<ValidationResult<OBJECT>>;
    /**
     * The JSON Schema for the schema. It is passed to the providers.
     */
    readonly jsonSchema: JSONSchema7 | PromiseLike<JSONSchema7>;
};
/**
 * Creates a schema with deferred creation.
 * This is important to reduce the startup time of the library
 * and to avoid initializing unused validators.
 *
 * @param createValidator A function that creates a schema.
 * @returns A function that returns a schema.
 */
declare function lazySchema<SCHEMA>(createSchema: () => Schema<SCHEMA>): LazySchema<SCHEMA>;
type LazySchema<SCHEMA> = () => Schema<SCHEMA>;
type ZodSchema<SCHEMA = any> = z3.Schema<SCHEMA, z3.ZodTypeDef, any> | z4.core.$ZodType<SCHEMA, any>;
type StandardSchema<SCHEMA = any> = StandardSchemaV1<unknown, SCHEMA> & {
    readonly '~standard': StandardSchemaV1.Props<unknown, SCHEMA> & {
        readonly jsonSchema?: StandardJSONSchemaV1.Converter;
    };
};
type FlexibleSchema<SCHEMA = any> = Schema<SCHEMA> | LazySchema<SCHEMA> | ZodSchema<SCHEMA> | StandardSchema<SCHEMA>;
type InferSchema<SCHEMA> = SCHEMA extends ZodSchema<infer T> ? T : SCHEMA extends StandardSchema<infer T> ? T : SCHEMA extends LazySchema<infer T> ? T : SCHEMA extends Schema<infer T> ? T : never;
/**
 * Create a schema using a JSON Schema.
 *
 * @param jsonSchema The JSON Schema for the schema.
 * @param options.validate Optional. A validation function for the schema.
 */
declare function jsonSchema<OBJECT = unknown>(jsonSchema: JSONSchema7 | PromiseLike<JSONSchema7> | (() => JSONSchema7 | PromiseLike<JSONSchema7>), { validate, }?: {
    validate?: (value: unknown) => ValidationResult<OBJECT> | PromiseLike<ValidationResult<OBJECT>>;
}): Schema<OBJECT>;
declare function asSchema<OBJECT>(schema: FlexibleSchema<OBJECT> | undefined): Schema<OBJECT>;
declare function zodSchema<OBJECT>(zodSchema: z4.core.$ZodType<OBJECT, any> | z3.Schema<OBJECT, z3.ZodTypeDef, any>, options?: {
    /**
     * Enables support for references in the schema.
     * This is required for recursive schemas, e.g. with `z.lazy`.
     * However, not all language models and providers support such references.
     * Defaults to `false`.
     */
    useReferences?: boolean;
}): Schema<OBJECT>;

/**
 * Parses a JSON string into an unknown object.
 *
 * @param text - The JSON string to parse.
 * @returns {JSONValue} - The parsed JSON object.
 */
declare function parseJSON(options: {
    text: string;
    schema?: undefined;
}): Promise<JSONValue>;
/**
 * Parses a JSON string into a strongly-typed object using the provided schema.
 *
 * @template T - The type of the object to parse the JSON into.
 * @param {string} text - The JSON string to parse.
 * @param {Validator<T>} schema - The schema to use for parsing the JSON.
 * @returns {Promise<T>} - The parsed object.
 */
declare function parseJSON<T>(options: {
    text: string;
    schema: FlexibleSchema<T>;
}): Promise<T>;
type ParseResult<T> = {
    success: true;
    value: T;
    rawValue: unknown;
} | {
    success: false;
    error: JSONParseError | TypeValidationError;
    rawValue: unknown;
};
/**
 * Safely parses a JSON string and returns the result as an object of type `unknown`.
 *
 * @param text - The JSON string to parse.
 * @returns {Promise<object>} Either an object with `success: true` and the parsed data, or an object with `success: false` and the error that occurred.
 */
declare function safeParseJSON(options: {
    text: string;
    schema?: undefined;
}): Promise<ParseResult<JSONValue>>;
/**
 * Safely parses a JSON string into a strongly-typed object, using a provided schema to validate the object.
 *
 * @template T - The type of the object to parse the JSON into.
 * @param {string} text - The JSON string to parse.
 * @param {Validator<T>} schema - The schema to use for parsing the JSON.
 * @returns An object with either a `success` flag and the parsed and typed data, or a `success` flag and an error object.
 */
declare function safeParseJSON<T>(options: {
    text: string;
    schema: FlexibleSchema<T>;
}): Promise<ParseResult<T>>;
declare function isParsableJson(input: string): boolean;

type ResponseHandler<RETURN_TYPE> = (options: {
    url: string;
    requestBodyValues: unknown;
    response: Response;
}) => PromiseLike<{
    value: RETURN_TYPE;
    rawValue?: unknown;
    responseHeaders?: Record<string, string>;
}>;
declare const createJsonErrorResponseHandler: <T>({ errorSchema, errorToMessage, isRetryable, }: {
    errorSchema: FlexibleSchema<T>;
    errorToMessage: (error: T) => string;
    isRetryable?: (response: Response, error?: T) => boolean;
}) => ResponseHandler<APICallError>;
declare const createEventSourceResponseHandler: <T>(chunkSchema: FlexibleSchema<T>) => ResponseHandler<ReadableStream<ParseResult<T>>>;
declare const createJsonResponseHandler: <T>(responseSchema: FlexibleSchema<T>) => ResponseHandler<T>;
declare const createBinaryResponseHandler: () => ResponseHandler<Uint8Array>;
declare const createStatusCodeErrorResponseHandler: () => ResponseHandler<APICallError>;

declare const getFromApi: <T>({ url, headers, successfulResponseHandler, failedResponseHandler, abortSignal, fetch, validateUrl, credentialedOrigin, trustedOrigin, }: {
    url: string;
    headers?: Record<string, string | undefined>;
    failedResponseHandler: ResponseHandler<Error>;
    successfulResponseHandler: ResponseHandler<T>;
    abortSignal?: AbortSignal;
    fetch?: FetchFunction;
    /**
     * Set `true` when `url` is untrusted (e.g. taken from a provider response
     * body): it is routed through {@link fetchWithValidatedRedirects}, which
     * rejects private/loopback/link-local targets and re-validates redirect
     * hops; blocked URLs throw `DownloadError`. Set `false` only for URLs built
     * from a developer-configured endpoint.
     *
     * Optional for backwards compatibility with existing callers; omitting it
     * behaves like `false` (no validation). Provider code in this repository
     * must always pass it explicitly so every call site makes a visible trust
     * decision — see `contributing/secure-url-handling.md`.
     */
    validateUrl?: boolean;
    /**
     * When set, `headers` are sent only if `url` is same-origin with this origin
     * (the user-agent suffix is always kept). Pass the provider's configured
     * base URL alongside `validateUrl: true` so credentials never ride a request
     * to a response-supplied host on a different origin (e.g. a CDN). Redirects
     * that later cross origin drop all caller headers regardless (see
     * {@link fetchWithValidatedRedirects}).
     */
    credentialedOrigin?: string;
    /**
     * A developer-configured origin (e.g. the provider's `baseURL`) that is
     * exempt from URL validation when `validateUrl` is `true`. A response URL
     * (or redirect hop) that is same-origin with it is fetched without target
     * validation — it points at exactly the host a config-derived
     * `validateUrl: false` request would fetch anyway, so blocking it would
     * only break legitimate self-hosted / localhost deployments whose response
     * URLs point back at the configured host. Hops on any other origin are
     * still validated. Must never be derived from response data.
     */
    trustedOrigin?: string;
}) => Promise<{
    value: T;
    rawValue?: unknown;
    responseHeaders?: Record<string, string>;
}>;

declare function getRuntimeEnvironmentUserAgent(globalThisAny?: any): string;

/**
 * Checks if an object has required keys.
 * @param OBJECT - The object to check.
 * @returns True if the object has required keys, false otherwise.
 */
type HasRequiredKey<OBJECT> = {} extends OBJECT ? false : true;

declare function injectJsonInstructionIntoMessages({ messages, schema, schemaPrefix, schemaSuffix, }: {
    messages: LanguageModelV4Prompt;
    schema?: JSONSchema7;
    schemaPrefix?: string;
    schemaSuffix?: string;
}): LanguageModelV4Prompt;

declare function isAbortError(error: unknown): error is Error;

/**
 * Returns `true` when running in a browser.
 *
 * Detection keys on the presence of a global `window`, matching the browser
 * check used elsewhere in this package (see `getRuntimeEnvironmentUserAgent`)
 * so the SDK has a single, consistent definition of "browser". Server runtimes
 * (Node.js, Deno, Bun, edge/workers) do not define `window`.
 */
declare function isBrowserRuntime(globalThisAny?: any): boolean;

/**
 * Type-guard for Node.js `Buffer` instances.
 *
 * Uses optional chaining on `globalThis.Buffer` so it returns `false` in
 * runtimes where `Buffer` is not available (e.g. CloudFlare Workers).
 */
declare function isBuffer(value: unknown): value is Buffer;

/**
 * Returns true when `url` has the same origin (scheme + host + port) as
 * `baseUrl`.
 *
 * Used to decide whether provider credentials may be attached to a request to a
 * URL taken from a provider response (e.g. a polling or media-download URL).
 * Credentials must only be sent to the provider's own origin; a response that
 * names a foreign host (a CDN, or an attacker-controlled host if the response
 * is tampered with) must not receive the API key.
 *
 * Returns false if either value is not a valid absolute URL (fail-closed).
 */
declare function isSameOrigin(url: string, baseUrl: string): boolean;

/**
 * Type guard that checks whether a value is not `null` or `undefined`.
 *
 * @template T - The type of the value to check.
 * @param value - The value to check.
 * @returns `true` if the value is neither `null` nor `undefined`, otherwise `false`.
 */
declare function isNonNullable<T>(value: T | undefined | null): value is NonNullable<T>;

/**
 * Checks whether a value is a provider reference (a mapping of provider names
 * to provider-specific identifiers) as opposed to raw bytes, a URL, or a
 * tagged `{ type: ... }` object.
 */
declare function isProviderReference(data: unknown): data is SharedV4ProviderReference;

/**
 * Checks if the given URL is supported natively by the model.
 *
 * @param mediaType - The media type of the URL. Case-sensitive. May be a full
 *                    `type/subtype`, a wildcard `type/*`, or just the
 *                    top-level segment (e.g. `image`).
 * @param url - The URL to check.
 * @param supportedUrls - A record where keys are case-sensitive media types (or '*')
 *                        and values are arrays of RegExp patterns for URLs.
 *
 * @returns `true` if the URL matches a pattern under the specific media type
 *          or the wildcard '*', `false` otherwise.
 */
declare function isUrlSupported({ mediaType, url, supportedUrls, }: {
    mediaType: string;
    url: string;
    supportedUrls: Record<string, RegExp[]>;
}): boolean;

declare function loadApiKey({ apiKey, environmentVariableName, apiKeyParameterName, description, }: {
    apiKey: string | undefined;
    environmentVariableName: string;
    apiKeyParameterName?: string;
    description: string;
}): string;

/**
 * Loads an optional `string` setting from the environment or a parameter.
 *
 * @param settingValue - The setting value.
 * @param environmentVariableName - The environment variable name.
 * @returns The setting value.
 */
declare function loadOptionalSetting({ settingValue, environmentVariableName, }: {
    settingValue: string | undefined;
    environmentVariableName: string;
}): string | undefined;

/**
 * Loads a `string` setting from the environment or a parameter.
 *
 * @param settingValue - The setting value.
 * @param environmentVariableName - The environment variable name.
 * @param settingName - The setting name.
 * @param description - The description of the setting.
 * @returns The setting value.
 */
declare function loadSetting({ settingValue, environmentVariableName, settingName, description, }: {
    settingValue: string | undefined;
    environmentVariableName: string;
    settingName: string;
    description: string;
}): string;

type ReasoningLevel = Exclude<LanguageModelV4CallOptions['reasoning'], 'none' | 'provider-default' | undefined>;
declare function isCustomReasoning(reasoning: LanguageModelV4CallOptions['reasoning']): reasoning is Exclude<LanguageModelV4CallOptions['reasoning'], 'provider-default' | undefined>;
/**
 * Maps a top-level reasoning level to a provider-specific effort string using
 * the given effort map. Pushes a compatibility warning if the reasoning level
 * maps to a different string, or an unsupported warning if the level is not
 * present in the map.
 *
 * @returns The mapped effort string, or `undefined` if the level is not
 *   supported.
 */
declare function mapReasoningToProviderEffort<T extends string>({ reasoning, effortMap, warnings, }: {
    reasoning: ReasoningLevel;
    effortMap: Partial<Record<ReasoningLevel, T>>;
    warnings: SharedV4Warning[];
}): T | undefined;
/**
 * Maps a top-level reasoning level to an absolute token budget by multiplying
 * the model's max output tokens by a percentage from the budget percentages
 * map. The result is clamped between `minReasoningBudget` (default 1024) and
 * `maxReasoningBudget`. Pushes an unsupported warning if the level is not
 * present in the budget percentages map.
 *
 * @returns The computed token budget, or `undefined` if the level is not
 *   supported.
 */
declare function mapReasoningToProviderBudget({ reasoning, maxOutputTokens, maxReasoningBudget, minReasoningBudget, budgetPercentages, warnings, }: {
    reasoning: ReasoningLevel;
    maxOutputTokens: number;
    maxReasoningBudget: number;
    minReasoningBudget?: number;
    budgetPercentages?: Partial<Record<ReasoningLevel, number>>;
    warnings: SharedV4Warning[];
}): number | undefined;

/**
 * A value that can be provided either synchronously or as a promise-like.
 */
type MaybePromiseLike<T> = T | PromiseLike<T>;

/**
 * Maps a media type to its corresponding file extension.
 * It was originally introduced to set a filename for audio file uploads
 * in https://github.com/vercel/ai/pull/8159.
 *
 * @param mediaType The media type to map.
 * @returns The corresponding file extension
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/MIME_types/Common_types
 */
declare function mediaTypeToExtension(mediaType: string): string;

/**
 * Normalizes different header inputs into a plain record with lower-case keys.
 * Entries with `undefined` or `null` values are removed.
 *
 * @param headers - Input headers (`Headers`, tuples array, plain record) to normalize.
 * @returns A record containing the normalized header entries.
 */
declare function normalizeHeaders(headers: HeadersInit | Record<string, string | undefined> | Array<[string, string | undefined]> | undefined): Record<string, string>;

/**
 * Parses a JSON event stream into a stream of parsed JSON objects.
 */
declare function parseJsonEventStream<T>({ stream, schema, }: {
    stream: ReadableStream<Uint8Array>;
    schema: FlexibleSchema<T>;
}): ReadableStream<ParseResult<T>>;

declare function parseProviderOptions<OPTIONS>({ provider, providerOptions, schema, }: {
    provider: string;
    providerOptions: Record<string, unknown> | undefined;
    schema: FlexibleSchema<OPTIONS>;
}): Promise<OPTIONS | undefined>;

declare const postJsonToApi: <T>({ url, headers, body, failedResponseHandler, successfulResponseHandler, abortSignal, fetch, }: {
    url: string;
    headers?: Record<string, string | undefined>;
    body: unknown;
    failedResponseHandler: ResponseHandler<APICallError>;
    successfulResponseHandler: ResponseHandler<T>;
    abortSignal?: AbortSignal;
    fetch?: FetchFunction;
}) => Promise<{
    value: T;
    rawValue?: unknown;
    responseHeaders?: Record<string, string>;
}>;
declare const postFormDataToApi: <T>({ url, headers, formData, failedResponseHandler, successfulResponseHandler, abortSignal, fetch, }: {
    url: string;
    headers?: Record<string, string | undefined>;
    formData: FormData;
    failedResponseHandler: ResponseHandler<APICallError>;
    successfulResponseHandler: ResponseHandler<T>;
    abortSignal?: AbortSignal;
    fetch?: FetchFunction;
}) => Promise<{
    value: T;
    rawValue?: unknown;
    responseHeaders?: Record<string, string>;
}>;
declare const postToApi: <T>({ url, headers, body, successfulResponseHandler, failedResponseHandler, abortSignal, fetch, }: {
    url: string;
    headers?: Record<string, string | undefined>;
    body: {
        content: string | FormData | Uint8Array;
        values: unknown;
    };
    failedResponseHandler: ResponseHandler<Error>;
    successfulResponseHandler: ResponseHandler<T>;
    abortSignal?: AbortSignal;
    fetch?: FetchFunction;
}) => Promise<{
    value: T;
    rawValue?: unknown;
    responseHeaders?: Record<string, string>;
}>;

/**
 * A context object that is passed into tool execution.
 */
type Context = Record<string, unknown>;

/**
 * A tool that is guaranteed to expose an execute function.
 */
type ExecutableTool<TOOL extends Tool = Tool> = TOOL & {
    execute: NonNullable<TOOL['execute']>;
};
/**
 * Checks whether a tool exposes an execute function.
 */
declare function isExecutableTool<TOOL extends Tool>(tool: TOOL | undefined): tool is ExecutableTool<TOOL>;

type NeverOptional<N, T> = 0 extends 1 & N ? Partial<T> : [N] extends [never] ? Partial<Record<keyof T, undefined>> : T;

/**
 * Tool approval request prompt part.
 */
type ToolApprovalRequest = {
    type: 'tool-approval-request';
    /**
     * ID of the tool approval.
     */
    approvalId: string;
    /**
     * ID of the tool call that the approval request is for.
     */
    toolCallId: string;
    /**
     * Flag indicating whether the tool was automatically approved or denied.
     *
     * @default false
     */
    isAutomatic?: boolean;
    /**
     * HMAC-SHA256 signature binding this approval to its tool call.
     * Present only when `experimental_toolApprovalSecret` is configured.
     */
    signature?: string;
};

/**
 * An assistant message. It can contain text, tool calls, or a combination of text and tool calls.
 */
type AssistantModelMessage = {
    role: 'assistant';
    content: AssistantContent;
    /**
     * Additional provider-specific metadata. They are passed through
     * to the provider from the AI SDK and enable provider-specific
     * functionality that can be fully encapsulated in the provider.
     */
    providerOptions?: ProviderOptions;
};
/**
 * Content of an assistant message.
 * It can be a string or an array of text, image, reasoning, redacted reasoning, and tool call parts.
 */
type AssistantContent = string | Array<TextPart | CustomPart | FilePart | ReasoningPart | ReasoningFilePart | ToolCallPart | ToolResultPart | ToolApprovalRequest>;

/**
 * A system message. It can contain system information.
 *
 * Note: using the "system" part of the prompt is strongly preferred
 * to increase the resilience against prompt injection attacks,
 * and because not all providers support several system messages.
 */
type SystemModelMessage = {
    role: 'system';
    content: string;
    /**
     * Additional provider-specific metadata. They are passed through
     * to the provider from the AI SDK and enable provider-specific
     * functionality that can be fully encapsulated in the provider.
     */
    providerOptions?: ProviderOptions;
};

/**
 * Tool approval response prompt part.
 */
type ToolApprovalResponse = {
    type: 'tool-approval-response';
    /**
     * ID of the tool approval.
     */
    approvalId: string;
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

/**
 * A tool message. It contains the result of one or more tool calls.
 */
type ToolModelMessage = {
    role: 'tool';
    content: ToolContent;
    /**
     * Additional provider-specific metadata. They are passed through
     * to the provider from the AI SDK and enable provider-specific
     * functionality that can be fully encapsulated in the provider.
     */
    providerOptions?: ProviderOptions;
};
/**
 * Content of a tool message. It is an array of tool result parts.
 */
type ToolContent = Array<ToolResultPart | ToolApprovalResponse>;

/**
 * A user message. It can contain text or a combination of text and images.
 */
type UserModelMessage = {
    role: 'user';
    content: UserContent;
    /**
     * Additional provider-specific metadata. They are passed through
     * to the provider from the AI SDK and enable provider-specific
     * functionality that can be fully encapsulated in the provider.
     */
    providerOptions?: ProviderOptions;
};
/**
 * Content of a user message. It can be a string or an array of text and image parts.
 */
type UserContent = string | Array<TextPart | ImagePart | FilePart>;

/**
 * A message that can be used in the `messages` field of a prompt.
 * It can be a user message, an assistant message, or a tool message.
 */
type ModelMessage = SystemModelMessage | UserModelMessage | AssistantModelMessage | ToolModelMessage;

/**
 * Options for executing a command in the sandbox via `run` or `spawn`.
 */
type SandboxProcessOptions = {
    /**
     * Command to execute in the sandbox.
     */
    command: string;
    /**
     * Working directory to execute the command in.
     */
    workingDirectory?: string;
    /**
     * Environment variables to set for this command. Merged with the
     * sandbox's default environment; values here take precedence.
     * Supporting environment variables as an option is preferable from a
     * security perspective, e.g. to avoid them leaking in logs.
     */
    env?: Record<string, string>;
    /**
     * Signal that can be used to abort the command. When aborted, the running
     * process is killed; for `spawn`, `wait()` rejects with the abort reason.
     */
    abortSignal?: AbortSignal;
};
/**
 * Options for reading a file from the sandbox.
 */
type ReadFileOptions = {
    /**
     * Path of the file to read.
     */
    path: string;
    /**
     * Signal that can be used to abort the read.
     */
    abortSignal?: AbortSignal;
};
/**
 * Options for writing a file to the sandbox. `CONTENT` is the payload written
 * to the file: a byte stream, raw bytes, or a string.
 */
type WriteFileOptions<CONTENT> = {
    /**
     * Path of the file to write.
     */
    path: string;
    /**
     * Content to write to the file.
     */
    content: CONTENT;
    /**
     * Signal that can be used to abort the write.
     */
    abortSignal?: AbortSignal;
};
/**
 * Sandbox session that can execute commands and read/write files.
 */
type SandboxSession = {
    /**
     * Description of the sandbox environment that can be added to the agent's instructions
     * so that the agent knows about relevant details such as the root directory, exposed
     * ports, the public hostname, etc.
     */
    readonly description: string;
    /**
     * Read one file from the sandbox as a stream of bytes. Resolves to `null`
     * when the file does not exist.
     *
     * Relative path handling is implementation-defined. This is the lowest-level
     * read primitive; prefer `readBinaryFile` or `readTextFile` unless you need
     * to stream bytes.
     */
    readonly readFile: (options: ReadFileOptions) => PromiseLike<ReadableStream<Uint8Array> | null>;
    /**
     * Read one file from the sandbox as raw bytes. Resolves to `null` when the
     * file does not exist.
     */
    readonly readBinaryFile: (options: ReadFileOptions) => PromiseLike<Uint8Array | null>;
    /**
     * Read one text file from the sandbox, decoded using the requested encoding.
     * Resolves to `null` when the file does not exist.
     *
     * Line ranges are 1-based and inclusive. When `endLine` is past EOF the read
     * returns through EOF without error.
     */
    readonly readTextFile: (options: ReadFileOptions & {
        /**
         * Text encoding used to decode the file bytes. Defaults to `"utf-8"`.
         */
        encoding?: string;
        /**
         * 1-based inclusive start line. Defaults to 1.
         */
        startLine?: number;
        /**
         * 1-based inclusive end line. When past the file's line count, the read
         * returns through EOF without error.
         */
        endLine?: number;
    }) => PromiseLike<string | null>;
    /**
     * Write one file to the sandbox from a stream of bytes. Creates parent
     * directories recursively and overwrites any existing file.
     *
     * This is the lowest-level write primitive; prefer `writeBinaryFile` or
     * `writeTextFile` when the full content is already materialized in memory.
     */
    readonly writeFile: (options: WriteFileOptions<ReadableStream<Uint8Array>>) => PromiseLike<void>;
    /**
     * Write one file to the sandbox from raw bytes. Creates parent directories
     * recursively and overwrites any existing file.
     */
    readonly writeBinaryFile: (options: WriteFileOptions<Uint8Array>) => PromiseLike<void>;
    /**
     * Write one file to the sandbox from a string, encoded using the requested
     * encoding. Creates parent directories recursively and overwrites any
     * existing file.
     */
    readonly writeTextFile: (options: WriteFileOptions<string> & {
        /**
         * Text encoding used to encode the string to bytes. Defaults to `"utf-8"`.
         */
        encoding?: string;
    }) => PromiseLike<void>;
    /**
     * Spawn a long-running process in the sandbox. Returns immediately with a
     * handle that streams stdout/stderr, can be waited on, and can be killed.
     *
     * `run` is conceptually a thin wrapper over this primitive: spawn,
     * collect both streams to strings, await `wait()`, return the result.
     */
    readonly spawn: (options: SandboxProcessOptions) => PromiseLike<SandboxProcess>;
    /**
     * Run a command in the sandbox.
     */
    readonly run: (options: SandboxProcessOptions) => PromiseLike<{
        /**
         * Exit code returned by the command.
         */
        exitCode: number;
        /**
         * Standard output produced by the command.
         */
        stdout: string;
        /**
         * Standard error produced by the command.
         */
        stderr: string;
    }>;
};
/**
 * Handle to a long-running process started via `SandboxSession.spawn`.
 */
type SandboxProcess = {
    /**
     * Process identifier, if the sandbox implementation exposes one.
     */
    readonly pid?: number;
    /**
     * Stream of bytes written by the process to standard output.
     */
    readonly stdout: ReadableStream<Uint8Array>;
    /**
     * Stream of bytes written by the process to standard error.
     */
    readonly stderr: ReadableStream<Uint8Array>;
    /**
     * Resolve when the process exits, yielding its exit code.
     */
    wait(): PromiseLike<{
        exitCode: number;
    }>;
    /**
     * Terminate the process. Idempotent.
     */
    kill(): PromiseLike<void>;
};

/**
 * Additional options that are sent into each tool execution.
 */
interface ToolExecutionOptions<CONTEXT extends Context | unknown | never> {
    /**
     * The ID of the tool call. You can use it e.g. when sending tool-call related information with stream data.
     */
    toolCallId: string;
    /**
     * Messages that were sent to the language model to initiate the response that contained the tool call.
     * The messages **do not** include the system prompt nor the assistant response that contained the tool call.
     */
    messages: ModelMessage[];
    /**
     * An optional abort signal that indicates that the overall operation should be aborted.
     */
    abortSignal?: AbortSignal;
    /**
     * Tool context as defined by the tool's context schema.
     * The tool context is specific to the tool and is passed to the tool execution.
     *
     * Treat the context object as immutable inside tools.
     * Mutating the context object can lead to race conditions and unexpected results
     * when tools are called in parallel.
     *
     * If you need to mutate the context, analyze the tool calls and results
     * in `prepareStep` and update it there.
     */
    context: CONTEXT;
    /**
     * The sandbox environment that the tool is operating in.
     */
    experimental_sandbox?: SandboxSession;
}
/**
 * Function that executes the tool and returns either a single result or a stream of results.
 */
type ToolExecuteFunction<INPUT, OUTPUT, CONTEXT extends Context | unknown | never> = (input: INPUT, options: ToolExecutionOptions<CONTEXT>) => AsyncIterable<OUTPUT> | PromiseLike<OUTPUT> | OUTPUT;

/**
 * Function that is called to determine if the tool needs approval before it can be executed.
 *
 * @deprecated Tool approval is handled on a `generateText` / `streamText` level now.
 */
type ToolNeedsApprovalFunction<INPUT, CONTEXT extends Context | unknown | never> = (input: INPUT, options: {
    /**
     * The ID of the tool call. You can use it e.g. when sending tool-call related information with stream data.
     */
    toolCallId: string;
    /**
     * Messages that were sent to the language model to initiate the response that contained the tool call.
     * The messages **do not** include the system prompt nor the assistant response that contained the tool call.
     */
    messages: ModelMessage[];
    /**
     * Tool context as defined by the tool's context schema.
     * The tool context is specific to the tool and is passed to the tool execution.
     *
     * Treat the context object as immutable inside tools.
     * Mutating the context object can lead to race conditions and unexpected results
     * when tools are called in parallel.
     *
     * If you need to mutate the context, analyze the tool calls and results
     * in `prepareStep` and update it there.
     */
    context: CONTEXT;
}) => boolean | PromiseLike<boolean>;

/**
 * Helper type to determine the outputSchema and execute function properties of a tool.
 */
type ToolOutputProperties<INPUT, OUTPUT, CONTEXT extends Context | unknown | never> = NeverOptional<OUTPUT, {
    /**
     * The optional schema of the output that the tool produces.
     *
     * If not provided, the output shape will be inferred from the execute function.
     */
    outputSchema?: FlexibleSchema<OUTPUT>;
    /**
     * An async function that is called with the arguments from the tool call and produces a result.
     * If not provided, the tool will not be executed automatically.
     *
     * @args is the input of the tool call.
     * @options.abortSignal is a signal that can be used to abort the tool call.
     */
    execute: ToolExecuteFunction<INPUT, OUTPUT, CONTEXT>;
} | {
    /**
     * The schema of the output that the tool produces.
     *
     * Required when no execute function is provided.
     */
    outputSchema: FlexibleSchema<OUTPUT>;
    execute?: never;
}>;
/**
 * Common properties shared by all tool kinds.
 */
type BaseTool<INPUT extends JSONValue | unknown | never = any, OUTPUT extends JSONValue | unknown | never = any, CONTEXT extends Context | unknown | never = any> = {
    /**
     * An optional title of the tool.
     *
     * @deprecated Use `providerMetadata` for source-specific tool display metadata.
     */
    title?: string;
    /**
     * Additional provider-specific metadata. They are passed through
     * to the provider from the AI SDK and enable provider-specific
     * functionality that can be fully encapsulated in the provider.
     */
    providerOptions?: ProviderOptions;
    /**
     * Optional metadata about the tool itself (e.g. its source).
     *
     * Unlike `providerOptions`, this metadata is not sent to the language
     * model. Instead, it is propagated onto the resulting tool call's
     * `toolMetadata` so consumers can read it from tool call / result parts
     * and UI message parts. This is useful for sources of dynamic tools (e.g.
     * an MCP server) to identify themselves.
     */
    metadata?: JSONObject;
    /**
     * The schema of the input that the tool expects.
     * The language model will use this to generate the input.
     * It is also used to validate the output of the language model.
     *
     * You can use descriptions on the schema properties to make the input understandable for the language model.
     */
    inputSchema: FlexibleSchema<INPUT>;
    /**
     * An optional schema describing the context that the tool expects.
     *
     * The context is passed to execute function as part of the execution options.
     */
    contextSchema?: FlexibleSchema<CONTEXT>;
    /**
     * Whether the tool needs approval before it can be executed.
     *
     * @deprecated Tool approval is handled on a `generateText` / `streamText` level now.
     */
    needsApproval?: boolean | ToolNeedsApprovalFunction<[
        INPUT
    ] extends [never] ? unknown : INPUT, NoInfer<CONTEXT>>;
    /**
     * Optional function that is called when the model starts generating the tool input.
     * In non-streaming contexts, it is called immediately before `onInputAvailable`.
     */
    onInputStart?: (options: ToolExecutionOptions<NoInfer<CONTEXT>>) => void | PromiseLike<void>;
    /**
     * Optional function that is called when an argument streaming delta is available.
     * Only called when the tool is used in a streaming context.
     */
    onInputDelta?: (options: {
        inputTextDelta: string;
    } & ToolExecutionOptions<NoInfer<CONTEXT>>) => void | PromiseLike<void>;
    /**
     * Optional function that is called when a tool call can be started,
     * even if the execute function is not provided.
     */
    onInputAvailable?: (options: {
        input: [INPUT] extends [never] ? unknown : INPUT;
    } & ToolExecutionOptions<NoInfer<CONTEXT>>) => void | PromiseLike<void>;
    /**
     * Optional conversion function that maps the tool result to an output that can be used by the language model.
     *
     * If not provided, the tool result will be sent as a JSON object.
     *
     * This function is invoked on the server by `convertToModelMessages`, so ensure that you pass the same "tools" (ToolSet) to both "convertToModelMessages" and "streamText" (or other generation APIs).
     */
    toModelOutput?: (options: {
        /**
         * The ID of the tool call. You can use it e.g. when sending tool-call related information with stream data.
         */
        toolCallId: string;
        /**
         * The input of the tool call.
         */
        input: [INPUT] extends [never] ? unknown : INPUT;
        /**
         * The output of the tool call.
         */
        output: 0 extends 1 & OUTPUT ? any : [OUTPUT] extends [never] ? any : NoInfer<OUTPUT>;
    }) => ToolResultOutput | PromiseLike<ToolResultOutput>;
} & ToolOutputProperties<INPUT, OUTPUT, NoInfer<CONTEXT>>;
/**
 * Common properties shared by function-style tools.
 */
type BaseFunctionTool<INPUT extends JSONValue | unknown | never = any, OUTPUT extends JSONValue | unknown | never = any, CONTEXT extends Context | unknown | never = any> = BaseTool<INPUT, OUTPUT, CONTEXT> & {
    /**
     * Optional description of what the tool does.
     *
     * Included in the tool definition sent to the language model so it can
     * decide when and how to call the tool.
     *
     * Provide a string for a fixed description, or a function that returns a
     * string from the current `context` (and optional `experimental_sandbox`) when the
     * description should vary per call.
     */
    description?: string | ((options: {
        context: NoInfer<CONTEXT>;
        experimental_sandbox?: SandboxSession;
    }) => string);
    /**
     * Strict mode setting for the tool.
     *
     * Providers that support strict mode will use this setting to determine
     * how the input should be generated. Strict mode will always produce
     * valid inputs, but it might limit what input schemas are supported.
     */
    strict?: boolean;
    /**
     * An optional list of input examples that show the language
     * model what the input should look like.
     */
    inputExamples?: Array<{
        input: NoInfer<INPUT>;
    }>;
    id?: never;
    isProviderExecuted?: never;
    args?: never;
    supportsDeferredResults?: never;
};
/**
 * Tool with user-defined input and output schemas that is executed by the AI SDK.
 */
type FunctionTool<INPUT extends JSONValue | unknown | never = any, OUTPUT extends JSONValue | unknown | never = any, CONTEXT extends Context | unknown | never = any> = BaseFunctionTool<INPUT, OUTPUT, CONTEXT> & {
    type?: undefined | 'function';
};
/**
 * Tool that is defined at runtime.
 * The types of input and output are not known at development time.
 *
 * For example, MCP tools that are not known at development time.
 */
type DynamicTool<INPUT extends JSONValue | unknown | never = any, OUTPUT extends JSONValue | unknown | never = any, CONTEXT extends Context | unknown | never = any> = BaseFunctionTool<INPUT, OUTPUT, CONTEXT> & {
    type: 'dynamic';
};
/**
 * Common properties shared by provider tools.
 */
type BaseProviderTool<INPUT extends JSONValue | unknown | never = any, OUTPUT extends JSONValue | unknown | never = any, CONTEXT extends Context | unknown | never = any> = BaseTool<INPUT, OUTPUT, CONTEXT> & {
    type: 'provider';
    /**
     * The ID of the tool. Must follow the format `<provider-name>.<unique-tool-name>`.
     */
    id: `${string}.${string}`;
    /**
     * The arguments for configuring the tool. Must match the expected arguments defined by the provider for this tool.
     */
    args: Record<string, unknown>;
    description?: never;
    strict?: never;
    inputExamples?: never;
};
/**
 * Tool with provider-defined input and output schemas that is executed by the
 * user.
 *
 * For example, shell tools that are executed in a local shell, but have provider-defined input and output schemas.
 */
type ProviderDefinedTool<INPUT extends JSONValue | unknown | never = any, OUTPUT extends JSONValue | unknown | never = any, CONTEXT extends Context | unknown | never = any> = BaseProviderTool<INPUT, OUTPUT, CONTEXT> & {
    /**
     * Flag that indicates whether the tool is executed by the provider.
     */
    isProviderExecuted: false;
    supportsDeferredResults?: never;
};
/**
 * Tool with provider-defined input and output schemas that is executed by the
 * provider.
 *
 * For example, web search tools and code execution tools that are executed by the provider itself.
 */
type ProviderExecutedTool<INPUT extends JSONValue | unknown | never = any, OUTPUT extends JSONValue | unknown | never = any, CONTEXT extends Context | unknown | never = any> = BaseProviderTool<INPUT, OUTPUT, CONTEXT> & {
    /**
     * Flag that indicates whether the tool is executed by the provider.
     */
    isProviderExecuted: true;
    /**
     * Whether this provider-executed tool supports deferred results.
     *
     * When true, the tool result may not be returned in the same turn as the
     * tool call (e.g., when using programmatic tool calling where a server tool
     * triggers a client-executed tool, and the server tool's result is deferred
     * until the client tool is resolved).
     *
     * This flag allows the AI SDK to handle tool results that arrive without
     * a matching tool call in the current response.
     *
     * @default false
     */
    supportsDeferredResults?: boolean;
};
/**
 * A tool can either be user-defined or provider-defined.
 *
 * It contains the schemas and metadata needed for the language model to call
 * the tool and can include an execute function for tools that are executed by
 * the AI SDK.
 */
type Tool<INPUT extends JSONValue | unknown | never = any, OUTPUT extends JSONValue | unknown | never = any, CONTEXT extends Context | unknown | never = any> = FunctionTool<INPUT, OUTPUT, CONTEXT> | DynamicTool<INPUT, OUTPUT, CONTEXT> | ProviderDefinedTool<INPUT, OUTPUT, CONTEXT> | ProviderExecutedTool<INPUT, OUTPUT, CONTEXT>;
/**
 * Infer the tool type from a tool object.
 *
 * This is useful for type inference when working with tool objects.
 *
 * When the input has an `execute` function, the return type narrows to
 * `ExecutableTool<Tool<...>>` so that `.execute` is non-nullable without
 * needing `isExecutableTool` or a `!` assertion at the call site.
 */
declare function tool<INPUT, OUTPUT, CONTEXT extends Context>(tool: Tool<INPUT, OUTPUT, CONTEXT> & {
    execute: ToolExecuteFunction<INPUT, OUTPUT, CONTEXT>;
}): ExecutableTool<Tool<INPUT, OUTPUT, CONTEXT>>;
declare function tool<INPUT, OUTPUT, CONTEXT extends Context>(tool: Tool<INPUT, OUTPUT, CONTEXT>): Tool<INPUT, OUTPUT, CONTEXT>;
declare function tool<INPUT, CONTEXT extends Context>(tool: Tool<INPUT, never, CONTEXT>): Tool<INPUT, never, CONTEXT>;
declare function tool<OUTPUT, CONTEXT extends Context>(tool: Tool<never, OUTPUT, CONTEXT>): Tool<never, OUTPUT, CONTEXT>;
declare function tool<CONTEXT extends Context>(tool: Tool<never, never, CONTEXT>): Tool<never, never, CONTEXT>;
/**
 * Define a dynamic tool.
 */
declare function dynamicTool(tool: Omit<DynamicTool<unknown, unknown, Context>, 'type'>): DynamicTool<unknown, unknown, Context>;

/**
 * A provider-defined tool is a tool for which the provider defines the input
 * and output schemas, but does not execute the tool.
 */
type ProviderDefinedToolFactory<INPUT, ARGS extends object, CONTEXT extends Context = {}> = <OUTPUT>(options: ARGS & {
    execute?: ToolExecuteFunction<INPUT, OUTPUT, CONTEXT>;
    needsApproval?: Tool<INPUT, OUTPUT, CONTEXT>['needsApproval'];
    toModelOutput?: Tool<INPUT, OUTPUT, CONTEXT>['toModelOutput'];
    onInputStart?: Tool<INPUT, OUTPUT, CONTEXT>['onInputStart'];
    onInputDelta?: Tool<INPUT, OUTPUT, CONTEXT>['onInputDelta'];
    onInputAvailable?: Tool<INPUT, OUTPUT, CONTEXT>['onInputAvailable'];
}) => ProviderDefinedTool<INPUT, OUTPUT, CONTEXT>;
declare function createProviderDefinedToolFactory<INPUT, ARGS extends object, CONTEXT extends Context = {}>({ id, inputSchema, }: {
    id: `${string}.${string}`;
    inputSchema: FlexibleSchema<INPUT>;
}): ProviderDefinedToolFactory<INPUT, ARGS, CONTEXT>;
type ProviderDefinedToolFactoryWithOutputSchema<INPUT, OUTPUT, ARGS extends object, CONTEXT extends Context = {}> = (options: ARGS & {
    execute?: ToolExecuteFunction<INPUT, OUTPUT, CONTEXT>;
    needsApproval?: Tool<INPUT, OUTPUT, CONTEXT>['needsApproval'];
    toModelOutput?: Tool<INPUT, OUTPUT, CONTEXT>['toModelOutput'];
    onInputStart?: Tool<INPUT, OUTPUT, CONTEXT>['onInputStart'];
    onInputDelta?: Tool<INPUT, OUTPUT, CONTEXT>['onInputDelta'];
    onInputAvailable?: Tool<INPUT, OUTPUT, CONTEXT>['onInputAvailable'];
}) => ProviderDefinedTool<INPUT, OUTPUT, CONTEXT>;
declare function createProviderDefinedToolFactoryWithOutputSchema<INPUT, OUTPUT, ARGS extends object, CONTEXT extends Context = {}>({ id, inputSchema, outputSchema, }: {
    id: `${string}.${string}`;
    inputSchema: FlexibleSchema<INPUT>;
    outputSchema: FlexibleSchema<OUTPUT>;
}): ProviderDefinedToolFactoryWithOutputSchema<INPUT, OUTPUT, ARGS, CONTEXT>;

/**
 * A provider-executed tool is a tool for which the provider executes the tool.
 */
type ProviderExecutedToolFactory<INPUT, OUTPUT, ARGS extends object, CONTEXT extends Context = {}> = (options: ARGS & {
    onInputStart?: Tool<INPUT, OUTPUT, CONTEXT>['onInputStart'];
    onInputDelta?: Tool<INPUT, OUTPUT, CONTEXT>['onInputDelta'];
    onInputAvailable?: Tool<INPUT, OUTPUT, CONTEXT>['onInputAvailable'];
}) => ProviderExecutedTool<INPUT, OUTPUT, CONTEXT>;
declare function createProviderExecutedToolFactory<INPUT, OUTPUT, ARGS extends object, CONTEXT extends Context = {}>({ id, inputSchema, outputSchema, supportsDeferredResults, }: {
    id: `${string}.${string}`;
    inputSchema: FlexibleSchema<INPUT>;
    outputSchema: FlexibleSchema<OUTPUT>;
    /**
     * Whether this provider-executed tool supports deferred results.
     *
     * When true, the tool result may not be returned in the same turn as the
     * tool call (e.g., when using programmatic tool calling where a server tool
     * triggers a client-executed tool, and the server tool's result is deferred
     * until the client tool is resolved).
     *
     * @default false
     */
    supportsDeferredResults?: boolean;
}): ProviderExecutedToolFactory<INPUT, OUTPUT, ARGS, CONTEXT>;

/**
 * Cancels a response body to release the underlying connection.
 *
 * When a fetch Response is rejected without consuming its body (e.g. a failed
 * status code, an open-redirect rejection, or a Content-Length that exceeds the
 * size limit), the underlying TCP socket is not returned to the connection pool
 * and may stay open until the process runs out of file descriptors. Cancelling
 * the body avoids this leak.
 *
 * Errors thrown while cancelling are ignored: the body may already be locked,
 * disturbed, or absent, none of which should mask the original rejection.
 */
declare function cancelResponseBody(response: Response): Promise<void>;

/**
 * Default maximum download size: 2 GiB.
 *
 * `fetch().arrayBuffer()` has ~2x peak memory overhead (undici buffers the
 * body internally, then creates the JS ArrayBuffer), so very large downloads
 * risk exceeding the default V8 heap limit on 64-bit systems and terminating
 * the process with an out-of-memory error.
 *
 * Setting this limit converts an unrecoverable OOM crash into a catchable
 * `DownloadError`.
 */
declare const DEFAULT_MAX_DOWNLOAD_SIZE: number;
/**
 * Reads a fetch Response body with a size limit to prevent memory exhaustion.
 *
 * Checks the Content-Length header for early rejection, then reads the body
 * incrementally via ReadableStream and aborts with a DownloadError when the
 * limit is exceeded.
 *
 * @param response - The fetch Response to read.
 * @param url - The URL being downloaded (used in error messages).
 * @param maxBytes - Maximum allowed bytes. Defaults to DEFAULT_MAX_DOWNLOAD_SIZE.
 * @returns A Uint8Array containing the response body.
 * @throws DownloadError if the response exceeds maxBytes.
 */
declare function readResponseWithSizeLimit({ response, url, maxBytes, }: {
    response: Response;
    url: string;
    maxBytes?: number;
}): Promise<Uint8Array>;

/**
 * Removes entries from a record where the value is null or undefined.
 * @param record - The input object whose entries may be null or undefined.
 * @returns A new object containing only entries with non-null and non-undefined values.
 */
declare function removeUndefinedEntries<T>(record: Record<string, T | undefined>): Record<string, T>;

/**
 * A value or a lazy provider of a value, each of which may be synchronous or asynchronous.
 *
 * @template T The resolved type after {@link resolve} runs.
 *
 * One of:
 * - A plain value of type {@link T}
 * - A {@link PromiseLike} of {@link T} (e.g. a `Promise<T>`)
 * - A zero-argument function that returns a plain {@link T}
 * - A zero-argument function that returns a {@link PromiseLike} of {@link T}
 *
 * The function form is only invoked when passed to {@link resolve}; it is not distinguished from
 * a {@link T} that happens to be a function—callers should wrap function values if disambiguation
 * is required.
 */
type Resolvable<T> = MaybePromiseLike<T> | (() => MaybePromiseLike<T>);
/**
 * Resolves a value that could be a raw value, a Promise, a function returning a value,
 * or a function returning a Promise.
 */
declare function resolve<T>(value: Resolvable<T>): Promise<T>;

/**
 * Resolves a file part's media type to a full `type/subtype` form required by
 * providers whose API demands the full IANA media type.
 *
 * - If `part.mediaType` is already a full media type (e.g. `image/png`), it is
 *   returned as-is.
 * - Otherwise, when inline bytes are available (`part.data.type === 'data'`),
 *   the subtype is sniffed from the bytes using the signature table that
 *   corresponds to the top-level segment.
 * - When neither applies (e.g. top-level-only with a URL source, or bytes that
 *   cannot be detected), an `UnsupportedFunctionalityError` is thrown.
 */
declare function resolveFullMediaType({ part, }: {
    part: LanguageModelV4FilePart;
}): string;

/**
 * Resolves a provider reference to the provider-specific identifier for the
 * given provider. Throws `NoSuchProviderReferenceError` if the provider is not
 * found in the reference mapping.
 */
declare function resolveProviderReference({ reference, provider, }: {
    reference: SharedV4ProviderReference;
    provider: string;
}): string;

type RetryFunction = <OUTPUT>(fn: () => PromiseLike<OUTPUT>) => PromiseLike<OUTPUT>;
type RetryErrorReason = 'maxRetriesExceeded' | 'errorNotRetryable';
type RetryErrorFactory = ({ message, reason, errors, }: {
    message: string;
    reason: RetryErrorReason;
    errors: Array<unknown>;
}) => unknown;
type RetryDelayProvider = ({ error, exponentialBackoffDelay, }: {
    error: unknown;
    exponentialBackoffDelay: number;
}) => number;
type ShouldRetryFunction = (error: unknown) => boolean | Promise<boolean>;
/**
 * Retries a failed operation with exponential backoff.
 */
declare const retryWithExponentialBackoff: ({ maxRetries, initialDelayInMs, backoffFactor, abortSignal, shouldRetry, getDelayInMs, createRetryError, }: {
    maxRetries?: number;
    initialDelayInMs?: number;
    backoffFactor?: number;
    abortSignal?: AbortSignal;
    shouldRetry: ShouldRetryFunction;
    getDelayInMs?: RetryDelayProvider;
    createRetryError?: RetryErrorFactory;
}) => RetryFunction;

/**
 * Serializes a model instance for workflow step boundaries.
 * Returns the `modelId` plus the JSON-serializable config properties.
 *
 * Non-serializable values are omitted. As a special case, a
 * function-valued `headers` property is resolved during serialization
 * and included if the returned value is JSON-serializable.
 *
 * Used as the body of `static [WORKFLOW_SERIALIZE]` in provider models.
 *
 * @example
 * ```ts
 * static [WORKFLOW_SERIALIZE](model: MyLanguageModel) {
 *   return serializeModelOptions({
 *     modelId: model.modelId,
 *     config: model.config,
 *   });
 * }
 * ```
 */
declare function serializeModelOptions<CONFIG extends {
    headers?: Resolvable<Record<string, string | undefined>>;
}>(options: {
    modelId: string;
    config: CONFIG;
}): {
    modelId: string;
    config: JSONObject;
};

declare function secureJsonParse(text: string): any;

/**
 * Minimal interface for a streaming tool call delta from an OpenAI-compatible API.
 */
interface StreamingToolCallDelta {
    index?: number | null;
    id?: string | null;
    type?: string | null;
    function?: {
        name?: string | null;
        arguments?: string | null;
    } | null;
}
interface StreamingToolCallTrackerOptions<DELTA extends StreamingToolCallDelta = StreamingToolCallDelta> {
    /**
     * ID generator function for tool call IDs.
     * Defaults to the standard generateId.
     */
    generateId?: () => string;
    /**
     * How to validate the `type` field on new tool call deltas.
     * - `'none'`: no validation (default)
     * - `'if-present'`: throw if type is present and not `'function'`
     * - `'required'`: throw if type is not exactly `'function'`
     */
    typeValidation?: 'none' | 'if-present' | 'required';
    /**
     * Extract provider-specific metadata from a tool call delta.
     * Called once when a new tool call is detected.
     * The returned metadata is stored on the tool call and passed to
     * `buildToolCallProviderMetadata` when the tool call is finalized.
     */
    extractMetadata?: (delta: DELTA) => SharedV4ProviderMetadata | undefined;
    /**
     * Build the `providerMetadata` object for a `tool-call` event.
     * Receives the metadata previously extracted via `extractMetadata`.
     * If `undefined` is returned, no `providerMetadata` is included in the event.
     */
    buildToolCallProviderMetadata?: (metadata: SharedV4ProviderMetadata | undefined) => SharedV4ProviderMetadata | undefined;
}
type StreamingToolCallTrackerController = Pick<TransformStreamDefaultController<LanguageModelV4StreamPart>, 'enqueue'>;
/**
 * Tracks streaming tool call state across multiple deltas from an
 * OpenAI-compatible chat completion stream. Handles argument accumulation,
 * emits tool-input-start/delta/end and tool-call events, and finalizes
 * unfinished tool calls on flush.
 *
 * Used by openai, openai-compatible, groq, deepseek, and alibaba providers.
 */
declare class StreamingToolCallTracker<DELTA extends StreamingToolCallDelta = StreamingToolCallDelta> {
    private toolCalls;
    private readonly controller;
    private readonly _generateId;
    private readonly typeValidation;
    private readonly extractMetadata?;
    private readonly buildToolCallProviderMetadata?;
    constructor(controller: StreamingToolCallTrackerController, options?: StreamingToolCallTrackerOptions<DELTA>);
    /**
     * Process a tool call delta from a streaming response chunk.
     * Emits tool-input-start, tool-input-delta, tool-input-end, and tool-call
     * events as appropriate.
     */
    processDelta(toolCallDelta: DELTA): void;
    /**
     * Finalize any unfinished tool calls. Should be called during the stream's
     * flush handler to ensure all tool calls are properly completed.
     */
    flush(): void;
    private processNewToolCall;
    private processExistingToolCall;
    private finishToolCall;
}

/**
 * Strips file extension segments from a filename.
 *
 * Examples:
 * - "report.pdf" -> "report"
 * - "archive.tar.gz" -> "archive"
 * - "filename" -> "filename"
 */
declare function stripFileExtension(filename: string): string;

/**
 * Experimental transcription-stream WebSocket envelope (v1): the standard
 * serialization of `TranscriptionModelV4.doStream` over a WebSocket. Clients
 * (e.g. the `@ai-sdk/gateway` provider) encode with this module and servers
 * (e.g. AI Gateway) decode with it, so the two sides cannot drift.
 *
 * Envelope rules:
 *
 * 1. The client sends exactly one `transcription-stream.start` TEXT frame
 *    first.
 * 2. Audio rides BINARY frames containing raw bytes in the declared
 *    `inputAudioFormat` (base64 string chunks are decoded before sending).
 * 3. The client signals end of audio with the
 *    `transcription-stream.audio-done` TEXT frame; a plain close without it
 *    is an abort.
 * 4. Every server→client TEXT frame is one JSON-serialized
 *    `TranscriptionModelV4StreamPart` (flattened, no wrapper). Payloads must
 *    be JSON-serializable. `Date` values (`response-metadata.timestamp`)
 *    serialize to ISO 8601 strings and are revived by
 *    `parseTranscriptionStreamPart`. `Error` payloads in `error` parts
 *    serialize as `{ name, message }`.
 * 5. The server closes with code 1000 after the `finish` part; on failure it
 *    sends an `error` part and closes non-1000. A close without a prior
 *    `finish` is an error.
 * 6. Unknown frame/part types are ignored in both directions (forward
 *    compatibility).
 * 7. Servers may enforce a maximum frame size (the AI Gateway rejects frames
 *    over 256 KiB); clients should split audio into frames of at most
 *    64 KiB.
 * 8. Connection establishment (URL, auth) is transport-specific and out of
 *    scope.
 *
 * The envelope validates frame shape only; server policy (accepted audio
 * formats, required `rate`, size limits) layers on top. Both parsers use
 * `secureJsonParse`, so frames carrying `__proto__` / `constructor.prototype`
 * keys are rejected (prototype-pollution protection) rather than parsed.
 */
/** Type of the first client TEXT frame. */
declare const TRANSCRIPTION_STREAM_START_FRAME_TYPE = "transcription-stream.start";
/** Type of the client TEXT frame that signals the end of the audio input. */
declare const TRANSCRIPTION_STREAM_AUDIO_DONE_FRAME_TYPE = "transcription-stream.audio-done";
/**
 * The client's session start frame. Optional keys are omitted when undefined.
 */
type TranscriptionStreamStartFrame = {
    type: typeof TRANSCRIPTION_STREAM_START_FRAME_TYPE;
    /** Audio format of the binary audio frames, e.g. `{ type: 'audio/pcm', rate: 16000 }`. */
    inputAudioFormat: {
        type: string;
        rate?: number;
    };
    /** Provider-specific options, passed through verbatim. */
    providerOptions?: Record<string, JSONObject>;
    /** When true, the server should include `raw` parts in the stream. */
    includeRawChunks?: boolean;
};
/** Server-side classification of a client TEXT frame. */
type TranscriptionStreamClientFrame = {
    type: 'start';
    frame: TranscriptionStreamStartFrame;
} | {
    type: 'audio-done';
} | {
    /** Malformed JSON or a recognized frame with an invalid shape. */
    type: 'invalid';
    message: string;
} | {
    /** Unrecognized frame type; ignore for forward compatibility. */
    type: 'unknown';
};
/**
 * Server-side: parse a client TEXT frame. Validates envelope shape only and
 * rejects prototype-pollution payloads (parsed with `secureJsonParse`). Never
 * throws.
 */
declare function parseTranscriptionStreamClientFrame(text: string): TranscriptionStreamClientFrame;
/**
 * Server-side: serialize a transcription stream part as one TEXT frame.
 * `Error` payloads in `error` parts serialize as `{ name, message }` —
 * `Error` properties are non-enumerable, so a plain `JSON.stringify` would
 * serialize them to `{}` and lose the message end-to-end. Returns
 * `undefined` for payloads that are not JSON-serializable (envelope rule 4,
 * e.g. bigint or cyclic values); callers drop the frame.
 */
declare function serializeTranscriptionStreamPart(part: Experimental_TranscriptionModelV4StreamPart): string | undefined;
/**
 * Client-side: parse a server TEXT frame into a transcription stream part.
 * Returns `undefined` for malformed or unsafe (prototype-polluting) JSON
 * (parsed with `secureJsonParse`), unknown part types, and known part types
 * whose required or optional fields are missing or mistyped (including
 * warning and segment elements) — downstream SDK code dereferences those
 * fields, so a drifted server must not crash or pollute the stream.
 * Revives `response-metadata.timestamp` to a `Date`.
 */
declare function parseTranscriptionStreamPart(text: string): Experimental_TranscriptionModelV4StreamPart | undefined;

declare function convertBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer>;
declare function convertUint8ArrayToBase64(array: Uint8Array): string;
declare function convertToBase64(value: string | Uint8Array): string;

declare function validateBaseURL(baseURL: string | undefined): string | undefined;

/**
 * Validates that a URL is safe to download from, blocking private/internal addresses
 * to prevent SSRF attacks.
 *
 * Note: this performs string/literal-IP checks only. It does not resolve DNS, so a
 * hostname that resolves to a private address is not blocked here (see callers, which
 * should additionally constrain egress at the network layer when handling untrusted URLs).
 *
 * @param url - The URL string to validate.
 * @throws DownloadError if the URL is unsafe.
 */
declare function validateDownloadUrl(url: string): void;

/**
 * Validates the types of an unknown object using a schema and
 * return a strongly-typed object.
 *
 * @template T - The type of the object to validate.
 * @param {string} options.value - The object to validate.
 * @param {Validator<T>} options.schema - The schema to use for validating the JSON.
 * @param {TypeValidationContext} options.context - Optional context about what is being validated.
 * @returns {Promise<T>} - The typed object.
 */
declare function validateTypes<OBJECT>({ value, schema, context, }: {
    value: unknown;
    schema: FlexibleSchema<OBJECT>;
    context?: TypeValidationContext;
}): Promise<OBJECT>;
/**
 * Safely validates the types of an unknown object using a schema and
 * return a strongly-typed object.
 *
 * @template T - The type of the object to validate.
 * @param {string} options.value - The JSON object to validate.
 * @param {Validator<T>} options.schema - The schema to use for validating the JSON.
 * @param {TypeValidationContext} options.context - Optional context about what is being validated.
 * @returns An object with either a `success` flag and the parsed and typed data, or a `success` flag and an error object.
 */
declare function safeValidateTypes<OBJECT>({ value, schema, context, }: {
    value: unknown;
    schema: FlexibleSchema<OBJECT>;
    context?: TypeValidationContext;
}): Promise<{
    success: true;
    value: OBJECT;
    rawValue: unknown;
} | {
    success: false;
    error: TypeValidationError;
    rawValue: unknown;
}>;

declare const VERSION: string;

/**
 * Appends suffix parts to the `user-agent` header.
 * If a `user-agent` header already exists, the suffix parts are appended to it.
 * If no `user-agent` header exists, a new one is created with the suffix parts.
 * Automatically removes undefined entries from the headers.
 *
 * @param headers - The original headers.
 * @param userAgentSuffixParts - The parts to append to the `user-agent` header.
 * @returns The new headers with the `user-agent` header set or updated.
 */
declare function withUserAgentSuffix(headers: HeadersInit | Record<string, string | undefined> | undefined, ...userAgentSuffixParts: string[]): Record<string, string>;

declare function withoutTrailingSlash(url: string | undefined): string | undefined;

/**
 * Detects the `any` type so untyped tools can be treated as having no explicit
 * context type.
 */
type IsAny<T> = 0 extends 1 & T ? true : false;
/**
 * Detects exact empty object contexts, including `{}` combined with
 * `undefined`, which do not provide tool-specific context properties.
 */
type IsEmptyObject<T> = keyof NonNullable<T> extends never ? true : false;
/**
 * Detects context types that come from omitted or broad context declarations
 * rather than a concrete tool context schema.
 */
type IsUntypedContext<CONTEXT> = IsAny<CONTEXT> extends true ? true : unknown extends CONTEXT ? true : IsEmptyObject<CONTEXT> extends true ? true : string extends keyof CONTEXT ? CONTEXT extends Context ? true : false : false;
/**
 * Infer the context type of a tool.
 */
type InferToolContext<TOOL extends Tool> = TOOL extends Tool<any, any, infer CONTEXT> ? IsUntypedContext<CONTEXT> extends true ? never : CONTEXT : never;

/**
 * Infer the input type of a tool.
 */
type InferToolInput<TOOL extends Tool<any, any, any>> = TOOL extends Tool<infer INPUT, any, any> ? INPUT : never;

/**
 * Infer the output type of a tool.
 */
type InferToolOutput<TOOL extends Tool<any, any, any>> = TOOL extends Tool<any, infer OUTPUT, any> ? OUTPUT : never;

/**
 * Executes a tool function and normalizes its results into a stream of outputs.
 *
 * - If the tool's `execute` function returns an `AsyncIterable`, each yielded value is emitted as
 *   `{ type: "preliminary", output }`. After iteration completes, the last yielded value is emitted
 *   again as `{ type: "final", output }`.
 * - If the tool returns a direct value or Promise, a single `{ type: "final", output }` is yielded.
 *
 * @param params.tool The tool whose `execute` function should be invoked.
 * @param params.input The input value to pass to the tool.
 * @param params.options Additional options for tool execution.
 * @yields A preliminary output for each streamed value, followed by a final output, or a single final
 * output for non-streaming tools.
 */
declare function executeTool<TOOL extends Tool>({ tool, input, options, }: {
    tool: ExecutableTool<TOOL>;
    input: InferToolInput<TOOL>;
    options: ToolExecutionOptions<InferToolContext<TOOL>>;
}): AsyncGenerator<{
    type: 'preliminary';
    output: InferToolOutput<TOOL>;
} | {
    type: 'final';
    output: InferToolOutput<TOOL>;
}>;

/**
 * A mapping of tool names to tool definitions.
 */
type ToolSet = Record<string, (Tool<never, never, any> | Tool<any, any, any> | Tool<any, never, any> | Tool<never, any, any>) & Pick<Tool<any, any, any>, 'execute' | 'onInputAvailable' | 'onInputStart' | 'onInputDelta' | 'needsApproval'>>;

/**
 * Builds the required portion of the tool context map for tools whose context
 * type does not include `undefined`.
 */
type RequiredToolSetContext<TOOLS extends ToolSet> = {
    [K in keyof TOOLS as InferToolContext<NoInfer<TOOLS[K]>> extends never ? never : undefined extends InferToolContext<NoInfer<TOOLS[K]>> ? never : K]: InferToolContext<NoInfer<TOOLS[K]>>;
};
/**
 * Builds the optional portion of the tool context map for tools whose context
 * object itself may be `undefined`.
 */
type OptionalToolSetContext<TOOLS extends ToolSet> = {
    [K in keyof TOOLS as InferToolContext<NoInfer<TOOLS[K]>> extends never ? never : undefined extends InferToolContext<NoInfer<TOOLS[K]>> ? K : never]?: InferToolContext<NoInfer<TOOLS[K]>>;
};
/**
 * Flattens intersected mapped types so type equality assertions and editor
 * hovers show the resulting object shape.
 */
type Normalize<OBJECT> = {
    [KEY in keyof OBJECT]: OBJECT[KEY];
};
/**
 * Infer the context type for a tool set.
 *
 * The inferred type maps each contextual tool name to its context type.
 *
 * Tools without concrete context are omitted. Tool contexts that include
 * `undefined` are represented as optional properties.
 */
type InferToolSetContext<TOOLS extends ToolSet> = Normalize<RequiredToolSetContext<TOOLS> & OptionalToolSetContext<TOOLS>>;

/**
 * Typed tool call that is returned by generateText and streamText.
 * It contains the tool call ID, the tool name, and the tool arguments.
 */
interface ToolCall<NAME extends string, INPUT> {
    /**
     * ID of the tool call. This ID is used to match the tool call with the tool result.
     */
    toolCallId: string;
    /**
     * Name of the tool that is being called.
     */
    toolName: NAME;
    /**
     * Arguments of the tool call. This is a JSON-serializable object that matches the tool's input schema.
     */
    input: INPUT;
    /**
     * Whether the tool call will be executed by the provider.
     * If this flag is not set or is false, the tool call will be executed by the client.
     */
    providerExecuted?: boolean;
    /**
     * Whether the tool is dynamic.
     */
    dynamic?: boolean;
}

/**
 * Typed tool result that is returned by `generateText` and `streamText`.
 * It contains the tool call ID, the tool name, the tool arguments, and the tool result.
 */
interface ToolResult<NAME extends string, INPUT, OUTPUT> {
    /**
     * ID of the tool call. This ID is used to match the tool call with the tool result.
     */
    toolCallId: string;
    /**
     * Name of the tool that was called.
     */
    toolName: NAME;
    /**
     * Arguments of the tool call. This is a JSON-serializable object that matches the tool's input schema.
     */
    input: INPUT;
    /**
     * Result of the tool call. This is the result of the tool's execution.
     */
    output: OUTPUT;
    /**
     * Whether the tool result has been executed by the provider.
     */
    providerExecuted?: boolean;
    /**
     * Whether the tool is dynamic.
     */
    dynamic?: boolean;
}

export { type Arrayable, type AssistantContent, type AssistantModelMessage, type Context, type CustomPart, DEFAULT_MAX_DOWNLOAD_SIZE, type DataContent, DelayedPromise, DownloadError, type DynamicTool, TRANSCRIPTION_STREAM_AUDIO_DONE_FRAME_TYPE as EXPERIMENTAL_TRANSCRIPTION_STREAM_AUDIO_DONE_FRAME_TYPE, TRANSCRIPTION_STREAM_START_FRAME_TYPE as EXPERIMENTAL_TRANSCRIPTION_STREAM_START_FRAME_TYPE, type ExecutableTool, type SandboxProcess as Experimental_SandboxProcess, type SandboxSession as Experimental_SandboxSession, type TranscriptionStreamClientFrame as Experimental_TranscriptionStreamClientFrame, type TranscriptionStreamStartFrame as Experimental_TranscriptionStreamStartFrame, type FetchFunction, type FileData, type FileDataData, type FileDataReference, type FileDataText, type FileDataUrl, type FilePart, type FlexibleSchema, type FunctionTool, type HasRequiredKey, type IdGenerator, type ImagePart, type InferSchema, type InferToolContext, type InferToolInput, type InferToolOutput, type InferToolSetContext, type LazySchema, type MaybePromiseLike, type ModelMessage, type ParseResult, type ProviderDefinedTool, type ProviderDefinedToolFactory, type ProviderDefinedToolFactoryWithOutputSchema, type ProviderExecutedTool, type ProviderExecutedToolFactory, type ProviderOptions, type ProviderReference, type ReasoningFilePart, type ReasoningPart, type Resolvable, type ResponseHandler, type RetryDelayProvider, type RetryErrorFactory, type RetryErrorReason, type RetryFunction, type Schema, type ShouldRetryFunction, type StreamingToolCallDelta, StreamingToolCallTracker, type StreamingToolCallTrackerOptions, type SystemModelMessage, type TextPart, type Tool, type ToolApprovalRequest, type ToolApprovalResponse, type ToolCall, type ToolCallPart, type ToolContent, type ToolExecuteFunction, type ToolExecutionOptions, type ToolModelMessage, type ToolNameMapping, type ToolNeedsApprovalFunction, type ToolResult, type ToolResultOutput, type ToolResultPart, type ToolSet, type UserContent, type UserModelMessage, VERSION, type ValidationResult, type WebSocketConnection, type WebSocketConstructor, type WebSocketLike, asArray, asSchema, cancelResponseBody, combineHeaders, connectToWebSocket, convertAsyncIteratorToReadableStream, convertBase64ToUint8Array, convertImageModelFileToDataUri, convertInlineFileDataToUint8Array, convertToBase64, convertToFormData, convertUint8ArrayToBase64, createBinaryResponseHandler, createEventSourceResponseHandler, createIdGenerator, createJsonErrorResponseHandler, createJsonResponseHandler, createProviderDefinedToolFactory, createProviderDefinedToolFactoryWithOutputSchema, createProviderExecutedToolFactory, createStatusCodeErrorResponseHandler, createToolNameMapping, delay, detectMediaType, downloadBlob, dynamicTool, executeTool, parseTranscriptionStreamClientFrame as experimental_parseTranscriptionStreamClientFrame, parseTranscriptionStreamPart as experimental_parseTranscriptionStreamPart, serializeTranscriptionStreamPart as experimental_serializeTranscriptionStreamPart, extractLines, extractResponseHeaders, fetchWithValidatedRedirects, filterNullable, generateId, getFromApi, getRuntimeEnvironmentUserAgent, getTopLevelMediaType, getWebSocketConstructor, injectJsonInstructionIntoMessages, isAbortError, isBrowserRuntime, isBuffer, isCustomReasoning, isExecutableTool, isFullMediaType, isNonNullable, isParsableJson, isProviderReference, isSameOrigin, isUrlSupported, jsonSchema, lazySchema, loadApiKey, loadOptionalSetting, loadSetting, mapReasoningToProviderBudget, mapReasoningToProviderEffort, mediaTypeToExtension, normalizeHeaders, parseJSON, parseJsonEventStream, parseProviderOptions, postFormDataToApi, postJsonToApi, postToApi, readResponseWithSizeLimit, readWebSocketMessageText, removeUndefinedEntries, resolve, resolveFullMediaType, resolveProviderReference, retryWithExponentialBackoff, safeParseJSON, safeValidateTypes, secureJsonParse, serializeModelOptions, stripFileExtension, toWebSocketUrl, tool, validateBaseURL, validateDownloadUrl, validateTypes, waitForWebSocketBufferDrain, withUserAgentSuffix, withoutTrailingSlash, zodSchema };
