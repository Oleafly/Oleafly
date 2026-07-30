var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name22 in all)
    __defProp(target, name22, { get: all[name22], enumerable: true });
};

// src/index.ts
import { createGateway, gateway as gateway2 } from "@ai-sdk/gateway";
import {
  asSchema as asSchema8,
  createIdGenerator as createIdGenerator9,
  dynamicTool,
  generateId,
  jsonSchema,
  parseJsonEventStream as parseJsonEventStream3,
  tool,
  zodSchema as zodSchema3
} from "@ai-sdk/provider-utils";

// src/agent/tool-loop-agent.ts
import {
  validateTypes as validateTypes3,
  withUserAgentSuffix as withUserAgentSuffix3
} from "@ai-sdk/provider-utils";

// src/generate-text/generate-text.ts
import {
  asArray as asArray5,
  createIdGenerator,
  getErrorMessage as getErrorMessage4,
  withUserAgentSuffix as withUserAgentSuffix2
} from "@ai-sdk/provider-utils";

// src/error/index.ts
import {
  AISDKError as AISDKError22,
  APICallError,
  EmptyResponseBodyError,
  InvalidPromptError,
  InvalidResponseDataError,
  JSONParseError,
  LoadAPIKeyError,
  LoadSettingError,
  NoContentGeneratedError,
  NoSuchModelError,
  NoSuchProviderReferenceError,
  TooManyEmbeddingValuesForCallError,
  TypeValidationError,
  UnsupportedFunctionalityError
} from "@ai-sdk/provider";

// src/error/invalid-argument-error.ts
import { AISDKError } from "@ai-sdk/provider";
var name = "AI_InvalidArgumentError";
var marker = `vercel.ai.error.${name}`;
var symbol = Symbol.for(marker);
var _a;
var InvalidArgumentError = class extends AISDKError {
  constructor({
    parameter,
    value,
    message
  }) {
    super({
      name,
      message: `Invalid argument for parameter ${parameter}: ${message}`
    });
    this[_a] = true;
    this.parameter = parameter;
    this.value = value;
  }
  static isInstance(error) {
    return AISDKError.hasMarker(error, marker);
  }
};
_a = symbol;

// src/error/invalid-stream-part-error.ts
import { AISDKError as AISDKError2 } from "@ai-sdk/provider";
var name2 = "AI_InvalidStreamPartError";
var marker2 = `vercel.ai.error.${name2}`;
var symbol2 = Symbol.for(marker2);
var _a2;
var InvalidStreamPartError = class extends AISDKError2 {
  constructor({
    chunk,
    message
  }) {
    super({ name: name2, message });
    this[_a2] = true;
    this.chunk = chunk;
  }
  static isInstance(error) {
    return AISDKError2.hasMarker(error, marker2);
  }
};
_a2 = symbol2;

// src/error/invalid-tool-approval-error.ts
import { AISDKError as AISDKError3 } from "@ai-sdk/provider";
var name3 = "AI_InvalidToolApprovalError";
var marker3 = `vercel.ai.error.${name3}`;
var symbol3 = Symbol.for(marker3);
var _a3;
var InvalidToolApprovalError = class extends AISDKError3 {
  constructor({ approvalId }) {
    super({
      name: name3,
      message: `Tool approval response references unknown approvalId: "${approvalId}". No matching tool-approval-request found in message history.`
    });
    this[_a3] = true;
    this.approvalId = approvalId;
  }
  static isInstance(error) {
    return AISDKError3.hasMarker(error, marker3);
  }
};
_a3 = symbol3;

// src/error/invalid-tool-approval-signature-error.ts
import { AISDKError as AISDKError4 } from "@ai-sdk/provider";
var name4 = "AI_InvalidToolApprovalSignatureError";
var marker4 = `vercel.ai.error.${name4}`;
var symbol4 = Symbol.for(marker4);
var _a4;
var InvalidToolApprovalSignatureError = class extends AISDKError4 {
  constructor({
    approvalId,
    toolCallId,
    reason
  }) {
    super({
      name: name4,
      message: `Tool approval signature verification failed for approval "${approvalId}" (tool call "${toolCallId}"): ${reason}`
    });
    this[_a4] = true;
    this.approvalId = approvalId;
    this.toolCallId = toolCallId;
  }
  static isInstance(error) {
    return AISDKError4.hasMarker(error, marker4);
  }
};
_a4 = symbol4;

// src/error/invalid-tool-input-error.ts
import { AISDKError as AISDKError5, getErrorMessage } from "@ai-sdk/provider";
var name5 = "AI_InvalidToolInputError";
var marker5 = `vercel.ai.error.${name5}`;
var symbol5 = Symbol.for(marker5);
var _a5;
var InvalidToolInputError = class extends AISDKError5 {
  constructor({
    toolInput,
    toolName,
    cause,
    message = `Invalid input for tool ${toolName}: ${getErrorMessage(cause)}`
  }) {
    super({ name: name5, message, cause });
    this[_a5] = true;
    this.toolInput = toolInput;
    this.toolName = toolName;
  }
  static isInstance(error) {
    return AISDKError5.hasMarker(error, marker5);
  }
};
_a5 = symbol5;

// src/error/tool-call-not-found-for-approval-error.ts
import { AISDKError as AISDKError6 } from "@ai-sdk/provider";
var name6 = "AI_ToolCallNotFoundForApprovalError";
var marker6 = `vercel.ai.error.${name6}`;
var symbol6 = Symbol.for(marker6);
var _a6;
var ToolCallNotFoundForApprovalError = class extends AISDKError6 {
  constructor({
    toolCallId,
    approvalId
  }) {
    super({
      name: name6,
      message: `Tool call "${toolCallId}" not found for approval request "${approvalId}".`
    });
    this[_a6] = true;
    this.toolCallId = toolCallId;
    this.approvalId = approvalId;
  }
  static isInstance(error) {
    return AISDKError6.hasMarker(error, marker6);
  }
};
_a6 = symbol6;

// src/error/missing-tool-result-error.ts
import { AISDKError as AISDKError7 } from "@ai-sdk/provider";
var name7 = "AI_MissingToolResultsError";
var marker7 = `vercel.ai.error.${name7}`;
var symbol7 = Symbol.for(marker7);
var _a7;
var MissingToolResultsError = class extends AISDKError7 {
  constructor({ toolCallIds }) {
    super({
      name: name7,
      message: `Tool result${toolCallIds.length > 1 ? "s are" : " is"} missing for tool call${toolCallIds.length > 1 ? "s" : ""} ${toolCallIds.join(
        ", "
      )}.`
    });
    this[_a7] = true;
    this.toolCallIds = toolCallIds;
  }
  static isInstance(error) {
    return AISDKError7.hasMarker(error, marker7);
  }
};
_a7 = symbol7;

// src/error/no-image-generated-error.ts
import { AISDKError as AISDKError8 } from "@ai-sdk/provider";
var name8 = "AI_NoImageGeneratedError";
var marker8 = `vercel.ai.error.${name8}`;
var symbol8 = Symbol.for(marker8);
var _a8;
var NoImageGeneratedError = class extends AISDKError8 {
  constructor({
    message = "No image generated.",
    cause,
    responses
  }) {
    super({ name: name8, message, cause });
    this[_a8] = true;
    this.responses = responses;
  }
  static isInstance(error) {
    return AISDKError8.hasMarker(error, marker8);
  }
};
_a8 = symbol8;

// src/error/no-object-generated-error.ts
import { AISDKError as AISDKError9 } from "@ai-sdk/provider";
var name9 = "AI_NoObjectGeneratedError";
var marker9 = `vercel.ai.error.${name9}`;
var symbol9 = Symbol.for(marker9);
var _a9;
var NoObjectGeneratedError = class extends AISDKError9 {
  constructor({
    message = "No object generated.",
    cause,
    text: text2,
    response,
    usage,
    finishReason
  }) {
    super({ name: name9, message, cause });
    this[_a9] = true;
    this.text = text2;
    this.response = response;
    this.usage = usage;
    this.finishReason = finishReason;
  }
  static isInstance(error) {
    return AISDKError9.hasMarker(error, marker9);
  }
};
_a9 = symbol9;

// src/error/no-output-generated-error.ts
import { AISDKError as AISDKError10 } from "@ai-sdk/provider";
var name10 = "AI_NoOutputGeneratedError";
var marker10 = `vercel.ai.error.${name10}`;
var symbol10 = Symbol.for(marker10);
var _a10;
var NoOutputGeneratedError = class extends AISDKError10 {
  // used in isInstance
  constructor({
    message = "No output generated.",
    cause
  } = {}) {
    super({ name: name10, message, cause });
    this[_a10] = true;
  }
  static isInstance(error) {
    return AISDKError10.hasMarker(error, marker10);
  }
};
_a10 = symbol10;

// src/error/no-speech-generated-error.ts
import { AISDKError as AISDKError11 } from "@ai-sdk/provider";
var name11 = "AI_NoSpeechGeneratedError";
var marker11 = `vercel.ai.error.${name11}`;
var symbol11 = Symbol.for(marker11);
var _a11;
var NoSpeechGeneratedError = class extends AISDKError11 {
  constructor(options) {
    super({
      name: name11,
      message: "No speech audio generated."
    });
    this[_a11] = true;
    this.responses = options.responses;
  }
  static isInstance(error) {
    return AISDKError11.hasMarker(error, marker11);
  }
};
_a11 = symbol11;

// src/error/no-transcript-generated-error.ts
import { AISDKError as AISDKError12 } from "@ai-sdk/provider";
var name12 = "AI_NoTranscriptGeneratedError";
var marker12 = `vercel.ai.error.${name12}`;
var symbol12 = Symbol.for(marker12);
var _a12;
var NoTranscriptGeneratedError = class extends AISDKError12 {
  constructor(options) {
    super({
      name: name12,
      message: "No transcript generated."
    });
    this[_a12] = true;
    this.responses = options.responses;
  }
  static isInstance(error) {
    return AISDKError12.hasMarker(error, marker12);
  }
};
_a12 = symbol12;

// src/error/no-video-generated-error.ts
import { AISDKError as AISDKError13 } from "@ai-sdk/provider";
var name13 = "AI_NoVideoGeneratedError";
var marker13 = `vercel.ai.error.${name13}`;
var symbol13 = Symbol.for(marker13);
var _a13;
var NoVideoGeneratedError = class extends AISDKError13 {
  constructor({
    message = "No video generated.",
    cause,
    responses
  }) {
    super({ name: name13, message, cause });
    this[_a13] = true;
    this.responses = responses;
  }
  static isInstance(error) {
    return AISDKError13.hasMarker(error, marker13);
  }
  /**
   * @deprecated use `isInstance` instead
   */
  static isNoVideoGeneratedError(error) {
    return error instanceof Error && error.name === name13 && typeof error.responses !== "undefined" ? true : false;
  }
  /**
   * @deprecated Do not use this method. It will be removed in the next major version.
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      stack: this.stack,
      cause: this.cause,
      responses: this.responses
    };
  }
};
_a13 = symbol13;

// src/error/no-such-tool-error.ts
import { AISDKError as AISDKError14 } from "@ai-sdk/provider";
var name14 = "AI_NoSuchToolError";
var marker14 = `vercel.ai.error.${name14}`;
var symbol14 = Symbol.for(marker14);
var _a14;
var NoSuchToolError = class extends AISDKError14 {
  constructor({
    toolName,
    availableTools = void 0,
    message = `Model tried to call unavailable tool '${toolName}'. ${availableTools === void 0 ? "No tools are available." : `Available tools: ${availableTools.join(", ")}.`}`
  }) {
    super({ name: name14, message });
    this[_a14] = true;
    this.toolName = toolName;
    this.availableTools = availableTools;
  }
  static isInstance(error) {
    return AISDKError14.hasMarker(error, marker14);
  }
};
_a14 = symbol14;

// src/error/tool-call-repair-error.ts
import { AISDKError as AISDKError15, getErrorMessage as getErrorMessage2 } from "@ai-sdk/provider";
var name15 = "AI_ToolCallRepairError";
var marker15 = `vercel.ai.error.${name15}`;
var symbol15 = Symbol.for(marker15);
var _a15;
var ToolCallRepairError = class extends AISDKError15 {
  constructor({
    cause,
    originalError,
    message = `Error repairing tool call: ${getErrorMessage2(cause)}`
  }) {
    super({ name: name15, message, cause });
    this[_a15] = true;
    this.originalError = originalError;
  }
  static isInstance(error) {
    return AISDKError15.hasMarker(error, marker15);
  }
};
_a15 = symbol15;

// src/error/unsupported-model-version-error.ts
import { AISDKError as AISDKError16 } from "@ai-sdk/provider";
var UnsupportedModelVersionError = class extends AISDKError16 {
  constructor(options) {
    super({
      name: "AI_UnsupportedModelVersionError",
      message: `Unsupported model version ${options.version} for provider "${options.provider}" and model "${options.modelId}". AI SDK 5 only supports models that implement specification version "v2".`
    });
    this.version = options.version;
    this.provider = options.provider;
    this.modelId = options.modelId;
  }
};

// src/error/ui-message-stream-error.ts
import { AISDKError as AISDKError17 } from "@ai-sdk/provider";
var name16 = "AI_UIMessageStreamError";
var marker16 = `vercel.ai.error.${name16}`;
var symbol16 = Symbol.for(marker16);
var _a16;
var UIMessageStreamError = class extends AISDKError17 {
  constructor({
    chunkType,
    chunkId,
    message
  }) {
    super({ name: name16, message });
    this[_a16] = true;
    this.chunkType = chunkType;
    this.chunkId = chunkId;
  }
  static isInstance(error) {
    return AISDKError17.hasMarker(error, marker16);
  }
};
_a16 = symbol16;

// src/prompt/invalid-data-content-error.ts
import { AISDKError as AISDKError18 } from "@ai-sdk/provider";
var name17 = "AI_InvalidDataContentError";
var marker17 = `vercel.ai.error.${name17}`;
var symbol17 = Symbol.for(marker17);
var _a17;
var InvalidDataContentError = class extends AISDKError18 {
  constructor({
    content,
    cause,
    message = `Invalid data content. Expected a base64 string, Uint8Array, ArrayBuffer, or Buffer, but got ${typeof content}.`
  }) {
    super({ name: name17, message, cause });
    this[_a17] = true;
    this.content = content;
  }
  static isInstance(error) {
    return AISDKError18.hasMarker(error, marker17);
  }
};
_a17 = symbol17;

// src/prompt/invalid-message-role-error.ts
import { AISDKError as AISDKError19 } from "@ai-sdk/provider";
var name18 = "AI_InvalidMessageRoleError";
var marker18 = `vercel.ai.error.${name18}`;
var symbol18 = Symbol.for(marker18);
var _a18;
var InvalidMessageRoleError = class extends AISDKError19 {
  constructor({
    role,
    message = `Invalid message role: '${role}'. Must be one of: "system", "user", "assistant", "tool".`
  }) {
    super({ name: name18, message });
    this[_a18] = true;
    this.role = role;
  }
  static isInstance(error) {
    return AISDKError19.hasMarker(error, marker18);
  }
};
_a18 = symbol18;

// src/prompt/message-conversion-error.ts
import { AISDKError as AISDKError20 } from "@ai-sdk/provider";
var name19 = "AI_MessageConversionError";
var marker19 = `vercel.ai.error.${name19}`;
var symbol19 = Symbol.for(marker19);
var _a19;
var MessageConversionError = class extends AISDKError20 {
  constructor({
    originalMessage,
    message
  }) {
    super({ name: name19, message });
    this[_a19] = true;
    this.originalMessage = originalMessage;
  }
  static isInstance(error) {
    return AISDKError20.hasMarker(error, marker19);
  }
};
_a19 = symbol19;

// src/error/index.ts
import { DownloadError } from "@ai-sdk/provider-utils";

// src/util/retry-error.ts
import { AISDKError as AISDKError21 } from "@ai-sdk/provider";
var name20 = "AI_RetryError";
var marker20 = `vercel.ai.error.${name20}`;
var symbol20 = Symbol.for(marker20);
var _a20;
var RetryError = class extends AISDKError21 {
  constructor({
    message,
    reason,
    errors
  }) {
    super({ name: name20, message });
    this[_a20] = true;
    this.reason = reason;
    this.errors = errors;
    this.lastError = errors[errors.length - 1];
  }
  static isInstance(error) {
    return AISDKError21.hasMarker(error, marker20);
  }
};
_a20 = symbol20;

// src/logger/log-warnings.ts
function formatWarning({
  warning,
  provider,
  model
}) {
  const scope = provider != null && model != null ? ` (${provider} / ${model})` : "";
  const prefix = `AI SDK Warning${scope}:`;
  switch (warning.type) {
    case "unsupported": {
      let message = `${prefix} The feature "${warning.feature}" is not supported.`;
      if (warning.details) {
        message += ` ${warning.details}`;
      }
      return message;
    }
    case "compatibility": {
      let message = `${prefix} The feature "${warning.feature}" is used in a compatibility mode.`;
      if (warning.details) {
        message += ` ${warning.details}`;
      }
      return message;
    }
    case "deprecated": {
      return `${prefix} Deprecated: "${warning.setting}". ${warning.message}`;
    }
    case "other": {
      return `${prefix} ${warning.message}`;
    }
    default: {
      return `${prefix} ${JSON.stringify(warning, null, 2)}`;
    }
  }
}
var FIRST_WARNING_INFO_MESSAGE = "AI SDK Warning System: To turn off warning logging, set the AI_SDK_LOG_WARNINGS global to false.";
var hasLoggedBefore = false;
var logWarnings = (options) => {
  if (options.warnings.length === 0) {
    return;
  }
  const logger = globalThis.AI_SDK_LOG_WARNINGS;
  if (logger === false) {
    return;
  }
  if (typeof logger === "function") {
    logger(options);
    return;
  }
  if (!hasLoggedBefore) {
    hasLoggedBefore = true;
    console.info(FIRST_WARNING_INFO_MESSAGE);
  }
  for (const warning of options.warnings) {
    const message = formatWarning({
      warning,
      provider: options.provider,
      model: options.model
    });
    if (typeof process !== "undefined" && typeof process.emitWarning === "function") {
      process.emitWarning(message, {
        type: warning.type === "deprecated" ? "DeprecationWarning" : "Warning"
      });
    } else {
      console.warn(message);
    }
  }
};

// src/model/resolve-model.ts
import { gateway } from "@ai-sdk/gateway";

// src/util/log-v2-compatibility-warning.ts
function logV2CompatibilityWarning({
  provider,
  modelId
}) {
  logWarnings({
    warnings: [
      {
        type: "compatibility",
        feature: "specificationVersion",
        details: `Using v2 specification compatibility mode. Some features may not be available.`
      }
    ],
    provider,
    model: modelId
  });
}

// src/model/as-embedding-model-v3.ts
function asEmbeddingModelV3(model) {
  if (model.specificationVersion === "v3") {
    return model;
  }
  logV2CompatibilityWarning({
    provider: model.provider,
    modelId: model.modelId
  });
  return new Proxy(model, {
    get(target, prop) {
      if (prop === "specificationVersion")
        return "v3";
      return target[prop];
    }
  });
}

// src/model/as-embedding-model-v4.ts
function asEmbeddingModelV4(model) {
  if (model.specificationVersion === "v4") {
    return model;
  }
  const v3Model = model.specificationVersion === "v2" ? asEmbeddingModelV3(model) : model;
  return new Proxy(v3Model, {
    get(target, prop) {
      if (prop === "specificationVersion")
        return "v4";
      return target[prop];
    }
  });
}

// src/model/as-image-model-v3.ts
function asImageModelV3(model) {
  if (model.specificationVersion === "v3") {
    return model;
  }
  logV2CompatibilityWarning({
    provider: model.provider,
    modelId: model.modelId
  });
  return new Proxy(model, {
    get(target, prop) {
      if (prop === "specificationVersion")
        return "v3";
      return target[prop];
    }
  });
}

// src/model/as-image-model-v4.ts
function asImageModelV4(model) {
  if (model.specificationVersion === "v4") {
    return model;
  }
  const v3Model = model.specificationVersion === "v2" ? asImageModelV3(model) : model;
  return new Proxy(v3Model, {
    get(target, prop) {
      if (prop === "specificationVersion")
        return "v4";
      return target[prop];
    }
  });
}

// src/model/as-language-model-v3.ts
function asLanguageModelV3(model) {
  if (model.specificationVersion === "v3") {
    return model;
  }
  logV2CompatibilityWarning({
    provider: model.provider,
    modelId: model.modelId
  });
  return new Proxy(model, {
    get(target, prop) {
      switch (prop) {
        case "specificationVersion":
          return "v3";
        case "doGenerate":
          return async (...args) => {
            const result = await target.doGenerate(...args);
            return {
              ...result,
              finishReason: convertV2FinishReasonToV3(result.finishReason),
              usage: convertV2UsageToV3(result.usage)
            };
          };
        case "doStream":
          return async (...args) => {
            const result = await target.doStream(...args);
            return {
              ...result,
              stream: convertV2StreamToV3(result.stream)
            };
          };
        default:
          return target[prop];
      }
    }
  });
}
function convertV2StreamToV3(stream) {
  return stream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        switch (chunk.type) {
          case "finish":
            controller.enqueue({
              ...chunk,
              finishReason: convertV2FinishReasonToV3(chunk.finishReason),
              usage: convertV2UsageToV3(chunk.usage)
            });
            break;
          default:
            controller.enqueue(chunk);
            break;
        }
      }
    })
  );
}
function convertV2FinishReasonToV3(finishReason) {
  return {
    unified: finishReason === "unknown" ? "other" : finishReason,
    raw: void 0
  };
}
function convertV2UsageToV3(usage) {
  return {
    inputTokens: {
      total: usage.inputTokens,
      noCache: void 0,
      cacheRead: usage.cachedInputTokens,
      cacheWrite: void 0
    },
    outputTokens: {
      total: usage.outputTokens,
      text: void 0,
      reasoning: usage.reasoningTokens
    }
  };
}

// src/model/as-language-model-v4.ts
function asLanguageModelV4(model) {
  if (model.specificationVersion === "v4") {
    return model;
  }
  const v3Model = model.specificationVersion === "v2" ? asLanguageModelV3(model) : model;
  return new Proxy(v3Model, {
    get(target, prop) {
      if (prop === "specificationVersion")
        return "v4";
      return target[prop];
    }
  });
}

// src/model/as-reranking-model-v4.ts
function asRerankingModelV4(model) {
  if (model.specificationVersion === "v4") {
    return model;
  }
  return new Proxy(model, {
    get(target, prop) {
      if (prop === "specificationVersion")
        return "v4";
      return target[prop];
    }
  });
}

// src/model/as-speech-model-v3.ts
function asSpeechModelV3(model) {
  if (model.specificationVersion === "v3") {
    return model;
  }
  logV2CompatibilityWarning({
    provider: model.provider,
    modelId: model.modelId
  });
  return new Proxy(model, {
    get(target, prop) {
      if (prop === "specificationVersion")
        return "v3";
      return target[prop];
    }
  });
}

// src/model/as-speech-model-v4.ts
function asSpeechModelV4(model) {
  if (model.specificationVersion === "v4") {
    return model;
  }
  const v3Model = model.specificationVersion === "v2" ? asSpeechModelV3(model) : model;
  return new Proxy(v3Model, {
    get(target, prop) {
      if (prop === "specificationVersion")
        return "v4";
      return target[prop];
    }
  });
}

// src/model/as-transcription-model-v3.ts
function asTranscriptionModelV3(model) {
  if (model.specificationVersion === "v3") {
    return model;
  }
  logV2CompatibilityWarning({
    provider: model.provider,
    modelId: model.modelId
  });
  return new Proxy(model, {
    get(target, prop) {
      if (prop === "specificationVersion")
        return "v3";
      return target[prop];
    }
  });
}

// src/model/as-transcription-model-v4.ts
function asTranscriptionModelV4(model) {
  if (model.specificationVersion === "v4") {
    return model;
  }
  const v3Model = model.specificationVersion === "v2" ? asTranscriptionModelV3(model) : model;
  return new Proxy(v3Model, {
    get(target, prop) {
      if (prop === "specificationVersion")
        return "v4";
      return target[prop];
    }
  });
}

// src/model/as-video-model-v4.ts
function asVideoModelV4(model) {
  if (model.specificationVersion === "v4") {
    return model;
  }
  return new Proxy(model, {
    get(target, prop) {
      if (prop === "specificationVersion")
        return "v4";
      return target[prop];
    }
  });
}

// src/model/as-provider-v3.ts
function asProviderV3(provider) {
  if ("specificationVersion" in provider && provider.specificationVersion === "v3") {
    return provider;
  }
  const v2Provider = provider;
  return {
    specificationVersion: "v3",
    languageModel: (modelId) => asLanguageModelV3(v2Provider.languageModel(modelId)),
    embeddingModel: (modelId) => asEmbeddingModelV3(v2Provider.textEmbeddingModel(modelId)),
    imageModel: (modelId) => asImageModelV3(v2Provider.imageModel(modelId)),
    transcriptionModel: v2Provider.transcriptionModel ? (modelId) => asTranscriptionModelV3(v2Provider.transcriptionModel(modelId)) : void 0,
    speechModel: v2Provider.speechModel ? (modelId) => asSpeechModelV3(v2Provider.speechModel(modelId)) : void 0,
    rerankingModel: void 0
    // v2 providers don't have reranking models
  };
}

// src/model/as-provider-v4.ts
function asProviderV4(provider) {
  if ("specificationVersion" in provider && provider.specificationVersion === "v4") {
    return provider;
  }
  const v3Provider = !("specificationVersion" in provider) || provider.specificationVersion !== "v3" ? asProviderV3(provider) : provider;
  return {
    specificationVersion: "v4",
    languageModel: (modelId) => asLanguageModelV4(v3Provider.languageModel(modelId)),
    embeddingModel: (modelId) => asEmbeddingModelV4(v3Provider.embeddingModel(modelId)),
    imageModel: (modelId) => asImageModelV4(v3Provider.imageModel(modelId)),
    transcriptionModel: v3Provider.transcriptionModel ? (modelId) => asTranscriptionModelV4(v3Provider.transcriptionModel(modelId)) : void 0,
    speechModel: v3Provider.speechModel ? (modelId) => asSpeechModelV4(v3Provider.speechModel(modelId)) : void 0,
    rerankingModel: v3Provider.rerankingModel ? (modelId) => asRerankingModelV4(v3Provider.rerankingModel(modelId)) : void 0
  };
}

// src/model/resolve-model.ts
function resolveLanguageModel(model) {
  if (typeof model === "string") {
    return getGlobalProvider().languageModel(model);
  }
  if (!["v4", "v3", "v2"].includes(model.specificationVersion)) {
    const unsupportedModel = model;
    throw new UnsupportedModelVersionError({
      version: unsupportedModel.specificationVersion,
      provider: unsupportedModel.provider,
      modelId: unsupportedModel.modelId
    });
  }
  return asLanguageModelV4(model);
}
function resolveEmbeddingModel(model) {
  if (typeof model === "string") {
    return getGlobalProvider().embeddingModel(model);
  }
  if (!["v4", "v3", "v2"].includes(model.specificationVersion)) {
    const unsupportedModel = model;
    throw new UnsupportedModelVersionError({
      version: unsupportedModel.specificationVersion,
      provider: unsupportedModel.provider,
      modelId: unsupportedModel.modelId
    });
  }
  return asEmbeddingModelV4(model);
}
function resolveTranscriptionModel(model) {
  var _a22, _b;
  if (typeof model === "string") {
    return (_b = (_a22 = getGlobalProvider()).transcriptionModel) == null ? void 0 : _b.call(_a22, model);
  }
  if (!["v4", "v3", "v2"].includes(model.specificationVersion)) {
    const unsupportedModel = model;
    throw new UnsupportedModelVersionError({
      version: unsupportedModel.specificationVersion,
      provider: unsupportedModel.provider,
      modelId: unsupportedModel.modelId
    });
  }
  return asTranscriptionModelV4(model);
}
function resolveSpeechModel(model) {
  var _a22, _b;
  if (typeof model === "string") {
    return (_b = (_a22 = getGlobalProvider()).speechModel) == null ? void 0 : _b.call(_a22, model);
  }
  if (!["v4", "v3", "v2"].includes(model.specificationVersion)) {
    const unsupportedModel = model;
    throw new UnsupportedModelVersionError({
      version: unsupportedModel.specificationVersion,
      provider: unsupportedModel.provider,
      modelId: unsupportedModel.modelId
    });
  }
  return asSpeechModelV4(model);
}
function resolveImageModel(model) {
  if (typeof model === "string") {
    return getGlobalProvider().imageModel(model);
  }
  if (!["v4", "v3", "v2"].includes(model.specificationVersion)) {
    const unsupportedModel = model;
    throw new UnsupportedModelVersionError({
      version: unsupportedModel.specificationVersion,
      provider: unsupportedModel.provider,
      modelId: unsupportedModel.modelId
    });
  }
  return asImageModelV4(model);
}
function resolveVideoModel(model) {
  var _a22;
  if (typeof model === "string") {
    const provider = (_a22 = globalThis.AI_SDK_DEFAULT_PROVIDER) != null ? _a22 : gateway;
    const videoModel = provider.videoModel;
    if (!videoModel) {
      throw new Error(
        'The default provider does not support video models. Please use a Experimental_VideoModelV4 object from a provider (e.g., vertex.video("model-id")).'
      );
    }
    return videoModel(model);
  }
  if (!["v4", "v3"].includes(model.specificationVersion)) {
    const unsupportedModel = model;
    throw new UnsupportedModelVersionError({
      version: unsupportedModel.specificationVersion,
      provider: unsupportedModel.provider,
      modelId: unsupportedModel.modelId
    });
  }
  return asVideoModelV4(model);
}
function resolveRerankingModel(model) {
  if (typeof model === "string") {
    const provider = getGlobalProvider();
    const rerankingModel = provider.rerankingModel;
    if (!rerankingModel) {
      throw new Error(
        'The default provider does not support reranking models. Please use a RerankingModel object from a provider (e.g., gateway.rerankingModel("model-id")).'
      );
    }
    return rerankingModel(model);
  }
  if (model.specificationVersion !== "v4" && model.specificationVersion !== "v3") {
    const unsupportedModel = model;
    throw new UnsupportedModelVersionError({
      version: unsupportedModel.specificationVersion,
      provider: unsupportedModel.provider,
      modelId: unsupportedModel.modelId
    });
  }
  return asRerankingModelV4(model);
}
function getGlobalProvider() {
  var _a22;
  const provider = (_a22 = globalThis.AI_SDK_DEFAULT_PROVIDER) != null ? _a22 : gateway;
  return asProviderV4(provider);
}

// src/prompt/clone-model-message.ts
function cloneModelMessages(messages) {
  return messages.map((message) => cloneValue(message));
}
function cloneValue(value) {
  if (value instanceof URL) {
    return new URL(value.href);
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }
  if (value instanceof Date) {
    return new Date(value);
  }
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, value2]) => [key, cloneValue(value2)])
    );
  }
  return value;
}

// src/prompt/convert-to-language-model-prompt.ts
import {
  asArray,
  detectMediaType,
  isFullMediaType,
  isUrlSupported
} from "@ai-sdk/provider-utils";

// src/util/download/download.ts
import {
  cancelResponseBody,
  DownloadError as DownloadError2,
  readResponseWithSizeLimit,
  DEFAULT_MAX_DOWNLOAD_SIZE,
  fetchWithValidatedRedirects,
  withUserAgentSuffix,
  getRuntimeEnvironmentUserAgent
} from "@ai-sdk/provider-utils";

// src/version.ts
var VERSION = true ? "7.0.37" : "0.0.0-test";

// src/util/download/download.ts
var download = async ({
  url,
  maxBytes,
  abortSignal
}) => {
  var _a22;
  const urlText = url.toString();
  try {
    const headers = withUserAgentSuffix(
      {},
      `ai-sdk/${VERSION}`,
      getRuntimeEnvironmentUserAgent()
    );
    const response = await fetchWithValidatedRedirects({
      url: urlText,
      headers,
      abortSignal
    });
    if (!response.ok) {
      await cancelResponseBody(response);
      throw new DownloadError2({
        url: urlText,
        statusCode: response.status,
        statusText: response.statusText
      });
    }
    const data = await readResponseWithSizeLimit({
      response,
      url: urlText,
      maxBytes: maxBytes != null ? maxBytes : DEFAULT_MAX_DOWNLOAD_SIZE
    });
    return {
      data,
      mediaType: (_a22 = response.headers.get("content-type")) != null ? _a22 : void 0
    };
  } catch (error) {
    if (DownloadError2.isInstance(error)) {
      throw error;
    }
    throw new DownloadError2({ url: urlText, cause: error });
  }
};

// src/util/download/download-function.ts
var createDefaultDownloadFunction = (download2 = download) => (requestedDownloads) => Promise.all(
  requestedDownloads.map(
    async (requestedDownload) => requestedDownload.isUrlSupportedByModel ? null : await download2(requestedDownload)
  )
);

// src/util/merge-objects.ts
function mergeObjects(base, overrides) {
  if (base === void 0 && overrides === void 0) {
    return void 0;
  }
  if (base === void 0) {
    return overrides;
  }
  if (overrides === void 0) {
    return base;
  }
  const result = { ...base };
  for (const key in overrides) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      const overridesValue = overrides[key];
      if (overridesValue === void 0)
        continue;
      const baseValue = key in base ? base[key] : void 0;
      const isSourceObject = overridesValue !== null && typeof overridesValue === "object" && !Array.isArray(overridesValue) && !(overridesValue instanceof Date) && !(overridesValue instanceof RegExp);
      const isTargetObject = baseValue !== null && baseValue !== void 0 && typeof baseValue === "object" && !Array.isArray(baseValue) && !(baseValue instanceof Date) && !(baseValue instanceof RegExp);
      if (isSourceObject && isTargetObject) {
        result[key] = mergeObjects(
          baseValue,
          overridesValue
        );
      } else {
        result[key] = overridesValue;
      }
    }
  }
  return result;
}

// src/prompt/file-part-data.ts
import {
  isBuffer,
  isProviderReference
} from "@ai-sdk/provider-utils";

// src/prompt/split-data-url.ts
function splitDataUrl(dataUrl) {
  try {
    const [header, base64Content] = dataUrl.split(",");
    return {
      mediaType: header.split(";")[0].split(":")[1],
      base64Content
    };
  } catch (e) {
    return {
      mediaType: void 0,
      base64Content: void 0
    };
  }
}

// src/prompt/file-part-data.ts
function isTaggedFileData(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const type = value.type;
  return type === "data" || type === "url" || type === "reference" || type === "text";
}
function convertUrlToFilePartData(url) {
  if (url.protocol === "data:") {
    const { mediaType, base64Content } = splitDataUrl(url.toString());
    if (mediaType == null || base64Content == null) {
      throw new InvalidDataContentError({
        content: url,
        message: `Invalid data URL format in content ${url.toString()}`
      });
    }
    return { data: { type: "data", data: base64Content }, mediaType };
  }
  return { data: { type: "url", url }, mediaType: void 0 };
}
function convertInlineDataToFilePartData(content) {
  if (content instanceof Uint8Array) {
    return { data: { type: "data", data: content }, mediaType: void 0 };
  }
  if (content instanceof ArrayBuffer) {
    return {
      data: { type: "data", data: new Uint8Array(content) },
      mediaType: void 0
    };
  }
  if (isBuffer(content)) {
    return {
      data: { type: "data", data: new Uint8Array(content) },
      mediaType: void 0
    };
  }
  return {
    data: { type: "data", data: content },
    mediaType: void 0
  };
}
function convertToLanguageModelV4FilePart(content) {
  if (isTaggedFileData(content)) {
    switch (content.type) {
      case "data":
        if (typeof content.data === "string" && content.data.startsWith("data:")) {
          throw new InvalidDataContentError({
            content: content.data,
            message: 'Data URLs are not valid inline data. Pass them as { type: "url", url } instead.'
          });
        }
        return convertInlineDataToFilePartData(content.data);
      case "url":
        return convertUrlToFilePartData(content.url);
      case "reference":
        return {
          data: { type: "reference", reference: content.reference },
          mediaType: void 0
        };
      case "text":
        return {
          data: { type: "text", text: content.text },
          mediaType: void 0
        };
    }
  }
  if (content instanceof URL) {
    return convertUrlToFilePartData(content);
  }
  if (typeof content === "string") {
    try {
      return convertUrlToFilePartData(new URL(content));
    } catch (e) {
      return convertInlineDataToFilePartData(content);
    }
  }
  if (isProviderReference(content)) {
    return {
      data: { type: "reference", reference: content },
      mediaType: void 0
    };
  }
  return convertInlineDataToFilePartData(content);
}

// src/prompt/convert-to-language-model-prompt.ts
async function convertToLanguageModelPrompt({
  prompt,
  supportedUrls,
  download: download2 = createDefaultDownloadFunction(),
  // `provider` is only needed here to convert legacy tool output types via `mapToolResultOutput`.
  // TODO: remove in v8 when "file-id" and "image-file-id" types are removed
  provider
}) {
  const downloadedAssets = await downloadAssets(
    prompt.messages,
    download2,
    supportedUrls
  );
  const approvalIdToToolCallId = /* @__PURE__ */ new Map();
  for (const message of prompt.messages) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === "tool-approval-request" && "approvalId" in part && "toolCallId" in part) {
          approvalIdToToolCallId.set(
            part.approvalId,
            part.toolCallId
          );
        }
      }
    }
  }
  const approvedToolCallIds = /* @__PURE__ */ new Set();
  for (const message of prompt.messages) {
    if (message.role === "tool") {
      for (const part of message.content) {
        if (part.type === "tool-approval-response") {
          const toolCallId = approvalIdToToolCallId.get(part.approvalId);
          if (toolCallId) {
            approvedToolCallIds.add(toolCallId);
          }
        }
      }
    }
  }
  const messages = [
    ...prompt.instructions != null ? typeof prompt.instructions === "string" ? [{ role: "system", content: prompt.instructions }] : asArray(prompt.instructions).map((message) => ({
      role: "system",
      content: message.content,
      providerOptions: message.providerOptions
    })) : [],
    ...prompt.messages.map(
      (message) => convertToLanguageModelMessage({ message, downloadedAssets, provider })
    )
  ];
  const combinedMessages = [];
  for (const message of messages) {
    if (message.role !== "tool") {
      combinedMessages.push(message);
      continue;
    }
    const lastCombinedMessage = combinedMessages.at(-1);
    if ((lastCombinedMessage == null ? void 0 : lastCombinedMessage.role) === "tool") {
      const lastContentPart = lastCombinedMessage.content.at(-1);
      if (lastContentPart != null && lastCombinedMessage.providerOptions != null) {
        lastContentPart.providerOptions = mergeObjects(
          lastCombinedMessage.providerOptions,
          lastContentPart.providerOptions
        );
      }
      lastCombinedMessage.content.push(...message.content);
      lastCombinedMessage.providerOptions = message.providerOptions;
    } else {
      combinedMessages.push(message);
    }
  }
  const toolCallIds = /* @__PURE__ */ new Set();
  for (const message of combinedMessages) {
    switch (message.role) {
      case "assistant": {
        for (const content of message.content) {
          if (content.type === "tool-call" && !content.providerExecuted) {
            toolCallIds.add(content.toolCallId);
          }
        }
        break;
      }
      case "tool": {
        for (const content of message.content) {
          if (content.type === "tool-result") {
            toolCallIds.delete(content.toolCallId);
          }
        }
        break;
      }
      case "user":
      case "system":
        for (const id of approvedToolCallIds) {
          toolCallIds.delete(id);
        }
        if (toolCallIds.size > 0) {
          throw new MissingToolResultsError({
            toolCallIds: Array.from(toolCallIds)
          });
        }
        break;
    }
  }
  for (const id of approvedToolCallIds) {
    toolCallIds.delete(id);
  }
  if (toolCallIds.size > 0) {
    throw new MissingToolResultsError({ toolCallIds: Array.from(toolCallIds) });
  }
  return combinedMessages.filter(
    // Filter out empty tool messages (e.g. if they only contained
    // tool-approval-response parts that were removed).
    // This prevents sending invalid empty messages to the provider.
    // Note: provider-executed tool-approval-response parts are preserved.
    (message) => message.role !== "tool" || message.content.length > 0
  );
}
function convertToLanguageModelMessage({
  message,
  downloadedAssets,
  // `provider` is only needed here to convert legacy tool output types via `mapToolResultOutput`.
  // TODO: remove in v8 when "file-id" and "image-file-id" types are removed
  provider
}) {
  const warnings = [];
  const role = message.role;
  switch (role) {
    case "system": {
      return {
        role: "system",
        content: message.content,
        providerOptions: message.providerOptions
      };
    }
    case "user": {
      if (typeof message.content === "string") {
        return {
          role: "user",
          content: [{ type: "text", text: message.content }],
          providerOptions: message.providerOptions
        };
      }
      const converted = {
        role: "user",
        content: message.content.map((part) => {
          if (part.type === "image") {
            warnings.push({
              type: "deprecated",
              setting: '"image" content part',
              message: `The "image" content part type is deprecated. Use a "file" part with mediaType: 'image' (or a more specific image/* subtype) instead.`
            });
          }
          return convertImagePartToFilePart(part);
        }).map((part) => convertPartToLanguageModelPart(part, downloadedAssets)).filter((part) => part.type !== "text" || part.text !== ""),
        providerOptions: message.providerOptions
      };
      if (warnings.length > 0) {
        logWarnings({ warnings });
      }
      return converted;
    }
    case "assistant": {
      if (typeof message.content === "string") {
        return {
          role: "assistant",
          content: [{ type: "text", text: message.content }],
          providerOptions: message.providerOptions
        };
      }
      const converted = {
        role: "assistant",
        content: message.content.filter(
          // remove empty text parts (no text, and no provider options):
          (part) => part.type !== "text" || part.text !== "" || part.providerOptions != null
        ).filter(
          (part) => part.type !== "tool-approval-request"
        ).map((part) => {
          const providerOptions = part.providerOptions;
          switch (part.type) {
            case "custom": {
              return {
                type: "custom",
                kind: part.kind,
                providerOptions
              };
            }
            case "file": {
              const { data, mediaType } = convertToLanguageModelV4FilePart(
                part.data
              );
              return {
                type: "file",
                data,
                filename: part.filename,
                mediaType: mediaType != null ? mediaType : part.mediaType,
                providerOptions
              };
            }
            case "reasoning": {
              return {
                type: "reasoning",
                text: part.text,
                providerOptions
              };
            }
            case "reasoning-file": {
              const { data, mediaType } = convertToLanguageModelV4FilePart(
                part.data
              );
              if (data.type !== "data" && data.type !== "url") {
                throw new Error(
                  `Unsupported reasoning-file data type: ${data.type}`
                );
              }
              return {
                type: "reasoning-file",
                data,
                mediaType: mediaType != null ? mediaType : part.mediaType,
                providerOptions
              };
            }
            case "text": {
              return {
                type: "text",
                text: part.text,
                providerOptions
              };
            }
            case "tool-call": {
              return {
                type: "tool-call",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
                providerExecuted: part.providerExecuted,
                providerOptions
              };
            }
            case "tool-result": {
              return {
                type: "tool-result",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                output: mapToolResultOutput({
                  output: part.output,
                  provider,
                  warnings,
                  downloadedAssets
                }),
                providerOptions
              };
            }
          }
        }),
        providerOptions: message.providerOptions
      };
      if (warnings.length > 0) {
        logWarnings({ warnings });
      }
      return converted;
    }
    case "tool": {
      const converted = {
        role: "tool",
        content: message.content.filter(
          // Only include tool-approval-response for provider-executed tools
          (part) => part.type !== "tool-approval-response" || part.providerExecuted
        ).map((part) => {
          switch (part.type) {
            case "tool-result": {
              return {
                type: "tool-result",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                output: mapToolResultOutput({
                  output: part.output,
                  provider,
                  warnings,
                  downloadedAssets
                }),
                providerOptions: part.providerOptions
              };
            }
            case "tool-approval-response": {
              return {
                type: "tool-approval-response",
                approvalId: part.approvalId,
                approved: part.approved,
                reason: part.reason
              };
            }
          }
        }),
        providerOptions: message.providerOptions
      };
      if (warnings.length > 0) {
        logWarnings({ warnings });
      }
      return converted;
    }
    default: {
      const _exhaustiveCheck = role;
      throw new InvalidMessageRoleError({ role: _exhaustiveCheck });
    }
  }
}
function convertImagePartToFilePart(part) {
  var _a22;
  if (part.type !== "image") {
    return part;
  }
  return {
    type: "file",
    data: part.image,
    mediaType: (_a22 = part.mediaType) != null ? _a22 : "image",
    providerOptions: part.providerOptions
  };
}
async function downloadAssets(messages, download2, supportedUrls) {
  const downloadableFiles = [];
  for (const message of messages) {
    if (message.role === "user" && Array.isArray(message.content)) {
      for (const part of message.content) {
        const filePart = convertImagePartToFilePart(part);
        if (filePart.type === "file") {
          downloadableFiles.push(filePart);
        }
      }
    }
    if (message.role === "tool") {
      for (const part of message.content) {
        if (part.type !== "tool-result") {
          continue;
        }
        if (part.output.type !== "content") {
          continue;
        }
        for (const contentPart of part.output.value) {
          if (contentPart.type === "file") {
            downloadableFiles.push(contentPart);
          }
        }
      }
    }
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type !== "tool-result") {
          continue;
        }
        if (part.output.type !== "content") {
          continue;
        }
        for (const contentPart of part.output.value) {
          if (contentPart.type === "file") {
            downloadableFiles.push(contentPart);
          }
        }
      }
    }
  }
  const plannedDownloads = downloadableFiles.map((part) => {
    const mediaType = part.mediaType;
    const { data } = convertToLanguageModelV4FilePart(part.data);
    return { mediaType, data };
  }).filter((part) => part.data.type === "url").map((part) => ({
    url: part.data.url,
    isUrlSupportedByModel: part.mediaType != null && isUrlSupported({
      url: part.data.url.toString(),
      mediaType: part.mediaType,
      supportedUrls
    })
  }));
  const downloadedFiles = await download2(plannedDownloads);
  return Object.fromEntries(
    downloadedFiles.map(
      (file, index) => file == null ? null : [
        plannedDownloads[index].url.toString(),
        { data: file.data, mediaType: file.mediaType }
      ]
    ).filter((file) => file != null)
  );
}
function convertPartToLanguageModelPart(part, downloadedAssets) {
  if (part.type === "text") {
    return {
      type: "text",
      text: part.text,
      providerOptions: part.providerOptions
    };
  }
  const { data: normalizedData, mediaType: dataUrlMediaType } = convertToLanguageModelV4FilePart(part.data);
  let mediaType = dataUrlMediaType != null ? dataUrlMediaType : part.mediaType;
  let data = normalizedData;
  if (data.type === "url") {
    const downloadedFile = downloadedAssets[data.url.toString()];
    if (downloadedFile) {
      data = { type: "data", data: downloadedFile.data };
      if (downloadedFile.mediaType != null && (mediaType == null || !isFullMediaType(mediaType))) {
        mediaType = downloadedFile.mediaType;
      }
    }
  }
  if (data.type === "data" && (data.data instanceof Uint8Array || typeof data.data === "string")) {
    const imageMediaType = detectMediaType({
      data: data.data,
      topLevelType: "image"
    });
    if (imageMediaType != null) {
      mediaType = imageMediaType;
    }
  }
  if (mediaType == null) {
    throw new Error(`Media type is missing for file part`);
  }
  return {
    type: "file",
    mediaType,
    filename: part.filename,
    data,
    providerOptions: part.providerOptions
  };
}
function mapToolResultOutput({
  output,
  // `provider` is only needed here to convert legacy "file-id" and "image-file-id" types to provider references, in case they are using string ID values.
  // TODO: remove in v8 when "file-id" and "image-file-id" types are removed
  provider,
  warnings = [],
  downloadedAssets
}) {
  if (output.type !== "content") {
    return output;
  }
  return {
    type: "content",
    value: output.value.map((item) => {
      var _a22;
      switch (item.type) {
        case "file": {
          const convertedPart = convertPartToLanguageModelPart(
            item,
            downloadedAssets
          );
          if (convertedPart.type !== "file") {
            throw new Error(
              "Expected tool result file content to convert to file."
            );
          }
          return convertedPart;
        }
        case "file-data": {
          warnings.push({
            type: "deprecated",
            setting: '"tool-result" content of type "file-data"',
            message: `The "file-data" type for tool result content is deprecated. Use the "file" type with mediaType and { type: 'data', data } instead.`
          });
          return {
            type: "file",
            data: { type: "data", data: item.data },
            filename: item.filename,
            mediaType: item.mediaType,
            providerOptions: item.providerOptions
          };
        }
        case "file-url": {
          const mediaType = (_a22 = item.mediaType) != null ? _a22 : getMediaTypeFromUrl(item.url);
          let message = `The "file-url" type for tool result content is deprecated. Use the "file" type with mediaType and { type: 'url', url } instead.`;
          if (!item.mediaType) {
            const inferenceSuffix = mediaType === "application/octet-stream" ? `Unable to infer media type from URL. Defaulting to 'application/octet-stream'.` : `Inferred media type '${mediaType}' from URL.`;
            message = `The "file-url" tool result content part with URL "${item.url}" is missing a "mediaType". ${inferenceSuffix} ${message}`;
          }
          warnings.push({
            type: "deprecated",
            setting: '"tool-result" content of type "file-url"',
            message
          });
          return {
            type: "file",
            data: { type: "url", url: new URL(item.url) },
            mediaType,
            providerOptions: item.providerOptions
          };
        }
        case "file-id": {
          warnings.push({
            type: "deprecated",
            setting: '"tool-result" content of type "file-id"',
            message: `The "file-id" type for tool result content is deprecated. Use the "file" type with mediaType and { type: 'reference', reference } instead.`
          });
          return {
            type: "file",
            data: {
              type: "reference",
              reference: convertFileIdToProviderReference({
                fileId: item.fileId,
                provider
              })
            },
            mediaType: "application",
            providerOptions: item.providerOptions
          };
        }
        case "file-reference": {
          warnings.push({
            type: "deprecated",
            setting: '"tool-result" content of type "file-reference"',
            message: `The "file-reference" type for tool result content is deprecated. Use the "file" type with mediaType and { type: 'reference', reference } instead.`
          });
          return {
            type: "file",
            data: {
              type: "reference",
              reference: item.providerReference
            },
            mediaType: "application",
            providerOptions: item.providerOptions
          };
        }
        case "image-data": {
          warnings.push({
            type: "deprecated",
            setting: '"tool-result" content of type "image-data"',
            message: `The "image-data" type for tool result content is deprecated. Use the "file" type with mediaType and { type: 'data', data } instead.`
          });
          return {
            type: "file",
            data: { type: "data", data: item.data },
            mediaType: item.mediaType,
            providerOptions: item.providerOptions
          };
        }
        case "image-url": {
          warnings.push({
            type: "deprecated",
            setting: '"tool-result" content of type "image-url"',
            message: `The "image-url" type for tool result content is deprecated. Use the "file" type with mediaType 'image' (or a specific image/* subtype) and { type: 'url', url } instead.`
          });
          return {
            type: "file",
            data: { type: "url", url: new URL(item.url) },
            mediaType: "image",
            providerOptions: item.providerOptions
          };
        }
        case "image-file-id": {
          warnings.push({
            type: "deprecated",
            setting: '"tool-result" content of type "image-file-id"',
            message: `The "image-file-id" type for tool result content is deprecated. Use the "file" type with mediaType and { type: 'reference', reference } instead.`
          });
          return {
            type: "file",
            data: {
              type: "reference",
              reference: convertFileIdToProviderReference({
                fileId: item.fileId,
                provider
              })
            },
            mediaType: "image",
            providerOptions: item.providerOptions
          };
        }
        case "image-file-reference": {
          warnings.push({
            type: "deprecated",
            setting: '"tool-result" content of type "image-file-reference"',
            message: `The "image-file-reference" type for tool result content is deprecated. Use the "file" type with mediaType and { type: 'reference', reference } instead.`
          });
          return {
            type: "file",
            data: {
              type: "reference",
              reference: item.providerReference
            },
            mediaType: "image",
            providerOptions: item.providerOptions
          };
        }
        default:
          return item;
      }
    })
  };
}
function convertFileIdToProviderReference({
  fileId,
  provider
}) {
  if (typeof fileId === "object") {
    return fileId;
  }
  if (provider == null) {
    throw new Error(
      "Cannot convert string fileId to provider reference without a provider ID. Use a Record<string, string> fileId or switch to the file-reference type."
    );
  }
  return { [provider]: fileId };
}
var URL_EXTENSION_TO_MEDIA_TYPE = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  heic: "image/heic",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg"
};
function getMediaTypeFromUrl(url, fallbackMediaType = "application/octet-stream") {
  var _a22;
  try {
    const pathname = new URL(url).pathname;
    const fileExtension = (_a22 = pathname.split(".").pop()) == null ? void 0 : _a22.toLowerCase();
    if (fileExtension && Object.hasOwn(URL_EXTENSION_TO_MEDIA_TYPE, fileExtension)) {
      return URL_EXTENSION_TO_MEDIA_TYPE[fileExtension];
    }
  } catch (e) {
  }
  return fallbackMediaType;
}

// src/prompt/create-tool-model-output.ts
import { getErrorMessage as getErrorMessage3 } from "@ai-sdk/provider";
async function createToolModelOutput({
  toolCallId,
  input,
  output,
  tool: tool2,
  errorMode
}) {
  if (errorMode === "text") {
    return { type: "error-text", value: getErrorMessage3(output) };
  } else if (errorMode === "json") {
    return { type: "error-json", value: toJSONValue(output) };
  }
  if (tool2 == null ? void 0 : tool2.toModelOutput) {
    return await tool2.toModelOutput({ toolCallId, input, output });
  }
  return typeof output === "string" ? { type: "text", value: output } : { type: "json", value: toJSONValue(output) };
}
function toJSONValue(value) {
  return value === void 0 ? null : value;
}

// src/prompt/prepare-language-model-call-options.ts
function prepareLanguageModelCallOptions({
  maxOutputTokens,
  temperature,
  topP,
  topK,
  presencePenalty,
  frequencyPenalty,
  seed,
  stopSequences,
  reasoning
}) {
  if (maxOutputTokens != null) {
    if (!Number.isInteger(maxOutputTokens)) {
      throw new InvalidArgumentError({
        parameter: "maxOutputTokens",
        value: maxOutputTokens,
        message: "maxOutputTokens must be an integer"
      });
    }
    if (maxOutputTokens < 1) {
      throw new InvalidArgumentError({
        parameter: "maxOutputTokens",
        value: maxOutputTokens,
        message: "maxOutputTokens must be >= 1"
      });
    }
  }
  if (temperature != null) {
    if (typeof temperature !== "number") {
      throw new InvalidArgumentError({
        parameter: "temperature",
        value: temperature,
        message: "temperature must be a number"
      });
    }
  }
  if (topP != null) {
    if (typeof topP !== "number") {
      throw new InvalidArgumentError({
        parameter: "topP",
        value: topP,
        message: "topP must be a number"
      });
    }
  }
  if (topK != null) {
    if (typeof topK !== "number") {
      throw new InvalidArgumentError({
        parameter: "topK",
        value: topK,
        message: "topK must be a number"
      });
    }
  }
  if (presencePenalty != null) {
    if (typeof presencePenalty !== "number") {
      throw new InvalidArgumentError({
        parameter: "presencePenalty",
        value: presencePenalty,
        message: "presencePenalty must be a number"
      });
    }
  }
  if (frequencyPenalty != null) {
    if (typeof frequencyPenalty !== "number") {
      throw new InvalidArgumentError({
        parameter: "frequencyPenalty",
        value: frequencyPenalty,
        message: "frequencyPenalty must be a number"
      });
    }
  }
  if (seed != null) {
    if (!Number.isInteger(seed)) {
      throw new InvalidArgumentError({
        parameter: "seed",
        value: seed,
        message: "seed must be an integer"
      });
    }
  }
  return {
    maxOutputTokens,
    temperature,
    topP,
    topK,
    presencePenalty,
    frequencyPenalty,
    stopSequences,
    seed,
    reasoning
  };
}

// src/prompt/prepare-tool-choice.ts
function prepareToolChoice({
  toolChoice
}) {
  return toolChoice == null ? { type: "auto" } : typeof toolChoice === "string" ? { type: toolChoice } : { type: "tool", toolName: toolChoice.toolName };
}

// src/prompt/prepare-tools.ts
import {
  asSchema
} from "@ai-sdk/provider-utils";

// src/util/is-non-empty-object.ts
function isNonEmptyObject(object2) {
  return object2 != null && Object.keys(object2).length > 0;
}

// src/prompt/prepare-tools.ts
async function prepareTools({
  tools,
  toolOrder,
  toolsContext = {},
  experimental_sandbox: sandbox
}) {
  if (!isNonEmptyObject(tools)) {
    return void 0;
  }
  const languageModelTools = [];
  for (const [name22, tool2] of orderToolEntries({ tools, toolOrder })) {
    const toolType = tool2.type;
    switch (toolType) {
      case void 0:
      case "dynamic":
      case "function": {
        const description = resolveToolDescription({
          tool: tool2,
          toolName: name22,
          toolsContext,
          experimental_sandbox: sandbox
        });
        const providerOptions = tool2.providerOptions;
        const inputExamples = tool2.inputExamples;
        const strict = tool2.strict;
        languageModelTools.push({
          type: "function",
          name: name22,
          inputSchema: await asSchema(tool2.inputSchema).jsonSchema,
          ...description != null ? { description } : {},
          ...inputExamples != null ? { inputExamples } : {},
          ...providerOptions != null ? { providerOptions } : {},
          ...strict != null ? { strict } : {}
        });
        break;
      }
      case "provider": {
        languageModelTools.push({
          type: "provider",
          name: name22,
          id: tool2.id,
          args: tool2.args
        });
        break;
      }
      default: {
        const exhaustiveCheck = toolType;
        throw new Error(`Unsupported tool type: ${exhaustiveCheck}`);
      }
    }
  }
  return languageModelTools;
}
function orderToolEntries({
  tools,
  toolOrder
}) {
  if (toolOrder == null) {
    return Object.entries(tools);
  }
  const toolEntries = Object.entries(tools);
  const orderedTools = toolEntries.filter(([name22]) => toolOrder.includes(name22)).sort(
    ([nameA], [nameB]) => toolOrder.indexOf(nameA) - toolOrder.indexOf(nameB)
  );
  const unorderedTools = toolEntries.filter(([name22]) => !toolOrder.includes(name22)).sort(([nameA], [nameB]) => nameA < nameB ? -1 : nameA > nameB ? 1 : 0);
  return [...orderedTools, ...unorderedTools];
}
function resolveToolDescription({
  tool: tool2,
  toolName,
  toolsContext,
  experimental_sandbox: sandbox
}) {
  return tool2.description === void 0 ? void 0 : typeof tool2.description === "string" ? tool2.description : tool2.description({
    context: toolsContext[toolName],
    experimental_sandbox: sandbox
  });
}

// src/prompt/request-options.ts
function getTotalTimeoutMs(timeout) {
  if (timeout == null) {
    return void 0;
  }
  if (typeof timeout === "number") {
    return timeout;
  }
  return timeout.totalMs;
}
function getStepTimeoutMs(timeout) {
  if (timeout == null || typeof timeout === "number") {
    return void 0;
  }
  return timeout.stepMs;
}
function getFirstChunkTimeoutMs(timeout) {
  if (timeout == null || typeof timeout === "number") {
    return void 0;
  }
  return timeout.firstChunkMs;
}
function getChunkTimeoutMs(timeout) {
  if (timeout == null || typeof timeout === "number") {
    return void 0;
  }
  return timeout.chunkMs;
}
function getToolTimeoutMs(timeout, toolName) {
  var _a22, _b;
  if (timeout == null || typeof timeout === "number") {
    return void 0;
  }
  return (_b = (_a22 = timeout.tools) == null ? void 0 : _a22[`${toolName}Ms`]) != null ? _b : timeout.toolMs;
}

// src/prompt/standardize-prompt.ts
import { InvalidPromptError as InvalidPromptError2 } from "@ai-sdk/provider";
import {
  asArray as asArray2,
  safeValidateTypes
} from "@ai-sdk/provider-utils";
import { z as z5 } from "zod/v4";

// src/prompt/message.ts
import { z as z4 } from "zod/v4";

// src/types/provider-metadata.ts
import { z as z2 } from "zod/v4";

// src/types/json-value.ts
import { z } from "zod/v4";
var jsonValueSchema = z.lazy(
  () => z.union([
    z.null(),
    z.string(),
    z.number(),
    z.boolean(),
    z.record(z.string(), jsonValueSchema.optional()),
    z.array(jsonValueSchema)
  ])
);

// src/types/provider-metadata.ts
var providerMetadataSchema = z2.record(
  z2.string(),
  z2.record(z2.string(), jsonValueSchema.optional())
);

// src/prompt/content-part.ts
import {
  isBuffer as isBuffer2
} from "@ai-sdk/provider-utils";
import { z as z3 } from "zod/v4";
var fileInlineDataSchema = z3.union([
  z3.string(),
  z3.instanceof(Uint8Array),
  z3.instanceof(ArrayBuffer),
  z3.custom(isBuffer2, { message: "Must be a Buffer" })
]);
var providerReferenceSchema = z3.record(z3.string(), z3.string());
var textPartSchema = z3.object({
  type: z3.literal("text"),
  text: z3.string(),
  providerOptions: providerMetadataSchema.optional()
});
var imagePartSchema = z3.object({
  type: z3.literal("image"),
  image: z3.union([
    fileInlineDataSchema,
    z3.instanceof(URL),
    providerReferenceSchema
  ]),
  mediaType: z3.string().optional(),
  providerOptions: providerMetadataSchema.optional()
});
var taggedFileDataSchema = z3.discriminatedUnion("type", [
  z3.object({ type: z3.literal("data"), data: fileInlineDataSchema }),
  z3.object({ type: z3.literal("url"), url: z3.instanceof(URL) }),
  z3.object({
    type: z3.literal("reference"),
    reference: providerReferenceSchema
  }),
  z3.object({ type: z3.literal("text"), text: z3.string() })
]);
var taggedReasoningFileDataSchema = z3.discriminatedUnion("type", [
  z3.object({ type: z3.literal("data"), data: fileInlineDataSchema }),
  z3.object({ type: z3.literal("url"), url: z3.instanceof(URL) })
]);
var filePartSchema = z3.object({
  type: z3.literal("file"),
  data: z3.union([
    taggedFileDataSchema,
    fileInlineDataSchema,
    z3.instanceof(URL),
    providerReferenceSchema
  ]),
  filename: z3.string().optional(),
  mediaType: z3.string(),
  providerOptions: providerMetadataSchema.optional()
});
var reasoningPartSchema = z3.object({
  type: z3.literal("reasoning"),
  text: z3.string(),
  providerOptions: providerMetadataSchema.optional()
});
var customPartSchema = z3.object({
  type: z3.literal("custom"),
  kind: z3.string().transform((value) => value),
  providerOptions: providerMetadataSchema.optional()
});
var reasoningFilePartSchema = z3.object({
  type: z3.literal("reasoning-file"),
  data: z3.union([
    taggedReasoningFileDataSchema,
    fileInlineDataSchema,
    z3.instanceof(URL)
  ]),
  mediaType: z3.string(),
  providerOptions: providerMetadataSchema.optional()
});
var toolCallPartSchema = z3.object({
  type: z3.literal("tool-call"),
  toolCallId: z3.string(),
  toolName: z3.string(),
  input: z3.unknown(),
  providerOptions: providerMetadataSchema.optional(),
  providerExecuted: z3.boolean().optional()
});
var outputSchema = z3.discriminatedUnion(
  "type",
  [
    z3.object({
      type: z3.literal("text"),
      value: z3.string(),
      providerOptions: providerMetadataSchema.optional()
    }),
    z3.object({
      type: z3.literal("json"),
      value: jsonValueSchema,
      providerOptions: providerMetadataSchema.optional()
    }),
    z3.object({
      type: z3.literal("execution-denied"),
      reason: z3.string().optional(),
      providerOptions: providerMetadataSchema.optional()
    }),
    z3.object({
      type: z3.literal("error-text"),
      value: z3.string(),
      providerOptions: providerMetadataSchema.optional()
    }),
    z3.object({
      type: z3.literal("error-json"),
      value: jsonValueSchema,
      providerOptions: providerMetadataSchema.optional()
    }),
    z3.object({
      type: z3.literal("content"),
      value: z3.array(
        z3.union([
          z3.object({
            type: z3.literal("text"),
            text: z3.string(),
            providerOptions: providerMetadataSchema.optional()
          }),
          z3.object({
            type: z3.literal("file"),
            data: taggedFileDataSchema,
            mediaType: z3.string(),
            filename: z3.string().optional(),
            providerOptions: providerMetadataSchema.optional()
          }),
          z3.object({
            // Deprecated.
            type: z3.literal("file-data"),
            data: z3.string(),
            mediaType: z3.string(),
            filename: z3.string().optional(),
            providerOptions: providerMetadataSchema.optional()
          }),
          z3.object({
            // Deprecated.
            type: z3.literal("file-url"),
            url: z3.string(),
            mediaType: z3.string().optional(),
            providerOptions: providerMetadataSchema.optional()
          }),
          z3.object({
            // Deprecated.
            type: z3.literal("file-id"),
            fileId: z3.union([z3.string(), z3.record(z3.string(), z3.string())]),
            providerOptions: providerMetadataSchema.optional()
          }),
          z3.object({
            // Deprecated.
            type: z3.literal("file-reference"),
            providerReference: z3.record(z3.string(), z3.string()),
            providerOptions: providerMetadataSchema.optional()
          }),
          z3.object({
            // Deprecated.
            type: z3.literal("image-data"),
            data: z3.string(),
            mediaType: z3.string(),
            providerOptions: providerMetadataSchema.optional()
          }),
          z3.object({
            // Deprecated.
            type: z3.literal("image-url"),
            url: z3.string(),
            providerOptions: providerMetadataSchema.optional()
          }),
          z3.object({
            // Deprecated.
            type: z3.literal("image-file-id"),
            fileId: z3.union([z3.string(), z3.record(z3.string(), z3.string())]),
            providerOptions: providerMetadataSchema.optional()
          }),
          z3.object({
            // Deprecated.
            type: z3.literal("image-file-reference"),
            providerReference: z3.record(z3.string(), z3.string()),
            providerOptions: providerMetadataSchema.optional()
          }),
          z3.object({
            type: z3.literal("custom"),
            providerOptions: providerMetadataSchema.optional()
          })
        ])
      )
    })
  ]
);
var toolResultPartSchema = z3.object({
  type: z3.literal("tool-result"),
  toolCallId: z3.string(),
  toolName: z3.string(),
  output: outputSchema,
  providerOptions: providerMetadataSchema.optional()
});
var toolApprovalRequestSchema = z3.object({
  type: z3.literal("tool-approval-request"),
  approvalId: z3.string(),
  toolCallId: z3.string()
});
var toolApprovalResponseSchema = z3.object({
  type: z3.literal("tool-approval-response"),
  approvalId: z3.string(),
  approved: z3.boolean(),
  reason: z3.string().optional()
});

// src/prompt/message.ts
var systemModelMessageSchema = z4.object(
  {
    role: z4.literal("system"),
    content: z4.string(),
    providerOptions: providerMetadataSchema.optional()
  }
);
var userModelMessageSchema = z4.object({
  role: z4.literal("user"),
  content: z4.union([
    z4.string(),
    z4.array(z4.union([textPartSchema, imagePartSchema, filePartSchema]))
  ]),
  providerOptions: providerMetadataSchema.optional()
});
var assistantModelMessageSchema = z4.object({
  role: z4.literal("assistant"),
  content: z4.union([
    z4.string(),
    z4.array(
      z4.union([
        textPartSchema,
        customPartSchema,
        filePartSchema,
        reasoningPartSchema,
        reasoningFilePartSchema,
        toolCallPartSchema,
        toolResultPartSchema,
        toolApprovalRequestSchema
      ])
    )
  ]),
  providerOptions: providerMetadataSchema.optional()
});
var toolModelMessageSchema = z4.object({
  role: z4.literal("tool"),
  content: z4.array(z4.union([toolResultPartSchema, toolApprovalResponseSchema])),
  providerOptions: providerMetadataSchema.optional()
});
var modelMessageSchema = z4.union([
  systemModelMessageSchema,
  userModelMessageSchema,
  assistantModelMessageSchema,
  toolModelMessageSchema
]);

// src/prompt/standardize-prompt.ts
async function standardizePrompt({
  allowSystemInMessages = false,
  system,
  instructions = system,
  prompt,
  messages
}) {
  if (prompt == null && messages == null) {
    throw new InvalidPromptError2({
      prompt,
      message: "prompt or messages must be defined"
    });
  }
  if (prompt != null && messages != null) {
    throw new InvalidPromptError2({
      prompt,
      message: "prompt and messages cannot be defined at the same time"
    });
  }
  if (typeof instructions !== "string" && !asArray2(instructions).every((message) => message.role === "system")) {
    throw new InvalidPromptError2({
      prompt,
      message: "instructions must be a string, SystemModelMessage, or array of SystemModelMessage"
    });
  }
  if (prompt != null && typeof prompt === "string") {
    messages = [{ role: "user", content: prompt }];
  } else if (prompt != null && Array.isArray(prompt)) {
    messages = prompt;
  } else if (messages == null) {
    throw new InvalidPromptError2({
      prompt,
      message: "prompt or messages must be defined"
    });
  }
  if (messages.length === 0) {
    throw new InvalidPromptError2({
      prompt,
      message: "messages must not be empty"
    });
  }
  if (!allowSystemInMessages && messages.some((message) => message.role === "system")) {
    throw new InvalidPromptError2({
      prompt,
      message: "System messages are not allowed in the prompt or messages fields. Use the instructions option instead."
    });
  }
  const validationResult = await safeValidateTypes({
    value: messages,
    schema: z5.array(modelMessageSchema)
  });
  if (!validationResult.success) {
    throw new InvalidPromptError2({
      prompt,
      message: "The messages do not match the ModelMessage[] schema.",
      cause: validationResult.error
    });
  }
  return { messages, instructions };
}

// src/prompt/wrap-gateway-error.ts
import { GatewayAuthenticationError } from "@ai-sdk/gateway";
import { AISDKError as AISDKError23 } from "@ai-sdk/provider";
function wrapGatewayError(error) {
  if (!GatewayAuthenticationError.isInstance(error))
    return error;
  const isProductionEnv = (process == null ? void 0 : process.env.NODE_ENV) === "production";
  const moreInfoURL = "https://ai-sdk.dev/unauthenticated-ai-gateway";
  if (isProductionEnv) {
    return new AISDKError23({
      name: "GatewayError",
      message: `Unauthenticated. Configure AI_GATEWAY_API_KEY or use a provider module. Learn more: ${moreInfoURL}`
    });
  }
  return Object.assign(
    new Error(`\x1B[1m\x1B[31mUnauthenticated request to AI Gateway.\x1B[0m

To authenticate, set the \x1B[33mAI_GATEWAY_API_KEY\x1B[0m environment variable with your API key.

Alternatively, you can use a provider module instead of the AI Gateway.

Learn more: \x1B[34m${moreInfoURL}\x1B[0m

`),
    { name: "GatewayAuthenticationError" }
  );
}

// src/types/usage.ts
function asLanguageModelUsage(usage) {
  return {
    inputTokens: usage.inputTokens.total,
    inputTokenDetails: {
      noCacheTokens: usage.inputTokens.noCache,
      cacheReadTokens: usage.inputTokens.cacheRead,
      cacheWriteTokens: usage.inputTokens.cacheWrite
    },
    outputTokens: usage.outputTokens.total,
    outputTokenDetails: {
      textTokens: usage.outputTokens.text,
      reasoningTokens: usage.outputTokens.reasoning
    },
    totalTokens: addTokenCounts(
      usage.inputTokens.total,
      usage.outputTokens.total
    ),
    raw: usage.raw
  };
}
function createNullLanguageModelUsage() {
  return {
    inputTokens: void 0,
    inputTokenDetails: {
      noCacheTokens: void 0,
      cacheReadTokens: void 0,
      cacheWriteTokens: void 0
    },
    outputTokens: void 0,
    outputTokenDetails: {
      textTokens: void 0,
      reasoningTokens: void 0
    },
    totalTokens: void 0,
    raw: void 0
  };
}
function addLanguageModelUsage(usage1, usage2) {
  var _a22, _b, _c, _d, _e, _f, _g, _h, _i, _j;
  return {
    inputTokens: addTokenCounts(usage1.inputTokens, usage2.inputTokens),
    inputTokenDetails: {
      noCacheTokens: addTokenCounts(
        (_a22 = usage1.inputTokenDetails) == null ? void 0 : _a22.noCacheTokens,
        (_b = usage2.inputTokenDetails) == null ? void 0 : _b.noCacheTokens
      ),
      cacheReadTokens: addTokenCounts(
        (_c = usage1.inputTokenDetails) == null ? void 0 : _c.cacheReadTokens,
        (_d = usage2.inputTokenDetails) == null ? void 0 : _d.cacheReadTokens
      ),
      cacheWriteTokens: addTokenCounts(
        (_e = usage1.inputTokenDetails) == null ? void 0 : _e.cacheWriteTokens,
        (_f = usage2.inputTokenDetails) == null ? void 0 : _f.cacheWriteTokens
      )
    },
    outputTokens: addTokenCounts(usage1.outputTokens, usage2.outputTokens),
    outputTokenDetails: {
      textTokens: addTokenCounts(
        (_g = usage1.outputTokenDetails) == null ? void 0 : _g.textTokens,
        (_h = usage2.outputTokenDetails) == null ? void 0 : _h.textTokens
      ),
      reasoningTokens: addTokenCounts(
        (_i = usage1.outputTokenDetails) == null ? void 0 : _i.reasoningTokens,
        (_j = usage2.outputTokenDetails) == null ? void 0 : _j.reasoningTokens
      )
    },
    totalTokens: addTokenCounts(usage1.totalTokens, usage2.totalTokens)
  };
}
function addTokenCounts(tokenCount1, tokenCount2) {
  return tokenCount1 == null && tokenCount2 == null ? void 0 : (tokenCount1 != null ? tokenCount1 : 0) + (tokenCount2 != null ? tokenCount2 : 0);
}
function addImageModelUsage(usage1, usage2) {
  return {
    inputTokens: addTokenCounts(usage1.inputTokens, usage2.inputTokens),
    outputTokens: addTokenCounts(usage1.outputTokens, usage2.outputTokens),
    totalTokens: addTokenCounts(usage1.totalTokens, usage2.totalTokens)
  };
}

// src/util/get-own.ts
function getOwn(obj, key) {
  return obj != null && Object.hasOwn(obj, key) ? obj[key] : void 0;
}

// src/util/merge-abort-signals.ts
import { filterNullable } from "@ai-sdk/provider-utils";
function mergeAbortSignals(...signals) {
  const validSignals = filterNullable(...signals).map(
    (signal) => signal instanceof AbortSignal ? signal : AbortSignal.timeout(signal)
  );
  return validSignals.length === 0 ? void 0 : validSignals.length === 1 ? validSignals[0] : AbortSignal.any(validSignals);
}

// src/util/now.ts
function now() {
  var _a22, _b;
  return (_b = (_a22 = globalThis == null ? void 0 : globalThis.performance) == null ? void 0 : _a22.now()) != null ? _b : Date.now();
}

// src/util/notify.ts
import { asArray as asArray3 } from "@ai-sdk/provider-utils";
async function notify(options) {
  await Promise.all(
    asArray3(options.callbacks).map(async (callback) => {
      try {
        await (callback == null ? void 0 : callback(options.event));
      } catch (e) {
      }
    })
  );
}

// src/util/retry-with-exponential-backoff.ts
import { APICallError as APICallError2 } from "@ai-sdk/provider";
import { GatewayError } from "@ai-sdk/gateway";
import {
  retryWithExponentialBackoff
} from "@ai-sdk/provider-utils";
function getRetryDelayInMs({
  error,
  exponentialBackoffDelay
}) {
  const headers = APICallError2.isInstance(error) ? error.responseHeaders : APICallError2.isInstance(error.cause) ? error.cause.responseHeaders : void 0;
  if (!headers)
    return exponentialBackoffDelay;
  let ms;
  const retryAfterMs = headers["retry-after-ms"];
  if (retryAfterMs) {
    const timeoutMs = parseFloat(retryAfterMs);
    if (!Number.isNaN(timeoutMs)) {
      ms = timeoutMs;
    }
  }
  const retryAfter = headers["retry-after"];
  if (retryAfter && ms === void 0) {
    const timeoutSeconds = parseFloat(retryAfter);
    if (!Number.isNaN(timeoutSeconds)) {
      ms = timeoutSeconds * 1e3;
    } else {
      ms = Date.parse(retryAfter) - Date.now();
    }
  }
  if (ms != null && !Number.isNaN(ms) && 0 <= ms && (ms < 60 * 1e3 || ms < exponentialBackoffDelay)) {
    return ms;
  }
  return exponentialBackoffDelay;
}
var retryWithExponentialBackoffRespectingRetryHeaders = ({
  maxRetries = 2,
  initialDelayInMs = 2e3,
  backoffFactor = 2,
  abortSignal
} = {}) => retryWithExponentialBackoff({
  maxRetries,
  initialDelayInMs,
  backoffFactor,
  abortSignal,
  shouldRetry: (error) => error instanceof Error && (APICallError2.isInstance(error) && error.isRetryable === true || GatewayError.isInstance(error) && error.isRetryable === true),
  getDelayInMs: ({ error, exponentialBackoffDelay }) => getRetryDelayInMs({
    error,
    exponentialBackoffDelay
  }),
  createRetryError: ({ message, reason, errors }) => new RetryError({ message, reason, errors })
});

// src/util/prepare-retries.ts
function prepareRetries({
  maxRetries,
  abortSignal
}) {
  if (maxRetries != null) {
    if (!Number.isInteger(maxRetries)) {
      throw new InvalidArgumentError({
        parameter: "maxRetries",
        value: maxRetries,
        message: "maxRetries must be an integer"
      });
    }
    if (maxRetries < 0) {
      throw new InvalidArgumentError({
        parameter: "maxRetries",
        value: maxRetries,
        message: "maxRetries must be >= 0"
      });
    }
  }
  const maxRetriesResult = maxRetries != null ? maxRetries : 2;
  return {
    maxRetries: maxRetriesResult,
    retry: retryWithExponentialBackoffRespectingRetryHeaders({
      maxRetries: maxRetriesResult,
      abortSignal
    })
  };
}

// src/util/set-abort-timeout.ts
function setAbortTimeout({
  abortController,
  label,
  timeoutMs
}) {
  if (abortController == null || timeoutMs == null) {
    return void 0;
  }
  return setTimeout(
    () => abortController.abort(
      new DOMException(
        `${label} timeout of ${timeoutMs}ms exceeded`,
        "TimeoutError"
      )
    ),
    timeoutMs
  );
}

// src/generate-text/calculate-tokens-per-second.ts
function calculateTokensPerSecond({
  tokens,
  durationMs
}) {
  const tokenRate = 1e3 * (tokens != null ? tokens : 0) / (durationMs != null ? durationMs : 0);
  return Number.isFinite(tokenRate) ? tokenRate : 0;
}

// src/generate-text/collect-tool-approvals.ts
function collectToolApprovals({
  messages
}) {
  const lastMessage = messages.at(-1);
  if ((lastMessage == null ? void 0 : lastMessage.role) != "tool") {
    return {
      approvedToolApprovals: [],
      deniedToolApprovals: []
    };
  }
  const toolCallsByToolCallId = /* @__PURE__ */ Object.create(null);
  for (const message of messages) {
    if (message.role === "assistant" && typeof message.content !== "string") {
      const content = message.content;
      for (const part of content) {
        if (part.type === "tool-call") {
          toolCallsByToolCallId[part.toolCallId] = part;
        }
      }
    }
  }
  const toolApprovalRequestsByApprovalId = /* @__PURE__ */ Object.create(null);
  for (const message of messages) {
    if (message.role === "assistant" && typeof message.content !== "string") {
      const content = message.content;
      for (const part of content) {
        if (part.type === "tool-approval-request") {
          toolApprovalRequestsByApprovalId[part.approvalId] = part;
        }
      }
    }
  }
  const toolResults = /* @__PURE__ */ Object.create(null);
  for (const part of lastMessage.content) {
    if (part.type === "tool-result") {
      toolResults[part.toolCallId] = part;
    }
  }
  const approvedToolApprovals = [];
  const deniedToolApprovals = [];
  const approvalResponses = lastMessage.content.filter(
    (part) => part.type === "tool-approval-response"
  );
  for (const approvalResponse of approvalResponses) {
    const approvalRequest = toolApprovalRequestsByApprovalId[approvalResponse.approvalId];
    if (approvalRequest == null) {
      throw new InvalidToolApprovalError({
        approvalId: approvalResponse.approvalId
      });
    }
    const existingToolResult = toolResults[approvalRequest.toolCallId];
    if (existingToolResult != null && (approvalResponse.approved || existingToolResult.output.type !== "execution-denied")) {
      continue;
    }
    const toolCall = toolCallsByToolCallId[approvalRequest.toolCallId];
    if (toolCall == null) {
      throw new ToolCallNotFoundForApprovalError({
        toolCallId: approvalRequest.toolCallId,
        approvalId: approvalRequest.approvalId
      });
    }
    const approval = {
      approvalRequest,
      approvalResponse,
      toolCall,
      ...existingToolResult != null ? { existingToolResult } : {}
    };
    if (approvalResponse.approved) {
      approvedToolApprovals.push(approval);
    } else {
      deniedToolApprovals.push(approval);
    }
  }
  return { approvedToolApprovals, deniedToolApprovals };
}

// src/generate-text/execute-tool-call.ts
import {
  executeTool,
  isExecutableTool
} from "@ai-sdk/provider-utils";

// src/generate-text/validate-tool-context.ts
import { validateTypes } from "@ai-sdk/provider-utils";
async function validateToolContext({
  toolName,
  context,
  contextSchema
}) {
  if (contextSchema == null) {
    return context;
  }
  return await validateTypes({
    value: context,
    schema: contextSchema,
    context: {
      field: "tool context",
      entityName: toolName
    }
  });
}

// src/generate-text/execute-tool-call.ts
async function executeToolCall({
  toolCall,
  tools,
  toolsContext,
  callId,
  messages,
  abortSignal,
  timeout,
  experimental_sandbox: sandbox,
  onPreliminaryToolResult,
  onToolExecutionStart,
  onToolExecutionEnd,
  executeToolInTelemetryContext = async ({ execute }) => await execute(),
  runInTracingChannelSpan = async ({ execute }) => await execute()
}) {
  const { toolName, toolCallId, input } = toolCall;
  const tool2 = getOwn(tools, toolName);
  if (!isExecutableTool(tool2)) {
    return void 0;
  }
  const context = await validateToolContext({
    toolName,
    context: getOwn(toolsContext, toolName),
    contextSchema: tool2.contextSchema
  });
  const toolExecutionContext = {
    toolCall,
    messages,
    toolContext: context
  };
  const baseCallbackEvent = {
    callId,
    ...toolExecutionContext
  };
  return await runInTracingChannelSpan({
    type: "executeTool",
    event: baseCallbackEvent,
    execute: async () => {
      let output;
      await notify({
        event: baseCallbackEvent,
        callbacks: onToolExecutionStart
      });
      const toolTimeoutMs = getToolTimeoutMs(timeout, toolName);
      const toolAbortSignal = mergeAbortSignals(abortSignal, toolTimeoutMs);
      let toolExecutionMs = 0;
      try {
        await executeToolInTelemetryContext({
          callId,
          toolCallId,
          ...toolExecutionContext,
          execute: async () => {
            const startTime = now();
            try {
              const stream = executeTool({
                tool: tool2,
                input,
                options: {
                  toolCallId,
                  messages,
                  abortSignal: toolAbortSignal,
                  context,
                  experimental_sandbox: sandbox
                }
              });
              for await (const part of stream) {
                if (part.type === "preliminary") {
                  onPreliminaryToolResult == null ? void 0 : onPreliminaryToolResult({
                    ...toolCall,
                    type: "tool-result",
                    output: part.output,
                    preliminary: true
                  });
                } else {
                  output = part.output;
                }
              }
            } finally {
              toolExecutionMs = now() - startTime;
            }
          }
        });
      } catch (error) {
        const toolError = {
          type: "tool-error",
          toolCallId,
          toolName,
          input,
          error,
          dynamic: tool2.type === "dynamic",
          ...toolCall.providerMetadata != null ? { providerMetadata: toolCall.providerMetadata } : {},
          ...toolCall.toolMetadata != null ? { toolMetadata: toolCall.toolMetadata } : {}
        };
        await notify({
          event: {
            ...baseCallbackEvent,
            toolOutput: toolError,
            toolExecutionMs
          },
          callbacks: onToolExecutionEnd
        });
        return {
          output: toolError,
          toolExecutionMs
        };
      }
      const toolResult = {
        type: "tool-result",
        toolCallId,
        toolName,
        input,
        output,
        dynamic: tool2.type === "dynamic",
        ...toolCall.providerMetadata != null ? { providerMetadata: toolCall.providerMetadata } : {},
        ...toolCall.toolMetadata != null ? { toolMetadata: toolCall.toolMetadata } : {}
      };
      await notify({
        event: {
          ...baseCallbackEvent,
          toolOutput: toolResult,
          toolExecutionMs
        },
        callbacks: onToolExecutionEnd
      });
      return {
        output: toolResult,
        toolExecutionMs
      };
    }
  });
}

// src/generate-text/filter-active-tools.ts
function filterActiveTools({
  tools,
  activeTools
}) {
  if (tools == null || activeTools == null) {
    return tools;
  }
  return Object.fromEntries(
    Object.entries(tools).filter(([name22]) => activeTools.includes(name22))
  );
}

// src/generate-text/generated-file.ts
import {
  convertBase64ToUint8Array,
  convertUint8ArrayToBase64
} from "@ai-sdk/provider-utils";
var DefaultGeneratedFile = class {
  constructor({
    data,
    mediaType
  }) {
    const isUint8Array = data instanceof Uint8Array;
    this.base64Data = isUint8Array ? void 0 : data;
    this.uint8ArrayData = isUint8Array ? data : void 0;
    this.mediaType = mediaType;
  }
  // lazy conversion with caching to avoid unnecessary conversion overhead:
  get base64() {
    if (this.base64Data == null) {
      this.base64Data = convertUint8ArrayToBase64(this.uint8ArrayData);
    }
    return this.base64Data;
  }
  // lazy conversion with caching to avoid unnecessary conversion overhead:
  get uint8Array() {
    if (this.uint8ArrayData == null) {
      this.uint8ArrayData = convertBase64ToUint8Array(this.base64Data);
    }
    return this.uint8ArrayData;
  }
};
var DefaultGeneratedFileWithType = class extends DefaultGeneratedFile {
  constructor(options) {
    super(options);
    this.type = "file";
  }
};

// src/generate-text/output.ts
var output_exports = {};
__export(output_exports, {
  array: () => array,
  choice: () => choice,
  json: () => json,
  object: () => object,
  text: () => text
});
import {
  TypeValidationError as TypeValidationError2
} from "@ai-sdk/provider";
import {
  asSchema as asSchema2,
  resolve,
  safeParseJSON as safeParseJSON2,
  safeValidateTypes as safeValidateTypes2
} from "@ai-sdk/provider-utils";

// src/util/parse-partial-json.ts
import { safeParseJSON } from "@ai-sdk/provider-utils";

// src/util/fix-json.ts
function fixJson(input) {
  const stack = ["ROOT"];
  let lastValidIndex = -1;
  let literalStart = null;
  let unicodeEscapeDigits = 0;
  function isHexDigit(char) {
    return char >= "0" && char <= "9" || char >= "A" && char <= "F" || char >= "a" && char <= "f";
  }
  function processValueStart(char, i, swapState) {
    {
      switch (char) {
        case '"': {
          lastValidIndex = i;
          stack.pop();
          stack.push(swapState);
          stack.push("INSIDE_STRING");
          break;
        }
        case "f":
        case "t":
        case "n": {
          lastValidIndex = i;
          literalStart = i;
          stack.pop();
          stack.push(swapState);
          stack.push("INSIDE_LITERAL");
          break;
        }
        case "-": {
          stack.pop();
          stack.push(swapState);
          stack.push("INSIDE_NUMBER");
          break;
        }
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
        case "8":
        case "9": {
          lastValidIndex = i;
          stack.pop();
          stack.push(swapState);
          stack.push("INSIDE_NUMBER");
          break;
        }
        case "{": {
          lastValidIndex = i;
          stack.pop();
          stack.push(swapState);
          stack.push("INSIDE_OBJECT_START");
          break;
        }
        case "[": {
          lastValidIndex = i;
          stack.pop();
          stack.push(swapState);
          stack.push("INSIDE_ARRAY_START");
          break;
        }
      }
    }
  }
  function processAfterObjectValue(char, i) {
    switch (char) {
      case ",": {
        stack.pop();
        stack.push("INSIDE_OBJECT_AFTER_COMMA");
        break;
      }
      case "}": {
        lastValidIndex = i;
        stack.pop();
        break;
      }
    }
  }
  function processAfterArrayValue(char, i) {
    switch (char) {
      case ",": {
        stack.pop();
        stack.push("INSIDE_ARRAY_AFTER_COMMA");
        break;
      }
      case "]": {
        lastValidIndex = i;
        stack.pop();
        break;
      }
    }
  }
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const currentState = stack[stack.length - 1];
    switch (currentState) {
      case "ROOT":
        processValueStart(char, i, "FINISH");
        break;
      case "INSIDE_OBJECT_START": {
        switch (char) {
          case '"': {
            stack.pop();
            stack.push("INSIDE_OBJECT_KEY");
            break;
          }
          case "}": {
            lastValidIndex = i;
            stack.pop();
            break;
          }
        }
        break;
      }
      case "INSIDE_OBJECT_AFTER_COMMA": {
        switch (char) {
          case '"': {
            stack.pop();
            stack.push("INSIDE_OBJECT_KEY");
            break;
          }
        }
        break;
      }
      case "INSIDE_OBJECT_KEY": {
        switch (char) {
          case '"': {
            stack.pop();
            stack.push("INSIDE_OBJECT_AFTER_KEY");
            break;
          }
        }
        break;
      }
      case "INSIDE_OBJECT_AFTER_KEY": {
        switch (char) {
          case ":": {
            stack.pop();
            stack.push("INSIDE_OBJECT_BEFORE_VALUE");
            break;
          }
        }
        break;
      }
      case "INSIDE_OBJECT_BEFORE_VALUE": {
        processValueStart(char, i, "INSIDE_OBJECT_AFTER_VALUE");
        break;
      }
      case "INSIDE_OBJECT_AFTER_VALUE": {
        processAfterObjectValue(char, i);
        break;
      }
      case "INSIDE_STRING": {
        switch (char) {
          case '"': {
            stack.pop();
            lastValidIndex = i;
            break;
          }
          case "\\": {
            stack.push("INSIDE_STRING_ESCAPE");
            break;
          }
          default: {
            lastValidIndex = i;
          }
        }
        break;
      }
      case "INSIDE_ARRAY_START": {
        switch (char) {
          case "]": {
            lastValidIndex = i;
            stack.pop();
            break;
          }
          default: {
            lastValidIndex = i;
            processValueStart(char, i, "INSIDE_ARRAY_AFTER_VALUE");
            break;
          }
        }
        break;
      }
      case "INSIDE_ARRAY_AFTER_VALUE": {
        switch (char) {
          case ",": {
            stack.pop();
            stack.push("INSIDE_ARRAY_AFTER_COMMA");
            break;
          }
          case "]": {
            lastValidIndex = i;
            stack.pop();
            break;
          }
          default: {
            lastValidIndex = i;
            break;
          }
        }
        break;
      }
      case "INSIDE_ARRAY_AFTER_COMMA": {
        processValueStart(char, i, "INSIDE_ARRAY_AFTER_VALUE");
        break;
      }
      case "INSIDE_STRING_ESCAPE": {
        stack.pop();
        if (char === "u") {
          unicodeEscapeDigits = 0;
          stack.push("INSIDE_STRING_UNICODE_ESCAPE");
        } else {
          lastValidIndex = i;
        }
        break;
      }
      case "INSIDE_STRING_UNICODE_ESCAPE": {
        if (isHexDigit(char)) {
          unicodeEscapeDigits++;
          if (unicodeEscapeDigits === 4) {
            stack.pop();
            lastValidIndex = i;
          }
        }
        break;
      }
      case "INSIDE_NUMBER": {
        switch (char) {
          case "0":
          case "1":
          case "2":
          case "3":
          case "4":
          case "5":
          case "6":
          case "7":
          case "8":
          case "9": {
            lastValidIndex = i;
            break;
          }
          case "e":
          case "E":
          case "-":
          case ".": {
            break;
          }
          case ",": {
            stack.pop();
            if (stack[stack.length - 1] === "INSIDE_ARRAY_AFTER_VALUE") {
              processAfterArrayValue(char, i);
            }
            if (stack[stack.length - 1] === "INSIDE_OBJECT_AFTER_VALUE") {
              processAfterObjectValue(char, i);
            }
            break;
          }
          case "}": {
            stack.pop();
            if (stack[stack.length - 1] === "INSIDE_OBJECT_AFTER_VALUE") {
              processAfterObjectValue(char, i);
            }
            break;
          }
          case "]": {
            stack.pop();
            if (stack[stack.length - 1] === "INSIDE_ARRAY_AFTER_VALUE") {
              processAfterArrayValue(char, i);
            }
            break;
          }
          default: {
            stack.pop();
            break;
          }
        }
        break;
      }
      case "INSIDE_LITERAL": {
        const partialLiteral = input.substring(literalStart, i + 1);
        if (!"false".startsWith(partialLiteral) && !"true".startsWith(partialLiteral) && !"null".startsWith(partialLiteral)) {
          stack.pop();
          if (stack[stack.length - 1] === "INSIDE_OBJECT_AFTER_VALUE") {
            processAfterObjectValue(char, i);
          } else if (stack[stack.length - 1] === "INSIDE_ARRAY_AFTER_VALUE") {
            processAfterArrayValue(char, i);
          }
        } else {
          lastValidIndex = i;
        }
        break;
      }
    }
  }
  let result = input.slice(0, lastValidIndex + 1);
  for (let i = stack.length - 1; i >= 0; i--) {
    const state = stack[i];
    switch (state) {
      case "INSIDE_STRING": {
        result += '"';
        break;
      }
      case "INSIDE_OBJECT_KEY":
      case "INSIDE_OBJECT_AFTER_KEY":
      case "INSIDE_OBJECT_AFTER_COMMA":
      case "INSIDE_OBJECT_START":
      case "INSIDE_OBJECT_BEFORE_VALUE":
      case "INSIDE_OBJECT_AFTER_VALUE": {
        result += "}";
        break;
      }
      case "INSIDE_ARRAY_START":
      case "INSIDE_ARRAY_AFTER_COMMA":
      case "INSIDE_ARRAY_AFTER_VALUE": {
        result += "]";
        break;
      }
      case "INSIDE_LITERAL": {
        const partialLiteral = input.substring(literalStart, input.length);
        if ("true".startsWith(partialLiteral)) {
          result += "true".slice(partialLiteral.length);
        } else if ("false".startsWith(partialLiteral)) {
          result += "false".slice(partialLiteral.length);
        } else if ("null".startsWith(partialLiteral)) {
          result += "null".slice(partialLiteral.length);
        }
      }
    }
  }
  return result;
}

// src/util/parse-partial-json.ts
async function parsePartialJson(jsonText) {
  if (jsonText === void 0) {
    return { value: void 0, state: "undefined-input" };
  }
  let result = await safeParseJSON({ text: jsonText });
  if (result.success) {
    return { value: result.value, state: "successful-parse" };
  }
  result = await safeParseJSON({ text: fixJson(jsonText) });
  if (result.success) {
    return { value: result.value, state: "repaired-parse" };
  }
  return { value: void 0, state: "failed-parse" };
}

// src/generate-text/output.ts
var text = () => ({
  name: "text",
  responseFormat: Promise.resolve({ type: "text" }),
  async parseCompleteOutput({ text: text2 }) {
    return text2;
  },
  async parsePartialOutput({ text: text2 }) {
    return { partial: text2 };
  },
  createElementStreamTransform() {
    return void 0;
  }
});
var object = ({
  schema: inputSchema,
  name: name22,
  description
}) => {
  const schema = asSchema2(inputSchema);
  return {
    name: "object",
    responseFormat: resolve(schema.jsonSchema).then((jsonSchema2) => ({
      type: "json",
      schema: jsonSchema2,
      ...name22 != null && { name: name22 },
      ...description != null && { description }
    })),
    async parseCompleteOutput({ text: text2 }, context) {
      const parseResult = await safeParseJSON2({ text: text2 });
      if (!parseResult.success) {
        throw new NoObjectGeneratedError({
          message: "No object generated: could not parse the response.",
          cause: parseResult.error,
          text: text2,
          response: context.response,
          usage: context.usage,
          finishReason: context.finishReason
        });
      }
      const validationResult = await safeValidateTypes2({
        value: parseResult.value,
        schema
      });
      if (!validationResult.success) {
        throw new NoObjectGeneratedError({
          message: "No object generated: response did not match schema.",
          cause: validationResult.error,
          text: text2,
          response: context.response,
          usage: context.usage,
          finishReason: context.finishReason
        });
      }
      return validationResult.value;
    },
    async parsePartialOutput({ text: text2 }) {
      const result = await parsePartialJson(text2);
      switch (result.state) {
        case "failed-parse":
        case "undefined-input": {
          return void 0;
        }
        case "repaired-parse":
        case "successful-parse": {
          return {
            // Note: currently no validation of partial results:
            partial: result.value
          };
        }
      }
    },
    createElementStreamTransform() {
      return void 0;
    }
  };
};
var array = ({
  element: inputElementSchema,
  name: name22,
  description
}) => {
  const elementSchema = asSchema2(inputElementSchema);
  return {
    name: "array",
    // JSON schema that describes an array of elements:
    responseFormat: resolve(elementSchema.jsonSchema).then((jsonSchema2) => {
      const { $schema: _$schema, ...itemSchema } = jsonSchema2;
      return {
        type: "json",
        schema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          properties: {
            elements: { type: "array", items: itemSchema }
          },
          required: ["elements"],
          additionalProperties: false
        },
        ...name22 != null && { name: name22 },
        ...description != null && { description }
      };
    }),
    async parseCompleteOutput({ text: text2 }, context) {
      const parseResult = await safeParseJSON2({ text: text2 });
      if (!parseResult.success) {
        throw new NoObjectGeneratedError({
          message: "No object generated: could not parse the response.",
          cause: parseResult.error,
          text: text2,
          response: context.response,
          usage: context.usage,
          finishReason: context.finishReason
        });
      }
      const outerValue = parseResult.value;
      if (outerValue == null || typeof outerValue !== "object" || !("elements" in outerValue) || !Array.isArray(outerValue.elements)) {
        throw new NoObjectGeneratedError({
          message: "No object generated: response did not match schema.",
          cause: new TypeValidationError2({
            value: outerValue,
            cause: "response must be an object with an elements array"
          }),
          text: text2,
          response: context.response,
          usage: context.usage,
          finishReason: context.finishReason
        });
      }
      const validatedElements = [];
      for (const element of outerValue.elements) {
        const validationResult = await safeValidateTypes2({
          value: element,
          schema: elementSchema
        });
        if (!validationResult.success) {
          throw new NoObjectGeneratedError({
            message: "No object generated: response did not match schema.",
            cause: validationResult.error,
            text: text2,
            response: context.response,
            usage: context.usage,
            finishReason: context.finishReason
          });
        }
        validatedElements.push(validationResult.value);
      }
      return validatedElements;
    },
    async parsePartialOutput({ text: text2 }) {
      const result = await parsePartialJson(text2);
      switch (result.state) {
        case "failed-parse":
        case "undefined-input": {
          return void 0;
        }
        case "repaired-parse":
        case "successful-parse": {
          const outerValue = result.value;
          if (outerValue == null || typeof outerValue !== "object" || !("elements" in outerValue) || !Array.isArray(outerValue.elements)) {
            return void 0;
          }
          const rawElements = result.state === "repaired-parse" && outerValue.elements.length > 0 ? outerValue.elements.slice(0, -1) : outerValue.elements;
          const parsedElements = [];
          for (const rawElement of rawElements) {
            const validationResult = await safeValidateTypes2({
              value: rawElement,
              schema: elementSchema
            });
            if (validationResult.success) {
              parsedElements.push(validationResult.value);
            }
          }
          return { partial: parsedElements };
        }
      }
    },
    createElementStreamTransform() {
      let publishedElements = 0;
      return new TransformStream({
        transform({ partialOutput }, controller) {
          if (partialOutput != null) {
            for (; publishedElements < partialOutput.length; publishedElements++) {
              controller.enqueue(partialOutput[publishedElements]);
            }
          }
        }
      });
    }
  };
};
var choice = ({
  options: choiceOptions,
  name: name22,
  description
}) => {
  return {
    name: "choice",
    // JSON schema that describes an enumeration:
    responseFormat: Promise.resolve({
      type: "json",
      schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          result: { type: "string", enum: choiceOptions }
        },
        required: ["result"],
        additionalProperties: false
      },
      ...name22 != null && { name: name22 },
      ...description != null && { description }
    }),
    async parseCompleteOutput({ text: text2 }, context) {
      const parseResult = await safeParseJSON2({ text: text2 });
      if (!parseResult.success) {
        throw new NoObjectGeneratedError({
          message: "No object generated: could not parse the response.",
          cause: parseResult.error,
          text: text2,
          response: context.response,
          usage: context.usage,
          finishReason: context.finishReason
        });
      }
      const outerValue = parseResult.value;
      if (outerValue == null || typeof outerValue !== "object" || !("result" in outerValue) || typeof outerValue.result !== "string" || !choiceOptions.includes(outerValue.result)) {
        throw new NoObjectGeneratedError({
          message: "No object generated: response did not match schema.",
          cause: new TypeValidationError2({
            value: outerValue,
            cause: "response must be an object that contains a choice value."
          }),
          text: text2,
          response: context.response,
          usage: context.usage,
          finishReason: context.finishReason
        });
      }
      return outerValue.result;
    },
    async parsePartialOutput({ text: text2 }) {
      const result = await parsePartialJson(text2);
      switch (result.state) {
        case "failed-parse":
        case "undefined-input": {
          return void 0;
        }
        case "repaired-parse":
        case "successful-parse": {
          const outerValue = result.value;
          if (outerValue == null || typeof outerValue !== "object" || !("result" in outerValue) || typeof outerValue.result !== "string") {
            return void 0;
          }
          const potentialMatches = choiceOptions.filter(
            (choiceOption) => choiceOption.startsWith(outerValue.result)
          );
          if (result.state === "successful-parse") {
            return potentialMatches.includes(outerValue.result) ? { partial: outerValue.result } : void 0;
          } else {
            return potentialMatches.length === 1 ? { partial: potentialMatches[0] } : void 0;
          }
        }
      }
    },
    createElementStreamTransform() {
      return void 0;
    }
  };
};
var json = ({
  name: name22,
  description
} = {}) => {
  return {
    name: "json",
    responseFormat: Promise.resolve({
      type: "json",
      ...name22 != null && { name: name22 },
      ...description != null && { description }
    }),
    async parseCompleteOutput({ text: text2 }, context) {
      const parseResult = await safeParseJSON2({ text: text2 });
      if (!parseResult.success) {
        throw new NoObjectGeneratedError({
          message: "No object generated: could not parse the response.",
          cause: parseResult.error,
          text: text2,
          response: context.response,
          usage: context.usage,
          finishReason: context.finishReason
        });
      }
      return parseResult.value;
    },
    async parsePartialOutput({ text: text2 }) {
      const result = await parsePartialJson(text2);
      switch (result.state) {
        case "failed-parse":
        case "undefined-input": {
          return void 0;
        }
        case "repaired-parse":
        case "successful-parse": {
          return result.value === void 0 ? void 0 : { partial: result.value };
        }
      }
    },
    createElementStreamTransform() {
      return void 0;
    }
  };
};

// src/generate-text/parse-tool-call.ts
import {
  asSchema as asSchema3,
  safeParseJSON as safeParseJSON3,
  safeValidateTypes as safeValidateTypes3
} from "@ai-sdk/provider-utils";
async function parseToolCall({
  toolCall,
  tools,
  repairToolCall,
  refineToolInput,
  messages,
  instructions
}) {
  try {
    if (tools == null) {
      if (toolCall.providerExecuted && toolCall.dynamic) {
        return await refineParsedToolCallInput({
          toolCall: await parseProviderExecutedDynamicToolCall(toolCall),
          refineToolInput
        });
      }
      throw new NoSuchToolError({ toolName: toolCall.toolName });
    }
    try {
      return await refineParsedToolCallInput({
        toolCall: await doParseToolCall({ toolCall, tools }),
        refineToolInput
      });
    } catch (error) {
      if (repairToolCall == null || !(NoSuchToolError.isInstance(error) || InvalidToolInputError.isInstance(error))) {
        throw error;
      }
      let repairedToolCall = null;
      try {
        repairedToolCall = await repairToolCall({
          toolCall,
          tools,
          inputSchema: async ({ toolName }) => {
            var _a22;
            const inputSchema = (_a22 = getOwn(tools, toolName)) == null ? void 0 : _a22.inputSchema;
            return await asSchema3(inputSchema).jsonSchema;
          },
          instructions,
          system: instructions,
          messages,
          error
        });
      } catch (repairError) {
        throw new ToolCallRepairError({
          cause: repairError,
          originalError: error
        });
      }
      if (repairedToolCall == null) {
        throw error;
      }
      return await refineParsedToolCallInput({
        toolCall: await doParseToolCall({ toolCall: repairedToolCall, tools }),
        refineToolInput
      });
    }
  } catch (error) {
    const parsedInput = await safeParseJSON3({ text: toolCall.input });
    const input = parsedInput.success ? parsedInput.value : toolCall.input;
    const tool2 = getOwn(tools, toolCall.toolName);
    return {
      type: "tool-call",
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      input,
      dynamic: true,
      invalid: true,
      error,
      title: tool2 == null ? void 0 : tool2.title,
      providerExecuted: toolCall.providerExecuted,
      providerMetadata: toolCall.providerMetadata,
      ...(tool2 == null ? void 0 : tool2.metadata) != null ? { toolMetadata: tool2.metadata } : {}
    };
  }
}
async function refineParsedToolCallInput({
  toolCall,
  refineToolInput
}) {
  const refine = getOwn(refineToolInput, toolCall.toolName);
  if (refine == null) {
    return toolCall;
  }
  return {
    ...toolCall,
    input: await refine(toolCall.input)
  };
}
async function parseProviderExecutedDynamicToolCall(toolCall) {
  const parseResult = toolCall.input.trim() === "" ? { success: true, value: {} } : await safeParseJSON3({ text: toolCall.input });
  if (parseResult.success === false) {
    throw new InvalidToolInputError({
      toolName: toolCall.toolName,
      toolInput: toolCall.input,
      cause: parseResult.error
    });
  }
  return {
    type: "tool-call",
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    input: parseResult.value,
    providerExecuted: true,
    dynamic: true,
    providerMetadata: toolCall.providerMetadata
  };
}
async function doParseToolCall({
  toolCall,
  tools
}) {
  const toolName = toolCall.toolName;
  const tool2 = getOwn(tools, toolName);
  if (tool2 == null) {
    if (toolCall.providerExecuted && toolCall.dynamic) {
      return await parseProviderExecutedDynamicToolCall(toolCall);
    }
    throw new NoSuchToolError({
      toolName: toolCall.toolName,
      availableTools: Object.keys(tools)
    });
  }
  const schema = asSchema3(tool2.inputSchema);
  const parseResult = toolCall.input.trim() === "" ? await safeValidateTypes3({ value: {}, schema }) : await safeParseJSON3({ text: toolCall.input, schema });
  if (parseResult.success === false) {
    throw new InvalidToolInputError({
      toolName,
      toolInput: toolCall.input,
      cause: parseResult.error
    });
  }
  return tool2.type === "dynamic" ? {
    type: "tool-call",
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    input: parseResult.value,
    providerExecuted: toolCall.providerExecuted,
    providerMetadata: toolCall.providerMetadata,
    ...tool2.metadata != null ? { toolMetadata: tool2.metadata } : {},
    dynamic: true,
    title: tool2.title
  } : {
    type: "tool-call",
    toolCallId: toolCall.toolCallId,
    toolName,
    input: parseResult.value,
    providerExecuted: toolCall.providerExecuted,
    providerMetadata: toolCall.providerMetadata,
    ...tool2.metadata != null ? { toolMetadata: tool2.metadata } : {},
    title: tool2.title
  };
}

// src/generate-text/reasoning-output.ts
function unwrapReasoningFileData(data) {
  if (typeof data === "object" && data !== null && "type" in data) {
    return data.type === "data" ? data.data : data.url;
  }
  return data;
}
function convertFromReasoningOutputs(parts) {
  return parts.map((part) => {
    if (part.type === "reasoning") {
      return {
        type: "reasoning",
        text: part.text,
        ...part.providerMetadata != null ? { providerOptions: part.providerMetadata } : {}
      };
    }
    return {
      type: "reasoning-file",
      data: part.file.base64,
      mediaType: part.file.mediaType,
      ...part.providerMetadata != null ? { providerOptions: part.providerMetadata } : {}
    };
  });
}
function convertToReasoningOutputs(parts) {
  return parts.map((part) => {
    if (part.type === "reasoning") {
      return {
        type: "reasoning",
        text: part.text,
        ...part.providerOptions != null ? { providerMetadata: part.providerOptions } : {}
      };
    }
    const rawData = unwrapReasoningFileData(part.data);
    const fileData = rawData instanceof ArrayBuffer ? new Uint8Array(rawData) : rawData instanceof URL ? rawData.toString() : rawData;
    return {
      type: "reasoning-file",
      file: new DefaultGeneratedFile({
        data: fileData,
        mediaType: part.mediaType
      }),
      ...part.providerOptions != null ? { providerMetadata: part.providerOptions } : {}
    };
  });
}

// src/generate-text/resolve-tool-approval.ts
async function resolveToolApproval({
  tools,
  toolCall,
  toolApproval,
  messages,
  toolsContext,
  runtimeContext
}) {
  if (toolApproval != null && typeof toolApproval === "function") {
    return normalizeToolApprovalStatus(
      await toolApproval({
        toolCall,
        tools,
        toolsContext,
        messages,
        runtimeContext
      })
    );
  }
  const toolName = toolCall.toolName;
  const tool2 = getOwn(tools, toolName);
  const input = toolCall.input;
  const userDefinedToolApprovalStatus = getOwn(toolApproval, toolName);
  if (userDefinedToolApprovalStatus != null) {
    const approvalStatus = typeof userDefinedToolApprovalStatus === "function" ? await userDefinedToolApprovalStatus(input, {
      toolCallId: toolCall.toolCallId,
      messages,
      toolContext: await validateToolContext({
        toolName,
        context: getOwn(toolsContext, toolName),
        contextSchema: tool2 == null ? void 0 : tool2.contextSchema
      }),
      runtimeContext
    }) : userDefinedToolApprovalStatus;
    return normalizeToolApprovalStatus(approvalStatus);
  }
  if ((tool2 == null ? void 0 : tool2.needsApproval) == null) {
    return { type: "not-applicable" };
  }
  const needsApproval = typeof tool2.needsApproval === "function" ? await tool2.needsApproval(input, {
    toolCallId: toolCall.toolCallId,
    messages,
    context: await validateToolContext({
      toolName,
      context: getOwn(toolsContext, toolName),
      contextSchema: tool2 == null ? void 0 : tool2.contextSchema
    })
  }) : tool2.needsApproval;
  return needsApproval ? { type: "user-approval" } : { type: "not-applicable" };
}
function normalizeToolApprovalStatus(status) {
  return status === void 0 ? { type: "not-applicable" } : typeof status === "string" ? { type: status } : status;
}

// src/telemetry/create-telemetry-dispatcher.ts
import { asArray as asArray4 } from "@ai-sdk/provider-utils";

// src/util/merge-callbacks.ts
function mergeCallbacks(...callbacks) {
  return async (event) => {
    await Promise.allSettled(
      callbacks.map(async (callback) => {
        await (callback == null ? void 0 : callback(event));
      })
    );
  };
}

// src/telemetry/tracing-channel.ts
var AI_SDK_TELEMETRY_TRACING_CHANNEL = "ai:telemetry";

// src/util/is-node-runtime.ts
function isNodeRuntime() {
  var _a22;
  return typeof process !== "undefined" && ((_a22 = process.release) == null ? void 0 : _a22.name) === "node";
}

// src/telemetry/tracing-channel-publisher.ts
var diagnosticsChannelPromise;
async function loadDiagnosticsChannel() {
  if (!isNodeRuntime()) {
    return void 0;
  }
  if (diagnosticsChannelPromise == null) {
    diagnosticsChannelPromise = Promise.resolve(
      loadBuiltinModule("node:diagnostics_channel")
    );
  }
  return diagnosticsChannelPromise;
}
function loadBuiltinModule(id) {
  var _a22;
  const processWithBuiltins = globalThis.process;
  try {
    return (_a22 = processWithBuiltins == null ? void 0 : processWithBuiltins.getBuiltinModule) == null ? void 0 : _a22.call(processWithBuiltins, id);
  } catch (e) {
    return void 0;
  }
}
async function runWithTracingChannelSpan(message, execute) {
  var _a22;
  const diagnosticsChannel = await loadDiagnosticsChannel();
  const tracingChannel = (_a22 = diagnosticsChannel == null ? void 0 : diagnosticsChannel.tracingChannel) == null ? void 0 : _a22.call(
    diagnosticsChannel,
    AI_SDK_TELEMETRY_TRACING_CHANNEL
  );
  if (tracingChannel == null || tracingChannel.hasSubscribers === false) {
    return await execute();
  }
  let executePromise;
  let executionResult;
  let executionError;
  let hasExecutionResult = false;
  let hasExecutionError = false;
  const tracedExecute = () => {
    try {
      executePromise = Promise.resolve(execute());
    } catch (error) {
      executePromise = Promise.reject(error);
    }
    executePromise = executePromise.then(
      (result) => {
        executionResult = result;
        hasExecutionResult = true;
        return result;
      },
      (error) => {
        executionError = error;
        hasExecutionError = true;
        throw error;
      }
    );
    return executePromise;
  };
  try {
    return await tracingChannel.tracePromise(tracedExecute, message);
  } catch (e) {
    if (hasExecutionError) {
      throw executionError;
    }
    if (hasExecutionResult) {
      return executionResult;
    }
    if (executePromise != null) {
      return await executePromise;
    }
    return await execute();
  }
}
function openTelemetryChannelSpanContext({
  message,
  completion
}) {
  var _a22;
  if (!isNodeRuntime()) {
    return void 0;
  }
  const diagnosticsChannel = loadBuiltinModule(
    "node:diagnostics_channel"
  );
  const asyncHooks = loadBuiltinModule("node:async_hooks");
  const tracingChannel = (_a22 = diagnosticsChannel == null ? void 0 : diagnosticsChannel.tracingChannel) == null ? void 0 : _a22.call(
    diagnosticsChannel,
    AI_SDK_TELEMETRY_TRACING_CHANNEL
  );
  if (tracingChannel == null || tracingChannel.hasSubscribers === false || asyncHooks == null) {
    Promise.resolve(completion).catch(() => {
    });
    return void 0;
  }
  const context = message;
  let asyncResource;
  let asyncEndPublished = false;
  const safePublish = (publish) => {
    try {
      publish();
    } catch (e) {
    }
  };
  const publishAsyncEnd = ({
    result,
    error
  }) => {
    if (asyncEndPublished) {
      return;
    }
    asyncEndPublished = true;
    if (error !== void 0) {
      context.error = error;
      safePublish(() => tracingChannel.error.publish(context));
    }
    if (result !== void 0) {
      context.result = result;
    }
    safePublish(() => tracingChannel.asyncEnd.publish(context));
  };
  safePublish(() => {
    tracingChannel.start.runStores(context, () => {
      asyncResource = new asyncHooks.AsyncResource("ai.telemetry");
    });
  });
  safePublish(() => tracingChannel.end.publish(context));
  void Promise.resolve(completion).then(
    (result) => publishAsyncEnd({ result }),
    (error) => publishAsyncEnd({ error })
  );
  return {
    run: (execute) => asyncResource == null ? execute() : asyncResource.runInAsyncScope(execute)
  };
}

// src/telemetry/telemetry-registry.ts
function registerTelemetry(...integrations) {
  if (!globalThis.AI_SDK_TELEMETRY_INTEGRATIONS) {
    globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = [];
  }
  globalThis.AI_SDK_TELEMETRY_INTEGRATIONS.push(...integrations);
}
function getGlobalTelemetryIntegrations() {
  var _a22;
  return (_a22 = globalThis.AI_SDK_TELEMETRY_INTEGRATIONS) != null ? _a22 : [];
}

// src/telemetry/create-telemetry-dispatcher.ts
function augmentEvent(event, telemetry) {
  return Object.assign(
    Object.create(Object.getPrototypeOf(event)),
    event,
    telemetry
  );
}
function createTelemetryDispatcher({
  telemetry
}) {
  if ((telemetry == null ? void 0 : telemetry.isEnabled) === false) {
    return {};
  }
  const localIntegrations = telemetry == null ? void 0 : telemetry.integrations;
  const integrations = localIntegrations != null ? asArray4(localIntegrations) : getGlobalTelemetryIntegrations();
  const telemetryMetadata = {
    recordInputs: telemetry == null ? void 0 : telemetry.recordInputs,
    recordOutputs: telemetry == null ? void 0 : telemetry.recordOutputs,
    functionId: telemetry == null ? void 0 : telemetry.functionId
  };
  const mergeTelemetryCallback = (key) => {
    const integrationCallbacks = integrations.map((integration) => {
      var _a22;
      return (_a22 = integration[key]) == null ? void 0 : _a22.bind(integration);
    }).filter(Boolean).map(
      (callback) => (event) => callback(augmentEvent(event, telemetryMetadata))
    );
    const mergedIntegrationCallback = mergeCallbacks(...integrationCallbacks);
    return async (event) => {
      await mergedIntegrationCallback(event);
    };
  };
  const executeLanguageModelCallWrappers = integrations.map((integration) => {
    var _a22;
    return (_a22 = integration.executeLanguageModelCall) == null ? void 0 : _a22.bind(integration);
  }).filter(Boolean);
  const executeToolWrappers = integrations.map((integration) => {
    var _a22;
    return (_a22 = integration.executeTool) == null ? void 0 : _a22.bind(integration);
  }).filter(Boolean);
  return {
    runInTracingChannelSpan: async ({ type, event, execute }) => await runWithTracingChannelSpan(
      {
        type,
        event: augmentEvent(event, telemetryMetadata)
      },
      execute
    ),
    startTracingChannelContext: ({ type, event, completion }) => openTelemetryChannelSpanContext({
      message: {
        type,
        event: augmentEvent(event, telemetryMetadata)
      },
      completion
    }),
    onStart: mergeTelemetryCallback("onStart"),
    onStepStart: mergeTelemetryCallback("onStepStart"),
    onLanguageModelCallStart: mergeTelemetryCallback(
      "onLanguageModelCallStart"
    ),
    onLanguageModelCallEnd: mergeTelemetryCallback("onLanguageModelCallEnd"),
    onToolExecutionStart: mergeTelemetryCallback("onToolExecutionStart"),
    onToolExecutionEnd: mergeTelemetryCallback("onToolExecutionEnd"),
    // Fan out step-end events to both the new `onStepEnd` callback and the
    // deprecated `onStepFinish` callback so integrations that still implement
    // only `onStepFinish` keep receiving step-end events during the deprecation
    // window.
    onStepEnd: mergeCallbacks(
      mergeTelemetryCallback("onStepEnd"),
      mergeTelemetryCallback("onStepFinish")
    ),
    onObjectStepStart: mergeTelemetryCallback("onObjectStepStart"),
    onObjectStepEnd: mergeTelemetryCallback("onObjectStepEnd"),
    onEmbedStart: mergeTelemetryCallback("onEmbedStart"),
    onEmbedEnd: mergeTelemetryCallback("onEmbedEnd"),
    onRerankStart: mergeTelemetryCallback("onRerankStart"),
    onRerankEnd: mergeTelemetryCallback("onRerankEnd"),
    onEnd: mergeTelemetryCallback("onEnd"),
    onAbort: mergeTelemetryCallback("onAbort"),
    onError: mergeTelemetryCallback("onError"),
    /**
     * Runs provider calls inside integration-specific context so
     * auto-instrumented provider requests can be associated with model work.
     */
    executeLanguageModelCall: async ({ execute, ...event }) => {
      const augmentedEvent = augmentEvent(event, telemetryMetadata);
      let wrappedExecute = execute;
      for (const executeWrapper of executeLanguageModelCallWrappers) {
        const innerExecute = wrappedExecute;
        wrappedExecute = () => executeWrapper({ ...augmentedEvent, execute: innerExecute });
      }
      return await runWithTracingChannelSpan(
        { type: "languageModelCall", event: augmentedEvent },
        wrappedExecute
      );
    },
    /**
     * Composes all `executeTool` wrappers around the original tool execution.
     * Each wrapper receives an `execute` function that calls the next wrapper in
     * the chain, so integrations can establish nested telemetry context before
     * delegating to the underlying tool.
     */
    executeTool: async ({ execute, ...event }) => {
      const augmentedEvent = augmentEvent(event, telemetryMetadata);
      let wrappedExecute = execute;
      for (const executeWrapper of executeToolWrappers) {
        const innerExecute = wrappedExecute;
        wrappedExecute = () => executeWrapper({ ...augmentedEvent, execute: innerExecute });
      }
      return await wrappedExecute();
    }
  };
}

// src/generate-text/reasoning.ts
function asReasoningText(reasoningParts) {
  const reasoningText = reasoningParts.map((part) => "text" in part ? part.text : "").join("");
  return reasoningText.length > 0 ? reasoningText : void 0;
}

// src/generate-text/step-result.ts
var DefaultStepResult = class {
  constructor({
    callId,
    stepNumber,
    provider,
    modelId,
    runtimeContext,
    toolsContext,
    content,
    finishReason,
    rawFinishReason,
    usage,
    performance,
    warnings,
    request,
    response,
    providerMetadata
  }) {
    this.callId = callId;
    this.stepNumber = stepNumber;
    this.model = { provider, modelId };
    this.runtimeContext = runtimeContext;
    this.toolsContext = toolsContext;
    this.content = content;
    this.finishReason = finishReason;
    this.rawFinishReason = rawFinishReason;
    this.usage = usage;
    this.performance = performance;
    this.warnings = warnings;
    this.request = request;
    this.response = response;
    this.providerMetadata = providerMetadata;
  }
  get text() {
    return this.content.filter((part) => part.type === "text").map((part) => part.text).join("");
  }
  get reasoning() {
    return convertFromReasoningOutputs(
      this.content.filter(
        (part) => part.type === "reasoning" || part.type === "reasoning-file"
      )
    );
  }
  get reasoningText() {
    return asReasoningText(this.reasoning);
  }
  get files() {
    return this.content.filter((part) => part.type === "file").map((part) => part.file);
  }
  get sources() {
    return this.content.filter((part) => part.type === "source");
  }
  get toolCalls() {
    return this.content.filter((part) => part.type === "tool-call");
  }
  get staticToolCalls() {
    return this.toolCalls.filter(
      (toolCall) => toolCall.dynamic !== true
    );
  }
  get dynamicToolCalls() {
    return this.toolCalls.filter(
      (toolCall) => toolCall.dynamic === true
    );
  }
  get toolResults() {
    return this.content.filter((part) => part.type === "tool-result");
  }
  get staticToolResults() {
    return this.toolResults.filter(
      (toolResult) => toolResult.dynamic !== true
    );
  }
  get dynamicToolResults() {
    return this.toolResults.filter(
      (toolResult) => toolResult.dynamic === true
    );
  }
};

// src/generate-text/restricted-telemetry-dispatcher.ts
function filterIncludedContext({
  context,
  includeContext
}) {
  if (context == null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(context).filter(
      ([key]) => (includeContext == null ? void 0 : includeContext[key]) === true
    )
  );
}
function restrictStepResult({
  step,
  includeRuntimeContext,
  includeToolsContext
}) {
  return new DefaultStepResult({
    callId: step.callId,
    stepNumber: step.stepNumber,
    provider: step.model.provider,
    modelId: step.model.modelId,
    runtimeContext: filterIncludedContext({
      context: step.runtimeContext,
      includeContext: includeRuntimeContext
    }),
    toolsContext: filterToolsContext({
      toolsContext: step.toolsContext,
      includeToolsContext
    }),
    content: step.content,
    finishReason: step.finishReason,
    rawFinishReason: step.rawFinishReason,
    usage: step.usage,
    performance: step.performance,
    warnings: step.warnings,
    request: step.request,
    response: step.response,
    providerMetadata: step.providerMetadata
  });
}
function filterToolsContext({
  toolsContext,
  includeToolsContext
}) {
  if (includeToolsContext == null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(toolsContext).map(([toolName, toolContext]) => [
      toolName,
      filterToolContext({
        toolName,
        toolContext,
        includeToolsContext
      })
    ])
  );
}
function filterToolContext({
  toolName,
  toolContext,
  includeToolsContext
}) {
  const includeToolContext = includeToolsContext == null ? void 0 : includeToolsContext[toolName];
  return filterIncludedContext({
    context: toolContext,
    includeContext: includeToolContext
  });
}
function createRestrictedTelemetryDispatcher({
  telemetry,
  includeRuntimeContext,
  includeToolsContext
}) {
  const telemetryDispatcher = createTelemetryDispatcher({ telemetry });
  return {
    ...telemetryDispatcher,
    onStart: (event) => {
      var _a22;
      return (_a22 = telemetryDispatcher.onStart) == null ? void 0 : _a22.call(telemetryDispatcher, {
        ...event,
        runtimeContext: filterIncludedContext({
          context: event.runtimeContext,
          includeContext: includeRuntimeContext
        }),
        toolsContext: filterToolsContext({
          toolsContext: event.toolsContext,
          includeToolsContext
        })
      });
    },
    onStepStart: (event) => {
      var _a22;
      return (_a22 = telemetryDispatcher.onStepStart) == null ? void 0 : _a22.call(telemetryDispatcher, {
        ...event,
        runtimeContext: filterIncludedContext({
          context: event.runtimeContext,
          includeContext: includeRuntimeContext
        }),
        steps: event.steps.map(
          (step) => restrictStepResult({
            step,
            includeRuntimeContext,
            includeToolsContext
          })
        ),
        toolsContext: filterToolsContext({
          toolsContext: event.toolsContext,
          includeToolsContext
        })
      });
    },
    onStepEnd: (event) => {
      var _a22;
      return (_a22 = telemetryDispatcher.onStepEnd) == null ? void 0 : _a22.call(
        telemetryDispatcher,
        restrictStepResult({
          step: event,
          includeRuntimeContext,
          includeToolsContext
        })
      );
    },
    onStepFinish: (event) => {
      var _a22;
      return (_a22 = telemetryDispatcher.onStepEnd) == null ? void 0 : _a22.call(
        telemetryDispatcher,
        restrictStepResult({
          step: event,
          includeRuntimeContext,
          includeToolsContext
        })
      );
    },
    onEnd: (event) => {
      var _a22;
      return (_a22 = telemetryDispatcher.onEnd) == null ? void 0 : _a22.call(
        telemetryDispatcher,
        ((restrictedSteps) => {
          return {
            ...event,
            runtimeContext: filterIncludedContext({
              context: event.runtimeContext,
              includeContext: includeRuntimeContext
            }),
            steps: restrictedSteps,
            finalStep: restrictedSteps.at(-1),
            toolsContext: filterToolsContext({
              toolsContext: event.toolsContext,
              includeToolsContext
            })
          };
        })(
          event.steps.map(
            (step) => restrictStepResult({
              step,
              includeRuntimeContext,
              includeToolsContext
            })
          )
        )
      );
    },
    onAbort: (event) => {
      var _a22;
      return (_a22 = telemetryDispatcher.onAbort) == null ? void 0 : _a22.call(telemetryDispatcher, {
        ...event,
        steps: event.steps.map(
          (step) => restrictStepResult({
            step,
            includeRuntimeContext,
            includeToolsContext
          })
        )
      });
    },
    onToolExecutionStart: (event) => {
      var _a22;
      return (_a22 = telemetryDispatcher.onToolExecutionStart) == null ? void 0 : _a22.call(telemetryDispatcher, {
        ...event,
        toolContext: filterToolContext({
          toolName: event.toolCall.toolName,
          toolContext: event.toolContext,
          includeToolsContext
        })
      });
    },
    onToolExecutionEnd: (event) => {
      var _a22;
      return (_a22 = telemetryDispatcher.onToolExecutionEnd) == null ? void 0 : _a22.call(telemetryDispatcher, {
        ...event,
        toolContext: filterToolContext({
          toolName: event.toolCall.toolName,
          toolContext: event.toolContext,
          includeToolsContext
        })
      });
    }
  };
}

// src/generate-text/stop-condition.ts
function isStepCount(stepCount) {
  return ({ steps }) => steps.length === stepCount;
}
function isLoopFinished() {
  return () => false;
}
function hasToolCall(...toolName) {
  return ({ steps }) => {
    var _a22, _b, _c;
    return (_c = (_b = (_a22 = steps[steps.length - 1]) == null ? void 0 : _a22.toolCalls) == null ? void 0 : _b.some(
      (toolCall) => toolName.includes(toolCall.toolName)
    )) != null ? _c : false;
  };
}
async function isStopConditionMet({
  stopConditions,
  steps
}) {
  return (await Promise.all(stopConditions.map((condition) => condition({ steps })))).some((result) => result);
}

// src/generate-text/sum-token-counts.ts
function sumTokenCounts(tokenCount1, tokenCount2) {
  return tokenCount1 == null && tokenCount2 == null ? void 0 : (tokenCount1 != null ? tokenCount1 : 0) + (tokenCount2 != null ? tokenCount2 : 0);
}

// src/generate-text/to-response-messages.ts
async function toResponseMessages({
  content: inputContent,
  tools
}) {
  const responseMessages = [];
  const toolCallOrder = /* @__PURE__ */ new Map();
  const content = [];
  for (const part of inputContent) {
    if (part.type === "source") {
      continue;
    }
    if ((part.type === "tool-result" || part.type === "tool-error") && !part.providerExecuted) {
      continue;
    }
    if (part.type === "text" && part.text.length === 0) {
      continue;
    }
    switch (part.type) {
      case "text":
        content.push({
          type: "text",
          text: part.text,
          providerOptions: part.providerMetadata
        });
        break;
      case "custom":
        content.push({
          type: "custom",
          kind: part.kind,
          providerOptions: part.providerMetadata
        });
        break;
      case "reasoning":
        content.push({
          type: "reasoning",
          text: part.text,
          providerOptions: part.providerMetadata
        });
        break;
      case "file":
        content.push({
          type: "file",
          data: part.file.base64,
          mediaType: part.file.mediaType,
          providerOptions: part.providerMetadata
        });
        break;
      case "reasoning-file":
        content.push({
          type: "reasoning-file",
          data: part.file.base64,
          mediaType: part.file.mediaType,
          providerOptions: part.providerMetadata
        });
        break;
      case "tool-call":
        if (!toolCallOrder.has(part.toolCallId)) {
          toolCallOrder.set(part.toolCallId, toolCallOrder.size);
        }
        content.push({
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.invalid && typeof part.input !== "object" ? {} : part.input,
          providerExecuted: part.providerExecuted,
          providerOptions: part.providerMetadata
        });
        break;
      case "tool-result": {
        const output = await createToolModelOutput({
          toolCallId: part.toolCallId,
          input: part.input,
          tool: getOwn(tools, part.toolName),
          output: part.output,
          errorMode: "none"
        });
        content.push({
          type: "tool-result",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output,
          providerOptions: part.providerMetadata
        });
        break;
      }
      case "tool-error": {
        const output = await createToolModelOutput({
          toolCallId: part.toolCallId,
          input: part.input,
          tool: getOwn(tools, part.toolName),
          output: part.error,
          errorMode: "json"
        });
        content.push({
          type: "tool-result",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output,
          providerOptions: part.providerMetadata
        });
        break;
      }
      case "tool-approval-request":
        content.push({
          type: "tool-approval-request",
          approvalId: part.approvalId,
          toolCallId: part.toolCall.toolCallId,
          isAutomatic: part.isAutomatic,
          ...part.signature != null ? { signature: part.signature } : {}
        });
        break;
    }
  }
  if (content.length > 0) {
    responseMessages.push({
      role: "assistant",
      content
    });
  }
  const toolResultContent = [];
  for (const part of inputContent) {
    if (part.type !== "tool-approval-response" && part.type !== "tool-result" && part.type !== "tool-error") {
      continue;
    }
    if (part.type === "tool-approval-response") {
      toolResultContent.push({
        type: "tool-approval-response",
        approvalId: part.approvalId,
        approved: part.approved,
        reason: part.reason,
        providerExecuted: part.providerExecuted
      });
      if (part.approved === false) {
        toolResultContent.push({
          type: "tool-result",
          toolCallId: part.toolCall.toolCallId,
          toolName: part.toolCall.toolName,
          output: {
            type: "execution-denied",
            reason: part.reason
          }
        });
      }
      continue;
    }
    if (part.providerExecuted) {
      continue;
    }
    const output = await createToolModelOutput({
      toolCallId: part.toolCallId,
      input: part.input,
      tool: getOwn(tools, part.toolName),
      output: part.type === "tool-result" ? part.output : part.error,
      errorMode: part.type === "tool-error" ? "text" : "none"
    });
    toolResultContent.push({
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      output,
      ...part.providerMetadata != null ? { providerOptions: part.providerMetadata } : {}
    });
  }
  if (toolResultContent.length > 0) {
    responseMessages.push({
      role: "tool",
      content: sortToolResultContentByToolCallOrder({
        toolResultContent,
        toolCallOrder
      })
    });
  }
  return responseMessages;
}
function sortToolResultContentByToolCallOrder({
  toolResultContent,
  toolCallOrder
}) {
  const sortedToolResults = toolResultContent.filter((part) => part.type === "tool-result").map((part, index) => ({ part, index })).sort((a, b) => {
    const aOrder = toolCallOrder.get(a.part.toolCallId);
    const bOrder = toolCallOrder.get(b.part.toolCallId);
    if (aOrder == null && bOrder == null) {
      return a.index - b.index;
    }
    if (aOrder == null) {
      return 1;
    }
    if (bOrder == null) {
      return -1;
    }
    return aOrder - bOrder || a.index - b.index;
  }).map(({ part }) => part);
  let toolResultIndex = 0;
  return toolResultContent.map(
    (part) => part.type === "tool-result" ? sortedToolResults[toolResultIndex++] : part
  );
}

// src/generate-text/tool-approval-signature.ts
import { convertBase64ToUint8Array as convertBase64ToUint8Array2 } from "@ai-sdk/provider-utils";

// src/util/canonical-hash.ts
import { convertUint8ArrayToBase64 as convertUint8ArrayToBase642 } from "@ai-sdk/provider-utils";
var encoder = new TextEncoder();
function canonicalJSON(value) {
  if (value === null || value === void 0) {
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSON).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`
  );
  return `{${entries.join(",")}}`;
}
function toBase64url(bytes) {
  return convertUint8ArrayToBase642(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function hashCanonical(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(canonicalJSON(value))
  );
  return toBase64url(new Uint8Array(digest));
}

// src/generate-text/tool-approval-signature.ts
var encoder2 = new TextEncoder();
function fromBase64url(str) {
  return convertBase64ToUint8Array2(str);
}
async function importKey(secret) {
  const keyData = typeof secret === "string" ? encoder2.encode(secret) : secret;
  return crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}
function buildPayload(approvalId, toolCallId, toolName, inputDigest) {
  return encoder2.encode(
    JSON.stringify([
      "ai-sdk-tool-approval-v1",
      approvalId,
      toolCallId,
      toolName,
      inputDigest
    ])
  );
}
function buildLegacyPayload(approvalId, toolCallId, toolName, inputDigest) {
  return encoder2.encode(
    `${approvalId}
${toolCallId}
${toolName}
${inputDigest}`
  );
}
async function signToolApproval({
  secret,
  approvalId,
  toolCallId,
  toolName,
  input
}) {
  const key = await importKey(secret);
  const inputDigest = await hashCanonical(input);
  const payload = buildPayload(approvalId, toolCallId, toolName, inputDigest);
  const sig = await crypto.subtle.sign("HMAC", key, payload);
  return toBase64url(new Uint8Array(sig));
}
async function verifyToolApprovalSignature({
  secret,
  signature,
  approvalId,
  toolCallId,
  toolName,
  input
}) {
  const key = await importKey(secret);
  const inputDigest = await hashCanonical(input);
  const sigBytes = fromBase64url(signature);
  const payload = buildPayload(approvalId, toolCallId, toolName, inputDigest);
  if (await crypto.subtle.verify("HMAC", key, sigBytes, payload)) {
    return true;
  }
  if (!approvalId.includes("\n") && !toolCallId.includes("\n") && !toolName.includes("\n")) {
    const legacyPayload = buildLegacyPayload(
      approvalId,
      toolCallId,
      toolName,
      inputDigest
    );
    return crypto.subtle.verify("HMAC", key, sigBytes, legacyPayload);
  }
  return false;
}
async function maybeSignApproval({
  secret,
  approvalId,
  toolCallId,
  toolName,
  input
}) {
  if (secret == null)
    return void 0;
  return signToolApproval({ secret, approvalId, toolCallId, toolName, input });
}

// src/generate-text/validate-tool-approvals.ts
import {
  asSchema as asSchema4,
  isExecutableTool as isExecutableTool2,
  safeValidateTypes as safeValidateTypes4
} from "@ai-sdk/provider-utils";
async function validateApprovedToolApprovals({
  approvedToolApprovals,
  tools,
  toolApproval,
  messages,
  toolsContext,
  runtimeContext,
  toolApprovalSecret
}) {
  var _a22;
  const approved = [];
  const denied = [];
  for (const approval of approvedToolApprovals) {
    const { toolCall, approvalRequest } = approval;
    const tool2 = getOwn(tools, toolCall.toolName);
    if (toolApprovalSecret != null) {
      if (approvalRequest.signature == null) {
        throw new InvalidToolApprovalSignatureError({
          approvalId: approvalRequest.approvalId,
          toolCallId: toolCall.toolCallId,
          reason: "missing signature"
        });
      }
      const valid = await verifyToolApprovalSignature({
        secret: toolApprovalSecret,
        signature: approvalRequest.signature,
        approvalId: approvalRequest.approvalId,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: toolCall.input
      });
      if (!valid) {
        throw new InvalidToolApprovalSignatureError({
          approvalId: approvalRequest.approvalId,
          toolCallId: toolCall.toolCallId,
          reason: "invalid signature"
        });
      }
    }
    if (isExecutableTool2(tool2) && tool2.inputSchema != null) {
      const validation = await safeValidateTypes4({
        value: toolCall.input,
        schema: asSchema4(tool2.inputSchema)
      });
      if (!validation.success) {
        throw new InvalidToolInputError({
          toolName: toolCall.toolName,
          toolInput: JSON.stringify(toolCall.input),
          cause: validation.error
        });
      }
    }
    const approvalStatus = await resolveToolApproval({
      tools,
      toolApproval,
      toolCall,
      messages,
      toolsContext,
      runtimeContext
    });
    if (approvalStatus.type === "denied") {
      denied.push({
        ...approval,
        approvalResponse: {
          ...approval.approvalResponse,
          approved: false,
          reason: (_a22 = approvalStatus.reason) != null ? _a22 : approval.approvalResponse.reason
        }
      });
    } else {
      approved.push(approval);
    }
  }
  return { approvedToolApprovals: approved, deniedToolApprovals: denied };
}

// src/generate-text/generate-text.ts
var originalGenerateId = createIdGenerator({
  prefix: "aitxt",
  size: 24
});
var originalGenerateCallId = createIdGenerator({
  prefix: "call",
  size: 24
});
async function generateText({
  model: modelArg,
  tools,
  toolChoice,
  instructions,
  system,
  prompt,
  messages,
  allowSystemInMessages,
  maxRetries: maxRetriesArg,
  abortSignal,
  timeout,
  headers,
  stopWhen = isStepCount(1),
  experimental_sandbox: sandbox,
  output,
  toolApproval,
  experimental_toolApprovalSecret,
  experimental_telemetry,
  telemetry = experimental_telemetry,
  providerOptions,
  activeTools,
  toolOrder,
  prepareStep,
  experimental_repairToolCall,
  repairToolCall = experimental_repairToolCall,
  experimental_refineToolInput: refineToolInput,
  experimental_download: download2,
  runtimeContext = {},
  toolsContext = {},
  experimental_include,
  include = experimental_include,
  _internal: {
    generateId: generateId2 = originalGenerateId,
    generateCallId = originalGenerateCallId,
    now: now2 = now
  } = {},
  onStart,
  experimental_onStart,
  onStepStart,
  experimental_onStepStart,
  onLanguageModelCallStart,
  experimental_onLanguageModelCallStart,
  onLanguageModelCallEnd,
  experimental_onLanguageModelCallEnd,
  onToolExecutionStart,
  onToolExecutionEnd,
  experimental_onToolCallStart,
  experimental_onToolCallFinish,
  onStepEnd,
  onStepFinish,
  onFinish,
  onEnd = onFinish,
  ...settings
}) {
  var _a22, _b, _c, _d;
  include = {
    requestBody: (_a22 = include == null ? void 0 : include.requestBody) != null ? _a22 : false,
    requestMessages: (_b = include == null ? void 0 : include.requestMessages) != null ? _b : false,
    responseBody: (_c = include == null ? void 0 : include.responseBody) != null ? _c : false
  };
  const model = resolveLanguageModel(modelArg);
  const stopConditions = asArray5(stopWhen);
  const resolvedOnStart = onStart != null ? onStart : experimental_onStart;
  const resolvedOnStepStart = onStepStart != null ? onStepStart : experimental_onStepStart;
  const resolvedOnLanguageModelCallStart = onLanguageModelCallStart != null ? onLanguageModelCallStart : experimental_onLanguageModelCallStart;
  const resolvedOnLanguageModelCallEnd = onLanguageModelCallEnd != null ? onLanguageModelCallEnd : experimental_onLanguageModelCallEnd;
  const resolvedOnToolExecutionStart = onToolExecutionStart != null ? onToolExecutionStart : experimental_onToolCallStart;
  const resolvedOnToolExecutionEnd = onToolExecutionEnd != null ? onToolExecutionEnd : experimental_onToolCallFinish;
  const resolvedOnStepEnd = onStepEnd != null ? onStepEnd : onStepFinish;
  const totalTimeoutMs = getTotalTimeoutMs(timeout);
  const stepTimeoutMs = getStepTimeoutMs(timeout);
  const stepAbortController = stepTimeoutMs != null ? new AbortController() : void 0;
  const mergedAbortSignal = mergeAbortSignals(
    abortSignal,
    totalTimeoutMs,
    stepAbortController == null ? void 0 : stepAbortController.signal
  );
  const { maxRetries, retry } = prepareRetries({
    maxRetries: maxRetriesArg,
    abortSignal: mergedAbortSignal
  });
  const callSettings = prepareLanguageModelCallOptions(settings);
  const headersWithUserAgent = withUserAgentSuffix2(
    headers != null ? headers : {},
    `ai/${VERSION}`
  );
  const initialPrompt = await standardizePrompt({
    instructions,
    system,
    prompt,
    messages,
    allowSystemInMessages
  });
  const callId = generateCallId();
  const telemetryDispatcher = createRestrictedTelemetryDispatcher({
    telemetry,
    includeRuntimeContext: telemetry == null ? void 0 : telemetry.includeRuntimeContext,
    includeToolsContext: telemetry == null ? void 0 : telemetry.includeToolsContext
  });
  const runInTracingChannelSpan = (_d = telemetryDispatcher.runInTracingChannelSpan) != null ? _d : async ({ execute }) => await execute();
  const generateTextStartEvent = {
    callId,
    operationId: "ai.generateText",
    provider: model.provider,
    modelId: model.modelId,
    instructions: initialPrompt.instructions,
    messages: initialPrompt.messages,
    tools,
    toolChoice,
    activeTools,
    toolOrder,
    maxOutputTokens: callSettings.maxOutputTokens,
    temperature: callSettings.temperature,
    topP: callSettings.topP,
    topK: callSettings.topK,
    presencePenalty: callSettings.presencePenalty,
    frequencyPenalty: callSettings.frequencyPenalty,
    stopSequences: callSettings.stopSequences,
    seed: callSettings.seed,
    reasoning: callSettings.reasoning,
    maxRetries,
    timeout,
    headers: headersWithUserAgent,
    providerOptions,
    output,
    runtimeContext,
    toolsContext
  };
  const executeGenerateText = async () => {
    var _a23;
    await notify({
      event: generateTextStartEvent,
      callbacks: [resolvedOnStart, telemetryDispatcher.onStart]
    });
    try {
      const initialMessages = initialPrompt.messages;
      const initialResponseMessages = [];
      const {
        approvedToolApprovals,
        deniedToolApprovals: collectedDeniedToolApprovals
      } = collectToolApprovals({ messages: initialMessages });
      const {
        approvedToolApprovals: localApprovedToolApprovals,
        deniedToolApprovals: revalidationDeniedToolApprovals
      } = await validateApprovedToolApprovals({
        approvedToolApprovals: approvedToolApprovals.filter(
          (toolApproval2) => !toolApproval2.toolCall.providerExecuted
        ),
        tools,
        toolApproval,
        messages: initialMessages,
        toolsContext,
        runtimeContext,
        toolApprovalSecret: experimental_toolApprovalSecret
      });
      const deniedToolApprovals = [
        ...collectedDeniedToolApprovals,
        ...revalidationDeniedToolApprovals
      ];
      const deniedToolApprovalsWithoutResults = deniedToolApprovals.filter(
        (toolApproval2) => toolApproval2.existingToolResult == null
      );
      if (deniedToolApprovalsWithoutResults.length > 0 || localApprovedToolApprovals.length > 0) {
        const toolResults2 = await executeTools({
          toolCalls: localApprovedToolApprovals.map(
            (toolApproval2) => toolApproval2.toolCall
          ),
          tools,
          callId,
          messages: initialMessages,
          abortSignal: mergedAbortSignal,
          timeout,
          experimental_sandbox: sandbox,
          toolsContext,
          onToolExecutionStart: (event) => notify({
            event,
            callbacks: [
              resolvedOnToolExecutionStart,
              telemetryDispatcher.onToolExecutionStart
            ]
          }),
          onToolExecutionEnd: (event) => notify({
            event,
            callbacks: [
              resolvedOnToolExecutionEnd,
              telemetryDispatcher.onToolExecutionEnd
            ]
          }),
          executeToolInTelemetryContext: telemetryDispatcher.executeTool,
          runInTracingChannelSpan
        });
        const toolContent = [];
        for (const result of toolResults2) {
          const output2 = result.output;
          const modelOutput = await createToolModelOutput({
            toolCallId: output2.toolCallId,
            input: output2.input,
            tool: getOwn(tools, output2.toolName),
            output: output2.type === "tool-result" ? output2.output : output2.error,
            errorMode: output2.type === "tool-error" ? "text" : "none"
          });
          toolContent.push({
            type: "tool-result",
            toolCallId: output2.toolCallId,
            toolName: output2.toolName,
            output: modelOutput
          });
        }
        for (const toolApproval2 of deniedToolApprovalsWithoutResults) {
          toolContent.push({
            type: "tool-result",
            toolCallId: toolApproval2.toolCall.toolCallId,
            toolName: toolApproval2.toolCall.toolName,
            output: {
              type: "execution-denied",
              reason: toolApproval2.approvalResponse.reason,
              // For provider-executed tools, include approvalId so provider can correlate
              ...toolApproval2.toolCall.providerExecuted && {
                providerOptions: {
                  openai: {
                    approvalId: toolApproval2.approvalResponse.approvalId
                  }
                }
              }
            }
          });
        }
        initialResponseMessages.push({
          role: "tool",
          content: toolContent
        });
      }
      const callSettings2 = prepareLanguageModelCallOptions(settings);
      let currentModelResponse;
      let clientToolCalls = [];
      let clientToolOutputs = [];
      let toolApprovalResponses = [];
      let deniedToolApprovalResponses = [];
      const steps = [];
      let instructionsForNextStep = initialPrompt.instructions;
      let messagesForNextStep = [
        ...initialMessages,
        ...initialResponseMessages
      ];
      const pendingDeferredToolCalls = /* @__PURE__ */ new Map();
      do {
        if (steps.length > 0) {
          mergedAbortSignal == null ? void 0 : mergedAbortSignal.throwIfAborted();
        }
        const stepTimeoutId = setAbortTimeout({
          abortController: stepAbortController,
          label: "Step",
          timeoutMs: stepTimeoutMs
        });
        const stepNumber = steps.length;
        try {
          await runInTracingChannelSpan({
            type: "step",
            event: { callId, stepNumber },
            execute: async () => {
              var _a24, _b2, _c2, _d2, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q;
              const accumulatedResponseMessages = [
                ...initialResponseMessages,
                ...steps.flatMap((step) => step.response.messages)
              ];
              const stepInputMessages = messagesForNextStep;
              const prepareStepResult = await (prepareStep == null ? void 0 : prepareStep({
                model,
                steps,
                stepNumber: steps.length,
                instructions: instructionsForNextStep,
                initialInstructions: initialPrompt.instructions,
                messages: stepInputMessages,
                initialMessages,
                responseMessages: accumulatedResponseMessages,
                runtimeContext,
                toolsContext,
                experimental_sandbox: sandbox
              }));
              const stepSandbox = (_a24 = prepareStepResult == null ? void 0 : prepareStepResult.experimental_sandbox) != null ? _a24 : sandbox;
              const stepModel = resolveLanguageModel(
                (_b2 = prepareStepResult == null ? void 0 : prepareStepResult.model) != null ? _b2 : model
              );
              const stepInstructions = (_d2 = (_c2 = prepareStepResult == null ? void 0 : prepareStepResult.instructions) != null ? _c2 : prepareStepResult == null ? void 0 : prepareStepResult.system) != null ? _d2 : instructionsForNextStep;
              const promptMessages = await convertToLanguageModelPrompt({
                prompt: {
                  instructions: stepInstructions,
                  messages: (_e = prepareStepResult == null ? void 0 : prepareStepResult.messages) != null ? _e : stepInputMessages
                },
                supportedUrls: await stepModel.supportedUrls,
                download: download2,
                provider: stepModel.provider.split(".")[0]
              });
              runtimeContext = (_f = prepareStepResult == null ? void 0 : prepareStepResult.runtimeContext) != null ? _f : runtimeContext;
              toolsContext = (_g = prepareStepResult == null ? void 0 : prepareStepResult.toolsContext) != null ? _g : toolsContext;
              const stepActiveTools = filterActiveTools({
                tools,
                activeTools: (_h = prepareStepResult == null ? void 0 : prepareStepResult.activeTools) != null ? _h : activeTools
              });
              const stepToolOrder = (_i = prepareStepResult == null ? void 0 : prepareStepResult.toolOrder) != null ? _i : toolOrder;
              const stepTools = await prepareTools({
                tools: stepActiveTools,
                toolOrder: stepToolOrder,
                // active tools context is a subset of the tools context, so we can cast to the unknown type
                toolsContext,
                experimental_sandbox: stepSandbox
              });
              const stepToolChoice = prepareToolChoice({
                toolChoice: (_j = prepareStepResult == null ? void 0 : prepareStepResult.toolChoice) != null ? _j : toolChoice
              });
              const stepMessages = (_k = prepareStepResult == null ? void 0 : prepareStepResult.messages) != null ? _k : stepInputMessages;
              const stepProviderOptions = mergeObjects(
                providerOptions,
                prepareStepResult == null ? void 0 : prepareStepResult.providerOptions
              );
              await notify({
                event: {
                  callId,
                  provider: stepModel.provider,
                  modelId: stepModel.modelId,
                  stepNumber,
                  instructions: stepInstructions,
                  messages: stepMessages,
                  tools,
                  toolChoice: (_l = prepareStepResult == null ? void 0 : prepareStepResult.toolChoice) != null ? _l : toolChoice,
                  activeTools: (_m = prepareStepResult == null ? void 0 : prepareStepResult.activeTools) != null ? _m : activeTools,
                  toolOrder: stepToolOrder,
                  steps: [...steps],
                  providerOptions: stepProviderOptions,
                  output,
                  runtimeContext,
                  promptMessages,
                  stepTools,
                  stepToolChoice,
                  toolsContext
                },
                callbacks: [
                  resolvedOnStepStart,
                  telemetryDispatcher.onStepStart
                ]
              });
              const languageModelCallContext = {
                provider: stepModel.provider,
                modelId: stepModel.modelId,
                instructions: stepInstructions,
                messages: stepMessages,
                tools: stepTools,
                ...callSettings2
              };
              const languageModelCallStartEvent = {
                callId,
                ...languageModelCallContext
              };
              const stepStartTimestampMs = now2();
              await notify({
                event: languageModelCallStartEvent,
                callbacks: [
                  resolvedOnLanguageModelCallStart,
                  telemetryDispatcher.onLanguageModelCallStart
                ]
              });
              const executeLanguageModelCallInTelemetryContext = (_n = telemetryDispatcher.executeLanguageModelCall) != null ? _n : async ({ execute }) => await execute();
              currentModelResponse = await retry(async () => {
                var _a25, _b3, _c3, _d3, _e2, _f2, _g2, _h2;
                const result = await executeLanguageModelCallInTelemetryContext(
                  {
                    ...languageModelCallStartEvent,
                    execute: async () => await stepModel.doGenerate({
                      ...callSettings2,
                      tools: stepTools,
                      toolChoice: stepToolChoice,
                      responseFormat: await (output == null ? void 0 : output.responseFormat),
                      prompt: promptMessages,
                      providerOptions: stepProviderOptions,
                      abortSignal: mergedAbortSignal,
                      headers: headersWithUserAgent
                    })
                  }
                );
                const responseData = {
                  id: (_b3 = (_a25 = result.response) == null ? void 0 : _a25.id) != null ? _b3 : generateId2(),
                  timestamp: (_d3 = (_c3 = result.response) == null ? void 0 : _c3.timestamp) != null ? _d3 : /* @__PURE__ */ new Date(),
                  modelId: (_f2 = (_e2 = result.response) == null ? void 0 : _e2.modelId) != null ? _f2 : stepModel.modelId,
                  headers: (_g2 = result.response) == null ? void 0 : _g2.headers,
                  body: (_h2 = result.response) == null ? void 0 : _h2.body
                };
                return { ...result, response: responseData };
              });
              const responseTimeMs = now2() - stepStartTimestampMs;
              const stepUsage = asLanguageModelUsage(
                currentModelResponse.usage
              );
              const stepToolCalls = await Promise.all(
                currentModelResponse.content.filter(
                  (part) => part.type === "tool-call"
                ).map(
                  (toolCall) => parseToolCall({
                    toolCall,
                    tools,
                    repairToolCall,
                    refineToolInput,
                    instructions: stepInstructions,
                    messages: stepMessages
                  })
                )
              );
              const toolApprovalRequests = {};
              const stepToolApprovalResponses = {};
              const blockedToolCallIds = /* @__PURE__ */ new Set();
              const modelCallContent = asContent({
                content: currentModelResponse.content,
                toolCalls: stepToolCalls,
                toolOutputs: [],
                toolApprovalRequests: [],
                toolApprovalResponses: [],
                tools
              });
              await notify({
                event: {
                  callId,
                  provider: stepModel.provider,
                  modelId: stepModel.modelId,
                  finishReason: currentModelResponse.finishReason.unified,
                  usage: stepUsage,
                  content: modelCallContent,
                  responseId: currentModelResponse.response.id,
                  performance: {
                    responseTimeMs,
                    effectiveOutputTokensPerSecond: calculateTokensPerSecond({
                      tokens: stepUsage.outputTokens,
                      durationMs: responseTimeMs
                    }),
                    outputTokensPerSecond: void 0,
                    inputTokensPerSecond: void 0,
                    effectiveTotalTokensPerSecond: calculateTokensPerSecond({
                      tokens: sumTokenCounts(
                        stepUsage.inputTokens,
                        stepUsage.outputTokens
                      ),
                      durationMs: responseTimeMs
                    }),
                    timeToFirstOutputMs: void 0
                  }
                },
                callbacks: [
                  resolvedOnLanguageModelCallEnd,
                  telemetryDispatcher.onLanguageModelCallEnd
                ]
              });
              for (const toolCall of stepToolCalls) {
                if (toolCall.invalid) {
                  continue;
                }
                const tool2 = getOwn(tools, toolCall.toolName);
                if (tool2 == null) {
                  continue;
                }
                if (tool2.onInputStart != null) {
                  await tool2.onInputStart({
                    toolCallId: toolCall.toolCallId,
                    messages: stepMessages,
                    abortSignal: mergedAbortSignal,
                    context: runtimeContext
                  });
                }
                if ((tool2 == null ? void 0 : tool2.onInputAvailable) != null) {
                  await tool2.onInputAvailable({
                    input: toolCall.input,
                    toolCallId: toolCall.toolCallId,
                    messages: stepMessages,
                    abortSignal: mergedAbortSignal,
                    context: runtimeContext
                  });
                }
                const toolApprovalStatus = await resolveToolApproval({
                  tools,
                  toolApproval,
                  toolCall,
                  messages: stepMessages,
                  toolsContext,
                  runtimeContext
                });
                if (toolApprovalStatus.type === "not-applicable") {
                  continue;
                }
                const approvalId = generateId2();
                const signature = await maybeSignApproval({
                  secret: experimental_toolApprovalSecret,
                  approvalId,
                  toolCallId: toolCall.toolCallId,
                  toolName: toolCall.toolName,
                  input: toolCall.input
                });
                switch (toolApprovalStatus.type) {
                  case "user-approval": {
                    toolApprovalRequests[toolCall.toolCallId] = {
                      type: "tool-approval-request",
                      approvalId,
                      toolCall,
                      ...signature != null ? { signature } : {}
                    };
                    blockedToolCallIds.add(toolCall.toolCallId);
                    break;
                  }
                  case "approved": {
                    toolApprovalRequests[toolCall.toolCallId] = {
                      type: "tool-approval-request",
                      approvalId,
                      toolCall,
                      isAutomatic: true,
                      ...signature != null ? { signature } : {}
                    };
                    stepToolApprovalResponses[toolCall.toolCallId] = {
                      type: "tool-approval-response",
                      approvalId,
                      toolCall,
                      approved: true,
                      reason: toolApprovalStatus.reason,
                      providerExecuted: toolCall.providerExecuted
                    };
                    break;
                  }
                  case "denied": {
                    toolApprovalRequests[toolCall.toolCallId] = {
                      type: "tool-approval-request",
                      approvalId,
                      toolCall,
                      isAutomatic: true,
                      ...signature != null ? { signature } : {}
                    };
                    stepToolApprovalResponses[toolCall.toolCallId] = {
                      type: "tool-approval-response",
                      approvalId,
                      toolCall,
                      approved: false,
                      reason: toolApprovalStatus.reason,
                      providerExecuted: toolCall.providerExecuted
                    };
                    blockedToolCallIds.add(toolCall.toolCallId);
                    break;
                  }
                }
              }
              const invalidToolCalls = stepToolCalls.filter(
                (toolCall) => toolCall.invalid && toolCall.dynamic
              );
              clientToolOutputs = [];
              for (const toolCall of invalidToolCalls) {
                clientToolOutputs.push({
                  type: "tool-error",
                  toolCallId: toolCall.toolCallId,
                  toolName: toolCall.toolName,
                  input: toolCall.input,
                  error: getErrorMessage4(toolCall.error),
                  dynamic: true
                });
              }
              clientToolCalls = stepToolCalls.filter(
                (toolCall) => !toolCall.providerExecuted
              );
              toolApprovalResponses = Object.values(stepToolApprovalResponses);
              deniedToolApprovalResponses = toolApprovalResponses.filter(
                (toolApprovalResponse) => toolApprovalResponse.approved === false
              );
              const toolExecutionMs = {};
              if (tools != null) {
                const toolExecutionResults = await executeTools({
                  toolCalls: clientToolCalls.filter(
                    (toolCall) => !toolCall.invalid && !blockedToolCallIds.has(toolCall.toolCallId)
                  ),
                  tools,
                  callId,
                  messages: stepMessages,
                  abortSignal: mergedAbortSignal,
                  timeout,
                  experimental_sandbox: stepSandbox,
                  toolsContext,
                  onToolExecutionStart: (event) => notify({
                    event,
                    callbacks: [
                      resolvedOnToolExecutionStart,
                      telemetryDispatcher.onToolExecutionStart
                    ]
                  }),
                  onToolExecutionEnd: (event) => notify({
                    event,
                    callbacks: [
                      resolvedOnToolExecutionEnd,
                      telemetryDispatcher.onToolExecutionEnd
                    ]
                  }),
                  executeToolInTelemetryContext: telemetryDispatcher.executeTool,
                  runInTracingChannelSpan
                });
                for (const result of toolExecutionResults) {
                  toolExecutionMs[result.output.toolCallId] = result.toolExecutionMs;
                  clientToolOutputs.push(result.output);
                }
              }
              const stepTimeMs = now2() - stepStartTimestampMs;
              const stepPerformance = {
                effectiveOutputTokensPerSecond: calculateTokensPerSecond({
                  tokens: stepUsage.outputTokens,
                  durationMs: responseTimeMs
                }),
                outputTokensPerSecond: void 0,
                inputTokensPerSecond: void 0,
                effectiveTotalTokensPerSecond: calculateTokensPerSecond({
                  tokens: sumTokenCounts(
                    stepUsage.inputTokens,
                    stepUsage.outputTokens
                  ),
                  durationMs: responseTimeMs
                }),
                stepTimeMs,
                responseTimeMs,
                toolExecutionMs,
                timeToFirstOutputMs: void 0
              };
              for (const toolCall of stepToolCalls) {
                if (!toolCall.providerExecuted)
                  continue;
                const tool2 = getOwn(tools, toolCall.toolName);
                if ((tool2 == null ? void 0 : tool2.type) === "provider" && tool2.supportsDeferredResults) {
                  const hasResultInResponse = currentModelResponse.content.some(
                    (part) => part.type === "tool-result" && part.toolCallId === toolCall.toolCallId
                  );
                  if (!hasResultInResponse) {
                    pendingDeferredToolCalls.set(toolCall.toolCallId, {
                      toolName: toolCall.toolName
                    });
                  }
                }
              }
              for (const part of currentModelResponse.content) {
                if (part.type === "tool-result") {
                  pendingDeferredToolCalls.delete(part.toolCallId);
                }
              }
              const stepContent = asContent({
                content: currentModelResponse.content,
                toolCalls: stepToolCalls,
                toolOutputs: clientToolOutputs,
                toolApprovalRequests: Object.values(toolApprovalRequests),
                toolApprovalResponses,
                tools
              });
              const stepResponseMessages = await toResponseMessages({
                content: stepContent,
                tools
              });
              const stepRequest = {
                ...currentModelResponse.request,
                body: include.requestBody ? (_o = currentModelResponse.request) == null ? void 0 : _o.body : void 0,
                messages: include.requestMessages ? cloneModelMessages(stepMessages) : void 0
              };
              const stepResponse = {
                ...currentModelResponse.response,
                // deep clone msgs to avoid mutating step results in multi-step:
                messages: cloneModelMessages(stepResponseMessages),
                // Conditionally include response body:
                body: include.responseBody ? (_p = currentModelResponse.response) == null ? void 0 : _p.body : void 0
              };
              const currentStepResult = new DefaultStepResult({
                callId,
                stepNumber,
                provider: stepModel.provider,
                modelId: stepModel.modelId,
                runtimeContext,
                content: stepContent,
                finishReason: currentModelResponse.finishReason.unified,
                rawFinishReason: currentModelResponse.finishReason.raw,
                usage: stepUsage,
                performance: stepPerformance,
                warnings: currentModelResponse.warnings,
                providerMetadata: currentModelResponse.providerMetadata,
                request: stepRequest,
                response: stepResponse,
                toolsContext
              });
              logWarnings({
                warnings: (_q = currentModelResponse.warnings) != null ? _q : [],
                provider: stepModel.provider,
                model: stepModel.modelId
              });
              steps.push(currentStepResult);
              instructionsForNextStep = stepInstructions;
              messagesForNextStep = [...stepMessages, ...stepResponseMessages];
              await notify({
                event: currentStepResult,
                callbacks: [resolvedOnStepEnd, telemetryDispatcher.onStepEnd]
              });
              return currentStepResult;
            }
          });
        } finally {
          if (stepTimeoutId != null) {
            clearTimeout(stepTimeoutId);
          }
        }
      } while (
        // Continue if:
        // 1. There are client tool calls that have all been executed or denied, OR
        // 2. There are pending deferred results from provider-executed tools
        (clientToolCalls.length > 0 && clientToolOutputs.length + deniedToolApprovalResponses.length === clientToolCalls.length || pendingDeferredToolCalls.size > 0) && // continue until a stop condition is met:
        !await isStopConditionMet({ stopConditions, steps })
      );
      const lastStep = steps[steps.length - 1];
      const totalUsage = steps.reduce(
        (totalUsage2, step) => {
          return addLanguageModelUsage(totalUsage2, step.usage);
        },
        {
          inputTokens: void 0,
          inputTokenDetails: {
            noCacheTokens: void 0,
            cacheReadTokens: void 0,
            cacheWriteTokens: void 0
          },
          outputTokens: void 0,
          outputTokenDetails: {
            textTokens: void 0,
            reasoningTokens: void 0
          },
          totalTokens: void 0
        }
      );
      const files = steps.flatMap((step) => step.files);
      const sources = steps.flatMap((step) => step.sources);
      const toolCalls = steps.flatMap((step) => step.toolCalls);
      const staticToolCalls = steps.flatMap((step) => step.staticToolCalls);
      const dynamicToolCalls = steps.flatMap((step) => step.dynamicToolCalls);
      const toolResults = steps.flatMap((step) => step.toolResults);
      const staticToolResults = steps.flatMap((step) => step.staticToolResults);
      const dynamicToolResults = steps.flatMap((step) => step.dynamicToolResults);
      const warnings = steps.flatMap((step) => {
        var _a24;
        return (_a24 = step.warnings) != null ? _a24 : [];
      });
      const onEndEvent = {
        callId,
        stepNumber: lastStep.stepNumber,
        model: lastStep.model,
        runtimeContext: lastStep.runtimeContext,
        finishReason: lastStep.finishReason,
        rawFinishReason: lastStep.rawFinishReason,
        usage: totalUsage,
        totalUsage,
        content: steps.flatMap((step) => step.content),
        text: lastStep.text,
        reasoning: lastStep.reasoning,
        reasoningText: lastStep.reasoningText,
        files,
        sources,
        toolCalls,
        staticToolCalls,
        dynamicToolCalls,
        toolResults,
        staticToolResults,
        dynamicToolResults,
        responseMessages: [
          ...initialResponseMessages,
          ...steps.flatMap((step) => step.response.messages)
        ],
        warnings,
        request: lastStep.request,
        response: lastStep.response,
        providerMetadata: lastStep.providerMetadata,
        steps,
        finalStep: lastStep,
        toolsContext
      };
      await notify({
        event: onEndEvent,
        callbacks: [onEnd, telemetryDispatcher.onEnd]
      });
      let resolvedOutput;
      if (lastStep.finishReason === "stop") {
        const outputSpecification = output != null ? output : text();
        resolvedOutput = await outputSpecification.parseCompleteOutput(
          { text: lastStep.text },
          {
            response: lastStep.response,
            usage: lastStep.usage,
            finishReason: lastStep.finishReason
          }
        );
      }
      return new DefaultGenerateTextResult({
        initialResponseMessages,
        steps,
        totalUsage,
        output: resolvedOutput
      });
    } catch (error) {
      await ((_a23 = telemetryDispatcher.onError) == null ? void 0 : _a23.call(telemetryDispatcher, { callId, error }));
      throw wrapGatewayError(error);
    }
  };
  return await runInTracingChannelSpan({
    type: "generateText",
    event: generateTextStartEvent,
    execute: executeGenerateText
  });
}
async function executeTools({
  toolCalls,
  tools,
  callId,
  messages,
  abortSignal,
  timeout,
  experimental_sandbox: sandbox,
  toolsContext,
  onToolExecutionStart,
  onToolExecutionEnd,
  executeToolInTelemetryContext,
  runInTracingChannelSpan
}) {
  const toolResults = await Promise.all(
    toolCalls.map(
      async (toolCall) => await executeToolCall({
        toolCall,
        tools,
        callId,
        messages,
        abortSignal,
        timeout,
        experimental_sandbox: sandbox,
        toolsContext,
        onToolExecutionStart,
        onToolExecutionEnd,
        executeToolInTelemetryContext,
        runInTracingChannelSpan
      })
    )
  );
  return toolResults.filter(
    (result) => result != null
  );
}
var DefaultGenerateTextResult = class {
  constructor(options) {
    this.initialResponseMessages = options.initialResponseMessages;
    this.steps = options.steps;
    this._output = options.output;
    this.totalUsage = options.totalUsage;
  }
  get finalStep() {
    return this.steps.at(-1);
  }
  get content() {
    return this.steps.flatMap((step) => step.content);
  }
  get text() {
    return this.finalStep.text;
  }
  get files() {
    return this.steps.flatMap((step) => step.files);
  }
  get reasoningText() {
    return this.finalStep.reasoningText;
  }
  get reasoning() {
    return convertToReasoningOutputs(this.finalStep.reasoning);
  }
  get toolCalls() {
    return this.steps.flatMap((step) => step.toolCalls);
  }
  get staticToolCalls() {
    return this.steps.flatMap((step) => step.staticToolCalls);
  }
  get dynamicToolCalls() {
    return this.steps.flatMap((step) => step.dynamicToolCalls);
  }
  get toolResults() {
    return this.steps.flatMap((step) => step.toolResults);
  }
  get staticToolResults() {
    return this.steps.flatMap((step) => step.staticToolResults);
  }
  get dynamicToolResults() {
    return this.steps.flatMap((step) => step.dynamicToolResults);
  }
  get sources() {
    return this.steps.flatMap((step) => step.sources);
  }
  get finishReason() {
    return this.finalStep.finishReason;
  }
  get rawFinishReason() {
    return this.finalStep.rawFinishReason;
  }
  get warnings() {
    return this.steps.flatMap((step) => {
      var _a22;
      return (_a22 = step.warnings) != null ? _a22 : [];
    });
  }
  get providerMetadata() {
    return this.finalStep.providerMetadata;
  }
  get response() {
    return this.finalStep.response;
  }
  get responseMessages() {
    return [
      ...this.initialResponseMessages,
      ...this.steps.flatMap((step) => step.response.messages)
    ];
  }
  get request() {
    return this.finalStep.request;
  }
  get usage() {
    return this.totalUsage;
  }
  get output() {
    if (this._output == null) {
      throw new NoOutputGeneratedError();
    }
    return this._output;
  }
};
function asContent({
  content,
  toolCalls,
  toolOutputs,
  toolApprovalRequests,
  toolApprovalResponses,
  tools
}) {
  const contentParts = [];
  const toolOutputsWithApprovalResponses = [];
  const toolOutputsWithoutApprovalResponses = [];
  const toolCallIdsWithApprovalResponses = new Set(
    toolApprovalResponses.map(
      (toolApprovalResponse) => toolApprovalResponse.toolCall.toolCallId
    )
  );
  for (const part of content) {
    switch (part.type) {
      case "text":
      case "reasoning":
      case "custom":
      case "source":
        contentParts.push(part);
        break;
      case "file":
      case "reasoning-file": {
        contentParts.push({
          type: part.type,
          file: new DefaultGeneratedFile({
            data: part.data.type === "data" ? part.data.data : part.data.url.toString(),
            mediaType: part.mediaType
          }),
          ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {}
        });
        break;
      }
      case "tool-call": {
        contentParts.push(
          toolCalls.find((toolCall) => toolCall.toolCallId === part.toolCallId)
        );
        break;
      }
      case "tool-result": {
        const toolCall = toolCalls.find(
          (toolCall2) => toolCall2.toolCallId === part.toolCallId
        );
        if (toolCall == null) {
          const tool2 = getOwn(tools, part.toolName);
          const supportsDeferredResults = (tool2 == null ? void 0 : tool2.type) === "provider" && tool2.supportsDeferredResults;
          if (!supportsDeferredResults) {
            throw new Error(`Tool call ${part.toolCallId} not found.`);
          }
          if (part.isError) {
            contentParts.push({
              type: "tool-error",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: void 0,
              error: part.result,
              providerExecuted: true,
              dynamic: part.dynamic,
              ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {},
              ...(tool2 == null ? void 0 : tool2.metadata) != null ? { toolMetadata: tool2.metadata } : {}
            });
          } else {
            contentParts.push({
              type: "tool-result",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: void 0,
              output: part.result,
              providerExecuted: true,
              dynamic: part.dynamic,
              ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {},
              ...(tool2 == null ? void 0 : tool2.metadata) != null ? { toolMetadata: tool2.metadata } : {}
            });
          }
          break;
        }
        if (part.isError) {
          contentParts.push({
            type: "tool-error",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: toolCall.input,
            error: part.result,
            providerExecuted: true,
            dynamic: toolCall.dynamic,
            ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {},
            ...toolCall.toolMetadata != null ? { toolMetadata: toolCall.toolMetadata } : {}
          });
        } else {
          contentParts.push({
            type: "tool-result",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: toolCall.input,
            output: part.result,
            providerExecuted: true,
            dynamic: toolCall.dynamic,
            ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {},
            ...toolCall.toolMetadata != null ? { toolMetadata: toolCall.toolMetadata } : {}
          });
        }
        break;
      }
      case "tool-approval-request": {
        const toolCall = toolCalls.find(
          (toolCall2) => toolCall2.toolCallId === part.toolCallId
        );
        if (toolCall == null) {
          throw new ToolCallNotFoundForApprovalError({
            toolCallId: part.toolCallId,
            approvalId: part.approvalId
          });
        }
        contentParts.push({
          type: "tool-approval-request",
          approvalId: part.approvalId,
          toolCall
        });
        break;
      }
    }
  }
  for (const toolOutput of toolOutputs) {
    if (toolCallIdsWithApprovalResponses.has(toolOutput.toolCallId)) {
      toolOutputsWithApprovalResponses.push(toolOutput);
    } else {
      toolOutputsWithoutApprovalResponses.push(toolOutput);
    }
  }
  return [
    ...contentParts,
    ...toolOutputsWithoutApprovalResponses,
    ...toolApprovalRequests,
    ...toolApprovalResponses,
    ...toolOutputsWithApprovalResponses
  ];
}

// src/generate-text/stream-text.ts
import {
  getErrorMessage as getErrorMessage6,
  UnsupportedFunctionalityError as UnsupportedFunctionalityError2
} from "@ai-sdk/provider";
import {
  asArray as asArray6,
  createIdGenerator as createIdGenerator3,
  DelayedPromise,
  filterNullable as filterNullable2,
  isAbortError
} from "@ai-sdk/provider-utils";

// src/util/prepare-headers.ts
function prepareHeaders(headers, defaultHeaders) {
  const responseHeaders = new Headers(headers != null ? headers : {});
  for (const [key, value] of Object.entries(defaultHeaders)) {
    if (!responseHeaders.has(key)) {
      responseHeaders.set(key, value);
    }
  }
  return responseHeaders;
}

// src/text-stream/create-text-stream-response.ts
function createTextStreamResponse({
  status,
  statusText,
  headers,
  stream
}) {
  return new Response(stream.pipeThrough(new TextEncoderStream()), {
    status: status != null ? status : 200,
    statusText,
    headers: prepareHeaders(headers, {
      "content-type": "text/plain; charset=utf-8"
    })
  });
}

// src/util/write-to-server-response.ts
function writeToServerResponse({
  response,
  status,
  statusText,
  headers,
  stream
}) {
  const statusCode = status != null ? status : 200;
  if (statusText !== void 0) {
    response.writeHead(statusCode, statusText, headers);
  } else {
    response.writeHead(statusCode, headers);
  }
  const reader = stream.getReader();
  const read = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done)
          break;
        const canContinue = response.write(value);
        const flush = response.flush;
        if (typeof flush === "function") {
          flush.call(response);
        }
        if (!canContinue) {
          await new Promise((resolve3) => {
            response.once("drain", resolve3);
          });
        }
      }
    } catch (error) {
      throw error;
    } finally {
      response.end();
    }
  };
  return read();
}

// src/text-stream/pipe-text-stream-to-response.ts
function pipeTextStreamToResponse({
  response,
  status,
  statusText,
  headers,
  stream
}) {
  return writeToServerResponse({
    response,
    status,
    statusText,
    headers: Object.fromEntries(
      prepareHeaders(headers, {
        "content-type": "text/plain; charset=utf-8"
      }).entries()
    ),
    stream: stream.pipeThrough(new TextEncoderStream())
  });
}

// src/text-stream/to-text-stream.ts
function toTextStream({
  stream
}) {
  return stream.pipeThrough(
    new TransformStream({
      transform(part, controller) {
        if (part.type === "text-delta") {
          controller.enqueue(part.text);
        }
      }
    })
  );
}

// src/ui-message-stream/json-to-sse-transform-stream.ts
var JsonToSseTransformStream = class extends TransformStream {
  constructor() {
    super({
      transform(part, controller) {
        controller.enqueue(`data: ${JSON.stringify(part)}

`);
      },
      flush(controller) {
        controller.enqueue("data: [DONE]\n\n");
      }
    });
  }
};

// src/ui-message-stream/ui-message-stream-headers.ts
var UI_MESSAGE_STREAM_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  connection: "keep-alive",
  "x-vercel-ai-ui-message-stream": "v1",
  "x-accel-buffering": "no"
  // disable nginx buffering
};

// src/ui-message-stream/create-ui-message-stream-response.ts
function createUIMessageStreamResponse({
  status,
  statusText,
  headers,
  stream,
  consumeSseStream
}) {
  let sseStream = stream.pipeThrough(new JsonToSseTransformStream());
  if (consumeSseStream) {
    const [stream1, stream2] = sseStream.tee();
    sseStream = stream1;
    consumeSseStream({ stream: stream2 });
  }
  return new Response(sseStream.pipeThrough(new TextEncoderStream()), {
    status,
    statusText,
    headers: prepareHeaders(headers, UI_MESSAGE_STREAM_HEADERS)
  });
}

// src/ui-message-stream/pipe-ui-message-stream-to-response.ts
function pipeUIMessageStreamToResponse({
  response,
  status,
  statusText,
  headers,
  stream,
  consumeSseStream
}) {
  let sseStream = stream.pipeThrough(new JsonToSseTransformStream());
  if (consumeSseStream) {
    const [stream1, stream2] = sseStream.tee();
    sseStream = stream1;
    consumeSseStream({ stream: stream2 });
  }
  return writeToServerResponse({
    response,
    status,
    statusText,
    headers: Object.fromEntries(
      prepareHeaders(headers, UI_MESSAGE_STREAM_HEADERS).entries()
    ),
    stream: sseStream.pipeThrough(new TextEncoderStream())
  });
}

// src/ui-message-stream/get-response-ui-message-id.ts
function getResponseUIMessageId({
  originalMessages,
  responseMessageId
}) {
  if (originalMessages == null) {
    return void 0;
  }
  const lastMessage = originalMessages[originalMessages.length - 1];
  return (lastMessage == null ? void 0 : lastMessage.role) === "assistant" ? lastMessage.id : typeof responseMessageId === "function" ? responseMessageId() : responseMessageId;
}

// src/ui/process-ui-message-stream.ts
import { validateTypes as validateTypes2 } from "@ai-sdk/provider-utils";

// src/ui-message-stream/ui-message-chunks.ts
import { z as z6 } from "zod/v4";
import { lazySchema, zodSchema } from "@ai-sdk/provider-utils";
var toolMetadataSchema = z6.record(
  z6.string(),
  jsonValueSchema.optional()
);
var uiMessageChunkSchema = lazySchema(
  () => zodSchema(
    z6.union([
      z6.looseObject({
        type: z6.literal("text-start"),
        id: z6.string(),
        providerMetadata: providerMetadataSchema.optional()
      }),
      z6.looseObject({
        type: z6.literal("text-delta"),
        id: z6.string(),
        delta: z6.string(),
        providerMetadata: providerMetadataSchema.optional()
      }),
      z6.looseObject({
        type: z6.literal("text-end"),
        id: z6.string(),
        providerMetadata: providerMetadataSchema.optional()
      }),
      z6.looseObject({
        type: z6.literal("error"),
        errorText: z6.string()
      }),
      z6.looseObject({
        type: z6.literal("tool-input-start"),
        toolCallId: z6.string(),
        toolName: z6.string(),
        providerExecuted: z6.boolean().optional(),
        providerMetadata: providerMetadataSchema.optional(),
        toolMetadata: toolMetadataSchema.optional(),
        dynamic: z6.boolean().optional(),
        title: z6.string().optional()
      }),
      z6.looseObject({
        type: z6.literal("tool-input-delta"),
        toolCallId: z6.string(),
        inputTextDelta: z6.string()
      }),
      z6.looseObject({
        type: z6.literal("tool-input-available"),
        toolCallId: z6.string(),
        toolName: z6.string(),
        input: z6.unknown(),
        providerExecuted: z6.boolean().optional(),
        providerMetadata: providerMetadataSchema.optional(),
        toolMetadata: toolMetadataSchema.optional(),
        dynamic: z6.boolean().optional(),
        title: z6.string().optional()
      }),
      z6.looseObject({
        type: z6.literal("tool-input-error"),
        toolCallId: z6.string(),
        toolName: z6.string(),
        input: z6.unknown(),
        providerExecuted: z6.boolean().optional(),
        providerMetadata: providerMetadataSchema.optional(),
        toolMetadata: toolMetadataSchema.optional(),
        dynamic: z6.boolean().optional(),
        errorText: z6.string(),
        title: z6.string().optional()
      }),
      z6.looseObject({
        type: z6.literal("tool-approval-request"),
        approvalId: z6.string(),
        toolCallId: z6.string(),
        isAutomatic: z6.boolean().optional(),
        signature: z6.string().optional()
      }),
      z6.looseObject({
        type: z6.literal("tool-approval-response"),
        approvalId: z6.string(),
        approved: z6.boolean(),
        reason: z6.string().optional(),
        providerExecuted: z6.boolean().optional(),
        providerMetadata: providerMetadataSchema.optional()
      }),
      z6.looseObject({
        type: z6.literal("tool-output-available"),
        toolCallId: z6.string(),
        output: z6.unknown(),
        providerExecuted: z6.boolean().optional(),
        providerMetadata: providerMetadataSchema.optional(),
        toolMetadata: toolMetadataSchema.optional(),
        dynamic: z6.boolean().optional(),
        preliminary: z6.boolean().optional()
      }),
      z6.looseObject({
        type: z6.literal("tool-output-error"),
        toolCallId: z6.string(),
        errorText: z6.string(),
        providerExecuted: z6.boolean().optional(),
        providerMetadata: providerMetadataSchema.optional(),
        toolMetadata: toolMetadataSchema.optional(),
        dynamic: z6.boolean().optional()
      }),
      z6.looseObject({
        type: z6.literal("tool-output-denied"),
        toolCallId: z6.string()
      }),
      z6.looseObject({
        type: z6.literal("reasoning-start"),
        id: z6.string(),
        providerMetadata: providerMetadataSchema.optional()
      }),
      z6.looseObject({
        type: z6.literal("reasoning-delta"),
        id: z6.string(),
        delta: z6.string(),
        providerMetadata: providerMetadataSchema.optional()
      }),
      z6.looseObject({
        type: z6.literal("reasoning-end"),
        id: z6.string(),
        providerMetadata: providerMetadataSchema.optional()
      }),
      z6.looseObject({
        type: z6.literal("custom"),
        kind: z6.string().transform((value) => value),
        providerMetadata: providerMetadataSchema.optional()
      }),
      z6.looseObject({
        type: z6.literal("source-url"),
        sourceId: z6.string(),
        url: z6.string(),
        title: z6.string().optional(),
        providerMetadata: providerMetadataSchema.optional()
      }),
      z6.looseObject({
        type: z6.literal("source-document"),
        sourceId: z6.string(),
        mediaType: z6.string(),
        title: z6.string(),
        filename: z6.string().optional(),
        providerMetadata: providerMetadataSchema.optional()
      }),
      z6.looseObject({
        type: z6.literal("file"),
        url: z6.string(),
        mediaType: z6.string(),
        providerMetadata: providerMetadataSchema.optional()
      }),
      z6.looseObject({
        type: z6.literal("reasoning-file"),
        url: z6.string(),
        mediaType: z6.string(),
        providerMetadata: providerMetadataSchema.optional()
      }),
      z6.looseObject({
        type: z6.custom(
          (value) => typeof value === "string" && value.startsWith("data-"),
          { message: 'Type must start with "data-"' }
        ),
        id: z6.string().optional(),
        data: z6.unknown(),
        transient: z6.boolean().optional()
      }),
      z6.looseObject({
        type: z6.literal("start-step")
      }),
      z6.looseObject({
        type: z6.literal("finish-step")
      }),
      z6.looseObject({
        type: z6.literal("start"),
        messageId: z6.string().optional(),
        messageMetadata: z6.unknown().optional()
      }),
      z6.looseObject({
        type: z6.literal("finish"),
        finishReason: z6.enum([
          "stop",
          "length",
          "content-filter",
          "tool-calls",
          "error",
          "other"
        ]).optional(),
        messageMetadata: z6.unknown().optional()
      }),
      z6.looseObject({
        type: z6.literal("abort"),
        reason: z6.string().optional()
      }),
      z6.looseObject({
        type: z6.literal("message-metadata"),
        messageMetadata: z6.unknown()
      })
    ])
  )
);
function isDataUIMessageChunk(chunk) {
  return chunk.type.startsWith("data-");
}

// src/util/create-id-map.ts
function createIdMap() {
  return /* @__PURE__ */ Object.create(null);
}

// src/ui/ui-messages.ts
function isDataUIPart(part) {
  return part.type.startsWith("data-");
}
function isTextUIPart(part) {
  return part.type === "text";
}
function isCustomContentUIPart(part) {
  return part.type === "custom";
}
function isFileUIPart(part) {
  return part.type === "file";
}
function isReasoningFileUIPart(part) {
  return part.type === "reasoning-file";
}
function isReasoningUIPart(part) {
  return part.type === "reasoning";
}
function isStaticToolUIPart(part) {
  return part.type.startsWith("tool-");
}
function isDynamicToolUIPart(part) {
  return part.type === "dynamic-tool";
}
function isToolUIPart(part) {
  return isStaticToolUIPart(part) || isDynamicToolUIPart(part);
}
function getStaticToolName(part) {
  return part.type.split("-").slice(1).join("-");
}
function getToolName(part) {
  return isDynamicToolUIPart(part) ? part.toolName : getStaticToolName(part);
}
var getToolOrDynamicToolName = getToolName;

// src/ui/process-ui-message-stream.ts
function createStreamingUIMessageState({
  lastMessage,
  messageId
}) {
  return {
    message: (lastMessage == null ? void 0 : lastMessage.role) === "assistant" ? lastMessage : {
      id: messageId,
      metadata: void 0,
      role: "assistant",
      parts: []
    },
    activeTextParts: createIdMap(),
    activeReasoningParts: createIdMap(),
    partialToolCalls: createIdMap()
  };
}
function processUIMessageStream({
  stream,
  messageMetadataSchema,
  dataPartSchemas,
  runUpdateMessageJob,
  onError,
  onToolCall,
  onData
}) {
  return stream.pipeThrough(
    new TransformStream({
      async transform(chunk, controller) {
        await runUpdateMessageJob(async ({ state, write }) => {
          var _a22, _b, _c, _d;
          function getCurrentStepParts() {
            const parts = state.message.parts;
            let currentStepStartIndex = parts.length - 1;
            while (currentStepStartIndex >= 0 && parts[currentStepStartIndex].type !== "step-start") {
              currentStepStartIndex--;
            }
            return parts.slice(currentStepStartIndex + 1);
          }
          function getCurrentStepToolInvocations() {
            return getCurrentStepParts().filter(isToolUIPart);
          }
          function getToolInvocation(toolCallId) {
            const toolInvocations = getCurrentStepToolInvocations();
            let toolInvocation = toolInvocations.find(
              (invocation) => invocation.toolCallId === toolCallId
            );
            if (toolInvocation == null) {
              const parts = state.message.parts;
              for (let i = parts.length - 1; i >= 0; i--) {
                const part = parts[i];
                if (isToolUIPart(part) && part.toolCallId === toolCallId) {
                  toolInvocation = part;
                  break;
                }
              }
            }
            if (toolInvocation == null) {
              throw new UIMessageStreamError({
                chunkType: "tool-invocation",
                chunkId: toolCallId,
                message: `No tool invocation found for tool call ID "${toolCallId}".`
              });
            }
            return toolInvocation;
          }
          function getToolInvocationByApprovalId(approvalId) {
            const toolInvocations = state.message.parts.filter(isToolUIPart);
            const toolInvocation = toolInvocations.find(
              (invocation) => {
                var _a23;
                return ((_a23 = invocation.approval) == null ? void 0 : _a23.id) === approvalId;
              }
            );
            if (toolInvocation == null) {
              throw new UIMessageStreamError({
                chunkType: "tool-approval-response",
                chunkId: approvalId,
                message: `No tool invocation found for approval ID "${approvalId}".`
              });
            }
            return toolInvocation;
          }
          function updateToolPart(options, existingPart) {
            var _a23;
            const part = existingPart != null ? existingPart : getCurrentStepParts().find(
              (part2) => isStaticToolUIPart(part2) && part2.toolCallId === options.toolCallId
            );
            const anyOptions = options;
            const anyPart = part;
            if (part != null) {
              part.state = options.state;
              anyPart.input = anyOptions.input;
              anyPart.output = anyOptions.output;
              anyPart.errorText = anyOptions.errorText;
              anyPart.rawInput = anyOptions.rawInput;
              anyPart.preliminary = anyOptions.preliminary;
              if (options.title !== void 0) {
                anyPart.title = options.title;
              }
              if (options.toolMetadata !== void 0) {
                anyPart.toolMetadata = options.toolMetadata;
              }
              anyPart.providerExecuted = (_a23 = anyOptions.providerExecuted) != null ? _a23 : part.providerExecuted;
              const providerMetadata = anyOptions.providerMetadata;
              if (providerMetadata != null) {
                if (options.state === "output-available" || options.state === "output-error") {
                  const resultPart = part;
                  resultPart.resultProviderMetadata = providerMetadata;
                } else {
                  part.callProviderMetadata = providerMetadata;
                }
              }
            } else {
              state.message.parts.push({
                type: `tool-${options.toolName}`,
                toolCallId: options.toolCallId,
                state: options.state,
                title: options.title,
                ...options.toolMetadata !== void 0 ? { toolMetadata: options.toolMetadata } : {},
                input: anyOptions.input,
                output: anyOptions.output,
                rawInput: anyOptions.rawInput,
                errorText: anyOptions.errorText,
                providerExecuted: anyOptions.providerExecuted,
                preliminary: anyOptions.preliminary,
                ...anyOptions.providerMetadata != null && (options.state === "output-available" || options.state === "output-error") ? { resultProviderMetadata: anyOptions.providerMetadata } : {},
                ...anyOptions.providerMetadata != null && !(options.state === "output-available" || options.state === "output-error") ? { callProviderMetadata: anyOptions.providerMetadata } : {}
              });
            }
          }
          function updateDynamicToolPart(options, existingPart) {
            var _a23, _b2;
            const part = existingPart != null ? existingPart : getCurrentStepParts().find(
              (part2) => part2.type === "dynamic-tool" && part2.toolCallId === options.toolCallId
            );
            const anyOptions = options;
            const anyPart = part;
            if (part != null) {
              part.state = options.state;
              anyPart.toolName = options.toolName;
              anyPart.input = anyOptions.input;
              anyPart.output = anyOptions.output;
              anyPart.errorText = anyOptions.errorText;
              anyPart.rawInput = (_a23 = anyOptions.rawInput) != null ? _a23 : anyPart.rawInput;
              anyPart.preliminary = anyOptions.preliminary;
              if (options.title !== void 0) {
                anyPart.title = options.title;
              }
              if (options.toolMetadata !== void 0) {
                anyPart.toolMetadata = options.toolMetadata;
              }
              anyPart.providerExecuted = (_b2 = anyOptions.providerExecuted) != null ? _b2 : part.providerExecuted;
              const providerMetadata = anyOptions.providerMetadata;
              if (providerMetadata != null) {
                if (options.state === "output-available" || options.state === "output-error") {
                  const resultPart = part;
                  resultPart.resultProviderMetadata = providerMetadata;
                } else {
                  part.callProviderMetadata = providerMetadata;
                }
              }
            } else {
              state.message.parts.push({
                type: "dynamic-tool",
                toolName: options.toolName,
                toolCallId: options.toolCallId,
                state: options.state,
                input: anyOptions.input,
                output: anyOptions.output,
                errorText: anyOptions.errorText,
                preliminary: anyOptions.preliminary,
                providerExecuted: anyOptions.providerExecuted,
                title: options.title,
                ...options.toolMetadata !== void 0 ? { toolMetadata: options.toolMetadata } : {},
                ...anyOptions.providerMetadata != null && (options.state === "output-available" || options.state === "output-error") ? { resultProviderMetadata: anyOptions.providerMetadata } : {},
                ...anyOptions.providerMetadata != null && !(options.state === "output-available" || options.state === "output-error") ? { callProviderMetadata: anyOptions.providerMetadata } : {}
              });
            }
          }
          async function updateMessageMetadata(metadata) {
            if (metadata != null) {
              const mergedMetadata = state.message.metadata != null ? mergeObjects(state.message.metadata, metadata) : metadata;
              if (messageMetadataSchema != null) {
                await validateTypes2({
                  value: mergedMetadata,
                  schema: messageMetadataSchema,
                  context: {
                    field: "message.metadata",
                    entityId: state.message.id
                  }
                });
              }
              state.message.metadata = mergedMetadata;
            }
          }
          switch (chunk.type) {
            case "text-start": {
              const textPart = {
                type: "text",
                text: "",
                providerMetadata: chunk.providerMetadata,
                state: "streaming"
              };
              state.activeTextParts[chunk.id] = textPart;
              state.message.parts.push(textPart);
              write();
              break;
            }
            case "text-delta": {
              const textPart = state.activeTextParts[chunk.id];
              if (textPart == null) {
                throw new UIMessageStreamError({
                  chunkType: "text-delta",
                  chunkId: chunk.id,
                  message: `Received text-delta for missing text part with ID "${chunk.id}". Ensure a "text-start" chunk is sent before any "text-delta" chunks.`
                });
              }
              textPart.text += chunk.delta;
              textPart.providerMetadata = (_a22 = chunk.providerMetadata) != null ? _a22 : textPart.providerMetadata;
              write();
              break;
            }
            case "text-end": {
              const textPart = state.activeTextParts[chunk.id];
              if (textPart == null) {
                throw new UIMessageStreamError({
                  chunkType: "text-end",
                  chunkId: chunk.id,
                  message: `Received text-end for missing text part with ID "${chunk.id}". Ensure a "text-start" chunk is sent before any "text-end" chunks.`
                });
              }
              textPart.state = "done";
              textPart.providerMetadata = (_b = chunk.providerMetadata) != null ? _b : textPart.providerMetadata;
              delete state.activeTextParts[chunk.id];
              write();
              break;
            }
            case "custom": {
              const customPart = {
                type: "custom",
                kind: chunk.kind,
                providerMetadata: chunk.providerMetadata
              };
              state.message.parts.push(customPart);
              write();
              break;
            }
            case "reasoning-start": {
              const reasoningPart = {
                type: "reasoning",
                text: "",
                providerMetadata: chunk.providerMetadata,
                state: "streaming"
              };
              state.activeReasoningParts[chunk.id] = reasoningPart;
              state.message.parts.push(reasoningPart);
              write();
              break;
            }
            case "reasoning-delta": {
              const reasoningPart = state.activeReasoningParts[chunk.id];
              if (reasoningPart == null) {
                throw new UIMessageStreamError({
                  chunkType: "reasoning-delta",
                  chunkId: chunk.id,
                  message: `Received reasoning-delta for missing reasoning part with ID "${chunk.id}". Ensure a "reasoning-start" chunk is sent before any "reasoning-delta" chunks.`
                });
              }
              reasoningPart.text += chunk.delta;
              reasoningPart.providerMetadata = (_c = chunk.providerMetadata) != null ? _c : reasoningPart.providerMetadata;
              write();
              break;
            }
            case "reasoning-end": {
              const reasoningPart = state.activeReasoningParts[chunk.id];
              if (reasoningPart == null) {
                throw new UIMessageStreamError({
                  chunkType: "reasoning-end",
                  chunkId: chunk.id,
                  message: `Received reasoning-end for missing reasoning part with ID "${chunk.id}". Ensure a "reasoning-start" chunk is sent before any "reasoning-end" chunks.`
                });
              }
              reasoningPart.providerMetadata = (_d = chunk.providerMetadata) != null ? _d : reasoningPart.providerMetadata;
              reasoningPart.state = "done";
              delete state.activeReasoningParts[chunk.id];
              write();
              break;
            }
            case "file":
            case "reasoning-file": {
              state.message.parts.push({
                type: chunk.type,
                mediaType: chunk.mediaType,
                url: chunk.url,
                ...chunk.providerMetadata != null ? { providerMetadata: chunk.providerMetadata } : {}
              });
              write();
              break;
            }
            case "source-url": {
              state.message.parts.push({
                type: "source-url",
                sourceId: chunk.sourceId,
                url: chunk.url,
                title: chunk.title,
                providerMetadata: chunk.providerMetadata
              });
              write();
              break;
            }
            case "source-document": {
              state.message.parts.push({
                type: "source-document",
                sourceId: chunk.sourceId,
                mediaType: chunk.mediaType,
                title: chunk.title,
                filename: chunk.filename,
                providerMetadata: chunk.providerMetadata
              });
              write();
              break;
            }
            case "tool-input-start": {
              const toolInvocations = getCurrentStepParts().filter(isStaticToolUIPart);
              state.partialToolCalls[chunk.toolCallId] = {
                text: "",
                toolName: chunk.toolName,
                index: toolInvocations.length,
                dynamic: chunk.dynamic,
                title: chunk.title,
                toolMetadata: chunk.toolMetadata
              };
              if (chunk.dynamic) {
                updateDynamicToolPart({
                  toolCallId: chunk.toolCallId,
                  toolName: chunk.toolName,
                  state: "input-streaming",
                  input: void 0,
                  providerExecuted: chunk.providerExecuted,
                  title: chunk.title,
                  toolMetadata: chunk.toolMetadata,
                  providerMetadata: chunk.providerMetadata
                });
              } else {
                updateToolPart({
                  toolCallId: chunk.toolCallId,
                  toolName: chunk.toolName,
                  state: "input-streaming",
                  input: void 0,
                  providerExecuted: chunk.providerExecuted,
                  title: chunk.title,
                  toolMetadata: chunk.toolMetadata,
                  providerMetadata: chunk.providerMetadata
                });
              }
              write();
              break;
            }
            case "tool-input-delta": {
              const partialToolCall = state.partialToolCalls[chunk.toolCallId];
              if (partialToolCall == null) {
                throw new UIMessageStreamError({
                  chunkType: "tool-input-delta",
                  chunkId: chunk.toolCallId,
                  message: `Received tool-input-delta for missing tool call with ID "${chunk.toolCallId}". Ensure a "tool-input-start" chunk is sent before any "tool-input-delta" chunks.`
                });
              }
              partialToolCall.text += chunk.inputTextDelta;
              const { value: partialArgs } = await parsePartialJson(
                partialToolCall.text
              );
              if (partialToolCall.dynamic) {
                updateDynamicToolPart({
                  toolCallId: chunk.toolCallId,
                  toolName: partialToolCall.toolName,
                  state: "input-streaming",
                  input: partialArgs,
                  title: partialToolCall.title,
                  toolMetadata: partialToolCall.toolMetadata
                });
              } else {
                updateToolPart({
                  toolCallId: chunk.toolCallId,
                  toolName: partialToolCall.toolName,
                  state: "input-streaming",
                  input: partialArgs,
                  title: partialToolCall.title,
                  toolMetadata: partialToolCall.toolMetadata
                });
              }
              write();
              break;
            }
            case "tool-input-available": {
              if (chunk.dynamic) {
                updateDynamicToolPart({
                  toolCallId: chunk.toolCallId,
                  toolName: chunk.toolName,
                  state: "input-available",
                  input: chunk.input,
                  providerExecuted: chunk.providerExecuted,
                  providerMetadata: chunk.providerMetadata,
                  title: chunk.title,
                  toolMetadata: chunk.toolMetadata
                });
              } else {
                updateToolPart({
                  toolCallId: chunk.toolCallId,
                  toolName: chunk.toolName,
                  state: "input-available",
                  input: chunk.input,
                  providerExecuted: chunk.providerExecuted,
                  providerMetadata: chunk.providerMetadata,
                  title: chunk.title,
                  toolMetadata: chunk.toolMetadata
                });
              }
              write();
              if (onToolCall && !chunk.providerExecuted) {
                await onToolCall({
                  toolCall: chunk
                });
              }
              break;
            }
            case "tool-input-error": {
              const existingPart = getCurrentStepParts().filter(isToolUIPart).find((p) => p.toolCallId === chunk.toolCallId);
              const isDynamic = existingPart != null ? existingPart.type === "dynamic-tool" : !!chunk.dynamic;
              if (isDynamic) {
                updateDynamicToolPart({
                  toolCallId: chunk.toolCallId,
                  toolName: chunk.toolName,
                  state: "output-error",
                  input: chunk.input,
                  errorText: chunk.errorText,
                  providerExecuted: chunk.providerExecuted,
                  providerMetadata: chunk.providerMetadata,
                  toolMetadata: chunk.toolMetadata
                });
              } else {
                updateToolPart({
                  toolCallId: chunk.toolCallId,
                  toolName: chunk.toolName,
                  state: "output-error",
                  input: void 0,
                  rawInput: chunk.input,
                  errorText: chunk.errorText,
                  providerExecuted: chunk.providerExecuted,
                  providerMetadata: chunk.providerMetadata,
                  toolMetadata: chunk.toolMetadata
                });
              }
              write();
              break;
            }
            case "tool-approval-request": {
              const toolInvocation = getToolInvocation(chunk.toolCallId);
              toolInvocation.state = "approval-requested";
              toolInvocation.approval = {
                id: chunk.approvalId,
                ...chunk.isAutomatic === true ? { isAutomatic: true } : {},
                ...chunk.signature != null ? { signature: chunk.signature } : {}
              };
              write();
              break;
            }
            case "tool-approval-response": {
              const toolInvocation = getToolInvocationByApprovalId(
                chunk.approvalId
              );
              const approval = toolInvocation.approval == null ? { id: chunk.approvalId } : toolInvocation.approval;
              toolInvocation.state = "approval-responded";
              toolInvocation.approval = {
                id: chunk.approvalId,
                approved: chunk.approved,
                ...chunk.reason != null ? { reason: chunk.reason } : {},
                ...approval.isAutomatic === true ? { isAutomatic: true } : {},
                ...approval.signature != null ? { signature: approval.signature } : {}
              };
              if (chunk.providerExecuted != null) {
                toolInvocation.providerExecuted = chunk.providerExecuted;
              }
              if (chunk.providerMetadata != null) {
                toolInvocation.callProviderMetadata = chunk.providerMetadata;
              }
              write();
              break;
            }
            case "tool-output-denied": {
              const toolInvocation = getToolInvocation(chunk.toolCallId);
              toolInvocation.state = "output-denied";
              write();
              break;
            }
            case "tool-output-available": {
              const toolInvocation = getToolInvocation(chunk.toolCallId);
              if (toolInvocation.type === "dynamic-tool") {
                updateDynamicToolPart(
                  {
                    toolCallId: chunk.toolCallId,
                    toolName: toolInvocation.toolName,
                    state: "output-available",
                    input: toolInvocation.input,
                    output: chunk.output,
                    preliminary: chunk.preliminary,
                    providerExecuted: chunk.providerExecuted,
                    providerMetadata: chunk.providerMetadata,
                    title: toolInvocation.title,
                    toolMetadata: toolInvocation.toolMetadata
                  },
                  toolInvocation
                );
              } else {
                updateToolPart(
                  {
                    toolCallId: chunk.toolCallId,
                    toolName: getStaticToolName(toolInvocation),
                    state: "output-available",
                    input: toolInvocation.input,
                    output: chunk.output,
                    providerExecuted: chunk.providerExecuted,
                    preliminary: chunk.preliminary,
                    providerMetadata: chunk.providerMetadata,
                    title: toolInvocation.title,
                    toolMetadata: toolInvocation.toolMetadata
                  },
                  toolInvocation
                );
              }
              write();
              break;
            }
            case "tool-output-error": {
              const toolInvocation = getToolInvocation(chunk.toolCallId);
              if (toolInvocation.type === "dynamic-tool") {
                updateDynamicToolPart(
                  {
                    toolCallId: chunk.toolCallId,
                    toolName: toolInvocation.toolName,
                    state: "output-error",
                    input: toolInvocation.input,
                    errorText: chunk.errorText,
                    providerExecuted: chunk.providerExecuted,
                    providerMetadata: chunk.providerMetadata,
                    title: toolInvocation.title,
                    toolMetadata: toolInvocation.toolMetadata
                  },
                  toolInvocation
                );
              } else {
                updateToolPart(
                  {
                    toolCallId: chunk.toolCallId,
                    toolName: getStaticToolName(toolInvocation),
                    state: "output-error",
                    input: toolInvocation.input,
                    rawInput: toolInvocation.rawInput,
                    errorText: chunk.errorText,
                    providerExecuted: chunk.providerExecuted,
                    providerMetadata: chunk.providerMetadata,
                    title: toolInvocation.title,
                    toolMetadata: toolInvocation.toolMetadata
                  },
                  toolInvocation
                );
              }
              write();
              break;
            }
            case "start-step": {
              state.message.parts.push({ type: "step-start" });
              break;
            }
            case "finish-step": {
              state.activeTextParts = createIdMap();
              state.activeReasoningParts = createIdMap();
              break;
            }
            case "start": {
              if (chunk.messageId != null) {
                state.message.id = chunk.messageId;
              }
              await updateMessageMetadata(chunk.messageMetadata);
              if (chunk.messageId != null || chunk.messageMetadata != null) {
                write();
              }
              break;
            }
            case "finish": {
              if (chunk.finishReason != null) {
                state.finishReason = chunk.finishReason;
              }
              await updateMessageMetadata(chunk.messageMetadata);
              if (chunk.messageMetadata != null) {
                write();
              }
              break;
            }
            case "message-metadata": {
              await updateMessageMetadata(chunk.messageMetadata);
              if (chunk.messageMetadata != null) {
                write();
              }
              break;
            }
            case "error": {
              onError == null ? void 0 : onError(new Error(chunk.errorText));
              break;
            }
            default: {
              if (isDataUIMessageChunk(chunk)) {
                if ((dataPartSchemas == null ? void 0 : dataPartSchemas[chunk.type]) != null) {
                  const partIdx = state.message.parts.findIndex(
                    (p) => "id" in p && "data" in p && p.id === chunk.id && p.type === chunk.type
                  );
                  const actualPartIdx = partIdx >= 0 ? partIdx : state.message.parts.length;
                  await validateTypes2({
                    value: chunk.data,
                    schema: dataPartSchemas[chunk.type],
                    context: {
                      field: `message.parts[${actualPartIdx}].data`,
                      entityName: chunk.type,
                      entityId: chunk.id
                    }
                  });
                }
                const dataChunk = chunk;
                if (dataChunk.transient) {
                  onData == null ? void 0 : onData(dataChunk);
                  break;
                }
                const existingUIPart = dataChunk.id != null ? state.message.parts.find(
                  (chunkArg) => dataChunk.type === chunkArg.type && dataChunk.id === chunkArg.id
                ) : void 0;
                if (existingUIPart != null) {
                  existingUIPart.data = dataChunk.data;
                } else {
                  state.message.parts.push(dataChunk);
                }
                onData == null ? void 0 : onData(dataChunk);
                write();
              }
            }
          }
          controller.enqueue(chunk);
        });
      }
    })
  );
}

// src/ui-message-stream/handle-ui-message-stream-finish.ts
function handleUIMessageStreamFinish({
  messageId,
  originalMessages = [],
  onStepEnd,
  onStepFinish,
  onEnd,
  onFinish,
  onError,
  stream
}) {
  let lastMessage = originalMessages == null ? void 0 : originalMessages[originalMessages.length - 1];
  if ((lastMessage == null ? void 0 : lastMessage.role) !== "assistant") {
    lastMessage = void 0;
  } else {
    messageId = lastMessage.id;
  }
  let isAborted = false;
  const idInjectedStream = stream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (chunk.type === "start") {
          const startChunk = chunk;
          if (startChunk.messageId == null && messageId != null) {
            startChunk.messageId = messageId;
          }
        }
        if (chunk.type === "abort") {
          isAborted = true;
        }
        controller.enqueue(chunk);
      }
    })
  );
  const resolvedOnStepEnd = onStepEnd != null ? onStepEnd : onStepFinish;
  const resolvedOnEnd = onEnd != null ? onEnd : onFinish;
  if (resolvedOnEnd == null && resolvedOnStepEnd == null) {
    return idInjectedStream;
  }
  const state = createStreamingUIMessageState({
    lastMessage: lastMessage ? structuredClone(lastMessage) : void 0,
    messageId: messageId != null ? messageId : ""
    // will be overridden by the stream
  });
  const runUpdateMessageJob = async (job) => {
    await job({ state, write: () => {
    } });
  };
  let finishCalled = false;
  const callOnEnd = async () => {
    if (finishCalled || !resolvedOnEnd) {
      return;
    }
    finishCalled = true;
    const isContinuation = state.message.id === (lastMessage == null ? void 0 : lastMessage.id);
    await resolvedOnEnd({
      isAborted,
      isContinuation,
      responseMessage: state.message,
      messages: [
        ...isContinuation ? originalMessages.slice(0, -1) : originalMessages,
        state.message
      ],
      finishReason: state.finishReason
    });
  };
  const callOnStepFinish = async () => {
    if (!resolvedOnStepEnd) {
      return;
    }
    const isContinuation = state.message.id === (lastMessage == null ? void 0 : lastMessage.id);
    try {
      await resolvedOnStepEnd({
        isContinuation,
        responseMessage: structuredClone(state.message),
        messages: [
          ...isContinuation ? originalMessages.slice(0, -1) : originalMessages,
          structuredClone(state.message)
        ]
      });
    } catch (error) {
      onError(error);
    }
  };
  return processUIMessageStream({
    stream: idInjectedStream,
    runUpdateMessageJob,
    onError
  }).pipeThrough(
    new TransformStream({
      async transform(chunk, controller) {
        if (chunk.type === "finish-step") {
          await callOnStepFinish();
        }
        controller.enqueue(chunk);
      },
      // @ts-expect-error cancel is still new and missing from types https://developer.mozilla.org/en-US/docs/Web/API/TransformStream#browser_compatibility
      async cancel() {
        await callOnEnd();
      },
      async flush() {
        await callOnEnd();
      }
    })
  );
}

// src/ui-message-stream/to-ui-message-chunk.ts
function toUIMessageChunk(part, {
  tools,
  sendReasoning = true,
  sendSources = false,
  sendStart = true,
  sendFinish = true,
  onError = () => "An error occurred.",
  // prevent leaking server error details to the client by default
  messageMetadata,
  responseMessageId
} = {}) {
  const isDynamic = (toolPart) => {
    const tool2 = tools == null ? void 0 : tools[toolPart.toolName];
    if (tool2 == null) {
      return toolPart.dynamic;
    }
    return (tool2 == null ? void 0 : tool2.type) === "dynamic" ? true : void 0;
  };
  const partType = part.type;
  switch (partType) {
    case "text-start": {
      return {
        type: "text-start",
        id: part.id,
        ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {}
      };
    }
    case "text-delta": {
      return {
        type: "text-delta",
        id: part.id,
        delta: part.text,
        ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {}
      };
    }
    case "text-end": {
      return {
        type: "text-end",
        id: part.id,
        ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {}
      };
    }
    case "reasoning-start":
    case "reasoning-end": {
      if (!sendReasoning) {
        return void 0;
      }
      return {
        type: partType,
        id: part.id,
        ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {}
      };
    }
    case "reasoning-delta": {
      if (!sendReasoning) {
        return void 0;
      }
      return {
        type: "reasoning-delta",
        id: part.id,
        delta: part.text,
        ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {}
      };
    }
    case "file":
    case "reasoning-file": {
      if (partType === "reasoning-file" && !sendReasoning) {
        return void 0;
      }
      return {
        type: part.type,
        mediaType: part.file.mediaType,
        url: `data:${part.file.mediaType};base64,${part.file.base64}`,
        ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {}
      };
    }
    case "source": {
      if (!sendSources) {
        return void 0;
      }
      if (part.sourceType === "url") {
        return {
          type: "source-url",
          sourceId: part.id,
          url: part.url,
          title: part.title,
          ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {}
        };
      }
      if (part.sourceType === "document") {
        return {
          type: "source-document",
          sourceId: part.id,
          mediaType: part.mediaType,
          title: part.title,
          filename: part.filename,
          ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {}
        };
      }
      return void 0;
    }
    case "custom": {
      return {
        type: "custom",
        kind: part.kind,
        ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {}
      };
    }
    case "tool-input-start": {
      const dynamic = isDynamic(part);
      return {
        type: "tool-input-start",
        toolCallId: part.id,
        toolName: part.toolName,
        ...part.providerExecuted != null ? { providerExecuted: part.providerExecuted } : {},
        ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {},
        ...part.toolMetadata != null ? { toolMetadata: part.toolMetadata } : {},
        ...dynamic != null ? { dynamic } : {},
        ...part.title != null ? { title: part.title } : {}
      };
    }
    case "tool-input-delta": {
      return {
        type: "tool-input-delta",
        toolCallId: part.id,
        inputTextDelta: part.delta
      };
    }
    case "tool-call": {
      const dynamic = isDynamic(part);
      if (part.invalid) {
        return {
          type: "tool-input-error",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
          ...part.providerExecuted != null ? { providerExecuted: part.providerExecuted } : {},
          ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {},
          ...part.toolMetadata != null ? { toolMetadata: part.toolMetadata } : {},
          ...dynamic != null ? { dynamic } : {},
          errorText: onError(part.error),
          ...part.title != null ? { title: part.title } : {}
        };
      }
      return {
        type: "tool-input-available",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        ...part.providerExecuted != null ? { providerExecuted: part.providerExecuted } : {},
        ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {},
        ...part.toolMetadata != null ? { toolMetadata: part.toolMetadata } : {},
        ...dynamic != null ? { dynamic } : {},
        ...part.title != null ? { title: part.title } : {}
      };
    }
    case "tool-approval-request": {
      return {
        type: "tool-approval-request",
        approvalId: part.approvalId,
        toolCallId: part.toolCall.toolCallId,
        ...part.isAutomatic != null ? { isAutomatic: part.isAutomatic } : {},
        ...part.signature != null ? { signature: part.signature } : {}
      };
    }
    case "tool-approval-response": {
      return {
        type: "tool-approval-response",
        approvalId: part.approvalId,
        approved: part.approved,
        ...part.reason != null ? { reason: part.reason } : {},
        ...part.providerExecuted != null ? { providerExecuted: part.providerExecuted } : {}
      };
    }
    case "tool-result": {
      const dynamic = isDynamic(part);
      return {
        type: "tool-output-available",
        toolCallId: part.toolCallId,
        // UI stream chunks are serialized as JSON, which drops undefined
        // properties. Use null so tool outputs always keep the output field.
        output: part.output === void 0 ? null : part.output,
        ...part.providerExecuted != null ? { providerExecuted: part.providerExecuted } : {},
        ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {},
        ...part.toolMetadata != null ? { toolMetadata: part.toolMetadata } : {},
        ...part.preliminary != null ? { preliminary: part.preliminary } : {},
        ...dynamic != null ? { dynamic } : {}
      };
    }
    case "tool-error": {
      const dynamic = isDynamic(part);
      return {
        type: "tool-output-error",
        toolCallId: part.toolCallId,
        errorText: part.providerExecuted ? typeof part.error === "string" ? part.error : JSON.stringify(part.error) : onError(part.error),
        ...part.providerExecuted != null ? { providerExecuted: part.providerExecuted } : {},
        ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {},
        ...part.toolMetadata != null ? { toolMetadata: part.toolMetadata } : {},
        ...dynamic != null ? { dynamic } : {}
      };
    }
    case "tool-output-denied": {
      return {
        type: "tool-output-denied",
        toolCallId: part.toolCallId
      };
    }
    case "error": {
      return {
        type: "error",
        errorText: onError(part.error)
      };
    }
    case "start-step": {
      return { type: "start-step" };
    }
    case "finish-step": {
      return { type: "finish-step" };
    }
    case "start": {
      if (!sendStart) {
        return void 0;
      }
      return {
        type: "start",
        ...messageMetadata != null ? { messageMetadata } : {},
        ...responseMessageId != null ? { messageId: responseMessageId } : {}
      };
    }
    case "finish": {
      if (!sendFinish) {
        return void 0;
      }
      return {
        type: "finish",
        finishReason: part.finishReason,
        ...messageMetadata != null ? { messageMetadata } : {}
      };
    }
    case "abort": {
      return part;
    }
    case "tool-input-end":
    case "raw": {
      return void 0;
    }
    default: {
      const exhaustiveCheck = partType;
      throw new Error(`Unknown chunk type: ${exhaustiveCheck}`);
    }
  }
}

// src/ui-message-stream/to-ui-message-stream.ts
function toUIMessageStream({
  stream,
  tools,
  sendReasoning = true,
  sendSources = false,
  sendStart = true,
  sendFinish = true,
  onError = () => "An error occurred.",
  // prevent leaking server error details to the client by default
  messageMetadata,
  originalMessages,
  generateMessageId,
  onEnd,
  onFinish
}) {
  const responseMessageId = generateMessageId != null ? getResponseUIMessageId({
    originalMessages,
    responseMessageId: generateMessageId
  }) : void 0;
  const uiMessageChunkStream = stream.pipeThrough(
    new TransformStream({
      transform: async (part, controller) => {
        const messageMetadataValue = messageMetadata == null ? void 0 : messageMetadata({ part });
        const uiMessageChunk = toUIMessageChunk(part, {
          tools,
          sendReasoning,
          sendSources,
          sendStart,
          sendFinish,
          onError,
          messageMetadata: messageMetadataValue,
          responseMessageId
        });
        if (uiMessageChunk != null) {
          controller.enqueue(uiMessageChunk);
        }
        if (messageMetadataValue != null && part.type !== "start" && part.type !== "finish") {
          controller.enqueue({
            type: "message-metadata",
            messageMetadata: messageMetadataValue
          });
        }
      }
    })
  );
  return handleUIMessageStreamFinish({
    stream: uiMessageChunkStream,
    messageId: responseMessageId != null ? responseMessageId : generateMessageId == null ? void 0 : generateMessageId(),
    originalMessages,
    onEnd: onEnd != null ? onEnd : onFinish,
    onError
  });
}

// src/util/async-iterable-stream.ts
function createAsyncIterableStream(source) {
  return asAsyncIterableStream(source.pipeThrough(new TransformStream()));
}
function asAsyncIterableStream(stream) {
  stream[Symbol.asyncIterator] = function() {
    const reader = this.getReader();
    let finished = false;
    async function cleanup(cancelStream) {
      var _a22;
      if (finished)
        return;
      finished = true;
      try {
        if (cancelStream) {
          await ((_a22 = reader.cancel) == null ? void 0 : _a22.call(reader));
        }
      } finally {
        try {
          reader.releaseLock();
        } catch (e) {
        }
      }
    }
    return {
      /**
       * Reads the next chunk from the stream.
       * @returns A promise resolving to the next IteratorResult.
       */
      async next() {
        if (finished) {
          return { done: true, value: void 0 };
        }
        const { done, value } = await reader.read();
        if (done) {
          await cleanup(true);
          return { done: true, value: void 0 };
        }
        return { done: false, value };
      },
      /**
       * May be called on early exit (e.g., break from for-await) or after completion.
       * Ensures the stream is cancelled and resources are released.
       * @returns A promise resolving to a completed IteratorResult.
       */
      async return() {
        await cleanup(true);
        return { done: true, value: void 0 };
      },
      /**
       * Called on early exit with error.
       * Ensures the stream is cancelled and resources are released, then rethrows the error.
       * @param err The error to throw.
       * @returns A promise that rejects with the provided error.
       */
      async throw(err) {
        await cleanup(true);
        throw err;
      }
    };
  };
  return stream;
}

// src/util/consume-stream.ts
async function consumeStream({
  stream,
  onError
}) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done)
        break;
    }
  } catch (error) {
    onError == null ? void 0 : onError(error);
  } finally {
    reader.releaseLock();
  }
}

// src/util/create-resolvable-promise.ts
function createResolvablePromise() {
  let resolve3;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve3 = res;
    reject = rej;
  });
  return {
    promise,
    resolve: resolve3,
    reject
  };
}

// src/util/create-stitchable-stream.ts
function createStitchableStream() {
  let innerStreams = [];
  let controller = null;
  let isClosed = false;
  let waitForNewStream = createResolvablePromise();
  const terminate = () => {
    isClosed = true;
    waitForNewStream.resolve();
    innerStreams.forEach(({ reader, onCancel }) => {
      onCancel == null ? void 0 : onCancel();
      reader.cancel();
    });
    innerStreams = [];
    controller == null ? void 0 : controller.close();
  };
  const processPull = async () => {
    var _a22;
    if (isClosed && innerStreams.length === 0) {
      controller == null ? void 0 : controller.close();
      return;
    }
    if (innerStreams.length === 0) {
      waitForNewStream = createResolvablePromise();
      await waitForNewStream.promise;
      return await processPull();
    }
    const currentStream = innerStreams[0];
    try {
      const { value, done } = await currentStream.reader.read();
      if (done) {
        innerStreams.shift();
        if (innerStreams.length === 0 && isClosed) {
          controller == null ? void 0 : controller.close();
        } else {
          await processPull();
        }
      } else {
        controller == null ? void 0 : controller.enqueue(value);
      }
    } catch (error) {
      (_a22 = currentStream.onError) == null ? void 0 : _a22.call(currentStream, error);
      controller == null ? void 0 : controller.error(error);
      innerStreams.shift();
      terminate();
    }
  };
  return {
    stream: new ReadableStream({
      start(controllerParam) {
        controller = controllerParam;
      },
      pull: processPull,
      async cancel() {
        for (const { reader, onCancel } of innerStreams) {
          onCancel == null ? void 0 : onCancel();
          await reader.cancel();
        }
        innerStreams = [];
        isClosed = true;
      }
    }),
    addStream: (innerStream, callbacks) => {
      if (isClosed) {
        throw new Error("Cannot add inner stream: outer stream is closed");
      }
      innerStreams.push({
        reader: innerStream.getReader(),
        ...callbacks
      });
      waitForNewStream.resolve();
    },
    /**
     * Gracefully close the outer stream. This will let the inner streams
     * finish processing and then close the outer stream.
     */
    close: () => {
      isClosed = true;
      waitForNewStream.resolve();
      if (innerStreams.length === 0) {
        controller == null ? void 0 : controller.close();
      }
    },
    /**
     * Immediately close the outer stream. This will cancel all inner streams
     * and close the outer stream.
     */
    terminate
  };
}

// src/generate-text/execute-tools-from-stream.ts
function executeToolsFromStream({
  stream,
  tools,
  callId,
  messages,
  abortSignal,
  timeout,
  experimental_sandbox: sandbox,
  toolsContext,
  toolApproval,
  runtimeContext,
  toolApprovalSecret,
  generateId: generateId2,
  onToolExecutionStart,
  onToolExecutionEnd,
  executeToolInTelemetryContext,
  runInTracingChannelSpan
}) {
  const toolCallsToExecute = [];
  return stream.pipeThrough(
    new TransformStream({
      async transform(chunk, controller) {
        controller.enqueue(chunk);
        const chunkType = chunk.type;
        switch (chunkType) {
          case "tool-call": {
            if (chunk.invalid) {
              return;
            }
            const tool2 = getOwn(tools, chunk.toolName);
            if (tool2 == null) {
              return;
            }
            const toolApprovalStatus = await resolveToolApproval({
              tools,
              toolCall: chunk,
              toolApproval,
              messages,
              toolsContext,
              runtimeContext
            });
            if (toolApprovalStatus.type === "not-applicable") {
              if (tool2.execute != null && chunk.providerExecuted !== true) {
                toolCallsToExecute.push(chunk);
              }
              return;
            }
            const approvalId = generateId2();
            const signature = await maybeSignApproval({
              secret: toolApprovalSecret,
              approvalId,
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              input: chunk.input
            });
            switch (toolApprovalStatus.type) {
              case "user-approval": {
                controller.enqueue({
                  type: "tool-approval-request",
                  approvalId,
                  toolCall: chunk,
                  ...signature != null ? { signature } : {}
                });
                return;
              }
              case "denied": {
                controller.enqueue({
                  type: "tool-approval-request",
                  approvalId,
                  toolCall: chunk,
                  isAutomatic: true,
                  ...signature != null ? { signature } : {}
                });
                controller.enqueue({
                  type: "tool-approval-response",
                  approvalId,
                  approved: false,
                  toolCall: chunk,
                  reason: toolApprovalStatus.reason,
                  providerExecuted: chunk.providerExecuted
                });
                return;
              }
              case "approved": {
                controller.enqueue({
                  type: "tool-approval-request",
                  approvalId,
                  toolCall: chunk,
                  isAutomatic: true,
                  ...signature != null ? { signature } : {}
                });
                controller.enqueue({
                  type: "tool-approval-response",
                  approvalId,
                  approved: true,
                  toolCall: chunk,
                  reason: toolApprovalStatus.reason,
                  providerExecuted: chunk.providerExecuted
                });
                break;
              }
            }
            if (tool2.execute != null && chunk.providerExecuted !== true) {
              toolCallsToExecute.push(chunk);
            }
            return;
          }
          case "model-call-end": {
            await Promise.all(
              toolCallsToExecute.map(async (toolCall) => {
                try {
                  const result = await executeToolCall({
                    toolCall,
                    tools,
                    callId,
                    messages,
                    abortSignal,
                    timeout,
                    experimental_sandbox: sandbox,
                    toolsContext,
                    onToolExecutionStart,
                    onToolExecutionEnd,
                    executeToolInTelemetryContext,
                    runInTracingChannelSpan,
                    onPreliminaryToolResult: (result2) => {
                      controller.enqueue(result2);
                    }
                  });
                  if (result != null) {
                    controller.enqueue({
                      type: "tool-execution-end",
                      toolCallId: result.output.toolCallId,
                      toolExecutionMs: result.toolExecutionMs
                    });
                    controller.enqueue(result.output);
                  }
                } catch (error) {
                  controller.enqueue({
                    type: "error",
                    error
                  });
                }
              })
            );
            return;
          }
        }
      }
    })
  );
}

// src/generate-text/invoke-tool-callbacks-from-stream.ts
function invokeToolCallbacksFromStream({
  stream,
  tools,
  stepInputMessages,
  abortSignal,
  runtimeContext
}) {
  if (tools == null)
    return stream;
  const ongoingToolCallToolNames = createIdMap();
  return stream.pipeThrough(
    new TransformStream({
      async transform(chunk, controller) {
        controller.enqueue(chunk);
        switch (chunk.type) {
          case "tool-input-start": {
            ongoingToolCallToolNames[chunk.id] = chunk.toolName;
            const tool2 = getOwn(tools, chunk.toolName);
            if ((tool2 == null ? void 0 : tool2.onInputStart) != null) {
              await tool2.onInputStart({
                toolCallId: chunk.id,
                messages: stepInputMessages,
                abortSignal,
                context: runtimeContext
              });
            }
            break;
          }
          case "tool-input-delta": {
            const toolName = ongoingToolCallToolNames[chunk.id];
            const tool2 = getOwn(tools, toolName);
            if ((tool2 == null ? void 0 : tool2.onInputDelta) != null) {
              await tool2.onInputDelta({
                inputTextDelta: chunk.delta,
                toolCallId: chunk.id,
                messages: stepInputMessages,
                abortSignal,
                context: runtimeContext
              });
            }
            break;
          }
          case "tool-call": {
            const toolName = ongoingToolCallToolNames[chunk.toolCallId];
            const tool2 = getOwn(tools, toolName);
            delete ongoingToolCallToolNames[chunk.toolCallId];
            if ((tool2 == null ? void 0 : tool2.onInputAvailable) != null) {
              await tool2.onInputAvailable({
                input: chunk.input,
                toolCallId: chunk.toolCallId,
                messages: stepInputMessages,
                abortSignal,
                context: runtimeContext
              });
            }
          }
        }
      }
    })
  );
}

// src/generate-text/stream-language-model-call.ts
import {
  getErrorMessage as getErrorMessage5
} from "@ai-sdk/provider";
import {
  createIdGenerator as createIdGenerator2
} from "@ai-sdk/provider-utils";
var originalGenerateId2 = createIdGenerator2({
  prefix: "aitxt",
  size: 24
});
var originalGenerateCallId2 = createIdGenerator2({
  prefix: "call",
  size: 24
});
async function streamLanguageModelCall({
  model,
  tools,
  toolOrder,
  output,
  toolChoice,
  prompt,
  system,
  instructions,
  messages,
  allowSystemInMessages,
  download: download2,
  abortSignal,
  headers,
  includeRawChunks,
  providerOptions,
  repairToolCall,
  refineToolInput,
  executeLanguageModelCallInTelemetryContext = async ({ execute }) => await execute(),
  callId,
  toolsContext,
  experimental_sandbox: sandbox,
  _internal: {
    generateId: generateId2 = originalGenerateId2,
    generateCallId = originalGenerateCallId2,
    now: now2 = now
  } = {},
  onStart,
  onLanguageModelCallStart,
  onLanguageModelCallEnd,
  ...callSettings
}) {
  const resolvedModel = resolveLanguageModel(model);
  const effectiveCallId = callId != null ? callId : generateCallId();
  const standardizedPrompt = await standardizePrompt({
    instructions,
    system,
    prompt,
    messages,
    allowSystemInMessages
  });
  const promptMessages = await convertToLanguageModelPrompt({
    prompt: {
      instructions: standardizedPrompt.instructions,
      messages: standardizedPrompt.messages
    },
    supportedUrls: await resolvedModel.supportedUrls,
    download: download2,
    provider: resolvedModel.provider.split(".")[0]
  });
  const stepTools = await prepareTools({
    tools,
    toolOrder,
    toolsContext,
    experimental_sandbox: sandbox
  });
  const stepToolChoice = prepareToolChoice({
    toolChoice
  });
  await notify({
    event: { promptMessages },
    callbacks: onStart
  });
  const languageModelCallContext = {
    provider: resolvedModel.provider,
    modelId: resolvedModel.modelId,
    instructions: standardizedPrompt.instructions,
    messages: standardizedPrompt.messages,
    tools: stepTools,
    ...callSettings
  };
  const languageModelCallStartEvent = {
    callId: effectiveCallId,
    ...languageModelCallContext
  };
  await notify({
    event: languageModelCallStartEvent,
    callbacks: onLanguageModelCallStart
  });
  const callStartTimestampMs = now2();
  const {
    stream: languageModelStream,
    response,
    request
  } = await executeLanguageModelCallInTelemetryContext({
    ...languageModelCallStartEvent,
    execute: async () => await resolvedModel.doStream({
      ...callSettings,
      tools: stepTools,
      toolChoice: stepToolChoice,
      responseFormat: await (output == null ? void 0 : output.responseFormat),
      prompt: promptMessages,
      providerOptions,
      abortSignal,
      headers,
      includeRawChunks
    })
  });
  const standardizedStream = languageModelStream.pipeThrough(
    createLanguageModelV4StreamPartToLanguageModelStreamPartTransform({
      tools,
      instructions: standardizedPrompt.instructions,
      messages: standardizedPrompt.messages,
      repairToolCall,
      refineToolInput,
      callId: effectiveCallId,
      provider: resolvedModel.provider,
      modelId: resolvedModel.modelId,
      generateId: generateId2,
      now: now2,
      callStartTimestampMs,
      onLanguageModelCallEnd
    })
  );
  return {
    stream: createAsyncIterableStream(standardizedStream),
    response,
    request
  };
}
function createLanguageModelV4StreamPartToLanguageModelStreamPartTransform({
  tools,
  instructions,
  messages,
  repairToolCall,
  refineToolInput,
  callId,
  provider,
  modelId,
  generateId: generateId2,
  now: now2,
  callStartTimestampMs,
  onLanguageModelCallEnd
}) {
  const toolCallsByToolCallId = /* @__PURE__ */ new Map();
  const modelCallContent = [];
  const textPartIndexes = /* @__PURE__ */ new Map();
  const reasoningPartIndexes = /* @__PURE__ */ new Map();
  let responseId = generateId2();
  let timeToFirstOutputMs;
  let previousOutputChunkTimestampMs;
  const timeBetweenOutputChunksMs = [];
  return new TransformStream({
    async transform(chunk, controller) {
      var _a22, _b;
      if (isOutputChunk(chunk)) {
        const outputChunkTimestampMs = now2();
        if (timeToFirstOutputMs == null) {
          timeToFirstOutputMs = outputChunkTimestampMs - callStartTimestampMs;
        } else if (previousOutputChunkTimestampMs != null) {
          timeBetweenOutputChunksMs.push(
            outputChunkTimestampMs - previousOutputChunkTimestampMs
          );
        }
        previousOutputChunkTimestampMs = outputChunkTimestampMs;
      }
      switch (chunk.type) {
        case "text-start":
          upsertTextContentPart({
            content: modelCallContent,
            partIndexes: textPartIndexes,
            id: chunk.id,
            type: "text",
            providerMetadata: chunk.providerMetadata
          });
          controller.enqueue(chunk);
          break;
        case "text-delta":
          upsertTextContentPart({
            content: modelCallContent,
            partIndexes: textPartIndexes,
            id: chunk.id,
            type: "text",
            textDelta: chunk.delta,
            providerMetadata: chunk.providerMetadata
          });
          controller.enqueue({
            type: "text-delta",
            id: chunk.id,
            text: chunk.delta,
            providerMetadata: chunk.providerMetadata
          });
          break;
        case "text-end":
          upsertTextContentPart({
            content: modelCallContent,
            partIndexes: textPartIndexes,
            id: chunk.id,
            type: "text",
            providerMetadata: chunk.providerMetadata
          });
          textPartIndexes.delete(chunk.id);
          controller.enqueue(chunk);
          break;
        case "reasoning-start":
          upsertTextContentPart({
            content: modelCallContent,
            partIndexes: reasoningPartIndexes,
            id: chunk.id,
            type: "reasoning",
            providerMetadata: chunk.providerMetadata
          });
          controller.enqueue(chunk);
          break;
        case "reasoning-delta":
          upsertTextContentPart({
            content: modelCallContent,
            partIndexes: reasoningPartIndexes,
            id: chunk.id,
            type: "reasoning",
            textDelta: chunk.delta,
            providerMetadata: chunk.providerMetadata
          });
          controller.enqueue({
            type: "reasoning-delta",
            id: chunk.id,
            text: chunk.delta,
            providerMetadata: chunk.providerMetadata
          });
          break;
        case "reasoning-end":
          upsertTextContentPart({
            content: modelCallContent,
            partIndexes: reasoningPartIndexes,
            id: chunk.id,
            type: "reasoning",
            providerMetadata: chunk.providerMetadata
          });
          reasoningPartIndexes.delete(chunk.id);
          controller.enqueue(chunk);
          break;
        case "file":
        case "reasoning-file": {
          const file = new DefaultGeneratedFileWithType({
            data: chunk.data.type === "data" ? chunk.data.data : chunk.data.url.toString(),
            mediaType: chunk.mediaType
          });
          modelCallContent.push({
            type: chunk.type,
            file,
            ...chunk.providerMetadata != null ? { providerMetadata: chunk.providerMetadata } : {}
          });
          controller.enqueue({
            type: chunk.type,
            file,
            providerMetadata: chunk.providerMetadata
          });
          break;
        }
        case "finish": {
          const usage = asLanguageModelUsage(chunk.usage);
          const responseTimeMs = now2() - callStartTimestampMs;
          const performance = {
            responseTimeMs,
            effectiveOutputTokensPerSecond: calculateTokensPerSecond({
              tokens: usage.outputTokens,
              durationMs: responseTimeMs
            }),
            outputTokensPerSecond: timeToFirstOutputMs == null ? void 0 : calculateTokensPerSecond({
              tokens: usage.outputTokens,
              durationMs: responseTimeMs - timeToFirstOutputMs
            }),
            inputTokensPerSecond: timeToFirstOutputMs == null ? void 0 : calculateTokensPerSecond({
              tokens: usage.inputTokens,
              durationMs: timeToFirstOutputMs
            }),
            effectiveTotalTokensPerSecond: calculateTokensPerSecond({
              tokens: sumTokenCounts(usage.inputTokens, usage.outputTokens),
              durationMs: responseTimeMs
            }),
            timeToFirstOutputMs,
            timeBetweenOutputChunksMs: timeBetweenOutputChunksMs.length > 0 ? calculateOutputChunkTimingStats(timeBetweenOutputChunksMs) : void 0
          };
          await notify({
            event: {
              callId,
              provider,
              modelId,
              finishReason: chunk.finishReason.unified,
              usage,
              content: modelCallContent,
              responseId,
              performance
            },
            callbacks: onLanguageModelCallEnd
          });
          controller.enqueue({
            type: "model-call-end",
            finishReason: chunk.finishReason.unified,
            rawFinishReason: chunk.finishReason.raw,
            usage,
            providerMetadata: chunk.providerMetadata,
            performance
          });
          break;
        }
        case "tool-call": {
          try {
            const toolCall = await parseToolCall({
              toolCall: chunk,
              tools,
              repairToolCall,
              refineToolInput,
              instructions,
              messages
            });
            toolCallsByToolCallId.set(toolCall.toolCallId, toolCall);
            controller.enqueue(toolCall);
            modelCallContent.push(toolCall);
            if (toolCall.invalid) {
              controller.enqueue({
                type: "tool-error",
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                input: toolCall.input,
                error: getErrorMessage5(toolCall.error),
                dynamic: true,
                title: toolCall.title,
                ...toolCall.toolMetadata != null ? { toolMetadata: toolCall.toolMetadata } : {}
              });
              break;
            }
          } catch (error) {
            controller.enqueue({ type: "error", error });
          }
          break;
        }
        case "tool-approval-request": {
          const toolCall = toolCallsByToolCallId.get(chunk.toolCallId);
          if (toolCall == null) {
            controller.enqueue({
              type: "error",
              error: new ToolCallNotFoundForApprovalError({
                toolCallId: chunk.toolCallId,
                approvalId: chunk.approvalId
              })
            });
            break;
          }
          const toolApprovalRequest = {
            type: "tool-approval-request",
            approvalId: chunk.approvalId,
            toolCall
          };
          controller.enqueue(toolApprovalRequest);
          modelCallContent.push(toolApprovalRequest);
          break;
        }
        case "tool-result": {
          const toolName = chunk.toolName;
          const toolCall = toolCallsByToolCallId.get(chunk.toolCallId);
          const toolResultPart = chunk.isError ? {
            type: "tool-error",
            toolCallId: chunk.toolCallId,
            toolName,
            input: toolCall == null ? void 0 : toolCall.input,
            providerExecuted: true,
            error: chunk.result,
            dynamic: chunk.dynamic,
            ...chunk.providerMetadata != null ? { providerMetadata: chunk.providerMetadata } : {},
            ...(toolCall == null ? void 0 : toolCall.toolMetadata) != null ? { toolMetadata: toolCall.toolMetadata } : {}
          } : {
            type: "tool-result",
            toolCallId: chunk.toolCallId,
            toolName,
            input: toolCall == null ? void 0 : toolCall.input,
            output: chunk.result,
            providerExecuted: true,
            dynamic: chunk.dynamic,
            ...chunk.providerMetadata != null ? { providerMetadata: chunk.providerMetadata } : {},
            ...(toolCall == null ? void 0 : toolCall.toolMetadata) != null ? { toolMetadata: toolCall.toolMetadata } : {}
          };
          controller.enqueue(toolResultPart);
          modelCallContent.push(toolResultPart);
          break;
        }
        case "tool-input-start": {
          const tool2 = getOwn(tools, chunk.toolName);
          controller.enqueue({
            ...chunk,
            dynamic: (_a22 = chunk.dynamic) != null ? _a22 : (tool2 == null ? void 0 : tool2.type) === "dynamic",
            title: tool2 == null ? void 0 : tool2.title,
            ...(tool2 == null ? void 0 : tool2.metadata) != null ? { toolMetadata: tool2.metadata } : {}
          });
          break;
        }
        case "stream-start": {
          controller.enqueue({
            type: "model-call-start",
            warnings: chunk.warnings
          });
          break;
        }
        case "response-metadata": {
          responseId = (_b = chunk.id) != null ? _b : responseId;
          controller.enqueue({
            type: "model-call-response-metadata",
            id: chunk.id,
            timestamp: chunk.timestamp,
            modelId: chunk.modelId
          });
          break;
        }
        default:
          if (chunk.type === "custom" || chunk.type === "source") {
            modelCallContent.push(chunk);
          }
          controller.enqueue(chunk);
          break;
      }
    }
  });
}
function isOutputChunk(chunk) {
  return chunk.type === "text-delta" && chunk.delta.length > 0 || chunk.type === "reasoning-delta" && chunk.delta.length > 0 || chunk.type === "tool-input-delta" && chunk.delta.length > 0 || chunk.type === "file" || chunk.type === "reasoning-file" || chunk.type === "tool-call";
}
function calculateOutputChunkTimingStats(timingsMs) {
  const sortedTimingsMs = [...timingsMs].sort((a, b) => a - b);
  const sum = timingsMs.reduce((sum2, timingMs) => sum2 + timingMs, 0);
  return {
    min: sortedTimingsMs[0],
    p10: calculateNearestRankPercentile(sortedTimingsMs, 0.1),
    median: calculateNearestRankPercentile(sortedTimingsMs, 0.5),
    avg: sum / timingsMs.length,
    p90: calculateNearestRankPercentile(sortedTimingsMs, 0.9),
    max: sortedTimingsMs[sortedTimingsMs.length - 1]
  };
}
function calculateNearestRankPercentile(sortedValues, percentile) {
  return sortedValues[Math.ceil(percentile * sortedValues.length) - 1];
}
function upsertTextContentPart({
  content,
  partIndexes,
  id,
  type,
  textDelta,
  providerMetadata
}) {
  let partIndex = partIndexes.get(id);
  if (partIndex == null) {
    partIndex = content.push({
      type,
      text: "",
      ...providerMetadata != null ? { providerMetadata } : {}
    }) - 1;
    partIndexes.set(id, partIndex);
  }
  const part = content[partIndex];
  if (textDelta != null) {
    part.text += textDelta;
  }
  if (providerMetadata != null) {
    part.providerMetadata = providerMetadata;
  }
}

// src/generate-text/stream-text.ts
var originalGenerateId3 = createIdGenerator3({
  prefix: "aitxt",
  size: 24
});
var originalGenerateCallId3 = createIdGenerator3({
  prefix: "call",
  size: 24
});
var isOutputChunkType = {
  file: true,
  custom: false,
  source: false,
  "text-start": false,
  "text-end": false,
  "text-delta": true,
  "reasoning-start": false,
  "reasoning-end": false,
  "reasoning-delta": true,
  "reasoning-file": true,
  "tool-input-start": false,
  "tool-input-end": false,
  "tool-input-delta": true,
  "tool-approval-request": false,
  "tool-approval-response": false,
  "tool-call": true,
  "tool-result": false,
  "tool-error": false,
  "tool-execution-end": false,
  "model-call-start": false,
  "model-call-response-metadata": false,
  "model-call-end": false,
  error: false,
  raw: false
};
function isOutputChunk2(chunk) {
  if (!isOutputChunkType[chunk.type]) {
    return false;
  }
  switch (chunk.type) {
    case "text-delta":
    case "reasoning-delta":
      return chunk.text.length > 0;
    case "tool-input-delta":
      return chunk.delta.length > 0;
    case "file":
    case "reasoning-file":
    case "tool-call":
      return true;
    default:
      return false;
  }
}
function streamText({
  model,
  tools,
  toolChoice,
  instructions,
  system,
  prompt,
  messages,
  allowSystemInMessages,
  maxRetries,
  abortSignal,
  timeout,
  headers,
  stopWhen = isStepCount(1),
  experimental_sandbox: sandbox,
  output,
  toolApproval,
  experimental_toolApprovalSecret,
  experimental_telemetry,
  telemetry = experimental_telemetry,
  prepareStep,
  providerOptions,
  activeTools,
  toolOrder,
  experimental_repairToolCall,
  repairToolCall = experimental_repairToolCall,
  experimental_refineToolInput: refineToolInput,
  experimental_transform: transform,
  experimental_download: download2,
  includeRawChunks,
  onChunk,
  onError = ({ error }) => {
    console.error(error);
  },
  onFinish,
  onEnd = onFinish,
  onAbort,
  onStepEnd,
  onStepFinish,
  onStart,
  experimental_onStart,
  onStepStart,
  experimental_onStepStart,
  onLanguageModelCallStart,
  experimental_onLanguageModelCallStart,
  onLanguageModelCallEnd,
  experimental_onLanguageModelCallEnd,
  onToolExecutionStart,
  onToolExecutionEnd,
  experimental_onToolCallStart,
  experimental_onToolCallFinish,
  runtimeContext = {},
  toolsContext = {},
  experimental_include,
  include = experimental_include,
  _internal: {
    now: now2 = now,
    generateId: generateId2 = originalGenerateId3,
    generateCallId = originalGenerateCallId3
  } = {},
  ...settings
}) {
  var _a22, _b, _c, _d;
  const totalTimeoutMs = getTotalTimeoutMs(timeout);
  const stepTimeoutMs = getStepTimeoutMs(timeout);
  const firstChunkTimeoutMs = getFirstChunkTimeoutMs(timeout);
  const chunkTimeoutMs = getChunkTimeoutMs(timeout);
  const stepAbortController = stepTimeoutMs != null ? new AbortController() : void 0;
  const firstChunkAbortController = firstChunkTimeoutMs != null ? new AbortController() : void 0;
  const chunkAbortController = chunkTimeoutMs != null ? new AbortController() : void 0;
  const resolvedOnStart = onStart != null ? onStart : experimental_onStart;
  const resolvedOnStepStart = onStepStart != null ? onStepStart : experimental_onStepStart;
  const resolvedOnLanguageModelCallStart = onLanguageModelCallStart != null ? onLanguageModelCallStart : experimental_onLanguageModelCallStart;
  const resolvedOnLanguageModelCallEnd = onLanguageModelCallEnd != null ? onLanguageModelCallEnd : experimental_onLanguageModelCallEnd;
  const resolvedOnToolExecutionStart = onToolExecutionStart != null ? onToolExecutionStart : experimental_onToolCallStart;
  const resolvedOnToolExecutionEnd = onToolExecutionEnd != null ? onToolExecutionEnd : experimental_onToolCallFinish;
  const resolvedOnStepEnd = onStepEnd != null ? onStepEnd : onStepFinish;
  return new DefaultStreamTextResult({
    model: resolveLanguageModel(model),
    telemetry,
    headers,
    settings,
    maxRetries,
    abortSignal: mergeAbortSignals(
      abortSignal,
      totalTimeoutMs,
      stepAbortController == null ? void 0 : stepAbortController.signal,
      firstChunkAbortController == null ? void 0 : firstChunkAbortController.signal,
      chunkAbortController == null ? void 0 : chunkAbortController.signal
    ),
    stepTimeoutMs,
    stepAbortController,
    firstChunkTimeoutMs,
    firstChunkAbortController,
    chunkTimeoutMs,
    chunkAbortController,
    instructions,
    system,
    prompt,
    messages,
    allowSystemInMessages,
    experimental_sandbox: sandbox,
    tools,
    toolsContext,
    runtimeContext,
    toolChoice,
    transforms: asArray6(transform),
    activeTools,
    toolOrder,
    repairToolCall,
    refineToolInput,
    stopConditions: asArray6(stopWhen),
    output,
    toolApproval,
    experimental_toolApprovalSecret,
    providerOptions,
    prepareStep,
    timeout,
    onChunk,
    onError,
    onEnd,
    onAbort,
    onStepFinish: resolvedOnStepEnd,
    onStart: resolvedOnStart,
    onStepStart: resolvedOnStepStart,
    onLanguageModelCallStart: resolvedOnLanguageModelCallStart,
    onLanguageModelCallEnd: resolvedOnLanguageModelCallEnd,
    onToolExecutionStart: resolvedOnToolExecutionStart,
    onToolExecutionEnd: resolvedOnToolExecutionEnd,
    now: now2,
    generateId: generateId2,
    generateCallId,
    download: download2,
    // assign default values to include:
    include: {
      requestBody: (_a22 = include == null ? void 0 : include.requestBody) != null ? _a22 : false,
      requestMessages: (_b = include == null ? void 0 : include.requestMessages) != null ? _b : false,
      rawChunks: (_d = (_c = include == null ? void 0 : include.rawChunks) != null ? _c : includeRawChunks) != null ? _d : false
    }
  });
}
async function markPromiseAsHandled(promise) {
  try {
    await promise;
  } catch (e) {
  }
}
function createOutputTransformStream(output) {
  let firstTextChunkId = void 0;
  let text2 = "";
  let textChunk = "";
  let textProviderMetadata = void 0;
  let lastPublishedValue = "";
  function publishTextChunk({
    controller,
    partialOutput = void 0
  }) {
    controller.enqueue({
      part: {
        type: "text-delta",
        id: firstTextChunkId,
        text: textChunk,
        providerMetadata: textProviderMetadata
      },
      partialOutput
    });
    textChunk = "";
  }
  return new TransformStream({
    async transform(chunk, controller) {
      var _a22;
      if (chunk.type === "finish-step" && textChunk.length > 0) {
        publishTextChunk({ controller });
      }
      if (chunk.type !== "text-delta" && chunk.type !== "text-start" && chunk.type !== "text-end") {
        controller.enqueue({ part: chunk, partialOutput: void 0 });
        return;
      }
      if (firstTextChunkId == null) {
        firstTextChunkId = chunk.id;
      } else if (chunk.id !== firstTextChunkId) {
        controller.enqueue({ part: chunk, partialOutput: void 0 });
        return;
      }
      if (chunk.type === "text-start") {
        controller.enqueue({ part: chunk, partialOutput: void 0 });
        return;
      }
      if (chunk.type === "text-end") {
        if (textChunk.length > 0) {
          publishTextChunk({ controller });
        }
        controller.enqueue({ part: chunk, partialOutput: void 0 });
        return;
      }
      text2 += chunk.text;
      textChunk += chunk.text;
      textProviderMetadata = (_a22 = chunk.providerMetadata) != null ? _a22 : textProviderMetadata;
      const result = await output.parsePartialOutput({ text: text2 });
      if (result !== void 0) {
        const currentValue = typeof result.partial === "string" ? result.partial : JSON.stringify(result.partial);
        if (currentValue !== lastPublishedValue) {
          publishTextChunk({ controller, partialOutput: result.partial });
          lastPublishedValue = currentValue;
        }
      }
    }
  });
}
var DefaultStreamTextResult = class {
  constructor({
    model,
    telemetry,
    headers,
    settings,
    maxRetries: maxRetriesArg,
    abortSignal,
    stepTimeoutMs,
    stepAbortController,
    firstChunkTimeoutMs,
    firstChunkAbortController,
    chunkTimeoutMs,
    chunkAbortController,
    instructions,
    system,
    prompt,
    messages,
    allowSystemInMessages,
    experimental_sandbox: sandbox,
    tools,
    toolChoice,
    transforms,
    activeTools,
    toolOrder,
    repairToolCall,
    refineToolInput,
    stopConditions,
    output,
    toolApproval,
    experimental_toolApprovalSecret,
    providerOptions,
    prepareStep,
    now: now2,
    generateId: generateId2,
    generateCallId,
    timeout,
    onChunk,
    onError,
    onEnd,
    onAbort,
    onStepFinish,
    onStart,
    onStepStart,
    onLanguageModelCallStart,
    onLanguageModelCallEnd,
    onToolExecutionStart,
    onToolExecutionEnd,
    runtimeContext,
    toolsContext,
    download: download2,
    include
  }) {
    this._totalUsage = new DelayedPromise();
    this._finishReason = new DelayedPromise();
    this._rawFinishReason = new DelayedPromise();
    this._steps = new DelayedPromise();
    this._initialResponseMessages = new DelayedPromise();
    this.outputSpecification = output;
    this.tools = tools;
    const telemetryDispatcher = createRestrictedTelemetryDispatcher({
      telemetry,
      includeRuntimeContext: telemetry == null ? void 0 : telemetry.includeRuntimeContext,
      includeToolsContext: telemetry == null ? void 0 : telemetry.includeToolsContext
    });
    let stepFinish;
    let recordedContent = [];
    let recordedFinishReason = void 0;
    let recordedRawFinishReason = void 0;
    let recordedTotalUsage = void 0;
    let recordedRequest = {};
    let recordedRequestMessages = [];
    let recordedWarnings = [];
    const recordedSteps = [];
    const initialResponseMessages = [];
    let stepMessagesForNextStep;
    let currentStepMessages = [];
    const pendingDeferredToolCalls = /* @__PURE__ */ new Map();
    let activeTextContent = createIdMap();
    let activeReasoningContent = createIdMap();
    let recordedNoOutputError;
    const eventProcessor = new TransformStream({
      async transform(chunk, controller) {
        var _a22, _b, _c, _d;
        controller.enqueue(chunk);
        const { part } = chunk;
        await (onChunk == null ? void 0 : onChunk({ chunk: part }));
        if (part.type === "error") {
          const error = wrapGatewayError(part.error);
          if (NoOutputGeneratedError.isInstance(error)) {
            recordedNoOutputError = error;
          }
          await onError({ error });
        }
        if (part.type === "custom" || part.type === "source" || part.type === "tool-call" || part.type === "tool-approval-request" || part.type === "tool-approval-response" || part.type === "tool-error") {
          recordedContent.push(part);
        }
        if (part.type === "text-start") {
          activeTextContent[part.id] = {
            type: "text",
            text: "",
            providerMetadata: part.providerMetadata
          };
          recordedContent.push(activeTextContent[part.id]);
        }
        if (part.type === "text-delta") {
          const activeText = activeTextContent[part.id];
          if (activeText == null) {
            controller.enqueue({
              part: {
                type: "error",
                error: `text part ${part.id} not found`
              },
              partialOutput: void 0
            });
            return;
          }
          activeText.text += part.text;
          activeText.providerMetadata = (_a22 = part.providerMetadata) != null ? _a22 : activeText.providerMetadata;
        }
        if (part.type === "text-end") {
          const activeText = activeTextContent[part.id];
          if (activeText == null) {
            controller.enqueue({
              part: {
                type: "error",
                error: `text part ${part.id} not found`
              },
              partialOutput: void 0
            });
            return;
          }
          activeText.providerMetadata = (_b = part.providerMetadata) != null ? _b : activeText.providerMetadata;
          delete activeTextContent[part.id];
        }
        if (part.type === "reasoning-start") {
          activeReasoningContent[part.id] = {
            type: "reasoning",
            text: "",
            providerMetadata: part.providerMetadata
          };
          recordedContent.push(activeReasoningContent[part.id]);
        }
        if (part.type === "reasoning-delta") {
          const activeReasoning = activeReasoningContent[part.id];
          if (activeReasoning == null) {
            controller.enqueue({
              part: {
                type: "error",
                error: `reasoning part ${part.id} not found`
              },
              partialOutput: void 0
            });
            return;
          }
          activeReasoning.text += part.text;
          activeReasoning.providerMetadata = (_c = part.providerMetadata) != null ? _c : activeReasoning.providerMetadata;
        }
        if (part.type === "reasoning-end") {
          const activeReasoning = activeReasoningContent[part.id];
          if (activeReasoning == null) {
            controller.enqueue({
              part: {
                type: "error",
                error: `reasoning part ${part.id} not found`
              },
              partialOutput: void 0
            });
            return;
          }
          activeReasoning.providerMetadata = (_d = part.providerMetadata) != null ? _d : activeReasoning.providerMetadata;
          delete activeReasoningContent[part.id];
        }
        if (part.type === "file" || part.type === "reasoning-file") {
          recordedContent.push({
            type: part.type,
            file: part.file,
            ...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {}
          });
        }
        if (part.type === "tool-result" && !part.preliminary) {
          recordedContent.push(part);
        }
        if (part.type === "start-step") {
          recordedContent = [];
          activeReasoningContent = createIdMap();
          activeTextContent = createIdMap();
          recordedRequest = part.request;
          recordedWarnings = part.warnings;
        }
        if (part.type === "finish-step") {
          const stepResponseMessages = await toResponseMessages({
            content: recordedContent,
            tools
          });
          const currentStepResult = new DefaultStepResult({
            callId,
            stepNumber: recordedSteps.length,
            provider: model.provider,
            modelId: model.modelId,
            runtimeContext,
            toolsContext,
            content: recordedContent,
            finishReason: part.finishReason,
            rawFinishReason: part.rawFinishReason,
            usage: part.usage,
            performance: part.performance,
            warnings: recordedWarnings,
            request: {
              ...recordedRequest,
              messages: include.requestMessages ? cloneModelMessages(recordedRequestMessages) : void 0
            },
            response: {
              ...part.response,
              messages: cloneModelMessages(stepResponseMessages)
            },
            providerMetadata: part.providerMetadata
          });
          await notify({
            event: currentStepResult,
            callbacks: [onStepFinish, telemetryDispatcher.onStepEnd]
          });
          logWarnings({
            warnings: recordedWarnings,
            provider: model.provider,
            model: model.modelId
          });
          recordedSteps.push(currentStepResult);
          stepMessagesForNextStep = [
            ...currentStepMessages,
            ...stepResponseMessages
          ];
          stepFinish.resolve();
        }
        if (part.type === "finish") {
          recordedTotalUsage = part.totalUsage;
          recordedFinishReason = part.finishReason;
          recordedRawFinishReason = part.rawFinishReason;
        }
      },
      async flush(controller) {
        try {
          if (recordedSteps.length === 0 || recordedNoOutputError != null) {
            const error = (abortSignal == null ? void 0 : abortSignal.aborted) ? abortSignal.reason : recordedNoOutputError != null ? recordedNoOutputError : new NoOutputGeneratedError({
              message: "No output generated. Check the stream for errors."
            });
            self.rejectResultPromises(error);
            return;
          }
          const finishReason = recordedFinishReason != null ? recordedFinishReason : "other";
          const totalUsage = recordedTotalUsage != null ? recordedTotalUsage : createNullLanguageModelUsage();
          self._finishReason.resolve(finishReason);
          self._rawFinishReason.resolve(recordedRawFinishReason);
          self._totalUsage.resolve(totalUsage);
          self._steps.resolve(recordedSteps);
          const finalStep = recordedSteps[recordedSteps.length - 1];
          const content = recordedSteps.flatMap((step) => step.content);
          const files = recordedSteps.flatMap((step) => step.files);
          const sources = recordedSteps.flatMap((step) => step.sources);
          const toolCalls = recordedSteps.flatMap((step) => step.toolCalls);
          const staticToolCalls = recordedSteps.flatMap(
            (step) => step.staticToolCalls
          );
          const dynamicToolCalls = recordedSteps.flatMap(
            (step) => step.dynamicToolCalls
          );
          const toolResults = recordedSteps.flatMap((step) => step.toolResults);
          const staticToolResults = recordedSteps.flatMap(
            (step) => step.staticToolResults
          );
          const dynamicToolResults = recordedSteps.flatMap(
            (step) => step.dynamicToolResults
          );
          const warnings = recordedSteps.flatMap((step) => {
            var _a22;
            return (_a22 = step.warnings) != null ? _a22 : [];
          });
          await notify({
            event: {
              callId,
              toolsContext: finalStep.toolsContext,
              stepNumber: finalStep.stepNumber,
              model: finalStep.model,
              runtimeContext: finalStep.runtimeContext,
              finishReason: finalStep.finishReason,
              rawFinishReason: finalStep.rawFinishReason,
              usage: totalUsage,
              totalUsage,
              content,
              text: finalStep.text,
              reasoning: finalStep.reasoning,
              reasoningText: finalStep.reasoningText,
              files,
              sources,
              toolCalls,
              staticToolCalls,
              dynamicToolCalls,
              toolResults,
              staticToolResults,
              dynamicToolResults,
              responseMessages: [
                ...initialResponseMessages,
                ...recordedSteps.flatMap((step) => step.response.messages)
              ],
              warnings,
              request: finalStep.request,
              response: finalStep.response,
              providerMetadata: finalStep.providerMetadata,
              steps: recordedSteps,
              finalStep
            },
            callbacks: [onEnd, telemetryDispatcher.onEnd]
          });
        } catch (error) {
          controller.error(error);
        }
      }
    });
    const stitchableStream = createStitchableStream();
    this.addStream = stitchableStream.addStream;
    this.closeStream = stitchableStream.close;
    const reader = stitchableStream.stream.getReader();
    let stream = new ReadableStream({
      async start(controller) {
        controller.enqueue({ type: "start" });
      },
      async pull(controller) {
        async function abort() {
          await notify({
            event: {
              callId,
              steps: recordedSteps,
              ...(abortSignal == null ? void 0 : abortSignal.reason) !== void 0 ? { reason: abortSignal.reason } : {}
            },
            callbacks: [onAbort, telemetryDispatcher.onAbort]
          });
          controller.enqueue({
            type: "abort",
            // The `reason` is usually of type DOMException, but it can also be of any type,
            // so we use getErrorMessage for serialization because it is already designed to accept values of the unknown type.
            // See: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/reason
            ...(abortSignal == null ? void 0 : abortSignal.reason) !== void 0 ? { reason: getErrorMessage6(abortSignal.reason) } : {}
          });
          controller.close();
        }
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          if (abortSignal == null ? void 0 : abortSignal.aborted) {
            await abort();
            return;
          }
          controller.enqueue(value);
        } catch (error) {
          if (isAbortError(error) && (abortSignal == null ? void 0 : abortSignal.aborted)) {
            await abort();
          } else {
            controller.error(error);
          }
        }
      },
      cancel(reason) {
        return stitchableStream.stream.cancel(reason);
      }
    });
    let isRunning = true;
    stream = stream.pipeThrough(
      new TransformStream({
        async transform(chunk, controller) {
          if (isRunning) {
            controller.enqueue(chunk);
          }
        }
      })
    );
    for (const transform of transforms) {
      stream = stream.pipeThrough(
        transform({
          tools,
          stopStream() {
            stitchableStream.terminate();
            isRunning = false;
          }
        })
      );
    }
    this.baseStream = stream.pipeThrough(createOutputTransformStream(output != null ? output : text())).pipeThrough(eventProcessor);
    const { maxRetries } = prepareRetries({
      maxRetries: maxRetriesArg,
      abortSignal
    });
    const callSettings = prepareLanguageModelCallOptions(settings);
    const self = this;
    const callId = generateCallId();
    (async () => {
      var _a22;
      const initialPrompt = await standardizePrompt({
        instructions,
        system,
        prompt,
        messages,
        allowSystemInMessages
      });
      const startEvent = {
        callId,
        operationId: "ai.streamText",
        provider: model.provider,
        modelId: model.modelId,
        instructions: initialPrompt.instructions,
        messages: initialPrompt.messages,
        tools,
        toolChoice,
        activeTools,
        toolOrder,
        maxOutputTokens: callSettings.maxOutputTokens,
        temperature: callSettings.temperature,
        topP: callSettings.topP,
        topK: callSettings.topK,
        presencePenalty: callSettings.presencePenalty,
        frequencyPenalty: callSettings.frequencyPenalty,
        stopSequences: callSettings.stopSequences,
        seed: callSettings.seed,
        reasoning: callSettings.reasoning,
        maxRetries,
        timeout,
        headers,
        providerOptions,
        output,
        runtimeContext,
        toolsContext
      };
      const streamTextTracingChannelContext = (_a22 = telemetryDispatcher.startTracingChannelContext) == null ? void 0 : _a22.call(telemetryDispatcher, {
        type: "streamText",
        event: startEvent,
        completion: self._totalUsage.promise.then(() => void 0)
      });
      const runInStreamTextTracingChannelContext = (execute) => {
        var _a23;
        return (_a23 = streamTextTracingChannelContext == null ? void 0 : streamTextTracingChannelContext.run(execute)) != null ? _a23 : execute();
      };
      const runInTracingChannelSpanInStreamText = telemetryDispatcher.runInTracingChannelSpan == null ? void 0 : (options) => runInStreamTextTracingChannelContext(
        () => telemetryDispatcher.runInTracingChannelSpan(options)
      );
      await notify({
        event: startEvent,
        callbacks: [onStart, telemetryDispatcher.onStart]
      });
      const initialMessages = initialPrompt.messages;
      let instructionsForNextStep = initialPrompt.instructions;
      const { approvedToolApprovals, deniedToolApprovals } = collectToolApprovals({ messages: initialMessages });
      if (deniedToolApprovals.length > 0 || approvedToolApprovals.length > 0) {
        const {
          approvedToolApprovals: localApprovedToolApprovals,
          deniedToolApprovals: revalidationDeniedToolApprovals
        } = await validateApprovedToolApprovals({
          approvedToolApprovals: approvedToolApprovals.filter(
            (toolApproval2) => !toolApproval2.toolCall.providerExecuted
          ),
          tools,
          toolApproval,
          messages: initialMessages,
          toolsContext,
          runtimeContext,
          toolApprovalSecret: experimental_toolApprovalSecret
        });
        const localDeniedToolApprovals = [
          ...deniedToolApprovals.filter(
            (toolApproval2) => !toolApproval2.toolCall.providerExecuted
          ),
          ...revalidationDeniedToolApprovals
        ];
        const localDeniedToolApprovalsWithoutResults = localDeniedToolApprovals.filter(
          (toolApproval2) => toolApproval2.existingToolResult == null
        );
        const deniedProviderExecutedToolApprovals = deniedToolApprovals.filter(
          (toolApproval2) => toolApproval2.toolCall.providerExecuted
        );
        let toolExecutionStepStreamController;
        const toolExecutionStepStream = new ReadableStream({
          start(controller) {
            toolExecutionStepStreamController = controller;
          }
        });
        self.addStream(toolExecutionStepStream);
        try {
          for (const toolApproval2 of [
            ...localDeniedToolApprovals,
            ...deniedProviderExecutedToolApprovals
          ]) {
            toolExecutionStepStreamController == null ? void 0 : toolExecutionStepStreamController.enqueue({
              type: "tool-output-denied",
              toolCallId: toolApproval2.toolCall.toolCallId,
              toolName: toolApproval2.toolCall.toolName
            });
          }
          const toolOutputs = [];
          await Promise.all(
            localApprovedToolApprovals.map(async (toolApproval2) => {
              const result = await executeToolCall({
                toolCall: toolApproval2.toolCall,
                tools,
                callId,
                messages: initialMessages,
                abortSignal,
                timeout,
                experimental_sandbox: sandbox,
                toolsContext,
                onToolExecutionStart: filterNullable2(
                  onToolExecutionStart,
                  telemetryDispatcher.onToolExecutionStart
                ),
                onToolExecutionEnd: filterNullable2(
                  onToolExecutionEnd,
                  telemetryDispatcher.onToolExecutionEnd
                ),
                executeToolInTelemetryContext: telemetryDispatcher.executeTool,
                runInTracingChannelSpan: runInTracingChannelSpanInStreamText,
                onPreliminaryToolResult: (result2) => {
                  toolExecutionStepStreamController == null ? void 0 : toolExecutionStepStreamController.enqueue(result2);
                }
              });
              if (result != null) {
                toolExecutionStepStreamController == null ? void 0 : toolExecutionStepStreamController.enqueue(result.output);
                toolOutputs.push(result.output);
              }
            })
          );
          if (toolOutputs.length > 0 || localDeniedToolApprovalsWithoutResults.length > 0) {
            const localToolContent = [];
            for (const output2 of toolOutputs) {
              localToolContent.push({
                type: "tool-result",
                toolCallId: output2.toolCallId,
                toolName: output2.toolName,
                output: await createToolModelOutput({
                  toolCallId: output2.toolCallId,
                  input: output2.input,
                  tool: getOwn(tools, output2.toolName),
                  output: output2.type === "tool-result" ? output2.output : output2.error,
                  errorMode: output2.type === "tool-error" ? "text" : "none"
                })
              });
            }
            for (const toolApproval2 of localDeniedToolApprovalsWithoutResults) {
              localToolContent.push({
                type: "tool-result",
                toolCallId: toolApproval2.toolCall.toolCallId,
                toolName: toolApproval2.toolCall.toolName,
                output: {
                  type: "execution-denied",
                  reason: toolApproval2.approvalResponse.reason
                }
              });
            }
            initialResponseMessages.push({
              role: "tool",
              content: localToolContent
            });
          }
        } finally {
          toolExecutionStepStreamController == null ? void 0 : toolExecutionStepStreamController.close();
        }
      }
      self._initialResponseMessages.resolve(initialResponseMessages);
      async function streamStep({
        currentStep,
        usage
      }) {
        var _a23, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
        const stepTimeoutId = setAbortTimeout({
          abortController: stepAbortController,
          label: "Step",
          timeoutMs: stepTimeoutMs
        });
        let firstChunkTimeoutId = void 0;
        function startFirstChunkTimeout() {
          if (abortSignal == null ? void 0 : abortSignal.aborted) {
            return;
          }
          firstChunkTimeoutId = setAbortTimeout({
            abortController: firstChunkAbortController,
            label: "First chunk",
            timeoutMs: firstChunkTimeoutMs
          });
        }
        function clearFirstChunkTimeout() {
          if (firstChunkTimeoutId != null) {
            clearTimeout(firstChunkTimeoutId);
            firstChunkTimeoutId = void 0;
          }
        }
        let chunkTimeoutId = void 0;
        function resetChunkTimeout() {
          if (chunkTimeoutId != null) {
            clearTimeout(chunkTimeoutId);
          }
          chunkTimeoutId = setAbortTimeout({
            abortController: chunkAbortController,
            label: "Chunk",
            timeoutMs: chunkTimeoutMs
          });
        }
        function clearChunkTimeout() {
          if (chunkTimeoutId != null) {
            clearTimeout(chunkTimeoutId);
            chunkTimeoutId = void 0;
          }
        }
        function clearStepTimeout() {
          if (stepTimeoutId != null) {
            clearTimeout(stepTimeoutId);
          }
        }
        function clearStepTimeouts() {
          clearStepTimeout();
          clearFirstChunkTimeout();
          clearChunkTimeout();
        }
        function cleanupStepTimeouts() {
          abortSignal == null ? void 0 : abortSignal.removeEventListener("abort", cleanupStepTimeouts);
          clearStepTimeouts();
        }
        abortSignal == null ? void 0 : abortSignal.addEventListener("abort", cleanupStepTimeouts, {
          once: true
        });
        try {
          stepFinish = new DelayedPromise();
          const stepTracingChannelContext = (_a23 = telemetryDispatcher.startTracingChannelContext) == null ? void 0 : _a23.call(telemetryDispatcher, {
            type: "step",
            event: { callId, stepNumber: currentStep },
            completion: stepFinish.promise
          });
          const runInStepTracingChannelContext = (execute) => {
            var _a24;
            return (_a24 = stepTracingChannelContext == null ? void 0 : stepTracingChannelContext.run(execute)) != null ? _a24 : execute();
          };
          const responseMessagesFromPreviousSteps = recordedSteps.flatMap(
            (step) => step.response.messages
          );
          const accumulatedResponseMessages = [
            ...initialResponseMessages,
            ...responseMessagesFromPreviousSteps
          ];
          const stepInputMessages = stepMessagesForNextStep != null ? stepMessagesForNextStep : [
            ...initialMessages,
            ...initialResponseMessages
          ];
          const prepareStepResult = await (prepareStep == null ? void 0 : prepareStep({
            model,
            steps: recordedSteps,
            stepNumber: recordedSteps.length,
            instructions: instructionsForNextStep,
            initialInstructions: initialPrompt.instructions,
            messages: stepInputMessages,
            initialMessages,
            responseMessages: accumulatedResponseMessages,
            toolsContext,
            runtimeContext,
            experimental_sandbox: sandbox
          }));
          const stepSandbox = (_b = prepareStepResult == null ? void 0 : prepareStepResult.experimental_sandbox) != null ? _b : sandbox;
          runtimeContext = (_c = prepareStepResult == null ? void 0 : prepareStepResult.runtimeContext) != null ? _c : runtimeContext;
          toolsContext = (_d = prepareStepResult == null ? void 0 : prepareStepResult.toolsContext) != null ? _d : toolsContext;
          const stepModel = resolveLanguageModel(
            (_e = prepareStepResult == null ? void 0 : prepareStepResult.model) != null ? _e : model
          );
          const stepActiveTools = filterActiveTools({
            tools,
            activeTools: (_f = prepareStepResult == null ? void 0 : prepareStepResult.activeTools) != null ? _f : activeTools
          });
          const stepToolOrder = (_g = prepareStepResult == null ? void 0 : prepareStepResult.toolOrder) != null ? _g : toolOrder;
          const stepTools = await prepareTools({
            tools: stepActiveTools,
            toolOrder: stepToolOrder,
            // active tools context is a subset of the tools context, so we can cast to the unknown type
            toolsContext,
            experimental_sandbox: stepSandbox
          });
          const stepToolChoice = prepareToolChoice({
            toolChoice: (_h = prepareStepResult == null ? void 0 : prepareStepResult.toolChoice) != null ? _h : toolChoice
          });
          const stepMessages = (_i = prepareStepResult == null ? void 0 : prepareStepResult.messages) != null ? _i : stepInputMessages;
          currentStepMessages = stepMessages;
          const stepInstructions = (_k = (_j = prepareStepResult == null ? void 0 : prepareStepResult.instructions) != null ? _j : prepareStepResult == null ? void 0 : prepareStepResult.system) != null ? _k : instructionsForNextStep;
          instructionsForNextStep = stepInstructions;
          const stepProviderOptions = mergeObjects(
            providerOptions,
            prepareStepResult == null ? void 0 : prepareStepResult.providerOptions
          );
          const stepStartTimestampMs = now2();
          const { retry } = prepareRetries({ maxRetries, abortSignal });
          const {
            stream: languageModelStream,
            request,
            response
          } = await runInStepTracingChannelContext(
            () => retry(
              async () => {
                var _a24, _b2;
                return streamLanguageModelCall({
                  model: (_a24 = prepareStepResult == null ? void 0 : prepareStepResult.model) != null ? _a24 : model,
                  tools: stepActiveTools,
                  toolOrder: stepToolOrder,
                  toolChoice: (_b2 = prepareStepResult == null ? void 0 : prepareStepResult.toolChoice) != null ? _b2 : toolChoice,
                  instructions: stepInstructions,
                  messages: stepMessages,
                  allowSystemInMessages,
                  repairToolCall,
                  refineToolInput,
                  abortSignal,
                  headers,
                  includeRawChunks: include.rawChunks,
                  providerOptions: stepProviderOptions,
                  download: download2,
                  output,
                  callId,
                  executeLanguageModelCallInTelemetryContext: telemetryDispatcher.executeLanguageModelCall,
                  toolsContext,
                  experimental_sandbox: stepSandbox,
                  onLanguageModelCallStart: filterNullable2(
                    onLanguageModelCallStart,
                    telemetryDispatcher.onLanguageModelCallStart
                  ),
                  onLanguageModelCallEnd: filterNullable2(
                    onLanguageModelCallEnd,
                    telemetryDispatcher.onLanguageModelCallEnd
                  ),
                  onStart: async ({ promptMessages }) => {
                    var _a25, _b3;
                    await notify({
                      event: {
                        callId,
                        provider: stepModel.provider,
                        modelId: stepModel.modelId,
                        stepNumber: recordedSteps.length,
                        instructions: stepInstructions,
                        messages: stepMessages,
                        tools,
                        toolChoice: (_a25 = prepareStepResult == null ? void 0 : prepareStepResult.toolChoice) != null ? _a25 : toolChoice,
                        activeTools: (_b3 = prepareStepResult == null ? void 0 : prepareStepResult.activeTools) != null ? _b3 : activeTools,
                        toolOrder: stepToolOrder,
                        steps: [...recordedSteps],
                        providerOptions: stepProviderOptions,
                        runtimeContext,
                        toolsContext,
                        output,
                        promptMessages,
                        stepTools,
                        stepToolChoice
                      },
                      callbacks: [onStepStart, telemetryDispatcher.onStepStart]
                    });
                  },
                  _internal: {
                    now: now2
                  },
                  ...callSettings
                });
              }
            )
          );
          startFirstChunkTimeout();
          const streamAfterToolCallbackInvocation = invokeToolCallbacksFromStream({
            stream: languageModelStream,
            tools,
            stepInputMessages: stepMessages,
            abortSignal,
            runtimeContext
          });
          const runInTracingChannelSpanInStep = telemetryDispatcher.runInTracingChannelSpan == null ? void 0 : (options) => runInStepTracingChannelContext(
            () => telemetryDispatcher.runInTracingChannelSpan(options)
          );
          const streamWithToolResults = executeToolsFromStream({
            stream: streamAfterToolCallbackInvocation,
            tools,
            callId,
            messages: stepMessages,
            abortSignal,
            timeout,
            experimental_sandbox: stepSandbox,
            toolsContext,
            toolApproval,
            runtimeContext,
            toolApprovalSecret: experimental_toolApprovalSecret,
            generateId: generateId2,
            // the callbacks need to be passed down and handled by executeToolCall
            // to guarantee that the onToolExecutionStart callback is invoked before the tool execute function
            onToolExecutionStart: filterNullable2(
              onToolExecutionStart,
              telemetryDispatcher.onToolExecutionStart
            ),
            onToolExecutionEnd: filterNullable2(
              onToolExecutionEnd,
              telemetryDispatcher.onToolExecutionEnd
            ),
            executeToolInTelemetryContext: telemetryDispatcher.executeTool,
            runInTracingChannelSpan: runInTracingChannelSpanInStep
          });
          const stepRequest = {
            ...request,
            body: include.requestBody ? request == null ? void 0 : request.body : void 0,
            messages: include.requestMessages ? cloneModelMessages(stepMessages) : void 0
          };
          recordedRequestMessages = (_l = stepRequest.messages) != null ? _l : [];
          const stepToolCalls = [];
          const stepToolOutputs = [];
          const stepToolApprovalResponses = [];
          let warnings;
          let stepFinishReason = "other";
          let stepRawFinishReason = void 0;
          let hasReceivedTerminalChunk = false;
          let hasReceivedOutputChunk = false;
          let stepUsage = createNullLanguageModelUsage();
          let stepProviderMetadata;
          let stepFirstChunk = true;
          let modelCallPerformance = {
            responseTimeMs: 0,
            effectiveOutputTokensPerSecond: 0,
            outputTokensPerSecond: void 0,
            inputTokensPerSecond: void 0,
            effectiveTotalTokensPerSecond: 0,
            timeToFirstOutputMs: void 0,
            timeBetweenOutputChunksMs: void 0
          };
          const toolExecutionMs = {};
          let stepResponse = {
            id: generateId2(),
            timestamp: /* @__PURE__ */ new Date(),
            modelId: model.modelId
          };
          self.addStream(
            streamWithToolResults.pipeThrough(
              new TransformStream({
                async transform(chunk, controller) {
                  var _a24, _b2, _c2;
                  if (chunk.type === "model-call-start") {
                    warnings = chunk.warnings;
                    return;
                  }
                  if (stepFirstChunk) {
                    stepFirstChunk = false;
                    controller.enqueue({
                      type: "start-step",
                      request: stepRequest,
                      warnings: warnings != null ? warnings : []
                    });
                  }
                  const chunkType = chunk.type;
                  if (isOutputChunk2(chunk)) {
                    if (!hasReceivedOutputChunk) {
                      clearFirstChunkTimeout();
                    }
                    hasReceivedOutputChunk = true;
                    resetChunkTimeout();
                  }
                  switch (chunkType) {
                    case "file":
                    case "custom":
                    case "source":
                    case "text-start":
                    case "text-end":
                    case "reasoning-start":
                    case "reasoning-end":
                    case "reasoning-delta":
                    case "reasoning-file":
                    case "tool-input-start":
                    case "tool-input-end":
                    case "tool-input-delta":
                    case "tool-approval-request": {
                      controller.enqueue(chunk);
                      break;
                    }
                    case "text-delta": {
                      if (chunk.text.length > 0) {
                        controller.enqueue(chunk);
                      }
                      break;
                    }
                    case "tool-call": {
                      controller.enqueue(chunk);
                      stepToolCalls.push(chunk);
                      break;
                    }
                    case "tool-approval-response": {
                      controller.enqueue(chunk);
                      stepToolApprovalResponses.push(chunk);
                      break;
                    }
                    case "tool-result": {
                      controller.enqueue(chunk);
                      if (!chunk.preliminary) {
                        stepToolOutputs.push(chunk);
                      }
                      break;
                    }
                    case "tool-error": {
                      controller.enqueue(chunk);
                      stepToolOutputs.push(chunk);
                      break;
                    }
                    case "tool-execution-end": {
                      toolExecutionMs[chunk.toolCallId] = chunk.toolExecutionMs;
                      break;
                    }
                    case "model-call-response-metadata": {
                      stepResponse = {
                        id: (_a24 = chunk.id) != null ? _a24 : stepResponse.id,
                        timestamp: (_b2 = chunk.timestamp) != null ? _b2 : stepResponse.timestamp,
                        modelId: (_c2 = chunk.modelId) != null ? _c2 : stepResponse.modelId
                      };
                      break;
                    }
                    case "model-call-end": {
                      hasReceivedTerminalChunk = true;
                      stepUsage = chunk.usage;
                      stepFinishReason = chunk.finishReason;
                      stepRawFinishReason = chunk.rawFinishReason;
                      stepProviderMetadata = chunk.providerMetadata;
                      modelCallPerformance = chunk.performance;
                      break;
                    }
                    case "error": {
                      hasReceivedTerminalChunk = true;
                      controller.enqueue(chunk);
                      stepFinishReason = "error";
                      break;
                    }
                    case "raw": {
                      if (include.rawChunks) {
                        controller.enqueue(chunk);
                      }
                      break;
                    }
                    default: {
                      const exhaustiveCheck = chunkType;
                      throw new Error(`Unknown chunk type: ${exhaustiveCheck}`);
                    }
                  }
                },
                // invoke onEnd callback and resolve toolResults promise when the stream is about to close:
                async flush(controller) {
                  if (!hasReceivedTerminalChunk && !hasReceivedOutputChunk) {
                    controller.enqueue({
                      type: "error",
                      error: new NoOutputGeneratedError({
                        message: "No output generated. The model stream ended without a finish chunk."
                      })
                    });
                    cleanupStepTimeouts();
                    self.closeStream();
                    return;
                  }
                  const stepTimeMs = now2() - stepStartTimestampMs;
                  const finishStepPart = {
                    type: "finish-step",
                    finishReason: stepFinishReason,
                    rawFinishReason: stepRawFinishReason,
                    usage: stepUsage,
                    performance: {
                      stepTimeMs,
                      toolExecutionMs,
                      ...modelCallPerformance
                    },
                    providerMetadata: stepProviderMetadata,
                    response: {
                      ...stepResponse,
                      headers: response == null ? void 0 : response.headers
                    }
                  };
                  controller.enqueue(finishStepPart);
                  const combinedUsage = addLanguageModelUsage(usage, stepUsage);
                  await stepFinish.promise;
                  const clientToolCalls = stepToolCalls.filter(
                    (toolCall) => toolCall.providerExecuted !== true
                  );
                  const clientToolOutputs = stepToolOutputs.filter(
                    (toolOutput) => toolOutput.providerExecuted !== true
                  );
                  const deniedToolApprovalResponses = stepToolApprovalResponses.filter(
                    (toolApprovalResponse) => toolApprovalResponse.approved === false
                  );
                  for (const toolCall of stepToolCalls) {
                    if (toolCall.providerExecuted !== true)
                      continue;
                    const tool2 = getOwn(tools, toolCall.toolName);
                    if ((tool2 == null ? void 0 : tool2.type) === "provider" && tool2.supportsDeferredResults) {
                      const hasResultInStep = stepToolOutputs.some(
                        (output2) => (output2.type === "tool-result" || output2.type === "tool-error") && output2.toolCallId === toolCall.toolCallId
                      );
                      if (!hasResultInStep) {
                        pendingDeferredToolCalls.set(toolCall.toolCallId, {
                          toolName: toolCall.toolName
                        });
                      }
                    }
                  }
                  for (const output2 of stepToolOutputs) {
                    if (output2.type === "tool-result" || output2.type === "tool-error") {
                      pendingDeferredToolCalls.delete(output2.toolCallId);
                    }
                  }
                  cleanupStepTimeouts();
                  if (
                    // Continue if:
                    // 1. There are client tool calls that have all been executed or denied, OR
                    // 2. There are pending deferred results from provider-executed tools, OR
                    (clientToolCalls.length > 0 && clientToolCalls.length === clientToolOutputs.length + deniedToolApprovalResponses.length || pendingDeferredToolCalls.size > 0) && // continue until a stop condition is met:
                    !await isStopConditionMet({
                      stopConditions,
                      steps: recordedSteps
                    })
                  ) {
                    try {
                      await runInStreamTextTracingChannelContext(
                        () => streamStep({
                          currentStep: currentStep + 1,
                          usage: combinedUsage
                        })
                      );
                    } catch (error) {
                      controller.enqueue({
                        type: "error",
                        error
                      });
                      self.closeStream();
                    }
                  } else {
                    controller.enqueue({
                      type: "finish",
                      finishReason: stepFinishReason,
                      rawFinishReason: stepRawFinishReason,
                      totalUsage: combinedUsage
                    });
                    self.closeStream();
                  }
                }
              })
            ),
            {
              onError: cleanupStepTimeouts,
              onCancel: cleanupStepTimeouts
            }
          );
        } catch (error) {
          cleanupStepTimeouts();
          throw error;
        }
      }
      await runInStreamTextTracingChannelContext(
        () => (
          // add the initial stream to the stitchable stream
          streamStep({
            currentStep: 0,
            usage: createNullLanguageModelUsage()
          })
        )
      );
    })().catch(async (error) => {
      var _a22;
      await ((_a22 = telemetryDispatcher.onError) == null ? void 0 : _a22.call(telemetryDispatcher, { callId, error }));
      self._initialResponseMessages.reject(error);
      markPromiseAsHandled(self._initialResponseMessages.promise);
      self.addStream(
        new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "error", error });
            controller.close();
          }
        })
      );
      self.closeStream();
    });
  }
  get steps() {
    this.consumeStream();
    return this._steps.promise;
  }
  get finalStep() {
    return this.steps.then((steps) => steps.at(-1));
  }
  get content() {
    return this.steps.then((steps) => steps.flatMap((step) => step.content));
  }
  get warnings() {
    return this.steps.then((steps) => steps.flatMap((step) => {
      var _a22;
      return (_a22 = step.warnings) != null ? _a22 : [];
    }));
  }
  get providerMetadata() {
    return this.finalStep.then((step) => step.providerMetadata);
  }
  get text() {
    return this.finalStep.then((step) => step.text);
  }
  get reasoningText() {
    return this.finalStep.then((step) => step.reasoningText);
  }
  get reasoning() {
    return this.finalStep.then(
      (step) => convertToReasoningOutputs(step.reasoning)
    );
  }
  get sources() {
    return this.steps.then((steps) => steps.flatMap((step) => step.sources));
  }
  get files() {
    return this.steps.then((steps) => steps.flatMap((step) => step.files));
  }
  get toolCalls() {
    return this.steps.then((steps) => steps.flatMap((step) => step.toolCalls));
  }
  get staticToolCalls() {
    return this.steps.then(
      (steps) => steps.flatMap((step) => step.staticToolCalls)
    );
  }
  get dynamicToolCalls() {
    return this.steps.then(
      (steps) => steps.flatMap((step) => step.dynamicToolCalls)
    );
  }
  get toolResults() {
    return this.steps.then((steps) => steps.flatMap((step) => step.toolResults));
  }
  get staticToolResults() {
    return this.steps.then(
      (steps) => steps.flatMap((step) => step.staticToolResults)
    );
  }
  get dynamicToolResults() {
    return this.steps.then(
      (steps) => steps.flatMap((step) => step.dynamicToolResults)
    );
  }
  get usage() {
    return this.totalUsage;
  }
  get request() {
    return this.finalStep.then((step) => step.request);
  }
  get response() {
    return this.finalStep.then((step) => step.response);
  }
  get responseMessages() {
    return Promise.all([
      this._initialResponseMessages.promise,
      this.steps
    ]).then(([initialResponseMessages, steps]) => [
      ...initialResponseMessages,
      ...steps.flatMap((step) => step.response.messages)
    ]);
  }
  get totalUsage() {
    this.consumeStream();
    return this._totalUsage.promise;
  }
  get finishReason() {
    this.consumeStream();
    return this._finishReason.promise;
  }
  get rawFinishReason() {
    this.consumeStream();
    return this._rawFinishReason.promise;
  }
  /**
   * Split out a new stream from the original stream.
   * The original stream is replaced to allow for further splitting,
   * since we do not know how many times the stream will be split.
   *
   * Note: this leads to buffering the stream content on the server.
   * However, the LLM results are expected to be small enough to not cause issues.
   */
  teeStream() {
    const [stream1, stream2] = this.baseStream.tee();
    this.baseStream = stream2;
    return stream1;
  }
  get textStream() {
    return createAsyncIterableStream(toTextStream({ stream: this.stream }));
  }
  get stream() {
    return createAsyncIterableStream(
      this.teeStream().pipeThrough(
        new TransformStream({
          transform({ part }, controller) {
            controller.enqueue(part);
          }
        })
      )
    );
  }
  get fullStream() {
    return this.stream;
  }
  rejectResultPromises(error) {
    this.rejectResultPromise({ delayedPromise: this._finishReason, error });
    this.rejectResultPromise({ delayedPromise: this._rawFinishReason, error });
    this.rejectResultPromise({ delayedPromise: this._totalUsage, error });
    this.rejectResultPromise({ delayedPromise: this._steps, error });
    this.rejectResultPromise({
      delayedPromise: this._initialResponseMessages,
      error
    });
  }
  rejectResultPromise({
    delayedPromise,
    error
  }) {
    if (delayedPromise.isPending()) {
      delayedPromise.reject(error);
      markPromiseAsHandled(delayedPromise.promise);
    }
  }
  async consumeStream(options) {
    var _a22;
    try {
      await consumeStream({
        stream: this.stream,
        onError: (error) => {
          var _a23;
          this.rejectResultPromises(error);
          (_a23 = options == null ? void 0 : options.onError) == null ? void 0 : _a23.call(options, error);
        }
      });
    } catch (error) {
      this.rejectResultPromises(error);
      (_a22 = options == null ? void 0 : options.onError) == null ? void 0 : _a22.call(options, error);
    }
  }
  get experimental_partialOutputStream() {
    return this.partialOutputStream;
  }
  get partialOutputStream() {
    return createAsyncIterableStream(
      this.teeStream().pipeThrough(
        new TransformStream({
          transform({ partialOutput }, controller) {
            if (partialOutput != null) {
              controller.enqueue(partialOutput);
            }
          }
        })
      )
    );
  }
  get elementStream() {
    var _a22, _b, _c;
    const transform = (_a22 = this.outputSpecification) == null ? void 0 : _a22.createElementStreamTransform();
    if (transform == null) {
      throw new UnsupportedFunctionalityError2({
        functionality: `element streams in ${(_c = (_b = this.outputSpecification) == null ? void 0 : _b.name) != null ? _c : "text"} mode`
      });
    }
    return createAsyncIterableStream(this.teeStream().pipeThrough(transform));
  }
  get output() {
    return this.finalStep.then((step) => {
      var _a22;
      const output = (_a22 = this.outputSpecification) != null ? _a22 : text();
      return output.parseCompleteOutput(
        { text: step.text },
        {
          response: step.response,
          usage: step.usage,
          finishReason: step.finishReason
        }
      );
    });
  }
  toUIMessageStream({
    originalMessages,
    generateMessageId,
    onEnd,
    onFinish,
    messageMetadata,
    sendReasoning,
    sendSources,
    sendStart,
    sendFinish,
    onError
  } = {}) {
    return createAsyncIterableStream(
      toUIMessageStream({
        stream: this.stream,
        tools: this.tools,
        originalMessages,
        generateMessageId,
        onEnd: onEnd != null ? onEnd : onFinish,
        messageMetadata,
        sendReasoning,
        sendSources,
        sendStart,
        sendFinish,
        onError
      })
    );
  }
  pipeUIMessageStreamToResponse(response, {
    originalMessages,
    generateMessageId,
    onEnd,
    onFinish,
    messageMetadata,
    sendReasoning,
    sendSources,
    sendFinish,
    sendStart,
    onError,
    ...init
  } = {}) {
    return pipeUIMessageStreamToResponse({
      response,
      stream: this.toUIMessageStream({
        originalMessages,
        generateMessageId,
        onEnd: onEnd != null ? onEnd : onFinish,
        messageMetadata,
        sendReasoning,
        sendSources,
        sendFinish,
        sendStart,
        onError
      }),
      ...init
    });
  }
  pipeTextStreamToResponse(response, init) {
    return pipeTextStreamToResponse({
      response,
      stream: this.textStream,
      ...init
    });
  }
  toUIMessageStreamResponse({
    originalMessages,
    generateMessageId,
    onEnd,
    onFinish,
    messageMetadata,
    sendReasoning,
    sendSources,
    sendFinish,
    sendStart,
    onError,
    ...init
  } = {}) {
    return createUIMessageStreamResponse({
      stream: this.toUIMessageStream({
        originalMessages,
        generateMessageId,
        onEnd: onEnd != null ? onEnd : onFinish,
        messageMetadata,
        sendReasoning,
        sendSources,
        sendFinish,
        sendStart,
        onError
      }),
      ...init
    });
  }
  toTextStreamResponse(init) {
    return createTextStreamResponse({
      stream: this.textStream,
      ...init
    });
  }
};

// src/agent/tool-loop-agent.ts
var ToolLoopAgent = class {
  constructor(settings) {
    this.version = "agent-v1";
    const { onFinish, onEnd = onFinish } = settings;
    this.settings = { ...settings, onEnd };
  }
  /**
   * The id of the agent.
   */
  get id() {
    return this.settings.id;
  }
  /**
   * The tools that the agent can use.
   */
  get tools() {
    return this.settings.tools;
  }
  async prepareCall(options) {
    var _a22, _b, _c, _d;
    if (this.settings.callOptionsSchema != null && options.options !== void 0) {
      const validatedOptions = await validateTypes3({
        value: options.options,
        schema: this.settings.callOptionsSchema,
        context: { field: "options" }
      });
      options = { ...options, options: validatedOptions };
    }
    const {
      onStart: _settingsStableOnStart,
      experimental_onStart: _settingsExperimentalOnStart,
      onStepStart: _settingsStableOnStepStart,
      experimental_onStepStart: _settingsExperimentalOnStepStart,
      onToolExecutionStart: _settingsOnToolExecutionStart,
      onToolExecutionEnd: _settingsOnToolExecutionEnd,
      onStepEnd: _settingsOnStepEnd,
      onStepFinish: _settingsOnStepFinish,
      onFinish: _settingsOnFinish,
      onEnd: _settingsOnEnd,
      ...settingsWithoutCallbacks
    } = this.settings;
    const baseCallArgs = {
      ...settingsWithoutCallbacks,
      stopWhen: (_a22 = this.settings.stopWhen) != null ? _a22 : isStepCount(20),
      ...options
    };
    const preparedCallArgs = (_d = await ((_c = (_b = this.settings).prepareCall) == null ? void 0 : _c.call(
      _b,
      baseCallArgs
    ))) != null ? _d : baseCallArgs;
    const {
      instructions,
      allowSystemInMessages,
      messages,
      prompt,
      runtimeContext,
      ...callArgs
    } = preparedCallArgs;
    const promptArgs = {
      instructions,
      allowSystemInMessages,
      messages,
      prompt
    };
    if (runtimeContext === void 0) {
      return {
        ...callArgs,
        ...promptArgs
      };
    }
    return {
      ...callArgs,
      runtimeContext,
      ...promptArgs
    };
  }
  /**
   * Tags outgoing requests so usage can be attributed to ToolLoopAgent. Chains
   * with the `ai/<version>` and `ai-sdk/<provider>/<version>` suffixes added
   * downstream by generateText/streamText and the provider.
   */
  agentHeaders(preparedCall) {
    var _a22;
    return withUserAgentSuffix3(
      (_a22 = preparedCall.headers) != null ? _a22 : {},
      "ai-sdk-agent/tool-loop"
    );
  }
  /**
   * Generates an output from the agent (non-streaming).
   */
  async generate({
    abortSignal,
    timeout,
    experimental_sandbox: sandbox,
    onStart,
    experimental_onStart,
    onStepStart,
    experimental_onStepStart,
    onToolExecutionStart,
    onToolExecutionEnd,
    onStepEnd,
    onStepFinish,
    onFinish,
    onEnd = onFinish,
    ...options
  }) {
    var _a22, _b, _c;
    const generate = generateText;
    const preparedCall = await this.prepareCall({
      ...options,
      experimental_sandbox: sandbox
    });
    const callbackArgs = {
      abortSignal,
      timeout,
      experimental_sandbox: sandbox,
      onStart: mergeCallbacks(
        (_a22 = this.settings.onStart) != null ? _a22 : this.settings.experimental_onStart,
        onStart != null ? onStart : experimental_onStart
      ),
      onStepStart: mergeCallbacks(
        (_b = this.settings.onStepStart) != null ? _b : this.settings.experimental_onStepStart,
        onStepStart != null ? onStepStart : experimental_onStepStart
      ),
      onToolExecutionStart: mergeCallbacks(
        this.settings.onToolExecutionStart,
        onToolExecutionStart
      ),
      onToolExecutionEnd: mergeCallbacks(
        this.settings.onToolExecutionEnd,
        onToolExecutionEnd
      ),
      onStepEnd: mergeCallbacks(
        (_c = this.settings.onStepEnd) != null ? _c : this.settings.onStepFinish,
        onStepEnd != null ? onStepEnd : onStepFinish
      ),
      onEnd: mergeCallbacks(this.settings.onEnd, onEnd)
    };
    return await generate({
      ...preparedCall,
      ...callbackArgs,
      headers: this.agentHeaders(preparedCall)
    });
  }
  /**
   * Streams an output from the agent (streaming).
   */
  async stream({
    abortSignal,
    timeout,
    experimental_sandbox: sandbox,
    experimental_transform,
    onStart,
    experimental_onStart,
    onStepStart,
    experimental_onStepStart,
    onToolExecutionStart,
    onToolExecutionEnd,
    onStepEnd,
    onStepFinish,
    onFinish,
    onEnd = onFinish,
    ...options
  }) {
    var _a22, _b, _c;
    const stream = streamText;
    const preparedCall = await this.prepareCall({
      ...options,
      experimental_sandbox: sandbox
    });
    const callbackArgs = {
      abortSignal,
      timeout,
      experimental_sandbox: sandbox,
      experimental_transform,
      onStart: mergeCallbacks(
        (_a22 = this.settings.onStart) != null ? _a22 : this.settings.experimental_onStart,
        onStart != null ? onStart : experimental_onStart
      ),
      onStepStart: mergeCallbacks(
        (_b = this.settings.onStepStart) != null ? _b : this.settings.experimental_onStepStart,
        onStepStart != null ? onStepStart : experimental_onStepStart
      ),
      onToolExecutionStart: mergeCallbacks(
        this.settings.onToolExecutionStart,
        onToolExecutionStart
      ),
      onToolExecutionEnd: mergeCallbacks(
        this.settings.onToolExecutionEnd,
        onToolExecutionEnd
      ),
      onStepEnd: mergeCallbacks(
        (_c = this.settings.onStepEnd) != null ? _c : this.settings.onStepFinish,
        onStepEnd != null ? onStepEnd : onStepFinish
      ),
      onEnd: mergeCallbacks(this.settings.onEnd, onEnd)
    };
    return await stream({
      ...preparedCall,
      ...callbackArgs,
      headers: this.agentHeaders(preparedCall)
    });
  }
};

// src/ui-message-stream/create-ui-message-stream.ts
import {
  generateId as generateIdFunc
} from "@ai-sdk/provider-utils";
function createUIMessageStream({
  execute,
  onError = () => "An error occurred.",
  // prevent leaking server error details to the client by default
  originalMessages,
  onStepEnd,
  onStepFinish,
  onEnd,
  onFinish,
  generateId: generateId2 = generateIdFunc
}) {
  let controller;
  const ongoingStreamPromises = [];
  const stream = new ReadableStream({
    start(controllerArg) {
      controller = controllerArg;
    }
  });
  function safeEnqueue(data) {
    try {
      controller.enqueue(data);
    } catch (e) {
    }
  }
  try {
    const result = execute({
      writer: {
        write(part) {
          safeEnqueue(part);
        },
        merge(streamArg) {
          ongoingStreamPromises.push(
            (async () => {
              const reader = streamArg.getReader();
              while (true) {
                const { done, value } = await reader.read();
                if (done)
                  break;
                safeEnqueue(value);
              }
            })().catch((error) => {
              safeEnqueue({
                type: "error",
                errorText: onError(error)
              });
            })
          );
        },
        onError
      }
    });
    if (result) {
      ongoingStreamPromises.push(
        result.catch((error) => {
          safeEnqueue({
            type: "error",
            errorText: onError(error)
          });
        })
      );
    }
  } catch (error) {
    safeEnqueue({
      type: "error",
      errorText: onError(error)
    });
  }
  const waitForStreams = new Promise(async (resolve3) => {
    while (ongoingStreamPromises.length > 0) {
      await ongoingStreamPromises.shift();
    }
    resolve3();
  });
  waitForStreams.finally(() => {
    try {
      controller.close();
    } catch (e) {
    }
  });
  return handleUIMessageStreamFinish({
    stream,
    messageId: generateId2(),
    originalMessages,
    onStepEnd: onStepEnd != null ? onStepEnd : onStepFinish,
    onEnd: onEnd != null ? onEnd : onFinish,
    onError
  });
}

// src/ui-message-stream/read-ui-message-stream.ts
function readUIMessageStream({
  message,
  stream,
  onError,
  terminateOnError = false
}) {
  var _a22;
  let controller;
  let hasErrored = false;
  const outputStream = new ReadableStream({
    start(controllerParam) {
      controller = controllerParam;
    }
  });
  const state = createStreamingUIMessageState({
    messageId: (_a22 = message == null ? void 0 : message.id) != null ? _a22 : "",
    lastMessage: message
  });
  const handleError = (error) => {
    onError == null ? void 0 : onError(error);
    if (!hasErrored && terminateOnError) {
      hasErrored = true;
      controller == null ? void 0 : controller.error(error);
    }
  };
  consumeStream({
    stream: processUIMessageStream({
      stream,
      runUpdateMessageJob(job) {
        return job({
          state,
          write: () => {
            controller == null ? void 0 : controller.enqueue(structuredClone(state.message));
          }
        });
      },
      onError: handleError
    }),
    onError: handleError
  }).finally(() => {
    if (!hasErrored) {
      controller == null ? void 0 : controller.close();
    }
  });
  return createAsyncIterableStream(outputStream);
}

// src/ui/convert-to-model-messages.ts
import {
  isNonNullable
} from "@ai-sdk/provider-utils";
async function convertToModelMessages(messages, options) {
  const modelMessages = [];
  if (options == null ? void 0 : options.ignoreIncompleteToolCalls) {
    messages = messages.map((message) => ({
      ...message,
      parts: message.parts.filter(
        (part) => !isToolUIPart(part) || part.state !== "input-streaming" && part.state !== "input-available"
      )
    }));
  }
  for (const message of messages) {
    switch (message.role) {
      case "system": {
        const textParts = message.parts.filter(
          (part) => part.type === "text"
        );
        const providerMetadata = textParts.reduce((acc, part) => {
          if (part.providerMetadata != null) {
            return { ...acc, ...part.providerMetadata };
          }
          return acc;
        }, {});
        modelMessages.push({
          role: "system",
          content: textParts.map((part) => part.text).join(""),
          ...Object.keys(providerMetadata).length > 0 ? { providerOptions: providerMetadata } : {}
        });
        break;
      }
      case "user": {
        modelMessages.push({
          role: "user",
          content: message.parts.map((part) => {
            var _a22;
            if (isTextUIPart(part)) {
              return {
                type: "text",
                text: part.text,
                ...part.providerMetadata != null ? { providerOptions: part.providerMetadata } : {}
              };
            }
            if (isFileUIPart(part)) {
              return {
                type: "file",
                mediaType: part.mediaType,
                filename: part.filename,
                data: part.providerReference != null ? {
                  type: "reference",
                  reference: part.providerReference
                } : { type: "url", url: new URL(part.url) },
                ...part.providerMetadata != null ? { providerOptions: part.providerMetadata } : {}
              };
            }
            if (isDataUIPart(part)) {
              return (_a22 = options == null ? void 0 : options.convertDataPart) == null ? void 0 : _a22.call(
                options,
                part
              );
            }
          }).filter(isNonNullable)
        });
        break;
      }
      case "assistant": {
        if (message.parts != null) {
          let block = [];
          async function processBlock() {
            var _a22, _b, _c, _d, _e, _f, _g;
            if (block.length === 0) {
              return;
            }
            const content = [];
            for (const part of block) {
              if (isTextUIPart(part)) {
                content.push({
                  type: "text",
                  text: part.text,
                  ...part.providerMetadata != null ? { providerOptions: part.providerMetadata } : {}
                });
              } else if (isCustomContentUIPart(part)) {
                content.push({
                  type: "custom",
                  kind: part.kind,
                  ...part.providerMetadata != null ? { providerOptions: part.providerMetadata } : {}
                });
              } else if (isFileUIPart(part)) {
                content.push({
                  type: "file",
                  mediaType: part.mediaType,
                  filename: part.filename,
                  data: part.providerReference != null ? {
                    type: "reference",
                    reference: part.providerReference
                  } : { type: "url", url: new URL(part.url) },
                  ...part.providerMetadata != null ? { providerOptions: part.providerMetadata } : {}
                });
              } else if (isReasoningFileUIPart(part)) {
                content.push({
                  type: "reasoning-file",
                  data: { type: "url", url: new URL(part.url) },
                  mediaType: part.mediaType,
                  providerOptions: part.providerMetadata
                });
              } else if (isReasoningUIPart(part)) {
                content.push({
                  type: "reasoning",
                  text: part.text,
                  providerOptions: part.providerMetadata
                });
              } else if (isToolUIPart(part)) {
                const toolName = getToolName(part);
                if (part.state !== "input-streaming") {
                  content.push({
                    type: "tool-call",
                    toolCallId: part.toolCallId,
                    toolName,
                    input: part.state === "output-error" ? (_a22 = part.input) != null ? _a22 : "rawInput" in part ? part.rawInput : void 0 : part.input,
                    providerExecuted: part.providerExecuted,
                    ...part.callProviderMetadata != null ? { providerOptions: part.callProviderMetadata } : {}
                  });
                  if (part.approval != null) {
                    content.push({
                      type: "tool-approval-request",
                      approvalId: part.approval.id,
                      toolCallId: part.toolCallId,
                      isAutomatic: part.approval.isAutomatic,
                      ...part.approval.signature != null ? { signature: part.approval.signature } : {}
                    });
                  }
                  if (part.providerExecuted === true && part.state !== "approval-responded" && (part.state === "output-available" || part.state === "output-error")) {
                    const resultProviderMetadata = (_b = part.resultProviderMetadata) != null ? _b : part.callProviderMetadata;
                    content.push({
                      type: "tool-result",
                      toolCallId: part.toolCallId,
                      toolName,
                      output: await createToolModelOutput({
                        toolCallId: part.toolCallId,
                        input: part.input,
                        output: part.state === "output-error" ? part.errorText : part.output,
                        tool: getOwn(options == null ? void 0 : options.tools, toolName),
                        errorMode: part.state === "output-error" ? "json" : "none"
                      }),
                      ...resultProviderMetadata != null ? { providerOptions: resultProviderMetadata } : {}
                    });
                  }
                }
              } else if (isDataUIPart(part)) {
                const dataPart = (_c = options == null ? void 0 : options.convertDataPart) == null ? void 0 : _c.call(
                  options,
                  part
                );
                if (dataPart != null) {
                  content.push(dataPart);
                }
              } else {
                const _exhaustiveCheck = part;
                throw new Error(`Unsupported part: ${_exhaustiveCheck}`);
              }
            }
            if (content.length > 0) {
              modelMessages.push({
                role: "assistant",
                content
              });
            }
            const toolParts = block.filter(
              (part) => {
                var _a23;
                return isToolUIPart(part) && (part.providerExecuted !== true || ((_a23 = part.approval) == null ? void 0 : _a23.approved) != null);
              }
            );
            if (toolParts.length > 0) {
              {
                const content2 = [];
                for (const toolPart of toolParts) {
                  if (((_d = toolPart.approval) == null ? void 0 : _d.approved) != null) {
                    content2.push({
                      type: "tool-approval-response",
                      approvalId: toolPart.approval.id,
                      approved: toolPart.approval.approved,
                      reason: toolPart.approval.reason,
                      providerExecuted: toolPart.providerExecuted
                    });
                  }
                  if (toolPart.state === "approval-responded" && ((_e = toolPart.approval) == null ? void 0 : _e.approved) === false) {
                    content2.push({
                      type: "tool-result",
                      toolCallId: toolPart.toolCallId,
                      toolName: getToolName(toolPart),
                      output: {
                        type: "execution-denied",
                        reason: toolPart.approval.reason
                      },
                      ...toolPart.callProviderMetadata != null ? { providerOptions: toolPart.callProviderMetadata } : {}
                    });
                  }
                  if (toolPart.providerExecuted === true) {
                    continue;
                  }
                  switch (toolPart.state) {
                    case "output-denied": {
                      content2.push({
                        type: "tool-result",
                        toolCallId: toolPart.toolCallId,
                        toolName: getToolName(toolPart),
                        output: {
                          type: "error-text",
                          value: (_g = (_f = toolPart.approval) == null ? void 0 : _f.reason) != null ? _g : "Tool call execution denied."
                        },
                        ...toolPart.callProviderMetadata != null ? { providerOptions: toolPart.callProviderMetadata } : {}
                      });
                      break;
                    }
                    case "output-error":
                    case "output-available": {
                      const toolName = getToolName(toolPart);
                      content2.push({
                        type: "tool-result",
                        toolCallId: toolPart.toolCallId,
                        toolName,
                        output: await createToolModelOutput({
                          toolCallId: toolPart.toolCallId,
                          input: toolPart.input,
                          output: toolPart.state === "output-error" ? toolPart.errorText : toolPart.output,
                          tool: getOwn(options == null ? void 0 : options.tools, toolName),
                          errorMode: toolPart.state === "output-error" ? "text" : "none"
                        }),
                        ...toolPart.callProviderMetadata != null ? { providerOptions: toolPart.callProviderMetadata } : {}
                      });
                      break;
                    }
                  }
                }
                if (content2.length > 0) {
                  modelMessages.push({
                    role: "tool",
                    content: content2
                  });
                }
              }
            }
            block = [];
          }
          for (const part of message.parts) {
            if (isCustomContentUIPart(part) || isTextUIPart(part) || isReasoningUIPart(part) || isReasoningFileUIPart(part) || isFileUIPart(part) || isToolUIPart(part) || isDataUIPart(part)) {
              block.push(part);
            } else if (part.type === "step-start") {
              await processBlock();
            }
          }
          await processBlock();
          break;
        }
        break;
      }
      default: {
        const _exhaustiveCheck = message.role;
        throw new MessageConversionError({
          originalMessage: message,
          message: `Unsupported role: ${_exhaustiveCheck}`
        });
      }
    }
  }
  return modelMessages;
}

// src/ui/validate-ui-messages.ts
import { TypeValidationError as TypeValidationError3 } from "@ai-sdk/provider";
import {
  lazySchema as lazySchema2,
  validateTypes as validateTypes4,
  zodSchema as zodSchema2
} from "@ai-sdk/provider-utils";
import { z as z7 } from "zod/v4";
var toolMetadataSchema2 = z7.record(
  z7.string(),
  jsonValueSchema.optional()
);
var providerReferenceSchema2 = z7.record(z7.string(), z7.string());
var uiMessagesSchema = lazySchema2(
  () => zodSchema2(
    z7.array(
      z7.object({
        id: z7.string(),
        role: z7.enum(["system", "user", "assistant"]),
        metadata: z7.unknown().optional(),
        parts: z7.array(
          z7.union([
            z7.object({
              type: z7.literal("text"),
              text: z7.string(),
              state: z7.enum(["streaming", "done"]).optional(),
              providerMetadata: providerMetadataSchema.optional()
            }),
            z7.object({
              type: z7.literal("reasoning"),
              text: z7.string(),
              state: z7.enum(["streaming", "done"]).optional(),
              providerMetadata: providerMetadataSchema.optional()
            }),
            z7.object({
              type: z7.literal("custom"),
              kind: z7.string(),
              providerMetadata: providerMetadataSchema.optional()
            }),
            z7.object({
              type: z7.literal("source-url"),
              sourceId: z7.string(),
              url: z7.string(),
              title: z7.string().optional(),
              providerMetadata: providerMetadataSchema.optional()
            }),
            z7.object({
              type: z7.literal("source-document"),
              sourceId: z7.string(),
              mediaType: z7.string(),
              title: z7.string(),
              filename: z7.string().optional(),
              providerMetadata: providerMetadataSchema.optional()
            }),
            z7.object({
              type: z7.literal("file"),
              mediaType: z7.string(),
              filename: z7.string().optional(),
              url: z7.string(),
              providerReference: providerReferenceSchema2.optional(),
              providerMetadata: providerMetadataSchema.optional()
            }),
            z7.object({
              type: z7.literal("reasoning-file"),
              mediaType: z7.string(),
              url: z7.string(),
              providerMetadata: providerMetadataSchema.optional()
            }),
            z7.object({
              type: z7.literal("step-start")
            }),
            z7.object({
              type: z7.string().startsWith("data-"),
              id: z7.string().optional(),
              data: z7.unknown()
            }),
            z7.object({
              type: z7.literal("dynamic-tool"),
              toolName: z7.string(),
              toolCallId: z7.string(),
              toolMetadata: toolMetadataSchema2.optional(),
              state: z7.literal("input-streaming"),
              input: z7.unknown().optional(),
              providerExecuted: z7.boolean().optional(),
              callProviderMetadata: providerMetadataSchema.optional(),
              output: z7.never().optional(),
              errorText: z7.never().optional(),
              approval: z7.never().optional()
            }),
            z7.object({
              type: z7.literal("dynamic-tool"),
              toolName: z7.string(),
              toolCallId: z7.string(),
              toolMetadata: toolMetadataSchema2.optional(),
              state: z7.literal("input-available"),
              input: z7.unknown(),
              providerExecuted: z7.boolean().optional(),
              output: z7.never().optional(),
              errorText: z7.never().optional(),
              callProviderMetadata: providerMetadataSchema.optional(),
              approval: z7.never().optional()
            }),
            z7.object({
              type: z7.literal("dynamic-tool"),
              toolName: z7.string(),
              toolCallId: z7.string(),
              toolMetadata: toolMetadataSchema2.optional(),
              state: z7.literal("approval-requested"),
              input: z7.unknown(),
              providerExecuted: z7.boolean().optional(),
              output: z7.never().optional(),
              errorText: z7.never().optional(),
              callProviderMetadata: providerMetadataSchema.optional(),
              approval: z7.object({
                id: z7.string(),
                approved: z7.never().optional(),
                reason: z7.never().optional(),
                isAutomatic: z7.boolean().optional(),
                signature: z7.string().optional()
              })
            }),
            z7.object({
              type: z7.literal("dynamic-tool"),
              toolName: z7.string(),
              toolCallId: z7.string(),
              toolMetadata: toolMetadataSchema2.optional(),
              state: z7.literal("approval-responded"),
              input: z7.unknown(),
              providerExecuted: z7.boolean().optional(),
              output: z7.never().optional(),
              errorText: z7.never().optional(),
              callProviderMetadata: providerMetadataSchema.optional(),
              approval: z7.object({
                id: z7.string(),
                approved: z7.boolean(),
                reason: z7.string().optional(),
                isAutomatic: z7.boolean().optional(),
                signature: z7.string().optional()
              })
            }),
            z7.object({
              type: z7.literal("dynamic-tool"),
              toolName: z7.string(),
              toolCallId: z7.string(),
              toolMetadata: toolMetadataSchema2.optional(),
              state: z7.literal("output-available"),
              input: z7.unknown(),
              providerExecuted: z7.boolean().optional(),
              output: z7.unknown(),
              errorText: z7.never().optional(),
              callProviderMetadata: providerMetadataSchema.optional(),
              resultProviderMetadata: providerMetadataSchema.optional(),
              preliminary: z7.boolean().optional(),
              approval: z7.object({
                id: z7.string(),
                approved: z7.literal(true),
                reason: z7.string().optional(),
                isAutomatic: z7.boolean().optional(),
                signature: z7.string().optional()
              }).optional()
            }),
            z7.object({
              type: z7.literal("dynamic-tool"),
              toolName: z7.string(),
              toolCallId: z7.string(),
              toolMetadata: toolMetadataSchema2.optional(),
              state: z7.literal("output-error"),
              input: z7.unknown().optional(),
              rawInput: z7.unknown().optional(),
              providerExecuted: z7.boolean().optional(),
              output: z7.never().optional(),
              errorText: z7.string(),
              callProviderMetadata: providerMetadataSchema.optional(),
              resultProviderMetadata: providerMetadataSchema.optional(),
              approval: z7.object({
                id: z7.string(),
                approved: z7.literal(true),
                reason: z7.string().optional(),
                isAutomatic: z7.boolean().optional(),
                signature: z7.string().optional()
              }).optional()
            }),
            z7.object({
              type: z7.literal("dynamic-tool"),
              toolName: z7.string(),
              toolCallId: z7.string(),
              toolMetadata: toolMetadataSchema2.optional(),
              state: z7.literal("output-denied"),
              input: z7.unknown(),
              providerExecuted: z7.boolean().optional(),
              output: z7.never().optional(),
              errorText: z7.never().optional(),
              callProviderMetadata: providerMetadataSchema.optional(),
              approval: z7.object({
                id: z7.string(),
                approved: z7.literal(false),
                reason: z7.string().optional(),
                isAutomatic: z7.boolean().optional(),
                signature: z7.string().optional()
              })
            }),
            z7.object({
              type: z7.string().startsWith("tool-"),
              toolCallId: z7.string(),
              toolMetadata: toolMetadataSchema2.optional(),
              state: z7.literal("input-streaming"),
              providerExecuted: z7.boolean().optional(),
              callProviderMetadata: providerMetadataSchema.optional(),
              input: z7.unknown().optional(),
              output: z7.never().optional(),
              errorText: z7.never().optional(),
              approval: z7.never().optional()
            }),
            z7.object({
              type: z7.string().startsWith("tool-"),
              toolCallId: z7.string(),
              toolMetadata: toolMetadataSchema2.optional(),
              state: z7.literal("input-available"),
              providerExecuted: z7.boolean().optional(),
              input: z7.unknown(),
              output: z7.never().optional(),
              errorText: z7.never().optional(),
              callProviderMetadata: providerMetadataSchema.optional(),
              approval: z7.never().optional()
            }),
            z7.object({
              type: z7.string().startsWith("tool-"),
              toolCallId: z7.string(),
              toolMetadata: toolMetadataSchema2.optional(),
              state: z7.literal("approval-requested"),
              input: z7.unknown(),
              providerExecuted: z7.boolean().optional(),
              output: z7.never().optional(),
              errorText: z7.never().optional(),
              callProviderMetadata: providerMetadataSchema.optional(),
              approval: z7.object({
                id: z7.string(),
                approved: z7.never().optional(),
                reason: z7.never().optional(),
                isAutomatic: z7.boolean().optional(),
                signature: z7.string().optional()
              })
            }),
            z7.object({
              type: z7.string().startsWith("tool-"),
              toolCallId: z7.string(),
              toolMetadata: toolMetadataSchema2.optional(),
              state: z7.literal("approval-responded"),
              input: z7.unknown(),
              providerExecuted: z7.boolean().optional(),
              output: z7.never().optional(),
              errorText: z7.never().optional(),
              callProviderMetadata: providerMetadataSchema.optional(),
              approval: z7.object({
                id: z7.string(),
                approved: z7.boolean(),
                reason: z7.string().optional(),
                isAutomatic: z7.boolean().optional(),
                signature: z7.string().optional()
              })
            }),
            z7.object({
              type: z7.string().startsWith("tool-"),
              toolCallId: z7.string(),
              toolMetadata: toolMetadataSchema2.optional(),
              state: z7.literal("output-available"),
              providerExecuted: z7.boolean().optional(),
              input: z7.unknown(),
              output: z7.unknown(),
              errorText: z7.never().optional(),
              callProviderMetadata: providerMetadataSchema.optional(),
              resultProviderMetadata: providerMetadataSchema.optional(),
              preliminary: z7.boolean().optional(),
              approval: z7.object({
                id: z7.string(),
                approved: z7.literal(true),
                reason: z7.string().optional(),
                isAutomatic: z7.boolean().optional(),
                signature: z7.string().optional()
              }).optional()
            }),
            z7.object({
              type: z7.string().startsWith("tool-"),
              toolCallId: z7.string(),
              toolMetadata: toolMetadataSchema2.optional(),
              state: z7.literal("output-error"),
              providerExecuted: z7.boolean().optional(),
              input: z7.unknown().optional(),
              rawInput: z7.unknown().optional(),
              output: z7.never().optional(),
              errorText: z7.string(),
              callProviderMetadata: providerMetadataSchema.optional(),
              resultProviderMetadata: providerMetadataSchema.optional(),
              approval: z7.object({
                id: z7.string(),
                approved: z7.literal(true),
                reason: z7.string().optional(),
                isAutomatic: z7.boolean().optional(),
                signature: z7.string().optional()
              }).optional()
            }),
            z7.object({
              type: z7.string().startsWith("tool-"),
              toolCallId: z7.string(),
              toolMetadata: toolMetadataSchema2.optional(),
              state: z7.literal("output-denied"),
              providerExecuted: z7.boolean().optional(),
              input: z7.unknown(),
              output: z7.never().optional(),
              errorText: z7.never().optional(),
              callProviderMetadata: providerMetadataSchema.optional(),
              approval: z7.object({
                id: z7.string(),
                approved: z7.literal(false),
                reason: z7.string().optional(),
                isAutomatic: z7.boolean().optional(),
                signature: z7.string().optional()
              })
            })
          ])
        )
      }).superRefine((message, context) => {
        if (message.role !== "assistant" && message.parts.length === 0) {
          context.addIssue({
            origin: "array",
            code: "too_small",
            minimum: 1,
            inclusive: true,
            input: message.parts,
            path: ["parts"],
            message: "Message must contain at least one part"
          });
        }
      })
    ).nonempty("Messages array must not be empty")
  )
);
async function safeValidateUIMessages({
  messages,
  metadataSchema,
  dataSchemas,
  tools
}) {
  try {
    if (messages == null) {
      return {
        success: false,
        error: new InvalidArgumentError({
          parameter: "messages",
          value: messages,
          message: "messages parameter must be provided"
        })
      };
    }
    const validatedMessages = await validateTypes4({
      value: messages,
      schema: uiMessagesSchema
    });
    if (metadataSchema) {
      for (const [msgIdx, message] of validatedMessages.entries()) {
        await validateTypes4({
          value: message.metadata,
          schema: metadataSchema,
          context: {
            field: `messages[${msgIdx}].metadata`,
            entityId: message.id
          }
        });
      }
    }
    if (dataSchemas || tools) {
      for (const [msgIdx, message] of validatedMessages.entries()) {
        for (const [partIdx, part] of message.parts.entries()) {
          if (dataSchemas && part.type.startsWith("data-")) {
            const dataPart = part;
            const dataName = dataPart.type.slice(5);
            const dataSchema = dataSchemas[dataName];
            if (!dataSchema) {
              return {
                success: false,
                error: new TypeValidationError3({
                  value: dataPart.data,
                  cause: `No data schema found for data part ${dataName}`,
                  context: {
                    field: `messages[${msgIdx}].parts[${partIdx}].data`,
                    entityName: dataName,
                    entityId: dataPart.id
                  }
                })
              };
            }
            await validateTypes4({
              value: dataPart.data,
              schema: dataSchema,
              context: {
                field: `messages[${msgIdx}].parts[${partIdx}].data`,
                entityName: dataName,
                entityId: dataPart.id
              }
            });
          }
          if (tools && part.type.startsWith("tool-")) {
            const toolPart = part;
            const toolName = toolPart.type.slice(5);
            const tool2 = getOwn(tools, toolName);
            if (!tool2 && (toolPart.state === "output-available" || toolPart.state === "output-error" || toolPart.state === "output-denied")) {
              continue;
            }
            if (!tool2) {
              return {
                success: false,
                error: new TypeValidationError3({
                  value: toolPart.input,
                  cause: `No tool schema found for tool part ${toolName}`,
                  context: {
                    field: `messages[${msgIdx}].parts[${partIdx}].input`,
                    entityName: toolName,
                    entityId: toolPart.toolCallId
                  }
                })
              };
            }
            if (toolPart.state === "input-available" || toolPart.state === "output-available") {
              await validateTypes4({
                value: toolPart.input,
                schema: tool2.inputSchema,
                context: {
                  field: `messages[${msgIdx}].parts[${partIdx}].input`,
                  entityName: toolName,
                  entityId: toolPart.toolCallId
                }
              });
            }
            if (toolPart.state === "output-available" && tool2.outputSchema) {
              await validateTypes4({
                value: toolPart.output,
                schema: tool2.outputSchema,
                context: {
                  field: `messages[${msgIdx}].parts[${partIdx}].output`,
                  entityName: toolName,
                  entityId: toolPart.toolCallId
                }
              });
            }
          }
        }
      }
    }
    return {
      success: true,
      data: validatedMessages
    };
  } catch (error) {
    const err = error;
    return {
      success: false,
      error: err
    };
  }
}
async function validateUIMessages({
  messages,
  metadataSchema,
  dataSchemas,
  tools
}) {
  const response = await safeValidateUIMessages({
    messages,
    metadataSchema,
    dataSchemas,
    tools
  });
  if (!response.success)
    throw response.error;
  return response.data;
}

// src/agent/create-agent-ui-stream.ts
async function createAgentUIStream({
  agent,
  uiMessages,
  options,
  abortSignal,
  timeout,
  experimental_sandbox: sandbox,
  experimental_transform,
  onStepEnd,
  onStepFinish,
  ...uiMessageStreamOptions
}) {
  var _a22;
  const validatedMessages = await validateUIMessages({
    messages: uiMessages,
    // tools are compatible; the casting is required because the context param is
    // not available in ui messages
    tools: agent.tools
  });
  const modelMessages = await convertToModelMessages(validatedMessages, {
    tools: agent.tools
  });
  const result = await agent.stream({
    prompt: modelMessages,
    options,
    abortSignal,
    timeout,
    experimental_sandbox: sandbox,
    experimental_transform,
    onStepEnd: onStepEnd != null ? onStepEnd : onStepFinish
  });
  const originalMessages = (_a22 = uiMessageStreamOptions.originalMessages) != null ? _a22 : validatedMessages;
  return createAsyncIterableStream(
    toUIMessageStream({
      ...uiMessageStreamOptions,
      originalMessages,
      stream: result.stream,
      tools: agent.tools
    })
  );
}

// src/agent/create-agent-ui-stream-response.ts
async function createAgentUIStreamResponse({
  headers,
  status,
  statusText,
  consumeSseStream,
  ...options
}) {
  return createUIMessageStreamResponse({
    headers,
    status,
    statusText,
    consumeSseStream,
    stream: await createAgentUIStream(options)
  });
}

// src/agent/pipe-agent-ui-stream-to-response.ts
async function pipeAgentUIStreamToResponse({
  response,
  headers,
  status,
  statusText,
  consumeSseStream,
  ...options
}) {
  return pipeUIMessageStreamToResponse({
    response,
    headers,
    status,
    statusText,
    consumeSseStream,
    stream: await createAgentUIStream(options)
  });
}

// src/embed/embed.ts
import {
  createIdGenerator as createIdGenerator4,
  withUserAgentSuffix as withUserAgentSuffix4
} from "@ai-sdk/provider-utils";
var originalGenerateCallId4 = createIdGenerator4({
  prefix: "call",
  size: 24
});
async function embed({
  model: modelArg,
  value,
  providerOptions,
  maxRetries: maxRetriesArg,
  abortSignal,
  headers,
  experimental_telemetry,
  telemetry = experimental_telemetry,
  onStart,
  experimental_onStart,
  onEnd,
  experimental_onEnd,
  _internal: { generateCallId = originalGenerateCallId4 } = {}
}) {
  var _a22;
  const model = resolveEmbeddingModel(modelArg);
  const { maxRetries, retry } = prepareRetries({
    maxRetries: maxRetriesArg,
    abortSignal
  });
  const resolvedOnStart = onStart != null ? onStart : experimental_onStart;
  const resolvedOnEnd = onEnd != null ? onEnd : experimental_onEnd;
  const headersWithUserAgent = withUserAgentSuffix4(
    headers != null ? headers : {},
    `ai/${VERSION}`
  );
  const callId = generateCallId();
  const telemetryDispatcher = createTelemetryDispatcher({
    telemetry
  });
  const runInTracingChannelSpan = (_a22 = telemetryDispatcher.runInTracingChannelSpan) != null ? _a22 : async ({ execute }) => await execute();
  const startEvent = {
    callId,
    operationId: "ai.embed",
    provider: model.provider,
    modelId: model.modelId,
    value,
    maxRetries,
    headers: headersWithUserAgent,
    providerOptions
  };
  return await runInTracingChannelSpan({
    type: "embed",
    event: startEvent,
    execute: async () => {
      var _a23;
      await notify({
        event: startEvent,
        callbacks: [resolvedOnStart, telemetryDispatcher.onStart]
      });
      try {
        const { embedding, usage, warnings, response, providerMetadata } = await retry(async () => {
          var _a24, _b;
          const embedCallId = generateCallId();
          await notify({
            event: {
              callId,
              embedCallId,
              operationId: "ai.embed.doEmbed",
              provider: model.provider,
              modelId: model.modelId,
              values: [value]
            },
            callbacks: [telemetryDispatcher.onEmbedStart]
          });
          const modelResponse = await model.doEmbed({
            values: [value],
            abortSignal,
            headers: headersWithUserAgent,
            providerOptions
          });
          const embedding2 = modelResponse.embeddings[0];
          const usage2 = (_a24 = modelResponse.usage) != null ? _a24 : { tokens: NaN };
          await notify({
            event: {
              callId,
              embedCallId,
              operationId: "ai.embed.doEmbed",
              provider: model.provider,
              modelId: model.modelId,
              values: [value],
              embeddings: modelResponse.embeddings,
              usage: usage2
            },
            callbacks: [telemetryDispatcher.onEmbedEnd]
          });
          return {
            embedding: embedding2,
            usage: usage2,
            warnings: (_b = modelResponse.warnings) != null ? _b : [],
            providerMetadata: modelResponse.providerMetadata,
            response: modelResponse.response
          };
        });
        logWarnings({
          warnings,
          provider: model.provider,
          model: model.modelId
        });
        await notify({
          event: {
            callId,
            operationId: "ai.embed",
            provider: model.provider,
            modelId: model.modelId,
            value,
            embedding,
            usage,
            warnings,
            providerMetadata,
            response
          },
          callbacks: [resolvedOnEnd, telemetryDispatcher.onEnd]
        });
        return new DefaultEmbedResult({
          value,
          embedding,
          usage,
          warnings,
          providerMetadata,
          response
        });
      } catch (error) {
        await ((_a23 = telemetryDispatcher.onError) == null ? void 0 : _a23.call(telemetryDispatcher, { callId, error }));
        throw error;
      }
    }
  });
}
var DefaultEmbedResult = class {
  constructor(options) {
    this.value = options.value;
    this.embedding = options.embedding;
    this.usage = options.usage;
    this.warnings = options.warnings;
    this.providerMetadata = options.providerMetadata;
    this.response = options.response;
  }
};

// src/embed/embed-many.ts
import {
  createIdGenerator as createIdGenerator5,
  withUserAgentSuffix as withUserAgentSuffix5
} from "@ai-sdk/provider-utils";

// src/util/split-array.ts
function splitArray(array2, chunkSize) {
  if (chunkSize <= 0) {
    throw new Error("chunkSize must be greater than 0");
  }
  const result = [];
  for (let i = 0; i < array2.length; i += chunkSize) {
    result.push(array2.slice(i, i + chunkSize));
  }
  return result;
}

// src/embed/embed-many.ts
var originalGenerateCallId5 = createIdGenerator5({
  prefix: "call",
  size: 24
});
async function embedMany({
  model: modelArg,
  values,
  maxParallelCalls = Infinity,
  maxRetries: maxRetriesArg,
  abortSignal,
  headers,
  providerOptions,
  experimental_telemetry,
  telemetry = experimental_telemetry,
  onStart,
  experimental_onStart,
  onEnd,
  experimental_onEnd,
  _internal: { generateCallId = originalGenerateCallId5 } = {}
}) {
  var _a22;
  const model = resolveEmbeddingModel(modelArg);
  const { maxRetries, retry } = prepareRetries({
    maxRetries: maxRetriesArg,
    abortSignal
  });
  const resolvedOnStart = onStart != null ? onStart : experimental_onStart;
  const resolvedOnEnd = onEnd != null ? onEnd : experimental_onEnd;
  const headersWithUserAgent = withUserAgentSuffix5(
    headers != null ? headers : {},
    `ai/${VERSION}`
  );
  const callId = generateCallId();
  const telemetryDispatcher = createTelemetryDispatcher({
    telemetry
  });
  const runInTracingChannelSpan = (_a22 = telemetryDispatcher.runInTracingChannelSpan) != null ? _a22 : async ({ execute }) => await execute();
  const startEvent = {
    callId,
    operationId: "ai.embedMany",
    provider: model.provider,
    modelId: model.modelId,
    value: values,
    maxRetries,
    headers: headersWithUserAgent,
    providerOptions
  };
  return await runInTracingChannelSpan({
    type: "embedMany",
    event: startEvent,
    execute: async () => {
      var _a23, _b;
      await notify({
        event: startEvent,
        callbacks: [resolvedOnStart, telemetryDispatcher.onStart]
      });
      try {
        const [maxEmbeddingsPerCall, supportsParallelCalls] = await Promise.all(
          [model.maxEmbeddingsPerCall, model.supportsParallelCalls]
        );
        if (maxEmbeddingsPerCall == null || maxEmbeddingsPerCall === Infinity) {
          const { embeddings: embeddings2, usage, warnings: warnings2, response, providerMetadata: providerMetadata2 } = await retry(async () => {
            var _a24, _b2;
            const embedCallId = generateCallId();
            await notify({
              event: {
                callId,
                embedCallId,
                operationId: "ai.embedMany.doEmbed",
                provider: model.provider,
                modelId: model.modelId,
                values
              },
              callbacks: [telemetryDispatcher.onEmbedStart]
            });
            const modelResponse = await model.doEmbed({
              values,
              abortSignal,
              headers: headersWithUserAgent,
              providerOptions
            });
            const embeddings3 = modelResponse.embeddings;
            const usage2 = (_a24 = modelResponse.usage) != null ? _a24 : { tokens: NaN };
            await notify({
              event: {
                callId,
                embedCallId,
                operationId: "ai.embedMany.doEmbed",
                provider: model.provider,
                modelId: model.modelId,
                values,
                embeddings: embeddings3,
                usage: usage2
              },
              callbacks: [telemetryDispatcher.onEmbedEnd]
            });
            return {
              embeddings: embeddings3,
              usage: usage2,
              warnings: (_b2 = modelResponse.warnings) != null ? _b2 : [],
              providerMetadata: modelResponse.providerMetadata,
              response: modelResponse.response
            };
          });
          logWarnings({
            warnings: warnings2,
            provider: model.provider,
            model: model.modelId
          });
          await notify({
            event: {
              callId,
              operationId: "ai.embedMany",
              provider: model.provider,
              modelId: model.modelId,
              value: values,
              embedding: embeddings2,
              usage,
              warnings: warnings2,
              providerMetadata: providerMetadata2,
              response: [response]
            },
            callbacks: [resolvedOnEnd, telemetryDispatcher.onEnd]
          });
          return new DefaultEmbedManyResult({
            values,
            embeddings: embeddings2,
            usage,
            warnings: warnings2,
            providerMetadata: providerMetadata2,
            responses: [response]
          });
        }
        const valueChunks = splitArray(values, maxEmbeddingsPerCall);
        const embeddings = [];
        const warnings = [];
        const responses = [];
        let tokens = 0;
        let providerMetadata;
        const parallelChunks = splitArray(
          valueChunks,
          supportsParallelCalls ? maxParallelCalls : 1
        );
        for (const parallelChunk of parallelChunks) {
          const results = await Promise.all(
            parallelChunk.map((chunk) => {
              return retry(async () => {
                var _a24, _b2;
                const embedCallId = generateCallId();
                await notify({
                  event: {
                    callId,
                    embedCallId,
                    operationId: "ai.embedMany.doEmbed",
                    provider: model.provider,
                    modelId: model.modelId,
                    values: chunk
                  },
                  callbacks: [telemetryDispatcher.onEmbedStart]
                });
                const modelResponse = await model.doEmbed({
                  values: chunk,
                  abortSignal,
                  headers: headersWithUserAgent,
                  providerOptions
                });
                const chunkEmbeddings = modelResponse.embeddings;
                const usage = (_a24 = modelResponse.usage) != null ? _a24 : { tokens: NaN };
                await notify({
                  event: {
                    callId,
                    embedCallId,
                    operationId: "ai.embedMany.doEmbed",
                    provider: model.provider,
                    modelId: model.modelId,
                    values: chunk,
                    embeddings: chunkEmbeddings,
                    usage
                  },
                  callbacks: [telemetryDispatcher.onEmbedEnd]
                });
                return {
                  embeddings: chunkEmbeddings,
                  usage,
                  warnings: (_b2 = modelResponse.warnings) != null ? _b2 : [],
                  providerMetadata: modelResponse.providerMetadata,
                  response: modelResponse.response
                };
              });
            })
          );
          for (const result of results) {
            embeddings.push(...result.embeddings);
            warnings.push(...result.warnings);
            responses.push(result.response);
            tokens += result.usage.tokens;
            if (result.providerMetadata) {
              if (!providerMetadata) {
                providerMetadata = { ...result.providerMetadata };
              } else {
                for (const [providerName, metadata] of Object.entries(
                  result.providerMetadata
                )) {
                  providerMetadata[providerName] = {
                    ...(_a23 = providerMetadata[providerName]) != null ? _a23 : {},
                    ...metadata
                  };
                }
              }
            }
          }
        }
        logWarnings({
          warnings,
          provider: model.provider,
          model: model.modelId
        });
        await notify({
          event: {
            callId,
            operationId: "ai.embedMany",
            provider: model.provider,
            modelId: model.modelId,
            value: values,
            embedding: embeddings,
            usage: { tokens },
            warnings,
            providerMetadata,
            response: responses
          },
          callbacks: [resolvedOnEnd, telemetryDispatcher.onEnd]
        });
        return new DefaultEmbedManyResult({
          values,
          embeddings,
          usage: { tokens },
          warnings,
          providerMetadata,
          responses
        });
      } catch (error) {
        await ((_b = telemetryDispatcher.onError) == null ? void 0 : _b.call(telemetryDispatcher, { callId, error }));
        throw error;
      }
    }
  });
}
var DefaultEmbedManyResult = class {
  constructor(options) {
    this.values = options.values;
    this.embeddings = options.embeddings;
    this.usage = options.usage;
    this.warnings = options.warnings;
    this.providerMetadata = options.providerMetadata;
    this.responses = options.responses;
  }
};

// src/generate-image/generate-image.ts
import {
  convertBase64ToUint8Array as convertBase64ToUint8Array4,
  detectMediaType as detectMediaType2,
  withUserAgentSuffix as withUserAgentSuffix6
} from "@ai-sdk/provider-utils";

// src/prompt/data-content.ts
import {
  convertBase64ToUint8Array as convertBase64ToUint8Array3,
  convertUint8ArrayToBase64 as convertUint8ArrayToBase643
} from "@ai-sdk/provider-utils";
function convertDataContentToBase64String(content) {
  if (typeof content === "string") {
    return content;
  }
  if (content instanceof ArrayBuffer) {
    return convertUint8ArrayToBase643(new Uint8Array(content));
  }
  return convertUint8ArrayToBase643(content);
}
function convertDataContentToUint8Array(content) {
  if (content instanceof Uint8Array) {
    return content;
  }
  if (typeof content === "string") {
    try {
      return convertBase64ToUint8Array3(content);
    } catch (error) {
      throw new InvalidDataContentError({
        message: "Invalid data content. Content string is not a base64-encoded media.",
        content,
        cause: error
      });
    }
  }
  if (content instanceof ArrayBuffer) {
    return new Uint8Array(content);
  }
  throw new InvalidDataContentError({ content });
}

// src/generate-image/generate-image.ts
async function generateImage({
  model: modelArg,
  prompt: promptArg,
  n = 1,
  maxImagesPerCall,
  size,
  aspectRatio,
  seed,
  providerOptions,
  maxRetries: maxRetriesArg,
  abortSignal,
  headers
}) {
  var _a22, _b;
  const model = resolveImageModel(modelArg);
  const headersWithUserAgent = withUserAgentSuffix6(
    headers != null ? headers : {},
    `ai/${VERSION}`
  );
  const { retry } = prepareRetries({
    maxRetries: maxRetriesArg,
    abortSignal
  });
  const maxImagesPerCallWithDefault = (_a22 = maxImagesPerCall != null ? maxImagesPerCall : await invokeModelMaxImagesPerCall(model)) != null ? _a22 : 1;
  const callCount = Math.ceil(n / maxImagesPerCallWithDefault);
  const callImageCounts = Array.from({ length: callCount }, (_, i) => {
    if (i < callCount - 1) {
      return maxImagesPerCallWithDefault;
    }
    const remainder = n % maxImagesPerCallWithDefault;
    return remainder === 0 ? maxImagesPerCallWithDefault : remainder;
  });
  const results = await Promise.all(
    callImageCounts.map(
      async (callImageCount) => await retry(() => {
        const { prompt, files, mask } = normalizePrompt(promptArg);
        return model.doGenerate({
          prompt,
          files,
          mask,
          n: callImageCount,
          abortSignal,
          headers: headersWithUserAgent,
          size,
          aspectRatio,
          seed,
          providerOptions: providerOptions != null ? providerOptions : {}
        });
      })
    )
  );
  const images = [];
  const warnings = [];
  const responses = [];
  const providerMetadata = {};
  let totalUsage = {
    inputTokens: void 0,
    outputTokens: void 0,
    totalTokens: void 0
  };
  for (const result of results) {
    images.push(
      ...result.images.map(
        (image) => {
          var _a23;
          return new DefaultGeneratedFile({
            data: image,
            mediaType: (_a23 = detectMediaType2({
              data: image,
              topLevelType: "image"
            })) != null ? _a23 : "image/png"
          });
        }
      )
    );
    warnings.push(...result.warnings);
    if (result.usage != null) {
      totalUsage = addImageModelUsage(totalUsage, result.usage);
    }
    if (result.providerMetadata) {
      for (const [providerName, metadata] of Object.entries(result.providerMetadata)) {
        if (providerName === "gateway") {
          const currentEntry = providerMetadata[providerName];
          if (currentEntry != null && typeof currentEntry === "object") {
            providerMetadata[providerName] = {
              ...currentEntry,
              ...metadata
            };
          } else {
            providerMetadata[providerName] = metadata;
          }
          const imagesValue = providerMetadata[providerName].images;
          if (Array.isArray(imagesValue) && imagesValue.length === 0) {
            delete providerMetadata[providerName].images;
          }
        } else {
          (_b = providerMetadata[providerName]) != null ? _b : providerMetadata[providerName] = { images: [] };
          providerMetadata[providerName].images.push(
            ...result.providerMetadata[providerName].images
          );
        }
      }
    }
    responses.push(result.response);
  }
  logWarnings({ warnings, provider: model.provider, model: model.modelId });
  if (!images.length) {
    throw new NoImageGeneratedError({ responses });
  }
  return new DefaultGenerateImageResult({
    images,
    warnings,
    responses,
    providerMetadata,
    usage: totalUsage
  });
}
var DefaultGenerateImageResult = class {
  constructor(options) {
    this.images = options.images;
    this.warnings = options.warnings;
    this.responses = options.responses;
    this.providerMetadata = options.providerMetadata;
    this.usage = options.usage;
  }
  get image() {
    return this.images[0];
  }
};
async function invokeModelMaxImagesPerCall(model) {
  const isFunction = model.maxImagesPerCall instanceof Function;
  if (!isFunction) {
    return model.maxImagesPerCall;
  }
  return model.maxImagesPerCall({
    modelId: model.modelId
  });
}
function normalizePrompt(prompt) {
  if (typeof prompt === "string") {
    return { prompt, files: void 0, mask: void 0 };
  }
  return {
    prompt: prompt.text,
    files: prompt.images.map(toImageModelV4File),
    mask: prompt.mask ? toImageModelV4File(prompt.mask) : void 0
  };
}
function toImageModelV4File(dataContent) {
  if (typeof dataContent === "string" && dataContent.startsWith("http")) {
    return {
      type: "url",
      url: dataContent
    };
  }
  if (typeof dataContent === "string" && dataContent.startsWith("data:")) {
    const { mediaType: dataUrlMediaType, base64Content } = splitDataUrl(dataContent);
    if (base64Content != null) {
      const uint8Data2 = convertBase64ToUint8Array4(base64Content);
      return {
        type: "file",
        data: uint8Data2,
        mediaType: dataUrlMediaType || detectMediaType2({
          data: uint8Data2,
          topLevelType: "image"
        }) || "image/png"
      };
    }
  }
  const uint8Data = convertDataContentToUint8Array(dataContent);
  return {
    type: "file",
    data: uint8Data,
    mediaType: detectMediaType2({
      data: uint8Data,
      topLevelType: "image"
    }) || "image/png"
  };
}

// src/generate-object/generate-object.ts
import {
  createIdGenerator as createIdGenerator6,
  withUserAgentSuffix as withUserAgentSuffix7
} from "@ai-sdk/provider-utils";

// src/generate-text/extract-reasoning-content.ts
function extractReasoningContent(content) {
  const parts = content.filter(
    (content2) => content2.type === "reasoning"
  );
  return parts.length === 0 ? void 0 : parts.map((content2) => content2.text).join("\n");
}

// src/generate-text/extract-text-content.ts
function extractTextContent(content) {
  const parts = content.filter(
    (content2) => content2.type === "text"
  );
  if (parts.length === 0) {
    return void 0;
  }
  return parts.map((content2) => content2.text).join("");
}

// src/generate-object/output-strategy.ts
import {
  isJSONArray,
  isJSONObject,
  TypeValidationError as TypeValidationError4,
  UnsupportedFunctionalityError as UnsupportedFunctionalityError3
} from "@ai-sdk/provider";
import {
  asSchema as asSchema5,
  safeValidateTypes as safeValidateTypes5
} from "@ai-sdk/provider-utils";
var noSchemaOutputStrategy = {
  type: "no-schema",
  jsonSchema: async () => void 0,
  async validatePartialResult({ value, textDelta }) {
    return { success: true, value: { partial: value, textDelta } };
  },
  async validateFinalResult(value, context) {
    return value === void 0 ? {
      success: false,
      error: new NoObjectGeneratedError({
        message: "No object generated: response did not match schema.",
        text: context.text,
        response: context.response,
        usage: context.usage,
        finishReason: context.finishReason
      })
    } : { success: true, value };
  },
  createElementStream() {
    throw new UnsupportedFunctionalityError3({
      functionality: "element streams in no-schema mode"
    });
  }
};
var objectOutputStrategy = (schema) => ({
  type: "object",
  jsonSchema: async () => await schema.jsonSchema,
  async validatePartialResult({ value, textDelta }) {
    return {
      success: true,
      value: {
        // Note: currently no validation of partial results:
        partial: value,
        textDelta
      }
    };
  },
  async validateFinalResult(value) {
    return safeValidateTypes5({ value, schema });
  },
  createElementStream() {
    throw new UnsupportedFunctionalityError3({
      functionality: "element streams in object mode"
    });
  }
});
var arrayOutputStrategy = (schema) => {
  return {
    type: "array",
    // wrap in object that contains array of elements, since most LLMs will not
    // be able to generate an array directly:
    // possible future optimization: use arrays directly when model supports grammar-guided generation
    jsonSchema: async () => {
      const { $schema: _$schema, ...itemSchema } = await schema.jsonSchema;
      return {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          elements: { type: "array", items: itemSchema }
        },
        required: ["elements"],
        additionalProperties: false
      };
    },
    async validatePartialResult({
      value,
      latestObject,
      isFirstDelta,
      isFinalDelta
    }) {
      var _a22;
      if (!isJSONObject(value) || !isJSONArray(value.elements)) {
        return {
          success: false,
          error: new TypeValidationError4({
            value,
            cause: "value must be an object that contains an array of elements"
          })
        };
      }
      const inputArray = value.elements;
      const resultArray = [];
      for (let i = 0; i < inputArray.length; i++) {
        const element = inputArray[i];
        const result = await safeValidateTypes5({ value: element, schema });
        if (i === inputArray.length - 1 && !isFinalDelta) {
          continue;
        }
        if (!result.success) {
          return result;
        }
        resultArray.push(result.value);
      }
      const publishedElementCount = (_a22 = latestObject == null ? void 0 : latestObject.length) != null ? _a22 : 0;
      let textDelta = "";
      if (isFirstDelta) {
        textDelta += "[";
      }
      if (publishedElementCount > 0) {
        textDelta += ",";
      }
      textDelta += resultArray.slice(publishedElementCount).map((element) => JSON.stringify(element)).join(",");
      if (isFinalDelta) {
        textDelta += "]";
      }
      return {
        success: true,
        value: {
          partial: resultArray,
          textDelta
        }
      };
    },
    async validateFinalResult(value) {
      if (!isJSONObject(value) || !isJSONArray(value.elements)) {
        return {
          success: false,
          error: new TypeValidationError4({
            value,
            cause: "value must be an object that contains an array of elements"
          })
        };
      }
      const inputArray = value.elements;
      const resultArray = [];
      for (const element of inputArray) {
        const result = await safeValidateTypes5({ value: element, schema });
        if (!result.success) {
          return result;
        }
        resultArray.push(result.value);
      }
      return { success: true, value: resultArray };
    },
    createElementStream(originalStream) {
      let publishedElements = 0;
      return createAsyncIterableStream(
        originalStream.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              switch (chunk.type) {
                case "object": {
                  const array2 = chunk.object;
                  for (; publishedElements < array2.length; publishedElements++) {
                    controller.enqueue(array2[publishedElements]);
                  }
                  break;
                }
                case "text-delta":
                case "finish":
                case "error":
                  break;
                default: {
                  const _exhaustiveCheck = chunk;
                  throw new Error(
                    `Unsupported chunk type: ${_exhaustiveCheck}`
                  );
                }
              }
            }
          })
        )
      );
    }
  };
};
var enumOutputStrategy = (enumValues) => {
  return {
    type: "enum",
    // wrap in object that contains result, since most LLMs will not
    // be able to generate an enum value directly:
    // possible future optimization: use enums directly when model supports top-level enums
    jsonSchema: async () => ({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        result: { type: "string", enum: enumValues }
      },
      required: ["result"],
      additionalProperties: false
    }),
    async validateFinalResult(value) {
      if (!isJSONObject(value) || typeof value.result !== "string") {
        return {
          success: false,
          error: new TypeValidationError4({
            value,
            cause: 'value must be an object that contains a string in the "result" property.'
          })
        };
      }
      const result = value.result;
      return enumValues.includes(result) ? { success: true, value: result } : {
        success: false,
        error: new TypeValidationError4({
          value,
          cause: "value must be a string in the enum"
        })
      };
    },
    async validatePartialResult({ value, textDelta }) {
      if (!isJSONObject(value) || typeof value.result !== "string") {
        return {
          success: false,
          error: new TypeValidationError4({
            value,
            cause: 'value must be an object that contains a string in the "result" property.'
          })
        };
      }
      const result = value.result;
      const possibleEnumValues = enumValues.filter(
        (enumValue) => enumValue.startsWith(result)
      );
      if (value.result.length === 0 || possibleEnumValues.length === 0) {
        return {
          success: false,
          error: new TypeValidationError4({
            value,
            cause: "value must be a string in the enum"
          })
        };
      }
      return {
        success: true,
        value: {
          partial: possibleEnumValues.length > 1 ? result : possibleEnumValues[0],
          textDelta
        }
      };
    },
    createElementStream() {
      throw new UnsupportedFunctionalityError3({
        functionality: "element streams in enum mode"
      });
    }
  };
};
function getOutputStrategy({
  output,
  schema,
  enumValues
}) {
  switch (output) {
    case "object":
      return objectOutputStrategy(asSchema5(schema));
    case "array":
      return arrayOutputStrategy(asSchema5(schema));
    case "enum":
      return enumOutputStrategy(enumValues);
    case "no-schema":
      return noSchemaOutputStrategy;
    default: {
      const _exhaustiveCheck = output;
      throw new Error(`Unsupported output: ${_exhaustiveCheck}`);
    }
  }
}

// src/generate-object/parse-and-validate-object-result.ts
import { JSONParseError as JSONParseError2, TypeValidationError as TypeValidationError5 } from "@ai-sdk/provider";
import { safeParseJSON as safeParseJSON4 } from "@ai-sdk/provider-utils";
async function parseAndValidateObjectResult(result, outputStrategy, context) {
  const parseResult = await safeParseJSON4({ text: result });
  if (!parseResult.success) {
    throw new NoObjectGeneratedError({
      message: "No object generated: could not parse the response.",
      cause: parseResult.error,
      text: result,
      response: context.response,
      usage: context.usage,
      finishReason: context.finishReason
    });
  }
  const validationResult = await outputStrategy.validateFinalResult(
    parseResult.value,
    {
      text: result,
      response: context.response,
      usage: context.usage
    }
  );
  if (!validationResult.success) {
    throw new NoObjectGeneratedError({
      message: "No object generated: response did not match schema.",
      cause: validationResult.error,
      text: result,
      response: context.response,
      usage: context.usage,
      finishReason: context.finishReason
    });
  }
  return validationResult.value;
}
async function parseAndValidateObjectResultWithRepair(result, outputStrategy, repairText, context) {
  try {
    return await parseAndValidateObjectResult(result, outputStrategy, context);
  } catch (error) {
    if (repairText != null && NoObjectGeneratedError.isInstance(error) && (JSONParseError2.isInstance(error.cause) || TypeValidationError5.isInstance(error.cause))) {
      const repairedText = await repairText({
        text: result,
        error: error.cause
      });
      if (repairedText === null) {
        throw error;
      }
      return await parseAndValidateObjectResult(
        repairedText,
        outputStrategy,
        context
      );
    }
    throw error;
  }
}

// src/generate-object/validate-object-generation-input.ts
function validateObjectGenerationInput({
  output,
  schema,
  schemaName,
  schemaDescription,
  enumValues
}) {
  if (output != null && output !== "object" && output !== "array" && output !== "enum" && output !== "no-schema") {
    throw new InvalidArgumentError({
      parameter: "output",
      value: output,
      message: "Invalid output type."
    });
  }
  if (output === "no-schema") {
    if (schema != null) {
      throw new InvalidArgumentError({
        parameter: "schema",
        value: schema,
        message: "Schema is not supported for no-schema output."
      });
    }
    if (schemaDescription != null) {
      throw new InvalidArgumentError({
        parameter: "schemaDescription",
        value: schemaDescription,
        message: "Schema description is not supported for no-schema output."
      });
    }
    if (schemaName != null) {
      throw new InvalidArgumentError({
        parameter: "schemaName",
        value: schemaName,
        message: "Schema name is not supported for no-schema output."
      });
    }
    if (enumValues != null) {
      throw new InvalidArgumentError({
        parameter: "enumValues",
        value: enumValues,
        message: "Enum values are not supported for no-schema output."
      });
    }
  }
  if (output === "object") {
    if (schema == null) {
      throw new InvalidArgumentError({
        parameter: "schema",
        value: schema,
        message: "Schema is required for object output."
      });
    }
    if (enumValues != null) {
      throw new InvalidArgumentError({
        parameter: "enumValues",
        value: enumValues,
        message: "Enum values are not supported for object output."
      });
    }
  }
  if (output === "array") {
    if (schema == null) {
      throw new InvalidArgumentError({
        parameter: "schema",
        value: schema,
        message: "Element schema is required for array output."
      });
    }
    if (enumValues != null) {
      throw new InvalidArgumentError({
        parameter: "enumValues",
        value: enumValues,
        message: "Enum values are not supported for array output."
      });
    }
  }
  if (output === "enum") {
    if (schema != null) {
      throw new InvalidArgumentError({
        parameter: "schema",
        value: schema,
        message: "Schema is not supported for enum output."
      });
    }
    if (schemaDescription != null) {
      throw new InvalidArgumentError({
        parameter: "schemaDescription",
        value: schemaDescription,
        message: "Schema description is not supported for enum output."
      });
    }
    if (schemaName != null) {
      throw new InvalidArgumentError({
        parameter: "schemaName",
        value: schemaName,
        message: "Schema name is not supported for enum output."
      });
    }
    if (enumValues == null) {
      throw new InvalidArgumentError({
        parameter: "enumValues",
        value: enumValues,
        message: "Enum values are required for enum output."
      });
    }
    for (const value of enumValues) {
      if (typeof value !== "string") {
        throw new InvalidArgumentError({
          parameter: "enumValues",
          value,
          message: "Enum values must be strings."
        });
      }
    }
  }
}

// src/generate-object/generate-object.ts
var originalGenerateId4 = createIdGenerator6({ prefix: "aiobj", size: 24 });
async function generateObject(options) {
  var _a22, _b, _c, _d, _e, _f, _g, _h, _i, _j;
  const {
    model: modelArg,
    output = "object",
    instructions,
    system,
    prompt,
    messages,
    allowSystemInMessages,
    maxRetries: maxRetriesArg,
    abortSignal,
    headers,
    experimental_repairText: repairText,
    experimental_telemetry,
    telemetry = experimental_telemetry,
    experimental_download: download2,
    providerOptions,
    onStart,
    experimental_onStart,
    onStepStart,
    experimental_onStepStart,
    onStepEnd,
    onStepFinish,
    onFinish,
    _internal: {
      generateId: generateId2 = originalGenerateId4,
      currentDate = () => /* @__PURE__ */ new Date()
    } = {},
    ...settings
  } = options;
  const model = resolveLanguageModel(modelArg);
  const enumValues = "enum" in options ? options.enum : void 0;
  const {
    schema: inputSchema,
    schemaDescription,
    schemaName
  } = "schema" in options ? options : {};
  validateObjectGenerationInput({
    output,
    schema: inputSchema,
    schemaName,
    schemaDescription,
    enumValues
  });
  const { maxRetries, retry } = prepareRetries({
    maxRetries: maxRetriesArg,
    abortSignal
  });
  const outputStrategy = getOutputStrategy({
    output,
    schema: inputSchema,
    enumValues
  });
  const callSettings = prepareLanguageModelCallOptions(settings);
  const headersWithUserAgent = withUserAgentSuffix7(
    headers != null ? headers : {},
    `ai/${VERSION}`
  );
  const telemetryDispatcher = createTelemetryDispatcher({
    telemetry
  });
  const resolvedOnStart = onStart != null ? onStart : experimental_onStart;
  const resolvedOnStepStart = onStepStart != null ? onStepStart : experimental_onStepStart;
  const resolvedOnStepEnd = onStepEnd != null ? onStepEnd : onStepFinish;
  const jsonSchema2 = await outputStrategy.jsonSchema();
  const callId = generateId2();
  await notify({
    event: {
      callId,
      operationId: "ai.generateObject",
      provider: model.provider,
      modelId: model.modelId,
      system: instructions != null ? instructions : system,
      prompt,
      messages,
      maxOutputTokens: callSettings.maxOutputTokens,
      temperature: callSettings.temperature,
      topP: callSettings.topP,
      topK: callSettings.topK,
      presencePenalty: callSettings.presencePenalty,
      frequencyPenalty: callSettings.frequencyPenalty,
      seed: callSettings.seed,
      maxRetries,
      headers: headersWithUserAgent,
      providerOptions,
      output: outputStrategy.type,
      schema: jsonSchema2,
      schemaName,
      schemaDescription
    },
    callbacks: [resolvedOnStart, telemetryDispatcher.onStart]
  });
  try {
    const standardizedPrompt = await standardizePrompt({
      instructions,
      system,
      prompt,
      messages,
      allowSystemInMessages
    });
    const promptMessages = await convertToLanguageModelPrompt({
      prompt: standardizedPrompt,
      supportedUrls: await model.supportedUrls,
      download: download2,
      provider: model.provider.split(".")[0]
    });
    await notify({
      event: {
        callId,
        stepNumber: 0,
        provider: model.provider,
        modelId: model.modelId,
        providerOptions,
        headers: headersWithUserAgent,
        promptMessages
      },
      callbacks: [resolvedOnStepStart, telemetryDispatcher.onObjectStepStart]
    });
    const generateResult = await retry(
      () => model.doGenerate({
        responseFormat: {
          type: "json",
          schema: jsonSchema2,
          name: schemaName,
          description: schemaDescription
        },
        ...prepareLanguageModelCallOptions(settings),
        prompt: promptMessages,
        providerOptions,
        abortSignal,
        headers: headersWithUserAgent
      })
    );
    const responseData = {
      id: (_b = (_a22 = generateResult.response) == null ? void 0 : _a22.id) != null ? _b : generateId2(),
      timestamp: (_d = (_c = generateResult.response) == null ? void 0 : _c.timestamp) != null ? _d : currentDate(),
      modelId: (_f = (_e = generateResult.response) == null ? void 0 : _e.modelId) != null ? _f : model.modelId,
      headers: (_g = generateResult.response) == null ? void 0 : _g.headers,
      body: (_h = generateResult.response) == null ? void 0 : _h.body
    };
    const text2 = extractTextContent(generateResult.content);
    const reasoning = extractReasoningContent(generateResult.content);
    if (text2 === void 0) {
      throw new NoObjectGeneratedError({
        message: "No object generated: the model did not return a response.",
        response: responseData,
        usage: asLanguageModelUsage(generateResult.usage),
        finishReason: generateResult.finishReason.unified
      });
    }
    const finishReason = generateResult.finishReason.unified;
    const usage = asLanguageModelUsage(generateResult.usage);
    const warnings = generateResult.warnings;
    const resultProviderMetadata = generateResult.providerMetadata;
    const request = (_i = generateResult.request) != null ? _i : {};
    const response = responseData;
    logWarnings({
      warnings,
      provider: model.provider,
      model: model.modelId
    });
    const stepFinishEvent = {
      callId,
      stepNumber: 0,
      provider: model.provider,
      modelId: model.modelId,
      finishReason,
      usage,
      objectText: text2,
      msToFirstChunk: void 0,
      reasoning,
      warnings,
      request,
      response,
      providerMetadata: resultProviderMetadata
    };
    await notify({
      event: stepFinishEvent,
      callbacks: [resolvedOnStepEnd, telemetryDispatcher.onObjectStepEnd]
    });
    const object2 = await parseAndValidateObjectResultWithRepair(
      text2,
      outputStrategy,
      repairText,
      {
        response,
        usage,
        finishReason
      }
    );
    await notify({
      event: {
        callId,
        object: object2,
        error: void 0,
        reasoning,
        finishReason,
        usage,
        warnings,
        request,
        response,
        providerMetadata: resultProviderMetadata
      },
      callbacks: [onFinish, telemetryDispatcher.onEnd]
    });
    return new DefaultGenerateObjectResult({
      object: object2,
      reasoning,
      finishReason,
      usage,
      warnings,
      request,
      response,
      providerMetadata: resultProviderMetadata
    });
  } catch (error) {
    await ((_j = telemetryDispatcher.onError) == null ? void 0 : _j.call(telemetryDispatcher, { callId, error }));
    throw wrapGatewayError(error);
  }
}
var DefaultGenerateObjectResult = class {
  constructor(options) {
    this.object = options.object;
    this.finishReason = options.finishReason;
    this.usage = options.usage;
    this.warnings = options.warnings;
    this.providerMetadata = options.providerMetadata;
    this.response = options.response;
    this.request = options.request;
    this.reasoning = options.reasoning;
  }
  toJsonResponse(init) {
    var _a22;
    return new Response(JSON.stringify(this.object), {
      status: (_a22 = init == null ? void 0 : init.status) != null ? _a22 : 200,
      headers: prepareHeaders(init == null ? void 0 : init.headers, {
        "content-type": "application/json; charset=utf-8"
      })
    });
  }
};

// src/generate-object/stream-object.ts
import {
  createIdGenerator as createIdGenerator7,
  DelayedPromise as DelayedPromise2
} from "@ai-sdk/provider-utils";

// src/util/cosine-similarity.ts
function cosineSimilarity(vector1, vector2) {
  if (vector1.length !== vector2.length) {
    throw new InvalidArgumentError({
      parameter: "vector1,vector2",
      value: { vector1Length: vector1.length, vector2Length: vector2.length },
      message: `Vectors must have the same length`
    });
  }
  const n = vector1.length;
  if (n === 0) {
    return 0;
  }
  let magnitudeSquared1 = 0;
  let magnitudeSquared2 = 0;
  let dotProduct = 0;
  for (let i = 0; i < n; i++) {
    const value1 = vector1[i];
    const value2 = vector2[i];
    magnitudeSquared1 += value1 * value1;
    magnitudeSquared2 += value2 * value2;
    dotProduct += value1 * value2;
  }
  return magnitudeSquared1 === 0 || magnitudeSquared2 === 0 ? 0 : dotProduct / (Math.sqrt(magnitudeSquared1) * Math.sqrt(magnitudeSquared2));
}

// src/util/download/create-download.ts
function createDownload(options) {
  return ({ url, abortSignal }) => download({ url, maxBytes: options == null ? void 0 : options.maxBytes, abortSignal });
}

// src/util/data-url.ts
function getTextFromDataUrl(dataUrl) {
  const [header, base64Content] = dataUrl.split(",");
  const mediaType = header.split(";")[0].split(":")[1];
  if (mediaType == null || base64Content == null) {
    throw new Error("Invalid data URL format");
  }
  try {
    return window.atob(base64Content);
  } catch (e) {
    throw new Error(`Error decoding data URL`);
  }
}

// src/util/is-deep-equal-data.ts
function isDeepEqualData(obj1, obj2) {
  if (obj1 === obj2)
    return true;
  if (obj1 == null || obj2 == null)
    return false;
  if (typeof obj1 !== "object" && typeof obj2 !== "object")
    return obj1 === obj2;
  if (obj1.constructor !== obj2.constructor)
    return false;
  if (obj1 instanceof Date && obj2 instanceof Date) {
    return obj1.getTime() === obj2.getTime();
  }
  if (Array.isArray(obj1)) {
    if (obj1.length !== obj2.length)
      return false;
    for (let i = 0; i < obj1.length; i++) {
      if (!isDeepEqualData(obj1[i], obj2[i]))
        return false;
    }
    return true;
  }
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  if (keys1.length !== keys2.length)
    return false;
  for (const key of keys1) {
    if (!keys2.includes(key))
      return false;
    if (!isDeepEqualData(obj1[key], obj2[key]))
      return false;
  }
  return true;
}

// src/util/serial-job-executor.ts
var SerialJobExecutor = class {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }
  async processQueue() {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;
    while (this.queue.length > 0) {
      await this.queue[0]();
      this.queue.shift();
    }
    this.isProcessing = false;
  }
  async run(job) {
    return new Promise((resolve3, reject) => {
      this.queue.push(async () => {
        try {
          await job();
          resolve3();
        } catch (error) {
          reject(error);
        }
      });
      void this.processQueue();
    });
  }
};

// src/util/simulate-readable-stream.ts
import { delay as delayFunction } from "@ai-sdk/provider-utils";
function simulateReadableStream({
  chunks,
  initialDelayInMs = 0,
  chunkDelayInMs = 0,
  _internal
}) {
  var _a22;
  const delay = (_a22 = _internal == null ? void 0 : _internal.delay) != null ? _a22 : delayFunction;
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index < chunks.length) {
        await delay(index === 0 ? initialDelayInMs : chunkDelayInMs);
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    }
  });
}

// src/generate-object/stream-object.ts
var originalGenerateId5 = createIdGenerator7({ prefix: "aiobj", size: 24 });
function streamObject(options) {
  const {
    model,
    output = "object",
    instructions,
    system,
    prompt,
    messages,
    allowSystemInMessages,
    maxRetries,
    abortSignal,
    headers,
    experimental_repairText: repairText,
    experimental_telemetry,
    telemetry = experimental_telemetry,
    experimental_download: download2,
    providerOptions,
    onStart,
    experimental_onStart,
    onStepStart,
    experimental_onStepStart,
    onStepEnd,
    onStepFinish,
    onError = ({ error }) => {
      console.error(error);
    },
    onFinish,
    _internal: {
      generateId: generateId2 = originalGenerateId5,
      currentDate = () => /* @__PURE__ */ new Date(),
      now: now2 = now
    } = {},
    ...settings
  } = options;
  const enumValues = "enum" in options && options.enum ? options.enum : void 0;
  const {
    schema: inputSchema,
    schemaDescription,
    schemaName
  } = "schema" in options ? options : {};
  validateObjectGenerationInput({
    output,
    schema: inputSchema,
    schemaName,
    schemaDescription,
    enumValues
  });
  const outputStrategy = getOutputStrategy({
    output,
    schema: inputSchema,
    enumValues
  });
  return new DefaultStreamObjectResult({
    model,
    telemetry,
    headers,
    settings,
    maxRetries,
    abortSignal,
    outputStrategy,
    instructions,
    system,
    prompt,
    messages,
    allowSystemInMessages,
    schemaName,
    schemaDescription,
    providerOptions,
    repairText,
    onStart: onStart != null ? onStart : experimental_onStart,
    onStepStart: onStepStart != null ? onStepStart : experimental_onStepStart,
    onStepFinish: onStepEnd != null ? onStepEnd : onStepFinish,
    onError,
    onFinish,
    download: download2,
    generateId: generateId2,
    currentDate,
    now: now2
  });
}
var DefaultStreamObjectResult = class {
  constructor({
    model: modelArg,
    headers,
    telemetry,
    settings,
    maxRetries: maxRetriesArg,
    abortSignal,
    outputStrategy,
    instructions,
    system,
    prompt,
    messages,
    allowSystemInMessages,
    schemaName,
    schemaDescription,
    providerOptions,
    repairText,
    onStart,
    onStepStart,
    onStepFinish,
    onError,
    onFinish,
    download: download2,
    generateId: generateId2,
    currentDate,
    now: now2
  }) {
    this._object = new DelayedPromise2();
    this._usage = new DelayedPromise2();
    this._providerMetadata = new DelayedPromise2();
    this._warnings = new DelayedPromise2();
    this._request = new DelayedPromise2();
    this._response = new DelayedPromise2();
    this._finishReason = new DelayedPromise2();
    const model = resolveLanguageModel(modelArg);
    const { maxRetries, retry } = prepareRetries({
      maxRetries: maxRetriesArg,
      abortSignal
    });
    const callSettings = prepareLanguageModelCallOptions(settings);
    const telemetryDispatcher = createTelemetryDispatcher({
      telemetry
    });
    const self = this;
    const stitchableStream = createStitchableStream();
    const eventProcessor = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        if (chunk.type === "error") {
          onError({ error: wrapGatewayError(chunk.error) });
        }
      }
    });
    this.baseStream = stitchableStream.stream.pipeThrough(eventProcessor);
    const callId = generateId2();
    (async () => {
      const jsonSchema2 = await outputStrategy.jsonSchema();
      await notify({
        event: {
          callId,
          operationId: "ai.streamObject",
          provider: model.provider,
          modelId: model.modelId,
          system: instructions != null ? instructions : system,
          prompt,
          messages,
          maxOutputTokens: callSettings.maxOutputTokens,
          temperature: callSettings.temperature,
          topP: callSettings.topP,
          topK: callSettings.topK,
          presencePenalty: callSettings.presencePenalty,
          frequencyPenalty: callSettings.frequencyPenalty,
          seed: callSettings.seed,
          maxRetries,
          headers,
          providerOptions,
          output: outputStrategy.type,
          schema: jsonSchema2,
          schemaName,
          schemaDescription
        },
        callbacks: [onStart, telemetryDispatcher.onStart]
      });
      const standardizedPrompt = await standardizePrompt({
        instructions,
        system,
        prompt,
        messages,
        allowSystemInMessages
      });
      const callOptions = {
        responseFormat: {
          type: "json",
          schema: jsonSchema2,
          name: schemaName,
          description: schemaDescription
        },
        ...prepareLanguageModelCallOptions(settings),
        prompt: await convertToLanguageModelPrompt({
          prompt: standardizedPrompt,
          supportedUrls: await model.supportedUrls,
          download: download2,
          provider: model.provider.split(".")[0]
        }),
        providerOptions,
        abortSignal,
        headers,
        includeRawChunks: false
      };
      await notify({
        event: {
          callId,
          stepNumber: 0,
          provider: model.provider,
          modelId: model.modelId,
          providerOptions,
          headers,
          promptMessages: callOptions.prompt
        },
        callbacks: [onStepStart, telemetryDispatcher.onObjectStepStart]
      });
      const transformer = {
        transform: (chunk, controller) => {
          switch (chunk.type) {
            case "text-delta":
              controller.enqueue(chunk.delta);
              break;
            case "response-metadata":
            case "finish":
            case "error":
            case "stream-start":
              controller.enqueue(chunk);
              break;
          }
        }
      };
      const startTimestampMs = now2();
      const { stream, response, request } = await retry(
        () => model.doStream(callOptions)
      );
      self._request.resolve(request != null ? request : {});
      let warnings;
      let usage = createNullLanguageModelUsage();
      let finishReason;
      let providerMetadata;
      let object2;
      let error;
      let msToFirstChunk = void 0;
      let accumulatedText = "";
      let textDelta = "";
      let fullResponse = {
        id: generateId2(),
        timestamp: currentDate(),
        modelId: model.modelId
      };
      let latestObjectJson = void 0;
      let latestObject = void 0;
      let isFirstChunk = true;
      let isFirstDelta = true;
      const transformedStream = stream.pipeThrough(new TransformStream(transformer)).pipeThrough(
        new TransformStream({
          async transform(chunk, controller) {
            var _a22, _b, _c;
            if (typeof chunk === "object" && chunk.type === "stream-start") {
              warnings = chunk.warnings;
              return;
            }
            if (isFirstChunk) {
              msToFirstChunk = now2() - startTimestampMs;
              isFirstChunk = false;
            }
            if (typeof chunk === "string") {
              accumulatedText += chunk;
              textDelta += chunk;
              const { value: currentObjectJson, state: parseState } = await parsePartialJson(accumulatedText);
              if (currentObjectJson !== void 0 && !isDeepEqualData(latestObjectJson, currentObjectJson)) {
                const validationResult = await outputStrategy.validatePartialResult({
                  value: currentObjectJson,
                  textDelta,
                  latestObject,
                  isFirstDelta,
                  isFinalDelta: parseState === "successful-parse"
                });
                if (validationResult.success && !isDeepEqualData(
                  latestObject,
                  validationResult.value.partial
                )) {
                  latestObjectJson = currentObjectJson;
                  latestObject = validationResult.value.partial;
                  controller.enqueue({
                    type: "object",
                    object: latestObject
                  });
                  controller.enqueue({
                    type: "text-delta",
                    textDelta: validationResult.value.textDelta
                  });
                  textDelta = "";
                  isFirstDelta = false;
                }
              }
              return;
            }
            switch (chunk.type) {
              case "response-metadata": {
                fullResponse = {
                  id: (_a22 = chunk.id) != null ? _a22 : fullResponse.id,
                  timestamp: (_b = chunk.timestamp) != null ? _b : fullResponse.timestamp,
                  modelId: (_c = chunk.modelId) != null ? _c : fullResponse.modelId
                };
                break;
              }
              case "finish": {
                if (textDelta !== "") {
                  controller.enqueue({ type: "text-delta", textDelta });
                }
                finishReason = chunk.finishReason.unified;
                usage = asLanguageModelUsage(chunk.usage);
                providerMetadata = chunk.providerMetadata;
                controller.enqueue({
                  ...chunk,
                  finishReason: chunk.finishReason.unified,
                  usage,
                  response: fullResponse
                });
                logWarnings({
                  warnings: warnings != null ? warnings : [],
                  provider: model.provider,
                  model: model.modelId
                });
                self._usage.resolve(usage);
                self._providerMetadata.resolve(providerMetadata);
                self._warnings.resolve(warnings);
                self._response.resolve({
                  ...fullResponse,
                  headers: response == null ? void 0 : response.headers
                });
                self._finishReason.resolve(finishReason != null ? finishReason : "other");
                try {
                  object2 = await parseAndValidateObjectResultWithRepair(
                    accumulatedText,
                    outputStrategy,
                    repairText,
                    {
                      response: fullResponse,
                      usage,
                      finishReason
                    }
                  );
                  self._object.resolve(object2);
                } catch (e) {
                  error = e;
                  self._object.reject(e);
                }
                break;
              }
              default: {
                controller.enqueue(chunk);
                break;
              }
            }
          },
          async flush(controller) {
            try {
              const finalUsage = usage != null ? usage : {
                promptTokens: NaN,
                completionTokens: NaN,
                totalTokens: NaN
              };
              await notify({
                event: {
                  callId,
                  stepNumber: 0,
                  provider: model.provider,
                  modelId: model.modelId,
                  finishReason: finishReason != null ? finishReason : "other",
                  usage: finalUsage,
                  objectText: accumulatedText,
                  msToFirstChunk,
                  reasoning: void 0,
                  warnings,
                  request: request != null ? request : {},
                  response: {
                    ...fullResponse,
                    headers: response == null ? void 0 : response.headers
                  },
                  providerMetadata
                },
                callbacks: [
                  onStepFinish,
                  telemetryDispatcher.onObjectStepEnd
                ]
              });
              await notify({
                event: {
                  callId,
                  object: object2,
                  error,
                  reasoning: void 0,
                  finishReason: finishReason != null ? finishReason : "other",
                  usage: finalUsage,
                  warnings,
                  request: request != null ? request : {},
                  response: {
                    ...fullResponse,
                    headers: response == null ? void 0 : response.headers
                  },
                  providerMetadata
                },
                callbacks: [onFinish, telemetryDispatcher.onEnd]
              });
            } catch (error2) {
              controller.enqueue({ type: "error", error: error2 });
            }
          }
        })
      );
      stitchableStream.addStream(transformedStream);
    })().catch(async (error) => {
      var _a22;
      await ((_a22 = telemetryDispatcher.onError) == null ? void 0 : _a22.call(telemetryDispatcher, { callId, error }));
      stitchableStream.addStream(
        new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "error", error });
            controller.close();
          }
        })
      );
    }).finally(() => {
      stitchableStream.close();
    });
    this.outputStrategy = outputStrategy;
  }
  get object() {
    return this._object.promise;
  }
  get usage() {
    return this._usage.promise;
  }
  get providerMetadata() {
    return this._providerMetadata.promise;
  }
  get warnings() {
    return this._warnings.promise;
  }
  get request() {
    return this._request.promise;
  }
  get response() {
    return this._response.promise;
  }
  get finishReason() {
    return this._finishReason.promise;
  }
  get partialObjectStream() {
    return createAsyncIterableStream(
      this.baseStream.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            switch (chunk.type) {
              case "object":
                controller.enqueue(chunk.object);
                break;
              case "text-delta":
              case "finish":
              case "error":
                break;
              default: {
                const _exhaustiveCheck = chunk;
                throw new Error(`Unsupported chunk type: ${_exhaustiveCheck}`);
              }
            }
          }
        })
      )
    );
  }
  get elementStream() {
    return this.outputStrategy.createElementStream(this.baseStream);
  }
  get textStream() {
    return createAsyncIterableStream(
      this.baseStream.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            switch (chunk.type) {
              case "text-delta":
                controller.enqueue(chunk.textDelta);
                break;
              case "object":
              case "finish":
              case "error":
                break;
              default: {
                const _exhaustiveCheck = chunk;
                throw new Error(`Unsupported chunk type: ${_exhaustiveCheck}`);
              }
            }
          }
        })
      )
    );
  }
  get fullStream() {
    return createAsyncIterableStream(this.baseStream);
  }
  pipeTextStreamToResponse(response, init) {
    return pipeTextStreamToResponse({
      response,
      stream: this.textStream,
      ...init
    });
  }
  toTextStreamResponse(init) {
    return createTextStreamResponse({
      stream: this.textStream,
      ...init
    });
  }
};

// src/generate-speech/generate-speech.ts
import {
  detectMediaType as detectMediaType3,
  withUserAgentSuffix as withUserAgentSuffix8
} from "@ai-sdk/provider-utils";

// src/generate-speech/generated-audio-file.ts
var DefaultGeneratedAudioFile = class extends DefaultGeneratedFile {
  constructor({
    data,
    mediaType
  }) {
    super({ data, mediaType });
    let format = "mp3";
    if (mediaType) {
      const mediaTypeParts = mediaType.split("/");
      if (mediaTypeParts.length === 2) {
        if (mediaType !== "audio/mpeg") {
          format = mediaTypeParts[1];
        }
      }
    }
    if (!format) {
      throw new Error(
        "Audio format must be provided or determinable from media type"
      );
    }
    this.format = format;
  }
};

// src/generate-speech/generate-speech.ts
async function generateSpeech({
  model,
  text: text2,
  voice,
  outputFormat,
  instructions,
  speed,
  language,
  providerOptions = {},
  maxRetries: maxRetriesArg,
  abortSignal,
  headers
}) {
  var _a22;
  const resolvedModel = resolveSpeechModel(model);
  if (!resolvedModel) {
    throw new Error("Model could not be resolved");
  }
  const headersWithUserAgent = withUserAgentSuffix8(
    headers != null ? headers : {},
    `ai/${VERSION}`
  );
  const { retry } = prepareRetries({
    maxRetries: maxRetriesArg,
    abortSignal
  });
  const result = await retry(
    () => resolvedModel.doGenerate({
      text: text2,
      voice,
      outputFormat,
      instructions,
      speed,
      language,
      abortSignal,
      headers: headersWithUserAgent,
      providerOptions
    })
  );
  if (!result.audio || result.audio.length === 0) {
    throw new NoSpeechGeneratedError({ responses: [result.response] });
  }
  logWarnings({
    warnings: result.warnings,
    provider: resolvedModel.provider,
    model: resolvedModel.modelId
  });
  return new DefaultSpeechResult({
    audio: new DefaultGeneratedAudioFile({
      data: result.audio,
      mediaType: (_a22 = detectMediaType3({
        data: result.audio,
        topLevelType: "audio"
      })) != null ? _a22 : "audio/mp3"
    }),
    warnings: result.warnings,
    responses: [result.response],
    providerMetadata: result.providerMetadata
  });
}
var DefaultSpeechResult = class {
  constructor(options) {
    var _a22;
    this.audio = options.audio;
    this.warnings = options.warnings;
    this.responses = options.responses;
    this.providerMetadata = (_a22 = options.providerMetadata) != null ? _a22 : {};
  }
};

// src/generate-speech/index.ts
var experimental_generateSpeech = generateSpeech;

// src/generate-text/prune-messages.ts
function pruneMessages({
  messages,
  reasoning = "none",
  toolCalls = [],
  emptyMessages = "remove"
}) {
  if (reasoning === "all" || reasoning === "before-last-message") {
    messages = messages.map((message, messageIndex) => {
      if (message.role !== "assistant" || typeof message.content === "string" || reasoning === "before-last-message" && messageIndex === messages.length - 1) {
        return message;
      }
      return {
        ...message,
        content: message.content.filter((part) => part.type !== "reasoning")
      };
    });
  }
  if (toolCalls === "none") {
    toolCalls = [];
  } else if (toolCalls === "all") {
    toolCalls = [{ type: "all" }];
  } else if (toolCalls === "before-last-message") {
    toolCalls = [{ type: "before-last-message" }];
  } else if (typeof toolCalls === "string") {
    toolCalls = [{ type: toolCalls }];
  }
  for (const toolCall of toolCalls) {
    const keepLastMessagesCount = toolCall.type === "all" ? void 0 : toolCall.type === "before-last-message" ? 1 : Number(
      toolCall.type.slice("before-last-".length).slice(0, -"-messages".length)
    );
    const keptToolCallIds = /* @__PURE__ */ new Set();
    const keptApprovalIds = /* @__PURE__ */ new Set();
    if (keepLastMessagesCount != null) {
      for (const message of messages.slice(-keepLastMessagesCount)) {
        if ((message.role === "assistant" || message.role === "tool") && typeof message.content !== "string") {
          for (const part of message.content) {
            if (part.type === "tool-call" || part.type === "tool-result") {
              keptToolCallIds.add(part.toolCallId);
            } else if (part.type === "tool-approval-request" || part.type === "tool-approval-response") {
              keptApprovalIds.add(part.approvalId);
            }
          }
        }
      }
    }
    const toolCallIdToToolName = /* @__PURE__ */ new Map();
    for (const message of messages) {
      if ((message.role === "assistant" || message.role === "tool") && typeof message.content !== "string") {
        for (const part of message.content) {
          if (part.type === "tool-call" || part.type === "tool-result") {
            toolCallIdToToolName.set(part.toolCallId, part.toolName);
          }
        }
      }
    }
    const approvalIdToToolName = /* @__PURE__ */ new Map();
    for (const message of messages) {
      if ((message.role === "assistant" || message.role === "tool") && typeof message.content !== "string") {
        for (const part of message.content) {
          if (part.type === "tool-approval-request") {
            const toolName = toolCallIdToToolName.get(part.toolCallId);
            if (toolName != null) {
              approvalIdToToolName.set(part.approvalId, toolName);
            }
          }
        }
      }
    }
    messages = messages.map((message, messageIndex) => {
      if (message.role !== "assistant" && message.role !== "tool" || typeof message.content === "string" || keepLastMessagesCount && messageIndex >= messages.length - keepLastMessagesCount) {
        return message;
      }
      return {
        ...message,
        content: message.content.filter((part) => {
          if (part.type !== "tool-call" && part.type !== "tool-result" && part.type !== "tool-approval-request" && part.type !== "tool-approval-response") {
            return true;
          }
          if ((part.type === "tool-call" || part.type === "tool-result") && keptToolCallIds.has(part.toolCallId) || (part.type === "tool-approval-request" || part.type === "tool-approval-response") && keptApprovalIds.has(part.approvalId)) {
            return true;
          }
          const partToolName = part.type === "tool-call" || part.type === "tool-result" ? part.toolName : approvalIdToToolName.get(part.approvalId);
          return toolCall.tools != null && partToolName != null && !toolCall.tools.includes(partToolName);
        })
      };
    });
  }
  if (emptyMessages === "remove") {
    messages = messages.filter((message) => message.content.length > 0);
  }
  return messages;
}

// src/generate-text/smooth-stream.ts
import { delay as originalDelay } from "@ai-sdk/provider-utils";
import {
  InvalidArgumentError as InvalidArgumentError2
} from "@ai-sdk/provider";
var CHUNKING_REGEXPS = {
  word: /\S+\s+/m,
  line: /\n+/m
};
function smoothStream({
  delayInMs = 10,
  chunking = "word",
  _internal: { delay = originalDelay } = {}
} = {}) {
  let detectChunk;
  if (chunking != null && typeof chunking === "object" && "segment" in chunking && typeof chunking.segment === "function") {
    const segmenter = chunking;
    detectChunk = (buffer) => {
      if (buffer.length === 0)
        return null;
      const iterator = segmenter.segment(buffer)[Symbol.iterator]();
      const first = iterator.next().value;
      return (first == null ? void 0 : first.segment) || null;
    };
  } else if (typeof chunking === "function") {
    detectChunk = (buffer) => {
      const match = chunking(buffer);
      if (match == null) {
        return null;
      }
      if (!match.length) {
        throw new Error(`Chunking function must return a non-empty string.`);
      }
      if (!buffer.startsWith(match)) {
        throw new Error(
          `Chunking function must return a match that is a prefix of the buffer. Received: "${match}" expected to start with "${buffer}"`
        );
      }
      return match;
    };
  } else {
    const chunkingRegex = typeof chunking === "string" ? CHUNKING_REGEXPS[chunking] : chunking instanceof RegExp ? chunking : void 0;
    if (chunkingRegex == null) {
      throw new InvalidArgumentError2({
        argument: "chunking",
        message: `Chunking must be "word", "line", a RegExp, an Intl.Segmenter, or a ChunkDetector function. Received: ${chunking}`
      });
    }
    detectChunk = (buffer) => {
      const match = chunkingRegex.exec(buffer);
      if (!match) {
        return null;
      }
      return buffer.slice(0, match.index) + (match == null ? void 0 : match[0]);
    };
  }
  return () => {
    let buffer = "";
    let id = "";
    let type = void 0;
    let providerMetadata = void 0;
    function flushBuffer(controller) {
      if (buffer.length > 0 && type !== void 0) {
        controller.enqueue({
          type,
          text: buffer,
          id,
          ...providerMetadata != null ? { providerMetadata } : {}
        });
        buffer = "";
        providerMetadata = void 0;
      }
    }
    return new TransformStream({
      async transform(chunk, controller) {
        if (chunk.type !== "text-delta" && chunk.type !== "reasoning-delta") {
          flushBuffer(controller);
          controller.enqueue(chunk);
          return;
        }
        if ((chunk.type !== type || chunk.id !== id) && buffer.length > 0) {
          flushBuffer(controller);
        }
        buffer += chunk.text;
        id = chunk.id;
        type = chunk.type;
        if (chunk.providerMetadata != null) {
          providerMetadata = chunk.providerMetadata;
        }
        let match;
        while ((match = detectChunk(buffer)) != null) {
          controller.enqueue({ type, text: match, id });
          buffer = buffer.slice(match.length);
          await delay(delayInMs);
        }
      }
    });
  };
}

// src/generate-text/tool-fingerprint.ts
import { asSchema as asSchema6 } from "@ai-sdk/provider-utils";
function tagDescription(description) {
  if (typeof description === "string") {
    return { type: "string", value: description };
  }
  if (description == null) {
    return { type: "none" };
  }
  return { type: "function" };
}
async function fingerprintTools(tools) {
  const entries = await Promise.all(
    Object.keys(tools).map(async (name22) => {
      const tool2 = tools[name22];
      const digest = await hashCanonical({
        description: tagDescription(tool2.description),
        inputSchema: await asSchema6(tool2.inputSchema).jsonSchema,
        title: tool2.title
      });
      return [name22, digest];
    })
  );
  return Object.fromEntries(entries);
}
function detectToolDrift(current, baseline) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const name22 of Object.keys(current)) {
    if (!Object.hasOwn(baseline, name22)) {
      added.push(name22);
    } else if (current[name22] !== baseline[name22]) {
      changed.push(name22);
    }
  }
  for (const name22 of Object.keys(baseline)) {
    if (!Object.hasOwn(current, name22)) {
      removed.push(name22);
    }
  }
  return { added, removed, changed };
}

// src/generate-video/generate-video.ts
import {
  convertBase64ToUint8Array as convertBase64ToUint8Array5,
  withUserAgentSuffix as withUserAgentSuffix9,
  detectMediaType as detectMediaType4
} from "@ai-sdk/provider-utils";
var defaultDownload = createDownload();
async function experimental_generateVideo({
  model: modelArg,
  prompt: promptArg,
  n = 1,
  maxVideosPerCall,
  aspectRatio,
  resolution,
  duration,
  fps,
  seed,
  frameImages,
  inputReferences,
  generateAudio,
  providerOptions,
  maxRetries: maxRetriesArg,
  abortSignal,
  headers,
  download: downloadFn = defaultDownload
}) {
  var _a22, _b;
  const model = resolveVideoModel(modelArg);
  const headersWithUserAgent = withUserAgentSuffix9(
    headers != null ? headers : {},
    `ai/${VERSION}`
  );
  const { retry } = prepareRetries({
    maxRetries: maxRetriesArg,
    abortSignal
  });
  const { prompt, image } = normalizePrompt2(promptArg);
  const normalizedFrameImages = frameImages == null ? void 0 : frameImages.flatMap((frame) => {
    const normalizedImage = normalizeImageData(frame.image);
    return normalizedImage != null ? [{ image: normalizedImage, frameType: frame.frameType }] : [];
  });
  const normalizedInputReferences = inputReferences == null ? void 0 : inputReferences.flatMap((reference) => {
    const normalized = normalizeReferenceData(reference);
    return normalized != null ? [normalized] : [];
  });
  const effectiveInputReferences = normalizedFrameImages != null && normalizedFrameImages.length > 0 ? void 0 : normalizedInputReferences;
  const warnings = [];
  if (normalizedFrameImages != null && normalizedFrameImages.length > 0 && normalizedInputReferences != null && normalizedInputReferences.length > 0) {
    warnings.push({
      type: "other",
      message: "inputReferences were ignored because frameImages were provided; frameImages and inputReferences cannot be combined."
    });
  }
  const firstFrameImage = (_a22 = normalizedFrameImages == null ? void 0 : normalizedFrameImages.find(
    (frame) => frame.frameType === "first_frame"
  )) == null ? void 0 : _a22.image;
  if (image != null && firstFrameImage != null) {
    warnings.push({
      type: "other",
      message: "prompt.image was ignored because a first_frame frameImage was provided; the first_frame frameImage takes precedence as the start image."
    });
  }
  const resolvedImage = firstFrameImage != null ? firstFrameImage : image;
  const maxVideosPerCallWithDefault = (_b = maxVideosPerCall != null ? maxVideosPerCall : await invokeModelMaxVideosPerCall(model)) != null ? _b : 1;
  const callCount = Math.ceil(n / maxVideosPerCallWithDefault);
  const callVideoCounts = Array.from({ length: callCount }, (_, index) => {
    const remaining = n - index * maxVideosPerCallWithDefault;
    return Math.min(remaining, maxVideosPerCallWithDefault);
  });
  const results = await Promise.all(
    callVideoCounts.map(
      async (callVideoCount) => await retry(
        () => model.doGenerate({
          prompt,
          n: callVideoCount,
          aspectRatio,
          resolution,
          duration,
          fps,
          seed,
          image: resolvedImage,
          frameImages: normalizedFrameImages,
          inputReferences: effectiveInputReferences,
          generateAudio,
          providerOptions: providerOptions != null ? providerOptions : {},
          headers: headersWithUserAgent,
          abortSignal
        })
      )
    )
  );
  const videos = [];
  const responses = [];
  const providerMetadata = {};
  for (const result of results) {
    for (const videoData of result.videos) {
      switch (videoData.type) {
        case "url": {
          const { data, mediaType: downloadedMediaType } = await downloadFn({
            url: new URL(videoData.url),
            abortSignal
          });
          const isUsableMediaType = (type) => !!type && type !== "application/octet-stream";
          const mediaType = isUsableMediaType(videoData.mediaType) && videoData.mediaType || isUsableMediaType(downloadedMediaType) && downloadedMediaType || detectMediaType4({
            data,
            topLevelType: "video"
          }) || "video/mp4";
          videos.push(
            new DefaultGeneratedFile({
              data,
              mediaType
            })
          );
          break;
        }
        case "base64": {
          videos.push(
            new DefaultGeneratedFile({
              data: videoData.data,
              mediaType: videoData.mediaType || "video/mp4"
            })
          );
          break;
        }
        case "binary": {
          const mediaType = videoData.mediaType || detectMediaType4({
            data: videoData.data,
            topLevelType: "video"
          }) || "video/mp4";
          videos.push(
            new DefaultGeneratedFile({
              data: videoData.data,
              mediaType
            })
          );
          break;
        }
      }
    }
    warnings.push(...result.warnings);
    responses.push({
      timestamp: result.response.timestamp,
      modelId: result.response.modelId,
      headers: result.response.headers,
      providerMetadata: result.providerMetadata
    });
    if (result.providerMetadata != null) {
      for (const [providerName, metadata] of Object.entries(
        result.providerMetadata
      )) {
        const existingMetadata = providerMetadata[providerName];
        if (existingMetadata != null && typeof existingMetadata === "object") {
          providerMetadata[providerName] = {
            ...existingMetadata,
            ...metadata
          };
          if ("videos" in existingMetadata && Array.isArray(existingMetadata.videos) && "videos" in metadata && Array.isArray(metadata.videos)) {
            providerMetadata[providerName].videos = [
              ...existingMetadata.videos,
              ...metadata.videos
            ];
          }
        } else {
          providerMetadata[providerName] = metadata;
        }
      }
    }
  }
  if (videos.length === 0) {
    throw new NoVideoGeneratedError({ responses });
  }
  if (warnings.length > 0) {
    logWarnings({
      warnings,
      provider: model.provider,
      model: model.modelId
    });
  }
  return {
    video: videos[0],
    videos,
    warnings,
    responses,
    providerMetadata
  };
}
function normalizePrompt2(promptArg) {
  if (typeof promptArg === "string") {
    return {
      prompt: promptArg,
      image: void 0
    };
  }
  return {
    prompt: promptArg.text,
    image: promptArg.image != null ? normalizeImageData(promptArg.image) : void 0
  };
}
function detectFileMediaType(data, restrictToImages) {
  const detected = restrictToImages ? detectMediaType4({ data, topLevelType: "image" }) : detectMediaType4({ data });
  return detected != null ? detected : "image/png";
}
function normalizeImageData(dataContent, { restrictToImages = true } = {}) {
  if (typeof dataContent === "string") {
    if (dataContent.startsWith("http://") || dataContent.startsWith("https://")) {
      return {
        type: "url",
        url: dataContent
      };
    }
    if (dataContent.startsWith("data:")) {
      const { mediaType, base64Content } = splitDataUrl(dataContent);
      const data = convertBase64ToUint8Array5(base64Content != null ? base64Content : "");
      return {
        type: "file",
        mediaType: mediaType != null ? mediaType : detectFileMediaType(data, restrictToImages),
        data
      };
    }
    const bytes = convertBase64ToUint8Array5(dataContent);
    return {
      type: "file",
      mediaType: detectFileMediaType(bytes, restrictToImages),
      data: bytes
    };
  }
  if (dataContent instanceof Uint8Array || dataContent instanceof ArrayBuffer) {
    const bytes = dataContent instanceof Uint8Array ? dataContent : new Uint8Array(dataContent);
    return {
      type: "file",
      mediaType: detectFileMediaType(bytes, restrictToImages),
      data: bytes
    };
  }
  return void 0;
}
function normalizeReferenceData(reference) {
  const isObjectForm = typeof reference === "object" && reference != null && !(reference instanceof Uint8Array) && !(reference instanceof ArrayBuffer) && "data" in reference;
  if (!isObjectForm) {
    return normalizeImageData(reference, {
      restrictToImages: false
    });
  }
  const normalized = normalizeImageData(reference.data, {
    restrictToImages: false
  });
  if (normalized == null) {
    return normalized;
  }
  return {
    ...normalized,
    ...reference.mediaType != null ? { mediaType: reference.mediaType } : {}
  };
}
async function invokeModelMaxVideosPerCall(model) {
  if (typeof model.maxVideosPerCall === "function") {
    return await model.maxVideosPerCall({ modelId: model.modelId });
  }
  return model.maxVideosPerCall;
}

// src/middleware/default-embedding-settings-middleware.ts
function defaultEmbeddingSettingsMiddleware({
  settings
}) {
  return {
    specificationVersion: "v4",
    transformParams: async ({ params }) => {
      return mergeObjects(settings, params);
    }
  };
}

// src/middleware/default-settings-middleware.ts
function defaultSettingsMiddleware({
  settings
}) {
  return {
    specificationVersion: "v4",
    transformParams: async ({ params }) => {
      return mergeObjects(settings, params);
    }
  };
}

// src/middleware/extract-json-middleware.ts
function defaultTransform(text2) {
  return text2.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
}
function stripMarkdownCodeFenceSuffix(text2) {
  return text2.replace(/\n?```\s*$/, "").trimEnd();
}
function extractJsonMiddleware(options) {
  var _a22;
  const transform = (_a22 = options == null ? void 0 : options.transform) != null ? _a22 : defaultTransform;
  const hasCustomTransform = (options == null ? void 0 : options.transform) !== void 0;
  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate }) => {
      const { content, ...rest } = await doGenerate();
      const transformedContent = [];
      for (const part of content) {
        if (part.type !== "text") {
          transformedContent.push(part);
          continue;
        }
        transformedContent.push({
          ...part,
          text: transform(part.text)
        });
      }
      return { content: transformedContent, ...rest };
    },
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream();
      const textBlocks = createIdMap();
      const SUFFIX_BUFFER_SIZE = 12;
      return {
        stream: stream.pipeThrough(
          new TransformStream({
            transform: (chunk, controller) => {
              if (chunk.type === "text-start") {
                textBlocks[chunk.id] = {
                  startEvent: chunk,
                  // Custom transforms need to buffer all content
                  phase: hasCustomTransform ? "buffering" : "prefix",
                  buffer: "",
                  prefixStripped: false
                };
                return;
              }
              if (chunk.type === "text-delta") {
                const block = textBlocks[chunk.id];
                if (!block) {
                  controller.enqueue(chunk);
                  return;
                }
                block.buffer += chunk.delta;
                if (block.phase === "buffering") {
                  return;
                }
                if (block.phase === "prefix") {
                  if (block.buffer.length > 0 && !block.buffer.startsWith("`")) {
                    block.phase = "streaming";
                    controller.enqueue(block.startEvent);
                  } else if (block.buffer.startsWith("```")) {
                    if (block.buffer.includes("\n")) {
                      const prefixMatch = block.buffer.match(/^```(?:json)?\s*\n/);
                      if (prefixMatch) {
                        block.buffer = block.buffer.slice(
                          prefixMatch[0].length
                        );
                        block.prefixStripped = true;
                        block.phase = "streaming";
                        controller.enqueue(block.startEvent);
                      } else {
                        block.phase = "streaming";
                        controller.enqueue(block.startEvent);
                      }
                    }
                  } else if (block.buffer.length >= 3 && !block.buffer.startsWith("```")) {
                    block.phase = "streaming";
                    controller.enqueue(block.startEvent);
                  }
                }
                if (block.phase === "streaming" && block.buffer.length > SUFFIX_BUFFER_SIZE) {
                  const toStream = block.buffer.slice(0, -SUFFIX_BUFFER_SIZE);
                  block.buffer = block.buffer.slice(-SUFFIX_BUFFER_SIZE);
                  controller.enqueue({
                    type: "text-delta",
                    id: chunk.id,
                    delta: toStream
                  });
                }
                return;
              }
              if (chunk.type === "text-end") {
                const block = textBlocks[chunk.id];
                if (block) {
                  if (block.phase === "prefix" || block.phase === "buffering") {
                    controller.enqueue(block.startEvent);
                  }
                  let remaining = block.buffer;
                  if (block.phase === "buffering") {
                    remaining = transform(remaining);
                  } else if (block.prefixStripped) {
                    remaining = stripMarkdownCodeFenceSuffix(remaining);
                  } else if (block.phase === "prefix") {
                    remaining = transform(remaining);
                  } else {
                    remaining = stripMarkdownCodeFenceSuffix(remaining);
                  }
                  if (remaining.length > 0) {
                    controller.enqueue({
                      type: "text-delta",
                      id: chunk.id,
                      delta: remaining
                    });
                  }
                  controller.enqueue(chunk);
                  delete textBlocks[chunk.id];
                  return;
                }
              }
              controller.enqueue(chunk);
            }
          })
        ),
        ...rest
      };
    }
  };
}

// src/util/get-potential-start-index.ts
function getPotentialStartIndex(text2, searchedText) {
  if (searchedText.length === 0) {
    return null;
  }
  const directIndex = text2.indexOf(searchedText);
  if (directIndex !== -1) {
    return directIndex;
  }
  for (let i = text2.length - 1; i >= 0; i--) {
    const suffix = text2.substring(i);
    if (searchedText.startsWith(suffix)) {
      return i;
    }
  }
  return null;
}

// src/middleware/extract-reasoning-middleware.ts
function extractReasoningMiddleware({
  tagName,
  separator = "\n",
  startWithReasoning = false
}) {
  const openingTag = `<${tagName}>`;
  const closingTag = `</${tagName}>`;
  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate }) => {
      const { content, ...rest } = await doGenerate();
      const transformedContent = [];
      for (const part of content) {
        if (part.type !== "text") {
          transformedContent.push(part);
          continue;
        }
        const text2 = startWithReasoning ? openingTag + part.text : part.text;
        const regexp = new RegExp(`${openingTag}(.*?)${closingTag}`, "gs");
        const matches = Array.from(text2.matchAll(regexp));
        if (!matches.length) {
          transformedContent.push(part);
          continue;
        }
        const reasoningText = matches.map((match) => match[1]).join(separator);
        let textWithoutReasoning = text2;
        for (let i = matches.length - 1; i >= 0; i--) {
          const match = matches[i];
          const beforeMatch = textWithoutReasoning.slice(0, match.index);
          const afterMatch = textWithoutReasoning.slice(
            match.index + match[0].length
          );
          textWithoutReasoning = beforeMatch + (beforeMatch.length > 0 && afterMatch.length > 0 ? separator : "") + afterMatch;
        }
        transformedContent.push({
          type: "reasoning",
          text: reasoningText
        });
        transformedContent.push({
          type: "text",
          text: textWithoutReasoning
        });
      }
      return { content: transformedContent, ...rest };
    },
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream();
      const reasoningExtractions = createIdMap();
      let delayedTextStart;
      return {
        stream: stream.pipeThrough(
          new TransformStream({
            transform: (chunk, controller) => {
              if (chunk.type === "text-start") {
                delayedTextStart = chunk;
                return;
              }
              if (chunk.type === "text-end" && delayedTextStart) {
                controller.enqueue(delayedTextStart);
                delayedTextStart = void 0;
              }
              if (chunk.type !== "text-delta") {
                controller.enqueue(chunk);
                return;
              }
              if (reasoningExtractions[chunk.id] == null) {
                reasoningExtractions[chunk.id] = {
                  isFirstReasoning: true,
                  isFirstText: true,
                  afterSwitch: false,
                  isReasoning: startWithReasoning,
                  buffer: "",
                  idCounter: 0,
                  textId: chunk.id
                };
              }
              const activeExtraction = reasoningExtractions[chunk.id];
              activeExtraction.buffer += chunk.delta;
              function publish(text2) {
                if (text2.length > 0) {
                  const prefix = activeExtraction.afterSwitch && (activeExtraction.isReasoning ? !activeExtraction.isFirstReasoning : !activeExtraction.isFirstText) ? separator : "";
                  if (activeExtraction.isReasoning && (activeExtraction.afterSwitch || activeExtraction.isFirstReasoning)) {
                    controller.enqueue({
                      type: "reasoning-start",
                      id: `reasoning-${activeExtraction.idCounter}`
                    });
                  }
                  if (activeExtraction.isReasoning) {
                    controller.enqueue({
                      type: "reasoning-delta",
                      delta: prefix + text2,
                      id: `reasoning-${activeExtraction.idCounter}`
                    });
                  } else {
                    if (delayedTextStart) {
                      controller.enqueue(delayedTextStart);
                      delayedTextStart = void 0;
                    }
                    controller.enqueue({
                      type: "text-delta",
                      delta: prefix + text2,
                      id: activeExtraction.textId
                    });
                  }
                  activeExtraction.afterSwitch = false;
                  if (activeExtraction.isReasoning) {
                    activeExtraction.isFirstReasoning = false;
                  } else {
                    activeExtraction.isFirstText = false;
                  }
                }
              }
              do {
                const nextTag = activeExtraction.isReasoning ? closingTag : openingTag;
                const startIndex = getPotentialStartIndex(
                  activeExtraction.buffer,
                  nextTag
                );
                if (startIndex == null) {
                  publish(activeExtraction.buffer);
                  activeExtraction.buffer = "";
                  break;
                }
                publish(activeExtraction.buffer.slice(0, startIndex));
                const foundFullMatch = startIndex + nextTag.length <= activeExtraction.buffer.length;
                if (foundFullMatch) {
                  activeExtraction.buffer = activeExtraction.buffer.slice(
                    startIndex + nextTag.length
                  );
                  if (activeExtraction.isReasoning) {
                    if (activeExtraction.isFirstReasoning) {
                      controller.enqueue({
                        type: "reasoning-start",
                        id: `reasoning-${activeExtraction.idCounter}`
                      });
                    }
                    controller.enqueue({
                      type: "reasoning-end",
                      id: `reasoning-${activeExtraction.idCounter++}`
                    });
                  }
                  activeExtraction.isReasoning = !activeExtraction.isReasoning;
                  activeExtraction.afterSwitch = true;
                } else {
                  activeExtraction.buffer = activeExtraction.buffer.slice(startIndex);
                  break;
                }
              } while (true);
            }
          })
        ),
        ...rest
      };
    }
  };
}

// src/middleware/simulate-streaming-middleware.ts
function simulateStreamingMiddleware() {
  return {
    specificationVersion: "v4",
    wrapStream: async ({ doGenerate }) => {
      const result = await doGenerate();
      let id = 0;
      const simulatedStream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "stream-start",
            warnings: result.warnings
          });
          controller.enqueue({ type: "response-metadata", ...result.response });
          for (const part of result.content) {
            switch (part.type) {
              case "text": {
                if (part.text.length > 0) {
                  controller.enqueue({ type: "text-start", id: String(id) });
                  controller.enqueue({
                    type: "text-delta",
                    id: String(id),
                    delta: part.text
                  });
                  controller.enqueue({ type: "text-end", id: String(id) });
                  id++;
                }
                break;
              }
              case "reasoning": {
                controller.enqueue({
                  type: "reasoning-start",
                  id: String(id),
                  providerMetadata: part.providerMetadata
                });
                controller.enqueue({
                  type: "reasoning-delta",
                  id: String(id),
                  delta: part.text
                });
                controller.enqueue({ type: "reasoning-end", id: String(id) });
                id++;
                break;
              }
              default: {
                controller.enqueue(part);
                break;
              }
            }
          }
          controller.enqueue({
            type: "finish",
            finishReason: result.finishReason,
            usage: result.usage,
            providerMetadata: result.providerMetadata
          });
          controller.close();
        }
      });
      return {
        stream: simulatedStream,
        request: result.request,
        response: result.response
      };
    }
  };
}

// src/middleware/add-tool-input-examples-middleware.ts
function defaultFormatExample(example) {
  return JSON.stringify(example.input);
}
function addToolInputExamplesMiddleware({
  prefix = "Input Examples:",
  format = defaultFormatExample,
  remove = true
} = {}) {
  return {
    specificationVersion: "v4",
    transformParams: async ({ params }) => {
      var _a22;
      if (!((_a22 = params.tools) == null ? void 0 : _a22.length)) {
        return params;
      }
      const transformedTools = params.tools.map((tool2) => {
        var _a23;
        if (tool2.type !== "function" || !((_a23 = tool2.inputExamples) == null ? void 0 : _a23.length)) {
          return tool2;
        }
        const formattedExamples = tool2.inputExamples.map((example, index) => format(example, index)).join("\n");
        const examplesSection = `${prefix}
${formattedExamples}`;
        const toolDescription = tool2.description ? `${tool2.description}

${examplesSection}` : examplesSection;
        return {
          ...tool2,
          description: toolDescription,
          inputExamples: remove ? void 0 : tool2.inputExamples
        };
      });
      return {
        ...params,
        tools: transformedTools
      };
    }
  };
}

// src/middleware/wrap-language-model.ts
import { asArray as asArray7 } from "@ai-sdk/provider-utils";
var wrapLanguageModel = ({
  model: inputModel,
  middleware: middlewareArg,
  modelId,
  providerId
}) => {
  const model = asLanguageModelV4(inputModel);
  return [...asArray7(middlewareArg)].reverse().reduce((wrappedModel, middleware) => {
    return doWrap({ model: wrappedModel, middleware, modelId, providerId });
  }, model);
};
var doWrap = ({
  model,
  middleware: {
    transformParams,
    wrapGenerate,
    wrapStream,
    overrideProvider,
    overrideModelId,
    overrideSupportedUrls
  },
  modelId,
  providerId
}) => {
  var _a22, _b, _c;
  async function doTransform({
    params,
    type
  }) {
    return transformParams ? await transformParams({ params, type, model }) : params;
  }
  return {
    specificationVersion: "v4",
    provider: (_a22 = providerId != null ? providerId : overrideProvider == null ? void 0 : overrideProvider({ model })) != null ? _a22 : model.provider,
    modelId: (_b = modelId != null ? modelId : overrideModelId == null ? void 0 : overrideModelId({ model })) != null ? _b : model.modelId,
    supportedUrls: (_c = overrideSupportedUrls == null ? void 0 : overrideSupportedUrls({ model })) != null ? _c : model.supportedUrls,
    async doGenerate(params) {
      const transformedParams = await doTransform({ params, type: "generate" });
      const doGenerate = async () => await model.doGenerate(transformedParams);
      const doStream = async () => await model.doStream(transformedParams);
      return wrapGenerate ? await wrapGenerate({
        doGenerate,
        doStream,
        params: transformedParams,
        model
      }) : await doGenerate();
    },
    async doStream(params) {
      const transformedParams = await doTransform({ params, type: "stream" });
      const doGenerate = async () => await model.doGenerate(transformedParams);
      const doStream = async () => await model.doStream(transformedParams);
      return wrapStream ? await wrapStream({
        doGenerate,
        doStream,
        params: transformedParams,
        model
      }) : await doStream();
    }
  };
};

// src/middleware/wrap-embedding-model.ts
import { asArray as asArray8 } from "@ai-sdk/provider-utils";
var wrapEmbeddingModel = ({
  model: inputModel,
  middleware: middlewareArg,
  modelId,
  providerId
}) => {
  const model = asEmbeddingModelV4(inputModel);
  return [...asArray8(middlewareArg)].reverse().reduce((wrappedModel, middleware) => {
    return doWrap2({ model: wrappedModel, middleware, modelId, providerId });
  }, model);
};
var doWrap2 = ({
  model,
  middleware: {
    transformParams,
    wrapEmbed,
    overrideProvider,
    overrideModelId,
    overrideMaxEmbeddingsPerCall,
    overrideSupportsParallelCalls
  },
  modelId,
  providerId
}) => {
  var _a22, _b, _c, _d;
  async function doTransform({
    params
  }) {
    return transformParams ? await transformParams({ params, model }) : params;
  }
  return {
    specificationVersion: "v4",
    provider: (_a22 = providerId != null ? providerId : overrideProvider == null ? void 0 : overrideProvider({ model })) != null ? _a22 : model.provider,
    modelId: (_b = modelId != null ? modelId : overrideModelId == null ? void 0 : overrideModelId({ model })) != null ? _b : model.modelId,
    maxEmbeddingsPerCall: (_c = overrideMaxEmbeddingsPerCall == null ? void 0 : overrideMaxEmbeddingsPerCall({ model })) != null ? _c : model.maxEmbeddingsPerCall,
    supportsParallelCalls: (_d = overrideSupportsParallelCalls == null ? void 0 : overrideSupportsParallelCalls({ model })) != null ? _d : model.supportsParallelCalls,
    async doEmbed(params) {
      const transformedParams = await doTransform({ params });
      const doEmbed = async () => await model.doEmbed(transformedParams);
      return wrapEmbed ? await wrapEmbed({
        doEmbed,
        params: transformedParams,
        model
      }) : await doEmbed();
    }
  };
};

// src/middleware/wrap-image-model.ts
import { asArray as asArray9 } from "@ai-sdk/provider-utils";
var wrapImageModel = ({
  model: inputModel,
  middleware: middlewareArg,
  modelId,
  providerId
}) => {
  const model = asImageModelV4(inputModel);
  return [...asArray9(middlewareArg)].reverse().reduce((wrappedModel, middleware) => {
    return doWrap3({ model: wrappedModel, middleware, modelId, providerId });
  }, model);
};
var doWrap3 = ({
  model,
  middleware: {
    transformParams,
    wrapGenerate,
    overrideProvider,
    overrideModelId,
    overrideMaxImagesPerCall
  },
  modelId,
  providerId
}) => {
  var _a22, _b, _c;
  async function doTransform({ params }) {
    return transformParams ? await transformParams({ params, model }) : params;
  }
  const maxImagesPerCallRaw = (_a22 = overrideMaxImagesPerCall == null ? void 0 : overrideMaxImagesPerCall({ model })) != null ? _a22 : model.maxImagesPerCall;
  const maxImagesPerCall = maxImagesPerCallRaw instanceof Function ? maxImagesPerCallRaw.bind(model) : maxImagesPerCallRaw;
  return {
    specificationVersion: "v4",
    provider: (_b = providerId != null ? providerId : overrideProvider == null ? void 0 : overrideProvider({ model })) != null ? _b : model.provider,
    modelId: (_c = modelId != null ? modelId : overrideModelId == null ? void 0 : overrideModelId({ model })) != null ? _c : model.modelId,
    maxImagesPerCall,
    async doGenerate(params) {
      const transformedParams = await doTransform({ params });
      const doGenerate = async () => await model.doGenerate(transformedParams);
      return wrapGenerate ? await wrapGenerate({
        doGenerate,
        params: transformedParams,
        model
      }) : await doGenerate();
    }
  };
};

// src/middleware/wrap-provider.ts
function wrapProvider({
  provider,
  languageModelMiddleware,
  imageModelMiddleware
}) {
  const providerV4 = asProviderV4(provider);
  return {
    specificationVersion: "v4",
    languageModel: (modelId) => wrapLanguageModel({
      model: providerV4.languageModel(modelId),
      middleware: languageModelMiddleware
    }),
    embeddingModel: providerV4.embeddingModel,
    imageModel: (modelId) => {
      let model = providerV4.imageModel(modelId);
      if (imageModelMiddleware != null) {
        model = wrapImageModel({ model, middleware: imageModelMiddleware });
      }
      return model;
    },
    transcriptionModel: providerV4.transcriptionModel,
    speechModel: providerV4.speechModel,
    rerankingModel: providerV4.rerankingModel
  };
}

// src/realtime/audio-utils.ts
function encodeRealtimeAudio(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 32768 : s * 32767, true);
  }
  const bytes = new Uint8Array(buffer);
  const chunkSize = 32768;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
function decodeRealtimeAudio(base64Audio) {
  const binaryString = atob(base64Audio);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const pcm16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / 32768;
  }
  return float32;
}
function resampleAudio(input, inputRate, outputRate) {
  if (inputRate === outputRate) {
    return input;
  }
  const ratio = inputRate / outputRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
    const fraction = srcIndex - srcIndexFloor;
    output[i] = input[srcIndexFloor] * (1 - fraction) + input[srcIndexCeil] * fraction;
  }
  return output;
}

// src/realtime/get-realtime-tool-definitions.ts
import {
  asSchema as asSchema7
} from "@ai-sdk/provider-utils";
async function getRealtimeToolDefinitions({
  tools,
  toolsContext = {}
}) {
  const definitions = [];
  for (const [name22, tool2] of Object.entries(tools)) {
    const toolType = tool2.type;
    switch (toolType) {
      case void 0:
      case "function":
      case "dynamic": {
        const description = resolveRealtimeToolDescription({
          tool: tool2,
          toolName: name22,
          toolsContext
        });
        definitions.push({
          type: "function",
          name: name22,
          description,
          parameters: await asSchema7(tool2.inputSchema).jsonSchema
        });
        break;
      }
      case "provider":
        break;
      default: {
        const exhaustiveCheck = toolType;
        throw new Error(`Unsupported tool type: ${exhaustiveCheck}`);
      }
    }
  }
  return definitions;
}
function resolveRealtimeToolDescription({
  tool: tool2,
  toolName,
  toolsContext
}) {
  return tool2.description === void 0 ? void 0 : typeof tool2.description === "string" ? tool2.description : tool2.description({
    context: toolsContext[toolName]
  });
}

// src/realtime/browser-realtime-audio.ts
var BrowserRealtimeAudio = class {
  constructor(options) {
    this.captureContext = null;
    this.captureProcessor = null;
    this.captureSource = null;
    this.captureStream = null;
    this.playbackContext = null;
    this.playbackQueue = [];
    this.playbackTime = 0;
    this.playbackStartTime = 0;
    this.activeSources = /* @__PURE__ */ new Set();
    this.isPlaying = false;
    this.captureSampleRate = options.captureSampleRate;
    this.playbackSampleRate = options.playbackSampleRate;
    this.onAudio = options.onAudio;
    this.onPlayingChange = options.onPlayingChange;
    this.onCapturingChange = options.onCapturingChange;
  }
  ensurePlaybackContext() {
    if (this.playbackContext == null) {
      this.playbackContext = new AudioContext({
        sampleRate: this.playbackSampleRate
      });
    }
  }
  startCapture(stream) {
    const ctx = new AudioContext({ sampleRate: this.captureSampleRate });
    this.captureContext = ctx;
    this.captureStream = stream;
    const source = ctx.createMediaStreamSource(stream);
    this.captureSource = source;
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    this.captureProcessor = processor;
    processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      const samples = resampleAudio(
        new Float32Array(inputData),
        ctx.sampleRate,
        this.captureSampleRate
      );
      this.onAudio(encodeRealtimeAudio(samples));
    };
    source.connect(processor);
    processor.connect(ctx.destination);
    this.onCapturingChange(true);
  }
  stopCapture() {
    var _a22, _b, _c, _d;
    (_a22 = this.captureProcessor) == null ? void 0 : _a22.disconnect();
    (_b = this.captureSource) == null ? void 0 : _b.disconnect();
    void ((_c = this.captureContext) == null ? void 0 : _c.close());
    (_d = this.captureStream) == null ? void 0 : _d.getTracks().forEach((track) => track.stop());
    this.captureProcessor = null;
    this.captureSource = null;
    this.captureContext = null;
    this.captureStream = null;
    this.onCapturingChange(false);
  }
  playAudio(base64Audio) {
    this.ensurePlaybackContext();
    this.playbackQueue.push(decodeRealtimeAudio(base64Audio));
    this.schedulePlayback();
  }
  stopPlayback() {
    this.playbackQueue = [];
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch (e) {
      }
    }
    this.activeSources.clear();
    if (this.playbackContext != null) {
      this.playbackTime = this.playbackContext.currentTime;
    }
    this.setPlaying(false);
  }
  getPlaybackOffsetMs() {
    const ctx = this.playbackContext;
    if (ctx == null)
      return 0;
    return (ctx.currentTime - this.playbackStartTime) * 1e3;
  }
  dispose() {
    var _a22;
    this.stopCapture();
    this.stopPlayback();
    void ((_a22 = this.playbackContext) == null ? void 0 : _a22.close());
    this.playbackContext = null;
  }
  setPlaying(isPlaying) {
    var _a22, _b;
    if (isPlaying && !this.isPlaying) {
      this.playbackStartTime = (_b = (_a22 = this.playbackContext) == null ? void 0 : _a22.currentTime) != null ? _b : 0;
    }
    if (this.isPlaying !== isPlaying) {
      this.isPlaying = isPlaying;
      this.onPlayingChange(isPlaying);
    }
  }
  schedulePlayback() {
    const ctx = this.playbackContext;
    if (ctx == null || this.playbackQueue.length === 0)
      return;
    while (this.playbackQueue.length > 0) {
      const samples = this.playbackQueue.shift();
      const buffer = ctx.createBuffer(
        1,
        samples.length,
        this.playbackSampleRate
      );
      buffer.getChannelData(0).set(samples);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      const startTime = Math.max(this.playbackTime, ctx.currentTime);
      source.start(startTime);
      this.playbackTime = startTime + buffer.duration;
      this.activeSources.add(source);
      this.setPlaying(true);
      source.onended = () => {
        this.activeSources.delete(source);
        if (this.playbackQueue.length === 0 && this.activeSources.size === 0) {
          this.setPlaying(false);
        }
      };
    }
  }
};

// src/realtime/browser-realtime-transport.ts
import { safeParseJSON as safeParseJSON5 } from "@ai-sdk/provider-utils";
var BrowserRealtimeTransport = class {
  constructor(options) {
    this.ws = null;
    this.sendQueue = Promise.resolve();
    this.model = options.model;
    this.onServerEvent = options.onServerEvent;
    this.onError = options.onError;
    this.onClose = options.onClose;
  }
  connect({
    token,
    url,
    onOpen
  }) {
    var _a22;
    (_a22 = this.ws) == null ? void 0 : _a22.close();
    this.ws = null;
    const wsConfig = this.model.getWebSocketConfig({ token, url });
    const ws = new WebSocket(wsConfig.url, wsConfig.protocols);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws)
        return;
      onOpen();
    };
    ws.onmessage = (messageEvent) => {
      void this.handleMessage(messageEvent);
    };
    ws.onerror = () => {
      this.onError(new Error("WebSocket connection error"));
    };
    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
        this.onClose();
      }
    };
  }
  disconnect() {
    var _a22;
    (_a22 = this.ws) == null ? void 0 : _a22.close();
    this.ws = null;
  }
  sendEvent(event) {
    this.sendQueue = this.sendQueue.then(async () => {
      const serialized = await this.model.serializeClientEvent(event);
      if (serialized != null) {
        this.sendRaw(serialized);
      }
    }).catch((error) => {
      this.onError(
        error instanceof Error ? error : new Error(`Failed to send realtime event: ${String(error)}`)
      );
    });
  }
  sendRaw(data) {
    var _a22;
    if (((_a22 = this.ws) == null ? void 0 : _a22.readyState) === WebSocket.OPEN) {
      if (typeof data === "string" || data instanceof ArrayBuffer || ArrayBuffer.isView(data) || data instanceof Blob) {
        this.ws.send(data);
      } else {
        this.ws.send(JSON.stringify(data));
      }
    }
  }
  dispose() {
    this.disconnect();
  }
  async handleMessage(messageEvent) {
    let text2;
    if (typeof messageEvent.data === "string") {
      text2 = messageEvent.data;
    } else if (messageEvent.data instanceof Blob) {
      text2 = await messageEvent.data.text();
    } else {
      text2 = new TextDecoder().decode(messageEvent.data);
    }
    const parseResult = await safeParseJSON5({ text: text2 });
    if (!parseResult.success)
      return;
    const rawEvent = parseResult.value;
    if (this.model.getHealthCheckResponse != null) {
      const autoResponse = this.model.getHealthCheckResponse(rawEvent);
      if (autoResponse != null) {
        this.sendRaw(autoResponse);
      }
    }
    const result = this.model.parseServerEvent(rawEvent);
    const events = Array.isArray(result) ? result : [result];
    for (const event of events) {
      await this.onServerEvent(event);
    }
  }
};

// src/realtime/realtime-event-reducer.ts
import { safeParseJSON as safeParseJSON6 } from "@ai-sdk/provider-utils";
function createInitialRealtimeState() {
  return {
    status: "disconnected",
    messages: [],
    events: [],
    isCapturing: false,
    isPlaying: false
  };
}
var RealtimeEventReducer = class {
  constructor(maxEvents = 500) {
    this.maxEvents = maxEvents;
    this.currentAssistantMessageId = null;
    this.textAccumulators = /* @__PURE__ */ new Map();
    this.toolArgAccumulators = /* @__PURE__ */ new Map();
    this.toolCallIdToMessageId = /* @__PURE__ */ new Map();
    this.toolCallIdToName = /* @__PURE__ */ new Map();
    this.inputAudioMessageInsertIndex = /* @__PURE__ */ new Map();
    this.itemIdToPartLocation = /* @__PURE__ */ new Map();
  }
  setStatus(state, status) {
    return { ...state, status };
  }
  setCapturing(state, isCapturing) {
    return { ...state, isCapturing };
  }
  setPlaying(state, isPlaying) {
    return { ...state, isPlaying };
  }
  addUserTextMessage(state, text2) {
    return {
      ...state,
      messages: [
        ...state.messages,
        {
          id: `user-${Date.now()}`,
          role: "user",
          parts: [{ type: "text", text: text2, state: "done" }]
        }
      ]
    };
  }
  addToolOutput(state, callId, result) {
    return {
      state: this.updateToolPartState(state, callId, result),
      output: {
        callId,
        name: this.toolCallIdToName.get(callId),
        output: JSON.stringify(result)
      }
    };
  }
  async reduceServerEvent(state, event) {
    var _a22;
    let nextState = this.pushEvent(state, event);
    const effects = [];
    switch (event.type) {
      case "session-created":
      case "session-updated": {
        if (nextState.status === "connecting") {
          nextState = this.setStatus(nextState, "connected");
        }
        break;
      }
      case "audio-delta": {
        effects.push({
          type: "play-audio",
          itemId: event.itemId,
          delta: event.delta
        });
        break;
      }
      case "audio-committed": {
        if (event.itemId != null) {
          this.inputAudioMessageInsertIndex.set(
            event.itemId,
            nextState.messages.length
          );
        }
        break;
      }
      case "audio-transcript-delta":
      case "text-delta": {
        nextState = this.appendTextDelta(nextState, event.itemId, event.delta);
        break;
      }
      case "audio-transcript-done": {
        nextState = this.finalizeText(
          nextState,
          event.itemId,
          event.transcript
        );
        break;
      }
      case "text-done": {
        nextState = this.finalizeText(nextState, event.itemId, event.text);
        break;
      }
      case "input-transcription-completed": {
        nextState = this.addInputTranscriptionMessage(
          nextState,
          event.itemId,
          event.transcript
        );
        break;
      }
      case "response-created":
      case "response-done": {
        this.currentAssistantMessageId = null;
        break;
      }
      case "speech-started": {
        this.currentAssistantMessageId = null;
        effects.push({ type: "speech-started" });
        break;
      }
      case "function-call-arguments-delta": {
        const { state: updatedState, messageId } = this.getOrCreateAssistantMessage(nextState);
        nextState = updatedState;
        this.toolCallIdToMessageId.set(event.callId, messageId);
        const acc = (_a22 = this.toolArgAccumulators.get(event.callId)) != null ? _a22 : "";
        this.toolArgAccumulators.set(event.callId, acc + event.delta);
        nextState = this.ensureToolPart(nextState, messageId, event.callId);
        break;
      }
      case "function-call-arguments-done": {
        this.toolArgAccumulators.delete(event.callId);
        this.toolCallIdToName.set(event.callId, event.name);
        const parseResult = await safeParseJSON6({ text: event.arguments });
        const parsedInput = parseResult.success ? parseResult.value : {};
        const messageId = this.toolCallIdToMessageId.get(event.callId);
        if (messageId != null) {
          nextState = this.markToolInputAvailable(
            nextState,
            messageId,
            event.callId,
            event.name,
            parsedInput
          );
        }
        if (!parseResult.success) {
          effects.push({
            type: "error",
            error: new Error(
              `Failed to parse tool arguments: ${event.arguments}`
            )
          });
        } else {
          effects.push({
            type: "tool-call",
            callId: event.callId,
            name: event.name,
            args: parsedInput,
            rawArguments: event.arguments
          });
        }
        break;
      }
      case "error": {
        effects.push({ type: "error", error: new Error(event.message) });
        break;
      }
    }
    return { state: nextState, effects };
  }
  pushEvent(state, event) {
    const events = [...state.events, event];
    return {
      ...state,
      events: events.length > this.maxEvents ? events.slice(-this.maxEvents) : events
    };
  }
  getOrCreateAssistantMessage(state) {
    if (this.currentAssistantMessageId != null) {
      return { state, messageId: this.currentAssistantMessageId };
    }
    const messageId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.currentAssistantMessageId = messageId;
    return {
      state: {
        ...state,
        messages: [
          ...state.messages,
          {
            id: messageId,
            role: "assistant",
            parts: []
          }
        ]
      },
      messageId
    };
  }
  addInputTranscriptionMessage(state, itemId, transcript) {
    var _a22;
    const messageId = `user-${itemId}`;
    const existingMessage = state.messages.find(
      (message) => message.id === messageId
    );
    if (existingMessage != null) {
      return {
        ...state,
        messages: state.messages.map(
          (message) => message.id === messageId ? {
            ...message,
            parts: [
              {
                type: "text",
                text: transcript,
                state: "done"
              }
            ]
          } : message
        )
      };
    }
    const insertIndex = Math.min(
      (_a22 = this.inputAudioMessageInsertIndex.get(itemId)) != null ? _a22 : state.messages.length,
      state.messages.length
    );
    const messages = [...state.messages];
    messages.splice(insertIndex, 0, {
      id: messageId,
      role: "user",
      parts: [
        {
          type: "text",
          text: transcript,
          state: "done"
        }
      ]
    });
    return {
      ...state,
      messages
    };
  }
  appendTextDelta(state, itemId, delta) {
    var _a22;
    const { state: stateWithMessage, messageId } = this.getOrCreateAssistantMessage(state);
    const acc = (_a22 = this.textAccumulators.get(itemId)) != null ? _a22 : "";
    const text2 = acc + delta;
    this.textAccumulators.set(itemId, text2);
    const location = this.itemIdToPartLocation.get(itemId);
    if (location != null) {
      return this.updateMessagePart(
        stateWithMessage,
        location.messageId,
        location.partIndex,
        { type: "text", text: text2, state: "streaming" }
      );
    }
    return {
      ...stateWithMessage,
      messages: stateWithMessage.messages.map((message) => {
        if (message.id !== messageId)
          return message;
        const partIndex = message.parts.length;
        this.itemIdToPartLocation.set(itemId, { messageId, partIndex });
        return {
          ...message,
          parts: [
            ...message.parts,
            { type: "text", text: text2, state: "streaming" }
          ]
        };
      })
    };
  }
  finalizeText(state, itemId, finalText) {
    var _a22;
    const text2 = (_a22 = finalText != null ? finalText : this.textAccumulators.get(itemId)) != null ? _a22 : "";
    this.textAccumulators.delete(itemId);
    const location = this.itemIdToPartLocation.get(itemId);
    if (location == null)
      return state;
    this.itemIdToPartLocation.delete(itemId);
    return this.updateMessagePart(
      state,
      location.messageId,
      location.partIndex,
      { type: "text", text: text2, state: "done" }
    );
  }
  ensureToolPart(state, messageId, callId) {
    return {
      ...state,
      messages: state.messages.map((message) => {
        if (message.id !== messageId)
          return message;
        const existingPart = message.parts.find(
          (part) => part.type === "dynamic-tool" && part.toolCallId === callId
        );
        if (existingPart != null)
          return message;
        return {
          ...message,
          parts: [
            ...message.parts,
            {
              type: "dynamic-tool",
              toolName: "",
              toolCallId: callId,
              state: "input-streaming",
              input: void 0
            }
          ]
        };
      })
    };
  }
  markToolInputAvailable(state, messageId, callId, name22, input) {
    return {
      ...state,
      messages: state.messages.map((message) => {
        if (message.id !== messageId)
          return message;
        return {
          ...message,
          parts: message.parts.map((part) => {
            if (part.type !== "dynamic-tool")
              return part;
            const toolPart = part;
            if (toolPart.toolCallId !== callId)
              return part;
            return {
              ...toolPart,
              toolName: name22,
              state: "input-available",
              input
            };
          })
        };
      })
    };
  }
  updateToolPartState(state, callId, result) {
    const messageId = this.toolCallIdToMessageId.get(callId);
    if (messageId == null)
      return state;
    return {
      ...state,
      messages: state.messages.map((message) => {
        if (message.id !== messageId)
          return message;
        return {
          ...message,
          parts: message.parts.map((part) => {
            if (part.type !== "dynamic-tool")
              return part;
            const toolPart = part;
            if (toolPart.toolCallId !== callId)
              return part;
            return {
              ...toolPart,
              state: "output-available",
              output: result
            };
          })
        };
      })
    };
  }
  updateMessagePart(state, messageId, partIndex, part) {
    return {
      ...state,
      messages: state.messages.map((message) => {
        if (message.id !== messageId)
          return message;
        const parts = [...message.parts];
        parts[partIndex] = part;
        return { ...message, parts };
      })
    };
  }
};

// src/realtime/realtime-session.ts
var AbstractRealtimeSession = class {
  constructor(options) {
    this.state = createInitialRealtimeState();
    this.currentResponseItemId = null;
    // Tool calls requested by the current (tool-bearing) response, the outputs
    // that have been submitted for them, and whether that response has finished
    // delivering its tool calls. Used to request a single response only once
    // every tool output for the turn has been submitted.
    this.toolCallsInResponse = /* @__PURE__ */ new Set();
    this.submittedToolOutputs = /* @__PURE__ */ new Set();
    this.responseToolCallsClosed = false;
    var _a22, _b, _c, _d, _e, _f, _g, _h;
    this.model = options.model;
    this.api = options.api;
    this.sessionConfig = options.sessionConfig;
    this.maxEvents = (_a22 = options.maxEvents) != null ? _a22 : 500;
    this.reducer = new RealtimeEventReducer(this.maxEvents);
    this.onToolCall = options.onToolCall;
    this.onEvent = options.onEvent;
    this.onError = options.onError;
    const sampleRate = (_b = options.sampleRate) != null ? _b : 24e3;
    const captureSampleRate = (_e = (_d = (_c = options.sessionConfig) == null ? void 0 : _c.inputAudioFormat) == null ? void 0 : _d.rate) != null ? _e : sampleRate;
    const playbackSampleRate = (_h = (_g = (_f = options.sessionConfig) == null ? void 0 : _f.outputAudioFormat) == null ? void 0 : _g.rate) != null ? _h : sampleRate;
    this.transport = new BrowserRealtimeTransport({
      model: this.model,
      onServerEvent: (event) => this.handleServerEvent(event),
      onError: (error) => {
        var _a23;
        this.applyState(this.reducer.setStatus(this.state, "error"));
        (_a23 = this.onError) == null ? void 0 : _a23.call(this, error);
      },
      onClose: () => {
        this.applyState(this.reducer.setStatus(this.state, "disconnected"));
      }
    });
    this.audio = new BrowserRealtimeAudio({
      captureSampleRate,
      playbackSampleRate,
      onAudio: (audio) => this.sendAudio(audio),
      onCapturingChange: (isCapturing) => {
        this.applyState(this.reducer.setCapturing(this.state, isCapturing));
      },
      onPlayingChange: (isPlaying) => {
        this.applyState(this.reducer.setPlaying(this.state, isPlaying));
      }
    });
  }
  // ── Connection ─────────────────────────────────────────────────────
  async connect() {
    var _a22;
    this.applyState(this.reducer.setStatus(this.state, "connecting"));
    try {
      const response = await fetch(this.api.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionConfig: this.sessionConfig })
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch realtime setup: ${response.status}`);
      }
      const setupData = await response.json();
      const { token, url, tools: toolDefinitions } = setupData;
      const config = {
        ...this.sessionConfig,
        tools: toolDefinitions
      };
      this.audio.ensurePlaybackContext();
      this.transport.connect({
        token,
        url,
        onOpen: () => {
          this.sendEvent({
            type: "session-update",
            config
          });
        }
      });
    } catch (error) {
      this.applyState(this.reducer.setStatus(this.state, "error"));
      (_a22 = this.onError) == null ? void 0 : _a22.call(
        this,
        error instanceof Error ? error : new Error(`Connection failed: ${String(error)}`)
      );
    }
  }
  disconnect() {
    this.transport.disconnect();
    this.applyState(this.reducer.setStatus(this.state, "disconnected"));
  }
  // ── Sending events ─────────────────────────────────────────────────
  sendEvent(event) {
    this.transport.sendEvent(event);
  }
  sendTextMessage(text2) {
    this.sendEvent({
      type: "conversation-item-create",
      item: { type: "text-message", role: "user", text: text2 }
    });
    this.sendEvent({ type: "response-create" });
    this.applyState(this.reducer.addUserTextMessage(this.state, text2));
  }
  sendAudio(base64Audio) {
    this.sendEvent({ type: "input-audio-append", audio: base64Audio });
  }
  commitAudio() {
    this.sendEvent({ type: "input-audio-commit" });
  }
  clearAudioBuffer() {
    this.sendEvent({ type: "input-audio-clear" });
  }
  requestResponse(options) {
    this.sendEvent({
      type: "response-create",
      ...options != null ? { options } : {}
    });
  }
  cancelResponse() {
    this.sendEvent({ type: "response-cancel" });
  }
  // ── Tool output ───────────────────────────────────────────────────
  addToolOutput(callId, result) {
    const { state, output } = this.reducer.addToolOutput(
      this.state,
      callId,
      result
    );
    this.applyState(state);
    this.sendEvent({
      type: "conversation-item-create",
      item: {
        type: "function-call-output",
        callId: output.callId,
        name: output.name,
        output: output.output
      }
    });
    this.submittedToolOutputs.add(callId);
    this.maybeRequestToolResponse();
  }
  /**
   * Requests a single response once the tool-bearing response has finished
   * delivering its tool calls and every one of them has an output. Requesting a
   * response after each individual output can cause the model to continue
   * without the full tool context on multi-tool turns.
   */
  maybeRequestToolResponse() {
    if (!this.responseToolCallsClosed)
      return;
    if (this.toolCallsInResponse.size === 0)
      return;
    for (const callId of this.toolCallsInResponse) {
      if (!this.submittedToolOutputs.has(callId))
        return;
    }
    this.sendEvent({ type: "response-create" });
    this.toolCallsInResponse.clear();
    this.submittedToolOutputs.clear();
    this.responseToolCallsClosed = false;
  }
  // ── Audio capture ──────────────────────────────────────────────────
  startAudioCapture(stream) {
    this.audio.startCapture(stream);
  }
  stopAudioCapture() {
    this.audio.stopCapture();
  }
  // ── Playback ───────────────────────────────────────────────────────
  stopPlayback() {
    this.audio.stopPlayback();
  }
  // ── Cleanup ────────────────────────────────────────────────────────
  dispose() {
    this.transport.dispose();
    this.audio.dispose();
    this.applyState(
      this.reducer.setStatus(
        this.reducer.setPlaying(
          this.reducer.setCapturing(this.state, false),
          false
        ),
        "disconnected"
      )
    );
  }
  // ── Private helpers ────────────────────────────────────────────────
  applyState(nextState) {
    const previousState = this.state;
    this.state = nextState;
    if (previousState.status !== nextState.status) {
      this.setState("status", nextState.status);
    }
    if (previousState.messages !== nextState.messages) {
      this.setState("messages", nextState.messages);
    }
    if (previousState.events !== nextState.events) {
      this.setState("events", nextState.events);
    }
    if (previousState.isCapturing !== nextState.isCapturing) {
      this.setState("isCapturing", nextState.isCapturing);
    }
    if (previousState.isPlaying !== nextState.isPlaying) {
      this.setState("isPlaying", nextState.isPlaying);
    }
  }
  async executeToolCall({
    name: name22,
    args,
    callId
  }) {
    var _a22, _b;
    if (this.onToolCall == null) {
      (_a22 = this.onError) == null ? void 0 : _a22.call(this, new Error(`No handler provided for tool "${name22}"`));
      return;
    }
    try {
      const result = await this.onToolCall({
        toolCall: { toolCallId: callId, toolName: name22, args }
      });
      if (result !== void 0) {
        this.addToolOutput(callId, result);
      }
    } catch (error) {
      (_b = this.onError) == null ? void 0 : _b.call(
        this,
        error instanceof Error ? error : new Error(`Client tool execution failed: ${String(error)}`)
      );
    }
  }
  async handleServerEvent(event) {
    var _a22;
    const result = await this.reducer.reduceServerEvent(this.state, event);
    this.applyState(result.state);
    (_a22 = this.onEvent) == null ? void 0 : _a22.call(this, event);
    for (const effect of result.effects) {
      this.handleReducerEffect(effect);
    }
    if (event.type === "response-done" && this.toolCallsInResponse.size > 0) {
      this.responseToolCallsClosed = true;
      this.maybeRequestToolResponse();
    }
  }
  handleReducerEffect(effect) {
    var _a22;
    switch (effect.type) {
      case "play-audio": {
        this.currentResponseItemId = effect.itemId;
        this.audio.playAudio(effect.delta);
        break;
      }
      case "speech-started": {
        if (this.state.isPlaying) {
          const playedMs = this.audio.getPlaybackOffsetMs();
          this.audio.stopPlayback();
          if (this.currentResponseItemId != null) {
            this.sendEvent({
              type: "conversation-item-truncate",
              itemId: this.currentResponseItemId,
              contentIndex: 0,
              audioEndMs: Math.round(playedMs)
            });
          }
        }
        break;
      }
      case "tool-call": {
        this.toolCallsInResponse.add(effect.callId);
        void this.executeToolCall({
          name: effect.name,
          args: effect.args,
          callId: effect.callId
        });
        break;
      }
      case "error": {
        (_a22 = this.onError) == null ? void 0 : _a22.call(this, effect.error);
        break;
      }
    }
  }
};

// src/registry/custom-provider.ts
import {
  NoSuchModelError as NoSuchModelError2
} from "@ai-sdk/provider";
function customProvider({
  languageModels,
  embeddingModels,
  imageModels,
  transcriptionModels,
  speechModels,
  rerankingModels,
  videoModels,
  files,
  skills,
  fallbackProvider: fallbackProviderArg
}) {
  const fallbackProvider = fallbackProviderArg == null ? void 0 : asProviderV4(fallbackProviderArg);
  const baseProvider = {
    specificationVersion: "v4",
    languageModel(modelId) {
      if (languageModels != null && modelId in languageModels) {
        return resolveLanguageModel(languageModels[modelId]);
      }
      if (fallbackProvider) {
        return fallbackProvider.languageModel(modelId);
      }
      throw new NoSuchModelError2({ modelId, modelType: "languageModel" });
    },
    embeddingModel(modelId) {
      if (embeddingModels != null && modelId in embeddingModels) {
        return resolveEmbeddingModel(embeddingModels[modelId]);
      }
      if (fallbackProvider) {
        return fallbackProvider.embeddingModel(modelId);
      }
      throw new NoSuchModelError2({ modelId, modelType: "embeddingModel" });
    },
    imageModel(modelId) {
      if (imageModels != null && modelId in imageModels) {
        return resolveImageModel(imageModels[modelId]);
      }
      if (fallbackProvider == null ? void 0 : fallbackProvider.imageModel) {
        return fallbackProvider.imageModel(modelId);
      }
      throw new NoSuchModelError2({ modelId, modelType: "imageModel" });
    },
    transcriptionModel(modelId) {
      if (transcriptionModels != null && modelId in transcriptionModels) {
        const model = resolveTranscriptionModel(transcriptionModels[modelId]);
        if (model != null) {
          return model;
        }
      }
      if (fallbackProvider == null ? void 0 : fallbackProvider.transcriptionModel) {
        return fallbackProvider.transcriptionModel(modelId);
      }
      throw new NoSuchModelError2({ modelId, modelType: "transcriptionModel" });
    },
    speechModel(modelId) {
      if (speechModels != null && modelId in speechModels) {
        const model = resolveSpeechModel(speechModels[modelId]);
        if (model != null) {
          return model;
        }
      }
      if (fallbackProvider == null ? void 0 : fallbackProvider.speechModel) {
        return fallbackProvider.speechModel(modelId);
      }
      throw new NoSuchModelError2({ modelId, modelType: "speechModel" });
    },
    rerankingModel(modelId) {
      if (rerankingModels != null && modelId in rerankingModels) {
        return resolveRerankingModel(rerankingModels[modelId]);
      }
      if (fallbackProvider == null ? void 0 : fallbackProvider.rerankingModel) {
        return fallbackProvider.rerankingModel(modelId);
      }
      throw new NoSuchModelError2({ modelId, modelType: "rerankingModel" });
    },
    videoModel(modelId) {
      if (videoModels != null && modelId in videoModels) {
        return resolveVideoModel(videoModels[modelId]);
      }
      const videoModel = fallbackProvider == null ? void 0 : fallbackProvider.videoModel;
      if (videoModel) {
        return videoModel(modelId);
      }
      throw new NoSuchModelError2({ modelId, modelType: "videoModel" });
    }
  };
  const filesAndSkills = {
    ...files != null || (fallbackProvider == null ? void 0 : fallbackProvider.files) != null ? {
      files() {
        return files != null ? files : fallbackProvider.files();
      }
    } : {},
    ...skills != null || (fallbackProvider == null ? void 0 : fallbackProvider.skills) != null ? {
      skills() {
        return skills != null ? skills : fallbackProvider.skills();
      }
    } : {}
  };
  return Object.assign(baseProvider, filesAndSkills);
}

// src/registry/no-such-provider-error.ts
import { AISDKError as AISDKError24, NoSuchModelError as NoSuchModelError3 } from "@ai-sdk/provider";
var name21 = "AI_NoSuchProviderError";
var marker21 = `vercel.ai.error.${name21}`;
var symbol21 = Symbol.for(marker21);
var _a21;
var NoSuchProviderError = class extends NoSuchModelError3 {
  constructor({
    modelId,
    modelType,
    providerId,
    availableProviders,
    message = `No such provider: ${providerId} (available providers: ${availableProviders.join()})`
  }) {
    super({ errorName: name21, modelId, modelType, message });
    this[_a21] = true;
    this.providerId = providerId;
    this.availableProviders = availableProviders;
  }
  static isInstance(error) {
    return AISDKError24.hasMarker(error, marker21);
  }
};
_a21 = symbol21;

// src/registry/provider-registry.ts
import {
  NoSuchModelError as NoSuchModelError4
} from "@ai-sdk/provider";
function createProviderRegistry(providers, {
  separator = ":",
  languageModelMiddleware,
  imageModelMiddleware
} = {}) {
  const registry = new DefaultProviderRegistry({
    separator,
    languageModelMiddleware,
    imageModelMiddleware
  });
  for (const [id, provider] of Object.entries(providers)) {
    registry.registerProvider({ id, provider });
  }
  return registry;
}
var experimental_createProviderRegistry = createProviderRegistry;
var DefaultProviderRegistry = class {
  constructor({
    separator,
    languageModelMiddleware,
    imageModelMiddleware
  }) {
    this.providers = {};
    this.separator = separator;
    this.languageModelMiddleware = languageModelMiddleware;
    this.imageModelMiddleware = imageModelMiddleware;
  }
  registerProvider({
    id,
    provider
  }) {
    var _a22;
    const providerV4 = asProviderV4(provider);
    const videoModel = (_a22 = provider.videoModel) == null ? void 0 : _a22.bind(provider);
    this.providers[id] = videoModel == null ? providerV4 : Object.assign(Object.create(Object.getPrototypeOf(providerV4)), {
      ...providerV4,
      videoModel: (modelId) => asVideoModelV4(videoModel(modelId))
    });
  }
  getProvider(id, modelType) {
    const provider = this.providers[id];
    if (provider == null) {
      throw new NoSuchProviderError({
        modelId: id,
        modelType,
        providerId: id,
        availableProviders: Object.keys(this.providers)
      });
    }
    return provider;
  }
  splitId(id, modelType) {
    const index = id.indexOf(this.separator);
    if (index === -1) {
      throw new NoSuchModelError4({
        modelId: id,
        modelType,
        message: `Invalid ${modelType} id for registry: ${id} (must be in the format "providerId${this.separator}modelId")`
      });
    }
    return [id.slice(0, index), id.slice(index + this.separator.length)];
  }
  languageModel(id) {
    var _a22, _b;
    const [providerId, modelId] = this.splitId(id, "languageModel");
    let model = (_b = (_a22 = this.getProvider(providerId, "languageModel")).languageModel) == null ? void 0 : _b.call(
      _a22,
      modelId
    );
    if (model == null) {
      throw new NoSuchModelError4({ modelId: id, modelType: "languageModel" });
    }
    if (this.languageModelMiddleware != null) {
      model = wrapLanguageModel({
        model,
        middleware: this.languageModelMiddleware
      });
    }
    return model;
  }
  embeddingModel(id) {
    var _a22;
    const [providerId, modelId] = this.splitId(id, "embeddingModel");
    const provider = this.getProvider(providerId, "embeddingModel");
    const model = (_a22 = provider.embeddingModel) == null ? void 0 : _a22.call(provider, modelId);
    if (model == null) {
      throw new NoSuchModelError4({
        modelId: id,
        modelType: "embeddingModel"
      });
    }
    return model;
  }
  imageModel(id) {
    var _a22;
    const [providerId, modelId] = this.splitId(id, "imageModel");
    const provider = this.getProvider(providerId, "imageModel");
    let model = (_a22 = provider.imageModel) == null ? void 0 : _a22.call(provider, modelId);
    if (model == null) {
      throw new NoSuchModelError4({ modelId: id, modelType: "imageModel" });
    }
    if (this.imageModelMiddleware != null) {
      model = wrapImageModel({
        model,
        middleware: this.imageModelMiddleware
      });
    }
    return model;
  }
  transcriptionModel(id) {
    var _a22;
    const [providerId, modelId] = this.splitId(id, "transcriptionModel");
    const provider = this.getProvider(providerId, "transcriptionModel");
    const model = (_a22 = provider.transcriptionModel) == null ? void 0 : _a22.call(provider, modelId);
    if (model == null) {
      throw new NoSuchModelError4({
        modelId: id,
        modelType: "transcriptionModel"
      });
    }
    return model;
  }
  speechModel(id) {
    var _a22;
    const [providerId, modelId] = this.splitId(id, "speechModel");
    const provider = this.getProvider(providerId, "speechModel");
    const model = (_a22 = provider.speechModel) == null ? void 0 : _a22.call(provider, modelId);
    if (model == null) {
      throw new NoSuchModelError4({ modelId: id, modelType: "speechModel" });
    }
    return model;
  }
  rerankingModel(id) {
    var _a22;
    const [providerId, modelId] = this.splitId(id, "rerankingModel");
    const provider = this.getProvider(providerId, "rerankingModel");
    const model = (_a22 = provider.rerankingModel) == null ? void 0 : _a22.call(provider, modelId);
    if (model == null) {
      throw new NoSuchModelError4({ modelId: id, modelType: "rerankingModel" });
    }
    return model;
  }
  videoModel(id) {
    var _a22;
    const [providerId, modelId] = this.splitId(id, "videoModel");
    const provider = this.getProvider(providerId, "videoModel");
    const model = (_a22 = provider.videoModel) == null ? void 0 : _a22.call(provider, modelId);
    if (model == null) {
      throw new NoSuchModelError4({ modelId: id, modelType: "videoModel" });
    }
    return asVideoModelV4(model);
  }
  files(id) {
    var _a22;
    const provider = this.getProvider(id, "languageModel");
    const files = (_a22 = provider.files) == null ? void 0 : _a22.call(provider);
    if (files == null) {
      throw new Error(
        `The provider "${id}" does not support file uploads. Make sure it exposes a files() method.`
      );
    }
    return files;
  }
  skills(id) {
    var _a22;
    const provider = this.getProvider(id, "languageModel");
    const skills = (_a22 = provider.skills) == null ? void 0 : _a22.call(provider);
    if (skills == null) {
      throw new Error(
        `The provider "${id}" does not support skills. Make sure it exposes a skills() method.`
      );
    }
    return skills;
  }
};

// src/rerank/rerank.ts
import {
  createIdGenerator as createIdGenerator8
} from "@ai-sdk/provider-utils";
var originalGenerateCallId6 = createIdGenerator8({
  prefix: "call",
  size: 24
});
async function rerank({
  model: modelArg,
  documents,
  query,
  topN,
  maxRetries: maxRetriesArg,
  abortSignal,
  headers,
  providerOptions,
  experimental_telemetry,
  telemetry = experimental_telemetry,
  onStart,
  experimental_onStart,
  onEnd,
  experimental_onEnd,
  _internal: { generateCallId = originalGenerateCallId6 } = {}
}) {
  var _a22;
  const model = resolveRerankingModel(modelArg);
  const callId = generateCallId();
  const resolvedOnStart = onStart != null ? onStart : experimental_onStart;
  const resolvedOnEnd = onEnd != null ? onEnd : experimental_onEnd;
  const telemetryDispatcher = createTelemetryDispatcher({
    telemetry
  });
  const runInTracingChannelSpan = (_a22 = telemetryDispatcher.runInTracingChannelSpan) != null ? _a22 : async ({ execute }) => await execute();
  if (documents.length === 0) {
    await notify({
      event: {
        callId,
        operationId: "ai.rerank",
        provider: model.provider,
        modelId: model.modelId,
        documents,
        query,
        topN,
        maxRetries: maxRetriesArg != null ? maxRetriesArg : 2,
        headers,
        providerOptions
      },
      callbacks: [resolvedOnStart, telemetryDispatcher.onStart]
    });
    await notify({
      event: {
        callId,
        operationId: "ai.rerank",
        provider: model.provider,
        modelId: model.modelId,
        documents,
        query,
        ranking: [],
        warnings: [],
        providerMetadata: void 0,
        response: {
          timestamp: /* @__PURE__ */ new Date(),
          modelId: model.modelId
        }
      },
      callbacks: [resolvedOnEnd, telemetryDispatcher.onEnd]
    });
    return new DefaultRerankResult({
      originalDocuments: [],
      ranking: [],
      providerMetadata: void 0,
      response: {
        timestamp: /* @__PURE__ */ new Date(),
        modelId: model.modelId
      }
    });
  }
  const { maxRetries, retry } = prepareRetries({
    maxRetries: maxRetriesArg,
    abortSignal
  });
  const documentsToSend = typeof documents[0] === "string" ? { type: "text", values: documents } : { type: "object", values: documents };
  const startEvent = {
    callId,
    operationId: "ai.rerank",
    provider: model.provider,
    modelId: model.modelId,
    documents,
    query,
    topN,
    maxRetries,
    headers,
    providerOptions
  };
  return await runInTracingChannelSpan({
    type: "rerank",
    event: startEvent,
    execute: async () => {
      var _a23, _b, _c, _d, _e;
      await notify({
        event: startEvent,
        callbacks: [resolvedOnStart, telemetryDispatcher.onStart]
      });
      try {
        const { ranking, response, providerMetadata, warnings } = await retry(
          async () => {
            await notify({
              event: {
                callId,
                operationId: "ai.rerank.doRerank",
                provider: model.provider,
                modelId: model.modelId,
                documents,
                documentsType: documentsToSend.type,
                query,
                topN
              },
              callbacks: [telemetryDispatcher.onRerankStart]
            });
            const modelResponse = await model.doRerank({
              documents: documentsToSend,
              query,
              topN,
              providerOptions,
              abortSignal,
              headers
            });
            const ranking2 = modelResponse.ranking;
            await notify({
              event: {
                callId,
                operationId: "ai.rerank.doRerank",
                provider: model.provider,
                modelId: model.modelId,
                documentsType: documentsToSend.type,
                ranking: ranking2
              },
              callbacks: [telemetryDispatcher.onRerankEnd]
            });
            return {
              ranking: ranking2,
              providerMetadata: modelResponse.providerMetadata,
              response: modelResponse.response,
              warnings: modelResponse.warnings
            };
          }
        );
        logWarnings({
          warnings: warnings != null ? warnings : [],
          provider: model.provider,
          model: model.modelId
        });
        await notify({
          event: {
            callId,
            operationId: "ai.rerank",
            provider: model.provider,
            modelId: model.modelId,
            documents,
            query,
            ranking: ranking.map((r) => ({
              originalIndex: r.index,
              score: r.relevanceScore,
              document: documents[r.index]
            })),
            warnings: warnings != null ? warnings : [],
            providerMetadata,
            response: {
              id: response == null ? void 0 : response.id,
              timestamp: (_a23 = response == null ? void 0 : response.timestamp) != null ? _a23 : /* @__PURE__ */ new Date(),
              modelId: (_b = response == null ? void 0 : response.modelId) != null ? _b : model.modelId,
              headers: response == null ? void 0 : response.headers,
              body: response == null ? void 0 : response.body
            }
          },
          callbacks: [resolvedOnEnd, telemetryDispatcher.onEnd]
        });
        return new DefaultRerankResult({
          originalDocuments: documents,
          ranking: ranking.map((ranking2) => ({
            originalIndex: ranking2.index,
            score: ranking2.relevanceScore,
            document: documents[ranking2.index]
          })),
          providerMetadata,
          response: {
            id: response == null ? void 0 : response.id,
            timestamp: (_c = response == null ? void 0 : response.timestamp) != null ? _c : /* @__PURE__ */ new Date(),
            modelId: (_d = response == null ? void 0 : response.modelId) != null ? _d : model.modelId,
            headers: response == null ? void 0 : response.headers,
            body: response == null ? void 0 : response.body
          }
        });
      } catch (error) {
        await ((_e = telemetryDispatcher.onError) == null ? void 0 : _e.call(telemetryDispatcher, { callId, error }));
        throw error;
      }
    }
  });
}
var DefaultRerankResult = class {
  constructor(options) {
    this.originalDocuments = options.originalDocuments;
    this.ranking = options.ranking;
    this.response = options.response;
    this.providerMetadata = options.providerMetadata;
  }
  get rerankedDocuments() {
    return this.ranking.map((ranking) => ranking.document);
  }
};

// src/transcribe/transcribe.ts
import {
  detectMediaType as detectMediaType5,
  withUserAgentSuffix as withUserAgentSuffix10
} from "@ai-sdk/provider-utils";
var defaultDownload2 = createDownload();
async function transcribe({
  model,
  audio,
  providerOptions = {},
  maxRetries: maxRetriesArg,
  abortSignal,
  headers,
  download: downloadFn = defaultDownload2
}) {
  const resolvedModel = resolveTranscriptionModel(model);
  if (!resolvedModel) {
    throw new Error("Model could not be resolved");
  }
  const { retry } = prepareRetries({
    maxRetries: maxRetriesArg,
    abortSignal
  });
  const headersWithUserAgent = withUserAgentSuffix10(
    headers != null ? headers : {},
    `ai/${VERSION}`
  );
  const audioData = audio instanceof URL ? (await downloadFn({ url: audio, abortSignal })).data : convertDataContentToUint8Array(audio);
  const result = await retry(
    () => {
      var _a22;
      return resolvedModel.doGenerate({
        audio: audioData,
        abortSignal,
        headers: headersWithUserAgent,
        providerOptions,
        mediaType: (_a22 = detectMediaType5({
          data: audioData,
          topLevelType: "audio"
        })) != null ? _a22 : "audio/wav"
      });
    }
  );
  logWarnings({
    warnings: result.warnings,
    provider: resolvedModel.provider,
    model: resolvedModel.modelId
  });
  if (!result.text) {
    throw new NoTranscriptGeneratedError({ responses: [result.response] });
  }
  return new DefaultTranscriptionResult({
    text: result.text,
    segments: result.segments,
    language: result.language,
    durationInSeconds: result.durationInSeconds,
    warnings: result.warnings,
    responses: [result.response],
    providerMetadata: result.providerMetadata
  });
}
var DefaultTranscriptionResult = class {
  constructor(options) {
    var _a22;
    this.text = options.text;
    this.segments = options.segments;
    this.language = options.language;
    this.durationInSeconds = options.durationInSeconds;
    this.warnings = options.warnings;
    this.responses = options.responses;
    this.providerMetadata = (_a22 = options.providerMetadata) != null ? _a22 : {};
  }
};

// src/transcribe/stream-transcribe.ts
import {
  UnsupportedFunctionalityError as UnsupportedFunctionalityError4
} from "@ai-sdk/provider";
import {
  DelayedPromise as DelayedPromise3,
  withUserAgentSuffix as withUserAgentSuffix11
} from "@ai-sdk/provider-utils";
function streamTranscribe({
  model,
  audio,
  inputAudioFormat,
  providerOptions = {},
  abortSignal,
  headers,
  includeRawChunks,
  _internal: { currentDate = () => /* @__PURE__ */ new Date() } = {}
}) {
  var _a22;
  const resolvedModel = resolveTranscriptionModel(model);
  if (!resolvedModel) {
    throw new Error("Model could not be resolved");
  }
  const doStream = (_a22 = resolvedModel.doStream) == null ? void 0 : _a22.bind(resolvedModel);
  if (doStream == null) {
    throw new UnsupportedFunctionalityError4({
      functionality: "streaming transcription",
      message: `The ${resolvedModel.provider} model "${resolvedModel.modelId}" does not support streaming transcription.` + (typeof model === "string" ? " String model IDs resolve through the global provider (AI Gateway by default). If that provider does not support streaming transcription, pass a provider model instance instead (e.g. openai.transcription('gpt-realtime-whisper')) or upgrade @ai-sdk/gateway to a version with streaming transcription support." : "")
    });
  }
  const headersWithUserAgent = withUserAgentSuffix11(
    headers != null ? headers : {},
    `ai/${VERSION}`
  );
  const textPromise = new DelayedPromise3();
  const segmentsPromise = new DelayedPromise3();
  const languagePromise = new DelayedPromise3();
  const durationInSecondsPromise = new DelayedPromise3();
  const warningsPromise = new DelayedPromise3();
  const responsesPromise = new DelayedPromise3();
  const providerMetadataPromise = new DelayedPromise3();
  const rejectPendingPromises = (error) => {
    for (const promise of [
      textPromise,
      segmentsPromise,
      languagePromise,
      durationInSecondsPromise,
      warningsPromise,
      responsesPromise,
      providerMetadataPromise
    ]) {
      if (promise.isPending()) {
        promise.reject(error);
      }
    }
  };
  const startedAt = currentDate();
  let response;
  const currentResponseMetadata = () => response != null ? response : { timestamp: startedAt, modelId: resolvedModel.modelId };
  const resolveWarnings = (warnings) => {
    warningsPromise.resolve(warnings);
    logWarnings({
      warnings,
      provider: resolvedModel.provider,
      model: resolvedModel.modelId
    });
  };
  const pipeAbortController = new AbortController();
  const transformer = {
    transform(value, controller) {
      var _a23, _b, _c, _d;
      switch (value.type) {
        case "stream-start": {
          resolveWarnings(value.warnings);
          break;
        }
        case "response-metadata": {
          response = {
            timestamp: (_a23 = value.timestamp) != null ? _a23 : currentResponseMetadata().timestamp,
            modelId: (_b = value.modelId) != null ? _b : currentResponseMetadata().modelId,
            headers: (_c = value.headers) != null ? _c : response == null ? void 0 : response.headers
          };
          break;
        }
        case "transcript-delta":
        case "transcript-partial":
        case "transcript-final":
        case "raw":
        case "error": {
          controller.enqueue(value);
          break;
        }
        case "finish": {
          if (!warningsPromise.isResolved()) {
            resolveWarnings([]);
          }
          if (!value.text) {
            throw new NoTranscriptGeneratedError({
              responses: [currentResponseMetadata()]
            });
          }
          textPromise.resolve(value.text);
          segmentsPromise.resolve(value.segments);
          languagePromise.resolve(value.language);
          durationInSecondsPromise.resolve(value.durationInSeconds);
          responsesPromise.resolve([currentResponseMetadata()]);
          providerMetadataPromise.resolve((_d = value.providerMetadata) != null ? _d : {});
          break;
        }
      }
    },
    flush() {
      if (textPromise.isPending()) {
        throw new NoTranscriptGeneratedError({
          responses: [currentResponseMetadata()]
        });
      }
    },
    cancel(reason) {
      pipeAbortController.abort(
        reason != null ? reason : new Error("Transcription stream was cancelled.")
      );
    }
  };
  const transform = new TransformStream(transformer);
  void (async () => {
    var _a23, _b, _c, _d, _e;
    const result = await doStream({
      audio,
      inputAudioFormat,
      providerOptions,
      // merged so cancelling fullStream also aborts a still-pending doStream
      abortSignal: mergeAbortSignals(abortSignal, pipeAbortController.signal),
      headers: headersWithUserAgent,
      includeRawChunks
    });
    response = {
      timestamp: (_b = (_a23 = result.response) == null ? void 0 : _a23.timestamp) != null ? _b : startedAt,
      modelId: (_d = (_c = result.response) == null ? void 0 : _c.modelId) != null ? _d : resolvedModel.modelId,
      headers: (_e = result.response) == null ? void 0 : _e.headers
    };
    await result.stream.pipeTo(transform.writable, {
      signal: pipeAbortController.signal
    });
  })().catch((error) => {
    const reason = error != null ? error : new Error("Transcription stream was cancelled or errored.");
    rejectPendingPromises(reason);
    audio.cancel(reason).catch(() => {
    });
    transform.writable.abort(reason).catch(() => {
    });
  });
  let streamOwner = "unclaimed";
  function consumeStream2() {
    if (streamOwner === "full-stream" || streamOwner === "result-promises") {
      return;
    }
    streamOwner = "result-promises";
    const reader = transform.readable.getReader();
    void (async () => {
      while (!(await reader.read()).done) {
      }
    })().catch(() => {
    });
  }
  function getFullStream() {
    if (streamOwner !== "unclaimed") {
      throw new Error(
        streamOwner === "full-stream" ? "fullStream can only be accessed once." : "fullStream cannot be accessed after a result promise."
      );
    }
    streamOwner = "full-stream";
    return asAsyncIterableStream(transform.readable);
  }
  return {
    get text() {
      consumeStream2();
      return textPromise.promise;
    },
    get segments() {
      consumeStream2();
      return segmentsPromise.promise;
    },
    get language() {
      consumeStream2();
      return languagePromise.promise;
    },
    get durationInSeconds() {
      consumeStream2();
      return durationInSecondsPromise.promise;
    },
    get warnings() {
      consumeStream2();
      return warningsPromise.promise;
    },
    get responses() {
      consumeStream2();
      return responsesPromise.promise;
    },
    get providerMetadata() {
      consumeStream2();
      return providerMetadataPromise.promise;
    },
    get fullStream() {
      return getFullStream();
    }
  };
}

// src/transcribe/index.ts
var experimental_transcribe = transcribe;

// src/ui/call-completion-api.ts
import {
  parseJsonEventStream,
  withUserAgentSuffix as withUserAgentSuffix12,
  getRuntimeEnvironmentUserAgent as getRuntimeEnvironmentUserAgent2
} from "@ai-sdk/provider-utils";

// src/ui/process-text-stream.ts
async function processTextStream({
  stream,
  onTextPart
}) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    await onTextPart(value);
  }
}

// src/ui/call-completion-api.ts
var getOriginalFetch = () => fetch;
async function callCompletionApi({
  api,
  prompt,
  credentials,
  headers,
  body,
  streamProtocol = "data",
  setCompletion,
  setLoading,
  setError,
  setAbortController,
  onFinish,
  onError,
  fetch: fetch2 = getOriginalFetch()
}) {
  var _a22;
  try {
    setLoading(true);
    setError(void 0);
    const abortController = new AbortController();
    setAbortController(abortController);
    setCompletion("");
    const response = await fetch2(api, {
      method: "POST",
      body: JSON.stringify({
        prompt,
        ...body
      }),
      credentials,
      headers: withUserAgentSuffix12(
        {
          "Content-Type": "application/json",
          ...headers
        },
        `ai-sdk/${VERSION}`,
        getRuntimeEnvironmentUserAgent2()
      ),
      signal: abortController.signal
    }).catch((err) => {
      throw err;
    });
    if (!response.ok) {
      throw new Error(
        (_a22 = await response.text()) != null ? _a22 : "Failed to fetch the chat response."
      );
    }
    if (!response.body) {
      throw new Error("The response body is empty.");
    }
    let result = "";
    switch (streamProtocol) {
      case "text": {
        await processTextStream({
          stream: response.body,
          onTextPart: (chunk) => {
            result += chunk;
            setCompletion(result);
          }
        });
        break;
      }
      case "data": {
        await consumeStream({
          stream: parseJsonEventStream({
            stream: response.body,
            schema: uiMessageChunkSchema
          }).pipeThrough(
            new TransformStream({
              async transform(part) {
                if (!part.success) {
                  throw part.error;
                }
                const streamPart = part.value;
                if (streamPart.type === "text-delta") {
                  result += streamPart.delta;
                  setCompletion(result);
                } else if (streamPart.type === "error") {
                  throw new Error(streamPart.errorText);
                }
              }
            })
          ),
          onError: (error) => {
            throw error;
          }
        });
        break;
      }
      default: {
        const exhaustiveCheck = streamProtocol;
        throw new Error(`Unknown stream protocol: ${exhaustiveCheck}`);
      }
    }
    if (onFinish) {
      onFinish(prompt, result);
    }
    setAbortController(null);
    return result;
  } catch (err) {
    if (err.name === "AbortError") {
      setAbortController(null);
      return null;
    }
    if (err instanceof Error) {
      if (onError) {
        onError(err);
      }
    }
    setError(err);
  } finally {
    setLoading(false);
  }
}

// src/ui/chat.ts
import {
  generateId as generateIdFunc2
} from "@ai-sdk/provider-utils";

// src/ui/convert-file-list-to-file-ui-parts.ts
async function convertFileListToFileUIParts(files) {
  if (files == null) {
    return [];
  }
  if (!globalThis.FileList || !(files instanceof globalThis.FileList)) {
    throw new Error("FileList is not supported in the current environment");
  }
  return Promise.all(
    Array.from(files).map(async (file) => {
      const { name: name22, type } = file;
      const dataUrl = await new Promise((resolve3, reject) => {
        const reader = new FileReader();
        reader.onload = (readerEvent) => {
          var _a22;
          resolve3((_a22 = readerEvent.target) == null ? void 0 : _a22.result);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
      });
      return {
        type: "file",
        mediaType: type,
        filename: name22,
        url: dataUrl
      };
    })
  );
}

// src/ui/default-chat-transport.ts
import { parseJsonEventStream as parseJsonEventStream2 } from "@ai-sdk/provider-utils";

// src/ui/http-chat-transport.ts
import {
  normalizeHeaders,
  resolve as resolve2
} from "@ai-sdk/provider-utils";
var HttpChatTransport = class {
  constructor({
    api = "/api/chat",
    credentials,
    headers,
    body,
    fetch: fetch2,
    prepareSendMessagesRequest,
    prepareReconnectToStreamRequest
  }) {
    this.api = api;
    this.credentials = credentials;
    this.headers = headers;
    this.body = body;
    this.fetch = fetch2;
    this.prepareSendMessagesRequest = prepareSendMessagesRequest;
    this.prepareReconnectToStreamRequest = prepareReconnectToStreamRequest;
  }
  async sendMessages({
    abortSignal,
    ...options
  }) {
    var _a22, _b, _c, _d, _e;
    const resolvedBody = await resolve2(this.body);
    const resolvedHeaders = await resolve2(this.headers);
    const resolvedCredentials = await resolve2(this.credentials);
    const baseHeaders = {
      ...normalizeHeaders(resolvedHeaders),
      ...normalizeHeaders(options.headers)
    };
    const preparedRequest = await ((_a22 = this.prepareSendMessagesRequest) == null ? void 0 : _a22.call(this, {
      api: this.api,
      id: options.chatId,
      messages: options.messages,
      body: { ...resolvedBody, ...options.body },
      headers: baseHeaders,
      credentials: resolvedCredentials,
      requestMetadata: options.metadata,
      trigger: options.trigger,
      messageId: options.messageId
    }));
    const api = (_b = preparedRequest == null ? void 0 : preparedRequest.api) != null ? _b : this.api;
    const headers = (preparedRequest == null ? void 0 : preparedRequest.headers) !== void 0 ? normalizeHeaders(preparedRequest.headers) : baseHeaders;
    const body = (preparedRequest == null ? void 0 : preparedRequest.body) !== void 0 ? preparedRequest.body : {
      ...resolvedBody,
      ...options.body,
      id: options.chatId,
      messages: options.messages,
      trigger: options.trigger,
      messageId: options.messageId
    };
    const credentials = (_c = preparedRequest == null ? void 0 : preparedRequest.credentials) != null ? _c : resolvedCredentials;
    const fetch2 = (_d = this.fetch) != null ? _d : globalThis.fetch;
    const response = await fetch2(api, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers
      },
      body: JSON.stringify(body),
      credentials,
      signal: abortSignal
    });
    if (!response.ok) {
      throw new Error(
        (_e = await response.text()) != null ? _e : "Failed to fetch the chat response."
      );
    }
    if (!response.body) {
      throw new Error("The response body is empty.");
    }
    return this.processResponseStream(response.body);
  }
  async reconnectToStream(options) {
    var _a22, _b, _c, _d, _e;
    const resolvedBody = await resolve2(this.body);
    const resolvedHeaders = await resolve2(this.headers);
    const resolvedCredentials = await resolve2(this.credentials);
    const baseHeaders = {
      ...normalizeHeaders(resolvedHeaders),
      ...normalizeHeaders(options.headers)
    };
    const preparedRequest = await ((_a22 = this.prepareReconnectToStreamRequest) == null ? void 0 : _a22.call(this, {
      api: this.api,
      id: options.chatId,
      body: { ...resolvedBody, ...options.body },
      headers: baseHeaders,
      credentials: resolvedCredentials,
      requestMetadata: options.metadata
    }));
    const api = (_b = preparedRequest == null ? void 0 : preparedRequest.api) != null ? _b : `${this.api}/${options.chatId}/stream`;
    const headers = (preparedRequest == null ? void 0 : preparedRequest.headers) !== void 0 ? normalizeHeaders(preparedRequest.headers) : baseHeaders;
    const credentials = (_c = preparedRequest == null ? void 0 : preparedRequest.credentials) != null ? _c : resolvedCredentials;
    const fetch2 = (_d = this.fetch) != null ? _d : globalThis.fetch;
    const response = await fetch2(api, {
      method: "GET",
      headers,
      credentials
    });
    if (response.status === 204) {
      return null;
    }
    if (!response.ok) {
      throw new Error(
        (_e = await response.text()) != null ? _e : "Failed to fetch the chat response."
      );
    }
    if (!response.body) {
      throw new Error("The response body is empty.");
    }
    return this.processResponseStream(response.body);
  }
};

// src/ui/default-chat-transport.ts
var DefaultChatTransport = class extends HttpChatTransport {
  constructor(options = {}) {
    super(options);
  }
  processResponseStream(stream) {
    return parseJsonEventStream2({
      stream,
      schema: uiMessageChunkSchema
    }).pipeThrough(
      new TransformStream({
        async transform(chunk, controller) {
          if (!chunk.success) {
            throw chunk.error;
          }
          controller.enqueue(chunk.value);
        }
      })
    );
  }
};

// src/ui/chat.ts
var AbstractChat = class {
  constructor({
    generateId: generateId2 = generateIdFunc2,
    id = generateId2(),
    transport = new DefaultChatTransport(),
    messageMetadataSchema,
    dataPartSchemas,
    state,
    onError,
    onToolCall,
    onFinish,
    onData,
    sendAutomaticallyWhen
  }) {
    this.activeResponse = void 0;
    this.jobExecutor = new SerialJobExecutor();
    /**
     * Appends or replaces a user message to the chat list. This triggers the API call to fetch
     * the assistant's response.
     *
     * If a messageId is provided, the message will be replaced.
     */
    this.sendMessage = async (message, options) => {
      var _a22, _b, _c, _d;
      if (message == null) {
        await this.makeRequest({
          trigger: "submit-message",
          messageId: (_a22 = this.lastMessage) == null ? void 0 : _a22.id,
          ...options
        });
        return;
      }
      let uiMessage;
      if ("text" in message || "files" in message) {
        const fileParts = Array.isArray(message.files) ? message.files : await convertFileListToFileUIParts(message.files);
        uiMessage = {
          parts: [
            ...fileParts,
            ..."text" in message && message.text != null ? [{ type: "text", text: message.text }] : []
          ]
        };
      } else {
        uiMessage = message;
      }
      if (message.messageId != null) {
        const messageIndex = this.state.messages.findIndex(
          (m) => m.id === message.messageId
        );
        if (messageIndex === -1) {
          throw new Error(`message with id ${message.messageId} not found`);
        }
        if (this.state.messages[messageIndex].role !== "user") {
          throw new Error(
            `message with id ${message.messageId} is not a user message`
          );
        }
        this.state.messages = this.state.messages.slice(0, messageIndex + 1);
        this.state.replaceMessage(messageIndex, {
          ...uiMessage,
          id: message.messageId,
          role: (_b = uiMessage.role) != null ? _b : "user",
          metadata: message.metadata
        });
      } else {
        this.state.pushMessage({
          ...uiMessage,
          id: (_c = uiMessage.id) != null ? _c : this.generateId(),
          role: (_d = uiMessage.role) != null ? _d : "user",
          metadata: message.metadata
        });
      }
      await this.makeRequest({
        trigger: "submit-message",
        messageId: message.messageId,
        ...options
      });
    };
    /**
     * Regenerate the assistant message with the provided message id.
     * If no message id is provided, the last assistant message will be regenerated.
     */
    this.regenerate = async ({
      messageId,
      ...options
    } = {}) => {
      const messageIndex = messageId == null ? this.state.messages.length - 1 : this.state.messages.findIndex((message) => message.id === messageId);
      if (messageIndex === -1) {
        throw new Error(`message ${messageId} not found`);
      }
      this.state.messages = this.state.messages.slice(
        0,
        // if the message is a user message, we need to include it in the request:
        this.messages[messageIndex].role === "assistant" ? messageIndex : messageIndex + 1
      );
      await this.makeRequest({
        trigger: "regenerate-message",
        messageId,
        ...options
      });
    };
    /**
     * Attempt to resume an ongoing streaming response.
     */
    this.resumeStream = async (options = {}) => {
      await this.makeRequest({ trigger: "resume-stream", ...options });
    };
    /**
     * Clear the error state and set the status to ready if the chat is in an error state.
     */
    this.clearError = () => {
      if (this.status === "error") {
        this.state.error = void 0;
        this.setStatus({ status: "ready" });
      }
    };
    this.addToolApprovalResponse = async ({
      id,
      approved,
      reason,
      options
    }) => this.jobExecutor.run(async () => {
      const messages = this.state.messages;
      const lastMessage = messages[messages.length - 1];
      const updatePart = (part) => isToolUIPart(part) && part.state === "approval-requested" && part.approval.id === id ? {
        ...part,
        state: "approval-responded",
        approval: { ...part.approval, id, approved, reason }
      } : part;
      this.state.replaceMessage(messages.length - 1, {
        ...lastMessage,
        parts: lastMessage.parts.map(updatePart)
      });
      if (this.activeResponse) {
        this.activeResponse.state.message.parts = this.activeResponse.state.message.parts.map(updatePart);
      }
      if (this.status !== "streaming" && this.status !== "submitted" && this.sendAutomaticallyWhen) {
        this.shouldSendAutomatically().then((shouldSend) => {
          var _a22;
          if (shouldSend) {
            this.makeRequest({
              trigger: "submit-message",
              messageId: (_a22 = this.lastMessage) == null ? void 0 : _a22.id,
              ...options
            });
          }
        });
      }
    });
    this.addToolOutput = async ({
      state = "output-available",
      toolCallId,
      output,
      errorText,
      options
    }) => this.jobExecutor.run(async () => {
      const messages = this.state.messages;
      const lastMessage = messages[messages.length - 1];
      const updatePart = (part) => isToolUIPart(part) && part.toolCallId === toolCallId ? { ...part, state, output, errorText } : part;
      this.state.replaceMessage(messages.length - 1, {
        ...lastMessage,
        parts: lastMessage.parts.map(updatePart)
      });
      if (this.activeResponse) {
        this.activeResponse.state.message.parts = this.activeResponse.state.message.parts.map(updatePart);
      }
      if (this.status !== "streaming" && this.status !== "submitted" && this.sendAutomaticallyWhen) {
        this.shouldSendAutomatically().then((shouldSend) => {
          var _a22;
          if (shouldSend) {
            this.makeRequest({
              trigger: "submit-message",
              messageId: (_a22 = this.lastMessage) == null ? void 0 : _a22.id,
              ...options
            });
          }
        });
      }
    });
    /** @deprecated Use addToolOutput */
    this.addToolResult = this.addToolOutput;
    /**
     * Abort the current request immediately, keep the generated tokens if any.
     */
    this.stop = async () => {
      var _a22;
      if (this.status !== "streaming" && this.status !== "submitted")
        return;
      if ((_a22 = this.activeResponse) == null ? void 0 : _a22.abortController) {
        this.activeResponse.abortController.abort();
      }
    };
    this.id = id;
    this.transport = transport;
    this.generateId = generateId2;
    this.messageMetadataSchema = messageMetadataSchema;
    this.dataPartSchemas = dataPartSchemas;
    this.state = state;
    this.onError = onError;
    this.onToolCall = onToolCall;
    this.onFinish = onFinish;
    this.onData = onData;
    this.sendAutomaticallyWhen = sendAutomaticallyWhen;
  }
  /**
   * Hook status:
   *
   * - `submitted`: The message has been sent to the API and we're awaiting the start of the response stream.
   * - `streaming`: The response is actively streaming in from the API, receiving chunks of data.
   * - `ready`: The full response has been received and processed; a new user message can be submitted.
   * - `error`: An error occurred during the API request, preventing successful completion.
   */
  get status() {
    return this.state.status;
  }
  setStatus({
    status,
    error
  }) {
    if (this.status === status)
      return;
    this.state.status = status;
    this.state.error = error;
  }
  get error() {
    return this.state.error;
  }
  get messages() {
    return this.state.messages;
  }
  get lastMessage() {
    return this.state.messages[this.state.messages.length - 1];
  }
  set messages(messages) {
    this.state.messages = messages;
  }
  async shouldSendAutomatically() {
    if (!this.sendAutomaticallyWhen)
      return false;
    const result = this.sendAutomaticallyWhen({
      messages: this.state.messages
    });
    if (result && typeof result === "object" && "then" in result) {
      return await result;
    }
    return result;
  }
  async makeRequest({
    trigger,
    metadata,
    headers,
    body,
    messageId
  }) {
    var _a22, _b;
    let resumeStream;
    if (trigger === "resume-stream") {
      try {
        const reconnect = await this.transport.reconnectToStream({
          chatId: this.id,
          metadata,
          headers,
          body
        });
        if (reconnect == null) {
          return;
        }
        resumeStream = reconnect;
      } catch (err) {
        if (this.onError && err instanceof Error) {
          this.onError(err);
        }
        this.setStatus({ status: "error", error: err });
        return;
      }
    }
    this.setStatus({ status: "submitted", error: void 0 });
    const lastMessage = this.lastMessage;
    let isAbort = false;
    let isDisconnect = false;
    let isError = false;
    let activeResponse;
    try {
      const response = {
        state: createStreamingUIMessageState({
          lastMessage: this.state.snapshot(lastMessage),
          messageId: this.generateId()
        }),
        abortController: new AbortController()
      };
      activeResponse = response;
      response.abortController.signal.addEventListener("abort", () => {
        isAbort = true;
      });
      this.activeResponse = response;
      let stream;
      if (trigger === "resume-stream") {
        stream = resumeStream;
      } else {
        stream = await this.transport.sendMessages({
          chatId: this.id,
          messages: this.state.messages,
          abortSignal: response.abortController.signal,
          metadata,
          headers,
          body,
          trigger,
          messageId
        });
      }
      const runUpdateMessageJob = (job) => (
        // serialize the job execution to avoid race conditions:
        this.jobExecutor.run(
          () => job({
            state: response.state,
            write: () => {
              var _a23;
              this.setStatus({ status: "streaming" });
              const replaceLastMessage = response.state.message.id === ((_a23 = this.lastMessage) == null ? void 0 : _a23.id);
              if (replaceLastMessage) {
                this.state.replaceMessage(
                  this.state.messages.length - 1,
                  response.state.message
                );
              } else {
                this.state.pushMessage(response.state.message);
              }
            }
          })
        )
      );
      await consumeStream({
        stream: processUIMessageStream({
          stream,
          onToolCall: this.onToolCall,
          onData: this.onData,
          messageMetadataSchema: this.messageMetadataSchema,
          dataPartSchemas: this.dataPartSchemas,
          runUpdateMessageJob,
          onError: (error) => {
            throw error;
          }
        }),
        onError: (error) => {
          throw error;
        }
      });
      this.setStatus({ status: "ready" });
    } catch (err) {
      if (isAbort || err.name === "AbortError") {
        isAbort = true;
        this.setStatus({ status: "ready" });
        return null;
      }
      isError = true;
      if (err instanceof TypeError && (err.message.toLowerCase().includes("fetch") || err.message.toLowerCase().includes("network"))) {
        isDisconnect = true;
      }
      if (this.onError && err instanceof Error) {
        this.onError(err);
      }
      this.setStatus({ status: "error", error: err });
    } finally {
      try {
        if (activeResponse) {
          (_a22 = this.onFinish) == null ? void 0 : _a22.call(this, {
            message: activeResponse.state.message,
            messages: this.state.messages,
            isAbort,
            isDisconnect,
            isError,
            finishReason: activeResponse.state.finishReason
          });
        }
      } catch (err) {
        console.error(err);
      }
      if (this.activeResponse === activeResponse) {
        this.activeResponse = void 0;
      }
    }
    if (!isError && await this.shouldSendAutomatically()) {
      await this.makeRequest({
        trigger: "submit-message",
        messageId: (_b = this.lastMessage) == null ? void 0 : _b.id,
        metadata,
        headers,
        body
      });
    }
  }
};

// src/ui/direct-chat-transport.ts
var DirectChatTransport = class {
  constructor({
    agent,
    options,
    ...uiMessageStreamOptions
  }) {
    this.agent = agent;
    this.agentOptions = options;
    this.uiMessageStreamOptions = uiMessageStreamOptions;
  }
  async sendMessages({
    messages,
    abortSignal
  }) {
    const validatedMessages = await validateUIMessages({
      messages,
      // tools are compatible; the casting is required because the context param is
      // not available in ui messages
      tools: this.agent.tools
    });
    const modelMessages = await convertToModelMessages(validatedMessages, {
      tools: this.agent.tools
    });
    const result = await this.agent.stream({
      prompt: modelMessages,
      abortSignal,
      ...this.agentOptions !== void 0 ? { options: this.agentOptions } : {}
    });
    return toUIMessageStream({
      ...this.uiMessageStreamOptions,
      stream: result.stream,
      tools: this.agent.tools
    });
  }
  /**
   * Direct transport does not support reconnection since there is no
   * persistent server-side stream to reconnect to.
   *
   * @returns Always returns `null`
   */
  async reconnectToStream(_options) {
    return null;
  }
};

// src/ui/last-assistant-message-is-complete-with-approval-responses.ts
function lastAssistantMessageIsCompleteWithApprovalResponses({
  messages
}) {
  const message = messages[messages.length - 1];
  if (!message) {
    return false;
  }
  if (message.role !== "assistant") {
    return false;
  }
  const lastStepStartIndex = message.parts.reduce((lastIndex, part, index) => {
    return part.type === "step-start" ? index : lastIndex;
  }, -1);
  const lastStepToolInvocations = message.parts.slice(lastStepStartIndex + 1).filter(isToolUIPart);
  return (
    // has at least one tool approval response
    lastStepToolInvocations.filter((part) => part.state === "approval-responded").length > 0 && // all tool approvals must have a response
    lastStepToolInvocations.every(
      (part) => part.state === "output-available" || part.state === "output-error" || part.state === "approval-responded"
    )
  );
}

// src/ui/last-assistant-message-is-complete-with-tool-calls.ts
function lastAssistantMessageIsCompleteWithToolCalls({
  messages
}) {
  const message = messages[messages.length - 1];
  if (!message) {
    return false;
  }
  if (message.role !== "assistant") {
    return false;
  }
  const lastStepStartIndex = message.parts.reduce((lastIndex, part, index) => {
    return part.type === "step-start" ? index : lastIndex;
  }, -1);
  const lastStepToolInvocations = message.parts.slice(lastStepStartIndex + 1).filter(isToolUIPart).filter((part) => !part.providerExecuted);
  return lastStepToolInvocations.length > 0 && lastStepToolInvocations.every(
    (part) => part.state === "output-available" || part.state === "output-error"
  );
}

// src/ui/transform-text-to-ui-message-stream.ts
function transformTextToUiMessageStream({
  stream
}) {
  return stream.pipeThrough(
    new TransformStream({
      start(controller) {
        controller.enqueue({ type: "start" });
        controller.enqueue({ type: "start-step" });
        controller.enqueue({ type: "text-start", id: "text-1" });
      },
      async transform(part, controller) {
        controller.enqueue({ type: "text-delta", id: "text-1", delta: part });
      },
      async flush(controller) {
        controller.enqueue({ type: "text-end", id: "text-1" });
        controller.enqueue({ type: "finish-step" });
        controller.enqueue({ type: "finish" });
      }
    })
  );
}

// src/ui/text-stream-chat-transport.ts
var TextStreamChatTransport = class extends HttpChatTransport {
  constructor(options = {}) {
    super(options);
  }
  processResponseStream(stream) {
    return transformTextToUiMessageStream({
      stream: stream.pipeThrough(new TextDecoderStream())
    });
  }
};

// src/upload-file/upload-file.ts
import {
  convertBase64ToUint8Array as convertBase64ToUint8Array6,
  detectMediaType as detectMediaType6
} from "@ai-sdk/provider-utils";
async function uploadFile({
  api,
  data: dataArg,
  mediaType: mediaTypeArg,
  filename,
  providerOptions
}) {
  var _a22;
  const data = dataArg instanceof Uint8Array || typeof dataArg === "string" ? { type: "data", data: dataArg } : dataArg;
  const mediaType = mediaTypeArg != null ? mediaTypeArg : data.type === "text" ? "text/plain" : (_a22 = detectMediaType6({ data: data.data })) != null ? _a22 : isLikelyText(data.data) ? "text/plain" : "application/octet-stream";
  const filesApi = "uploadFile" in api ? api : typeof api.files === "function" ? api.files() : (() => {
    throw new Error(
      "The provider does not support file uploads. Make sure it exposes a files() method."
    );
  })();
  const result = await filesApi.uploadFile({
    data,
    mediaType,
    filename,
    providerOptions
  });
  return new DefaultUploadFileResult({
    providerReference: result.providerReference,
    mediaType: result.mediaType,
    filename: result.filename,
    providerMetadata: result.providerMetadata,
    warnings: result.warnings
  });
}
var DefaultUploadFileResult = class {
  constructor(options) {
    this.providerReference = options.providerReference;
    this.mediaType = options.mediaType;
    this.filename = options.filename;
    this.providerMetadata = options.providerMetadata;
    this.warnings = options.warnings;
  }
};
function isLikelyText(data) {
  const CHECK_LENGTH = 512;
  const BASE64_CHECK_LENGTH = Math.ceil((CHECK_LENGTH + 4) / 3) * 4;
  const bytes = typeof data === "string" ? convertBase64ToUint8Array6(
    data.substring(0, Math.min(data.length, BASE64_CHECK_LENGTH))
  ) : data;
  const checkLength = Math.min(bytes.length, CHECK_LENGTH);
  if (checkLength === 0)
    return false;
  for (let i = 0; i < checkLength; i++) {
    const byte = bytes[i];
    if (byte === 0 || byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      return false;
    }
  }
  return true;
}

// src/upload-skill/upload-skill.ts
async function uploadSkill({
  api,
  files,
  displayTitle,
  providerOptions
}) {
  const skillsApi = "uploadSkill" in api ? api : typeof api.skills === "function" ? api.skills() : (() => {
    throw new Error(
      "The provider does not support skills. Make sure it exposes a skills() method."
    );
  })();
  const normalizedFiles = files.map((file) => ({
    ...file,
    data: file.data instanceof Uint8Array || typeof file.data === "string" ? { type: "data", data: file.data } : file.data
  }));
  const result = await skillsApi.uploadSkill({
    files: normalizedFiles,
    displayTitle,
    providerOptions
  });
  return result;
}
export {
  AISDKError22 as AISDKError,
  AI_SDK_TELEMETRY_TRACING_CHANNEL,
  APICallError,
  AbstractChat,
  DefaultChatTransport,
  DefaultGeneratedFile,
  DirectChatTransport,
  DownloadError,
  EmptyResponseBodyError,
  AbstractRealtimeSession as Experimental_AbstractRealtimeSession,
  ToolLoopAgent as Experimental_Agent,
  HttpChatTransport,
  InvalidArgumentError,
  InvalidDataContentError,
  InvalidMessageRoleError,
  InvalidPromptError,
  InvalidResponseDataError,
  InvalidStreamPartError,
  InvalidToolApprovalError,
  InvalidToolApprovalSignatureError,
  InvalidToolInputError,
  JSONParseError,
  JsonToSseTransformStream,
  LoadAPIKeyError,
  LoadSettingError,
  MessageConversionError,
  MissingToolResultsError,
  NoContentGeneratedError,
  NoImageGeneratedError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  NoSpeechGeneratedError,
  NoSuchModelError,
  NoSuchProviderError,
  NoSuchProviderReferenceError,
  NoSuchToolError,
  NoTranscriptGeneratedError,
  NoVideoGeneratedError,
  output_exports as Output,
  RetryError,
  SerialJobExecutor,
  TextStreamChatTransport,
  TooManyEmbeddingValuesForCallError,
  ToolCallNotFoundForApprovalError,
  ToolCallRepairError,
  ToolLoopAgent,
  TypeValidationError,
  UIMessageStreamError,
  UI_MESSAGE_STREAM_HEADERS,
  UnsupportedFunctionalityError,
  UnsupportedModelVersionError,
  addToolInputExamplesMiddleware,
  asSchema8 as asSchema,
  assistantModelMessageSchema,
  callCompletionApi,
  consumeStream,
  convertDataContentToBase64String,
  convertFileListToFileUIParts,
  convertToModelMessages,
  cosineSimilarity,
  createAgentUIStream,
  createAgentUIStreamResponse,
  createDownload,
  createGateway,
  createIdGenerator9 as createIdGenerator,
  createProviderRegistry,
  createTextStreamResponse,
  createUIMessageStream,
  createUIMessageStreamResponse,
  customProvider,
  defaultEmbeddingSettingsMiddleware,
  defaultSettingsMiddleware,
  detectToolDrift,
  dynamicTool,
  embed,
  embedMany,
  experimental_createProviderRegistry,
  decodeRealtimeAudio as experimental_decodeRealtimeAudio,
  encodeRealtimeAudio as experimental_encodeRealtimeAudio,
  filterActiveTools as experimental_filterActiveTools,
  experimental_generateSpeech,
  experimental_generateVideo,
  getRealtimeToolDefinitions as experimental_getRealtimeToolDefinitions,
  resampleAudio as experimental_resampleAudio,
  streamLanguageModelCall as experimental_streamLanguageModelCall,
  streamTranscribe as experimental_streamTranscribe,
  experimental_transcribe,
  extractJsonMiddleware,
  extractReasoningMiddleware,
  fingerprintTools,
  gateway2 as gateway,
  generateId,
  generateImage,
  generateObject,
  generateSpeech,
  generateText,
  getChunkTimeoutMs,
  getFirstChunkTimeoutMs,
  getStaticToolName,
  getStepTimeoutMs,
  getTextFromDataUrl,
  getToolName,
  getToolOrDynamicToolName,
  getToolTimeoutMs,
  getTotalTimeoutMs,
  hasToolCall,
  isCustomContentUIPart,
  isDataUIPart,
  isDeepEqualData,
  isDynamicToolUIPart,
  isFileUIPart,
  isLoopFinished,
  isReasoningFileUIPart,
  isReasoningUIPart,
  isStaticToolUIPart,
  isStepCount,
  isTextUIPart,
  isToolUIPart,
  jsonSchema,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  modelMessageSchema,
  parseJsonEventStream3 as parseJsonEventStream,
  parsePartialJson,
  pipeAgentUIStreamToResponse,
  pipeTextStreamToResponse,
  pipeUIMessageStreamToResponse,
  pruneMessages,
  readUIMessageStream,
  registerTelemetry,
  rerank,
  safeValidateUIMessages,
  simulateReadableStream,
  simulateStreamingMiddleware,
  smoothStream,
  isStepCount as stepCountIs,
  streamObject,
  streamText,
  systemModelMessageSchema,
  toTextStream,
  toUIMessageChunk,
  toUIMessageStream,
  tool,
  toolModelMessageSchema,
  transcribe,
  uiMessageChunkSchema,
  uploadFile,
  uploadSkill,
  userModelMessageSchema,
  validateUIMessages,
  wrapEmbeddingModel,
  wrapImageModel,
  wrapLanguageModel,
  wrapProvider,
  zodSchema3 as zodSchema
};
//# sourceMappingURL=index.js.map