import { FlexibleSchema, FetchFunction, Resolvable, InferSchema } from '@ai-sdk/provider-utils';
import { DeepPartial, UIMessage, AbstractChat, ChatInit, CompletionRequestOptions, UseCompletionOptions, Experimental_RealtimeSessionOptions, Experimental_RealtimeStatus, Experimental_RealtimeServerEvent, Experimental_AbstractRealtimeSession, Experimental_RealtimeState, ToolUIPart, UITools, DynamicToolUIPart } from 'ai';
export { CreateUIMessage, Experimental_RealtimeStatus, UIMessage, UseCompletionOptions } from 'ai';
import * as react_jsx_runtime from 'react/jsx-runtime';
import * as react from 'react';
import { CSSProperties, ReactNode } from 'react';
import { MCPAppResource } from '@ai-sdk/mcp';
export { MCPAppResource } from '@ai-sdk/mcp';

type UseObjectOptions<SCHEMA extends FlexibleSchema, RESULT> = {
    /**
     * The API endpoint. It should stream JSON that matches the schema as chunked text.
     */
    api: string;
    /**
     * A schema that defines the shape of the complete object.
     */
    schema: SCHEMA;
    /**
     * An unique identifier. If not provided, a random one will be
     * generated. When provided, the `useObject` hook with the same `id` will
     * have shared states across components.
     */
    id?: string;
    /**
     * An optional value for the initial object.
     */
    initialValue?: DeepPartial<RESULT>;
    /**
     * Custom fetch implementation. You can use it as a middleware to intercept requests,
     * or to provide a custom fetch implementation for e.g. testing.
     */
    fetch?: FetchFunction;
    /**
     * Callback that is called when the stream has finished.
     */
    onFinish?: (event: {
        /**
         * The generated object (typed according to the schema).
         * Can be undefined if the final object does not match the schema.
         */
        object: RESULT | undefined;
        /**
         * Optional error object. This is e.g. a TypeValidationError when the final object does not match the schema.
         */
        error: Error | undefined;
    }) => Promise<void> | void;
    /**
     * Callback function to be called when an error is encountered.
     */
    onError?: (error: Error) => void;
    /**
     * Additional HTTP headers to be included in the request.
     * Can be a static object, a function that returns headers, or an async function
     * for dynamic auth tokens.
     */
    headers?: Resolvable<Record<string, string> | Headers>;
    /**
     * The credentials mode to be used for the fetch request.
     * Possible values are: 'omit', 'same-origin', 'include'.
     * Defaults to 'same-origin'.
     */
    credentials?: RequestCredentials;
};
type UseObjectHelpers<RESULT, INPUT> = {
    /**
     * Calls the API with the provided input as JSON body.
     */
    submit: (input: INPUT) => void;
    /**
     * The current value for the generated object. Updated as the API streams JSON chunks.
     */
    object: DeepPartial<RESULT> | undefined;
    /**
     * The error object of the API request if any.
     */
    error: Error | undefined;
    /**
     * Flag that indicates whether an API request is in progress.
     */
    isLoading: boolean;
    /**
     * Abort the current request immediately, keep the current partial object if any.
     */
    stop: () => void;
    /**
     * Clear the object state.
     */
    clear: () => void;
};
declare function useObject<SCHEMA extends FlexibleSchema, RESULT = InferSchema<SCHEMA>, INPUT = any>({ api, id, schema, // required, in the future we will use it for validation
initialValue, fetch, onError, onFinish, headers, credentials, }: UseObjectOptions<SCHEMA, RESULT>): UseObjectHelpers<RESULT, INPUT>;

declare class Chat<UI_MESSAGE extends UIMessage> extends AbstractChat<UI_MESSAGE> {
    #private;
    constructor({ messages, ...init }: ChatInit<UI_MESSAGE>);
    '~registerMessagesCallback': (onChange: () => void, throttleWaitMs?: number) => (() => void);
    '~registerStatusCallback': (onChange: () => void) => (() => void);
    '~registerErrorCallback': (onChange: () => void) => (() => void);
}

type UseChatHelpers<UI_MESSAGE extends UIMessage> = {
    /**
     * The id of the chat.
     */
    readonly id: string;
    /**
     * Update the `messages` state locally. This is useful when you want to
     * edit the messages on the client, and then trigger the `reload` method
     * manually to regenerate the AI response.
     */
    setMessages: (messages: UI_MESSAGE[] | ((messages: UI_MESSAGE[]) => UI_MESSAGE[])) => void;
    error: Error | undefined;
} & Pick<AbstractChat<UI_MESSAGE>, 'sendMessage' | 'regenerate' | 'stop' | 'resumeStream' | 'addToolResult' | 'addToolOutput' | 'addToolApprovalResponse' | 'status' | 'messages' | 'clearError'>;
type UseChatOptions<UI_MESSAGE extends UIMessage> = ({
    chat: Chat<UI_MESSAGE>;
} | ChatInit<UI_MESSAGE>) & {
    /**
     * Custom throttle wait in ms for the chat messages and data updates.
     * Default is undefined, which disables throttling.
     */
    throttle?: number;
    /**
     * @deprecated Use `throttle` instead.
     */
    experimental_throttle?: number;
    /**
     * Whether to resume an ongoing chat generation stream.
     */
    resume?: boolean;
};
declare function useChat<UI_MESSAGE extends UIMessage = UIMessage>({ throttle, experimental_throttle, resume, ...options }?: UseChatOptions<UI_MESSAGE>): UseChatHelpers<UI_MESSAGE>;

type UseCompletionHelpers = {
    /** The current completion result */
    completion: string;
    /**
     * Send a new prompt to the API endpoint and update the completion state.
     */
    complete: (prompt: string, options?: CompletionRequestOptions) => Promise<string | null | undefined>;
    /** The error object of the API request */
    error: undefined | Error;
    /**
     * Abort the current API request but keep the generated tokens.
     */
    stop: () => void;
    /**
     * Update the `completion` state locally.
     */
    setCompletion: (completion: string) => void;
    /** The current value of the input */
    input: string;
    /** setState-powered method to update the input value */
    setInput: React.Dispatch<React.SetStateAction<string>>;
    /**
     * An input/textarea-ready onChange handler to control the value of the input
     * @example
     * ```jsx
     * <input onChange={handleInputChange} value={input} />
     * ```
     */
    handleInputChange: (event: React.ChangeEvent<HTMLInputElement> | React.ChangeEvent<HTMLTextAreaElement>) => void;
    /**
     * Form submission handler to automatically reset input and append a user message
     * @example
     * ```jsx
     * <form onSubmit={handleSubmit}>
     *  <input onChange={handleInputChange} value={input} />
     * </form>
     * ```
     */
    handleSubmit: (event?: {
        preventDefault?: () => void;
    }) => void;
    /** Whether the API request is in progress */
    isLoading: boolean;
};
declare function useCompletion({ api, id, initialCompletion, initialInput, credentials, headers, body, streamProtocol, fetch, onFinish, onError, throttle: throttleWait, experimental_throttle, }?: UseCompletionOptions & {
    /**
     * Custom throttle wait in ms for the completion and data updates.
     * Default is undefined, which disables throttling.
     */
    throttle?: number;
    /**
     * @deprecated Use `throttle` instead.
     */
    experimental_throttle?: number;
}): UseCompletionHelpers;

type UseRealtimeOptions = Experimental_RealtimeSessionOptions;
type RealtimeStateKey = keyof Experimental_RealtimeState;
declare class RealtimeStore extends Experimental_AbstractRealtimeSession {
    protected state: Experimental_RealtimeState;
    private callbacks;
    get status(): Experimental_RealtimeStatus;
    get messages(): UIMessage[];
    get events(): Experimental_RealtimeServerEvent[];
    get isCapturing(): boolean;
    get isPlaying(): boolean;
    subscribe(key: RealtimeStateKey, onChange: () => void): () => void;
    protected setState<K extends RealtimeStateKey>(key: K, value: Experimental_RealtimeState[K]): void;
    protected pushMessage(message: UIMessage): void;
    protected updateMessages(updater: (messages: UIMessage[]) => UIMessage[]): void;
    protected pushEvent(event: Experimental_RealtimeServerEvent): void;
}
type UseRealtimeReturn = {
    status: Experimental_RealtimeStatus;
    messages: UIMessage[];
    events: Experimental_RealtimeServerEvent[];
    isCapturing: boolean;
    isPlaying: boolean;
    connect: () => Promise<void>;
    disconnect: () => void;
    addToolOutput: (callId: string, result: unknown) => void;
    sendEvent: RealtimeStore['sendEvent'];
    sendTextMessage: (text: string) => void;
    sendAudio: (base64Audio: string) => void;
    commitAudio: () => void;
    clearAudioBuffer: () => void;
    requestResponse: (options?: {
        modalities?: string[];
    }) => void;
    cancelResponse: () => void;
    startAudioCapture: (stream: MediaStream) => void;
    stopAudioCapture: () => void;
    stopPlayback: () => void;
};
declare function useRealtime(options: UseRealtimeOptions): UseRealtimeReturn;
declare const experimental_useRealtime: typeof useRealtime;

/**
 * A permission an MCP App may request and a host may allow.
 */
type MCPAppPermission = 'camera' | 'microphone' | 'geolocation' | 'clipboardWrite';

type MCPAppDisplayMode = 'inline' | 'fullscreen' | 'pip';
type MCPAppMetadata = {
    resourceUri: string;
    mimeType: MCPAppResource['mimeType'];
    visibility?: Array<'model' | 'app'>;
};
type MCPAppHostContext = {
    theme?: 'light' | 'dark';
    displayMode?: MCPAppDisplayMode;
    availableDisplayModes?: MCPAppDisplayMode[];
    [key: string]: unknown;
};
type MCPAppToolCallParams = {
    name: string;
    arguments?: Record<string, unknown>;
};
type MCPAppBridgeHandlers = {
    /**
     * Tools the MCP App is allowed to invoke via `tools/call`. Deny-by-default:
     * if omitted, the (untrusted) app cannot call any tool. List only the tools
     * the app is meant to see.
     */
    allowedTools?: string[];
    callTool?: (params: MCPAppToolCallParams) => Promise<unknown> | unknown;
    readResource?: (params: {
        uri: string;
    }) => Promise<unknown> | unknown;
    listResources?: (params?: unknown) => Promise<unknown> | unknown;
    openLink?: (params: {
        url: string;
    }) => Promise<unknown> | unknown;
    sendMessage?: (params: unknown) => Promise<unknown> | unknown;
    updateModelContext?: (params: unknown) => Promise<unknown> | unknown;
    requestDisplayMode?: (params: {
        mode: MCPAppDisplayMode;
    }) => Promise<{
        mode: MCPAppDisplayMode;
    }> | {
        mode: MCPAppDisplayMode;
    };
    onSizeChange?: (params: {
        width?: number;
        height?: number;
    }) => void;
    onInitialized?: () => void;
    onRequestTeardown?: (params: unknown) => void;
    onLog?: (params: unknown) => void;
    onError?: (error: Error) => void;
};
type MCPAppSandboxConfig = {
    url: string | URL;
    title?: string;
    className?: string;
    style?: CSSProperties;
    targetOrigin?: string;
    outerSandbox?: string;
    innerSandbox?: string;
    /**
     * Iframe capabilities the host allows an app to use. Deny-by-default: a
     * server-requested permission (camera/microphone/geolocation/clipboardWrite)
     * is only granted when it also appears here. Omitting this grants nothing.
     */
    allowedPermissions?: MCPAppPermission[];
};
type MCPAppRendererProps = {
    part: ToolUIPart<UITools> | DynamicToolUIPart;
    sandbox: MCPAppSandboxConfig;
    resource?: MCPAppResource;
    loadResource?: (app: MCPAppMetadata) => Promise<MCPAppResource>;
    handlers?: MCPAppBridgeHandlers;
    hostInfo?: {
        name: string;
        version: string;
    };
    hostContext?: MCPAppHostContext;
    fallback?: ReactNode;
};

declare function MCPAppRenderer({ part, sandbox, resource: resourceProp, loadResource, handlers, hostInfo, hostContext, fallback, }: MCPAppRendererProps): string | number | boolean | Iterable<react.ReactNode> | react_jsx_runtime.JSX.Element | null;

/**
 * @deprecated Use `useObject` instead.
 */
declare const experimental_useObject: typeof useObject;
/**
 * @deprecated Use `UseObjectOptions` instead.
 */
type Experimental_UseObjectOptions<SCHEMA extends FlexibleSchema, RESULT> = UseObjectOptions<SCHEMA, RESULT>;
/**
 * @deprecated Use `UseObjectHelpers` instead.
 */
type Experimental_UseObjectHelpers<RESULT, INPUT> = UseObjectHelpers<RESULT, INPUT>;

export { Chat, Experimental_UseObjectHelpers, Experimental_UseObjectOptions, UseRealtimeOptions as Experimental_UseRealtimeOptions, UseRealtimeReturn as Experimental_UseRealtimeReturn, MCPAppBridgeHandlers, MCPAppMetadata, MCPAppPermission, MCPAppRendererProps, MCPAppSandboxConfig, UseChatHelpers, UseChatOptions, UseCompletionHelpers, UseObjectHelpers, UseObjectOptions, MCPAppRenderer as experimental_MCPAppRenderer, experimental_useObject, experimental_useRealtime, useChat, useCompletion, useObject };
