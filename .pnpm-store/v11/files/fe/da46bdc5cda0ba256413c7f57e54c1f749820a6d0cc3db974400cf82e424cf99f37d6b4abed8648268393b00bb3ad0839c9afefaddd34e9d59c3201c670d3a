// src/gateway-realtime-auth.ts
var GATEWAY_REALTIME_SUBPROTOCOL = "ai-gateway-realtime.v1";
var GATEWAY_TRANSCRIPTION_SUBPROTOCOL = "ai-gateway-transcription.v1";
var GATEWAY_AUTH_SUBPROTOCOL_PREFIX = "ai-gateway-auth.";
var GATEWAY_TEAM_SUBPROTOCOL_PREFIX = "ai-gateway-team.";
function getGatewayRealtimeProtocols(token, options) {
  return buildGatewayProtocols(GATEWAY_REALTIME_SUBPROTOCOL, token, options);
}
function getGatewayTranscriptionProtocols(token, options) {
  return buildGatewayProtocols(
    GATEWAY_TRANSCRIPTION_SUBPROTOCOL,
    token,
    options
  );
}
function buildGatewayProtocols(marker11, token, options) {
  const protocols = [marker11, `${GATEWAY_AUTH_SUBPROTOCOL_PREFIX}${token}`];
  if (options == null ? void 0 : options.teamIdOrSlug) {
    protocols.push(
      `${GATEWAY_TEAM_SUBPROTOCOL_PREFIX}${encodeSubprotocolValue(options.teamIdOrSlug)}`
    );
  }
  return protocols;
}
function getGatewayRealtimeAuthToken(secWebSocketProtocol) {
  var _a11;
  return ((_a11 = findProtocol(secWebSocketProtocol, GATEWAY_AUTH_SUBPROTOCOL_PREFIX)) == null ? void 0 : _a11.slice(
    GATEWAY_AUTH_SUBPROTOCOL_PREFIX.length
  )) || void 0;
}
function getGatewayRealtimeTeamIdOrSlug(secWebSocketProtocol) {
  var _a11;
  const encoded = (_a11 = findProtocol(
    secWebSocketProtocol,
    GATEWAY_TEAM_SUBPROTOCOL_PREFIX
  )) == null ? void 0 : _a11.slice(GATEWAY_TEAM_SUBPROTOCOL_PREFIX.length);
  if (!encoded) return void 0;
  try {
    return decodeSubprotocolValue(encoded) || void 0;
  } catch (e) {
    return void 0;
  }
}
function findProtocol(secWebSocketProtocol, prefix) {
  return secWebSocketProtocol == null ? void 0 : secWebSocketProtocol.split(",").map((protocol) => protocol.trim()).find((protocol) => protocol.startsWith(prefix));
}
function encodeSubprotocolValue(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}
function decodeSubprotocolValue(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(`${base64}${padding}`);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// src/gateway-provider.ts
import {
  createJsonErrorResponseHandler as createJsonErrorResponseHandler11,
  createJsonResponseHandler as createJsonResponseHandler10,
  loadOptionalSetting,
  postJsonToApi as postJsonToApi8,
  withoutTrailingSlash,
  withUserAgentSuffix
} from "@ai-sdk/provider-utils";
import { z as z18 } from "zod/v4";

// src/errors/as-gateway-error.ts
import { APICallError } from "@ai-sdk/provider";

// src/errors/create-gateway-error.ts
import { z as z3 } from "zod/v4";

// src/errors/gateway-error.ts
var marker = "vercel.ai.gateway.error";
var symbol = Symbol.for(marker);
var _a, _b;
var GatewayError = class _GatewayError extends (_b = Error, _a = symbol, _b) {
  constructor({
    message,
    statusCode = 500,
    cause,
    generationId,
    isRetryable = statusCode != null && (statusCode === 408 || // request timeout
    statusCode === 409 || // conflict
    statusCode === 429 || // too many requests
    statusCode >= 500)
    // server error
  }) {
    super(generationId ? `${message} [${generationId}]` : message);
    this[_a] = true;
    this.statusCode = statusCode;
    this.cause = cause;
    this.generationId = generationId;
    this.isRetryable = isRetryable;
  }
  /**
   * Checks if the given error is a Gateway Error.
   * @param {unknown} error - The error to check.
   * @returns {boolean} True if the error is a Gateway Error, false otherwise.
   */
  static isInstance(error) {
    return _GatewayError.hasMarker(error);
  }
  static hasMarker(error) {
    return typeof error === "object" && error !== null && symbol in error && error[symbol] === true;
  }
};

// src/errors/gateway-authentication-error.ts
var name = "GatewayAuthenticationError";
var marker2 = `vercel.ai.gateway.error.${name}`;
var symbol2 = Symbol.for(marker2);
var _a2, _b2;
var GatewayAuthenticationError = class _GatewayAuthenticationError extends (_b2 = GatewayError, _a2 = symbol2, _b2) {
  constructor({
    message = "Authentication failed",
    statusCode = 401,
    cause,
    generationId
  } = {}) {
    super({ message, statusCode, cause, generationId });
    this[_a2] = true;
    // used in isInstance
    this.name = name;
    this.type = "authentication_error";
  }
  static isInstance(error) {
    return GatewayError.hasMarker(error) && symbol2 in error;
  }
  /**
   * Creates a contextual error message when authentication fails
   */
  static createContextualError({
    apiKeyProvided,
    oidcTokenProvided,
    statusCode = 401,
    cause,
    generationId
  }) {
    let contextualMessage;
    if (apiKeyProvided) {
      contextualMessage = `AI Gateway authentication failed: Invalid API key or token.

Create a new API key: https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys

Provide an API key or Vercel access token via 'apiKey' option or 'AI_GATEWAY_API_KEY' environment variable.`;
    } else if (oidcTokenProvided) {
      contextualMessage = `AI Gateway authentication failed: Invalid OIDC token.

Run 'npx vercel link' to link your project, then 'vc env pull' to fetch the token.

Alternatively, use an API key: https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys
or pass a Vercel access token via the 'apiKey' option.`;
    } else {
      contextualMessage = `AI Gateway authentication failed: No authentication provided.

Option 1 - API key:
Create an API key: https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys
Provide via 'apiKey' option or 'AI_GATEWAY_API_KEY' environment variable.

Option 2 - Vercel access token:
Pass a Vercel personal access token or Vercel app access token via the 'apiKey' option.

Option 3 - OIDC token:
Run 'npx vercel link' to link your project, then 'vc env pull' to fetch the token.`;
    }
    return new _GatewayAuthenticationError({
      message: contextualMessage,
      statusCode,
      cause,
      generationId
    });
  }
};

// src/errors/gateway-invalid-request-error.ts
var name2 = "GatewayInvalidRequestError";
var marker3 = `vercel.ai.gateway.error.${name2}`;
var symbol3 = Symbol.for(marker3);
var _a3, _b3;
var GatewayInvalidRequestError = class extends (_b3 = GatewayError, _a3 = symbol3, _b3) {
  constructor({
    message = "Invalid request",
    statusCode = 400,
    cause,
    generationId
  } = {}) {
    super({ message, statusCode, cause, generationId });
    this[_a3] = true;
    // used in isInstance
    this.name = name2;
    this.type = "invalid_request_error";
  }
  static isInstance(error) {
    return GatewayError.hasMarker(error) && symbol3 in error;
  }
};

// src/errors/gateway-rate-limit-error.ts
var name3 = "GatewayRateLimitError";
var marker4 = `vercel.ai.gateway.error.${name3}`;
var symbol4 = Symbol.for(marker4);
var _a4, _b4;
var GatewayRateLimitError = class extends (_b4 = GatewayError, _a4 = symbol4, _b4) {
  constructor({
    message = "Rate limit exceeded",
    statusCode = 429,
    cause,
    generationId
  } = {}) {
    super({ message, statusCode, cause, generationId });
    this[_a4] = true;
    // used in isInstance
    this.name = name3;
    this.type = "rate_limit_exceeded";
  }
  static isInstance(error) {
    return GatewayError.hasMarker(error) && symbol4 in error;
  }
};

// src/errors/gateway-model-not-found-error.ts
import { z } from "zod/v4";
import { lazySchema, zodSchema } from "@ai-sdk/provider-utils";
var name4 = "GatewayModelNotFoundError";
var marker5 = `vercel.ai.gateway.error.${name4}`;
var symbol5 = Symbol.for(marker5);
var modelNotFoundParamSchema = lazySchema(
  () => zodSchema(
    z.object({
      modelId: z.string()
    })
  )
);
var _a5, _b5;
var GatewayModelNotFoundError = class extends (_b5 = GatewayError, _a5 = symbol5, _b5) {
  constructor({
    message = "Model not found",
    statusCode = 404,
    modelId,
    cause,
    generationId
  } = {}) {
    super({ message, statusCode, cause, generationId });
    this[_a5] = true;
    // used in isInstance
    this.name = name4;
    this.type = "model_not_found";
    this.modelId = modelId;
  }
  static isInstance(error) {
    return GatewayError.hasMarker(error) && symbol5 in error;
  }
};

// src/errors/gateway-internal-server-error.ts
var name5 = "GatewayInternalServerError";
var marker6 = `vercel.ai.gateway.error.${name5}`;
var symbol6 = Symbol.for(marker6);
var _a6, _b6;
var GatewayInternalServerError = class extends (_b6 = GatewayError, _a6 = symbol6, _b6) {
  constructor({
    message = "Internal server error",
    statusCode = 500,
    cause,
    generationId
  } = {}) {
    super({ message, statusCode, cause, generationId });
    this[_a6] = true;
    // used in isInstance
    this.name = name5;
    this.type = "internal_server_error";
  }
  static isInstance(error) {
    return GatewayError.hasMarker(error) && symbol6 in error;
  }
};

// src/errors/gateway-failed-dependency-error.ts
var name6 = "GatewayFailedDependencyError";
var marker7 = `vercel.ai.gateway.error.${name6}`;
var symbol7 = Symbol.for(marker7);
var _a7, _b7;
var GatewayFailedDependencyError = class extends (_b7 = GatewayError, _a7 = symbol7, _b7) {
  constructor({
    message = "Failed dependency",
    statusCode = 424,
    cause,
    generationId
  } = {}) {
    super({ message, statusCode, cause, generationId });
    this[_a7] = true;
    // used in isInstance
    this.name = name6;
    this.type = "failed_dependency";
  }
  static isInstance(error) {
    return GatewayError.hasMarker(error) && symbol7 in error;
  }
};

// src/errors/gateway-forbidden-error.ts
import { z as z2 } from "zod/v4";
import { lazySchema as lazySchema2, zodSchema as zodSchema2 } from "@ai-sdk/provider-utils";
var name7 = "GatewayForbiddenError";
var marker8 = `vercel.ai.gateway.error.${name7}`;
var symbol8 = Symbol.for(marker8);
var forbiddenParamSchema = lazySchema2(
  () => zodSchema2(
    z2.object({
      ruleId: z2.string()
    })
  )
);
var _a8, _b8;
var GatewayForbiddenError = class extends (_b8 = GatewayError, _a8 = symbol8, _b8) {
  constructor({
    message = "Forbidden",
    statusCode = 403,
    cause,
    generationId,
    ruleId
  } = {}) {
    super({ message, statusCode, cause, generationId });
    this[_a8] = true;
    // used in isInstance
    this.name = name7;
    this.type = "forbidden";
    this.ruleId = ruleId;
  }
  static isInstance(error) {
    return GatewayError.hasMarker(error) && symbol8 in error;
  }
};

// src/errors/gateway-response-error.ts
var name8 = "GatewayResponseError";
var marker9 = `vercel.ai.gateway.error.${name8}`;
var symbol9 = Symbol.for(marker9);
var _a9, _b9;
var GatewayResponseError = class extends (_b9 = GatewayError, _a9 = symbol9, _b9) {
  constructor({
    message = "Invalid response from Gateway",
    statusCode = 502,
    response,
    validationError,
    cause,
    generationId
  } = {}) {
    super({ message, statusCode, cause, generationId });
    this[_a9] = true;
    // used in isInstance
    this.name = name8;
    this.type = "response_error";
    this.response = response;
    this.validationError = validationError;
  }
  static isInstance(error) {
    return GatewayError.hasMarker(error) && symbol9 in error;
  }
};

// src/errors/create-gateway-error.ts
import {
  lazySchema as lazySchema3,
  safeValidateTypes,
  zodSchema as zodSchema3
} from "@ai-sdk/provider-utils";
async function createGatewayErrorFromResponse({
  response,
  statusCode,
  defaultMessage = "Gateway request failed",
  cause,
  authMethod
}) {
  var _a11;
  const parseResult = await safeValidateTypes({
    value: response,
    schema: gatewayErrorResponseSchema
  });
  if (!parseResult.success) {
    const rawGenerationId = typeof response === "object" && response !== null && "generationId" in response ? response.generationId : void 0;
    return new GatewayResponseError({
      message: `Invalid error response format: ${defaultMessage}`,
      statusCode,
      response,
      validationError: parseResult.error,
      cause,
      generationId: rawGenerationId
    });
  }
  const validatedResponse = parseResult.value;
  const errorType = validatedResponse.error.type;
  const message = validatedResponse.error.message;
  const generationId = (_a11 = validatedResponse.generationId) != null ? _a11 : void 0;
  switch (errorType) {
    case "authentication_error":
      return GatewayAuthenticationError.createContextualError({
        apiKeyProvided: authMethod === "api-key",
        oidcTokenProvided: authMethod === "oidc",
        statusCode,
        cause,
        generationId
      });
    case "invalid_request_error":
      return new GatewayInvalidRequestError({
        message,
        statusCode,
        cause,
        generationId
      });
    case "rate_limit_exceeded":
      return new GatewayRateLimitError({
        message,
        statusCode,
        cause,
        generationId
      });
    case "model_not_found": {
      const modelResult = await safeValidateTypes({
        value: validatedResponse.error.param,
        schema: modelNotFoundParamSchema
      });
      return new GatewayModelNotFoundError({
        message,
        statusCode,
        modelId: modelResult.success ? modelResult.value.modelId : void 0,
        cause,
        generationId
      });
    }
    case "internal_server_error":
      return new GatewayInternalServerError({
        message,
        statusCode,
        cause,
        generationId
      });
    case "failed_dependency":
      return new GatewayFailedDependencyError({
        message,
        statusCode,
        cause,
        generationId
      });
    case "forbidden": {
      const ruleResult = await safeValidateTypes({
        value: validatedResponse.error.param,
        schema: forbiddenParamSchema
      });
      return new GatewayForbiddenError({
        message,
        statusCode,
        cause,
        generationId,
        ruleId: ruleResult.success ? ruleResult.value.ruleId : void 0
      });
    }
    default:
      return new GatewayInternalServerError({
        message,
        statusCode,
        cause,
        generationId
      });
  }
}
var gatewayErrorResponseSchema = lazySchema3(
  () => zodSchema3(
    z3.object({
      error: z3.object({
        message: z3.string(),
        type: z3.string().nullish(),
        param: z3.unknown().nullish(),
        code: z3.union([z3.string(), z3.number()]).nullish()
      }),
      generationId: z3.string().nullish()
    })
  )
);

// src/errors/extract-api-call-response.ts
import { secureJsonParse } from "@ai-sdk/provider-utils";
function extractApiCallResponse(error) {
  if (error.data !== void 0) {
    return error.data;
  }
  if (error.responseBody != null) {
    try {
      return secureJsonParse(error.responseBody);
    } catch (e) {
      return error.responseBody;
    }
  }
  return {};
}

// src/errors/gateway-timeout-error.ts
var name9 = "GatewayTimeoutError";
var marker10 = `vercel.ai.gateway.error.${name9}`;
var symbol10 = Symbol.for(marker10);
var _a10, _b10;
var GatewayTimeoutError = class _GatewayTimeoutError extends (_b10 = GatewayError, _a10 = symbol10, _b10) {
  constructor({
    message = "Request timed out",
    statusCode = 408,
    cause,
    generationId
  } = {}) {
    super({ message, statusCode, cause, generationId });
    this[_a10] = true;
    // used in isInstance
    this.name = name9;
    this.type = "timeout_error";
  }
  static isInstance(error) {
    return GatewayError.hasMarker(error) && symbol10 in error;
  }
  /**
   * Creates a helpful timeout error message with troubleshooting guidance
   */
  static createTimeoutError({
    originalMessage,
    statusCode = 408,
    cause,
    generationId
  }) {
    const message = `Gateway request timed out: ${originalMessage}

    This is a client-side timeout. To resolve this, increase your timeout configuration: https://vercel.com/docs/ai-gateway/capabilities/video-generation#extending-timeouts-for-node.js`;
    return new _GatewayTimeoutError({
      message,
      statusCode,
      cause,
      generationId
    });
  }
};

// src/errors/as-gateway-error.ts
function isTimeoutError(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  const errorCode = error.code;
  if (typeof errorCode === "string") {
    const undiciTimeoutCodes = [
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
      "UND_ERR_CONNECT_TIMEOUT"
    ];
    return undiciTimeoutCodes.includes(errorCode);
  }
  return false;
}
async function asGatewayError(error, authMethod) {
  var _a11;
  if (GatewayError.isInstance(error)) {
    return error;
  }
  if (isTimeoutError(error)) {
    return GatewayTimeoutError.createTimeoutError({
      originalMessage: error instanceof Error ? error.message : "Unknown error",
      cause: error
    });
  }
  if (APICallError.isInstance(error)) {
    if (error.cause && isTimeoutError(error.cause)) {
      return GatewayTimeoutError.createTimeoutError({
        originalMessage: error.message,
        cause: error
      });
    }
    return await createGatewayErrorFromResponse({
      response: extractApiCallResponse(error),
      statusCode: (_a11 = error.statusCode) != null ? _a11 : 500,
      defaultMessage: "Gateway request failed",
      cause: error,
      authMethod
    });
  }
  return await createGatewayErrorFromResponse({
    response: {},
    statusCode: 500,
    defaultMessage: error instanceof Error ? `Gateway request failed: ${error.message}` : "Unknown Gateway error",
    cause: error,
    authMethod
  });
}

// src/gateway-headers.ts
var GATEWAY_AUTH_METHOD_HEADER = "ai-gateway-auth-method";
var VERCEL_AI_GATEWAY_TEAM_HEADER = "x-vercel-ai-gateway-team";

// src/errors/parse-auth-method.ts
import { z as z4 } from "zod/v4";
import {
  lazySchema as lazySchema4,
  safeValidateTypes as safeValidateTypes2,
  zodSchema as zodSchema4
} from "@ai-sdk/provider-utils";
async function parseAuthMethod(headers) {
  const result = await safeValidateTypes2({
    value: headers[GATEWAY_AUTH_METHOD_HEADER],
    schema: gatewayAuthMethodSchema
  });
  return result.success ? result.value : void 0;
}
var gatewayAuthMethodSchema = lazySchema4(
  () => zodSchema4(z4.union([z4.literal("api-key"), z4.literal("oidc")]))
);

// src/gateway-fetch-metadata.ts
import {
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  getFromApi,
  lazySchema as lazySchema5,
  resolve,
  zodSchema as zodSchema5
} from "@ai-sdk/provider-utils";
import { z as z5 } from "zod/v4";

// src/gateway-model-entry.ts
var KNOWN_MODEL_TYPES = [
  "embedding",
  "image",
  "language",
  "realtime",
  "reranking",
  "speech",
  "transcription",
  "video"
];

// src/gateway-fetch-metadata.ts
var GatewayFetchMetadata = class {
  constructor(config) {
    this.config = config;
  }
  async getAvailableModels() {
    try {
      const { value } = await getFromApi({
        url: `${this.config.baseURL}/config`,
        validateUrl: false,
        headers: this.config.headers ? await resolve(this.config.headers) : void 0,
        successfulResponseHandler: createJsonResponseHandler(
          gatewayAvailableModelsResponseSchema
        ),
        failedResponseHandler: createJsonErrorResponseHandler({
          errorSchema: z5.any(),
          errorToMessage: (data) => data
        }),
        fetch: this.config.fetch
      });
      return value;
    } catch (error) {
      throw await asGatewayError(error);
    }
  }
  async getCredits() {
    try {
      const baseUrl = new URL(this.config.baseURL);
      const { value } = await getFromApi({
        url: `${baseUrl.origin}/v1/credits`,
        validateUrl: false,
        headers: this.config.headers ? await resolve(this.config.headers) : void 0,
        successfulResponseHandler: createJsonResponseHandler(
          gatewayCreditsResponseSchema
        ),
        failedResponseHandler: createJsonErrorResponseHandler({
          errorSchema: z5.any(),
          errorToMessage: (data) => data
        }),
        fetch: this.config.fetch
      });
      return value;
    } catch (error) {
      throw await asGatewayError(error);
    }
  }
};
var gatewayAvailableModelsResponseSchema = lazySchema5(
  () => zodSchema5(
    z5.object({
      models: z5.array(
        z5.object({
          id: z5.string(),
          name: z5.string(),
          description: z5.string().nullish(),
          pricing: z5.object({
            input: z5.string(),
            output: z5.string(),
            input_cache_read: z5.string().nullish(),
            input_cache_write: z5.string().nullish()
          }).transform(
            ({ input, output, input_cache_read, input_cache_write }) => ({
              input,
              output,
              ...input_cache_read ? { cachedInputTokens: input_cache_read } : {},
              ...input_cache_write ? { cacheCreationInputTokens: input_cache_write } : {}
            })
          ).nullish(),
          specification: z5.object({
            specificationVersion: z5.literal("v4"),
            provider: z5.string(),
            modelId: z5.string()
          }),
          modelType: z5.string().nullish()
        })
      ).transform(
        (models) => models.filter(
          (m) => m.modelType == null || KNOWN_MODEL_TYPES.includes(m.modelType)
        )
      )
    })
  )
);
var gatewayCreditsResponseSchema = lazySchema5(
  () => zodSchema5(
    z5.object({
      balance: z5.string(),
      total_used: z5.string()
    }).transform(({ balance, total_used }) => ({
      balance,
      totalUsed: total_used
    }))
  )
);

// src/gateway-spend-report.ts
import {
  createJsonErrorResponseHandler as createJsonErrorResponseHandler2,
  createJsonResponseHandler as createJsonResponseHandler2,
  getFromApi as getFromApi2,
  lazySchema as lazySchema6,
  resolve as resolve2,
  zodSchema as zodSchema6
} from "@ai-sdk/provider-utils";
import { z as z6 } from "zod/v4";
var GatewaySpendReport = class {
  constructor(config) {
    this.config = config;
  }
  async getSpendReport(params) {
    try {
      const baseUrl = new URL(this.config.baseURL);
      const searchParams = new URLSearchParams();
      searchParams.set("start_date", params.startDate);
      searchParams.set("end_date", params.endDate);
      if (params.groupBy) {
        searchParams.set("group_by", params.groupBy);
      }
      if (params.datePart) {
        searchParams.set("date_part", params.datePart);
      }
      if (params.userId) {
        searchParams.set("user_id", params.userId);
      }
      if (params.model) {
        searchParams.set("model", params.model);
      }
      if (params.provider) {
        searchParams.set("provider", params.provider);
      }
      if (params.credentialType) {
        searchParams.set("credential_type", params.credentialType);
      }
      if (params.tags && params.tags.length > 0) {
        searchParams.set("tags", params.tags.join(","));
      }
      const { value } = await getFromApi2({
        url: `${baseUrl.origin}/v1/report?${searchParams.toString()}`,
        validateUrl: false,
        headers: this.config.headers ? await resolve2(this.config.headers) : void 0,
        successfulResponseHandler: createJsonResponseHandler2(
          gatewaySpendReportResponseSchema
        ),
        failedResponseHandler: createJsonErrorResponseHandler2({
          errorSchema: z6.any(),
          errorToMessage: (data) => data
        }),
        fetch: this.config.fetch
      });
      return value;
    } catch (error) {
      throw await asGatewayError(error);
    }
  }
};
var gatewaySpendReportResponseSchema = lazySchema6(
  () => zodSchema6(
    z6.object({
      results: z6.array(
        z6.object({
          day: z6.string().optional(),
          hour: z6.string().optional(),
          user: z6.string().optional(),
          model: z6.string().optional(),
          tag: z6.string().optional(),
          provider: z6.string().optional(),
          credential_type: z6.enum(["byok", "system"]).optional(),
          total_cost: z6.number(),
          market_cost: z6.number().optional(),
          input_tokens: z6.number().optional(),
          output_tokens: z6.number().optional(),
          cached_input_tokens: z6.number().optional(),
          cache_creation_input_tokens: z6.number().optional(),
          reasoning_tokens: z6.number().optional(),
          request_count: z6.number().optional()
        }).transform(
          ({
            credential_type,
            total_cost,
            market_cost,
            input_tokens,
            output_tokens,
            cached_input_tokens,
            cache_creation_input_tokens,
            reasoning_tokens,
            request_count,
            ...rest
          }) => ({
            ...rest,
            ...credential_type !== void 0 ? { credentialType: credential_type } : {},
            totalCost: total_cost,
            ...market_cost !== void 0 ? { marketCost: market_cost } : {},
            ...input_tokens !== void 0 ? { inputTokens: input_tokens } : {},
            ...output_tokens !== void 0 ? { outputTokens: output_tokens } : {},
            ...cached_input_tokens !== void 0 ? { cachedInputTokens: cached_input_tokens } : {},
            ...cache_creation_input_tokens !== void 0 ? { cacheCreationInputTokens: cache_creation_input_tokens } : {},
            ...reasoning_tokens !== void 0 ? { reasoningTokens: reasoning_tokens } : {},
            ...request_count !== void 0 ? { requestCount: request_count } : {}
          })
        )
      )
    })
  )
);

// src/gateway-generation-info.ts
import {
  createJsonErrorResponseHandler as createJsonErrorResponseHandler3,
  createJsonResponseHandler as createJsonResponseHandler3,
  getFromApi as getFromApi3,
  lazySchema as lazySchema7,
  resolve as resolve3,
  zodSchema as zodSchema7
} from "@ai-sdk/provider-utils";
import { z as z7 } from "zod/v4";
var GatewayGenerationInfoFetcher = class {
  constructor(config) {
    this.config = config;
  }
  async getGenerationInfo(params) {
    try {
      const baseUrl = new URL(this.config.baseURL);
      const { value } = await getFromApi3({
        url: `${baseUrl.origin}/v1/generation?id=${encodeURIComponent(params.id)}`,
        validateUrl: false,
        headers: this.config.headers ? await resolve3(this.config.headers) : void 0,
        successfulResponseHandler: createJsonResponseHandler3(
          gatewayGenerationInfoResponseSchema
        ),
        failedResponseHandler: createJsonErrorResponseHandler3({
          errorSchema: z7.any(),
          errorToMessage: (data) => data
        }),
        fetch: this.config.fetch
      });
      return value;
    } catch (error) {
      throw await asGatewayError(error);
    }
  }
};
var gatewayGenerationInfoResponseSchema = lazySchema7(
  () => zodSchema7(
    z7.object({
      data: z7.object({
        id: z7.string(),
        total_cost: z7.number(),
        upstream_inference_cost: z7.number(),
        usage: z7.number(),
        created_at: z7.string(),
        model: z7.string(),
        is_byok: z7.boolean(),
        provider_name: z7.string(),
        streamed: z7.boolean(),
        finish_reason: z7.string(),
        latency: z7.number(),
        generation_time: z7.number(),
        native_tokens_prompt: z7.number(),
        native_tokens_completion: z7.number(),
        native_tokens_reasoning: z7.number(),
        native_tokens_cached: z7.number(),
        native_tokens_cache_creation: z7.number(),
        billable_web_search_calls: z7.number()
      }).transform(
        ({
          total_cost,
          upstream_inference_cost,
          created_at,
          is_byok,
          provider_name,
          finish_reason,
          generation_time,
          native_tokens_prompt,
          native_tokens_completion,
          native_tokens_reasoning,
          native_tokens_cached,
          native_tokens_cache_creation,
          billable_web_search_calls,
          ...rest
        }) => ({
          ...rest,
          totalCost: total_cost,
          upstreamInferenceCost: upstream_inference_cost,
          createdAt: created_at,
          isByok: is_byok,
          providerName: provider_name,
          finishReason: finish_reason,
          generationTime: generation_time,
          promptTokens: native_tokens_prompt,
          completionTokens: native_tokens_completion,
          reasoningTokens: native_tokens_reasoning,
          cachedTokens: native_tokens_cached,
          cacheCreationTokens: native_tokens_cache_creation,
          billableWebSearchCalls: billable_web_search_calls
        })
      )
    }).transform(({ data }) => data)
  )
);

// src/gateway-language-model.ts
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonErrorResponseHandler as createJsonErrorResponseHandler4,
  createJsonResponseHandler as createJsonResponseHandler4,
  postJsonToApi,
  resolve as resolve4,
  serializeModelOptions,
  WORKFLOW_SERIALIZE,
  WORKFLOW_DESERIALIZE
} from "@ai-sdk/provider-utils";
import { z as z8 } from "zod/v4";
var GatewayLanguageModel = class _GatewayLanguageModel {
  constructor(modelId, config) {
    this.modelId = modelId;
    this.config = config;
    this.specificationVersion = "v4";
    this.supportedUrls = { "*/*": [/.*/] };
  }
  static [WORKFLOW_SERIALIZE](model) {
    return serializeModelOptions({
      modelId: model.modelId,
      config: model.config
    });
  }
  static [WORKFLOW_DESERIALIZE](options) {
    return new _GatewayLanguageModel(options.modelId, options.config);
  }
  get provider() {
    return this.config.provider;
  }
  async getArgs(options) {
    const { abortSignal: _abortSignal, ...optionsWithoutSignal } = options;
    return {
      args: this.maybeEncodeFileParts(optionsWithoutSignal),
      warnings: []
    };
  }
  async doGenerate(options) {
    const { args, warnings } = await this.getArgs(options);
    const { abortSignal } = options;
    const resolvedHeaders = this.config.headers ? await resolve4(this.config.headers) : void 0;
    try {
      const {
        responseHeaders,
        value: responseBody,
        rawValue: rawResponse
      } = await postJsonToApi({
        url: this.getUrl(),
        headers: combineHeaders(
          resolvedHeaders,
          options.headers,
          this.getModelConfigHeaders(this.modelId, false),
          await resolve4(this.config.o11yHeaders)
        ),
        body: args,
        successfulResponseHandler: createJsonResponseHandler4(z8.any()),
        failedResponseHandler: createJsonErrorResponseHandler4({
          errorSchema: z8.any(),
          errorToMessage: (data) => data
        }),
        ...abortSignal && { abortSignal },
        fetch: this.config.fetch
      });
      return {
        ...responseBody,
        request: { body: args },
        response: { headers: responseHeaders, body: rawResponse },
        warnings
      };
    } catch (error) {
      throw await asGatewayError(
        error,
        await parseAuthMethod(resolvedHeaders != null ? resolvedHeaders : {})
      );
    }
  }
  async doStream(options) {
    const { args, warnings } = await this.getArgs(options);
    const { abortSignal } = options;
    const resolvedHeaders = this.config.headers ? await resolve4(this.config.headers) : void 0;
    try {
      const { value: response, responseHeaders } = await postJsonToApi({
        url: this.getUrl(),
        headers: combineHeaders(
          resolvedHeaders,
          options.headers,
          this.getModelConfigHeaders(this.modelId, true),
          await resolve4(this.config.o11yHeaders)
        ),
        body: args,
        successfulResponseHandler: createEventSourceResponseHandler(z8.any()),
        failedResponseHandler: createJsonErrorResponseHandler4({
          errorSchema: z8.any(),
          errorToMessage: (data) => data
        }),
        ...abortSignal && { abortSignal },
        fetch: this.config.fetch
      });
      return {
        stream: response.pipeThrough(
          new TransformStream({
            start(controller) {
              if (warnings.length > 0) {
                controller.enqueue({ type: "stream-start", warnings });
              }
            },
            transform(chunk, controller) {
              if (chunk.success) {
                const streamPart = chunk.value;
                if (streamPart.type === "raw" && !options.includeRawChunks) {
                  return;
                }
                if (streamPart.type === "response-metadata" && streamPart.timestamp && typeof streamPart.timestamp === "string") {
                  streamPart.timestamp = new Date(streamPart.timestamp);
                }
                controller.enqueue(streamPart);
              } else {
                controller.error(
                  chunk.error
                );
              }
            }
          })
        ),
        request: { body: args },
        response: { headers: responseHeaders }
      };
    } catch (error) {
      throw await asGatewayError(
        error,
        await parseAuthMethod(resolvedHeaders != null ? resolvedHeaders : {})
      );
    }
  }
  /**
   * Encodes inline `Uint8Array` file data to a base64 string in place.
   * @param options - The options to encode.
   * @returns The options with the file data encoded.
   */
  maybeEncodeFileParts(options) {
    for (const message of options.prompt) {
      if (!Array.isArray(message.content)) {
        continue;
      }
      for (const part of message.content) {
        if (part.type === "file" || part.type === "reasoning-file") {
          part.data = maybeBase64EncodeFileData(part.data);
        } else if (part.type === "tool-result" && part.output.type === "content") {
          for (const contentPart of part.output.value) {
            if (contentPart.type === "file") {
              contentPart.data = maybeBase64EncodeFileData(contentPart.data);
            }
          }
        }
      }
    }
    return options;
  }
  getUrl() {
    return `${this.config.baseURL}/language-model`;
  }
  getModelConfigHeaders(modelId, streaming) {
    return {
      "ai-language-model-specification-version": "4",
      "ai-language-model-id": modelId,
      "ai-language-model-streaming": String(streaming)
    };
  }
};
function maybeBase64EncodeFileData(data) {
  if (data.type === "data") {
    const bytes = data.data;
    if (bytes instanceof Uint8Array) {
      return { ...data, data: Buffer.from(bytes).toString("base64") };
    }
  }
  return data;
}

// src/gateway-embedding-model.ts
import {
  combineHeaders as combineHeaders2,
  createJsonErrorResponseHandler as createJsonErrorResponseHandler5,
  createJsonResponseHandler as createJsonResponseHandler5,
  lazySchema as lazySchema8,
  postJsonToApi as postJsonToApi2,
  resolve as resolve5,
  serializeModelOptions as serializeModelOptions2,
  WORKFLOW_SERIALIZE as WORKFLOW_SERIALIZE2,
  WORKFLOW_DESERIALIZE as WORKFLOW_DESERIALIZE2,
  zodSchema as zodSchema8
} from "@ai-sdk/provider-utils";
import { z as z9 } from "zod/v4";
var GatewayEmbeddingModel = class _GatewayEmbeddingModel {
  constructor(modelId, config) {
    this.modelId = modelId;
    this.config = config;
    this.specificationVersion = "v4";
    this.maxEmbeddingsPerCall = 2048;
    this.supportsParallelCalls = true;
  }
  static [WORKFLOW_SERIALIZE2](model) {
    return serializeModelOptions2({
      modelId: model.modelId,
      config: model.config
    });
  }
  static [WORKFLOW_DESERIALIZE2](options) {
    return new _GatewayEmbeddingModel(options.modelId, options.config);
  }
  get provider() {
    return this.config.provider;
  }
  async doEmbed({
    values,
    headers,
    abortSignal,
    providerOptions
  }) {
    var _a11, _b11;
    const resolvedHeaders = this.config.headers ? await resolve5(this.config.headers) : void 0;
    try {
      const {
        responseHeaders,
        value: responseBody,
        rawValue
      } = await postJsonToApi2({
        url: this.getUrl(),
        headers: combineHeaders2(
          resolvedHeaders,
          headers != null ? headers : {},
          this.getModelConfigHeaders(),
          await resolve5(this.config.o11yHeaders)
        ),
        body: {
          values,
          ...providerOptions ? { providerOptions } : {}
        },
        successfulResponseHandler: createJsonResponseHandler5(
          gatewayEmbeddingResponseSchema
        ),
        failedResponseHandler: createJsonErrorResponseHandler5({
          errorSchema: z9.any(),
          errorToMessage: (data) => data
        }),
        ...abortSignal && { abortSignal },
        fetch: this.config.fetch
      });
      return {
        embeddings: responseBody.embeddings,
        usage: (_a11 = responseBody.usage) != null ? _a11 : void 0,
        providerMetadata: responseBody.providerMetadata,
        response: { headers: responseHeaders, body: rawValue },
        warnings: (_b11 = responseBody.warnings) != null ? _b11 : []
      };
    } catch (error) {
      throw await asGatewayError(
        error,
        await parseAuthMethod(resolvedHeaders != null ? resolvedHeaders : {})
      );
    }
  }
  getUrl() {
    return `${this.config.baseURL}/embedding-model`;
  }
  getModelConfigHeaders() {
    return {
      "ai-embedding-model-specification-version": "4",
      "ai-model-id": this.modelId
    };
  }
};
var gatewayEmbeddingWarningSchema = z9.discriminatedUnion("type", [
  z9.object({
    type: z9.literal("unsupported"),
    feature: z9.string(),
    details: z9.string().optional()
  }),
  z9.object({
    type: z9.literal("compatibility"),
    feature: z9.string(),
    details: z9.string().optional()
  }),
  z9.object({
    type: z9.literal("deprecated"),
    setting: z9.string(),
    message: z9.string()
  }),
  z9.object({
    type: z9.literal("other"),
    message: z9.string()
  })
]);
var gatewayEmbeddingResponseSchema = lazySchema8(
  () => zodSchema8(
    z9.object({
      embeddings: z9.array(z9.array(z9.number())),
      usage: z9.object({ tokens: z9.number() }).nullish(),
      warnings: z9.array(gatewayEmbeddingWarningSchema).optional(),
      providerMetadata: z9.record(z9.string(), z9.record(z9.string(), z9.unknown())).optional()
    })
  )
);

// src/gateway-image-model.ts
import {
  combineHeaders as combineHeaders3,
  convertUint8ArrayToBase64,
  createJsonResponseHandler as createJsonResponseHandler6,
  createJsonErrorResponseHandler as createJsonErrorResponseHandler6,
  postJsonToApi as postJsonToApi3,
  resolve as resolve6,
  serializeModelOptions as serializeModelOptions3,
  WORKFLOW_SERIALIZE as WORKFLOW_SERIALIZE3,
  WORKFLOW_DESERIALIZE as WORKFLOW_DESERIALIZE3
} from "@ai-sdk/provider-utils";
import { z as z10 } from "zod/v4";
var GatewayImageModel = class _GatewayImageModel {
  constructor(modelId, config) {
    this.modelId = modelId;
    this.config = config;
    this.specificationVersion = "v4";
    // Set a very large number to prevent client-side splitting of requests
    this.maxImagesPerCall = Number.MAX_SAFE_INTEGER;
  }
  static [WORKFLOW_SERIALIZE3](model) {
    return serializeModelOptions3({
      modelId: model.modelId,
      config: model.config
    });
  }
  static [WORKFLOW_DESERIALIZE3](options) {
    return new _GatewayImageModel(options.modelId, options.config);
  }
  get provider() {
    return this.config.provider;
  }
  async doGenerate({
    prompt,
    n,
    size,
    aspectRatio,
    seed,
    files,
    mask,
    providerOptions,
    headers,
    abortSignal
  }) {
    var _a11, _b11, _c, _d;
    const resolvedHeaders = this.config.headers ? await resolve6(this.config.headers) : void 0;
    try {
      const { responseHeaders, value: responseBody } = await postJsonToApi3({
        url: this.getUrl(),
        headers: combineHeaders3(
          resolvedHeaders,
          headers != null ? headers : {},
          this.getModelConfigHeaders(),
          await resolve6(this.config.o11yHeaders)
        ),
        body: {
          prompt,
          n,
          ...size && { size },
          ...aspectRatio && { aspectRatio },
          ...seed && { seed },
          ...providerOptions && { providerOptions },
          ...files && {
            files: files.map((file) => maybeEncodeImageFile(file))
          },
          ...mask && { mask: maybeEncodeImageFile(mask) }
        },
        successfulResponseHandler: createJsonResponseHandler6(
          gatewayImageResponseSchema
        ),
        failedResponseHandler: createJsonErrorResponseHandler6({
          errorSchema: z10.any(),
          errorToMessage: (data) => data
        }),
        ...abortSignal && { abortSignal },
        fetch: this.config.fetch
      });
      return {
        images: responseBody.images,
        // Always base64 strings from server
        warnings: (_a11 = responseBody.warnings) != null ? _a11 : [],
        providerMetadata: responseBody.providerMetadata,
        response: {
          timestamp: /* @__PURE__ */ new Date(),
          modelId: this.modelId,
          headers: responseHeaders
        },
        ...responseBody.usage != null && {
          usage: {
            inputTokens: (_b11 = responseBody.usage.inputTokens) != null ? _b11 : void 0,
            outputTokens: (_c = responseBody.usage.outputTokens) != null ? _c : void 0,
            totalTokens: (_d = responseBody.usage.totalTokens) != null ? _d : void 0
          }
        }
      };
    } catch (error) {
      throw await asGatewayError(
        error,
        await parseAuthMethod(resolvedHeaders != null ? resolvedHeaders : {})
      );
    }
  }
  getUrl() {
    return `${this.config.baseURL}/image-model`;
  }
  getModelConfigHeaders() {
    return {
      "ai-image-model-specification-version": "4",
      "ai-model-id": this.modelId
    };
  }
};
function maybeEncodeImageFile(file) {
  if (file.type === "file" && file.data instanceof Uint8Array) {
    return {
      ...file,
      data: convertUint8ArrayToBase64(file.data)
    };
  }
  return file;
}
var providerMetadataEntrySchema = z10.object({
  images: z10.array(z10.unknown()).optional()
}).catchall(z10.unknown());
var gatewayImageWarningSchema = z10.discriminatedUnion("type", [
  z10.object({
    type: z10.literal("unsupported"),
    feature: z10.string(),
    details: z10.string().optional()
  }),
  z10.object({
    type: z10.literal("compatibility"),
    feature: z10.string(),
    details: z10.string().optional()
  }),
  z10.object({
    type: z10.literal("deprecated"),
    setting: z10.string(),
    message: z10.string()
  }),
  z10.object({
    type: z10.literal("other"),
    message: z10.string()
  })
]);
var gatewayImageUsageSchema = z10.object({
  inputTokens: z10.number().nullish(),
  outputTokens: z10.number().nullish(),
  totalTokens: z10.number().nullish()
});
var gatewayImageResponseSchema = z10.object({
  images: z10.array(z10.string()),
  // Always base64 strings over the wire
  warnings: z10.array(gatewayImageWarningSchema).optional(),
  providerMetadata: z10.record(z10.string(), providerMetadataEntrySchema).optional(),
  usage: gatewayImageUsageSchema.optional()
});

// src/gateway-video-model.ts
import {
  APICallError as APICallError2
} from "@ai-sdk/provider";
import {
  combineHeaders as combineHeaders4,
  convertUint8ArrayToBase64 as convertUint8ArrayToBase642,
  createJsonErrorResponseHandler as createJsonErrorResponseHandler7,
  parseJsonEventStream,
  postJsonToApi as postJsonToApi4,
  resolve as resolve7
} from "@ai-sdk/provider-utils";
import { z as z11 } from "zod/v4";
var GatewayVideoModel = class {
  constructor(modelId, config) {
    this.modelId = modelId;
    this.config = config;
    this.specificationVersion = "v4";
    // Set a very large number to prevent client-side splitting of requests
    this.maxVideosPerCall = Number.MAX_SAFE_INTEGER;
  }
  get provider() {
    return this.config.provider;
  }
  async doGenerate({
    prompt,
    n,
    aspectRatio,
    resolution,
    duration,
    fps,
    seed,
    generateAudio,
    image,
    frameImages,
    inputReferences,
    providerOptions,
    headers,
    abortSignal
  }) {
    var _a11;
    const resolvedHeaders = this.config.headers ? await resolve7(this.config.headers) : void 0;
    try {
      const { responseHeaders, value: responseBody } = await postJsonToApi4({
        url: this.getUrl(),
        headers: combineHeaders4(
          resolvedHeaders,
          headers != null ? headers : {},
          this.getModelConfigHeaders(),
          await resolve7(this.config.o11yHeaders),
          { accept: "text/event-stream" }
        ),
        body: {
          prompt,
          n,
          ...aspectRatio && { aspectRatio },
          ...resolution && { resolution },
          ...duration && { duration },
          ...fps && { fps },
          ...seed && { seed },
          ...generateAudio !== void 0 && { generateAudio },
          ...providerOptions && { providerOptions },
          ...image && { image: maybeEncodeVideoFile(image) },
          ...frameImages && {
            frameImages: frameImages.map((frame) => ({
              ...frame,
              image: maybeEncodeVideoFile(frame.image)
            }))
          },
          ...inputReferences && {
            inputReferences: inputReferences.map(
              (reference) => maybeEncodeVideoFile(reference)
            )
          }
        },
        successfulResponseHandler: async ({
          response,
          url,
          requestBodyValues
        }) => {
          if (response.body == null) {
            throw new APICallError2({
              message: "SSE response body is empty",
              url,
              requestBodyValues,
              statusCode: response.status
            });
          }
          const eventStream = parseJsonEventStream({
            stream: response.body,
            schema: gatewayVideoEventSchema
          });
          const reader = eventStream.getReader();
          const { done, value: parseResult } = await reader.read();
          reader.releaseLock();
          if (done || !parseResult) {
            throw new APICallError2({
              message: "SSE stream ended without a data event",
              url,
              requestBodyValues,
              statusCode: response.status
            });
          }
          if (!parseResult.success) {
            throw new APICallError2({
              message: "Failed to parse video SSE event",
              cause: parseResult.error,
              url,
              requestBodyValues,
              statusCode: response.status
            });
          }
          const event = parseResult.value;
          if (event.type === "error") {
            throw new APICallError2({
              message: event.message,
              statusCode: event.statusCode,
              url,
              requestBodyValues,
              responseHeaders: Object.fromEntries([...response.headers]),
              responseBody: JSON.stringify(event),
              data: {
                error: {
                  message: event.message,
                  type: event.errorType,
                  param: event.param
                }
              }
            });
          }
          return {
            value: {
              videos: event.videos,
              warnings: event.warnings,
              providerMetadata: event.providerMetadata
            },
            responseHeaders: Object.fromEntries([...response.headers])
          };
        },
        failedResponseHandler: createJsonErrorResponseHandler7({
          errorSchema: z11.any(),
          errorToMessage: (data) => data
        }),
        ...abortSignal && { abortSignal },
        fetch: this.config.fetch
      });
      return {
        videos: responseBody.videos,
        warnings: (_a11 = responseBody.warnings) != null ? _a11 : [],
        providerMetadata: responseBody.providerMetadata,
        response: {
          timestamp: /* @__PURE__ */ new Date(),
          modelId: this.modelId,
          headers: responseHeaders
        }
      };
    } catch (error) {
      throw await asGatewayError(
        error,
        await parseAuthMethod(resolvedHeaders != null ? resolvedHeaders : {})
      );
    }
  }
  getUrl() {
    return `${this.config.baseURL}/video-model`;
  }
  getModelConfigHeaders() {
    return {
      "ai-video-model-specification-version": "4",
      "ai-model-id": this.modelId
    };
  }
};
function maybeEncodeVideoFile(file) {
  if (file.type === "file" && file.data instanceof Uint8Array) {
    return {
      ...file,
      data: convertUint8ArrayToBase642(file.data)
    };
  }
  return file;
}
var providerMetadataEntrySchema2 = z11.object({
  videos: z11.array(z11.unknown()).optional()
}).catchall(z11.unknown());
var gatewayVideoDataSchema = z11.union([
  z11.object({
    type: z11.literal("url"),
    url: z11.string(),
    mediaType: z11.string()
  }),
  z11.object({
    type: z11.literal("base64"),
    data: z11.string(),
    mediaType: z11.string()
  })
]);
var gatewayVideoWarningSchema = z11.discriminatedUnion("type", [
  z11.object({
    type: z11.literal("unsupported"),
    feature: z11.string(),
    details: z11.string().optional()
  }),
  z11.object({
    type: z11.literal("compatibility"),
    feature: z11.string(),
    details: z11.string().optional()
  }),
  z11.object({
    type: z11.literal("deprecated"),
    setting: z11.string(),
    message: z11.string()
  }),
  z11.object({
    type: z11.literal("other"),
    message: z11.string()
  })
]);
var gatewayVideoEventSchema = z11.discriminatedUnion("type", [
  z11.object({
    type: z11.literal("result"),
    videos: z11.array(gatewayVideoDataSchema),
    warnings: z11.array(gatewayVideoWarningSchema).optional(),
    providerMetadata: z11.record(z11.string(), providerMetadataEntrySchema2).optional()
  }),
  z11.object({
    type: z11.literal("error"),
    message: z11.string(),
    errorType: z11.string(),
    statusCode: z11.number(),
    param: z11.unknown().nullable()
  })
]);

// src/gateway-reranking-model.ts
import {
  combineHeaders as combineHeaders5,
  createJsonErrorResponseHandler as createJsonErrorResponseHandler8,
  createJsonResponseHandler as createJsonResponseHandler7,
  lazySchema as lazySchema9,
  postJsonToApi as postJsonToApi5,
  resolve as resolve8,
  zodSchema as zodSchema9
} from "@ai-sdk/provider-utils";
import { z as z12 } from "zod/v4";
var GatewayRerankingModel = class {
  constructor(modelId, config) {
    this.modelId = modelId;
    this.config = config;
    this.specificationVersion = "v4";
  }
  get provider() {
    return this.config.provider;
  }
  async doRerank({
    documents,
    query,
    topN,
    headers,
    abortSignal,
    providerOptions
  }) {
    var _a11;
    const resolvedHeaders = this.config.headers ? await resolve8(this.config.headers) : void 0;
    try {
      const {
        responseHeaders,
        value: responseBody,
        rawValue
      } = await postJsonToApi5({
        url: this.getUrl(),
        headers: combineHeaders5(
          resolvedHeaders,
          headers != null ? headers : {},
          this.getModelConfigHeaders(),
          await resolve8(this.config.o11yHeaders)
        ),
        body: {
          documents,
          query,
          ...topN != null ? { topN } : {},
          ...providerOptions ? { providerOptions } : {}
        },
        successfulResponseHandler: createJsonResponseHandler7(
          gatewayRerankingResponseSchema
        ),
        failedResponseHandler: createJsonErrorResponseHandler8({
          errorSchema: z12.any(),
          errorToMessage: (data) => data
        }),
        ...abortSignal && { abortSignal },
        fetch: this.config.fetch
      });
      return {
        ranking: responseBody.ranking,
        providerMetadata: responseBody.providerMetadata,
        response: { headers: responseHeaders, body: rawValue },
        warnings: (_a11 = responseBody.warnings) != null ? _a11 : []
      };
    } catch (error) {
      throw await asGatewayError(
        error,
        await parseAuthMethod(resolvedHeaders != null ? resolvedHeaders : {})
      );
    }
  }
  getUrl() {
    return `${this.config.baseURL}/reranking-model`;
  }
  getModelConfigHeaders() {
    return {
      "ai-reranking-model-specification-version": "4",
      "ai-model-id": this.modelId
    };
  }
};
var gatewayRerankingWarningSchema = z12.discriminatedUnion("type", [
  z12.object({
    type: z12.literal("unsupported"),
    feature: z12.string(),
    details: z12.string().optional()
  }),
  z12.object({
    type: z12.literal("compatibility"),
    feature: z12.string(),
    details: z12.string().optional()
  }),
  z12.object({
    type: z12.literal("deprecated"),
    setting: z12.string(),
    message: z12.string()
  }),
  z12.object({
    type: z12.literal("other"),
    message: z12.string()
  })
]);
var gatewayRerankingResponseSchema = lazySchema9(
  () => zodSchema9(
    z12.object({
      ranking: z12.array(
        z12.object({
          index: z12.number(),
          relevanceScore: z12.number()
        })
      ),
      warnings: z12.array(gatewayRerankingWarningSchema).optional(),
      providerMetadata: z12.record(z12.string(), z12.record(z12.string(), z12.unknown())).optional()
    })
  )
);

// src/gateway-speech-model.ts
import {
  combineHeaders as combineHeaders6,
  createJsonErrorResponseHandler as createJsonErrorResponseHandler9,
  createJsonResponseHandler as createJsonResponseHandler8,
  postJsonToApi as postJsonToApi6,
  resolve as resolve9
} from "@ai-sdk/provider-utils";
import { z as z13 } from "zod/v4";
var GatewaySpeechModel = class {
  constructor(modelId, config) {
    this.modelId = modelId;
    this.config = config;
    this.specificationVersion = "v4";
  }
  get provider() {
    return this.config.provider;
  }
  async doGenerate({
    text,
    voice,
    outputFormat,
    instructions,
    speed,
    language,
    providerOptions,
    headers,
    abortSignal
  }) {
    var _a11;
    const resolvedHeaders = this.config.headers ? await resolve9(this.config.headers) : void 0;
    try {
      const {
        responseHeaders,
        value: responseBody,
        rawValue
      } = await postJsonToApi6({
        url: this.getUrl(),
        headers: combineHeaders6(
          resolvedHeaders,
          headers != null ? headers : {},
          this.getModelConfigHeaders(),
          await resolve9(this.config.o11yHeaders)
        ),
        body: {
          text,
          ...voice && { voice },
          ...outputFormat && { outputFormat },
          ...instructions && { instructions },
          ...speed != null && { speed },
          ...language && { language },
          ...providerOptions && { providerOptions }
        },
        successfulResponseHandler: createJsonResponseHandler8(
          gatewaySpeechResponseSchema
        ),
        failedResponseHandler: createJsonErrorResponseHandler9({
          errorSchema: z13.any(),
          errorToMessage: (data) => data
        }),
        ...abortSignal && { abortSignal },
        fetch: this.config.fetch
      });
      return {
        audio: responseBody.audio,
        warnings: (_a11 = responseBody.warnings) != null ? _a11 : [],
        providerMetadata: responseBody.providerMetadata,
        response: {
          timestamp: /* @__PURE__ */ new Date(),
          modelId: this.modelId,
          headers: responseHeaders,
          body: rawValue
        }
      };
    } catch (error) {
      throw await asGatewayError(
        error,
        await parseAuthMethod(resolvedHeaders != null ? resolvedHeaders : {})
      );
    }
  }
  getUrl() {
    return `${this.config.baseURL}/speech-model`;
  }
  getModelConfigHeaders() {
    return {
      "ai-speech-model-specification-version": "4",
      "ai-model-id": this.modelId
    };
  }
};
var providerMetadataEntrySchema3 = z13.object({}).catchall(z13.unknown());
var gatewaySpeechWarningSchema = z13.discriminatedUnion("type", [
  z13.object({
    type: z13.literal("unsupported"),
    feature: z13.string(),
    details: z13.string().optional()
  }),
  z13.object({
    type: z13.literal("compatibility"),
    feature: z13.string(),
    details: z13.string().optional()
  }),
  z13.object({
    type: z13.literal("deprecated"),
    setting: z13.string(),
    message: z13.string()
  }),
  z13.object({
    type: z13.literal("other"),
    message: z13.string()
  })
]);
var gatewaySpeechResponseSchema = z13.object({
  audio: z13.string(),
  warnings: z13.array(gatewaySpeechWarningSchema).optional(),
  providerMetadata: z13.record(z13.string(), providerMetadataEntrySchema3).optional()
});

// src/gateway-transcription-model.ts
import {
  getErrorMessage
} from "@ai-sdk/provider";
import {
  combineHeaders as combineHeaders7,
  convertBase64ToUint8Array,
  convertUint8ArrayToBase64 as convertUint8ArrayToBase643,
  createJsonErrorResponseHandler as createJsonErrorResponseHandler10,
  createJsonResponseHandler as createJsonResponseHandler9,
  connectToWebSocket,
  normalizeHeaders,
  experimental_parseTranscriptionStreamPart as parseTranscriptionStreamPart,
  postJsonToApi as postJsonToApi7,
  resolve as resolve10,
  EXPERIMENTAL_TRANSCRIPTION_STREAM_AUDIO_DONE_FRAME_TYPE as TRANSCRIPTION_STREAM_AUDIO_DONE_FRAME_TYPE,
  waitForWebSocketBufferDrain,
  EXPERIMENTAL_TRANSCRIPTION_STREAM_START_FRAME_TYPE as TRANSCRIPTION_STREAM_START_FRAME_TYPE
} from "@ai-sdk/provider-utils";
import { z as z14 } from "zod/v4";
var GatewayTranscriptionModel = class {
  constructor(modelId, config) {
    this.modelId = modelId;
    this.config = config;
    this.specificationVersion = "v4";
  }
  get provider() {
    return this.config.provider;
  }
  async doGenerate({
    audio,
    mediaType,
    providerOptions,
    headers,
    abortSignal
  }) {
    var _a11, _b11, _c, _d;
    const resolvedHeaders = this.config.headers ? await resolve10(this.config.headers) : void 0;
    try {
      const {
        responseHeaders,
        value: responseBody,
        rawValue
      } = await postJsonToApi7({
        url: this.getUrl(),
        headers: combineHeaders7(
          resolvedHeaders,
          headers != null ? headers : {},
          this.getModelConfigHeaders(),
          await resolve10(this.config.o11yHeaders)
        ),
        body: {
          audio: audio instanceof Uint8Array ? convertUint8ArrayToBase643(audio) : audio,
          mediaType,
          ...providerOptions && { providerOptions }
        },
        successfulResponseHandler: createJsonResponseHandler9(
          gatewayTranscriptionResponseSchema
        ),
        failedResponseHandler: createJsonErrorResponseHandler10({
          errorSchema: z14.any(),
          errorToMessage: (data) => data
        }),
        ...abortSignal && { abortSignal },
        fetch: this.config.fetch
      });
      return {
        text: responseBody.text,
        segments: (_a11 = responseBody.segments) != null ? _a11 : [],
        language: (_b11 = responseBody.language) != null ? _b11 : void 0,
        durationInSeconds: (_c = responseBody.durationInSeconds) != null ? _c : void 0,
        warnings: (_d = responseBody.warnings) != null ? _d : [],
        providerMetadata: responseBody.providerMetadata,
        response: {
          timestamp: /* @__PURE__ */ new Date(),
          modelId: this.modelId,
          headers: responseHeaders,
          body: rawValue
        }
      };
    } catch (error) {
      throw await asGatewayError(
        error,
        await parseAuthMethod(resolvedHeaders != null ? resolvedHeaders : {})
      );
    }
  }
  async doStream(options) {
    var _a11, _b11, _c, _d, _e;
    const currentDate = (_c = (_b11 = (_a11 = this.config._internal) == null ? void 0 : _a11.currentDate) == null ? void 0 : _b11.call(_a11)) != null ? _c : /* @__PURE__ */ new Date();
    const headers = combineHeaders7(
      await resolve10((_d = this.config.headers) != null ? _d : {}),
      (_e = options.headers) != null ? _e : {},
      this.getModelConfigHeaders(),
      await resolve10(this.config.o11yHeaders)
    );
    const authMethod = await parseAuthMethod(headers);
    const startFrame = {
      type: TRANSCRIPTION_STREAM_START_FRAME_TYPE,
      inputAudioFormat: options.inputAudioFormat,
      ...options.providerOptions != null && {
        providerOptions: options.providerOptions
      },
      ...options.includeRawChunks != null && {
        includeRawChunks: options.includeRawChunks
      }
    };
    return {
      stream: createGatewayTranscriptionStream({
        webSocket: this.config.webSocket,
        url: toGatewayTranscriptionUrl(this.config.baseURL, this.modelId),
        protocols: getProtocolsFromHeaders(headers),
        headers,
        startFrame,
        audio: options.audio,
        abortSignal: options.abortSignal,
        authMethod
      }),
      request: { body: startFrame },
      response: { timestamp: currentDate, modelId: this.modelId }
    };
  }
  getUrl() {
    return `${this.config.baseURL}/transcription-model`;
  }
  getModelConfigHeaders() {
    return {
      "ai-transcription-model-specification-version": "4",
      "ai-model-id": this.modelId
    };
  }
};
function toGatewayTranscriptionUrl(baseURL, modelId) {
  const url = new URL(`${baseURL.replace(/^http/, "ws")}/transcription-model`);
  url.searchParams.set("ai-model-id", modelId);
  return url.toString();
}
function getProtocolsFromHeaders(headers) {
  const normalizedHeaders = normalizeHeaders(headers);
  const authorization = normalizedHeaders.authorization;
  const token = (authorization == null ? void 0 : authorization.startsWith("Bearer ")) ? authorization.slice("Bearer ".length) : void 0;
  return token == null ? [GATEWAY_TRANSCRIPTION_SUBPROTOCOL] : getGatewayTranscriptionProtocols(token, {
    teamIdOrSlug: normalizedHeaders[VERCEL_AI_GATEWAY_TEAM_HEADER]
  });
}
var MAX_AUDIO_FRAME_BYTES = 64 * 1024;
function createGatewayTranscriptionStream({
  webSocket,
  url,
  protocols,
  headers,
  startFrame,
  audio,
  abortSignal,
  authMethod
}) {
  let finished = false;
  let cleanup = () => {
  };
  return new ReadableStream({
    start: (controller) => {
      let audioReader;
      let hasServerErrorPart = false;
      let lastServerError;
      let audioStopped = false;
      let connection;
      cleanup = (closeCode) => {
        if (audioReader != null) {
          void audioReader.cancel().catch(() => {
          });
        } else {
          void audio.cancel().catch(() => {
          });
        }
        connection == null ? void 0 : connection.close(closeCode);
      };
      const stopAudio = () => {
        audioStopped = true;
        if (audioReader != null) {
          void audioReader.cancel().catch(() => {
          });
          audioReader = void 0;
        } else {
          void audio.cancel().catch(() => {
          });
        }
      };
      const finishWithError = (error) => {
        if (finished) return;
        finished = true;
        cleanup();
        void errorControllerWithGatewayError(controller, error, authMethod);
      };
      const sendAudio = async (socket) => {
        const reader = audio.getReader();
        audioReader = reader;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done || finished) break;
            const bytes = typeof value === "string" ? convertBase64ToUint8Array(value) : value;
            for (let offset = 0; offset < bytes.length; offset += MAX_AUDIO_FRAME_BYTES) {
              if (finished) break;
              socket.send(
                bytes.subarray(offset, offset + MAX_AUDIO_FRAME_BYTES)
              );
              await waitForWebSocketBufferDrain(socket);
            }
          }
        } finally {
          reader.releaseLock();
          if (audioReader === reader) {
            audioReader = void 0;
          }
        }
        if (!finished && !audioStopped) {
          socket.send(
            JSON.stringify({
              type: TRANSCRIPTION_STREAM_AUDIO_DONE_FRAME_TYPE
            })
          );
        }
      };
      connection = connectToWebSocket({
        url,
        protocols,
        headers,
        webSocket,
        abortSignal,
        onAbort: (reason) => {
          if (finished) return;
          finished = true;
          cleanup();
          controller.error(reason);
        },
        onProcessingError: finishWithError,
        onOpen: (socket) => {
          socket.send(JSON.stringify(startFrame));
          void sendAudio(socket).catch(finishWithError);
        },
        // Server frames are envelope-serialized stream parts; the codec
        // handles parsing, unknown-part skipping, and timestamp revival.
        onMessageText: (text) => {
          if (finished) return;
          const part = parseTranscriptionStreamPart(text);
          if (part == null) return;
          if (part.type === "finish") {
            finished = true;
            controller.enqueue(part);
            controller.close();
            cleanup(1e3);
            return;
          }
          if (part.type === "error") {
            hasServerErrorPart = true;
            lastServerError = part.error;
            stopAudio();
          }
          controller.enqueue(part);
        },
        onSocketError: () => {
          finishWithError(
            new Error("Connection error on AI Gateway transcription stream")
          );
        },
        onClose: () => {
          if (hasServerErrorPart) {
            if (finished) return;
            void createErrorFromServerErrorPart(
              lastServerError,
              authMethod
            ).then(finishWithError);
            return;
          }
          finishWithError(
            new Error(
              "AI Gateway transcription stream closed before a finish part was received"
            )
          );
        }
      });
    },
    cancel: () => {
      if (finished) return;
      finished = true;
      cleanup();
    }
  });
}
var providerMetadataEntrySchema4 = z14.object({}).catchall(z14.unknown());
var gatewayTranscriptionWarningSchema = z14.discriminatedUnion("type", [
  z14.object({
    type: z14.literal("unsupported"),
    feature: z14.string(),
    details: z14.string().optional()
  }),
  z14.object({
    type: z14.literal("compatibility"),
    feature: z14.string(),
    details: z14.string().optional()
  }),
  z14.object({
    type: z14.literal("deprecated"),
    setting: z14.string(),
    message: z14.string()
  }),
  z14.object({
    type: z14.literal("other"),
    message: z14.string()
  })
]);
var gatewayTranscriptionResponseSchema = z14.object({
  text: z14.string(),
  segments: z14.array(
    z14.object({
      text: z14.string(),
      startSecond: z14.number(),
      endSecond: z14.number()
    })
  ).optional(),
  language: z14.string().nullish(),
  durationInSeconds: z14.number().nullish(),
  warnings: z14.array(gatewayTranscriptionWarningSchema).optional(),
  providerMetadata: z14.record(z14.string(), providerMetadataEntrySchema4).optional()
});
async function errorControllerWithGatewayError(controller, error, authMethod) {
  controller.error(await asGatewayError(error, authMethod));
}
function getServerErrorMessage(error) {
  if (error != null && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return getErrorMessage(error);
}
var SERVER_ERROR_STATUS_CODES = {
  authentication_error: 401,
  failed_dependency: 424,
  forbidden: 403,
  internal_server_error: 500,
  invalid_request_error: 400,
  model_not_found: 404,
  rate_limit_exceeded: 429
};
async function createErrorFromServerErrorPart(error, authMethod) {
  if (typeof error === "object" && error != null && "message" in error && typeof error.message === "string" && "type" in error && typeof error.type === "string" && error.type in SERVER_ERROR_STATUS_CODES) {
    return createGatewayErrorFromResponse({
      response: { error: { message: error.message, type: error.type } },
      statusCode: SERVER_ERROR_STATUS_CODES[error.type],
      authMethod
    });
  }
  return new Error(
    `AI Gateway transcription stream failed: ${getServerErrorMessage(error)}`
  );
}

// src/gateway-realtime-model.ts
var GatewayRealtimeModel = class {
  constructor(modelId, config) {
    this.specificationVersion = "v4";
    this.modelId = modelId;
    this.provider = config.provider;
    this.config = config;
  }
  /**
   * Mints a single-use, short-lived client secret (`vcst_`) the browser uses to
   * open the realtime WebSocket without ever holding the long-lived Gateway
   * credential. The customer's server calls this (via
   * `gateway.experimental_realtime.getToken`) and hands the returned token to
   * the browser, which connects with it through the `ai-gateway-auth.<token>`
   * subprotocol. `expiresAfterSeconds` is forwarded to the mint endpoint;
   * `sessionConfig` is intentionally unused here — it is applied later via the
   * normalized `session-update` event.
   */
  async doCreateClientSecret(options) {
    const secret = await this.config.createClientSecret({
      modelId: this.modelId,
      ...(options == null ? void 0 : options.expiresAfterSeconds) != null && {
        expiresAfterSeconds: options.expiresAfterSeconds
      }
    });
    return {
      token: secret.token,
      url: toGatewayRealtimeUrl(this.config.baseURL, this.modelId),
      ...secret.expiresAt != null && { expiresAt: secret.expiresAt }
    };
  }
  getWebSocketConfig(options) {
    return {
      url: options.url,
      protocols: getGatewayRealtimeProtocols(options.token, {
        teamIdOrSlug: this.config.teamIdOrSlug
      })
    };
  }
  parseServerEvent(raw) {
    return raw;
  }
  serializeClientEvent(event) {
    return event;
  }
  buildSessionConfig(config) {
    return config;
  }
};
function toGatewayRealtimeUrl(baseURL, modelId) {
  const url = new URL(`${baseURL.replace(/^http/, "ws")}/realtime-model`);
  url.searchParams.set("ai-model-id", modelId);
  return url.toString();
}

// src/tool/exa-search.ts
import {
  createProviderExecutedToolFactory,
  lazySchema as lazySchema10,
  zodSchema as zodSchema10
} from "@ai-sdk/provider-utils";
import { z as z15 } from "zod/v4";
var exaSearchInputSchema = lazySchema10(
  () => zodSchema10(
    z15.object({
      query: z15.string().describe("Natural-language web search query. This is required."),
      type: z15.enum(["auto", "fast", "instant"]).optional().describe(
        "Search method. Use auto for the default balance of speed and quality."
      ),
      num_results: z15.number().optional().describe("Maximum number of results to return (1-100, default: 10)."),
      category: z15.enum([
        "company",
        "people",
        "research paper",
        "news",
        "personal site",
        "financial report"
      ]).optional().describe("Optional content category to focus results."),
      user_location: z15.string().optional().describe("Two-letter ISO country code such as 'US'."),
      include_domains: z15.array(z15.string()).optional().describe("Only return results from these domains."),
      exclude_domains: z15.array(z15.string()).optional().describe("Exclude results from these domains."),
      start_published_date: z15.string().optional().describe("Only return links published after this ISO 8601 date."),
      end_published_date: z15.string().optional().describe("Only return links published before this ISO 8601 date."),
      contents: z15.object({
        text: z15.union([
          z15.boolean(),
          z15.object({
            max_characters: z15.number().optional(),
            include_html_tags: z15.boolean().optional(),
            verbosity: z15.enum(["compact", "standard", "full"]).optional(),
            include_sections: z15.array(
              z15.enum([
                "header",
                "navigation",
                "banner",
                "body",
                "sidebar",
                "footer",
                "metadata"
              ])
            ).optional(),
            exclude_sections: z15.array(
              z15.enum([
                "header",
                "navigation",
                "banner",
                "body",
                "sidebar",
                "footer",
                "metadata"
              ])
            ).optional()
          })
        ]).optional(),
        highlights: z15.union([
          z15.boolean(),
          z15.object({
            query: z15.string().optional(),
            max_characters: z15.number().optional()
          })
        ]).optional(),
        max_age_hours: z15.number().optional(),
        livecrawl_timeout: z15.number().optional(),
        subpages: z15.number().optional(),
        subpage_target: z15.union([z15.string(), z15.array(z15.string())]).optional(),
        extras: z15.object({
          links: z15.number().optional(),
          image_links: z15.number().optional()
        }).optional()
      }).optional().describe("Controls extracted page content and freshness.")
    })
  )
);
var exaSearchOutputSchema = lazySchema10(
  () => zodSchema10(
    z15.union([
      z15.object({
        requestId: z15.string(),
        searchType: z15.string().optional(),
        resolvedSearchType: z15.string().optional(),
        results: z15.array(
          z15.object({
            title: z15.string(),
            url: z15.string(),
            id: z15.string(),
            publishedDate: z15.string().nullable().optional(),
            author: z15.string().nullable().optional(),
            image: z15.string().nullable().optional(),
            favicon: z15.string().nullable().optional(),
            text: z15.string().optional(),
            highlights: z15.array(z15.string()).optional(),
            highlightScores: z15.array(z15.number()).optional(),
            summary: z15.string().optional(),
            subpages: z15.array(z15.any()).optional(),
            extras: z15.object({
              links: z15.array(z15.string()).optional(),
              imageLinks: z15.array(z15.string()).optional()
            }).optional()
          })
        ),
        costDollars: z15.object({
          total: z15.number().optional(),
          search: z15.record(z15.string(), z15.number()).optional()
        }).optional()
      }),
      z15.object({
        error: z15.enum([
          "api_error",
          "rate_limit",
          "timeout",
          "invalid_input",
          "configuration_error",
          "execution_error",
          "unknown"
        ]),
        statusCode: z15.number().optional(),
        message: z15.string()
      })
    ])
  )
);
var exaSearchToolFactory = createProviderExecutedToolFactory({
  id: "gateway.exa_search",
  inputSchema: exaSearchInputSchema,
  outputSchema: exaSearchOutputSchema
});
var exaSearch = (config = {}) => exaSearchToolFactory(config);

// src/tool/parallel-search.ts
import {
  createProviderExecutedToolFactory as createProviderExecutedToolFactory2,
  lazySchema as lazySchema11,
  zodSchema as zodSchema11
} from "@ai-sdk/provider-utils";
import { z as z16 } from "zod/v4";
var parallelSearchInputSchema = lazySchema11(
  () => zodSchema11(
    z16.object({
      objective: z16.string().describe(
        "Natural-language description of the web research goal, including source or freshness guidance and broader context from the task. Maximum 5000 characters."
      ),
      search_queries: z16.array(z16.string()).optional().describe(
        "Optional search queries to supplement the objective. Maximum 200 characters per query."
      ),
      mode: z16.enum(["one-shot", "agentic"]).optional().describe(
        'Mode preset: "one-shot" for comprehensive results with longer excerpts (default), "agentic" for concise, token-efficient results for multi-step workflows.'
      ),
      max_results: z16.number().optional().describe(
        "Maximum number of results to return (1-20). Defaults to 10 if not specified."
      ),
      source_policy: z16.object({
        include_domains: z16.array(z16.string()).optional().describe(
          "Limit results to these domains. Use plain domain names only \u2014 e.g. example.com or sub.example.gov, or a bare extension like .edu. Do not include a scheme, path, or port (e.g. not https://example.com/page)."
        ),
        exclude_domains: z16.array(z16.string()).optional().describe(
          "Exclude results from these domains. Use plain domain names only \u2014 e.g. example.com or sub.example.gov, or a bare extension like .edu. Do not include a scheme, path, or port (e.g. not https://example.com/page)."
        ),
        after_date: z16.string().optional().describe(
          "Only include results published after this date. Use an ISO 8601 calendar date formatted YYYY-MM-DD (e.g. 2025-01-01); do not include a time."
        )
      }).optional().describe(
        "Source policy for controlling which domains to include/exclude and freshness."
      ),
      excerpts: z16.object({
        max_chars_per_result: z16.number().optional().describe("Maximum characters per result."),
        max_chars_total: z16.number().optional().describe("Maximum total characters across all results.")
      }).optional().describe("Excerpt configuration for controlling result length."),
      fetch_policy: z16.object({
        max_age_seconds: z16.number().optional().describe(
          "Maximum age in seconds for cached content. Set to 0 to always fetch fresh content."
        )
      }).optional().describe("Fetch policy for controlling content freshness.")
    })
  )
);
var parallelSearchOutputSchema = lazySchema11(
  () => zodSchema11(
    z16.union([
      // Success response
      z16.object({
        searchId: z16.string(),
        results: z16.array(
          z16.object({
            url: z16.string(),
            title: z16.string(),
            excerpt: z16.string(),
            publishDate: z16.string().nullable().optional(),
            relevanceScore: z16.number().optional()
          })
        )
      }),
      // Error response
      z16.object({
        error: z16.enum([
          "api_error",
          "rate_limit",
          "timeout",
          "invalid_input",
          "configuration_error",
          "unknown"
        ]),
        statusCode: z16.number().optional(),
        message: z16.string()
      })
    ])
  )
);
var parallelSearchToolFactory = createProviderExecutedToolFactory2({
  id: "gateway.parallel_search",
  inputSchema: parallelSearchInputSchema,
  outputSchema: parallelSearchOutputSchema
});
var parallelSearch = (config = {}) => parallelSearchToolFactory(config);

// src/tool/perplexity-search.ts
import {
  createProviderExecutedToolFactory as createProviderExecutedToolFactory3,
  lazySchema as lazySchema12,
  zodSchema as zodSchema12
} from "@ai-sdk/provider-utils";
import { z as z17 } from "zod/v4";
var perplexitySearchInputSchema = lazySchema12(
  () => zodSchema12(
    z17.object({
      query: z17.union([z17.string(), z17.array(z17.string())]).describe(
        "Search query (string) or multiple queries (array of up to 5 strings). Multi-query searches return combined results from all queries."
      ),
      max_results: z17.number().optional().describe(
        "Maximum number of search results to return (1-20, default: 10)"
      ),
      max_tokens_per_page: z17.number().optional().describe(
        "Maximum number of tokens to extract per search result page (256-2048, default: 2048)"
      ),
      max_tokens: z17.number().optional().describe(
        "Maximum total tokens across all search results (default: 25000, max: 1000000)"
      ),
      country: z17.string().optional().describe(
        "Two-letter ISO 3166-1 alpha-2 country code for regional search results (e.g., 'US', 'GB', 'FR')"
      ),
      search_domain_filter: z17.array(z17.string()).optional().describe(
        "List of domains to include or exclude from search results (max 20). To include: ['nature.com', 'science.org']. To exclude: ['-example.com', '-spam.net']"
      ),
      search_language_filter: z17.array(z17.string()).optional().describe(
        "List of ISO 639-1 language codes to filter results (max 10, lowercase). Examples: ['en', 'fr', 'de']"
      ),
      search_after_date: z17.string().optional().describe(
        "Include only results published after this date. Format: 'MM/DD/YYYY' (e.g., '3/1/2025'). Cannot be used with search_recency_filter."
      ),
      search_before_date: z17.string().optional().describe(
        "Include only results published before this date. Format: 'MM/DD/YYYY' (e.g., '3/15/2025'). Cannot be used with search_recency_filter."
      ),
      last_updated_after_filter: z17.string().optional().describe(
        "Include only results last updated after this date. Format: 'MM/DD/YYYY' (e.g., '3/1/2025'). Cannot be used with search_recency_filter."
      ),
      last_updated_before_filter: z17.string().optional().describe(
        "Include only results last updated before this date. Format: 'MM/DD/YYYY' (e.g., '3/15/2025'). Cannot be used with search_recency_filter."
      ),
      search_recency_filter: z17.enum(["day", "week", "month", "year"]).optional().describe(
        "Filter results by relative time period. Cannot be used with search_after_date or search_before_date."
      )
    })
  )
);
var perplexitySearchOutputSchema = lazySchema12(
  () => zodSchema12(
    z17.union([
      // Success response
      z17.object({
        results: z17.array(
          z17.object({
            title: z17.string(),
            url: z17.string(),
            snippet: z17.string(),
            date: z17.string().optional(),
            lastUpdated: z17.string().optional()
          })
        ),
        id: z17.string()
      }),
      // Error response
      z17.object({
        error: z17.enum([
          "api_error",
          "rate_limit",
          "timeout",
          "invalid_input",
          "unknown"
        ]),
        statusCode: z17.number().optional(),
        message: z17.string()
      })
    ])
  )
);
var perplexitySearchToolFactory = createProviderExecutedToolFactory3({
  id: "gateway.perplexity_search",
  inputSchema: perplexitySearchInputSchema,
  outputSchema: perplexitySearchOutputSchema
});
var perplexitySearch = (config = {}) => perplexitySearchToolFactory(config);

// src/gateway-tools.ts
var gatewayTools = {
  /**
   * Search the web using Exa for current information and token-efficient
   * excerpts optimized for agent workflows.
   *
   * Supports search type, category, domain, date, location, and content
   * extraction controls.
   */
  exaSearch,
  /**
   * Search the web using Parallel AI's Search API for LLM-optimized excerpts.
   *
   * Takes a natural language objective and returns relevant excerpts,
   * replacing multiple keyword searches with a single call for broad
   * or complex queries. Supports different search types for depth vs
   * breadth tradeoffs.
   */
  parallelSearch,
  /**
   * Search the web using Perplexity's Search API for real-time information,
   * news, research papers, and articles.
   *
   * Provides ranked search results with advanced filtering options including
   * domain, language, date range, and recency filters.
   */
  perplexitySearch
};

// src/vercel-environment.ts
import { getContext } from "@vercel/oidc";
import { getVercelOidcToken } from "@vercel/oidc";
async function getVercelRequestId() {
  var _a11;
  return (_a11 = getContext().headers) == null ? void 0 : _a11["x-vercel-id"];
}

// src/version.ts
var VERSION = true ? "4.0.28" : "0.0.0-test";

// src/gateway-provider.ts
var AI_GATEWAY_PROTOCOL_VERSION = "0.0.1";
var gatewayClientSecretResponseSchema = z18.object({
  token: z18.string(),
  expiresAt: z18.number().nullish()
});
function createGateway(options = {}) {
  var _a11, _b11;
  let pendingMetadata = null;
  let metadataCache = null;
  const cacheRefreshMillis = (_a11 = options.metadataCacheRefreshMillis) != null ? _a11 : 1e3 * 60 * 5;
  let lastFetchTime = 0;
  const baseURL = (_b11 = withoutTrailingSlash(options.baseURL)) != null ? _b11 : "https://ai-gateway.vercel.sh/v4/ai";
  const createAuthHeaders = (auth) => withUserAgentSuffix(
    {
      Authorization: `Bearer ${auth.token}`,
      "ai-gateway-protocol-version": AI_GATEWAY_PROTOCOL_VERSION,
      [GATEWAY_AUTH_METHOD_HEADER]: auth.authMethod,
      ...options.teamIdOrSlug != null ? { [VERCEL_AI_GATEWAY_TEAM_HEADER]: options.teamIdOrSlug } : {},
      ...options.headers
    },
    `ai-sdk/gateway/${VERSION}`
  );
  const getHeaders = async () => {
    try {
      return createAuthHeaders(await getGatewayAuthToken(options));
    } catch (error) {
      throw GatewayAuthenticationError.createContextualError({
        apiKeyProvided: false,
        oidcTokenProvided: false,
        statusCode: 401,
        cause: error
      });
    }
  };
  const getRealtimeAuthToken = async () => {
    try {
      return await getGatewayAuthToken(options);
    } catch (error) {
      throw GatewayAuthenticationError.createContextualError({
        apiKeyProvided: false,
        oidcTokenProvided: false,
        statusCode: 401,
        cause: error
      });
    }
  };
  const mintClientSecret = async (params) => {
    assertGatewayClientSecretServerEnvironment();
    const auth = await getRealtimeAuthToken();
    const headers = createAuthHeaders(auth);
    const url = new URL("/v1/realtime/client-secrets", baseURL).toString();
    try {
      const { value } = await postJsonToApi8({
        url,
        headers,
        body: {
          model: params.modelId,
          ...params.routeKind != null && { routeKind: params.routeKind },
          ...params.expiresAfterSeconds != null && {
            expiresIn: params.expiresAfterSeconds
          }
        },
        successfulResponseHandler: createJsonResponseHandler10(
          gatewayClientSecretResponseSchema
        ),
        failedResponseHandler: createJsonErrorResponseHandler11({
          errorSchema: z18.any(),
          errorToMessage: (data) => data
        }),
        fetch: options.fetch
      });
      return {
        token: value.token,
        ...value.expiresAt != null && { expiresAt: value.expiresAt }
      };
    } catch (error) {
      throw await asGatewayError(error, await parseAuthMethod(headers));
    }
  };
  const createO11yHeaders = () => {
    const deploymentId = loadOptionalSetting({
      settingValue: void 0,
      environmentVariableName: "VERCEL_DEPLOYMENT_ID"
    });
    const environment = loadOptionalSetting({
      settingValue: void 0,
      environmentVariableName: "VERCEL_ENV"
    });
    const region = loadOptionalSetting({
      settingValue: void 0,
      environmentVariableName: "VERCEL_REGION"
    });
    const projectId = loadOptionalSetting({
      settingValue: void 0,
      environmentVariableName: "VERCEL_PROJECT_ID"
    });
    return async () => {
      const requestId = await getVercelRequestId();
      return {
        ...deploymentId && { "ai-o11y-deployment-id": deploymentId },
        ...environment && { "ai-o11y-environment": environment },
        ...region && { "ai-o11y-region": region },
        ...requestId && { "ai-o11y-request-id": requestId },
        ...projectId && { "ai-o11y-project-id": projectId }
      };
    };
  };
  const createLanguageModel = (modelId) => {
    return new GatewayLanguageModel(modelId, {
      provider: "gateway",
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
      o11yHeaders: createO11yHeaders()
    });
  };
  const getAvailableModels = async () => {
    var _a12, _b12, _c;
    const now = (_c = (_b12 = (_a12 = options._internal) == null ? void 0 : _a12.currentDate) == null ? void 0 : _b12.call(_a12).getTime()) != null ? _c : Date.now();
    if (!pendingMetadata || now - lastFetchTime > cacheRefreshMillis) {
      lastFetchTime = now;
      pendingMetadata = new GatewayFetchMetadata({
        baseURL,
        headers: getHeaders,
        fetch: options.fetch
      }).getAvailableModels().then((metadata) => {
        metadataCache = metadata;
        return metadata;
      }).catch(async (error) => {
        throw await asGatewayError(
          error,
          await parseAuthMethod(await getHeaders())
        );
      });
    }
    return metadataCache ? Promise.resolve(metadataCache) : pendingMetadata;
  };
  const getCredits = async () => {
    return new GatewayFetchMetadata({
      baseURL,
      headers: getHeaders,
      fetch: options.fetch
    }).getCredits().catch(async (error) => {
      throw await asGatewayError(
        error,
        await parseAuthMethod(await getHeaders())
      );
    });
  };
  const getSpendReport = async (params) => {
    return new GatewaySpendReport({
      baseURL,
      headers: getHeaders,
      fetch: options.fetch
    }).getSpendReport(params).catch(async (error) => {
      throw await asGatewayError(
        error,
        await parseAuthMethod(await getHeaders())
      );
    });
  };
  const getGenerationInfo = async (params) => {
    return new GatewayGenerationInfoFetcher({
      baseURL,
      headers: getHeaders,
      fetch: options.fetch
    }).getGenerationInfo(params).catch(async (error) => {
      throw await asGatewayError(
        error,
        await parseAuthMethod(await getHeaders())
      );
    });
  };
  const provider = function(modelId) {
    if (new.target) {
      throw new Error(
        "The Gateway Provider model function cannot be called with the new keyword."
      );
    }
    return createLanguageModel(modelId);
  };
  provider.specificationVersion = "v4";
  provider.getAvailableModels = getAvailableModels;
  provider.getCredits = getCredits;
  provider.getSpendReport = getSpendReport;
  provider.getGenerationInfo = getGenerationInfo;
  provider.imageModel = (modelId) => {
    return new GatewayImageModel(modelId, {
      provider: "gateway",
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
      o11yHeaders: createO11yHeaders()
    });
  };
  provider.languageModel = createLanguageModel;
  const createEmbeddingModel = (modelId) => {
    return new GatewayEmbeddingModel(modelId, {
      provider: "gateway",
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
      o11yHeaders: createO11yHeaders()
    });
  };
  provider.embeddingModel = createEmbeddingModel;
  provider.textEmbeddingModel = createEmbeddingModel;
  provider.videoModel = (modelId) => {
    return new GatewayVideoModel(modelId, {
      provider: "gateway",
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
      o11yHeaders: createO11yHeaders()
    });
  };
  const createRerankingModel = (modelId) => {
    return new GatewayRerankingModel(modelId, {
      provider: "gateway",
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
      o11yHeaders: createO11yHeaders()
    });
  };
  provider.rerankingModel = createRerankingModel;
  provider.reranking = createRerankingModel;
  const createSpeechModel = (modelId) => {
    return new GatewaySpeechModel(modelId, {
      provider: "gateway",
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
      o11yHeaders: createO11yHeaders()
    });
  };
  provider.speechModel = createSpeechModel;
  provider.speech = createSpeechModel;
  const createTranscriptionModel = (modelId) => {
    return new GatewayTranscriptionModel(modelId, {
      provider: "gateway",
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
      o11yHeaders: createO11yHeaders(),
      webSocket: options.webSocket
    });
  };
  provider.transcriptionModel = createTranscriptionModel;
  provider.transcription = createTranscriptionModel;
  provider.experimental_transcription = Object.assign(
    (modelId) => createTranscriptionModel(modelId),
    {
      getToken: async (tokenOptions) => {
        const secret = await mintClientSecret({
          modelId: tokenOptions.model,
          routeKind: "transcription",
          ...tokenOptions.expiresAfterSeconds != null && {
            expiresAfterSeconds: tokenOptions.expiresAfterSeconds
          }
        });
        return {
          token: secret.token,
          url: toGatewayTranscriptionUrl(baseURL, tokenOptions.model),
          ...secret.expiresAt != null && { expiresAt: secret.expiresAt }
        };
      }
    }
  );
  const createRealtimeModel = (modelId) => new GatewayRealtimeModel(modelId, {
    provider: "gateway.realtime",
    baseURL,
    teamIdOrSlug: options.teamIdOrSlug,
    createClientSecret: mintClientSecret
  });
  provider.experimental_realtime = Object.assign(
    (modelId) => createRealtimeModel(modelId),
    {
      getToken: async (tokenOptions) => {
        const { model: modelId, ...secretOptions } = tokenOptions;
        const model = createRealtimeModel(modelId);
        const secret = await model.doCreateClientSecret(secretOptions);
        return {
          token: secret.token,
          url: secret.url,
          ...secret.expiresAt != null && { expiresAt: secret.expiresAt }
        };
      }
    }
  );
  provider.chat = provider.languageModel;
  provider.embedding = provider.embeddingModel;
  provider.image = provider.imageModel;
  provider.video = provider.videoModel;
  provider.tools = gatewayTools;
  return provider;
}
var gateway = createGateway();
async function getGatewayAuthToken(options) {
  const apiKey = loadOptionalSetting({
    settingValue: options.apiKey,
    environmentVariableName: "AI_GATEWAY_API_KEY"
  });
  if (apiKey) {
    return {
      token: apiKey,
      authMethod: "api-key"
    };
  }
  const oidcToken = await getVercelOidcToken();
  return {
    token: oidcToken,
    authMethod: "oidc"
  };
}
function assertGatewayClientSecretServerEnvironment() {
  if (typeof globalThis.window !== "undefined") {
    throw new Error(
      "AI Gateway client secrets must be minted server-side: minting needs your Gateway credential, which must never reach the browser. Call gateway.experimental_realtime.getToken() or gateway.experimental_transcription.getToken() from your server and pass the returned token to the client."
    );
  }
}
export {
  GATEWAY_AUTH_SUBPROTOCOL_PREFIX,
  GATEWAY_REALTIME_SUBPROTOCOL,
  GATEWAY_TEAM_SUBPROTOCOL_PREFIX,
  GATEWAY_TRANSCRIPTION_SUBPROTOCOL,
  GatewayAuthenticationError,
  GatewayError,
  GatewayFailedDependencyError,
  GatewayForbiddenError,
  GatewayInternalServerError,
  GatewayInvalidRequestError,
  GatewayModelNotFoundError,
  GatewayRateLimitError,
  GatewayResponseError,
  VERSION,
  createGateway,
  createGateway as createGatewayProvider,
  gateway,
  getGatewayRealtimeAuthToken,
  getGatewayRealtimeProtocols,
  getGatewayRealtimeTeamIdOrSlug,
  getGatewayTranscriptionProtocols
};
//# sourceMappingURL=index.js.map