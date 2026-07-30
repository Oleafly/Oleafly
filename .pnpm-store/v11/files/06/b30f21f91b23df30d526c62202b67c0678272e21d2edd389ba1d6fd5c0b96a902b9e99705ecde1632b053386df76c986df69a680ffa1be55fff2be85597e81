import { z } from 'zod/v4';
import { FetchFunction, FlexibleSchema, Tool } from '@ai-sdk/provider-utils';
import { JSONObject } from '@ai-sdk/provider';

declare const JSONRPCRequestSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    }, z.core.$loose>>;
}, z.core.$strict>;
type JSONRPCRequest = z.infer<typeof JSONRPCRequestSchema>;
declare const JSONRPCResponseSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    result: z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    }, z.core.$loose>;
}, z.core.$strict>;
type JSONRPCResponse = z.infer<typeof JSONRPCResponseSchema>;
declare const JSONRPCErrorSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    error: z.ZodObject<{
        code: z.ZodNumber;
        message: z.ZodString;
        data: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$strip>;
}, z.core.$strict>;
type JSONRPCError = z.infer<typeof JSONRPCErrorSchema>;
declare const JSONRPCNotificationSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    }, z.core.$loose>>;
}, z.core.$strict>;
type JSONRPCNotification = z.infer<typeof JSONRPCNotificationSchema>;
declare const JSONRPCMessageSchema: z.ZodUnion<readonly [z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    }, z.core.$loose>>;
}, z.core.$strict>, z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    }, z.core.$loose>>;
}, z.core.$strict>, z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    result: z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    }, z.core.$loose>;
}, z.core.$strict>, z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    error: z.ZodObject<{
        code: z.ZodNumber;
        message: z.ZodString;
        data: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$strip>;
}, z.core.$strict>]>;
type JSONRPCMessage = z.infer<typeof JSONRPCMessageSchema>;
declare function validateJSONRPCMessage(message: unknown): JSONRPCMessage;

/**
 * OAuth 2.1 token response
 */
declare const OAuthTokensSchema: z.ZodObject<{
    access_token: z.ZodString;
    id_token: z.ZodOptional<z.ZodString>;
    token_type: z.ZodString;
    expires_in: z.ZodOptional<z.ZodNumber>;
    scope: z.ZodOptional<z.ZodString>;
    refresh_token: z.ZodOptional<z.ZodString>;
    authorization_server: z.ZodOptional<z.ZodString>;
    token_endpoint: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
declare const OAuthMetadataSchema: z.ZodObject<{
    issuer: z.ZodString;
    authorization_endpoint: z.ZodString;
    token_endpoint: z.ZodString;
    registration_endpoint: z.ZodOptional<z.ZodString>;
    scopes_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
    response_types_supported: z.ZodArray<z.ZodString>;
    grant_types_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
    code_challenge_methods_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
    token_endpoint_auth_methods_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
    token_endpoint_auth_signing_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$loose>;
/**
 * OpenID Connect Discovery metadata that may include OAuth 2.0 fields
 * This schema represents the real-world scenario where OIDC providers
 * return a mix of OpenID Connect and OAuth 2.0 metadata fields
 */
declare const OpenIdProviderDiscoveryMetadataSchema: z.ZodObject<{
    issuer: z.ZodString;
    authorization_endpoint: z.ZodString;
    token_endpoint: z.ZodString;
    userinfo_endpoint: z.ZodOptional<z.ZodString>;
    jwks_uri: z.ZodString;
    registration_endpoint: z.ZodOptional<z.ZodString>;
    scopes_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
    response_types_supported: z.ZodArray<z.ZodString>;
    grant_types_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
    subject_types_supported: z.ZodArray<z.ZodString>;
    id_token_signing_alg_values_supported: z.ZodArray<z.ZodString>;
    claims_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
    token_endpoint_auth_methods_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
    code_challenge_methods_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$loose>;
declare const OAuthClientInformationSchema: z.ZodObject<{
    client_id: z.ZodString;
    client_secret: z.ZodOptional<z.ZodString>;
    client_id_issued_at: z.ZodOptional<z.ZodNumber>;
    client_secret_expires_at: z.ZodOptional<z.ZodNumber>;
    authorization_server: z.ZodOptional<z.ZodString>;
    token_endpoint: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
declare const OAuthClientMetadataSchema: z.ZodObject<{
    redirect_uris: z.ZodArray<z.ZodString>;
    token_endpoint_auth_method: z.ZodOptional<z.ZodString>;
    grant_types: z.ZodOptional<z.ZodArray<z.ZodString>>;
    response_types: z.ZodOptional<z.ZodArray<z.ZodString>>;
    client_name: z.ZodOptional<z.ZodString>;
    client_uri: z.ZodOptional<z.ZodString>;
    logo_uri: z.ZodOptional<z.ZodString>;
    scope: z.ZodOptional<z.ZodString>;
    contacts: z.ZodOptional<z.ZodArray<z.ZodString>>;
    tos_uri: z.ZodOptional<z.ZodString>;
    policy_uri: z.ZodOptional<z.ZodString>;
    jwks_uri: z.ZodOptional<z.ZodString>;
    jwks: z.ZodOptional<z.ZodAny>;
    software_id: z.ZodOptional<z.ZodString>;
    software_version: z.ZodOptional<z.ZodString>;
    software_statement: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type OAuthMetadata = z.infer<typeof OAuthMetadataSchema>;
type OpenIdProviderDiscoveryMetadata = z.infer<typeof OpenIdProviderDiscoveryMetadataSchema>;
type OAuthTokens = z.infer<typeof OAuthTokensSchema>;
type OAuthClientInformation = z.infer<typeof OAuthClientInformationSchema>;
type AuthorizationServerMetadata = OAuthMetadata | OpenIdProviderDiscoveryMetadata;
type OAuthClientMetadata = z.infer<typeof OAuthClientMetadataSchema>;

type AuthResult = 'AUTHORIZED' | 'REDIRECT';
interface OAuthAuthorizationServerInformation {
    authorizationServerUrl: string;
    tokenEndpoint: string;
}
interface OAuthClientProvider {
    /**
     * Returns current access token if present; undefined otherwise.
     */
    tokens(): OAuthTokens | undefined | Promise<OAuthTokens | undefined>;
    saveTokens(tokens: OAuthTokens): void | Promise<void>;
    redirectToAuthorization(authorizationUrl: URL): void | Promise<void>;
    saveCodeVerifier(codeVerifier: string): void | Promise<void>;
    codeVerifier(): string | Promise<string>;
    /**
     * Adds custom client authentication to OAuth token requests.
     *
     * This optional method allows implementations to customize how client credentials
     * are included in token exchange and refresh requests. When provided, this method
     * is called instead of the default authentication logic, giving full control over
     * the authentication mechanism.
     *
     * Common use cases include:
     * - Supporting authentication methods beyond the standard OAuth 2.0 methods
     * - Adding custom headers for proprietary authentication schemes
     * - Implementing client assertion-based authentication (e.g., JWT bearer tokens)
     *
     * @param headers - The request headers (can be modified to add authentication)
     * @param params - The request body parameters (can be modified to add credentials)
     * @param url - The token endpoint URL being called
     * @param metadata - Optional OAuth metadata for the server, which may include supported authentication methods
     */
    addClientAuthentication?(headers: Headers, params: URLSearchParams, url: string | URL, metadata?: AuthorizationServerMetadata): void | Promise<void>;
    /**
     * If implemented, provides a way for the client to invalidate (e.g. delete) the specified
     * credentials, in the case where the server has indicated that they are no longer valid.
     * This avoids requiring the user to intervene manually.
     */
    invalidateCredentials?(scope: 'all' | 'client' | 'tokens' | 'verifier'): void | Promise<void>;
    get redirectUrl(): string | URL;
    get clientMetadata(): OAuthClientMetadata;
    clientInformation(): OAuthClientInformation | undefined | Promise<OAuthClientInformation | undefined>;
    saveClientInformation?(clientInformation: OAuthClientInformation): void | Promise<void>;
    authorizationServerInformation?(): OAuthAuthorizationServerInformation | undefined | Promise<OAuthAuthorizationServerInformation | undefined>;
    saveAuthorizationServerInformation?(authorizationServerInformation: OAuthAuthorizationServerInformation): void | Promise<void>;
    /**
     * Validates an authorization server URL discovered from MCP protected resource
     * metadata before the client fetches its OAuth metadata.
     */
    validateAuthorizationServerURL?(serverUrl: string | URL, authorizationServerUrl: string | URL): void | Promise<void>;
    state?(): string | Promise<string>;
    saveState?(state: string): void | Promise<void>;
    storedState?(): string | undefined | Promise<string | undefined>;
    validateResourceURL?(serverUrl: string | URL, resource?: string): Promise<URL | undefined>;
}
declare class UnauthorizedError extends Error {
    constructor(message?: string);
}
declare function auth(provider: OAuthClientProvider, options: {
    serverUrl: string | URL;
    authorizationCode?: string;
    callbackState?: string;
    scope?: string;
    resourceMetadataUrl?: URL;
    fetchFn?: FetchFunction;
}): Promise<AuthResult>;

/**
 * Transport interface for MCP (Model Context Protocol) communication.
 * Maps to the `Transport` interface in the MCP spec.
 */
interface MCPTransport {
    /**
     * Initialize and start the transport
     */
    start(): Promise<void>;
    /**
     * Send a JSON-RPC message through the transport
     * @param message The JSON-RPC message to send
     */
    send(message: JSONRPCMessage): Promise<void>;
    /**
     * Clean up and close the transport
     */
    close(): Promise<void>;
    /**
     * Event handler for transport closure
     */
    onclose?: () => void;
    /**
     * Event handler for transport errors
     */
    onerror?: (error: Error) => void;
    /**
     * Event handler for received messages
     */
    onmessage?: (message: JSONRPCMessage) => void;
    /**
     * The protocol version negotiated during initialization.
     */
    protocolVersion?: string;
    /**
     * Set the protocol version negotiated during initialization.
     */
    setProtocolVersion?(version: string): void;
}
type MCPTransportConfig = {
    type: 'sse' | 'http';
    /**
     * The URL of the MCP server.
     */
    url: string;
    /**
     * Additional HTTP headers to be sent with requests.
     */
    headers?: Record<string, string>;
    /**
     * An optional OAuth client provider to use for authentication for MCP servers.
     */
    authProvider?: OAuthClientProvider;
    /**
     * Controls how HTTP redirects are handled for transport requests.
     * - `'follow'`: Follow redirects automatically (standard fetch behavior).
     * - `'error'`: Reject any redirect response with an error.
     * @default 'error'
     */
    redirect?: 'follow' | 'error';
    /**
     * Initial MCP session id to send with resumed Streamable HTTP requests after
     * initialization.
     * Only used by the HTTP transport.
     */
    initialSessionId?: string;
    /**
     * Initial MCP protocol version to send before initialize negotiates one.
     * Only used by the HTTP transport.
     */
    initialProtocolVersion?: string;
    /**
     * Called when the Streamable HTTP server creates, changes, or clears the MCP
     * session id.
     * Only used by the HTTP transport.
     */
    onSessionIdChange?: (sessionId: string | undefined) => void;
    /**
     * Called when a Streamable HTTP request returns 404 for an existing MCP
     * session id. The transport clears the session id before reporting the
     * underlying HTTP error.
     * Only used by the HTTP transport.
     */
    onSessionExpired?: (sessionId: string) => void;
    /**
     * Whether close() should send DELETE for the current MCP session id.
     * Set to false when the application intends to reattach to the session later.
     * Only used by the HTTP transport.
     * @default true
     */
    terminateSessionOnClose?: boolean;
    /**
     * Optional custom fetch implementation to use for HTTP requests.
     * Useful for runtimes that need a request-local fetch.
     * @default globalThis.fetch
     */
    fetch?: FetchFunction;
};

type McpProviderMetadata = {
    clientName?: string;
    title?: string;
    toolName?: string;
    app?: JSONObject;
};
/** MCP tool metadata - keys should follow MCP _meta key format specification */
declare const ToolMetaSchema: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
type ToolMeta = z.infer<typeof ToolMetaSchema>;
type ToolSchemas = Record<string, {
    inputSchema: FlexibleSchema<JSONObject | unknown>;
    outputSchema?: FlexibleSchema<JSONObject | unknown>;
}> | 'automatic' | undefined;
/** Base MCP tool type with execute and _meta */
type McpToolBase<INPUT = unknown, OUTPUT = CallToolResult> = Tool<INPUT, OUTPUT> & Required<Pick<Tool<INPUT, OUTPUT>, 'execute'>> & {
    _meta?: ToolMeta;
};
type McpToolSet<TOOL_SCHEMAS extends ToolSchemas = 'automatic'> = TOOL_SCHEMAS extends Record<string, {
    inputSchema: FlexibleSchema<any>;
    outputSchema?: FlexibleSchema<any>;
}> ? {
    [K in keyof TOOL_SCHEMAS]: TOOL_SCHEMAS[K] extends {
        inputSchema: FlexibleSchema<infer INPUT>;
        outputSchema: FlexibleSchema<infer OUTPUT>;
    } ? McpToolBase<INPUT, OUTPUT> : TOOL_SCHEMAS[K] extends {
        inputSchema: FlexibleSchema<infer INPUT>;
    } ? McpToolBase<INPUT, CallToolResult> : never;
} : Record<string, McpToolBase<unknown, CallToolResult>>;
declare const ClientOrServerImplementationSchema: z.ZodObject<{
    name: z.ZodString;
    version: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
type Configuration = z.infer<typeof ClientOrServerImplementationSchema>;
declare const BaseParamsSchema: z.ZodObject<{
    _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
}, z.core.$loose>;
type BaseParams = z.infer<typeof BaseParamsSchema>;
declare const RequestSchema: z.ZodObject<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    }, z.core.$loose>>;
}, z.core.$strip>;
type Request = z.infer<typeof RequestSchema>;
type RequestOptions = {
    signal?: AbortSignal;
    timeout?: number;
    maxTotalTimeout?: number;
};
declare const ClientCapabilitiesSchema: z.ZodObject<{
    elicitation: z.ZodOptional<z.ZodObject<{
        applyDefaults: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>>;
}, z.core.$loose>;
type ClientCapabilities = z.infer<typeof ClientCapabilitiesSchema>;
declare const InitializeResultSchema: z.ZodObject<{
    _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    protocolVersion: z.ZodString;
    capabilities: z.ZodObject<{
        experimental: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
        logging: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
        completions: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
        prompts: z.ZodOptional<z.ZodObject<{
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>>;
        resources: z.ZodOptional<z.ZodObject<{
            subscribe: z.ZodOptional<z.ZodBoolean>;
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>>;
        tools: z.ZodOptional<z.ZodObject<{
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>>;
        elicitation: z.ZodOptional<z.ZodObject<{
            applyDefaults: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>>;
    }, z.core.$loose>;
    serverInfo: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>;
    instructions: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
type InitializeResult = z.infer<typeof InitializeResultSchema>;
type PaginatedRequest = Request & {
    params?: BaseParams & {
        cursor?: string;
    };
};
declare const ListToolsResultSchema: z.ZodObject<{
    _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    nextCursor: z.ZodOptional<z.ZodString>;
    tools: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        inputSchema: z.ZodObject<{
            type: z.ZodLiteral<"object">;
            properties: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
        }, z.core.$loose>;
        outputSchema: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
        annotations: z.ZodOptional<z.ZodObject<{
            title: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
        _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$loose>>;
}, z.core.$loose>;
type ListToolsResult = z.infer<typeof ListToolsResultSchema>;
declare const ListResourcesResultSchema: z.ZodObject<{
    _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    nextCursor: z.ZodOptional<z.ZodString>;
    resources: z.ZodArray<z.ZodObject<{
        uri: z.ZodString;
        name: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        mimeType: z.ZodOptional<z.ZodString>;
        size: z.ZodOptional<z.ZodNumber>;
    }, z.core.$loose>>;
}, z.core.$loose>;
type ListResourcesResult = z.infer<typeof ListResourcesResultSchema>;
declare const CallToolResultSchema: z.ZodUnion<[z.ZodObject<{
    _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    content: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"resource">;
        resource: z.ZodUnion<readonly [z.ZodObject<{
            uri: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            title: z.ZodOptional<z.ZodString>;
            mimeType: z.ZodOptional<z.ZodString>;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            uri: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            title: z.ZodOptional<z.ZodString>;
            mimeType: z.ZodOptional<z.ZodString>;
            blob: z.ZodBase64;
        }, z.core.$loose>]>;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"resource_link">;
        uri: z.ZodString;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        mimeType: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>]>>;
    structuredContent: z.ZodOptional<z.ZodUnknown>;
    isError: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
}, z.core.$loose>, z.ZodObject<{
    _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    toolResult: z.ZodUnknown;
}, z.core.$loose>]>;
type CallToolResult = z.infer<typeof CallToolResultSchema>;
declare const ListResourceTemplatesResultSchema: z.ZodObject<{
    _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    resourceTemplates: z.ZodArray<z.ZodObject<{
        uriTemplate: z.ZodString;
        name: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        mimeType: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$loose>;
type ListResourceTemplatesResult = z.infer<typeof ListResourceTemplatesResultSchema>;
declare const ReadResourceResultSchema: z.ZodObject<{
    _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    contents: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        uri: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        title: z.ZodOptional<z.ZodString>;
        mimeType: z.ZodOptional<z.ZodString>;
        text: z.ZodString;
    }, z.core.$loose>, z.ZodObject<{
        uri: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        title: z.ZodOptional<z.ZodString>;
        mimeType: z.ZodOptional<z.ZodString>;
        blob: z.ZodBase64;
    }, z.core.$loose>]>>;
}, z.core.$loose>;
type ReadResourceResult = z.infer<typeof ReadResourceResultSchema>;
declare const CompleteRequestParamsSchema: z.ZodObject<{
    _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    ref: z.ZodUnion<readonly [z.ZodObject<{
        type: z.ZodLiteral<"ref/prompt">;
        name: z.ZodString;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"ref/resource">;
        uri: z.ZodString;
    }, z.core.$loose>]>;
    argument: z.ZodObject<{
        name: z.ZodString;
        value: z.ZodString;
    }, z.core.$loose>;
    context: z.ZodOptional<z.ZodObject<{
        arguments: z.ZodRecord<z.ZodString, z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$loose>;
type CompleteRequestParams = z.infer<typeof CompleteRequestParamsSchema>;
declare const CompleteResultSchema: z.ZodObject<{
    _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    completion: z.ZodObject<{
        values: z.ZodArray<z.ZodString>;
        total: z.ZodOptional<z.ZodNumber>;
        hasMore: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>;
}, z.core.$loose>;
type CompleteResult = z.infer<typeof CompleteResultSchema>;
declare const ListPromptsResultSchema: z.ZodObject<{
    _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    nextCursor: z.ZodOptional<z.ZodString>;
    prompts: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        arguments: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            required: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>>>;
    }, z.core.$loose>>;
}, z.core.$loose>;
type ListPromptsResult = z.infer<typeof ListPromptsResultSchema>;
declare const GetPromptResultSchema: z.ZodObject<{
    _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    description: z.ZodOptional<z.ZodString>;
    messages: z.ZodArray<z.ZodObject<{
        role: z.ZodUnion<readonly [z.ZodLiteral<"user">, z.ZodLiteral<"assistant">]>;
        content: z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"resource">;
            resource: z.ZodUnion<readonly [z.ZodObject<{
                uri: z.ZodString;
                name: z.ZodOptional<z.ZodString>;
                title: z.ZodOptional<z.ZodString>;
                mimeType: z.ZodOptional<z.ZodString>;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                uri: z.ZodString;
                name: z.ZodOptional<z.ZodString>;
                title: z.ZodOptional<z.ZodString>;
                mimeType: z.ZodOptional<z.ZodString>;
                blob: z.ZodBase64;
            }, z.core.$loose>]>;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"resource_link">;
            uri: z.ZodString;
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            mimeType: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>]>;
    }, z.core.$loose>>;
}, z.core.$loose>;
type GetPromptResult = z.infer<typeof GetPromptResultSchema>;
declare const ElicitationRequestSchema: z.ZodObject<{
    method: z.ZodLiteral<"elicitation/create">;
    params: z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
        message: z.ZodString;
        requestedSchema: z.ZodUnknown;
    }, z.core.$loose>;
}, z.core.$strip>;
type ElicitationRequest = z.infer<typeof ElicitationRequestSchema>;
declare const ElicitResultSchema: z.ZodObject<{
    _meta: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>;
    action: z.ZodUnion<readonly [z.ZodLiteral<"accept">, z.ZodLiteral<"decline">, z.ZodLiteral<"cancel">]>;
    content: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$loose>;
type ElicitResult = z.infer<typeof ElicitResultSchema>;

interface MCPClientConfig {
    /** Transport configuration for connecting to the MCP server */
    transport: MCPTransportConfig | MCPTransport;
    /** Optional callback for uncaught errors */
    onUncaughtError?: (error: unknown) => void;
    /**
     * Maximum number of retries for transient MCP tool call failures.
     *
     * Set to 0 to disable retries. Retries only apply to tools/call requests.
     * JSON-RPC application errors, such as invalid params, are not retried.
     *
     * @default 0
     */
    maxRetries?: number;
    /**
     * Initialize result from a previous MCP session. When provided, the client
     * starts the transport and reuses this metadata without sending a new
     * initialize request.
     */
    initialInitializeResult?: InitializeResult;
    /** Optional client name, defaults to 'ai-sdk-mcp-client' */
    clientName?: string;
    /**
     * Optional client name, defaults to 'ai-sdk-mcp-client'
     *
     * @deprecated Use `clientName` instead.
     */
    name?: string;
    /** Optional client version, defaults to '1.0.0' */
    version?: string;
    /**
     * Optional client capabilities to advertise during initialization
     *
     * NOTE: It is up to the client application to handle the requests properly. This parameter just helps surface the request from the server
     */
    capabilities?: ClientCapabilities;
}
declare function createMCPClient(config: MCPClientConfig): Promise<MCPClient>;
interface MCPClient {
    /**
     * Information about the connected MCP server, as reported during initialization.
     * @see https://modelcontextprotocol.io/specification/2025-11-25/schema#implementation
     */
    readonly serverInfo: Configuration;
    /**
     * The full initialize result used by this client, either from the server
     * during initialization or from `initialInitializeResult`.
     */
    readonly initializeResult: InitializeResult;
    /**
     * Optional instructions provided by the server during the initialize handshake.
     *
     * These describe how to use the server and its features, and can be used by clients
     * to improve LLM interactions (e.g. by including them in the system prompt).
     *
     * @see https://modelcontextprotocol.io/specification/2025-11-25/schema#initializeresult
     */
    readonly instructions?: string;
    tools<TOOL_SCHEMAS extends ToolSchemas = 'automatic'>(options?: {
        schemas?: TOOL_SCHEMAS;
    }): Promise<McpToolSet<TOOL_SCHEMAS>>;
    /**
     * Lists available tools from the MCP server.
     */
    listTools(options?: {
        params?: PaginatedRequest['params'];
        options?: RequestOptions;
    }): Promise<ListToolsResult>;
    /**
     * Calls a tool on the MCP server.
     */
    callTool(args: {
        name: string;
        arguments?: Record<string, unknown>;
        options?: RequestOptions;
    }): Promise<CallToolResult>;
    /**
     * Creates AI SDK tools from tool definitions.
     */
    toolsFromDefinitions<TOOL_SCHEMAS extends ToolSchemas = 'automatic'>(definitions: ListToolsResult, options?: {
        schemas?: TOOL_SCHEMAS;
    }): McpToolSet<TOOL_SCHEMAS>;
    listResources(options?: {
        params?: PaginatedRequest['params'];
        options?: RequestOptions;
    }): Promise<ListResourcesResult>;
    readResource(args: {
        uri: string;
        options?: RequestOptions;
    }): Promise<ReadResourceResult>;
    listResourceTemplates(options?: {
        options?: RequestOptions;
    }): Promise<ListResourceTemplatesResult>;
    experimental_listPrompts(options?: {
        params?: PaginatedRequest['params'];
        options?: RequestOptions;
    }): Promise<ListPromptsResult>;
    experimental_getPrompt(args: {
        name: string;
        arguments?: Record<string, unknown>;
        options?: RequestOptions;
    }): Promise<GetPromptResult>;
    complete(args: CompleteRequestParams & {
        options?: RequestOptions;
    }): Promise<CompleteResult>;
    onElicitationRequest(schema: typeof ElicitationRequestSchema, handler: (request: ElicitationRequest) => Promise<ElicitResult> | ElicitResult): void;
    close: () => Promise<void>;
}

/**
 * MIME type for HTML resources that are meant to be rendered as MCP Apps.
 */
declare const MCP_APP_MIME_TYPE: "text/html;profile=mcp-app";
/**
 * Client capabilities to pass to `createMCPClient` when the host supports MCP Apps.
 */
declare const mcpAppClientCapabilities: {
    readonly extensions: {
        readonly "io.modelcontextprotocol/ui": {
            readonly mimeTypes: readonly ["text/html;profile=mcp-app"];
        };
    };
};
/**
 * Content security policy metadata requested by an MCP App resource.
 */
type MCPAppResourceCSP = {
    connectDomains?: string[];
    resourceDomains?: string[];
    frameDomains?: string[];
    [key: string]: unknown;
};
/**
 * Host rendering metadata from an MCP App resource.
 */
type MCPAppResourceMeta = {
    prefersBorder?: boolean;
    csp?: MCPAppResourceCSP;
    permissions?: Record<string, unknown>;
    [key: string]: unknown;
};
/**
 * HTML and metadata needed by a host to render an MCP App.
 */
type MCPAppResource = {
    uri: string;
    mimeType: typeof MCP_APP_MIME_TYPE;
    html: string;
    meta?: MCPAppResourceMeta;
};
/**
 * Splits tool definitions into model-visible tools and app-visible tools.
 */
declare function splitMCPAppTools(definitions: ListToolsResult): {
    modelVisible: ListToolsResult;
    appVisible: ListToolsResult;
};
/**
 * Reads a `ui://` resource from an MCP server and normalizes it for rendering.
 */
declare function readMCPAppResource({ client, uri, options, }: {
    client: Pick<MCPClient, 'readResource'>;
    uri: string;
    options?: RequestOptions;
}): Promise<MCPAppResource>;

/**
 * Stable SHA-256 digest (base64url) over an MCP App resource's `html`, `csp`,
 * and `permissions`.
 *
 * Capture a baseline on first load and compare later reads with
 * {@link detectMCPAppResourceDrift} to detect a changed resource. Baseline
 * storage and the response are the host's concern, mirroring `fingerprintTools`.
 */
declare function fingerprintMCPAppResource(resource: MCPAppResource): Promise<string>;
/**
 * Compares two fingerprints from {@link fingerprintMCPAppResource}. Returns
 * `true` when the current resource differs from its baseline.
 */
declare function detectMCPAppResourceDrift(current: string, baseline: string): boolean;

export { type CallToolResult, type CompleteRequestParams, type CompleteResult, type Configuration, type ElicitResult, ElicitResultSchema, type ElicitationRequest, ElicitationRequestSchema, type InitializeResult, type JSONRPCError, type JSONRPCMessage, type JSONRPCNotification, type JSONRPCRequest, type JSONRPCResponse, type ListToolsResult, type MCPAppResource, type MCPAppResourceCSP, type MCPAppResourceMeta, type MCPClient, type ClientCapabilities as MCPClientCapabilities, type MCPClientConfig, type MCPTransport, MCP_APP_MIME_TYPE, type McpProviderMetadata, type OAuthAuthorizationServerInformation, type OAuthClientInformation, type OAuthClientMetadata, type OAuthClientProvider, type OAuthTokens, UnauthorizedError, auth, createMCPClient, detectMCPAppResourceDrift, type MCPClient as experimental_MCPClient, type ClientCapabilities as experimental_MCPClientCapabilities, type MCPClientConfig as experimental_MCPClientConfig, createMCPClient as experimental_createMCPClient, fingerprintMCPAppResource, mcpAppClientCapabilities, readMCPAppResource, splitMCPAppTools, validateJSONRPCMessage };
