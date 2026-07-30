// src/tool/json-rpc-message.ts
import { parseJSON } from "@ai-sdk/provider-utils";
import { z as z2 } from "zod/v4";

// src/tool/types.ts
import { z } from "zod/v4";
var LATEST_PROTOCOL_VERSION = "2025-11-25";
var SUPPORTED_PROTOCOL_VERSIONS = [
  LATEST_PROTOCOL_VERSION,
  "2025-06-18",
  "2025-03-26",
  "2024-11-05"
];
var ToolMetaSchema = z.optional(z.record(z.string(), z.unknown()));
var ClientOrServerImplementationSchema = z.looseObject({
  name: z.string(),
  version: z.string(),
  title: z.optional(z.string())
});
var BaseParamsSchema = z.looseObject({
  _meta: z.optional(z.object({}).loose())
});
var ResultSchema = BaseParamsSchema;
var RequestSchema = z.object({
  method: z.string(),
  params: z.optional(BaseParamsSchema)
});
var ElicitationCapabilitySchema = z.object({
  applyDefaults: z.optional(z.boolean())
}).loose();
var ServerCapabilitiesSchema = z.looseObject({
  experimental: z.optional(z.object({}).loose()),
  logging: z.optional(z.object({}).loose()),
  completions: z.optional(z.object({}).loose()),
  prompts: z.optional(
    z.looseObject({
      listChanged: z.optional(z.boolean())
    })
  ),
  resources: z.optional(
    z.looseObject({
      subscribe: z.optional(z.boolean()),
      listChanged: z.optional(z.boolean())
    })
  ),
  tools: z.optional(
    z.looseObject({
      listChanged: z.optional(z.boolean())
    })
  ),
  elicitation: z.optional(ElicitationCapabilitySchema)
});
var ClientCapabilitiesSchema = z.object({
  elicitation: z.optional(ElicitationCapabilitySchema)
}).loose();
var InitializeResultSchema = ResultSchema.extend({
  protocolVersion: z.string(),
  capabilities: ServerCapabilitiesSchema,
  serverInfo: ClientOrServerImplementationSchema,
  instructions: z.optional(z.string())
});
var PaginatedResultSchema = ResultSchema.extend({
  nextCursor: z.optional(z.string())
});
var ToolSchema = z.object({
  name: z.string(),
  /**
   * @see https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool
   */
  title: z.optional(z.string()),
  description: z.optional(z.string()),
  inputSchema: z.object({
    type: z.literal("object"),
    properties: z.optional(z.object({}).loose())
  }).loose(),
  /**
   * @see https://modelcontextprotocol.io/specification/2025-06-18/server/tools#output-schema
   */
  outputSchema: z.optional(z.object({}).loose()),
  annotations: z.optional(
    z.object({
      title: z.optional(z.string())
    }).loose()
  ),
  _meta: ToolMetaSchema
}).loose();
var ListToolsResultSchema = PaginatedResultSchema.extend({
  tools: z.array(ToolSchema)
});
var TextContentSchema = z.object({
  type: z.literal("text"),
  text: z.string()
}).loose();
var ImageContentSchema = z.object({
  type: z.literal("image"),
  data: z.base64(),
  mimeType: z.string()
}).loose();
var ResourceSchema = z.object({
  uri: z.string(),
  name: z.string(),
  title: z.optional(z.string()),
  description: z.optional(z.string()),
  mimeType: z.optional(z.string()),
  size: z.optional(z.number())
}).loose();
var ListResourcesResultSchema = PaginatedResultSchema.extend({
  resources: z.array(ResourceSchema)
});
var ResourceContentsSchema = z.object({
  /**
   * The URI of this resource.
   */
  uri: z.string(),
  /**
   * Optional display name of the resource content.
   */
  name: z.optional(z.string()),
  /**
   * Optional human readable title.
   */
  title: z.optional(z.string()),
  /**
   * The MIME type of this resource, if known.
   */
  mimeType: z.optional(z.string())
}).loose();
var TextResourceContentsSchema = ResourceContentsSchema.extend({
  text: z.string()
});
var BlobResourceContentsSchema = ResourceContentsSchema.extend({
  blob: z.base64()
});
var EmbeddedResourceSchema = z.object({
  type: z.literal("resource"),
  resource: z.union([TextResourceContentsSchema, BlobResourceContentsSchema])
}).loose();
var ResourceLinkContentSchema = z.object({
  type: z.literal("resource_link"),
  uri: z.string(),
  name: z.string(),
  description: z.optional(z.string()),
  mimeType: z.optional(z.string())
}).loose();
var CallToolResultSchema = ResultSchema.extend({
  content: z.array(
    z.union([
      TextContentSchema,
      ImageContentSchema,
      EmbeddedResourceSchema,
      ResourceLinkContentSchema
    ])
  ),
  /**
   * @see https://modelcontextprotocol.io/specification/2025-06-18/server/tools#structured-content
   */
  structuredContent: z.optional(z.unknown()),
  isError: z.boolean().default(false).optional()
}).or(
  ResultSchema.extend({
    toolResult: z.unknown()
  })
);
var ResourceTemplateSchema = z.object({
  uriTemplate: z.string(),
  name: z.string(),
  title: z.optional(z.string()),
  description: z.optional(z.string()),
  mimeType: z.optional(z.string())
}).loose();
var ListResourceTemplatesResultSchema = ResultSchema.extend({
  resourceTemplates: z.array(ResourceTemplateSchema)
});
var ReadResourceResultSchema = ResultSchema.extend({
  contents: z.array(
    z.union([TextResourceContentsSchema, BlobResourceContentsSchema])
  )
});
var PromptReferenceSchema = z.object({
  type: z.literal("ref/prompt"),
  name: z.string()
}).loose();
var ResourceReferenceSchema = z.object({
  type: z.literal("ref/resource"),
  uri: z.string()
}).loose();
var CompletionArgumentSchema = z.object({
  name: z.string(),
  value: z.string()
}).loose();
var CompleteRequestParamsSchema = BaseParamsSchema.extend({
  ref: z.union([PromptReferenceSchema, ResourceReferenceSchema]),
  argument: CompletionArgumentSchema,
  context: z.optional(
    z.object({
      arguments: z.record(z.string(), z.string())
    }).loose()
  )
});
var CompleteResultSchema = ResultSchema.extend({
  completion: z.object({
    values: z.array(z.string()).max(100),
    total: z.optional(z.number().int()),
    hasMore: z.optional(z.boolean())
  }).loose()
});
var PromptArgumentSchema = z.object({
  name: z.string(),
  description: z.optional(z.string()),
  required: z.optional(z.boolean())
}).loose();
var PromptSchema = z.object({
  name: z.string(),
  title: z.optional(z.string()),
  description: z.optional(z.string()),
  arguments: z.optional(z.array(PromptArgumentSchema))
}).loose();
var ListPromptsResultSchema = PaginatedResultSchema.extend({
  prompts: z.array(PromptSchema)
});
var PromptMessageSchema = z.object({
  role: z.union([z.literal("user"), z.literal("assistant")]),
  content: z.union([
    TextContentSchema,
    ImageContentSchema,
    EmbeddedResourceSchema,
    ResourceLinkContentSchema
  ])
}).loose();
var GetPromptResultSchema = ResultSchema.extend({
  description: z.optional(z.string()),
  messages: z.array(PromptMessageSchema)
});
var ElicitationRequestParamsSchema = BaseParamsSchema.extend({
  message: z.string(),
  requestedSchema: z.unknown()
});
var ElicitationRequestSchema = RequestSchema.extend({
  method: z.literal("elicitation/create"),
  params: ElicitationRequestParamsSchema
});
var ElicitResultSchema = ResultSchema.extend({
  action: z.union([
    z.literal("accept"),
    z.literal("decline"),
    z.literal("cancel")
  ]),
  content: z.optional(z.record(z.string(), z.unknown()))
});

// src/tool/json-rpc-message.ts
var JSONRPC_VERSION = "2.0";
var JSONRPCRequestSchema = z2.object({
  jsonrpc: z2.literal(JSONRPC_VERSION),
  id: z2.union([z2.string(), z2.number().int()])
}).merge(RequestSchema).strict();
var JSONRPCResponseSchema = z2.object({
  jsonrpc: z2.literal(JSONRPC_VERSION),
  id: z2.union([z2.string(), z2.number().int()]),
  result: ResultSchema
}).strict();
var JSONRPCErrorSchema = z2.object({
  jsonrpc: z2.literal(JSONRPC_VERSION),
  id: z2.union([z2.string(), z2.number().int()]),
  error: z2.object({
    code: z2.number().int(),
    message: z2.string(),
    data: z2.optional(z2.unknown())
  })
}).strict();
var JSONRPCNotificationSchema = z2.object({
  jsonrpc: z2.literal(JSONRPC_VERSION)
}).merge(
  z2.object({
    method: z2.string(),
    params: z2.optional(BaseParamsSchema)
  })
).strict();
var JSONRPCMessageSchema = z2.union([
  JSONRPCRequestSchema,
  JSONRPCNotificationSchema,
  JSONRPCResponseSchema,
  JSONRPCErrorSchema
]);
function validateJSONRPCMessage(message) {
  return JSONRPCMessageSchema.parse(message);
}
async function parseJSONRPCMessage(text) {
  return validateJSONRPCMessage(await parseJSON({ text }));
}

// src/tool/mcp-client.ts
import {
  asSchema,
  dynamicTool,
  jsonSchema,
  retryWithExponentialBackoff,
  safeParseJSON,
  safeValidateTypes,
  tool
} from "@ai-sdk/provider-utils";

// src/error/mcp-client-error.ts
import { AISDKError } from "@ai-sdk/provider";
var name = "AI_MCPClientError";
var marker = `vercel.ai.error.${name}`;
var symbol = Symbol.for(marker);
var _a, _b;
var MCPClientError = class extends (_b = AISDKError, _a = symbol, _b) {
  constructor({
    name: name3 = "MCPClientError",
    message,
    cause,
    data,
    code,
    statusCode,
    url,
    responseBody
  }) {
    super({ name: name3, message, cause });
    this[_a] = true;
    this.data = data;
    this.code = code;
    this.statusCode = statusCode;
    this.url = url;
    this.responseBody = responseBody;
  }
  static isInstance(error) {
    return AISDKError.hasMarker(error, marker);
  }
};

// src/tool/mcp-sse-transport.ts
import {
  EventSourceParserStream,
  withUserAgentSuffix,
  getRuntimeEnvironmentUserAgent
} from "@ai-sdk/provider-utils";

// src/version.ts
var VERSION = typeof __PACKAGE_VERSION__ !== "undefined" ? __PACKAGE_VERSION__ : "0.0.0-test";

// src/tool/oauth.ts
import pkceChallenge from "pkce-challenge";

// src/tool/oauth-types.ts
import { z as z3 } from "zod/v4";
var SafeUrlSchema = z3.string().url().superRefine((val, ctx) => {
  if (!URL.canParse(val)) {
    ctx.addIssue({
      code: z3.ZodIssueCode.custom,
      message: "URL must be parseable",
      fatal: true
    });
    return z3.NEVER;
  }
}).refine(
  (url) => {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol !== "javascript:" && parsedUrl.protocol !== "data:" && parsedUrl.protocol !== "vbscript:";
  },
  { message: "URL cannot use javascript:, data:, or vbscript: scheme" }
);
var OAuthTokensSchema = z3.object({
  access_token: z3.string(),
  id_token: z3.string().optional(),
  // Optional for OAuth 2.1, but necessary in OpenID Connect
  token_type: z3.string(),
  expires_in: z3.number().optional(),
  scope: z3.string().optional(),
  refresh_token: z3.string().optional(),
  authorization_server: SafeUrlSchema.optional(),
  token_endpoint: SafeUrlSchema.optional()
}).strip();
var OAuthProtectedResourceMetadataSchema = z3.looseObject({
  resource: z3.string().url(),
  authorization_servers: z3.array(SafeUrlSchema).optional(),
  jwks_uri: z3.string().url().optional(),
  scopes_supported: z3.array(z3.string()).optional(),
  bearer_methods_supported: z3.array(z3.string()).optional(),
  resource_signing_alg_values_supported: z3.array(z3.string()).optional(),
  resource_name: z3.string().optional(),
  resource_documentation: z3.string().optional(),
  resource_policy_uri: z3.string().url().optional(),
  resource_tos_uri: z3.string().url().optional(),
  tls_client_certificate_bound_access_tokens: z3.boolean().optional(),
  authorization_details_types_supported: z3.array(z3.string()).optional(),
  dpop_signing_alg_values_supported: z3.array(z3.string()).optional(),
  dpop_bound_access_tokens_required: z3.boolean().optional()
});
var OAuthMetadataSchema = z3.looseObject({
  issuer: z3.string(),
  authorization_endpoint: SafeUrlSchema,
  token_endpoint: SafeUrlSchema,
  registration_endpoint: SafeUrlSchema.optional(),
  scopes_supported: z3.array(z3.string()).optional(),
  response_types_supported: z3.array(z3.string()),
  grant_types_supported: z3.array(z3.string()).optional(),
  code_challenge_methods_supported: z3.array(z3.string()).optional(),
  token_endpoint_auth_methods_supported: z3.array(z3.string()).optional(),
  token_endpoint_auth_signing_alg_values_supported: z3.array(z3.string()).optional()
});
var OpenIdProviderMetadataSchema = z3.looseObject({
  issuer: z3.string(),
  authorization_endpoint: SafeUrlSchema,
  token_endpoint: SafeUrlSchema,
  userinfo_endpoint: SafeUrlSchema.optional(),
  jwks_uri: SafeUrlSchema,
  registration_endpoint: SafeUrlSchema.optional(),
  scopes_supported: z3.array(z3.string()).optional(),
  response_types_supported: z3.array(z3.string()),
  grant_types_supported: z3.array(z3.string()).optional(),
  subject_types_supported: z3.array(z3.string()),
  id_token_signing_alg_values_supported: z3.array(z3.string()),
  claims_supported: z3.array(z3.string()).optional(),
  token_endpoint_auth_methods_supported: z3.array(z3.string()).optional()
});
var OpenIdProviderDiscoveryMetadataSchema = OpenIdProviderMetadataSchema.merge(
  OAuthMetadataSchema.pick({
    code_challenge_methods_supported: true
  })
);
var OAuthClientInformationSchema = z3.object({
  client_id: z3.string(),
  client_secret: z3.string().optional(),
  client_id_issued_at: z3.number().optional(),
  client_secret_expires_at: z3.number().optional(),
  authorization_server: SafeUrlSchema.optional(),
  token_endpoint: SafeUrlSchema.optional()
}).strip();
var OAuthClientMetadataSchema = z3.object({
  redirect_uris: z3.array(SafeUrlSchema),
  token_endpoint_auth_method: z3.string().optional(),
  grant_types: z3.array(z3.string()).optional(),
  response_types: z3.array(z3.string()).optional(),
  client_name: z3.string().optional(),
  client_uri: SafeUrlSchema.optional(),
  logo_uri: SafeUrlSchema.optional(),
  scope: z3.string().optional(),
  contacts: z3.array(z3.string()).optional(),
  tos_uri: SafeUrlSchema.optional(),
  policy_uri: z3.string().optional(),
  jwks_uri: SafeUrlSchema.optional(),
  jwks: z3.any().optional(),
  software_id: z3.string().optional(),
  software_version: z3.string().optional(),
  software_statement: z3.string().optional()
}).strip();
var OAuthErrorResponseSchema = z3.object({
  error: z3.string(),
  error_description: z3.string().optional(),
  error_uri: z3.string().optional()
});
var OAuthClientInformationFullSchema = OAuthClientMetadataSchema.merge(
  OAuthClientInformationSchema
);

// src/error/oauth-error.ts
import { AISDKError as AISDKError2 } from "@ai-sdk/provider";
var name2 = "AI_MCPClientOAuthError";
var marker2 = `vercel.ai.error.${name2}`;
var symbol2 = Symbol.for(marker2);
var _a2, _b2;
var MCPClientOAuthError = class extends (_b2 = AISDKError2, _a2 = symbol2, _b2) {
  constructor({
    name: name3 = "MCPClientOAuthError",
    message,
    cause
  }) {
    super({ name: name3, message, cause });
    this[_a2] = true;
  }
  static isInstance(error) {
    return AISDKError2.hasMarker(error, marker2);
  }
};
var ServerError = class extends MCPClientOAuthError {
};
ServerError.errorCode = "server_error";
var InvalidClientError = class extends MCPClientOAuthError {
};
InvalidClientError.errorCode = "invalid_client";
var InvalidGrantError = class extends MCPClientOAuthError {
};
InvalidGrantError.errorCode = "invalid_grant";
var UnauthorizedClientError = class extends MCPClientOAuthError {
};
UnauthorizedClientError.errorCode = "unauthorized_client";
var OAUTH_ERRORS = {
  [ServerError.errorCode]: ServerError,
  [InvalidClientError.errorCode]: InvalidClientError,
  [InvalidGrantError.errorCode]: InvalidGrantError,
  [UnauthorizedClientError.errorCode]: UnauthorizedClientError
};

// src/util/oauth-util.ts
function resourceUrlFromServerUrl(url) {
  const resourceURL = typeof url === "string" ? new URL(url) : new URL(url.href);
  resourceURL.hash = "";
  return resourceURL;
}
function resourceUrlStripSlash(resource) {
  const href = resource.href;
  if (resource.pathname === "/" && href.endsWith("/")) {
    return href.slice(0, -1);
  }
  return href;
}
function checkResourceAllowed({
  requestedResource,
  configuredResource
}) {
  const requested = typeof requestedResource === "string" ? new URL(requestedResource) : new URL(requestedResource.href);
  const configured = typeof configuredResource === "string" ? new URL(configuredResource) : new URL(configuredResource.href);
  if (requested.origin !== configured.origin) {
    return false;
  }
  if (requested.pathname.length < configured.pathname.length) {
    return false;
  }
  const requestedPath = requested.pathname.endsWith("/") ? requested.pathname : requested.pathname + "/";
  const configuredPath = configured.pathname.endsWith("/") ? configured.pathname : configured.pathname + "/";
  return requestedPath.startsWith(configuredPath);
}

// src/tool/oauth.ts
import { parseJSON as parseJSON2 } from "@ai-sdk/provider-utils";
var UnauthorizedError = class extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
};
function normalizeUrl(url) {
  return new URL(url).href;
}
function createAuthorizationServerInformation(authorizationServerUrl, metadata) {
  return {
    authorizationServerUrl: normalizeUrl(authorizationServerUrl),
    tokenEndpoint: normalizeUrl(
      (metadata == null ? void 0 : metadata.token_endpoint) ? new URL(metadata.token_endpoint) : new URL("/token", authorizationServerUrl)
    )
  };
}
function addAuthorizationServerInformationToTokens(tokens, authorizationServerInformation) {
  return {
    ...tokens,
    authorization_server: authorizationServerInformation.authorizationServerUrl,
    token_endpoint: authorizationServerInformation.tokenEndpoint
  };
}
function addAuthorizationServerInformationToClientInformation(clientInformation, authorizationServerInformation) {
  return {
    ...clientInformation,
    authorization_server: authorizationServerInformation.authorizationServerUrl,
    token_endpoint: authorizationServerInformation.tokenEndpoint
  };
}
function getAuthorizationServerInformationFromCredentials(credentials) {
  if (!(credentials == null ? void 0 : credentials.authorization_server) || !credentials.token_endpoint) {
    return void 0;
  }
  return {
    authorizationServerUrl: normalizeUrl(credentials.authorization_server),
    tokenEndpoint: normalizeUrl(credentials.token_endpoint)
  };
}
async function getStoredAuthorizationServerInformation({
  provider,
  clientInformation,
  tokens
}) {
  var _a3;
  const tokenAuthorizationServerInformation = getAuthorizationServerInformationFromCredentials(tokens);
  if (tokenAuthorizationServerInformation) {
    return tokenAuthorizationServerInformation;
  }
  const providerAuthorizationServerInformation = await ((_a3 = provider.authorizationServerInformation) == null ? void 0 : _a3.call(provider));
  if (providerAuthorizationServerInformation) {
    return {
      authorizationServerUrl: normalizeUrl(
        providerAuthorizationServerInformation.authorizationServerUrl
      ),
      tokenEndpoint: normalizeUrl(
        providerAuthorizationServerInformation.tokenEndpoint
      )
    };
  }
  return getAuthorizationServerInformationFromCredentials(clientInformation);
}
async function saveAuthorizationServerInformation({
  provider,
  clientInformation,
  authorizationServerInformation
}) {
  if (provider.saveAuthorizationServerInformation) {
    await provider.saveAuthorizationServerInformation(
      authorizationServerInformation
    );
    return true;
  }
  if (provider.saveClientInformation) {
    await provider.saveClientInformation(
      addAuthorizationServerInformationToClientInformation(
        clientInformation,
        authorizationServerInformation
      )
    );
    return true;
  }
  return false;
}
function assertResourceMetadataUrlSameOrigin(serverUrl, resourceMetadataUrl) {
  if (!resourceMetadataUrl) {
    return;
  }
  const expectedOrigin = new URL(serverUrl).origin;
  if (resourceMetadataUrl.origin !== expectedOrigin) {
    throw new MCPClientOAuthError({
      message: `OAuth protected resource metadata URL ${resourceMetadataUrl.href} must have the same origin as the MCP server URL ${expectedOrigin}`
    });
  }
}
function assertAuthorizationServerInformationMatches({
  storedAuthorizationServerInformation,
  currentAuthorizationServerInformation
}) {
  if (storedAuthorizationServerInformation.authorizationServerUrl !== currentAuthorizationServerInformation.authorizationServerUrl || storedAuthorizationServerInformation.tokenEndpoint !== currentAuthorizationServerInformation.tokenEndpoint) {
    throw new MCPClientOAuthError({
      message: "OAuth authorization server metadata does not match the metadata that issued the stored credentials"
    });
  }
}
function extractResourceMetadataUrl(response) {
  var _a3;
  const header = (_a3 = response.headers.get("www-authenticate")) != null ? _a3 : response.headers.get("WWW-Authenticate");
  if (!header) {
    return void 0;
  }
  const [type, scheme] = header.split(" ");
  if (type.toLowerCase() !== "bearer" || !scheme) {
    return void 0;
  }
  const regex = /resource_metadata="([^"]*)"/;
  const match = header.match(regex);
  if (!match) {
    return void 0;
  }
  try {
    return new URL(match[1]);
  } catch (e) {
    return void 0;
  }
}
function buildWellKnownPath(wellKnownPrefix, pathname = "", options = {}) {
  if (pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  return options.prependPathname ? `${pathname}/.well-known/${wellKnownPrefix}` : `/.well-known/${wellKnownPrefix}${pathname}`;
}
async function fetchWithCorsRetry(url, headers, fetchFn = fetch) {
  try {
    return await fetchFn(url, { headers });
  } catch (error) {
    if (error instanceof TypeError) {
      if (headers) {
        return fetchWithCorsRetry(url, void 0, fetchFn);
      } else {
        return void 0;
      }
    }
    throw error;
  }
}
async function tryMetadataDiscovery(url, protocolVersion, fetchFn = fetch) {
  const headers = {
    "MCP-Protocol-Version": protocolVersion
  };
  return await fetchWithCorsRetry(url, headers, fetchFn);
}
function shouldAttemptFallback(response, pathname) {
  return !response || response.status >= 400 && response.status < 500 && pathname !== "/";
}
async function discoverMetadataWithFallback(serverUrl, wellKnownType, fetchFn, opts) {
  var _a3, _b3;
  const issuer = new URL(serverUrl);
  const protocolVersion = (_a3 = opts == null ? void 0 : opts.protocolVersion) != null ? _a3 : LATEST_PROTOCOL_VERSION;
  let url;
  if (opts == null ? void 0 : opts.metadataUrl) {
    url = new URL(opts.metadataUrl);
  } else {
    const wellKnownPath = buildWellKnownPath(wellKnownType, issuer.pathname);
    url = new URL(wellKnownPath, (_b3 = opts == null ? void 0 : opts.metadataServerUrl) != null ? _b3 : issuer);
    url.search = issuer.search;
  }
  let response = await tryMetadataDiscovery(url, protocolVersion, fetchFn);
  if (!(opts == null ? void 0 : opts.metadataUrl) && shouldAttemptFallback(response, issuer.pathname)) {
    const rootUrl = new URL(`/.well-known/${wellKnownType}`, issuer);
    response = await tryMetadataDiscovery(rootUrl, protocolVersion, fetchFn);
  }
  return response;
}
async function discoverOAuthProtectedResourceMetadata(serverUrl, opts, fetchFn = fetch) {
  const response = await discoverMetadataWithFallback(
    serverUrl,
    "oauth-protected-resource",
    fetchFn,
    {
      protocolVersion: opts == null ? void 0 : opts.protocolVersion,
      metadataUrl: opts == null ? void 0 : opts.resourceMetadataUrl
    }
  );
  if (!response || response.status === 404) {
    throw new Error(
      `Resource server does not implement OAuth 2.0 Protected Resource Metadata.`
    );
  }
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} trying to load well-known OAuth protected resource metadata.`
    );
  }
  return OAuthProtectedResourceMetadataSchema.parse(await response.json());
}
function buildDiscoveryUrls(authorizationServerUrl) {
  const url = typeof authorizationServerUrl === "string" ? new URL(authorizationServerUrl) : authorizationServerUrl;
  const hasPath = url.pathname !== "/";
  const rootIssuer = url.origin;
  const urlsToTry = [];
  if (!hasPath) {
    urlsToTry.push({
      url: new URL("/.well-known/oauth-authorization-server", url.origin),
      type: "oauth",
      expectedIssuer: rootIssuer
    });
    urlsToTry.push({
      url: new URL("/.well-known/openid-configuration", url.origin),
      type: "oidc",
      expectedIssuer: rootIssuer
    });
    return urlsToTry;
  }
  let pathname = url.pathname;
  if (pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  const pathIssuer = `${url.origin}${pathname}`;
  urlsToTry.push({
    url: new URL(
      `/.well-known/oauth-authorization-server${pathname}`,
      url.origin
    ),
    type: "oauth",
    expectedIssuer: pathIssuer
  });
  urlsToTry.push({
    url: new URL("/.well-known/oauth-authorization-server", url.origin),
    type: "oauth",
    expectedIssuer: rootIssuer
  });
  urlsToTry.push({
    url: new URL(`/.well-known/openid-configuration${pathname}`, url.origin),
    type: "oidc",
    expectedIssuer: pathIssuer
  });
  urlsToTry.push({
    url: new URL(`${pathname}/.well-known/openid-configuration`, url.origin),
    type: "oidc",
    expectedIssuer: pathIssuer
  });
  return urlsToTry;
}
function assertMetadataIssuerMatches(metadata, expectedIssuer) {
  if (metadata.issuer !== expectedIssuer) {
    throw new MCPClientOAuthError({
      message: `OAuth authorization server metadata issuer ${metadata.issuer} does not match expected issuer ${expectedIssuer}`
    });
  }
}
async function discoverAuthorizationServerMetadata(authorizationServerUrl, {
  fetchFn = fetch,
  protocolVersion = LATEST_PROTOCOL_VERSION
} = {}) {
  var _a3;
  const headers = { "MCP-Protocol-Version": protocolVersion };
  const urlsToTry = buildDiscoveryUrls(authorizationServerUrl);
  for (const { url: endpointUrl, type, expectedIssuer } of urlsToTry) {
    const response = await fetchWithCorsRetry(endpointUrl, headers, fetchFn);
    if (!response) {
      continue;
    }
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        continue;
      }
      throw new Error(
        `HTTP ${response.status} trying to load ${type === "oauth" ? "OAuth" : "OpenID provider"} metadata from ${endpointUrl}`
      );
    }
    if (type === "oauth") {
      const metadata = OAuthMetadataSchema.parse(await response.json());
      assertMetadataIssuerMatches(metadata, expectedIssuer);
      return metadata;
    } else {
      const metadata = OpenIdProviderDiscoveryMetadataSchema.parse(
        await response.json()
      );
      assertMetadataIssuerMatches(metadata, expectedIssuer);
      if (!((_a3 = metadata.code_challenge_methods_supported) == null ? void 0 : _a3.includes("S256"))) {
        throw new Error(
          `Incompatible OIDC provider at ${endpointUrl}: does not support S256 code challenge method required by MCP specification`
        );
      }
      return metadata;
    }
  }
  return void 0;
}
async function startAuthorization(authorizationServerUrl, {
  metadata,
  clientInformation,
  redirectUrl,
  scope,
  state,
  resource
}) {
  const responseType = "code";
  const codeChallengeMethod = "S256";
  let authorizationUrl;
  if (metadata) {
    authorizationUrl = new URL(metadata.authorization_endpoint);
    if (!metadata.response_types_supported.includes(responseType)) {
      throw new Error(
        `Incompatible auth server: does not support response type ${responseType}`
      );
    }
    if (!metadata.code_challenge_methods_supported || !metadata.code_challenge_methods_supported.includes(codeChallengeMethod)) {
      throw new Error(
        `Incompatible auth server: does not support code challenge method ${codeChallengeMethod}`
      );
    }
  } else {
    authorizationUrl = new URL("/authorize", authorizationServerUrl);
  }
  const challenge = await pkceChallenge();
  const codeVerifier = challenge.code_verifier;
  const codeChallenge = challenge.code_challenge;
  authorizationUrl.searchParams.set("response_type", responseType);
  authorizationUrl.searchParams.set("client_id", clientInformation.client_id);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set(
    "code_challenge_method",
    codeChallengeMethod
  );
  authorizationUrl.searchParams.set("redirect_uri", String(redirectUrl));
  if (state) {
    authorizationUrl.searchParams.set("state", state);
  }
  if (scope) {
    authorizationUrl.searchParams.set("scope", scope);
  }
  if (scope == null ? void 0 : scope.includes("offline_access")) {
    authorizationUrl.searchParams.append("prompt", "consent");
  }
  if (resource) {
    authorizationUrl.searchParams.set(
      "resource",
      resourceUrlStripSlash(resource)
    );
  }
  return { authorizationUrl, codeVerifier };
}
function selectClientAuthMethod(clientInformation, supportedMethods) {
  const hasClientSecret = clientInformation.client_secret !== void 0;
  if (supportedMethods.length === 0) {
    return hasClientSecret ? "client_secret_post" : "none";
  }
  if (hasClientSecret && supportedMethods.includes("client_secret_basic")) {
    return "client_secret_basic";
  }
  if (hasClientSecret && supportedMethods.includes("client_secret_post")) {
    return "client_secret_post";
  }
  if (supportedMethods.includes("none")) {
    return "none";
  }
  return hasClientSecret ? "client_secret_post" : "none";
}
function applyClientAuthentication(method, clientInformation, headers, params) {
  const { client_id, client_secret } = clientInformation;
  switch (method) {
    case "client_secret_basic":
      applyBasicAuth(client_id, client_secret, headers);
      return;
    case "client_secret_post":
      applyPostAuth(client_id, client_secret, params);
      return;
    case "none":
      applyPublicAuth(client_id, params);
      return;
    default:
      throw new Error(`Unsupported client authentication method: ${method}`);
  }
}
function applyBasicAuth(clientId, clientSecret, headers) {
  if (!clientSecret) {
    throw new Error(
      "client_secret_basic authentication requires a client_secret"
    );
  }
  const credentials = btoa(`${clientId}:${clientSecret}`);
  headers.set("Authorization", `Basic ${credentials}`);
}
function applyPostAuth(clientId, clientSecret, params) {
  params.set("client_id", clientId);
  if (clientSecret) {
    params.set("client_secret", clientSecret);
  }
}
function applyPublicAuth(clientId, params) {
  params.set("client_id", clientId);
}
async function parseErrorResponse(input) {
  const statusCode = input instanceof Response ? input.status : void 0;
  const body = input instanceof Response ? await input.text() : input;
  try {
    const result = OAuthErrorResponseSchema.parse(
      await parseJSON2({ text: body })
    );
    const { error, error_description, error_uri } = result;
    const errorClass = OAUTH_ERRORS[error] || ServerError;
    return new errorClass({
      message: error_description || "",
      cause: error_uri
    });
  } catch (error) {
    const errorMessage = `${statusCode ? `HTTP ${statusCode}: ` : ""}Invalid OAuth error response: ${error}. Raw body: ${body}`;
    return new ServerError({ message: errorMessage });
  }
}
async function exchangeAuthorization(authorizationServerUrl, {
  metadata,
  clientInformation,
  authorizationCode,
  codeVerifier,
  redirectUri,
  resource,
  addClientAuthentication,
  fetchFn
}) {
  var _a3;
  const grantType = "authorization_code";
  const tokenUrl = (metadata == null ? void 0 : metadata.token_endpoint) ? new URL(metadata.token_endpoint) : new URL("/token", authorizationServerUrl);
  if ((metadata == null ? void 0 : metadata.grant_types_supported) && !metadata.grant_types_supported.includes(grantType)) {
    throw new Error(
      `Incompatible auth server: does not support grant type ${grantType}`
    );
  }
  const headers = new Headers({
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json"
  });
  const params = new URLSearchParams({
    grant_type: grantType,
    code: authorizationCode,
    code_verifier: codeVerifier,
    redirect_uri: String(redirectUri)
  });
  if (addClientAuthentication) {
    await addClientAuthentication(
      headers,
      params,
      authorizationServerUrl,
      metadata
    );
  } else {
    const supportedMethods = (_a3 = metadata == null ? void 0 : metadata.token_endpoint_auth_methods_supported) != null ? _a3 : [];
    const authMethod = selectClientAuthMethod(
      clientInformation,
      supportedMethods
    );
    applyClientAuthentication(authMethod, clientInformation, headers, params);
  }
  if (resource) {
    params.set("resource", resourceUrlStripSlash(resource));
  }
  const response = await (fetchFn != null ? fetchFn : fetch)(tokenUrl, {
    method: "POST",
    headers,
    body: params
  });
  if (!response.ok) {
    throw await parseErrorResponse(response);
  }
  return OAuthTokensSchema.parse(await response.json());
}
async function refreshAuthorization(authorizationServerUrl, {
  metadata,
  clientInformation,
  refreshToken,
  resource,
  addClientAuthentication,
  fetchFn
}) {
  var _a3;
  const grantType = "refresh_token";
  let tokenUrl;
  if (metadata) {
    tokenUrl = new URL(metadata.token_endpoint);
    if (metadata.grant_types_supported && !metadata.grant_types_supported.includes(grantType)) {
      throw new Error(
        `Incompatible auth server: does not support grant type ${grantType}`
      );
    }
  } else {
    tokenUrl = new URL("/token", authorizationServerUrl);
  }
  const headers = new Headers({
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json"
  });
  const params = new URLSearchParams({
    grant_type: grantType,
    refresh_token: refreshToken
  });
  if (addClientAuthentication) {
    await addClientAuthentication(
      headers,
      params,
      authorizationServerUrl,
      metadata
    );
  } else {
    const supportedMethods = (_a3 = metadata == null ? void 0 : metadata.token_endpoint_auth_methods_supported) != null ? _a3 : [];
    const authMethod = selectClientAuthMethod(
      clientInformation,
      supportedMethods
    );
    applyClientAuthentication(authMethod, clientInformation, headers, params);
  }
  if (resource) {
    params.set("resource", resourceUrlStripSlash(resource));
  }
  const response = await (fetchFn != null ? fetchFn : fetch)(tokenUrl, {
    method: "POST",
    headers,
    body: params
  });
  if (!response.ok) {
    throw await parseErrorResponse(response);
  }
  return OAuthTokensSchema.parse({
    refresh_token: refreshToken,
    ...await response.json()
  });
}
async function registerClient(authorizationServerUrl, {
  metadata,
  clientMetadata,
  fetchFn
}) {
  let registrationUrl;
  if (metadata) {
    if (!metadata.registration_endpoint) {
      throw new Error(
        "Incompatible auth server: does not support dynamic client registration"
      );
    }
    registrationUrl = new URL(metadata.registration_endpoint);
  } else {
    registrationUrl = new URL("/register", authorizationServerUrl);
  }
  const response = await (fetchFn != null ? fetchFn : fetch)(registrationUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(clientMetadata)
  });
  if (!response.ok) {
    throw await parseErrorResponse(response);
  }
  return OAuthClientInformationFullSchema.parse(await response.json());
}
async function auth(provider, options) {
  var _a3, _b3;
  try {
    return await authInternal(provider, options);
  } catch (error) {
    if (error instanceof InvalidClientError || error instanceof UnauthorizedClientError) {
      await ((_a3 = provider.invalidateCredentials) == null ? void 0 : _a3.call(provider, "all"));
      return await authInternal(provider, options);
    } else if (error instanceof InvalidGrantError) {
      await ((_b3 = provider.invalidateCredentials) == null ? void 0 : _b3.call(provider, "tokens"));
      return await authInternal(provider, options);
    }
    throw error;
  }
}
async function selectResourceURL(serverUrl, provider, resourceMetadata) {
  const defaultResource = resourceUrlFromServerUrl(serverUrl);
  if (provider.validateResourceURL) {
    return await provider.validateResourceURL(
      defaultResource,
      resourceMetadata == null ? void 0 : resourceMetadata.resource
    );
  }
  if (!resourceMetadata) {
    return void 0;
  }
  if (!checkResourceAllowed({
    requestedResource: defaultResource,
    configuredResource: resourceMetadata.resource
  })) {
    throw new Error(
      `Protected resource ${resourceMetadata.resource} does not match expected ${defaultResource} (or origin)`
    );
  }
  return new URL(resourceMetadata.resource);
}
async function authInternal(provider, {
  serverUrl,
  authorizationCode,
  callbackState,
  scope,
  resourceMetadataUrl,
  fetchFn
}) {
  var _a3, _b3;
  let resourceMetadata;
  let authorizationServerUrl;
  assertResourceMetadataUrlSameOrigin(serverUrl, resourceMetadataUrl);
  try {
    resourceMetadata = await discoverOAuthProtectedResourceMetadata(
      serverUrl,
      { resourceMetadataUrl },
      fetchFn
    );
    if (resourceMetadata.authorization_servers && resourceMetadata.authorization_servers.length > 0) {
      authorizationServerUrl = resourceMetadata.authorization_servers[0];
    }
  } catch (e) {
  }
  if (!authorizationServerUrl) {
    authorizationServerUrl = serverUrl;
  }
  const resource = await selectResourceURL(
    serverUrl,
    provider,
    resourceMetadata
  );
  await ((_a3 = provider.validateAuthorizationServerURL) == null ? void 0 : _a3.call(
    provider,
    serverUrl,
    authorizationServerUrl
  ));
  const metadata = await discoverAuthorizationServerMetadata(
    authorizationServerUrl,
    {
      fetchFn
    }
  );
  const currentAuthorizationServerInformation = createAuthorizationServerInformation(authorizationServerUrl, metadata);
  let clientInformation = await Promise.resolve(provider.clientInformation());
  if (!clientInformation) {
    if (authorizationCode !== void 0) {
      throw new Error(
        "Existing OAuth client information is required when exchanging an authorization code"
      );
    }
    if (!provider.saveClientInformation) {
      throw new Error(
        "OAuth client information must be saveable for dynamic registration"
      );
    }
    const fullInformation = await registerClient(authorizationServerUrl, {
      metadata,
      clientMetadata: provider.clientMetadata,
      fetchFn
    });
    clientInformation = addAuthorizationServerInformationToClientInformation(
      fullInformation,
      currentAuthorizationServerInformation
    );
    await provider.saveClientInformation(clientInformation);
  }
  if (authorizationCode !== void 0) {
    if (provider.storedState) {
      const expectedState = await provider.storedState();
      if (expectedState !== void 0 && expectedState !== callbackState) {
        throw new Error(
          "OAuth state parameter mismatch - possible CSRF attack"
        );
      }
    }
    const storedAuthorizationServerInformation = await getStoredAuthorizationServerInformation({
      provider,
      clientInformation
    });
    if (!storedAuthorizationServerInformation) {
      throw new MCPClientOAuthError({
        message: "Stored OAuth authorization server metadata is required when exchanging an authorization code"
      });
    }
    assertAuthorizationServerInformationMatches({
      storedAuthorizationServerInformation,
      currentAuthorizationServerInformation
    });
    const codeVerifier2 = await provider.codeVerifier();
    const tokens2 = await exchangeAuthorization(authorizationServerUrl, {
      metadata,
      clientInformation,
      authorizationCode,
      codeVerifier: codeVerifier2,
      redirectUri: provider.redirectUrl,
      resource,
      addClientAuthentication: provider.addClientAuthentication,
      fetchFn
    });
    await provider.saveTokens(
      addAuthorizationServerInformationToTokens(
        tokens2,
        currentAuthorizationServerInformation
      )
    );
    return "AUTHORIZED";
  }
  const tokens = await provider.tokens();
  if (tokens == null ? void 0 : tokens.refresh_token) {
    const storedAuthorizationServerInformation = await getStoredAuthorizationServerInformation({
      provider,
      clientInformation,
      tokens
    });
    if (storedAuthorizationServerInformation) {
      assertAuthorizationServerInformationMatches({
        storedAuthorizationServerInformation,
        currentAuthorizationServerInformation
      });
    } else {
      await ((_b3 = provider.invalidateCredentials) == null ? void 0 : _b3.call(provider, "tokens"));
    }
    try {
      if (storedAuthorizationServerInformation) {
        const newTokens = await refreshAuthorization(authorizationServerUrl, {
          metadata,
          clientInformation,
          refreshToken: tokens.refresh_token,
          resource,
          addClientAuthentication: provider.addClientAuthentication,
          fetchFn
        });
        await provider.saveTokens(
          addAuthorizationServerInformationToTokens(
            newTokens,
            currentAuthorizationServerInformation
          )
        );
        return "AUTHORIZED";
      }
    } catch (error) {
      if (
        // If this is a ServerError, or an unknown type, log it out and try to continue. Otherwise, escalate so we can fix things and retry.
        !(error instanceof MCPClientOAuthError) || error instanceof ServerError
      ) {
      } else {
        throw error;
      }
    }
  }
  const state = provider.state ? await provider.state() : void 0;
  if (state && provider.saveState) {
    await provider.saveState(state);
  }
  const { authorizationUrl, codeVerifier } = await startAuthorization(
    authorizationServerUrl,
    {
      metadata,
      clientInformation,
      state,
      redirectUrl: provider.redirectUrl,
      scope: scope || provider.clientMetadata.scope,
      resource
    }
  );
  const savedAuthorizationServerInformation = await saveAuthorizationServerInformation({
    provider,
    clientInformation,
    authorizationServerInformation: currentAuthorizationServerInformation
  });
  if (!savedAuthorizationServerInformation) {
    throw new MCPClientOAuthError({
      message: "OAuth authorization server metadata must be saveable before starting authorization"
    });
  }
  await provider.saveCodeVerifier(codeVerifier);
  await provider.redirectToAuthorization(authorizationUrl);
  return "REDIRECT";
}

// src/tool/mcp-sse-transport.ts
function isMessageEvent(event) {
  return event === void 0 || event === "message";
}
var SseMCPTransport = class {
  constructor({
    url,
    headers,
    authProvider,
    redirect = "error",
    fetch: fetchFn
  }) {
    this.connected = false;
    this.url = new URL(url);
    this.headers = headers;
    this.authProvider = authProvider;
    this.redirectMode = redirect;
    this.fetchFn = fetchFn != null ? fetchFn : globalThis.fetch;
  }
  setProtocolVersion(version) {
    this.protocolVersion = version;
  }
  async commonHeaders(base) {
    var _a3;
    const headers = {
      ...this.headers,
      ...base,
      "mcp-protocol-version": (_a3 = this.protocolVersion) != null ? _a3 : LATEST_PROTOCOL_VERSION
    };
    if (this.authProvider) {
      const tokens = await this.authProvider.tokens();
      if (tokens == null ? void 0 : tokens.access_token) {
        headers["Authorization"] = `Bearer ${tokens.access_token}`;
      }
    }
    return withUserAgentSuffix(
      headers,
      `ai-sdk/${VERSION}`,
      getRuntimeEnvironmentUserAgent()
    );
  }
  async start() {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        return resolve();
      }
      this.abortController = new AbortController();
      const establishConnection = async (triedAuth = false) => {
        var _a3, _b3, _c, _d, _e;
        try {
          const headers = await this.commonHeaders({
            Accept: "text/event-stream"
          });
          const response = await this.fetchFn(this.url.href, {
            headers,
            signal: (_a3 = this.abortController) == null ? void 0 : _a3.signal,
            redirect: this.redirectMode
          });
          if (response.status === 401 && this.authProvider && !triedAuth) {
            this.resourceMetadataUrl = extractResourceMetadataUrl(response);
            try {
              const result = await auth(this.authProvider, {
                serverUrl: this.url,
                resourceMetadataUrl: this.resourceMetadataUrl,
                fetchFn: this.fetchFn
              });
              if (result !== "AUTHORIZED") {
                const error = new UnauthorizedError();
                (_b3 = this.onerror) == null ? void 0 : _b3.call(this, error);
                return reject(error);
              }
            } catch (error) {
              (_c = this.onerror) == null ? void 0 : _c.call(this, error);
              return reject(error);
            }
            return establishConnection(true);
          }
          if (!response.ok || !response.body) {
            let errorMessage = `MCP SSE Transport Error: ${response.status} ${response.statusText}`;
            if (response.status === 405) {
              errorMessage += ". This server does not support SSE transport. Try using `http` transport instead";
            }
            const error = new MCPClientError({
              message: errorMessage
            });
            (_d = this.onerror) == null ? void 0 : _d.call(this, error);
            return reject(error);
          }
          const stream = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream());
          const reader = stream.getReader();
          const processEvents = async () => {
            var _a4, _b4, _c2, _d2, _e2;
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  if (this.connected) {
                    this.connected = false;
                    throw new MCPClientError({
                      message: "MCP SSE Transport Error: Connection closed unexpectedly"
                    });
                  }
                  return;
                }
                const { event, data } = value;
                if (event === "endpoint") {
                  if (this.endpoint) {
                    continue;
                  }
                  const endpoint = new URL(data, this.url);
                  if (endpoint.origin !== this.url.origin) {
                    this.connected = false;
                    this.endpoint = void 0;
                    (_a4 = this.sseConnection) == null ? void 0 : _a4.close();
                    (_b4 = this.abortController) == null ? void 0 : _b4.abort();
                    throw new MCPClientError({
                      message: `MCP SSE Transport Error: Endpoint origin does not match connection origin: ${endpoint.origin}`
                    });
                  }
                  this.endpoint = endpoint;
                  this.connected = true;
                  resolve();
                } else if (isMessageEvent(event)) {
                  try {
                    const message = await parseJSONRPCMessage(data);
                    (_c2 = this.onmessage) == null ? void 0 : _c2.call(this, message);
                  } catch (error) {
                    const e = new MCPClientError({
                      message: "MCP SSE Transport Error: Failed to parse message",
                      cause: error
                    });
                    (_d2 = this.onerror) == null ? void 0 : _d2.call(this, e);
                  }
                }
              }
            } catch (error) {
              if (error instanceof Error && error.name === "AbortError") {
                return;
              }
              (_e2 = this.onerror) == null ? void 0 : _e2.call(this, error);
              reject(error);
            }
          };
          this.sseConnection = {
            close: () => reader.cancel()
          };
          processEvents();
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }
          (_e = this.onerror) == null ? void 0 : _e.call(this, error);
          reject(error);
        }
      };
      void establishConnection();
    });
  }
  async close() {
    var _a3, _b3, _c;
    this.connected = false;
    this.endpoint = void 0;
    (_a3 = this.sseConnection) == null ? void 0 : _a3.close();
    (_b3 = this.abortController) == null ? void 0 : _b3.abort();
    (_c = this.onclose) == null ? void 0 : _c.call(this);
  }
  async send(message) {
    if (!this.endpoint || !this.connected) {
      throw new MCPClientError({
        message: "MCP SSE Transport Error: Not connected"
      });
    }
    const endpoint = this.endpoint;
    const attempt = async (triedAuth = false) => {
      var _a3, _b3, _c, _d, _e;
      try {
        const headers = await this.commonHeaders({
          "Content-Type": "application/json"
        });
        const init = {
          method: "POST",
          headers,
          body: JSON.stringify(message),
          signal: (_a3 = this.abortController) == null ? void 0 : _a3.signal,
          redirect: this.redirectMode
        };
        const response = await this.fetchFn(endpoint.href, init);
        if (response.status === 401 && this.authProvider && !triedAuth) {
          this.resourceMetadataUrl = extractResourceMetadataUrl(response);
          try {
            const result = await auth(this.authProvider, {
              serverUrl: this.url,
              resourceMetadataUrl: this.resourceMetadataUrl,
              fetchFn: this.fetchFn
            });
            if (result !== "AUTHORIZED") {
              const error = new UnauthorizedError();
              (_b3 = this.onerror) == null ? void 0 : _b3.call(this, error);
              return;
            }
          } catch (error) {
            (_c = this.onerror) == null ? void 0 : _c.call(this, error);
            return;
          }
          return attempt(true);
        }
        if (!response.ok) {
          const text = await response.text().catch(() => null);
          const error = new MCPClientError({
            message: `MCP SSE Transport Error: POSTing to endpoint (HTTP ${response.status}): ${text}`
          });
          (_d = this.onerror) == null ? void 0 : _d.call(this, error);
          return;
        }
      } catch (error) {
        (_e = this.onerror) == null ? void 0 : _e.call(this, error);
        return;
      }
    };
    await attempt();
  }
};

// src/tool/mcp-http-transport.ts
import {
  EventSourceParserStream as EventSourceParserStream2,
  withUserAgentSuffix as withUserAgentSuffix2,
  getRuntimeEnvironmentUserAgent as getRuntimeEnvironmentUserAgent2
} from "@ai-sdk/provider-utils";
function isMessageEvent2(event) {
  return event === void 0 || event === "message";
}
var HttpMCPTransport = class {
  constructor({
    url,
    headers,
    authProvider,
    redirect = "error",
    initialSessionId,
    initialProtocolVersion,
    onSessionIdChange,
    onSessionExpired,
    terminateSessionOnClose = true,
    fetch: fetchFn
  }) {
    this.inboundReconnectAttempts = 0;
    this.reconnectionOptions = {
      initialReconnectionDelay: 1e3,
      maxReconnectionDelay: 3e4,
      reconnectionDelayGrowFactor: 1.5,
      maxRetries: 2
    };
    this.url = new URL(url);
    this.headers = headers;
    this.authProvider = authProvider;
    this.redirectMode = redirect;
    this.sessionId = initialSessionId;
    this.protocolVersion = initialProtocolVersion;
    this.onSessionIdChange = onSessionIdChange;
    this.onSessionExpired = onSessionExpired;
    this.terminateSessionOnClose = terminateSessionOnClose;
    this.fetchFn = fetchFn != null ? fetchFn : globalThis.fetch;
  }
  setProtocolVersion(version) {
    this.protocolVersion = version;
  }
  async commonHeaders({
    base,
    includeSessionId = true
  }) {
    var _a3;
    const headers = {
      ...this.headers,
      ...base,
      "mcp-protocol-version": (_a3 = this.protocolVersion) != null ? _a3 : LATEST_PROTOCOL_VERSION
    };
    if (includeSessionId && this.sessionId) {
      headers["mcp-session-id"] = this.sessionId;
    }
    if (this.authProvider) {
      const tokens = await this.authProvider.tokens();
      if (tokens == null ? void 0 : tokens.access_token) {
        headers["Authorization"] = `Bearer ${tokens.access_token}`;
      }
    }
    return withUserAgentSuffix2(
      headers,
      `ai-sdk/${VERSION}`,
      getRuntimeEnvironmentUserAgent2()
    );
  }
  setSessionId(sessionId) {
    var _a3;
    if (this.sessionId === sessionId) {
      return;
    }
    this.sessionId = sessionId;
    (_a3 = this.onSessionIdChange) == null ? void 0 : _a3.call(this, sessionId);
  }
  applySessionIdFromResponse(response) {
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) {
      this.setSessionId(sessionId);
    }
  }
  expireSessionId(sessionId) {
    var _a3;
    if (this.sessionId === sessionId) {
      this.setSessionId(void 0);
    }
    (_a3 = this.onSessionExpired) == null ? void 0 : _a3.call(this, sessionId);
  }
  /**
   * Runs a single OAuth recovery flow for concurrent 401 responses.
   */
  authorizeOnce(resourceMetadataUrl) {
    if (!this.authProvider) {
      return Promise.resolve("REDIRECT");
    }
    if (!this.authPromise) {
      this.authPromise = auth(this.authProvider, {
        serverUrl: this.url,
        resourceMetadataUrl,
        fetchFn: this.fetchFn
      }).finally(() => {
        this.authPromise = void 0;
      });
    }
    return this.authPromise;
  }
  async start() {
    if (this.abortController) {
      throw new MCPClientError({
        message: "MCP HTTP Transport Error: Transport already started. Note: client.connect() calls start() automatically."
      });
    }
    this.abortController = new AbortController();
    this.startInboundSse();
  }
  async close() {
    var _a3, _b3, _c;
    (_a3 = this.inboundSseConnection) == null ? void 0 : _a3.close();
    try {
      if (this.sessionId && this.terminateSessionOnClose && this.abortController && !this.abortController.signal.aborted) {
        const headers = await this.commonHeaders({ base: {} });
        await this.fetchFn(this.url.href, {
          method: "DELETE",
          headers,
          signal: this.abortController.signal,
          redirect: this.redirectMode
        }).catch(() => void 0);
      }
    } catch (e) {
    }
    (_b3 = this.abortController) == null ? void 0 : _b3.abort();
    (_c = this.onclose) == null ? void 0 : _c.call(this);
  }
  async send(message) {
    const attempt = async (triedAuth = false) => {
      var _a3, _b3, _c, _d, _e, _f, _g;
      try {
        const isInitializeRequest = "method" in message && message.method === "initialize";
        const sessionIdForRequest = isInitializeRequest ? void 0 : this.sessionId;
        const headers = await this.commonHeaders({
          base: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream"
          },
          includeSessionId: !isInitializeRequest
        });
        const init = {
          method: "POST",
          headers,
          body: JSON.stringify(message),
          signal: (_a3 = this.abortController) == null ? void 0 : _a3.signal,
          redirect: this.redirectMode
        };
        const response = await this.fetchFn(this.url.href, init);
        this.applySessionIdFromResponse(response);
        if (response.status === 401 && this.authProvider && !triedAuth) {
          this.resourceMetadataUrl = extractResourceMetadataUrl(response);
          try {
            const result = await this.authorizeOnce(this.resourceMetadataUrl);
            if (result !== "AUTHORIZED") {
              const error2 = new UnauthorizedError();
              throw error2;
            }
          } catch (error2) {
            (_b3 = this.onerror) == null ? void 0 : _b3.call(this, error2);
            throw error2;
          }
          return attempt(true);
        }
        if (response.status === 202) {
          if (!this.inboundSseConnection) {
            this.startInboundSse();
          }
          return;
        }
        if (!response.ok) {
          const text = await response.text().catch(() => null);
          let errorMessage = `MCP HTTP Transport Error: POSTing to endpoint (HTTP ${response.status}): ${text}`;
          if (response.status === 404) {
            if (sessionIdForRequest) {
              this.expireSessionId(sessionIdForRequest);
              errorMessage += ". The MCP session expired. Create a new client without `initialSessionId` to start a fresh session";
            } else {
              errorMessage += ". This server does not support HTTP transport. Try using `sse` transport instead";
            }
          }
          const error2 = new MCPClientError({
            message: errorMessage,
            statusCode: response.status,
            url: this.url.href,
            responseBody: text != null ? text : void 0
          });
          (_c = this.onerror) == null ? void 0 : _c.call(this, error2);
          throw error2;
        }
        const isNotification = !("id" in message);
        if (isNotification) {
          return;
        }
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = await response.json();
          const messages = Array.isArray(data) ? data.map((message2) => validateJSONRPCMessage(message2)) : [validateJSONRPCMessage(data)];
          for (const jsonRpcMessage of messages) {
            (_d = this.onmessage) == null ? void 0 : _d.call(this, jsonRpcMessage);
          }
          return;
        }
        if (contentType.includes("text/event-stream")) {
          if (!response.body) {
            const error2 = new MCPClientError({
              message: "MCP HTTP Transport Error: text/event-stream response without body",
              statusCode: response.status,
              url: this.url.href
            });
            (_e = this.onerror) == null ? void 0 : _e.call(this, error2);
            throw error2;
          }
          const stream = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream2());
          const reader = stream.getReader();
          const processEvents = async () => {
            var _a4, _b4, _c2;
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) return;
                const { event, data } = value;
                if (isMessageEvent2(event)) {
                  try {
                    const jsonRpcMessage = await parseJSONRPCMessage(data);
                    (_a4 = this.onmessage) == null ? void 0 : _a4.call(this, jsonRpcMessage);
                  } catch (error2) {
                    const e = new MCPClientError({
                      message: "MCP HTTP Transport Error: Failed to parse message",
                      cause: error2
                    });
                    (_b4 = this.onerror) == null ? void 0 : _b4.call(this, e);
                  }
                }
              }
            } catch (error2) {
              if (error2 instanceof Error && error2.name === "AbortError") {
                return;
              }
              (_c2 = this.onerror) == null ? void 0 : _c2.call(this, error2);
            }
          };
          void processEvents().catch((error2) => {
            var _a4;
            if (error2 instanceof Error && error2.name === "AbortError") {
              return;
            }
            (_a4 = this.onerror) == null ? void 0 : _a4.call(this, error2);
          });
          return;
        }
        const error = new MCPClientError({
          message: `MCP HTTP Transport Error: Unexpected content type: ${contentType}`,
          statusCode: response.status,
          url: this.url.href
        });
        (_f = this.onerror) == null ? void 0 : _f.call(this, error);
        throw error;
      } catch (error) {
        (_g = this.onerror) == null ? void 0 : _g.call(this, error);
        throw error;
      }
    };
    await attempt();
  }
  getNextReconnectionDelay(attempt) {
    const {
      initialReconnectionDelay,
      reconnectionDelayGrowFactor,
      maxReconnectionDelay
    } = this.reconnectionOptions;
    return Math.min(
      initialReconnectionDelay * Math.pow(reconnectionDelayGrowFactor, attempt),
      maxReconnectionDelay
    );
  }
  scheduleInboundSseReconnection() {
    var _a3;
    const { maxRetries } = this.reconnectionOptions;
    if (maxRetries > 0 && this.inboundReconnectAttempts >= maxRetries) {
      (_a3 = this.onerror) == null ? void 0 : _a3.call(
        this,
        new MCPClientError({
          message: `MCP HTTP Transport Error: Maximum reconnection attempts (${maxRetries}) exceeded.`
        })
      );
      return;
    }
    const delay = this.getNextReconnectionDelay(this.inboundReconnectAttempts);
    this.inboundReconnectAttempts += 1;
    setTimeout(() => {
      var _a4;
      if ((_a4 = this.abortController) == null ? void 0 : _a4.signal.aborted) return;
      this.startInboundSse(false, this.lastInboundEventId);
    }, delay);
  }
  startInboundSse(triedAuth = false, resumeToken) {
    void this.openInboundSse(triedAuth, resumeToken).catch((error) => {
      var _a3;
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      (_a3 = this.onerror) == null ? void 0 : _a3.call(this, error);
    });
  }
  // Open optional inbound SSE stream; best-effort and resumable
  async openInboundSse(triedAuth = false, resumeToken) {
    var _a3, _b3, _c, _d, _e, _f;
    try {
      const sessionIdForRequest = this.sessionId;
      const headers = await this.commonHeaders({
        base: {
          Accept: "text/event-stream"
        }
      });
      if (resumeToken) {
        headers["last-event-id"] = resumeToken;
      }
      const response = await this.fetchFn(this.url.href, {
        method: "GET",
        headers,
        signal: (_a3 = this.abortController) == null ? void 0 : _a3.signal,
        redirect: this.redirectMode
      });
      this.applySessionIdFromResponse(response);
      if (response.status === 401 && this.authProvider && !triedAuth) {
        this.resourceMetadataUrl = extractResourceMetadataUrl(response);
        try {
          const result = await this.authorizeOnce(this.resourceMetadataUrl);
          if (result !== "AUTHORIZED") {
            const error = new UnauthorizedError();
            (_b3 = this.onerror) == null ? void 0 : _b3.call(this, error);
            return;
          }
        } catch (error) {
          (_c = this.onerror) == null ? void 0 : _c.call(this, error);
          return;
        }
        return this.openInboundSse(true, resumeToken);
      }
      if (response.status === 405) {
        return;
      }
      if (!response.ok || !response.body) {
        if (response.status === 404 && sessionIdForRequest) {
          this.expireSessionId(sessionIdForRequest);
        }
        const error = new MCPClientError({
          message: `MCP HTTP Transport Error: GET SSE failed: ${response.status} ${response.statusText}`,
          statusCode: response.status,
          url: this.url.href
        });
        (_d = this.onerror) == null ? void 0 : _d.call(this, error);
        return;
      }
      const stream = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream2());
      const reader = stream.getReader();
      const processEvents = async () => {
        var _a4, _b4, _c2, _d2;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            const { event, data, id } = value;
            if (id) {
              this.lastInboundEventId = id;
            }
            if (isMessageEvent2(event)) {
              try {
                const jsonRpcMessage = await parseJSONRPCMessage(data);
                (_a4 = this.onmessage) == null ? void 0 : _a4.call(this, jsonRpcMessage);
              } catch (error) {
                const e = new MCPClientError({
                  message: "MCP HTTP Transport Error: Failed to parse message",
                  cause: error
                });
                (_b4 = this.onerror) == null ? void 0 : _b4.call(this, e);
              }
            }
          }
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }
          (_c2 = this.onerror) == null ? void 0 : _c2.call(this, error);
          if (!((_d2 = this.abortController) == null ? void 0 : _d2.signal.aborted)) {
            this.scheduleInboundSseReconnection();
          }
        }
      };
      this.inboundSseConnection = {
        close: () => {
          void reader.cancel().catch((error) => {
            var _a4;
            if (error instanceof Error && error.name === "AbortError") {
              return;
            }
            (_a4 = this.onerror) == null ? void 0 : _a4.call(this, error);
          });
        }
      };
      this.inboundReconnectAttempts = 0;
      void processEvents().catch((error) => {
        var _a4, _b4;
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        (_a4 = this.onerror) == null ? void 0 : _a4.call(this, error);
        if (!((_b4 = this.abortController) == null ? void 0 : _b4.signal.aborted)) {
          this.scheduleInboundSseReconnection();
        }
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      (_e = this.onerror) == null ? void 0 : _e.call(this, error);
      if (!((_f = this.abortController) == null ? void 0 : _f.signal.aborted)) {
        this.scheduleInboundSseReconnection();
      }
    }
  }
};

// src/tool/mcp-transport.ts
function createMcpTransport(config) {
  switch (config.type) {
    case "sse":
      return new SseMCPTransport(config);
    case "http":
      return new HttpMCPTransport(config);
    default:
      throw new MCPClientError({
        message: "Unsupported or invalid transport configuration. If you are using a custom transport, make sure it implements the MCPTransport interface."
      });
  }
}
function isCustomMcpTransport(transport) {
  return "start" in transport && typeof transport.start === "function" && "send" in transport && typeof transport.send === "function" && "close" in transport && typeof transport.close === "function";
}

// src/tool/mcp-apps.ts
import { isJSONObject } from "@ai-sdk/provider";
import { convertBase64ToUint8Array } from "@ai-sdk/provider-utils";
import * as z4 from "zod/v4";
var MCP_APP_EXTENSION_NAME = "io.modelcontextprotocol/ui";
var MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
var MCP_APP_LEGACY_RESOURCE_URI_META_KEY = "ui/resourceUri";
var mcpAppClientCapabilities = {
  extensions: {
    [MCP_APP_EXTENSION_NAME]: {
      mimeTypes: [MCP_APP_MIME_TYPE]
    }
  }
};
function getToolUiMeta(meta) {
  const uiMeta = meta == null ? void 0 : meta.ui;
  return isJSONObject(uiMeta) ? uiMeta : void 0;
}
var optionalStringArray = z4.array(z4.unknown()).transform((items) => items.filter((v) => typeof v === "string")).optional().catch(void 0);
var MCPAppResourceCSPSchema = z4.looseObject({
  connectDomains: optionalStringArray,
  resourceDomains: optionalStringArray,
  frameDomains: optionalStringArray
});
var MCPAppResourceMetaSchema = z4.looseObject({
  prefersBorder: z4.boolean().optional().catch(void 0),
  csp: MCPAppResourceCSPSchema.optional().catch(void 0),
  permissions: z4.record(z4.string(), z4.unknown()).optional().catch(void 0)
});
function getResourceUiMeta(meta) {
  const resourceMeta = isJSONObject(meta) ? meta : void 0;
  const rawUiMeta = resourceMeta == null ? void 0 : resourceMeta.ui;
  if (!isJSONObject(rawUiMeta)) {
    return void 0;
  }
  const parsed = MCPAppResourceMetaSchema.safeParse(rawUiMeta);
  return parsed.success ? parsed.data : void 0;
}
function parseVisibility(value) {
  return Array.isArray(value) ? value.filter(
    (v) => v === "model" || v === "app"
  ) : void 0;
}
function getMCPAppToolMeta(tool2) {
  var _a3, _b3;
  const uiMeta = getToolUiMeta(tool2._meta);
  const resourceUri = (_b3 = uiMeta == null ? void 0 : uiMeta.resourceUri) != null ? _b3 : (_a3 = tool2._meta) == null ? void 0 : _a3[MCP_APP_LEGACY_RESOURCE_URI_META_KEY];
  const visibility = parseVisibility(uiMeta == null ? void 0 : uiMeta.visibility);
  if (resourceUri !== void 0) {
    if (typeof resourceUri !== "string" || !resourceUri.startsWith("ui://")) {
      throw new Error(
        `Invalid MCP App resource URI: ${JSON.stringify(resourceUri)}`
      );
    }
  } else if (uiMeta == null) {
    return void 0;
  }
  return {
    ...uiMeta,
    ...resourceUri != null ? { resourceUri } : {},
    ...visibility != null ? { visibility } : {}
  };
}
function splitMCPAppTools(definitions) {
  var _a3;
  const modelVisibleTools = [];
  const appVisibleTools = [];
  for (const tool2 of definitions.tools) {
    const visibility = (_a3 = getMCPAppToolMeta(tool2)) == null ? void 0 : _a3.visibility;
    if (visibility == null || visibility.includes("model")) {
      modelVisibleTools.push(tool2);
    }
    if ((visibility == null ? void 0 : visibility.includes("app")) === true) {
      appVisibleTools.push(tool2);
    }
  }
  return {
    modelVisible: {
      ...definitions,
      tools: modelVisibleTools
    },
    appVisible: {
      ...definitions,
      tools: appVisibleTools
    }
  };
}
function getMCPAppResourceFromReadResult({
  uri,
  resource
}) {
  const content = resource.contents.find((content2) => content2.uri === uri);
  if (content == null) {
    throw new Error(`MCP App resource not found in read result: ${uri}`);
  }
  if (content.mimeType !== MCP_APP_MIME_TYPE) {
    throw new Error(
      `Unsupported MCP App resource MIME type: ${content.mimeType}`
    );
  }
  const html = "text" in content && typeof content.text === "string" ? content.text : "blob" in content && typeof content.blob === "string" ? new TextDecoder().decode(convertBase64ToUint8Array(content.blob)) : void 0;
  if (html == null) {
    throw new Error(`Unsupported MCP App resource content format: ${uri}`);
  }
  const meta = getResourceUiMeta(content._meta);
  return { uri, mimeType: MCP_APP_MIME_TYPE, html, meta };
}
async function readMCPAppResource({
  client,
  uri,
  options
}) {
  if (!uri.startsWith("ui://")) {
    throw new Error(`Unsupported MCP App resource URI: ${uri}`);
  }
  return getMCPAppResourceFromReadResult({
    uri,
    resource: await client.readResource({ uri, options })
  });
}

// src/tool/mcp-client.ts
var CLIENT_VERSION = "1.0.0";
var DEFAULT_MAX_TOOL_CALL_RETRIES = 0;
var DEFAULT_RETRY_ERROR_CODES = [
  "ConnectionRefused",
  "ConnectionClosed",
  "FailedToOpenSocket",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE"
];
function getErrorStatusCode(error) {
  if (error != null && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  return void 0;
}
function getStringErrorCode(error) {
  if (error != null && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return void 0;
}
function isRetryableMCPToolCallError(error) {
  const statusCode = getErrorStatusCode(error);
  if (statusCode != null) {
    return statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500;
  }
  if (MCPClientError.isInstance(error) && error.code != null) {
    return false;
  }
  const errorCode = getStringErrorCode(error);
  return errorCode != null && DEFAULT_RETRY_ERROR_CODES.includes(errorCode);
}
function prepareMaxRetries(maxRetries) {
  if (maxRetries == null) {
    return DEFAULT_MAX_TOOL_CALL_RETRIES;
  }
  if (!Number.isInteger(maxRetries)) {
    throw new MCPClientError({
      message: "maxRetries must be an integer"
    });
  }
  if (maxRetries < 0) {
    throw new MCPClientError({
      message: "maxRetries must be >= 0"
    });
  }
  return maxRetries;
}
function mcpToModelOutput({
  output
}) {
  const result = output;
  if (!("content" in result) || !Array.isArray(result.content)) {
    return { type: "json", value: result };
  }
  const convertedContent = result.content.map(
    (part) => {
      if (part.type === "text" && "text" in part) {
        return { type: "text", text: part.text };
      }
      if (part.type === "image" && "data" in part && "mimeType" in part) {
        return {
          type: "file",
          mediaType: part.mimeType,
          data: { type: "data", data: part.data }
        };
      }
      return { type: "text", text: JSON.stringify(part) };
    }
  );
  return { type: "content", value: convertedContent };
}
async function createMCPClient(config) {
  const client = new DefaultMCPClient(config);
  await client.init();
  return client;
}
var DefaultMCPClient = class {
  constructor({
    transport: transportConfig,
    name: name3,
    clientName = name3 != null ? name3 : "ai-sdk-mcp-client",
    version = CLIENT_VERSION,
    onUncaughtError,
    maxRetries,
    capabilities,
    initialInitializeResult
  }) {
    this.requestMessageId = 0;
    this.responseHandlers = /* @__PURE__ */ new Map();
    this.serverCapabilities = {};
    this._serverInfo = { name: "", version: "" };
    this._initializeResult = {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      serverInfo: this._serverInfo
    };
    this.isClosed = true;
    this.onUncaughtError = onUncaughtError;
    this.maxRetries = prepareMaxRetries(maxRetries);
    this.clientCapabilities = capabilities != null ? capabilities : {};
    this.initialInitializeResult = initialInitializeResult;
    if (isCustomMcpTransport(transportConfig)) {
      this.transport = transportConfig;
    } else {
      this.transport = createMcpTransport(transportConfig);
    }
    this.transport.onclose = () => this.onClose();
    this.transport.onerror = (error) => this.onError(error);
    this.transport.onmessage = (message) => {
      if ("method" in message) {
        if ("id" in message) {
          this.onRequestMessage(message);
        } else {
          this.onError(
            new MCPClientError({
              message: "Unsupported message type"
            })
          );
        }
        return;
      }
      this.onResponse(message);
    };
    this.clientInfo = {
      name: clientName,
      version
    };
  }
  get serverInfo() {
    return this._serverInfo;
  }
  get initializeResult() {
    return this._initializeResult;
  }
  get instructions() {
    return this._serverInstructions;
  }
  async init() {
    try {
      await this.transport.start();
      this.isClosed = false;
      if (this.initialInitializeResult) {
        const result2 = InitializeResultSchema.parse(
          this.initialInitializeResult
        );
        this.applyInitializeResult(result2);
        return this;
      }
      const result = await this.request({
        request: {
          method: "initialize",
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: this.clientCapabilities,
            clientInfo: this.clientInfo
          }
        },
        resultSchema: InitializeResultSchema
      });
      if (result === void 0) {
        throw new MCPClientError({
          message: "Server sent invalid initialize result"
        });
      }
      this.applyInitializeResult(result);
      await this.notification({
        method: "notifications/initialized"
      });
      return this;
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  applyInitializeResult(result) {
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(result.protocolVersion)) {
      throw new MCPClientError({
        message: `Server's protocol version is not supported: ${result.protocolVersion}`
      });
    }
    this.serverCapabilities = result.capabilities;
    this._serverInfo = result.serverInfo;
    this._initializeResult = result;
    if (this.transport.setProtocolVersion) {
      this.transport.setProtocolVersion(result.protocolVersion);
    } else {
      this.transport.protocolVersion = result.protocolVersion;
    }
    this._serverInstructions = result.instructions;
  }
  async close() {
    var _a3;
    if (this.isClosed) return;
    await ((_a3 = this.transport) == null ? void 0 : _a3.close());
    this.onClose();
  }
  assertCapability(method) {
    switch (method) {
      case "initialize":
        break;
      case "completion/complete":
        if (!this.serverCapabilities.completions) {
          throw new MCPClientError({
            message: `Server does not support completions`
          });
        }
        break;
      case "tools/list":
      case "tools/call":
        if (!this.serverCapabilities.tools) {
          throw new MCPClientError({
            message: `Server does not support tools`
          });
        }
        break;
      case "resources/list":
      case "resources/read":
      case "resources/templates/list":
        if (!this.serverCapabilities.resources) {
          throw new MCPClientError({
            message: `Server does not support resources`
          });
        }
        break;
      case "prompts/list":
      case "prompts/get":
        if (!this.serverCapabilities.prompts) {
          throw new MCPClientError({
            message: `Server does not support prompts`
          });
        }
        break;
      default:
        throw new MCPClientError({
          message: `Unsupported method: ${method}`
        });
    }
  }
  async request({
    request,
    resultSchema,
    options
  }) {
    return new Promise((resolve, reject) => {
      if (this.isClosed) {
        return reject(
          new MCPClientError({
            message: "Attempted to send a request from a closed client"
          })
        );
      }
      this.assertCapability(request.method);
      const signal = options == null ? void 0 : options.signal;
      signal == null ? void 0 : signal.throwIfAborted();
      const messageId = this.requestMessageId++;
      const jsonrpcRequest = {
        ...request,
        jsonrpc: "2.0",
        id: messageId
      };
      const rejectWithAbortError = () => {
        reject(
          new MCPClientError({
            message: "Request was aborted",
            cause: signal == null ? void 0 : signal.reason
          })
        );
      };
      const cleanup = () => {
        this.responseHandlers.delete(messageId);
        signal == null ? void 0 : signal.removeEventListener("abort", onAbort);
      };
      const rejectAndCleanup = (error) => {
        cleanup();
        reject(error);
      };
      const onAbort = () => {
        cleanup();
        rejectWithAbortError();
      };
      this.responseHandlers.set(messageId, (response) => {
        if (signal == null ? void 0 : signal.aborted) {
          cleanup();
          return rejectWithAbortError();
        }
        if (response instanceof Error) {
          return rejectAndCleanup(response);
        }
        try {
          const result = resultSchema.parse(response.result);
          cleanup();
          resolve(result);
        } catch (error) {
          const parseError = new MCPClientError({
            message: "Failed to parse server response",
            cause: error
          });
          rejectAndCleanup(parseError);
        }
      });
      signal == null ? void 0 : signal.addEventListener("abort", onAbort, { once: true });
      this.transport.send(jsonrpcRequest).catch((error) => {
        rejectAndCleanup(error);
      });
    });
  }
  async listTools({
    params,
    options
  } = {}) {
    return this.request({
      request: { method: "tools/list", params },
      resultSchema: ListToolsResultSchema,
      options
    });
  }
  async callToolWithRetry({
    options,
    execute
  }) {
    if (this.maxRetries === 0) {
      return execute();
    }
    return retryWithExponentialBackoff({
      maxRetries: this.maxRetries,
      abortSignal: options == null ? void 0 : options.signal,
      shouldRetry: isRetryableMCPToolCallError,
      createRetryError: ({ message, errors }) => new MCPClientError({
        message,
        cause: errors[errors.length - 1]
      })
    })(execute);
  }
  async callTool({
    name: name3,
    arguments: args = {},
    options
  }) {
    try {
      return this.callToolWithRetry({
        options,
        execute: () => this.request({
          request: {
            method: "tools/call",
            params: { name: name3, arguments: args }
          },
          resultSchema: CallToolResultSchema,
          options
        })
      });
    } catch (error) {
      throw error;
    }
  }
  async listResourcesInternal({
    params,
    options
  } = {}) {
    try {
      return this.request({
        request: { method: "resources/list", params },
        resultSchema: ListResourcesResultSchema,
        options
      });
    } catch (error) {
      throw error;
    }
  }
  async readResourceInternal({
    uri,
    options
  }) {
    try {
      return this.request({
        request: { method: "resources/read", params: { uri } },
        resultSchema: ReadResourceResultSchema,
        options
      });
    } catch (error) {
      throw error;
    }
  }
  async listResourceTemplatesInternal({
    options
  } = {}) {
    try {
      return this.request({
        request: { method: "resources/templates/list" },
        resultSchema: ListResourceTemplatesResultSchema,
        options
      });
    } catch (error) {
      throw error;
    }
  }
  async listPromptsInternal({
    params,
    options
  } = {}) {
    try {
      return this.request({
        request: { method: "prompts/list", params },
        resultSchema: ListPromptsResultSchema,
        options
      });
    } catch (error) {
      throw error;
    }
  }
  async getPromptInternal({
    name: name3,
    args,
    options
  }) {
    try {
      return this.request({
        request: { method: "prompts/get", params: { name: name3, arguments: args } },
        resultSchema: GetPromptResultSchema,
        options
      });
    } catch (error) {
      throw error;
    }
  }
  async completeInternal({
    options,
    ...params
  }) {
    return this.request({
      request: { method: "completion/complete", params },
      resultSchema: CompleteResultSchema,
      options
    });
  }
  async notification(notification) {
    const jsonrpcNotification = {
      ...notification,
      jsonrpc: "2.0"
    };
    await this.transport.send(jsonrpcNotification);
  }
  /**
   * Returns a set of AI SDK tools from the MCP server.
   * This fetches tool definitions and wraps them with execute functions.
   * @returns A record of tool names to their implementations
   */
  async tools({
    schemas = "automatic"
  } = {}) {
    const definitions = await this.listTools();
    return this.toolsFromDefinitions(definitions, {
      schemas
    });
  }
  /**
   * Creates AI SDK tools from tool definitions without fetching from the server.
   */
  toolsFromDefinitions(definitions, { schemas = "automatic" } = {}) {
    var _a3, _b3;
    const tools = {};
    for (const {
      name: name3,
      title,
      description,
      inputSchema,
      annotations,
      _meta
    } of definitions.tools) {
      const resolvedTitle = title != null ? title : annotations == null ? void 0 : annotations.title;
      if (schemas !== "automatic" && !Object.prototype.hasOwnProperty.call(schemas, name3)) {
        continue;
      }
      const self = this;
      const outputSchema = schemas !== "automatic" ? (_a3 = schemas[name3]) == null ? void 0 : _a3.outputSchema : void 0;
      const appMeta = getMCPAppToolMeta({ _meta });
      const metadata = {
        clientName: this.clientInfo.name,
        toolName: name3,
        ...resolvedTitle != null ? { title: resolvedTitle } : {},
        ...(appMeta == null ? void 0 : appMeta.resourceUri) != null ? {
          app: {
            ...appMeta,
            mimeType: MCP_APP_MIME_TYPE
          }
        } : {}
      };
      const execute = async (args, options) => {
        var _a4;
        (_a4 = options == null ? void 0 : options.abortSignal) == null ? void 0 : _a4.throwIfAborted();
        const result = await self.callTool({
          name: name3,
          arguments: args,
          options: { signal: options == null ? void 0 : options.abortSignal }
        });
        if (result.isError) {
          return result;
        }
        if (outputSchema != null) {
          return self.extractStructuredContent(result, outputSchema, name3);
        }
        return result;
      };
      const toolWithExecute = schemas === "automatic" ? dynamicTool({
        description,
        title: resolvedTitle,
        metadata,
        inputSchema: jsonSchema({
          ...inputSchema,
          properties: (_b3 = inputSchema.properties) != null ? _b3 : {},
          additionalProperties: false
        }),
        execute,
        toModelOutput: mcpToModelOutput
      }) : tool({
        description,
        title: resolvedTitle,
        metadata,
        inputSchema: schemas[name3].inputSchema,
        ...outputSchema != null ? { outputSchema } : {},
        execute,
        toModelOutput: mcpToModelOutput
      });
      tools[name3] = { ...toolWithExecute, _meta };
    }
    return tools;
  }
  /**
   * Extracts and validates structuredContent from a tool result.
   */
  async extractStructuredContent(result, outputSchema, toolName) {
    if ("structuredContent" in result && result.structuredContent != null) {
      const validationResult = await safeValidateTypes({
        value: result.structuredContent,
        schema: asSchema(outputSchema)
      });
      if (!validationResult.success) {
        throw new MCPClientError({
          message: `Tool "${toolName}" returned structuredContent that does not match the expected outputSchema`,
          cause: validationResult.error
        });
      }
      return validationResult.value;
    }
    if ("content" in result && Array.isArray(result.content)) {
      const textContent = result.content.find((c) => c.type === "text");
      if (textContent && "text" in textContent) {
        const parseResult = await safeParseJSON({
          text: textContent.text,
          schema: outputSchema
        });
        if (!parseResult.success) {
          throw new MCPClientError({
            message: `Tool "${toolName}" returned content that does not match the expected outputSchema`,
            cause: parseResult.error
          });
        }
        return parseResult.value;
      }
    }
    throw new MCPClientError({
      message: `Tool "${toolName}" did not return structuredContent or parseable text content`
    });
  }
  listResources({
    params,
    options
  } = {}) {
    return this.listResourcesInternal({ params, options });
  }
  readResource({
    uri,
    options
  }) {
    return this.readResourceInternal({ uri, options });
  }
  listResourceTemplates({
    options
  } = {}) {
    return this.listResourceTemplatesInternal({ options });
  }
  experimental_listPrompts({
    params,
    options
  } = {}) {
    return this.listPromptsInternal({ params, options });
  }
  experimental_getPrompt({
    name: name3,
    arguments: args,
    options
  }) {
    return this.getPromptInternal({ name: name3, args, options });
  }
  complete(args) {
    return this.completeInternal(args);
  }
  onElicitationRequest(schema, handler) {
    if (schema !== ElicitationRequestSchema) {
      throw new MCPClientError({
        message: "Unsupported request schema. Only ElicitationRequestSchema is supported."
      });
    }
    this.elicitationRequestHandler = handler;
  }
  async onRequestMessage(request) {
    try {
      if (request.method === "ping") {
        await this.transport.send({
          jsonrpc: "2.0",
          id: request.id,
          result: {}
        });
        return;
      }
      if (request.method !== "elicitation/create") {
        await this.transport.send({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32601,
            message: `Unsupported request method: ${request.method}`
          }
        });
        return;
      }
      if (!this.elicitationRequestHandler) {
        await this.transport.send({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32601,
            message: "No elicitation handler registered on client"
          }
        });
        return;
      }
      const parsedRequest = ElicitationRequestSchema.safeParse({
        method: request.method,
        params: request.params
      });
      if (!parsedRequest.success) {
        await this.transport.send({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32602,
            message: `Invalid elicitation request: ${parsedRequest.error.message}`,
            data: parsedRequest.error.issues
          }
        });
        return;
      }
      try {
        const result = await this.elicitationRequestHandler(parsedRequest.data);
        const validatedResult = ElicitResultSchema.parse(result);
        await this.transport.send({
          jsonrpc: "2.0",
          id: request.id,
          result: validatedResult
        });
      } catch (error) {
        await this.transport.send({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Failed to handle elicitation request"
          }
        });
        this.onError(error);
      }
    } catch (error) {
      this.onError(error);
    }
  }
  onClose() {
    if (this.isClosed) return;
    this.isClosed = true;
    const error = new MCPClientError({
      message: "Connection closed"
    });
    for (const handler of this.responseHandlers.values()) {
      handler(error);
    }
    this.responseHandlers.clear();
  }
  onError(error) {
    if (this.onUncaughtError) {
      this.onUncaughtError(error);
    }
  }
  onResponse(response) {
    const messageId = Number(response.id);
    const handler = this.responseHandlers.get(messageId);
    if (handler === void 0) {
      throw new MCPClientError({
        message: `Protocol error: Received a response for an unknown message ID: ${JSON.stringify(
          response
        )}`
      });
    }
    this.responseHandlers.delete(messageId);
    handler(
      "result" in response ? response : new MCPClientError({
        message: response.error.message,
        code: response.error.code,
        data: response.error.data,
        cause: response.error
      })
    );
  }
};

// src/tool/mcp-app-fingerprint.ts
import { convertUint8ArrayToBase64 } from "@ai-sdk/provider-utils";
var encoder = new TextEncoder();
function canonicalJSON(value) {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value != null ? value : null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSON).join(",")}]`;
  }
  const record2 = value;
  const entries = Object.keys(record2).sort().map((k) => `${JSON.stringify(k)}:${canonicalJSON(record2[k])}`);
  return `{${entries.join(",")}}`;
}
function toBase64url(bytes) {
  return convertUint8ArrayToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function fingerprintMCPAppResource(resource) {
  var _a3, _b3, _c, _d;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(
      canonicalJSON({
        html: resource.html,
        csp: (_b3 = (_a3 = resource.meta) == null ? void 0 : _a3.csp) != null ? _b3 : null,
        permissions: (_d = (_c = resource.meta) == null ? void 0 : _c.permissions) != null ? _d : null
      })
    )
  );
  return toBase64url(new Uint8Array(digest));
}
function detectMCPAppResourceDrift(current, baseline) {
  return current !== baseline;
}
export {
  ElicitResultSchema,
  ElicitationRequestSchema,
  MCP_APP_MIME_TYPE,
  UnauthorizedError,
  auth,
  createMCPClient,
  detectMCPAppResourceDrift,
  createMCPClient as experimental_createMCPClient,
  fingerprintMCPAppResource,
  mcpAppClientCapabilities,
  readMCPAppResource,
  splitMCPAppTools,
  validateJSONRPCMessage
};
//# sourceMappingURL=index.js.map