// src/openai-provider.ts
import {
  loadApiKey,
  loadOptionalSetting,
  validateBaseURL,
  withoutTrailingSlash,
  withUserAgentSuffix
} from "@ai-sdk/provider-utils";

// src/chat/openai-chat-language-model.ts
import {
  StreamingToolCallTracker,
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  generateId,
  isCustomReasoning,
  parseProviderOptions,
  postJsonToApi,
  serializeModelOptions,
  WORKFLOW_DESERIALIZE,
  WORKFLOW_SERIALIZE
} from "@ai-sdk/provider-utils";

// src/openai-error.ts
import { z } from "zod/v4";
import { createJsonErrorResponseHandler } from "@ai-sdk/provider-utils";
var openaiErrorDataSchema = z.object({
  error: z.object({
    message: z.string(),
    // The additional information below is handled loosely to support
    // OpenAI-compatible providers that have slightly different error
    // responses:
    type: z.string().nullish(),
    param: z.any().nullish(),
    code: z.union([z.string(), z.number()]).nullish()
  })
});
var openaiFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: openaiErrorDataSchema,
  errorToMessage: (data) => data.error.message
});

// src/openai-language-model-capabilities.ts
function getOpenAILanguageModelCapabilities(modelId) {
  var _a, _b, _c, _d, _e;
  const oSeriesVersion = getOSeriesVersion(modelId);
  const gptVersion = getGptVersion(modelId);
  const isGptChatModel = (gptVersion == null ? void 0 : gptVersion.minor) == null && ((_b = (_a = gptVersion == null ? void 0 : gptVersion.variant) == null ? void 0 : _a.startsWith("chat")) != null ? _b : false);
  const isGptNanoModel = (_d = (_c = gptVersion == null ? void 0 : gptVersion.variant) == null ? void 0 : _c.startsWith("nano")) != null ? _d : false;
  const supportsFlexProcessing = oSeriesVersion != null && oSeriesVersion >= 3 || gptVersion != null && gptVersion.major >= 5 && !isGptChatModel;
  const supportsPriorityProcessing = modelId.startsWith("gpt-4") || gptVersion != null && gptVersion.major >= 5 && !isGptNanoModel && !isGptChatModel || oSeriesVersion != null && oSeriesVersion >= 3;
  const isReasoningModel = oSeriesVersion != null || gptVersion != null && gptVersion.major >= 5 && !isGptChatModel;
  const supportsNonReasoningParameters = gptVersion != null && (gptVersion.major > 5 || gptVersion.major === 5 && ((_e = gptVersion.minor) != null ? _e : 0) >= 1);
  const systemMessageMode = isReasoningModel ? "developer" : "system";
  return {
    supportsFlexProcessing,
    supportsPriorityProcessing,
    isReasoningModel,
    systemMessageMode,
    supportsNonReasoningParameters
  };
}
function getOSeriesVersion(modelId) {
  const match = /^o(\d+)(?:-|$)/.exec(modelId);
  return match == null ? void 0 : Number(match[1]);
}
function getGptVersion(modelId) {
  const match = /^gpt-(\d+)(?:\.(\d+))?(?:-(.+))?$/.exec(modelId);
  if (match == null) {
    return void 0;
  }
  return {
    major: Number(match[1]),
    minor: match[2] == null ? void 0 : Number(match[2]),
    variant: match[3]
  };
}

// src/openai-stream-error.ts
import { APICallError } from "@ai-sdk/provider";
async function throwIfOpenAIStreamErrorBeforeOutput({
  stream,
  getError,
  isOutputChunk,
  url,
  requestBodyValues,
  responseHeaders
}) {
  const [streamForEarlyError, streamForConsumer] = stream.tee();
  const reader = streamForEarlyError.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        return streamForConsumer;
      }
      const chunk = result.value;
      if (!chunk.success) {
        return streamForConsumer;
      }
      const errorFrame = getError(chunk.value);
      if (errorFrame != null) {
        streamForConsumer.cancel().catch(() => {
        });
        throw createOpenAIStreamError({
          frame: errorFrame,
          url,
          requestBodyValues,
          responseHeaders
        });
      }
      if (isOutputChunk(chunk.value)) {
        return streamForConsumer;
      }
    }
  } finally {
    reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
}
function createOpenAIStreamError({
  frame,
  url,
  requestBodyValues,
  responseHeaders
}) {
  var _a;
  const streamError = parseStreamError(frame);
  return new APICallError({
    message: (_a = streamError == null ? void 0 : streamError.message) != null ? _a : "OpenAI stream failed before any output was generated",
    url,
    requestBodyValues,
    statusCode: streamError == null ? 500 : getStatusCode(streamError),
    responseHeaders,
    responseBody: JSON.stringify(frame),
    data: frame
  });
}
function parseStreamError(frame) {
  var _a;
  const value = asRecord(frame);
  if (value == null) {
    return void 0;
  }
  if (value.type === "response.failed") {
    const response = asRecord(value.response);
    const responseError = asRecord(response == null ? void 0 : response.error);
    return typeof (responseError == null ? void 0 : responseError.message) === "string" ? {
      message: responseError.message,
      code: getStringOrNumber(responseError.code),
      type: "response.failed",
      frame
    } : void 0;
  }
  const error = (_a = asRecord(value.error)) != null ? _a : value;
  return typeof error.message === "string" && (asRecord(value.error) != null || typeof error.type === "string" || "code" in error || "param" in error) ? {
    message: error.message,
    code: getStringOrNumber(error.code),
    type: typeof error.type === "string" ? error.type : void 0,
    frame
  } : void 0;
}
function getStatusCode(error) {
  if (typeof error.code === "number" && isHttpErrorStatusCode(error.code)) {
    return error.code;
  }
  if (typeof error.code === "string" && /^\d{3}$/.test(error.code)) {
    const numericCode = Number(error.code);
    if (isHttpErrorStatusCode(numericCode)) {
      return numericCode;
    }
  }
  const discriminator = [error.code, error.type].filter((value) => typeof value === "string" || typeof value === "number").join(" ").toLowerCase();
  if (["insufficient_quota", "rate_limit"].some(
    (term) => discriminator.includes(term)
  )) {
    return 429;
  }
  if (discriminator.includes("authentication")) return 401;
  if (discriminator.includes("permission")) return 403;
  if (discriminator.includes("not_found")) return 404;
  if (["invalid", "bad_request", "context_length"].some(
    (term) => discriminator.includes(term)
  )) {
    return 400;
  }
  if (discriminator.includes("overload")) return 503;
  if (discriminator.includes("timeout")) return 504;
  return 500;
}
function asRecord(value) {
  return typeof value === "object" && value != null ? value : void 0;
}
function getStringOrNumber(value) {
  return typeof value === "string" || typeof value === "number" ? value : void 0;
}
function isHttpErrorStatusCode(value) {
  return Number.isInteger(value) && value >= 400 && value <= 599;
}

// src/chat/convert-openai-chat-usage.ts
function convertOpenAIChatUsage(usage) {
  var _a, _b, _c, _d, _e, _f, _g, _h;
  if (usage == null) {
    return {
      inputTokens: {
        total: void 0,
        noCache: void 0,
        cacheRead: void 0,
        cacheWrite: void 0
      },
      outputTokens: {
        total: void 0,
        text: void 0,
        reasoning: void 0
      },
      raw: void 0
    };
  }
  const promptTokens = (_a = usage.prompt_tokens) != null ? _a : 0;
  const completionTokens = (_b = usage.completion_tokens) != null ? _b : 0;
  const cachedTokens = (_d = (_c = usage.prompt_tokens_details) == null ? void 0 : _c.cached_tokens) != null ? _d : 0;
  const cacheWriteTokens = (_f = (_e = usage.prompt_tokens_details) == null ? void 0 : _e.cache_write_tokens) != null ? _f : void 0;
  const reasoningTokens = (_h = (_g = usage.completion_tokens_details) == null ? void 0 : _g.reasoning_tokens) != null ? _h : 0;
  return {
    inputTokens: {
      total: promptTokens,
      noCache: promptTokens - cachedTokens - (cacheWriteTokens != null ? cacheWriteTokens : 0),
      cacheRead: cachedTokens,
      cacheWrite: cacheWriteTokens
    },
    outputTokens: {
      total: completionTokens,
      text: completionTokens - reasoningTokens,
      reasoning: reasoningTokens
    },
    raw: usage
  };
}

// src/chat/convert-to-openai-chat-messages.ts
import {
  UnsupportedFunctionalityError
} from "@ai-sdk/provider";
import {
  convertToBase64,
  getTopLevelMediaType,
  resolveFullMediaType,
  resolveProviderReference
} from "@ai-sdk/provider-utils";
function serializeToolCallArguments(input) {
  return JSON.stringify(input === void 0 ? {} : input);
}
function getPromptCacheBreakpoint(providerOptions) {
  var _a;
  return (_a = providerOptions == null ? void 0 : providerOptions.openai) == null ? void 0 : _a.promptCacheBreakpoint;
}
function convertToOpenAIChatMessages({
  prompt,
  systemMessageMode = "system"
}) {
  var _a, _b;
  const messages = [];
  const warnings = [];
  for (const { role, content, providerOptions } of prompt) {
    switch (role) {
      case "system": {
        switch (systemMessageMode) {
          case "system": {
            const promptCacheBreakpoint = getPromptCacheBreakpoint(providerOptions);
            messages.push({
              role: "system",
              content: promptCacheBreakpoint == null ? content : [
                {
                  type: "text",
                  text: content,
                  prompt_cache_breakpoint: promptCacheBreakpoint
                }
              ]
            });
            break;
          }
          case "developer": {
            const promptCacheBreakpoint = getPromptCacheBreakpoint(providerOptions);
            messages.push({
              role: "developer",
              content: promptCacheBreakpoint == null ? content : [
                {
                  type: "text",
                  text: content,
                  prompt_cache_breakpoint: promptCacheBreakpoint
                }
              ]
            });
            break;
          }
          case "remove": {
            warnings.push({
              type: "other",
              message: "system messages are removed for this model"
            });
            break;
          }
          default: {
            const _exhaustiveCheck = systemMessageMode;
            throw new Error(
              `Unsupported system message mode: ${_exhaustiveCheck}`
            );
          }
        }
        break;
      }
      case "user": {
        if (content.length === 1 && content[0].type === "text" && getPromptCacheBreakpoint(content[0].providerOptions) == null) {
          messages.push({ role: "user", content: content[0].text });
          break;
        }
        messages.push({
          role: "user",
          content: content.map((part, index) => {
            var _a2, _b2, _c;
            switch (part.type) {
              case "text": {
                const promptCacheBreakpoint = getPromptCacheBreakpoint(
                  part.providerOptions
                );
                return {
                  type: "text",
                  text: part.text,
                  ...promptCacheBreakpoint != null && {
                    prompt_cache_breakpoint: promptCacheBreakpoint
                  }
                };
              }
              case "file": {
                const promptCacheBreakpoint = getPromptCacheBreakpoint(
                  part.providerOptions
                );
                switch (part.data.type) {
                  case "reference": {
                    return {
                      type: "file",
                      file: {
                        file_id: resolveProviderReference({
                          reference: part.data.reference,
                          provider: "openai"
                        })
                      },
                      ...promptCacheBreakpoint != null && {
                        prompt_cache_breakpoint: promptCacheBreakpoint
                      }
                    };
                  }
                  case "text": {
                    throw new UnsupportedFunctionalityError({
                      functionality: "text file parts"
                    });
                  }
                  case "url":
                  case "data": {
                    const topLevel = getTopLevelMediaType(part.mediaType);
                    if (topLevel === "image") {
                      return {
                        type: "image_url",
                        image_url: {
                          url: part.data.type === "url" ? part.data.url.toString() : `data:${resolveFullMediaType({ part })};base64,${convertToBase64(part.data.data)}`,
                          detail: (_b2 = (_a2 = part.providerOptions) == null ? void 0 : _a2.openai) == null ? void 0 : _b2.imageDetail
                        },
                        ...promptCacheBreakpoint != null && {
                          prompt_cache_breakpoint: promptCacheBreakpoint
                        }
                      };
                    } else if (topLevel === "audio") {
                      if (part.data.type === "url") {
                        throw new UnsupportedFunctionalityError({
                          functionality: "audio file parts with URLs"
                        });
                      }
                      const fullMediaType = resolveFullMediaType({ part });
                      switch (fullMediaType) {
                        case "audio/wav": {
                          return {
                            type: "input_audio",
                            input_audio: {
                              data: convertToBase64(part.data.data),
                              format: "wav"
                            },
                            ...promptCacheBreakpoint != null && {
                              prompt_cache_breakpoint: promptCacheBreakpoint
                            }
                          };
                        }
                        case "audio/mp3":
                        case "audio/mpeg": {
                          return {
                            type: "input_audio",
                            input_audio: {
                              data: convertToBase64(part.data.data),
                              format: "mp3"
                            },
                            ...promptCacheBreakpoint != null && {
                              prompt_cache_breakpoint: promptCacheBreakpoint
                            }
                          };
                        }
                        default: {
                          throw new UnsupportedFunctionalityError({
                            functionality: `audio content parts with media type ${fullMediaType}`
                          });
                        }
                      }
                    }
                    {
                      const fullMediaType = resolveFullMediaType({ part });
                      if (fullMediaType !== "application/pdf") {
                        throw new UnsupportedFunctionalityError({
                          functionality: `file part media type ${fullMediaType}`
                        });
                      }
                      if (part.data.type === "url") {
                        throw new UnsupportedFunctionalityError({
                          functionality: "PDF file parts with URLs"
                        });
                      }
                      return {
                        type: "file",
                        file: {
                          filename: (_c = part.filename) != null ? _c : `part-${index}.pdf`,
                          file_data: `data:application/pdf;base64,${convertToBase64(part.data.data)}`
                        },
                        ...promptCacheBreakpoint != null && {
                          prompt_cache_breakpoint: promptCacheBreakpoint
                        }
                      };
                    }
                  }
                }
              }
            }
          })
        });
        break;
      }
      case "assistant": {
        let text = "";
        const textParts = [];
        let hasPromptCacheBreakpoint = false;
        const toolCalls = [];
        for (const part of content) {
          switch (part.type) {
            case "text": {
              const promptCacheBreakpoint = getPromptCacheBreakpoint(
                part.providerOptions
              );
              text += part.text;
              textParts.push({
                type: "text",
                text: part.text,
                ...promptCacheBreakpoint != null && {
                  prompt_cache_breakpoint: promptCacheBreakpoint
                }
              });
              hasPromptCacheBreakpoint || (hasPromptCacheBreakpoint = promptCacheBreakpoint != null);
              break;
            }
            case "tool-call": {
              toolCalls.push({
                id: part.toolCallId,
                type: "function",
                function: {
                  name: part.toolName,
                  arguments: serializeToolCallArguments(part.input)
                }
              });
              break;
            }
          }
        }
        messages.push({
          role: "assistant",
          content: hasPromptCacheBreakpoint ? textParts : toolCalls.length > 0 ? text || null : text,
          tool_calls: toolCalls.length > 0 ? toolCalls : void 0
        });
        break;
      }
      case "tool": {
        for (const toolResponse of content) {
          if (toolResponse.type === "tool-approval-response") {
            continue;
          }
          const output = toolResponse.output;
          const promptCacheBreakpoint = (_a = output.type === "content" ? output.value.map((part) => getPromptCacheBreakpoint(part.providerOptions)).find((breakpoint) => breakpoint != null) : getPromptCacheBreakpoint(output.providerOptions)) != null ? _a : getPromptCacheBreakpoint(toolResponse.providerOptions);
          let contentValue;
          switch (output.type) {
            case "text":
            case "error-text":
              contentValue = output.value;
              break;
            case "execution-denied":
              contentValue = (_b = output.reason) != null ? _b : "Tool call execution denied.";
              break;
            case "content":
            case "json":
            case "error-json":
              contentValue = JSON.stringify(output.value);
              break;
          }
          messages.push({
            role: "tool",
            tool_call_id: toolResponse.toolCallId,
            content: promptCacheBreakpoint == null ? contentValue : [
              {
                type: "text",
                text: contentValue,
                prompt_cache_breakpoint: promptCacheBreakpoint
              }
            ]
          });
        }
        break;
      }
      default: {
        const _exhaustiveCheck = role;
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`);
      }
    }
  }
  return { messages, warnings };
}

// src/chat/get-response-metadata.ts
function getResponseMetadata({
  id,
  model,
  created
}) {
  return {
    id: id != null ? id : void 0,
    modelId: model != null ? model : void 0,
    timestamp: created ? new Date(created * 1e3) : void 0
  };
}

// src/chat/map-openai-finish-reason.ts
function mapOpenAIFinishReason(finishReason) {
  switch (finishReason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content_filter":
      return "content-filter";
    case "function_call":
    case "tool_calls":
      return "tool-calls";
    default:
      return "other";
  }
}

// src/chat/openai-chat-api.ts
import {
  lazySchema,
  zodSchema
} from "@ai-sdk/provider-utils";
import { z as z2 } from "zod/v4";
var openaiChatResponseSchema = lazySchema(
  () => zodSchema(
    z2.object({
      id: z2.string().nullish(),
      created: z2.number().nullish(),
      model: z2.string().nullish(),
      choices: z2.array(
        z2.object({
          message: z2.object({
            role: z2.literal("assistant").nullish(),
            content: z2.string().nullish(),
            tool_calls: z2.array(
              z2.object({
                id: z2.string().nullish(),
                type: z2.literal("function"),
                function: z2.object({
                  name: z2.string(),
                  arguments: z2.string()
                })
              })
            ).nullish(),
            annotations: z2.array(
              z2.object({
                type: z2.literal("url_citation"),
                url_citation: z2.object({
                  start_index: z2.number(),
                  end_index: z2.number(),
                  url: z2.string(),
                  title: z2.string()
                })
              })
            ).nullish()
          }),
          index: z2.number(),
          logprobs: z2.object({
            content: z2.array(
              z2.object({
                token: z2.string(),
                logprob: z2.number(),
                top_logprobs: z2.array(
                  z2.object({
                    token: z2.string(),
                    logprob: z2.number()
                  })
                )
              })
            ).nullish()
          }).nullish(),
          finish_reason: z2.string().nullish()
        })
      ),
      usage: z2.object({
        prompt_tokens: z2.number().nullish(),
        completion_tokens: z2.number().nullish(),
        total_tokens: z2.number().nullish(),
        prompt_tokens_details: z2.object({
          cached_tokens: z2.number().nullish(),
          cache_write_tokens: z2.number().nullish()
        }).nullish(),
        completion_tokens_details: z2.object({
          reasoning_tokens: z2.number().nullish(),
          accepted_prediction_tokens: z2.number().nullish(),
          rejected_prediction_tokens: z2.number().nullish()
        }).nullish()
      }).nullish()
    })
  )
);
var openaiChatChunkSchema = lazySchema(
  () => zodSchema(
    z2.union([
      z2.object({
        id: z2.string().nullish(),
        created: z2.number().nullish(),
        model: z2.string().nullish(),
        choices: z2.array(
          z2.object({
            delta: z2.object({
              role: z2.enum(["assistant"]).nullish(),
              content: z2.string().nullish(),
              tool_calls: z2.array(
                z2.object({
                  index: z2.number(),
                  id: z2.string().nullish(),
                  type: z2.literal("function").nullish(),
                  function: z2.object({
                    name: z2.string().nullish(),
                    arguments: z2.string().nullish()
                  })
                })
              ).nullish(),
              annotations: z2.array(
                z2.object({
                  type: z2.literal("url_citation"),
                  url_citation: z2.object({
                    start_index: z2.number(),
                    end_index: z2.number(),
                    url: z2.string(),
                    title: z2.string()
                  })
                })
              ).nullish()
            }).nullish(),
            logprobs: z2.object({
              content: z2.array(
                z2.object({
                  token: z2.string(),
                  logprob: z2.number(),
                  top_logprobs: z2.array(
                    z2.object({
                      token: z2.string(),
                      logprob: z2.number()
                    })
                  )
                })
              ).nullish()
            }).nullish(),
            finish_reason: z2.string().nullish(),
            index: z2.number()
          })
        ),
        usage: z2.object({
          prompt_tokens: z2.number().nullish(),
          completion_tokens: z2.number().nullish(),
          total_tokens: z2.number().nullish(),
          prompt_tokens_details: z2.object({
            cached_tokens: z2.number().nullish(),
            cache_write_tokens: z2.number().nullish()
          }).nullish(),
          completion_tokens_details: z2.object({
            reasoning_tokens: z2.number().nullish(),
            accepted_prediction_tokens: z2.number().nullish(),
            rejected_prediction_tokens: z2.number().nullish()
          }).nullish()
        }).nullish()
      }),
      openaiErrorDataSchema
    ])
  )
);

// src/chat/openai-chat-language-model-options.ts
import {
  lazySchema as lazySchema2,
  zodSchema as zodSchema2
} from "@ai-sdk/provider-utils";
import { z as z3 } from "zod/v4";
var openaiLanguageModelChatOptions = lazySchema2(
  () => zodSchema2(
    z3.object({
      /**
       * Modify the likelihood of specified tokens appearing in the completion.
       *
       * Accepts a JSON object that maps tokens (specified by their token ID in
       * the GPT tokenizer) to an associated bias value from -100 to 100.
       */
      logitBias: z3.record(z3.coerce.number(), z3.number()).optional(),
      /**
       * Return the log probabilities of the tokens.
       *
       * Setting to true will return the log probabilities of the tokens that
       * were generated.
       *
       * Setting to a number will return the log probabilities of the top n
       * tokens that were generated.
       */
      logprobs: z3.union([z3.boolean(), z3.number()]).optional(),
      /**
       * Whether to enable parallel function calling during tool use. Default to true.
       */
      parallelToolCalls: z3.boolean().optional(),
      /**
       * A unique identifier representing your end-user, which can help OpenAI to
       * monitor and detect abuse.
       */
      user: z3.string().optional(),
      /**
       * Reasoning effort for reasoning models. Defaults to `medium`.
       */
      reasoningEffort: z3.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
      /**
       * Maximum number of completion tokens to generate. Useful for reasoning models.
       */
      maxCompletionTokens: z3.number().optional(),
      /**
       * Whether to enable persistence in responses API.
       */
      store: z3.boolean().optional(),
      /**
       * Metadata to associate with the request.
       */
      metadata: z3.record(z3.string().max(64), z3.string().max(512)).optional(),
      /**
       * Parameters for prediction mode.
       */
      prediction: z3.record(z3.string(), z3.any()).optional(),
      /**
       * Service tier for the request.
       * - 'auto': Default service tier. The request will be processed with the service tier configured in the
       *           Project settings. Unless otherwise configured, the Project will use 'default'.
       * - 'flex': 50% cheaper processing at the cost of increased latency. Only available for o3 and o4-mini models.
       * - 'priority': Higher-speed processing with predictably low latency at premium cost. Available for Enterprise customers.
       * - 'default': The request will be processed with the standard pricing and performance for the selected model.
       *
       * @default 'auto'
       */
      serviceTier: z3.enum(["auto", "flex", "priority", "default"]).optional(),
      /**
       * Whether to use strict JSON schema validation.
       *
       * @default true
       */
      strictJsonSchema: z3.boolean().optional(),
      /**
       * Controls the verbosity of the model's responses.
       * Lower values will result in more concise responses, while higher values will result in more verbose responses.
       */
      textVerbosity: z3.enum(["low", "medium", "high"]).optional(),
      /**
       * A cache key for prompt caching. Allows manual control over prompt caching behavior.
       * Useful for improving cache hit rates and working around automatic caching issues.
       */
      promptCacheKey: z3.string().optional(),
      /**
       * Prompt cache behavior for GPT-5.6 and later models.
       * `mode` controls whether OpenAI also places an implicit breakpoint.
       * `ttl` sets the minimum cache lifetime and currently only supports 30 minutes.
       */
      promptCacheOptions: z3.object({
        mode: z3.enum(["implicit", "explicit"]).optional(),
        ttl: z3.literal("30m").optional()
      }).optional(),
      /**
       * The retention policy for the prompt cache.
       * - 'in_memory': Default. Standard prompt caching behavior.
       * - '24h': Extended prompt caching that keeps cached prefixes active for up to 24 hours.
       *          Available for models before GPT-5.6 that support extended caching.
       *
       * @deprecated For GPT-5.6 and later models, use `promptCacheOptions.ttl`.
       *
       * @default 'in_memory'
       */
      promptCacheRetention: z3.enum(["in_memory", "24h"]).optional(),
      /**
       * A stable identifier used to help detect users of your application
       * that may be violating OpenAI's usage policies. The IDs should be a
       * string that uniquely identifies each user. We recommend hashing their
       * username or email address, in order to avoid sending us any identifying
       * information.
       */
      safetyIdentifier: z3.string().optional(),
      /**
       * Override the system message mode for this model.
       * - 'system': Use the 'system' role for system messages (default for most models)
       * - 'developer': Use the 'developer' role for system messages (used by reasoning models)
       * - 'remove': Remove system messages entirely
       *
       * If not specified, the mode is automatically determined based on the model.
       */
      systemMessageMode: z3.enum(["system", "developer", "remove"]).optional(),
      /**
       * Force treating this model as a reasoning model.
       *
       * This is useful for "stealth" reasoning models (e.g. via a custom baseURL)
       * where the model ID is not recognized by the SDK's allowlist.
       *
       * When enabled, the SDK applies reasoning-model parameter compatibility rules
       * and defaults `systemMessageMode` to `developer` unless overridden.
       */
      forceReasoning: z3.boolean().optional()
    })
  )
);

// src/chat/openai-chat-prepare-tools.ts
import {
  UnsupportedFunctionalityError as UnsupportedFunctionalityError2
} from "@ai-sdk/provider";
function prepareChatTools({
  tools,
  toolChoice
}) {
  tools = (tools == null ? void 0 : tools.length) ? tools : void 0;
  const toolWarnings = [];
  if (tools == null) {
    return { tools: void 0, toolChoice: void 0, toolWarnings };
  }
  const openaiTools2 = [];
  for (const tool of tools) {
    switch (tool.type) {
      case "function":
        openaiTools2.push({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
            ...tool.strict != null ? { strict: tool.strict } : {}
          }
        });
        break;
      default:
        toolWarnings.push({
          type: "unsupported",
          feature: `tool type: ${tool.type}`
        });
        break;
    }
  }
  if (toolChoice == null) {
    return { tools: openaiTools2, toolChoice: void 0, toolWarnings };
  }
  const type = toolChoice.type;
  switch (type) {
    case "auto":
    case "none":
    case "required":
      return { tools: openaiTools2, toolChoice: type, toolWarnings };
    case "tool":
      return {
        tools: openaiTools2,
        toolChoice: {
          type: "function",
          function: {
            name: toolChoice.toolName
          }
        },
        toolWarnings
      };
    default: {
      const _exhaustiveCheck = type;
      throw new UnsupportedFunctionalityError2({
        functionality: `tool choice type: ${_exhaustiveCheck}`
      });
    }
  }
}

// src/chat/openai-chat-language-model.ts
var OpenAIChatLanguageModel = class _OpenAIChatLanguageModel {
  constructor(modelId, config) {
    this.specificationVersion = "v4";
    this.supportedUrls = {
      "image/*": [/^https?:\/\/.*$/]
    };
    this.modelId = modelId;
    this.config = config;
  }
  static [WORKFLOW_SERIALIZE](model) {
    return serializeModelOptions({
      modelId: model.modelId,
      config: model.config
    });
  }
  static [WORKFLOW_DESERIALIZE](options) {
    return new _OpenAIChatLanguageModel(options.modelId, options.config);
  }
  get provider() {
    return this.config.provider;
  }
  async getArgs({
    prompt,
    maxOutputTokens,
    temperature,
    topP,
    topK,
    frequencyPenalty,
    presencePenalty,
    stopSequences,
    responseFormat,
    seed,
    tools,
    toolChoice,
    reasoning,
    providerOptions
  }) {
    var _a, _b, _c, _d, _e, _f;
    const warnings = [];
    const openaiOptions = (_a = await parseProviderOptions({
      provider: "openai",
      providerOptions,
      schema: openaiLanguageModelChatOptions
    })) != null ? _a : {};
    const modelCapabilities = getOpenAILanguageModelCapabilities(this.modelId);
    const resolvedReasoningEffort = (_b = openaiOptions.reasoningEffort) != null ? _b : isCustomReasoning(reasoning) ? reasoning : void 0;
    const isReasoningModel = (_c = openaiOptions.forceReasoning) != null ? _c : modelCapabilities.isReasoningModel;
    if (topK != null) {
      warnings.push({ type: "unsupported", feature: "topK" });
    }
    const { messages, warnings: messageWarnings } = convertToOpenAIChatMessages(
      {
        prompt,
        systemMessageMode: (_d = openaiOptions.systemMessageMode) != null ? _d : isReasoningModel ? "developer" : modelCapabilities.systemMessageMode
      }
    );
    warnings.push(...messageWarnings);
    const strictJsonSchema = (_e = openaiOptions.strictJsonSchema) != null ? _e : true;
    const baseArgs = {
      // model id:
      model: this.modelId,
      // model specific settings:
      logit_bias: openaiOptions.logitBias,
      logprobs: openaiOptions.logprobs === true || typeof openaiOptions.logprobs === "number" ? true : void 0,
      top_logprobs: typeof openaiOptions.logprobs === "number" ? openaiOptions.logprobs : typeof openaiOptions.logprobs === "boolean" ? openaiOptions.logprobs ? 0 : void 0 : void 0,
      user: openaiOptions.user,
      parallel_tool_calls: openaiOptions.parallelToolCalls,
      // standardized settings:
      max_tokens: maxOutputTokens,
      temperature,
      top_p: topP,
      frequency_penalty: frequencyPenalty,
      presence_penalty: presencePenalty,
      response_format: (responseFormat == null ? void 0 : responseFormat.type) === "json" ? responseFormat.schema != null ? {
        type: "json_schema",
        json_schema: {
          schema: responseFormat.schema,
          strict: strictJsonSchema,
          name: (_f = responseFormat.name) != null ? _f : "response",
          description: responseFormat.description
        }
      } : { type: "json_object" } : void 0,
      stop: stopSequences,
      seed,
      verbosity: openaiOptions.textVerbosity,
      // openai specific settings:
      // TODO AI SDK 6: remove, we auto-map maxOutputTokens now
      max_completion_tokens: openaiOptions.maxCompletionTokens,
      store: openaiOptions.store,
      metadata: openaiOptions.metadata,
      prediction: openaiOptions.prediction,
      reasoning_effort: resolvedReasoningEffort,
      service_tier: openaiOptions.serviceTier,
      prompt_cache_key: openaiOptions.promptCacheKey,
      prompt_cache_options: openaiOptions.promptCacheOptions,
      prompt_cache_retention: openaiOptions.promptCacheRetention,
      safety_identifier: openaiOptions.safetyIdentifier,
      // messages:
      messages
    };
    if (isReasoningModel) {
      if (resolvedReasoningEffort !== "none" || !modelCapabilities.supportsNonReasoningParameters) {
        if (baseArgs.temperature != null) {
          baseArgs.temperature = void 0;
          warnings.push({
            type: "unsupported",
            feature: "temperature",
            details: "temperature is not supported for reasoning models"
          });
        }
        if (baseArgs.top_p != null) {
          baseArgs.top_p = void 0;
          warnings.push({
            type: "unsupported",
            feature: "topP",
            details: "topP is not supported for reasoning models"
          });
        }
        if (baseArgs.logprobs != null) {
          baseArgs.logprobs = void 0;
          warnings.push({
            type: "other",
            message: "logprobs is not supported for reasoning models"
          });
        }
      }
      if (baseArgs.frequency_penalty != null) {
        baseArgs.frequency_penalty = void 0;
        warnings.push({
          type: "unsupported",
          feature: "frequencyPenalty",
          details: "frequencyPenalty is not supported for reasoning models"
        });
      }
      if (baseArgs.presence_penalty != null) {
        baseArgs.presence_penalty = void 0;
        warnings.push({
          type: "unsupported",
          feature: "presencePenalty",
          details: "presencePenalty is not supported for reasoning models"
        });
      }
      if (baseArgs.logit_bias != null) {
        baseArgs.logit_bias = void 0;
        warnings.push({
          type: "other",
          message: "logitBias is not supported for reasoning models"
        });
      }
      if (baseArgs.top_logprobs != null) {
        baseArgs.top_logprobs = void 0;
        warnings.push({
          type: "other",
          message: "topLogprobs is not supported for reasoning models"
        });
      }
      if (baseArgs.max_tokens != null) {
        if (baseArgs.max_completion_tokens == null) {
          baseArgs.max_completion_tokens = baseArgs.max_tokens;
        }
        baseArgs.max_tokens = void 0;
      }
    } else if (this.modelId.startsWith("gpt-4o-search-preview") || this.modelId.startsWith("gpt-4o-mini-search-preview")) {
      if (baseArgs.temperature != null) {
        baseArgs.temperature = void 0;
        warnings.push({
          type: "unsupported",
          feature: "temperature",
          details: "temperature is not supported for the search preview models and has been removed."
        });
      }
    }
    if (openaiOptions.serviceTier === "flex" && !modelCapabilities.supportsFlexProcessing) {
      warnings.push({
        type: "unsupported",
        feature: "serviceTier",
        details: "flex processing is only available for o3, o4-mini, and gpt-5 models"
      });
      baseArgs.service_tier = void 0;
    }
    if (openaiOptions.serviceTier === "priority" && !modelCapabilities.supportsPriorityProcessing) {
      warnings.push({
        type: "unsupported",
        feature: "serviceTier",
        details: "priority processing is only available for supported models (gpt-4, gpt-5, gpt-5-mini, o3, o4-mini) and requires Enterprise access. gpt-5-nano is not supported"
      });
      baseArgs.service_tier = void 0;
    }
    const {
      tools: openaiTools2,
      toolChoice: openaiToolChoice,
      toolWarnings
    } = prepareChatTools({
      tools,
      toolChoice
    });
    return {
      args: {
        ...baseArgs,
        tools: openaiTools2,
        tool_choice: openaiToolChoice
      },
      warnings: [...warnings, ...toolWarnings]
    };
  }
  async doGenerate(options) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const { args: body, warnings } = await this.getArgs(options);
    const {
      responseHeaders,
      value: response,
      rawValue: rawResponse
    } = await postJsonToApi({
      url: this.config.url({
        path: "/chat/completions",
        modelId: this.modelId
      }),
      headers: combineHeaders((_b = (_a = this.config).headers) == null ? void 0 : _b.call(_a), options.headers),
      body,
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        openaiChatResponseSchema
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch
    });
    const choice = response.choices[0];
    const content = [];
    const text = choice.message.content;
    if (text != null && text.length > 0) {
      content.push({ type: "text", text });
    }
    for (const toolCall of (_c = choice.message.tool_calls) != null ? _c : []) {
      content.push({
        type: "tool-call",
        toolCallId: (_d = toolCall.id) != null ? _d : generateId(),
        toolName: toolCall.function.name,
        input: toolCall.function.arguments
      });
    }
    for (const annotation of (_e = choice.message.annotations) != null ? _e : []) {
      content.push({
        type: "source",
        sourceType: "url",
        id: generateId(),
        url: annotation.url_citation.url,
        title: annotation.url_citation.title
      });
    }
    const completionTokenDetails = (_f = response.usage) == null ? void 0 : _f.completion_tokens_details;
    const providerMetadata = { openai: {} };
    if ((completionTokenDetails == null ? void 0 : completionTokenDetails.accepted_prediction_tokens) != null) {
      providerMetadata.openai.acceptedPredictionTokens = completionTokenDetails == null ? void 0 : completionTokenDetails.accepted_prediction_tokens;
    }
    if ((completionTokenDetails == null ? void 0 : completionTokenDetails.rejected_prediction_tokens) != null) {
      providerMetadata.openai.rejectedPredictionTokens = completionTokenDetails == null ? void 0 : completionTokenDetails.rejected_prediction_tokens;
    }
    if (((_g = choice.logprobs) == null ? void 0 : _g.content) != null) {
      providerMetadata.openai.logprobs = choice.logprobs.content;
    }
    return {
      content,
      finishReason: {
        unified: mapOpenAIFinishReason(choice.finish_reason),
        raw: (_h = choice.finish_reason) != null ? _h : void 0
      },
      usage: convertOpenAIChatUsage(response.usage),
      request: { body },
      response: {
        ...getResponseMetadata(response),
        headers: responseHeaders,
        body: rawResponse
      },
      warnings,
      providerMetadata
    };
  }
  async doStream(options) {
    var _a, _b;
    const { args, warnings } = await this.getArgs(options);
    const body = {
      ...args,
      stream: true,
      stream_options: {
        include_usage: true
      }
    };
    const url = this.config.url({
      path: "/chat/completions",
      modelId: this.modelId
    });
    const { responseHeaders, value: response } = await postJsonToApi({
      url,
      headers: combineHeaders((_b = (_a = this.config).headers) == null ? void 0 : _b.call(_a), options.headers),
      body,
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(
        openaiChatChunkSchema
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch
    });
    const checkedResponse = await throwIfOpenAIStreamErrorBeforeOutput({
      stream: response,
      getError: (chunk) => "error" in chunk ? chunk.error : void 0,
      isOutputChunk: isOpenAIChatOutputChunk,
      url,
      requestBodyValues: body,
      responseHeaders
    });
    let toolCallTracker;
    let finishReason = {
      unified: "other",
      raw: void 0
    };
    let usage = void 0;
    let metadataExtracted = false;
    let isActiveText = false;
    const providerMetadata = { openai: {} };
    const result = {
      stream: checkedResponse.pipeThrough(
        new TransformStream({
          start(controller) {
            toolCallTracker = new StreamingToolCallTracker(controller, {
              generateId,
              typeValidation: "if-present"
            });
            controller.enqueue({ type: "stream-start", warnings });
          },
          transform(chunk, controller) {
            var _a2, _b2, _c, _d, _e;
            if (options.includeRawChunks) {
              controller.enqueue({ type: "raw", rawValue: chunk.rawValue });
            }
            if (!chunk.success) {
              finishReason = { unified: "error", raw: void 0 };
              controller.enqueue({ type: "error", error: chunk.error });
              return;
            }
            const value = chunk.value;
            if ("error" in value) {
              finishReason = { unified: "error", raw: void 0 };
              controller.enqueue({ type: "error", error: value.error });
              return;
            }
            if (!metadataExtracted) {
              const metadata = getResponseMetadata(value);
              if (Object.values(metadata).some(Boolean)) {
                metadataExtracted = true;
                controller.enqueue({
                  type: "response-metadata",
                  ...getResponseMetadata(value)
                });
              }
            }
            if (value.usage != null) {
              usage = value.usage;
              if (((_a2 = value.usage.completion_tokens_details) == null ? void 0 : _a2.accepted_prediction_tokens) != null) {
                providerMetadata.openai.acceptedPredictionTokens = (_b2 = value.usage.completion_tokens_details) == null ? void 0 : _b2.accepted_prediction_tokens;
              }
              if (((_c = value.usage.completion_tokens_details) == null ? void 0 : _c.rejected_prediction_tokens) != null) {
                providerMetadata.openai.rejectedPredictionTokens = (_d = value.usage.completion_tokens_details) == null ? void 0 : _d.rejected_prediction_tokens;
              }
            }
            const choice = value.choices[0];
            if ((choice == null ? void 0 : choice.finish_reason) != null) {
              finishReason = {
                unified: mapOpenAIFinishReason(choice.finish_reason),
                raw: choice.finish_reason
              };
            }
            if (((_e = choice == null ? void 0 : choice.logprobs) == null ? void 0 : _e.content) != null) {
              providerMetadata.openai.logprobs = choice.logprobs.content;
            }
            if ((choice == null ? void 0 : choice.delta) == null) {
              return;
            }
            const delta = choice.delta;
            if (delta.content != null) {
              if (!isActiveText) {
                controller.enqueue({ type: "text-start", id: "0" });
                isActiveText = true;
              }
              controller.enqueue({
                type: "text-delta",
                id: "0",
                delta: delta.content
              });
            }
            if (delta.tool_calls != null) {
              for (const toolCallDelta of delta.tool_calls) {
                toolCallTracker.processDelta(toolCallDelta);
              }
            }
            if (delta.annotations != null) {
              for (const annotation of delta.annotations) {
                controller.enqueue({
                  type: "source",
                  sourceType: "url",
                  id: generateId(),
                  url: annotation.url_citation.url,
                  title: annotation.url_citation.title
                });
              }
            }
          },
          flush(controller) {
            if (isActiveText) {
              controller.enqueue({ type: "text-end", id: "0" });
            }
            toolCallTracker.flush();
            controller.enqueue({
              type: "finish",
              finishReason,
              usage: convertOpenAIChatUsage(usage),
              ...providerMetadata != null ? { providerMetadata } : {}
            });
          }
        })
      ),
      request: { body },
      response: { headers: responseHeaders }
    };
    return result;
  }
};
function isOpenAIChatOutputChunk(chunk) {
  if ("error" in chunk) {
    return false;
  }
  return chunk.choices.some((choice) => {
    const delta = choice.delta;
    return (delta == null ? void 0 : delta.content) != null && delta.content.length > 0 || (delta == null ? void 0 : delta.tool_calls) != null && delta.tool_calls.length > 0 || (delta == null ? void 0 : delta.annotations) != null && delta.annotations.length > 0;
  });
}

// src/completion/openai-completion-language-model.ts
import {
  combineHeaders as combineHeaders2,
  createEventSourceResponseHandler as createEventSourceResponseHandler2,
  createJsonResponseHandler as createJsonResponseHandler2,
  parseProviderOptions as parseProviderOptions2,
  postJsonToApi as postJsonToApi2,
  serializeModelOptions as serializeModelOptions2,
  WORKFLOW_DESERIALIZE as WORKFLOW_DESERIALIZE2,
  WORKFLOW_SERIALIZE as WORKFLOW_SERIALIZE2
} from "@ai-sdk/provider-utils";

// src/completion/convert-openai-completion-usage.ts
function convertOpenAICompletionUsage(usage) {
  var _a, _b, _c, _d;
  if (usage == null) {
    return {
      inputTokens: {
        total: void 0,
        noCache: void 0,
        cacheRead: void 0,
        cacheWrite: void 0
      },
      outputTokens: {
        total: void 0,
        text: void 0,
        reasoning: void 0
      },
      raw: void 0
    };
  }
  const promptTokens = (_a = usage.prompt_tokens) != null ? _a : 0;
  const completionTokens = (_b = usage.completion_tokens) != null ? _b : 0;
  return {
    inputTokens: {
      total: (_c = usage.prompt_tokens) != null ? _c : void 0,
      noCache: promptTokens,
      cacheRead: void 0,
      cacheWrite: void 0
    },
    outputTokens: {
      total: (_d = usage.completion_tokens) != null ? _d : void 0,
      text: completionTokens,
      reasoning: void 0
    },
    raw: usage
  };
}

// src/completion/convert-to-openai-completion-prompt.ts
import {
  InvalidPromptError,
  UnsupportedFunctionalityError as UnsupportedFunctionalityError3
} from "@ai-sdk/provider";
function convertToOpenAICompletionPrompt({
  prompt,
  user = "user",
  assistant = "assistant"
}) {
  let text = "";
  if (prompt[0].role === "system") {
    text += `${prompt[0].content}

`;
    prompt = prompt.slice(1);
  }
  for (const { role, content } of prompt) {
    switch (role) {
      case "system": {
        throw new InvalidPromptError({
          message: "Unexpected system message in prompt: ${content}",
          prompt
        });
      }
      case "user": {
        const userMessage = content.map((part) => {
          switch (part.type) {
            case "text": {
              return part.text;
            }
          }
        }).filter(Boolean).join("");
        text += `${user}:
${userMessage}

`;
        break;
      }
      case "assistant": {
        const assistantMessage = content.map((part) => {
          switch (part.type) {
            case "text": {
              return part.text;
            }
            case "tool-call": {
              throw new UnsupportedFunctionalityError3({
                functionality: "tool-call messages"
              });
            }
          }
        }).join("");
        text += `${assistant}:
${assistantMessage}

`;
        break;
      }
      case "tool": {
        throw new UnsupportedFunctionalityError3({
          functionality: "tool messages"
        });
      }
      default: {
        const _exhaustiveCheck = role;
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`);
      }
    }
  }
  text += `${assistant}:
`;
  return {
    prompt: text,
    stopSequences: [`
${user}:`]
  };
}

// src/completion/get-response-metadata.ts
function getResponseMetadata2({
  id,
  model,
  created
}) {
  return {
    id: id != null ? id : void 0,
    modelId: model != null ? model : void 0,
    timestamp: created != null ? new Date(created * 1e3) : void 0
  };
}

// src/completion/map-openai-finish-reason.ts
function mapOpenAIFinishReason2(finishReason) {
  switch (finishReason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content_filter":
      return "content-filter";
    case "function_call":
    case "tool_calls":
      return "tool-calls";
    default:
      return "other";
  }
}

// src/completion/openai-completion-api.ts
import { z as z4 } from "zod/v4";
import {
  lazySchema as lazySchema3,
  zodSchema as zodSchema3
} from "@ai-sdk/provider-utils";
var openaiCompletionResponseSchema = lazySchema3(
  () => zodSchema3(
    z4.object({
      id: z4.string().nullish(),
      created: z4.number().nullish(),
      model: z4.string().nullish(),
      choices: z4.array(
        z4.object({
          text: z4.string(),
          finish_reason: z4.string(),
          logprobs: z4.object({
            tokens: z4.array(z4.string()),
            token_logprobs: z4.array(z4.number()),
            top_logprobs: z4.array(z4.record(z4.string(), z4.number())).nullish()
          }).nullish()
        })
      ),
      usage: z4.object({
        prompt_tokens: z4.number(),
        completion_tokens: z4.number(),
        total_tokens: z4.number()
      }).nullish()
    })
  )
);
var openaiCompletionChunkSchema = lazySchema3(
  () => zodSchema3(
    z4.union([
      z4.object({
        id: z4.string().nullish(),
        created: z4.number().nullish(),
        model: z4.string().nullish(),
        choices: z4.array(
          z4.object({
            text: z4.string(),
            finish_reason: z4.string().nullish(),
            index: z4.number(),
            logprobs: z4.object({
              tokens: z4.array(z4.string()),
              token_logprobs: z4.array(z4.number()),
              top_logprobs: z4.array(z4.record(z4.string(), z4.number())).nullish()
            }).nullish()
          })
        ),
        usage: z4.object({
          prompt_tokens: z4.number(),
          completion_tokens: z4.number(),
          total_tokens: z4.number()
        }).nullish()
      }),
      openaiErrorDataSchema
    ])
  )
);

// src/completion/openai-completion-language-model-options.ts
import {
  lazySchema as lazySchema4,
  zodSchema as zodSchema4
} from "@ai-sdk/provider-utils";
import { z as z5 } from "zod/v4";
var openaiLanguageModelCompletionOptions = lazySchema4(
  () => zodSchema4(
    z5.object({
      /**
       * Echo back the prompt in addition to the completion.
       */
      echo: z5.boolean().optional(),
      /**
       * Modify the likelihood of specified tokens appearing in the completion.
       *
       * Accepts a JSON object that maps tokens (specified by their token ID in
       * the GPT tokenizer) to an associated bias value from -100 to 100. You
       * can use this tokenizer tool to convert text to token IDs. Mathematically,
       * the bias is added to the logits generated by the model prior to sampling.
       * The exact effect will vary per model, but values between -1 and 1 should
       * decrease or increase likelihood of selection; values like -100 or 100
       * should result in a ban or exclusive selection of the relevant token.
       *
       * As an example, you can pass {"50256": -100} to prevent the <|endoftext|>
       * token from being generated.
       */
      logitBias: z5.record(z5.string(), z5.number()).optional(),
      /**
       * The suffix that comes after a completion of inserted text.
       */
      suffix: z5.string().optional(),
      /**
       * A unique identifier representing your end-user, which can help OpenAI to
       * monitor and detect abuse. Learn more.
       */
      user: z5.string().optional(),
      /**
       * Return the log probabilities of the tokens. Including logprobs will increase
       * the response size and can slow down response times. However, it can
       * be useful to better understand how the model is behaving.
       * Setting to true will return the log probabilities of the tokens that
       * were generated.
       * Setting to a number will return the log probabilities of the top n
       * tokens that were generated.
       */
      logprobs: z5.union([z5.boolean(), z5.number()]).optional()
    })
  )
);

// src/completion/openai-completion-language-model.ts
var OpenAICompletionLanguageModel = class _OpenAICompletionLanguageModel {
  constructor(modelId, config) {
    this.specificationVersion = "v4";
    this.supportedUrls = {
      // No URLs are supported for completion models.
    };
    this.modelId = modelId;
    this.config = config;
  }
  get providerOptionsName() {
    return this.config.provider.split(".")[0].trim();
  }
  static [WORKFLOW_SERIALIZE2](model) {
    return serializeModelOptions2({
      modelId: model.modelId,
      config: model.config
    });
  }
  static [WORKFLOW_DESERIALIZE2](options) {
    return new _OpenAICompletionLanguageModel(options.modelId, options.config);
  }
  get provider() {
    return this.config.provider;
  }
  async getArgs({
    prompt,
    maxOutputTokens,
    temperature,
    topP,
    topK,
    frequencyPenalty,
    presencePenalty,
    stopSequences: userStopSequences,
    responseFormat,
    tools,
    toolChoice,
    seed,
    providerOptions
  }) {
    const warnings = [];
    const openaiOptions = {
      ...await parseProviderOptions2({
        provider: "openai",
        providerOptions,
        schema: openaiLanguageModelCompletionOptions
      }),
      ...await parseProviderOptions2({
        provider: this.providerOptionsName,
        providerOptions,
        schema: openaiLanguageModelCompletionOptions
      })
    };
    if (topK != null) {
      warnings.push({ type: "unsupported", feature: "topK" });
    }
    if (tools == null ? void 0 : tools.length) {
      warnings.push({ type: "unsupported", feature: "tools" });
    }
    if (toolChoice != null) {
      warnings.push({ type: "unsupported", feature: "toolChoice" });
    }
    if (responseFormat != null && responseFormat.type !== "text") {
      warnings.push({
        type: "unsupported",
        feature: "responseFormat",
        details: "JSON response format is not supported."
      });
    }
    const { prompt: completionPrompt, stopSequences } = convertToOpenAICompletionPrompt({ prompt });
    const stop = [...stopSequences != null ? stopSequences : [], ...userStopSequences != null ? userStopSequences : []];
    return {
      args: {
        // model id:
        model: this.modelId,
        // model specific settings:
        echo: openaiOptions.echo,
        logit_bias: openaiOptions.logitBias,
        logprobs: (openaiOptions == null ? void 0 : openaiOptions.logprobs) === true ? 0 : (openaiOptions == null ? void 0 : openaiOptions.logprobs) === false ? void 0 : openaiOptions == null ? void 0 : openaiOptions.logprobs,
        suffix: openaiOptions.suffix,
        user: openaiOptions.user,
        // standardized settings:
        max_tokens: maxOutputTokens,
        temperature,
        top_p: topP,
        frequency_penalty: frequencyPenalty,
        presence_penalty: presencePenalty,
        seed,
        // prompt:
        prompt: completionPrompt,
        // stop sequences:
        stop: stop.length > 0 ? stop : void 0
      },
      warnings
    };
  }
  async doGenerate(options) {
    var _a, _b, _c;
    const { args, warnings } = await this.getArgs(options);
    const {
      responseHeaders,
      value: response,
      rawValue: rawResponse
    } = await postJsonToApi2({
      url: this.config.url({
        path: "/completions",
        modelId: this.modelId
      }),
      headers: combineHeaders2((_b = (_a = this.config).headers) == null ? void 0 : _b.call(_a), options.headers),
      body: args,
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler2(
        openaiCompletionResponseSchema
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch
    });
    const choice = response.choices[0];
    const providerMetadata = { openai: {} };
    if (choice.logprobs != null) {
      providerMetadata.openai.logprobs = choice.logprobs;
    }
    return {
      content: [{ type: "text", text: choice.text }],
      usage: convertOpenAICompletionUsage(response.usage),
      finishReason: {
        unified: mapOpenAIFinishReason2(choice.finish_reason),
        raw: (_c = choice.finish_reason) != null ? _c : void 0
      },
      request: { body: args },
      response: {
        ...getResponseMetadata2(response),
        headers: responseHeaders,
        body: rawResponse
      },
      providerMetadata,
      warnings
    };
  }
  async doStream(options) {
    var _a, _b;
    const { args, warnings } = await this.getArgs(options);
    const body = {
      ...args,
      stream: true,
      stream_options: {
        include_usage: true
      }
    };
    const url = this.config.url({
      path: "/completions",
      modelId: this.modelId
    });
    const { responseHeaders, value: response } = await postJsonToApi2({
      url,
      headers: combineHeaders2((_b = (_a = this.config).headers) == null ? void 0 : _b.call(_a), options.headers),
      body,
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler2(
        openaiCompletionChunkSchema
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch
    });
    const checkedResponse = await throwIfOpenAIStreamErrorBeforeOutput({
      stream: response,
      getError: (chunk) => "error" in chunk ? chunk.error : void 0,
      isOutputChunk: isOpenAICompletionOutputChunk,
      url,
      requestBodyValues: body,
      responseHeaders
    });
    let finishReason = {
      unified: "other",
      raw: void 0
    };
    const providerMetadata = { openai: {} };
    let usage = void 0;
    let isFirstChunk = true;
    const result = {
      stream: checkedResponse.pipeThrough(
        new TransformStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings });
          },
          transform(chunk, controller) {
            if (options.includeRawChunks) {
              controller.enqueue({ type: "raw", rawValue: chunk.rawValue });
            }
            if (!chunk.success) {
              finishReason = { unified: "error", raw: void 0 };
              controller.enqueue({ type: "error", error: chunk.error });
              return;
            }
            const value = chunk.value;
            if ("error" in value) {
              finishReason = { unified: "error", raw: void 0 };
              controller.enqueue({ type: "error", error: value.error });
              return;
            }
            if (isFirstChunk) {
              isFirstChunk = false;
              controller.enqueue({
                type: "response-metadata",
                ...getResponseMetadata2(value)
              });
              controller.enqueue({ type: "text-start", id: "0" });
            }
            if (value.usage != null) {
              usage = value.usage;
            }
            const choice = value.choices[0];
            if ((choice == null ? void 0 : choice.finish_reason) != null) {
              finishReason = {
                unified: mapOpenAIFinishReason2(choice.finish_reason),
                raw: choice.finish_reason
              };
            }
            if ((choice == null ? void 0 : choice.logprobs) != null) {
              providerMetadata.openai.logprobs = choice.logprobs;
            }
            if ((choice == null ? void 0 : choice.text) != null && choice.text.length > 0) {
              controller.enqueue({
                type: "text-delta",
                id: "0",
                delta: choice.text
              });
            }
          },
          flush(controller) {
            if (!isFirstChunk) {
              controller.enqueue({ type: "text-end", id: "0" });
            }
            controller.enqueue({
              type: "finish",
              finishReason,
              providerMetadata,
              usage: convertOpenAICompletionUsage(usage)
            });
          }
        })
      ),
      request: { body },
      response: { headers: responseHeaders }
    };
    return result;
  }
};
function isOpenAICompletionOutputChunk(chunk) {
  return !("error" in chunk) && chunk.choices.some((choice) => choice.text.length > 0);
}

// src/embedding/openai-embedding-model.ts
import {
  TooManyEmbeddingValuesForCallError
} from "@ai-sdk/provider";
import {
  combineHeaders as combineHeaders3,
  createJsonResponseHandler as createJsonResponseHandler3,
  parseProviderOptions as parseProviderOptions3,
  postJsonToApi as postJsonToApi3,
  serializeModelOptions as serializeModelOptions3,
  WORKFLOW_DESERIALIZE as WORKFLOW_DESERIALIZE3,
  WORKFLOW_SERIALIZE as WORKFLOW_SERIALIZE3
} from "@ai-sdk/provider-utils";

// src/embedding/openai-embedding-model-options.ts
import {
  lazySchema as lazySchema5,
  zodSchema as zodSchema5
} from "@ai-sdk/provider-utils";
import { z as z6 } from "zod/v4";
var openaiEmbeddingModelOptions = lazySchema5(
  () => zodSchema5(
    z6.object({
      /**
       * The number of dimensions the resulting output embeddings should have.
       * Only supported in text-embedding-3 and later models.
       */
      dimensions: z6.number().optional(),
      /**
       * A unique identifier representing your end-user, which can help OpenAI to
       * monitor and detect abuse. Learn more.
       */
      user: z6.string().optional()
    })
  )
);

// src/embedding/openai-embedding-api.ts
import { lazySchema as lazySchema6, zodSchema as zodSchema6 } from "@ai-sdk/provider-utils";
import { z as z7 } from "zod/v4";
var openaiTextEmbeddingResponseSchema = lazySchema6(
  () => zodSchema6(
    z7.object({
      data: z7.array(z7.object({ embedding: z7.array(z7.number()) })),
      usage: z7.object({ prompt_tokens: z7.number() }).nullish()
    })
  )
);

// src/embedding/openai-embedding-model.ts
var OpenAIEmbeddingModel = class _OpenAIEmbeddingModel {
  constructor(modelId, config) {
    this.specificationVersion = "v4";
    this.maxEmbeddingsPerCall = 2048;
    this.supportsParallelCalls = true;
    this.modelId = modelId;
    this.config = config;
  }
  static [WORKFLOW_SERIALIZE3](model) {
    return serializeModelOptions3({
      modelId: model.modelId,
      config: model.config
    });
  }
  static [WORKFLOW_DESERIALIZE3](options) {
    return new _OpenAIEmbeddingModel(options.modelId, options.config);
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
    var _a, _b, _c;
    if (values.length > this.maxEmbeddingsPerCall) {
      throw new TooManyEmbeddingValuesForCallError({
        provider: this.provider,
        modelId: this.modelId,
        maxEmbeddingsPerCall: this.maxEmbeddingsPerCall,
        values
      });
    }
    const openaiOptions = (_a = await parseProviderOptions3({
      provider: "openai",
      providerOptions,
      schema: openaiEmbeddingModelOptions
    })) != null ? _a : {};
    const {
      responseHeaders,
      value: response,
      rawValue
    } = await postJsonToApi3({
      url: this.config.url({
        path: "/embeddings",
        modelId: this.modelId
      }),
      headers: combineHeaders3((_c = (_b = this.config).headers) == null ? void 0 : _c.call(_b), headers),
      body: {
        model: this.modelId,
        input: values,
        encoding_format: "float",
        dimensions: openaiOptions.dimensions,
        user: openaiOptions.user
      },
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler3(
        openaiTextEmbeddingResponseSchema
      ),
      abortSignal,
      fetch: this.config.fetch
    });
    return {
      warnings: [],
      embeddings: response.data.map((item) => item.embedding),
      usage: response.usage ? { tokens: response.usage.prompt_tokens } : void 0,
      response: { headers: responseHeaders, body: rawValue }
    };
  }
};

// src/files/openai-files.ts
import {
  combineHeaders as combineHeaders4,
  convertInlineFileDataToUint8Array,
  createJsonResponseHandler as createJsonResponseHandler4,
  parseProviderOptions as parseProviderOptions4,
  postFormDataToApi
} from "@ai-sdk/provider-utils";

// src/files/openai-files-api.ts
import { lazySchema as lazySchema7, zodSchema as zodSchema7 } from "@ai-sdk/provider-utils";
import { z as z8 } from "zod/v4";
var openaiFilesResponseSchema = lazySchema7(
  () => zodSchema7(
    z8.object({
      id: z8.string(),
      object: z8.string().nullish(),
      bytes: z8.number().nullish(),
      created_at: z8.number().nullish(),
      filename: z8.string().nullish(),
      purpose: z8.string().nullish(),
      status: z8.string().nullish(),
      expires_at: z8.number().nullish()
    })
  )
);

// src/files/openai-files-options.ts
import {
  lazySchema as lazySchema8,
  zodSchema as zodSchema8
} from "@ai-sdk/provider-utils";
import { z as z9 } from "zod/v4";
var openaiFilesOptionsSchema = lazySchema8(
  () => zodSchema8(
    z9.object({
      /*
       * Required by the OpenAI API, but optional here because
       * the SDK defaults to "assistants" — by far the most common
       * purpose when uploading files in this context.
       */
      purpose: z9.string().optional(),
      expiresAfter: z9.number().optional()
    })
  )
);

// src/files/openai-files.ts
var OpenAIFiles = class {
  constructor(config) {
    this.config = config;
    this.specificationVersion = "v4";
  }
  get provider() {
    return this.config.provider;
  }
  async uploadFile({
    data,
    mediaType,
    filename,
    providerOptions
  }) {
    var _a, _b, _c;
    const openaiOptions = await parseProviderOptions4({
      provider: "openai",
      providerOptions,
      schema: openaiFilesOptionsSchema
    });
    const fileBytes = convertInlineFileDataToUint8Array(data);
    const blob = new Blob([fileBytes], {
      type: mediaType
    });
    const formData = new FormData();
    if (filename != null) {
      formData.append("file", blob, filename);
    } else {
      formData.append("file", blob);
    }
    formData.append("purpose", (_a = openaiOptions == null ? void 0 : openaiOptions.purpose) != null ? _a : "assistants");
    if ((openaiOptions == null ? void 0 : openaiOptions.expiresAfter) != null) {
      formData.append("expires_after", String(openaiOptions.expiresAfter));
    }
    const { value: response } = await postFormDataToApi({
      url: `${this.config.baseURL}/files`,
      headers: combineHeaders4(this.config.headers()),
      formData,
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler4(
        openaiFilesResponseSchema
      ),
      fetch: this.config.fetch
    });
    return {
      warnings: [],
      providerReference: { openai: response.id },
      ...((_b = response.filename) != null ? _b : filename) ? { filename: (_c = response.filename) != null ? _c : filename } : {},
      ...mediaType != null ? { mediaType } : {},
      providerMetadata: {
        openai: {
          ...response.filename != null ? { filename: response.filename } : {},
          ...response.purpose != null ? { purpose: response.purpose } : {},
          ...response.bytes != null ? { bytes: response.bytes } : {},
          ...response.created_at != null ? { createdAt: response.created_at } : {},
          ...response.status != null ? { status: response.status } : {},
          ...response.expires_at != null ? { expiresAt: response.expires_at } : {}
        }
      }
    };
  }
};

// src/image/openai-image-model.ts
import {
  combineHeaders as combineHeaders5,
  convertBase64ToUint8Array,
  convertToFormData,
  createJsonResponseHandler as createJsonResponseHandler5,
  downloadBlob,
  parseProviderOptions as parseProviderOptions5,
  postFormDataToApi as postFormDataToApi2,
  postJsonToApi as postJsonToApi4,
  serializeModelOptions as serializeModelOptions4,
  WORKFLOW_DESERIALIZE as WORKFLOW_DESERIALIZE4,
  WORKFLOW_SERIALIZE as WORKFLOW_SERIALIZE4
} from "@ai-sdk/provider-utils";

// src/image/openai-image-api.ts
import { lazySchema as lazySchema9, zodSchema as zodSchema9 } from "@ai-sdk/provider-utils";
import { z as z10 } from "zod/v4";
var openaiImageResponseSchema = lazySchema9(
  () => zodSchema9(
    z10.object({
      created: z10.number().nullish(),
      data: z10.array(
        z10.object({
          b64_json: z10.string(),
          revised_prompt: z10.string().nullish()
        })
      ),
      background: z10.string().nullish(),
      output_format: z10.string().nullish(),
      size: z10.string().nullish(),
      quality: z10.string().nullish(),
      usage: z10.object({
        input_tokens: z10.number().nullish(),
        output_tokens: z10.number().nullish(),
        total_tokens: z10.number().nullish(),
        input_tokens_details: z10.object({
          image_tokens: z10.number().nullish(),
          text_tokens: z10.number().nullish()
        }).nullish()
      }).nullish()
    })
  )
);

// src/image/openai-image-model-options.ts
import {
  lazySchema as lazySchema10,
  zodSchema as zodSchema10
} from "@ai-sdk/provider-utils";
import { z as z11 } from "zod/v4";
var modelMaxImagesPerCall = {
  "dall-e-3": 1,
  "dall-e-2": 10,
  "gpt-image-1": 10,
  "gpt-image-1-mini": 10,
  "gpt-image-1.5": 10,
  "gpt-image-2": 10,
  "chatgpt-image-latest": 10
};
var defaultResponseFormatPrefixes = ["chatgpt-image-", "gpt-image-"];
function hasDefaultResponseFormat(modelId) {
  return defaultResponseFormatPrefixes.some(
    (prefix) => modelId.startsWith(prefix)
  );
}
function getMaxImagesPerCall(modelId) {
  var _a;
  return (_a = modelMaxImagesPerCall[modelId]) != null ? _a : modelId.startsWith("gpt-image-") ? 10 : 1;
}
var baseImageModelOptionsObject = z11.object({
  /**
   * Quality of the generated image(s).
   *
   * Valid values: `standard`, `hd`, `low`, `medium`, `high`, `auto`.
   */
  quality: z11.enum(["standard", "hd", "low", "medium", "high", "auto"]).optional(),
  /**
   * Background behavior for the generated image(s).
   *
   * If `transparent`, the output format must support transparency
   * (i.e. `png` or `webp`).
   */
  background: z11.enum(["transparent", "opaque", "auto"]).optional(),
  /**
   * Format in which the generated image(s) are returned.
   */
  outputFormat: z11.enum(["png", "jpeg", "webp"]).optional(),
  /**
   * Compression level (0-100) for the generated image(s). Applies to the
   * `jpeg` and `webp` output formats.
   */
  outputCompression: z11.number().int().min(0).max(100).optional(),
  /**
   * A unique identifier representing your end-user, which can help OpenAI
   * to monitor and detect abuse.
   */
  user: z11.string().optional()
});
var openaiImageModelOptions = lazySchema10(
  () => zodSchema10(baseImageModelOptionsObject)
);
var openaiImageModelGenerationOptions = lazySchema10(
  () => zodSchema10(
    baseImageModelOptionsObject.extend({
      /**
       * Style of the generated image. `vivid` produces hyper-real and
       * dramatic images; `natural` produces more subdued, less hyper-real
       * looking images.
       */
      style: z11.enum(["vivid", "natural"]).optional(),
      /**
       * Content moderation level for the generated image(s). `low` applies
       * less restrictive filtering.
       */
      moderation: z11.enum(["auto", "low"]).optional()
    })
  )
);
var openaiImageModelEditOptions = lazySchema10(
  () => zodSchema10(
    baseImageModelOptionsObject.extend({
      /**
       * Fidelity of the output image(s) to the input image(s).
       */
      inputFidelity: z11.enum(["high", "low"]).optional()
    })
  )
);

// src/image/openai-image-model.ts
var OpenAIImageModel = class _OpenAIImageModel {
  constructor(modelId, config) {
    this.modelId = modelId;
    this.config = config;
    this.specificationVersion = "v4";
  }
  static [WORKFLOW_SERIALIZE4](model) {
    return serializeModelOptions4({
      modelId: model.modelId,
      config: model.config
    });
  }
  static [WORKFLOW_DESERIALIZE4](options) {
    return new _OpenAIImageModel(options.modelId, options.config);
  }
  get maxImagesPerCall() {
    return getMaxImagesPerCall(this.modelId);
  }
  get provider() {
    return this.config.provider;
  }
  async doGenerate({
    prompt,
    files,
    mask,
    n,
    size,
    aspectRatio,
    seed,
    providerOptions,
    headers,
    abortSignal
  }) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o;
    const warnings = [];
    if (aspectRatio != null) {
      warnings.push({
        type: "unsupported",
        feature: "aspectRatio",
        details: "This model does not support aspect ratio. Use `size` instead."
      });
    }
    if (seed != null) {
      warnings.push({ type: "unsupported", feature: "seed" });
    }
    const currentDate = (_c = (_b = (_a = this.config._internal) == null ? void 0 : _a.currentDate) == null ? void 0 : _b.call(_a)) != null ? _c : /* @__PURE__ */ new Date();
    if (files != null) {
      const openaiOptions2 = (_d = await parseProviderOptions5({
        provider: "openai",
        providerOptions,
        schema: openaiImageModelEditOptions
      })) != null ? _d : {};
      const { value: response2, responseHeaders: responseHeaders2 } = await postFormDataToApi2({
        url: this.config.url({
          path: "/images/edits",
          modelId: this.modelId
        }),
        headers: combineHeaders5((_f = (_e = this.config).headers) == null ? void 0 : _f.call(_e), headers),
        formData: convertToFormData({
          model: this.modelId,
          prompt,
          image: await Promise.all(
            files.map(
              (file) => file.type === "file" ? new Blob(
                [
                  file.data instanceof Uint8Array ? new Blob([file.data], {
                    type: file.mediaType
                  }) : new Blob([convertBase64ToUint8Array(file.data)], {
                    type: file.mediaType
                  })
                ],
                { type: file.mediaType }
              ) : downloadBlob(file.url)
            )
          ),
          mask: mask != null ? await fileToBlob(mask) : void 0,
          n,
          size,
          quality: openaiOptions2.quality,
          background: openaiOptions2.background,
          output_format: openaiOptions2.outputFormat,
          output_compression: openaiOptions2.outputCompression,
          input_fidelity: openaiOptions2.inputFidelity,
          user: openaiOptions2.user
        }),
        failedResponseHandler: openaiFailedResponseHandler,
        successfulResponseHandler: createJsonResponseHandler5(
          openaiImageResponseSchema
        ),
        abortSignal,
        fetch: this.config.fetch
      });
      return {
        images: response2.data.map((item) => item.b64_json),
        warnings,
        usage: response2.usage != null ? {
          inputTokens: (_g = response2.usage.input_tokens) != null ? _g : void 0,
          outputTokens: (_h = response2.usage.output_tokens) != null ? _h : void 0,
          totalTokens: (_i = response2.usage.total_tokens) != null ? _i : void 0
        } : void 0,
        response: {
          timestamp: currentDate,
          modelId: this.modelId,
          headers: responseHeaders2
        },
        providerMetadata: {
          openai: {
            images: response2.data.map((item, index) => {
              var _a2, _b2, _c2, _d2, _e2, _f2;
              return {
                ...item.revised_prompt ? { revisedPrompt: item.revised_prompt } : {},
                created: (_a2 = response2.created) != null ? _a2 : void 0,
                size: (_b2 = response2.size) != null ? _b2 : void 0,
                quality: (_c2 = response2.quality) != null ? _c2 : void 0,
                background: (_d2 = response2.background) != null ? _d2 : void 0,
                outputFormat: (_e2 = response2.output_format) != null ? _e2 : void 0,
                ...distributeTokenDetails(
                  (_f2 = response2.usage) == null ? void 0 : _f2.input_tokens_details,
                  index,
                  response2.data.length
                )
              };
            })
          }
        }
      };
    }
    const openaiOptions = (_j = await parseProviderOptions5({
      provider: "openai",
      providerOptions,
      schema: openaiImageModelGenerationOptions
    })) != null ? _j : {};
    const { value: response, responseHeaders } = await postJsonToApi4({
      url: this.config.url({
        path: "/images/generations",
        modelId: this.modelId
      }),
      headers: combineHeaders5((_l = (_k = this.config).headers) == null ? void 0 : _l.call(_k), headers),
      body: {
        model: this.modelId,
        prompt,
        n,
        size,
        quality: openaiOptions.quality,
        style: openaiOptions.style,
        background: openaiOptions.background,
        moderation: openaiOptions.moderation,
        output_format: openaiOptions.outputFormat,
        output_compression: openaiOptions.outputCompression,
        user: openaiOptions.user,
        ...!hasDefaultResponseFormat(this.modelId) ? { response_format: "b64_json" } : {}
      },
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler5(
        openaiImageResponseSchema
      ),
      abortSignal,
      fetch: this.config.fetch
    });
    return {
      images: response.data.map((item) => item.b64_json),
      warnings,
      usage: response.usage != null ? {
        inputTokens: (_m = response.usage.input_tokens) != null ? _m : void 0,
        outputTokens: (_n = response.usage.output_tokens) != null ? _n : void 0,
        totalTokens: (_o = response.usage.total_tokens) != null ? _o : void 0
      } : void 0,
      response: {
        timestamp: currentDate,
        modelId: this.modelId,
        headers: responseHeaders
      },
      providerMetadata: {
        openai: {
          images: response.data.map((item, index) => {
            var _a2, _b2, _c2, _d2, _e2, _f2;
            return {
              ...item.revised_prompt ? { revisedPrompt: item.revised_prompt } : {},
              created: (_a2 = response.created) != null ? _a2 : void 0,
              size: (_b2 = response.size) != null ? _b2 : void 0,
              quality: (_c2 = response.quality) != null ? _c2 : void 0,
              background: (_d2 = response.background) != null ? _d2 : void 0,
              outputFormat: (_e2 = response.output_format) != null ? _e2 : void 0,
              ...distributeTokenDetails(
                (_f2 = response.usage) == null ? void 0 : _f2.input_tokens_details,
                index,
                response.data.length
              )
            };
          })
        }
      }
    };
  }
};
function distributeTokenDetails(details, index, total) {
  if (details == null) {
    return {};
  }
  const result = {};
  if (details.image_tokens != null) {
    const base = Math.floor(details.image_tokens / total);
    const remainder = details.image_tokens - base * (total - 1);
    result.imageTokens = index === total - 1 ? remainder : base;
  }
  if (details.text_tokens != null) {
    const base = Math.floor(details.text_tokens / total);
    const remainder = details.text_tokens - base * (total - 1);
    result.textTokens = index === total - 1 ? remainder : base;
  }
  return result;
}
async function fileToBlob(file) {
  if (!file) return void 0;
  if (file.type === "url") {
    return downloadBlob(file.url);
  }
  const data = file.data instanceof Uint8Array ? file.data : convertBase64ToUint8Array(file.data);
  return new Blob([data], { type: file.mediaType });
}

// src/tool/apply-patch.ts
import {
  createProviderDefinedToolFactoryWithOutputSchema,
  lazySchema as lazySchema11,
  zodSchema as zodSchema11
} from "@ai-sdk/provider-utils";
import { z as z12 } from "zod/v4";
var applyPatchInputSchema = lazySchema11(
  () => zodSchema11(
    z12.object({
      callId: z12.string(),
      operation: z12.discriminatedUnion("type", [
        z12.object({
          type: z12.literal("create_file"),
          path: z12.string(),
          diff: z12.string()
        }),
        z12.object({
          type: z12.literal("delete_file"),
          path: z12.string()
        }),
        z12.object({
          type: z12.literal("update_file"),
          path: z12.string(),
          diff: z12.string()
        })
      ])
    })
  )
);
var applyPatchOutputSchema = lazySchema11(
  () => zodSchema11(
    z12.object({
      status: z12.enum(["completed", "failed"]),
      output: z12.string().optional()
    })
  )
);
var applyPatchArgsSchema = lazySchema11(() => zodSchema11(z12.object({})));
var applyPatchToolFactory = createProviderDefinedToolFactoryWithOutputSchema({
  id: "openai.apply_patch",
  inputSchema: applyPatchInputSchema,
  outputSchema: applyPatchOutputSchema
});
var applyPatch = applyPatchToolFactory;

// src/tool/code-interpreter.ts
import {
  createProviderExecutedToolFactory,
  lazySchema as lazySchema12,
  zodSchema as zodSchema12
} from "@ai-sdk/provider-utils";
import { z as z13 } from "zod/v4";
var codeInterpreterInputSchema = lazySchema12(
  () => zodSchema12(
    z13.object({
      code: z13.string().nullish(),
      containerId: z13.string()
    })
  )
);
var codeInterpreterOutputSchema = lazySchema12(
  () => zodSchema12(
    z13.object({
      outputs: z13.array(
        z13.discriminatedUnion("type", [
          z13.object({ type: z13.literal("logs"), logs: z13.string() }),
          z13.object({ type: z13.literal("image"), url: z13.string() })
        ])
      ).nullish()
    })
  )
);
var codeInterpreterArgsSchema = lazySchema12(
  () => zodSchema12(
    z13.object({
      container: z13.union([
        z13.string(),
        z13.object({
          fileIds: z13.array(z13.string()).optional()
        })
      ]).optional()
    })
  )
);
var codeInterpreterToolFactory = createProviderExecutedToolFactory({
  id: "openai.code_interpreter",
  inputSchema: codeInterpreterInputSchema,
  outputSchema: codeInterpreterOutputSchema
});
var codeInterpreter = (args = {}) => {
  return codeInterpreterToolFactory(args);
};

// src/tool/computer.ts
import {
  createProviderDefinedToolFactoryWithOutputSchema as createProviderDefinedToolFactoryWithOutputSchema2,
  lazySchema as lazySchema13,
  zodSchema as zodSchema13
} from "@ai-sdk/provider-utils";
import { z as z14 } from "zod/v4";
var safetyCheckSchema = z14.object({
  id: z14.string(),
  code: z14.string().optional(),
  message: z14.string().optional()
});
var computerActionSchema = z14.discriminatedUnion("type", [
  z14.object({
    type: z14.literal("click"),
    button: z14.enum(["left", "right", "wheel", "back", "forward"]),
    x: z14.number(),
    y: z14.number(),
    keys: z14.array(z14.string()).optional()
  }),
  z14.object({
    type: z14.literal("double_click"),
    x: z14.number(),
    y: z14.number(),
    keys: z14.array(z14.string()).optional()
  }),
  z14.object({
    type: z14.literal("drag"),
    path: z14.array(z14.object({ x: z14.number(), y: z14.number() })),
    keys: z14.array(z14.string()).optional()
  }),
  z14.object({
    type: z14.literal("keypress"),
    keys: z14.array(z14.string())
  }),
  z14.object({
    type: z14.literal("move"),
    x: z14.number(),
    y: z14.number(),
    keys: z14.array(z14.string()).optional()
  }),
  z14.object({
    type: z14.literal("screenshot")
  }),
  z14.object({
    type: z14.literal("scroll"),
    x: z14.number(),
    y: z14.number(),
    scrollX: z14.number(),
    scrollY: z14.number(),
    keys: z14.array(z14.string()).optional()
  }),
  z14.object({
    type: z14.literal("type"),
    text: z14.string()
  }),
  z14.object({
    type: z14.literal("wait")
  })
]);
var computerInputSchema = lazySchema13(
  () => zodSchema13(
    z14.object({
      actions: z14.array(computerActionSchema),
      pendingSafetyChecks: z14.array(safetyCheckSchema),
      status: z14.enum(["in_progress", "completed", "incomplete"])
    })
  )
);
var computerOutputSchema = lazySchema13(
  () => zodSchema13(
    z14.object({
      output: z14.union([
        z14.object({
          type: z14.literal("computer_screenshot"),
          imageUrl: z14.string(),
          fileId: z14.string().optional(),
          detail: z14.enum(["auto", "low", "high", "original"]).optional()
        }),
        z14.object({
          type: z14.literal("computer_screenshot"),
          fileId: z14.string(),
          imageUrl: z14.string().optional(),
          detail: z14.enum(["auto", "low", "high", "original"]).optional()
        })
      ]),
      acknowledgedSafetyChecks: z14.array(safetyCheckSchema).optional()
    })
  )
);
var computerToolFactory = createProviderDefinedToolFactoryWithOutputSchema2({
  id: "openai.computer",
  inputSchema: computerInputSchema,
  outputSchema: computerOutputSchema
});
var computer = (options = {}) => computerToolFactory(options);

// src/tool/custom.ts
import {
  createProviderDefinedToolFactory,
  lazySchema as lazySchema14,
  zodSchema as zodSchema14
} from "@ai-sdk/provider-utils";
import { z as z15 } from "zod/v4";
var customArgsSchema = lazySchema14(
  () => zodSchema14(
    z15.object({
      description: z15.string().optional(),
      format: z15.union([
        z15.object({
          type: z15.literal("grammar"),
          syntax: z15.enum(["regex", "lark"]),
          definition: z15.string()
        }),
        z15.object({
          type: z15.literal("text")
        })
      ]).optional()
    })
  )
);
var customInputSchema = lazySchema14(() => zodSchema14(z15.string()));
var customToolFactory = createProviderDefinedToolFactory({
  id: "openai.custom",
  inputSchema: customInputSchema
});
var customTool = (args) => customToolFactory(args);

// src/tool/file-search.ts
import {
  createProviderExecutedToolFactory as createProviderExecutedToolFactory2,
  lazySchema as lazySchema15,
  zodSchema as zodSchema15
} from "@ai-sdk/provider-utils";
import { z as z16 } from "zod/v4";
var comparisonFilterSchema = z16.object({
  key: z16.string(),
  type: z16.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in", "nin"]),
  value: z16.union([z16.string(), z16.number(), z16.boolean(), z16.array(z16.string())])
});
var compoundFilterSchema = z16.object({
  type: z16.enum(["and", "or"]),
  filters: z16.array(
    z16.union([comparisonFilterSchema, z16.lazy(() => compoundFilterSchema)])
  )
});
var fileSearchArgsSchema = lazySchema15(
  () => zodSchema15(
    z16.object({
      vectorStoreIds: z16.array(z16.string()),
      maxNumResults: z16.number().optional(),
      ranking: z16.object({
        ranker: z16.string().optional(),
        scoreThreshold: z16.number().optional()
      }).optional(),
      filters: z16.union([comparisonFilterSchema, compoundFilterSchema]).optional()
    })
  )
);
var fileSearchOutputSchema = lazySchema15(
  () => zodSchema15(
    z16.object({
      queries: z16.array(z16.string()),
      results: z16.array(
        z16.object({
          attributes: z16.record(z16.string(), z16.unknown()),
          fileId: z16.string(),
          filename: z16.string(),
          score: z16.number(),
          text: z16.string()
        })
      ).nullable()
    })
  )
);
var fileSearch = createProviderExecutedToolFactory2({
  id: "openai.file_search",
  inputSchema: z16.object({}),
  outputSchema: fileSearchOutputSchema
});

// src/tool/image-generation.ts
import {
  createProviderExecutedToolFactory as createProviderExecutedToolFactory3,
  lazySchema as lazySchema16,
  zodSchema as zodSchema16
} from "@ai-sdk/provider-utils";
import { z as z17 } from "zod/v4";
var imageGenerationArgsSchema = lazySchema16(
  () => zodSchema16(
    z17.object({
      background: z17.enum(["auto", "opaque", "transparent"]).optional(),
      inputFidelity: z17.enum(["low", "high"]).optional(),
      inputImageMask: z17.object({
        fileId: z17.string().optional(),
        imageUrl: z17.string().optional()
      }).optional(),
      model: z17.string().optional(),
      moderation: z17.enum(["auto"]).optional(),
      outputCompression: z17.number().int().min(0).max(100).optional(),
      outputFormat: z17.enum(["png", "jpeg", "webp"]).optional(),
      partialImages: z17.number().int().min(0).max(3).optional(),
      quality: z17.enum(["auto", "low", "medium", "high"]).optional(),
      size: z17.enum(["1024x1024", "1024x1536", "1536x1024", "auto"]).optional()
    }).strict()
  )
);
var imageGenerationInputSchema = lazySchema16(() => zodSchema16(z17.object({})));
var imageGenerationOutputSchema = lazySchema16(
  () => zodSchema16(z17.object({ result: z17.string() }))
);
var imageGenerationToolFactory = createProviderExecutedToolFactory3({
  id: "openai.image_generation",
  inputSchema: imageGenerationInputSchema,
  outputSchema: imageGenerationOutputSchema
});
var imageGeneration = (args = {}) => {
  return imageGenerationToolFactory(args);
};

// src/tool/local-shell.ts
import {
  createProviderDefinedToolFactoryWithOutputSchema as createProviderDefinedToolFactoryWithOutputSchema3,
  lazySchema as lazySchema17,
  zodSchema as zodSchema17
} from "@ai-sdk/provider-utils";
import { z as z18 } from "zod/v4";
var localShellInputSchema = lazySchema17(
  () => zodSchema17(
    z18.object({
      action: z18.object({
        type: z18.literal("exec"),
        command: z18.array(z18.string()),
        timeoutMs: z18.number().optional(),
        user: z18.string().optional(),
        workingDirectory: z18.string().optional(),
        env: z18.record(z18.string(), z18.string()).optional()
      })
    })
  )
);
var localShellOutputSchema = lazySchema17(
  () => zodSchema17(z18.object({ output: z18.string() }))
);
var localShell = createProviderDefinedToolFactoryWithOutputSchema3({
  id: "openai.local_shell",
  inputSchema: localShellInputSchema,
  outputSchema: localShellOutputSchema
});

// src/tool/shell.ts
import {
  createProviderDefinedToolFactoryWithOutputSchema as createProviderDefinedToolFactoryWithOutputSchema4,
  lazySchema as lazySchema18,
  zodSchema as zodSchema18
} from "@ai-sdk/provider-utils";
import { z as z19 } from "zod/v4";
var shellInputSchema = lazySchema18(
  () => zodSchema18(
    z19.object({
      action: z19.object({
        commands: z19.array(z19.string()),
        timeoutMs: z19.number().optional(),
        maxOutputLength: z19.number().optional()
      })
    })
  )
);
var shellOutputSchema = lazySchema18(
  () => zodSchema18(
    z19.object({
      output: z19.array(
        z19.object({
          stdout: z19.string(),
          stderr: z19.string(),
          outcome: z19.discriminatedUnion("type", [
            z19.object({ type: z19.literal("timeout") }),
            z19.object({ type: z19.literal("exit"), exitCode: z19.number() })
          ])
        })
      )
    })
  )
);
var shellSkillsSchema = z19.array(
  z19.discriminatedUnion("type", [
    z19.object({
      type: z19.literal("skillReference"),
      providerReference: z19.record(z19.string(), z19.string()),
      version: z19.string().optional()
    }),
    z19.object({
      type: z19.literal("inline"),
      name: z19.string(),
      description: z19.string(),
      source: z19.object({
        type: z19.literal("base64"),
        mediaType: z19.literal("application/zip"),
        data: z19.string()
      })
    })
  ])
).optional();
var shellArgsSchema = lazySchema18(
  () => zodSchema18(
    z19.object({
      environment: z19.union([
        z19.object({
          type: z19.literal("containerAuto"),
          fileIds: z19.array(z19.string()).optional(),
          memoryLimit: z19.enum(["1g", "4g", "16g", "64g"]).optional(),
          networkPolicy: z19.discriminatedUnion("type", [
            z19.object({ type: z19.literal("disabled") }),
            z19.object({
              type: z19.literal("allowlist"),
              allowedDomains: z19.array(z19.string()),
              domainSecrets: z19.array(
                z19.object({
                  domain: z19.string(),
                  name: z19.string(),
                  value: z19.string()
                })
              ).optional()
            })
          ]).optional(),
          skills: shellSkillsSchema
        }),
        z19.object({
          type: z19.literal("containerReference"),
          containerId: z19.string()
        }),
        z19.object({
          type: z19.literal("local").optional(),
          skills: z19.array(
            z19.object({
              name: z19.string(),
              description: z19.string(),
              path: z19.string()
            })
          ).optional()
        })
      ]).optional()
    })
  )
);
var shell = createProviderDefinedToolFactoryWithOutputSchema4({
  id: "openai.shell",
  inputSchema: shellInputSchema,
  outputSchema: shellOutputSchema
});

// src/tool/tool-search.ts
import {
  createProviderDefinedToolFactoryWithOutputSchema as createProviderDefinedToolFactoryWithOutputSchema5,
  lazySchema as lazySchema19,
  zodSchema as zodSchema19
} from "@ai-sdk/provider-utils";
import { z as z20 } from "zod/v4";
var toolSearchArgsSchema = lazySchema19(
  () => zodSchema19(
    z20.object({
      execution: z20.enum(["server", "client"]).optional(),
      description: z20.string().optional(),
      parameters: z20.record(z20.string(), z20.unknown()).optional()
    })
  )
);
var toolSearchInputSchema = lazySchema19(
  () => zodSchema19(
    z20.object({
      arguments: z20.unknown().optional(),
      call_id: z20.string().nullish()
    })
  )
);
var toolSearchOutputSchema = lazySchema19(
  () => zodSchema19(
    z20.object({
      tools: z20.array(z20.record(z20.string(), z20.unknown()))
    })
  )
);
var toolSearchToolFactory = createProviderDefinedToolFactoryWithOutputSchema5({
  id: "openai.tool_search",
  inputSchema: toolSearchInputSchema,
  outputSchema: toolSearchOutputSchema
});
var toolSearch = (args = {}) => toolSearchToolFactory(args);

// src/tool/web-search.ts
import {
  createProviderExecutedToolFactory as createProviderExecutedToolFactory4,
  lazySchema as lazySchema20,
  zodSchema as zodSchema20
} from "@ai-sdk/provider-utils";
import { z as z21 } from "zod/v4";
var webSearchArgsSchema = lazySchema20(
  () => zodSchema20(
    z21.object({
      externalWebAccess: z21.boolean().optional(),
      filters: z21.object({ allowedDomains: z21.array(z21.string()).optional() }).optional(),
      searchContextSize: z21.enum(["low", "medium", "high"]).optional(),
      userLocation: z21.object({
        type: z21.literal("approximate"),
        country: z21.string().optional(),
        city: z21.string().optional(),
        region: z21.string().optional(),
        timezone: z21.string().optional()
      }).optional()
    })
  )
);
var webSearchInputSchema = lazySchema20(() => zodSchema20(z21.object({})));
var webSearchOutputSchema = lazySchema20(
  () => zodSchema20(
    z21.object({
      action: z21.discriminatedUnion("type", [
        z21.object({
          type: z21.literal("search"),
          query: z21.string().optional(),
          queries: z21.array(z21.string()).optional()
        }),
        z21.object({
          type: z21.literal("openPage"),
          url: z21.string().nullish()
        }),
        z21.object({
          type: z21.literal("findInPage"),
          url: z21.string().nullish(),
          pattern: z21.string().nullish()
        })
      ]).optional(),
      sources: z21.array(
        z21.discriminatedUnion("type", [
          z21.object({ type: z21.literal("url"), url: z21.string() }),
          z21.object({ type: z21.literal("api"), name: z21.string() })
        ])
      ).optional()
    })
  )
);
var webSearchToolFactory = createProviderExecutedToolFactory4({
  id: "openai.web_search",
  inputSchema: webSearchInputSchema,
  outputSchema: webSearchOutputSchema
});
var webSearch = (args = {}) => webSearchToolFactory(args);

// src/tool/web-search-preview.ts
import {
  createProviderExecutedToolFactory as createProviderExecutedToolFactory5,
  lazySchema as lazySchema21,
  zodSchema as zodSchema21
} from "@ai-sdk/provider-utils";
import { z as z22 } from "zod/v4";
var webSearchPreviewArgsSchema = lazySchema21(
  () => zodSchema21(
    z22.object({
      searchContextSize: z22.enum(["low", "medium", "high"]).optional(),
      userLocation: z22.object({
        type: z22.literal("approximate"),
        country: z22.string().optional(),
        city: z22.string().optional(),
        region: z22.string().optional(),
        timezone: z22.string().optional()
      }).optional()
    })
  )
);
var webSearchPreviewInputSchema = lazySchema21(
  () => zodSchema21(z22.object({}))
);
var webSearchPreviewOutputSchema = lazySchema21(
  () => zodSchema21(
    z22.object({
      action: z22.discriminatedUnion("type", [
        z22.object({
          type: z22.literal("search"),
          query: z22.string().optional()
        }),
        z22.object({
          type: z22.literal("openPage"),
          url: z22.string().nullish()
        }),
        z22.object({
          type: z22.literal("findInPage"),
          url: z22.string().nullish(),
          pattern: z22.string().nullish()
        })
      ]).optional()
    })
  )
);
var webSearchPreview = createProviderExecutedToolFactory5({
  id: "openai.web_search_preview",
  inputSchema: webSearchPreviewInputSchema,
  outputSchema: webSearchPreviewOutputSchema
});

// src/tool/mcp.ts
import {
  createProviderExecutedToolFactory as createProviderExecutedToolFactory6,
  lazySchema as lazySchema22,
  zodSchema as zodSchema22
} from "@ai-sdk/provider-utils";
import { z as z23 } from "zod/v4";
var jsonValueSchema = z23.lazy(
  () => z23.union([
    z23.string(),
    z23.number(),
    z23.boolean(),
    z23.null(),
    z23.array(jsonValueSchema),
    z23.record(z23.string(), jsonValueSchema)
  ])
);
var mcpArgsSchema = lazySchema22(
  () => zodSchema22(
    z23.object({
      serverLabel: z23.string(),
      allowedTools: z23.union([
        z23.array(z23.string()),
        z23.object({
          readOnly: z23.boolean().optional(),
          toolNames: z23.array(z23.string()).optional()
        })
      ]).optional(),
      authorization: z23.string().optional(),
      connectorId: z23.string().optional(),
      headers: z23.record(z23.string(), z23.string()).optional(),
      requireApproval: z23.union([
        z23.enum(["always", "never"]),
        z23.object({
          never: z23.object({
            toolNames: z23.array(z23.string()).optional()
          }).optional()
        })
      ]).optional(),
      serverDescription: z23.string().optional(),
      serverUrl: z23.string().optional()
    }).refine(
      (v) => v.serverUrl != null || v.connectorId != null,
      "One of serverUrl or connectorId must be provided."
    )
  )
);
var mcpInputSchema = lazySchema22(() => zodSchema22(z23.object({})));
var mcpOutputSchema = lazySchema22(
  () => zodSchema22(
    z23.object({
      type: z23.literal("call"),
      serverLabel: z23.string(),
      name: z23.string(),
      arguments: z23.string(),
      output: z23.string().nullish(),
      error: z23.union([z23.string(), jsonValueSchema]).optional()
    })
  )
);
var mcpToolFactory = createProviderExecutedToolFactory6({
  id: "openai.mcp",
  inputSchema: mcpInputSchema,
  outputSchema: mcpOutputSchema
});
var mcp = (args) => mcpToolFactory(args);

// src/tool/programmatic-tool-calling.ts
import {
  createProviderExecutedToolFactory as createProviderExecutedToolFactory7,
  lazySchema as lazySchema23,
  zodSchema as zodSchema23
} from "@ai-sdk/provider-utils";
import { z as z24 } from "zod/v4";
var programmaticToolCallingInputSchema = lazySchema23(
  () => zodSchema23(
    z24.object({
      code: z24.string(),
      fingerprint: z24.string()
    })
  )
);
var programmaticToolCallingOutputSchema = lazySchema23(
  () => zodSchema23(
    z24.object({
      result: z24.string(),
      status: z24.enum(["completed", "incomplete"])
    })
  )
);
var programmaticToolCallingFactory = createProviderExecutedToolFactory7({
  id: "openai.programmatic_tool_calling",
  inputSchema: programmaticToolCallingInputSchema,
  outputSchema: programmaticToolCallingOutputSchema,
  supportsDeferredResults: true
});
var programmaticToolCalling = () => programmaticToolCallingFactory({});

// src/openai-tools.ts
var openaiTools = {
  /**
   * The apply_patch tool lets GPT-5.1 create, update, and delete files in your
   * codebase using structured diffs. Instead of just suggesting edits, the model
   * emits patch operations that your application applies and then reports back on,
   * enabling iterative, multi-step code editing workflows.
   *
   */
  applyPatch,
  /**
   * Custom tools let callers constrain model output to a grammar (regex or
   * Lark syntax). The model returns a `custom_tool_call` output item whose
   * `input` field is a string matching the specified grammar.
   *
   * @param description - An optional description of the tool.
   * @param format - The output format constraint (grammar type, syntax, and definition).
   */
  customTool,
  /**
   * The Code Interpreter tool allows models to write and run Python code in a
   * sandboxed environment to solve complex problems in domains like data analysis,
   * coding, and math.
   *
   * @param container - The container to use for the code interpreter.
   */
  codeInterpreter,
  /**
   * The computer tool allows models to operate a browser or desktop through
   * batched UI actions. Your application executes the actions and returns an
   * updated screenshot.
   *
   * WARNING: Run computer use in an isolated environment, treat on-screen
   * content as untrusted, and require confirmation for consequential actions.
   */
  computer,
  /**
   * File search is a tool available in the Responses API. It enables models to
   * retrieve information in a knowledge base of previously uploaded files through
   * semantic and keyword search.
   *
   * @param vectorStoreIds - The vector store IDs to use for the file search.
   * @param maxNumResults - The maximum number of results to return.
   * @param ranking - The ranking options to use for the file search.
   * @param filters - The filters to use for the file search.
   */
  fileSearch,
  /**
   * The image generation tool allows you to generate images using a text prompt,
   * and optionally image inputs. It leverages the GPT Image model,
   * and automatically optimizes text inputs for improved performance.
   *
   * @param background - Background type for the generated image. One of 'auto', 'opaque', or 'transparent'.
   * @param inputFidelity - Input fidelity for the generated image. One of 'low' or 'high'.
   * @param inputImageMask - Optional mask for inpainting. Contains fileId and/or imageUrl.
   * @param model - The image generation model to use. Default: gpt-image-1.
   * @param moderation - Moderation level for the generated image. Default: 'auto'.
   * @param outputCompression - Compression level for the output image (0-100).
   * @param outputFormat - The output format of the generated image. One of 'png', 'jpeg', or 'webp'.
   * @param partialImages - Number of partial images to generate in streaming mode (0-3).
   * @param quality - The quality of the generated image. One of 'auto', 'low', 'medium', or 'high'.
   * @param size - The size of the generated image. One of 'auto', '1024x1024', '1024x1536', or '1536x1024'.
   */
  imageGeneration,
  /**
   * Local shell is a tool that allows agents to run shell commands locally
   * on a machine you or the user provides.
   *
   * Supported models: `gpt-5-codex`
   */
  localShell,
  /**
   * The shell tool allows the model to interact with your local computer through
   * a controlled command-line interface. The model proposes shell commands; your
   * integration executes them and returns the outputs.
   *
   * Available through the Responses API for use with GPT-5.1.
   *
   * WARNING: Running arbitrary shell commands can be dangerous. Always sandbox
   * execution or add strict allow-/deny-lists before forwarding a command to
   * the system shell.
   */
  shell,
  /**
   * Web search allows models to access up-to-date information from the internet
   * and provide answers with sourced citations.
   *
   * @param searchContextSize - The search context size to use for the web search.
   * @param userLocation - The user location to use for the web search.
   */
  webSearchPreview,
  /**
   * Web search allows models to access up-to-date information from the internet
   * and provide answers with sourced citations.
   *
   * @param filters - The filters to use for the web search.
   * @param searchContextSize - The search context size to use for the web search.
   * @param userLocation - The user location to use for the web search.
   */
  webSearch,
  /**
   * MCP (Model Context Protocol) allows models to call tools exposed by
   * remote MCP servers or service connectors.
   *
   * @param serverLabel - Label to identify the MCP server.
   * @param allowedTools - Allowed tool names or filter object.
   * @param authorization - OAuth access token for the MCP server/connector.
   * @param connectorId - Identifier for a service connector.
   * @param headers - Optional headers to include in MCP requests.
   * // param requireApproval - Approval policy ('always'|'never'|filter object). (Removed - always 'never')
   * @param serverDescription - Optional description of the server.
   * @param serverUrl - URL for the MCP server.
   */
  mcp,
  /**
   * Programmatic Tool Calling lets OpenAI Responses models write and execute
   * JavaScript that orchestrates eligible tools.
   */
  programmaticToolCalling,
  /**
   * Tool search allows the model to dynamically search for and load deferred
   * tools into the model's context as needed. This helps reduce overall token
   * usage, cost, and latency by only loading tools when the model needs them.
   *
   * To use tool search, mark functions or namespaces with `defer_loading: true`
   * in the tools array. The model will use tool search to load these tools
   * when it determines they are needed.
   */
  toolSearch
};

// src/realtime/openai-realtime-event-mapper.ts
function parseOpenAIRealtimeServerEvent(raw) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s;
  const event = raw;
  const type = event.type;
  switch (type) {
    // ── Session lifecycle ──────────────────────────────────────────
    case "session.created":
      return {
        type: "session-created",
        sessionId: (_a = event.session) == null ? void 0 : _a.id,
        raw
      };
    case "session.updated":
      return { type: "session-updated", raw };
    // ── Input audio buffer ─────────────────────────────────────────
    case "input_audio_buffer.speech_started":
      return {
        type: "speech-started",
        itemId: event.item_id,
        raw
      };
    case "input_audio_buffer.speech_stopped":
      return {
        type: "speech-stopped",
        itemId: event.item_id,
        raw
      };
    case "input_audio_buffer.committed":
      return {
        type: "audio-committed",
        itemId: event.item_id,
        previousItemId: event.previous_item_id,
        raw
      };
    // ── Conversation items ─────────────────────────────────────────
    case "conversation.item.added":
      return {
        type: "conversation-item-added",
        itemId: (_c = (_b = event.item) == null ? void 0 : _b.id) != null ? _c : event.item_id,
        item: event.item,
        raw
      };
    case "conversation.item.input_audio_transcription.completed":
      return {
        type: "input-transcription-completed",
        itemId: event.item_id,
        transcript: (_d = event.transcript) != null ? _d : "",
        raw
      };
    // ── Response lifecycle ──────────────────────────────────────────
    case "response.created":
      return {
        type: "response-created",
        responseId: (_f = (_e = event.response) == null ? void 0 : _e.id) != null ? _f : event.response_id,
        raw
      };
    case "response.done":
      return {
        type: "response-done",
        responseId: (_h = (_g = event.response) == null ? void 0 : _g.id) != null ? _h : event.response_id,
        status: (_j = (_i = event.response) == null ? void 0 : _i.status) != null ? _j : "completed",
        raw
      };
    // ── Output item lifecycle ───────────────────────────────────────
    case "response.output_item.added":
      return {
        type: "output-item-added",
        responseId: event.response_id,
        itemId: (_l = (_k = event.item) == null ? void 0 : _k.id) != null ? _l : event.item_id,
        raw
      };
    case "response.output_item.done":
      return {
        type: "output-item-done",
        responseId: event.response_id,
        itemId: (_n = (_m = event.item) == null ? void 0 : _m.id) != null ? _n : event.item_id,
        raw
      };
    case "response.content_part.added":
      return {
        type: "content-part-added",
        responseId: event.response_id,
        itemId: event.item_id,
        raw
      };
    case "response.content_part.done":
      return {
        type: "content-part-done",
        responseId: event.response_id,
        itemId: event.item_id,
        raw
      };
    // ── Audio output ────────────────────────────────────────────────
    case "response.output_audio.delta":
      return {
        type: "audio-delta",
        responseId: event.response_id,
        itemId: event.item_id,
        delta: event.delta,
        raw
      };
    case "response.output_audio.done":
      return {
        type: "audio-done",
        responseId: event.response_id,
        itemId: event.item_id,
        raw
      };
    // ── Audio transcript output ─────────────────────────────────────
    case "response.output_audio_transcript.delta":
      return {
        type: "audio-transcript-delta",
        responseId: event.response_id,
        itemId: event.item_id,
        delta: event.delta,
        raw
      };
    case "response.output_audio_transcript.done":
      return {
        type: "audio-transcript-done",
        responseId: event.response_id,
        itemId: event.item_id,
        transcript: event.transcript,
        raw
      };
    // ── Text output ─────────────────────────────────────────────────
    case "response.output_text.delta":
      return {
        type: "text-delta",
        responseId: event.response_id,
        itemId: event.item_id,
        delta: event.delta,
        raw
      };
    case "response.output_text.done":
      return {
        type: "text-done",
        responseId: event.response_id,
        itemId: event.item_id,
        text: event.text,
        raw
      };
    // ── Function calling ────────────────────────────────────────────
    case "response.function_call_arguments.delta":
      return {
        type: "function-call-arguments-delta",
        responseId: event.response_id,
        itemId: event.item_id,
        callId: event.call_id,
        delta: event.delta,
        raw
      };
    case "response.function_call_arguments.done":
      return {
        type: "function-call-arguments-done",
        responseId: event.response_id,
        itemId: event.item_id,
        callId: event.call_id,
        name: event.name,
        arguments: event.arguments,
        raw
      };
    // ── Error ───────────────────────────────────────────────────────
    case "error":
      return {
        type: "error",
        message: (_q = (_p = (_o = event.error) == null ? void 0 : _o.message) != null ? _p : event.message) != null ? _q : "Unknown error",
        code: (_s = (_r = event.error) == null ? void 0 : _r.code) != null ? _s : event.code,
        raw
      };
    // ── Pass-through ────────────────────────────────────────────────
    default:
      return { type: "custom", rawType: type, raw };
  }
}
function serializeOpenAIRealtimeClientEvent(event, modelId) {
  switch (event.type) {
    case "session-update":
      return {
        type: "session.update",
        session: buildOpenAISessionConfig(event.config, modelId)
      };
    case "input-audio-append":
      return {
        type: "input_audio_buffer.append",
        audio: event.audio
      };
    case "input-audio-commit":
      return { type: "input_audio_buffer.commit" };
    case "input-audio-clear":
      return { type: "input_audio_buffer.clear" };
    case "conversation-item-create": {
      const item = event.item;
      switch (item.type) {
        case "text-message":
          return {
            type: "conversation.item.create",
            item: {
              type: "message",
              role: item.role,
              content: [{ type: "input_text", text: item.text }]
            }
          };
        case "audio-message":
          return {
            type: "conversation.item.create",
            item: {
              type: "message",
              role: item.role,
              content: [{ type: "input_audio", audio: item.audio }]
            }
          };
        case "function-call-output":
          return {
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: item.callId,
              output: item.output
            }
          };
      }
      break;
    }
    case "conversation-item-truncate":
      return {
        type: "conversation.item.truncate",
        item_id: event.itemId,
        content_index: event.contentIndex,
        audio_end_ms: event.audioEndMs
      };
    case "response-create":
      return {
        type: "response.create",
        ...event.options != null ? {
          response: {
            ...event.options.modalities != null ? { output_modalities: event.options.modalities } : {},
            ...event.options.instructions != null ? { instructions: event.options.instructions } : {},
            ...event.options.metadata != null ? { metadata: event.options.metadata } : {}
          }
        } : {}
      };
    case "response-cancel":
      return { type: "response.cancel" };
  }
}
function buildOpenAISessionConfig(config, modelId) {
  var _a;
  const session = {
    type: "realtime",
    model: modelId
  };
  if (config.instructions != null) {
    session.instructions = config.instructions;
  }
  if (config.outputModalities != null) {
    session.output_modalities = config.outputModalities;
  }
  const audio = {};
  if (config.inputAudioFormat != null || config.inputAudioTranscription != null || config.turnDetection != null) {
    const input = {};
    if (config.inputAudioFormat != null) {
      input.format = {
        type: config.inputAudioFormat.type,
        ...config.inputAudioFormat.rate != null ? { rate: config.inputAudioFormat.rate } : {}
      };
    }
    if (config.turnDetection != null) {
      if (config.turnDetection.type === "disabled") {
        input.turn_detection = null;
      } else {
        const td = {
          type: config.turnDetection.type === "server-vad" ? "server_vad" : "semantic_vad"
        };
        if (config.turnDetection.threshold != null) {
          td.threshold = config.turnDetection.threshold;
        }
        if (config.turnDetection.silenceDurationMs != null) {
          td.silence_duration_ms = config.turnDetection.silenceDurationMs;
        }
        if (config.turnDetection.prefixPaddingMs != null) {
          td.prefix_padding_ms = config.turnDetection.prefixPaddingMs;
        }
        input.turn_detection = td;
      }
    }
    if (config.inputAudioTranscription != null) {
      input.transcription = {
        model: (_a = config.inputAudioTranscription.model) != null ? _a : "gpt-realtime-whisper",
        ...config.inputAudioTranscription.language != null ? { language: config.inputAudioTranscription.language } : {},
        ...config.inputAudioTranscription.prompt != null ? { prompt: config.inputAudioTranscription.prompt } : {}
      };
    }
    audio.input = input;
  }
  if (config.outputAudioFormat != null || config.voice != null) {
    const output = {};
    if (config.outputAudioFormat != null) {
      output.format = {
        type: config.outputAudioFormat.type,
        ...config.outputAudioFormat.rate != null ? { rate: config.outputAudioFormat.rate } : {}
      };
    }
    if (config.voice != null) {
      output.voice = config.voice;
    }
    audio.output = output;
  }
  if (Object.keys(audio).length > 0) {
    session.audio = audio;
  }
  if (config.tools != null && config.tools.length > 0) {
    session.tools = config.tools.map((tool) => ({
      type: tool.type,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
    session.tool_choice = "auto";
  }
  if (config.providerOptions != null) {
    Object.assign(session, config.providerOptions);
  }
  return session;
}

// src/realtime/openai-realtime-model.ts
var OpenAIRealtimeModel = class {
  constructor(modelId, config) {
    this.specificationVersion = "v4";
    this.modelId = modelId;
    this.provider = config.provider;
    this.config = config;
  }
  async doCreateClientSecret(options) {
    var _a;
    const fetchFn = (_a = this.config.fetch) != null ? _a : fetch;
    const url = `${this.config.baseURL}/realtime/client_secrets`;
    const session = options.sessionConfig != null ? buildOpenAISessionConfig(options.sessionConfig, this.modelId) : { type: "realtime", model: this.modelId };
    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        ...this.config.headers(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        session,
        ...options.expiresAfterSeconds != null ? {
          // `anchor` is required by the client secrets endpoint; without it
          // the request fails with "Missing required parameter:
          // 'expires_after.anchor'".
          expires_after: {
            anchor: "created_at",
            seconds: options.expiresAfterSeconds
          }
        } : {}
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `OpenAI realtime client secret request failed: ${response.status} ${text}`
      );
    }
    const data = await response.json();
    return {
      token: data.value,
      url: `wss://${new URL(this.config.baseURL).host}/v1/realtime?model=${encodeURIComponent(this.modelId)}`,
      expiresAt: data.expires_at
    };
  }
  getWebSocketConfig(options) {
    return {
      url: options.url,
      protocols: ["realtime", `openai-insecure-api-key.${options.token}`]
    };
  }
  parseServerEvent(raw) {
    return parseOpenAIRealtimeServerEvent(raw);
  }
  serializeClientEvent(event) {
    return serializeOpenAIRealtimeClientEvent(event, this.modelId);
  }
  buildSessionConfig(config) {
    return buildOpenAISessionConfig(config, this.modelId);
  }
};

// src/responses/openai-responses-language-model.ts
import {
  APICallError as APICallError2
} from "@ai-sdk/provider";
import {
  combineHeaders as combineHeaders6,
  createEventSourceResponseHandler as createEventSourceResponseHandler3,
  createJsonResponseHandler as createJsonResponseHandler6,
  createToolNameMapping,
  generateId as generateId2,
  isCustomReasoning as isCustomReasoning2,
  parseProviderOptions as parseProviderOptions7,
  postJsonToApi as postJsonToApi5,
  serializeModelOptions as serializeModelOptions5,
  WORKFLOW_DESERIALIZE as WORKFLOW_DESERIALIZE5,
  WORKFLOW_SERIALIZE as WORKFLOW_SERIALIZE5
} from "@ai-sdk/provider-utils";

// src/responses/convert-openai-responses-usage.ts
function convertOpenAIResponsesUsage(usage) {
  var _a, _b, _c, _d, _e, _f;
  if (usage == null) {
    return {
      inputTokens: {
        total: void 0,
        noCache: void 0,
        cacheRead: void 0,
        cacheWrite: void 0
      },
      outputTokens: {
        total: void 0,
        text: void 0,
        reasoning: void 0
      },
      raw: void 0
    };
  }
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const cachedTokens = (_b = (_a = usage.input_tokens_details) == null ? void 0 : _a.cached_tokens) != null ? _b : 0;
  const cacheWriteTokens = (_d = (_c = usage.input_tokens_details) == null ? void 0 : _c.cache_write_tokens) != null ? _d : void 0;
  const reasoningTokens = (_f = (_e = usage.output_tokens_details) == null ? void 0 : _e.reasoning_tokens) != null ? _f : 0;
  return {
    inputTokens: {
      total: inputTokens,
      noCache: inputTokens - cachedTokens - (cacheWriteTokens != null ? cacheWriteTokens : 0),
      cacheRead: cachedTokens,
      cacheWrite: cacheWriteTokens
    },
    outputTokens: {
      total: outputTokens,
      text: outputTokens - reasoningTokens,
      reasoning: reasoningTokens
    },
    raw: usage
  };
}

// src/responses/convert-to-openai-responses-input.ts
import {
  UnsupportedFunctionalityError as UnsupportedFunctionalityError4
} from "@ai-sdk/provider";
import {
  convertToBase64 as convertToBase642,
  getTopLevelMediaType as getTopLevelMediaType2,
  isNonNullable,
  parseJSON,
  parseProviderOptions as parseProviderOptions6,
  resolveFullMediaType as resolveFullMediaType2,
  resolveProviderReference as resolveProviderReference2,
  validateTypes
} from "@ai-sdk/provider-utils";
import { z as z25 } from "zod/v4";
function serializeToolCallArguments2(input) {
  return JSON.stringify(input === void 0 ? {} : input);
}
function mapToolCaller(caller) {
  return caller == null ? void 0 : caller.type === "program" ? { type: "program", caller_id: caller.callerId } : caller;
}
function getPromptCacheBreakpoint2(providerOptions, providerOptionsName) {
  var _a;
  return (_a = providerOptions == null ? void 0 : providerOptions[providerOptionsName]) == null ? void 0 : _a.promptCacheBreakpoint;
}
function isFileId(data, prefixes) {
  if (!prefixes) return false;
  return prefixes.some((prefix) => data.startsWith(prefix));
}
async function convertToOpenAIResponsesInput({
  prompt,
  toolNameMapping,
  systemMessageMode,
  providerOptionsName,
  fileIdPrefixes,
  passThroughUnsupportedFiles = false,
  store,
  hasConversation = false,
  hasPreviousResponseId = false,
  hasLocalShellTool = false,
  hasShellTool = false,
  hasApplyPatchTool = false,
  hasComputerTool = false,
  customProviderToolNames
}) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E, _F, _G, _H, _I, _J, _K, _L;
  let input = [];
  const warnings = [];
  const processedApprovalIds = /* @__PURE__ */ new Set();
  for (const { role, content, providerOptions } of prompt) {
    switch (role) {
      case "system": {
        switch (systemMessageMode) {
          case "system": {
            const promptCacheBreakpoint = getPromptCacheBreakpoint2(
              providerOptions,
              providerOptionsName
            );
            input.push({
              role: "system",
              content: promptCacheBreakpoint == null ? content : [
                {
                  type: "input_text",
                  text: content,
                  prompt_cache_breakpoint: promptCacheBreakpoint
                }
              ]
            });
            break;
          }
          case "developer": {
            const promptCacheBreakpoint = getPromptCacheBreakpoint2(
              providerOptions,
              providerOptionsName
            );
            input.push({
              role: "developer",
              content: promptCacheBreakpoint == null ? content : [
                {
                  type: "input_text",
                  text: content,
                  prompt_cache_breakpoint: promptCacheBreakpoint
                }
              ]
            });
            break;
          }
          case "remove": {
            warnings.push({
              type: "other",
              message: "system messages are removed for this model"
            });
            break;
          }
          default: {
            const _exhaustiveCheck = systemMessageMode;
            throw new Error(
              `Unsupported system message mode: ${_exhaustiveCheck}`
            );
          }
        }
        break;
      }
      case "user": {
        input.push({
          role: "user",
          content: content.map((part, index) => {
            var _a2, _b2, _c2, _d2, _e2;
            switch (part.type) {
              case "text": {
                const promptCacheBreakpoint = getPromptCacheBreakpoint2(
                  part.providerOptions,
                  providerOptionsName
                );
                return {
                  type: "input_text",
                  text: part.text,
                  ...promptCacheBreakpoint != null && {
                    prompt_cache_breakpoint: promptCacheBreakpoint
                  }
                };
              }
              case "file": {
                const promptCacheBreakpoint = getPromptCacheBreakpoint2(
                  part.providerOptions,
                  providerOptionsName
                );
                switch (part.data.type) {
                  case "reference": {
                    const fileId = resolveProviderReference2({
                      reference: part.data.reference,
                      provider: providerOptionsName
                    });
                    if (getTopLevelMediaType2(part.mediaType) === "image") {
                      return {
                        type: "input_image",
                        file_id: fileId,
                        detail: (_b2 = (_a2 = part.providerOptions) == null ? void 0 : _a2[providerOptionsName]) == null ? void 0 : _b2.imageDetail,
                        ...promptCacheBreakpoint != null && {
                          prompt_cache_breakpoint: promptCacheBreakpoint
                        }
                      };
                    }
                    return {
                      type: "input_file",
                      file_id: fileId,
                      ...promptCacheBreakpoint != null && {
                        prompt_cache_breakpoint: promptCacheBreakpoint
                      }
                    };
                  }
                  case "text": {
                    throw new UnsupportedFunctionalityError4({
                      functionality: "text file parts"
                    });
                  }
                  case "url":
                  case "data": {
                    const topLevel = getTopLevelMediaType2(part.mediaType);
                    if (topLevel === "image") {
                      return {
                        type: "input_image",
                        ...part.data.type === "url" ? { image_url: part.data.url.toString() } : typeof part.data.data === "string" && isFileId(part.data.data, fileIdPrefixes) ? { file_id: part.data.data } : {
                          image_url: `data:${resolveFullMediaType2({ part })};base64,${convertToBase642(part.data.data)}`
                        },
                        detail: (_d2 = (_c2 = part.providerOptions) == null ? void 0 : _c2[providerOptionsName]) == null ? void 0 : _d2.imageDetail,
                        ...promptCacheBreakpoint != null && {
                          prompt_cache_breakpoint: promptCacheBreakpoint
                        }
                      };
                    } else {
                      if (part.data.type === "url") {
                        return {
                          type: "input_file",
                          file_url: part.data.url.toString(),
                          ...promptCacheBreakpoint != null && {
                            prompt_cache_breakpoint: promptCacheBreakpoint
                          }
                        };
                      }
                      const fullMediaType = resolveFullMediaType2({ part });
                      if (fullMediaType !== "application/pdf" && !passThroughUnsupportedFiles) {
                        throw new UnsupportedFunctionalityError4({
                          functionality: `file part media type ${fullMediaType}`
                        });
                      }
                      return {
                        type: "input_file",
                        ...typeof part.data.data === "string" && isFileId(part.data.data, fileIdPrefixes) ? { file_id: part.data.data } : {
                          filename: (_e2 = part.filename) != null ? _e2 : fullMediaType === "application/pdf" ? `part-${index}.pdf` : `part-${index}`,
                          file_data: `data:${fullMediaType};base64,${convertToBase642(part.data.data)}`
                        },
                        ...promptCacheBreakpoint != null && {
                          prompt_cache_breakpoint: promptCacheBreakpoint
                        }
                      };
                    }
                  }
                }
              }
            }
          })
        });
        break;
      }
      case "assistant": {
        const reasoningMessages = {};
        for (const part of content) {
          switch (part.type) {
            case "text": {
              const providerOptions2 = (_a = part.providerOptions) == null ? void 0 : _a[providerOptionsName];
              const id = providerOptions2 == null ? void 0 : providerOptions2.itemId;
              const phase = providerOptions2 == null ? void 0 : providerOptions2.phase;
              if (hasConversation && id != null) {
                break;
              }
              if (store && id != null) {
                input.push({ type: "item_reference", id });
                break;
              }
              input.push({
                role: "assistant",
                content: [{ type: "output_text", text: part.text }],
                id,
                ...phase != null && { phase }
              });
              break;
            }
            case "tool-call": {
              const id = (_f = (_c = (_b = part.providerOptions) == null ? void 0 : _b[providerOptionsName]) == null ? void 0 : _c.itemId) != null ? _f : (_e = (_d = part.providerMetadata) == null ? void 0 : _d[providerOptionsName]) == null ? void 0 : _e.itemId;
              const namespace = (_k = (_h = (_g = part.providerOptions) == null ? void 0 : _g[providerOptionsName]) == null ? void 0 : _h.namespace) != null ? _k : (_j = (_i = part.providerMetadata) == null ? void 0 : _i[providerOptionsName]) == null ? void 0 : _j.namespace;
              const caller = (_m = (_l = part.providerOptions) == null ? void 0 : _l[providerOptionsName]) == null ? void 0 : _m.caller;
              if (hasConversation && id != null) {
                break;
              }
              const resolvedToolName = toolNameMapping.toProviderToolName(
                part.toolName
              );
              if (resolvedToolName === "tool_search") {
                if (store && id != null) {
                  input.push({ type: "item_reference", id });
                  break;
                }
                const parsedInput = typeof part.input === "string" ? await parseJSON({
                  text: part.input,
                  schema: toolSearchInputSchema
                }) : await validateTypes({
                  value: part.input,
                  schema: toolSearchInputSchema
                });
                const execution = parsedInput.call_id != null ? "client" : "server";
                input.push({
                  type: "tool_search_call",
                  id: id != null ? id : part.toolCallId,
                  execution,
                  call_id: (_n = parsedInput.call_id) != null ? _n : null,
                  status: "completed",
                  arguments: parsedInput.arguments
                });
                break;
              }
              if (resolvedToolName === "programmatic_tool_calling") {
                if (store && id != null) {
                  input.push({ type: "item_reference", id });
                  break;
                }
                const parsedInput = await validateTypes({
                  value: part.input,
                  schema: programmaticToolCallingInputSchema
                });
                input.push({
                  type: "program",
                  id: id != null ? id : part.toolCallId,
                  call_id: part.toolCallId,
                  code: parsedInput.code,
                  fingerprint: parsedInput.fingerprint
                });
                break;
              }
              if (part.providerExecuted) {
                if (store && id != null) {
                  input.push({ type: "item_reference", id });
                }
                break;
              }
              if (hasPreviousResponseId && store && id != null) {
                break;
              }
              const isProviderDefinedToolCall = hasLocalShellTool && resolvedToolName === "local_shell" || hasShellTool && resolvedToolName === "shell" || hasApplyPatchTool && resolvedToolName === "apply_patch" || hasComputerTool && resolvedToolName === "computer" || ((_o = customProviderToolNames == null ? void 0 : customProviderToolNames.has(resolvedToolName)) != null ? _o : false);
              if (store && id != null && isProviderDefinedToolCall) {
                input.push({ type: "item_reference", id });
                break;
              }
              if (hasLocalShellTool && resolvedToolName === "local_shell") {
                const parsedInput = await validateTypes({
                  value: part.input,
                  schema: localShellInputSchema
                });
                input.push({
                  type: "local_shell_call",
                  call_id: part.toolCallId,
                  id,
                  action: {
                    type: "exec",
                    command: parsedInput.action.command,
                    timeout_ms: parsedInput.action.timeoutMs,
                    user: parsedInput.action.user,
                    working_directory: parsedInput.action.workingDirectory,
                    env: parsedInput.action.env
                  }
                });
                break;
              }
              if (hasShellTool && resolvedToolName === "shell") {
                const parsedInput = await validateTypes({
                  value: part.input,
                  schema: shellInputSchema
                });
                input.push({
                  type: "shell_call",
                  call_id: part.toolCallId,
                  id,
                  status: "completed",
                  action: {
                    commands: parsedInput.action.commands,
                    timeout_ms: parsedInput.action.timeoutMs,
                    max_output_length: parsedInput.action.maxOutputLength
                  }
                });
                break;
              }
              if (hasApplyPatchTool && resolvedToolName === "apply_patch") {
                const parsedInput = await validateTypes({
                  value: part.input,
                  schema: applyPatchInputSchema
                });
                input.push({
                  type: "apply_patch_call",
                  call_id: parsedInput.callId,
                  id,
                  status: "completed",
                  operation: parsedInput.operation
                });
                break;
              }
              if (hasComputerTool && resolvedToolName === "computer") {
                const parsedInput = await validateTypes({
                  value: part.input,
                  schema: computerInputSchema
                });
                input.push({
                  type: "computer_call",
                  call_id: part.toolCallId,
                  id,
                  status: parsedInput.status,
                  actions: parsedInput.actions.map((action) => {
                    switch (action.type) {
                      case "click":
                      case "double_click":
                      case "move":
                        return {
                          ...action,
                          keys: action.keys
                        };
                      case "drag":
                        return {
                          ...action,
                          keys: action.keys
                        };
                      case "scroll":
                        return {
                          type: "scroll",
                          x: action.x,
                          y: action.y,
                          scroll_x: action.scrollX,
                          scroll_y: action.scrollY,
                          keys: action.keys
                        };
                      default:
                        return action;
                    }
                  }),
                  pending_safety_checks: parsedInput.pendingSafetyChecks.map(
                    (safetyCheck) => ({
                      id: safetyCheck.id,
                      code: safetyCheck.code,
                      message: safetyCheck.message
                    })
                  )
                });
                break;
              }
              if (customProviderToolNames == null ? void 0 : customProviderToolNames.has(resolvedToolName)) {
                input.push({
                  type: "custom_tool_call",
                  call_id: part.toolCallId,
                  name: resolvedToolName,
                  input: typeof part.input === "string" ? part.input : JSON.stringify(part.input),
                  id
                });
                break;
              }
              input.push({
                type: "function_call",
                call_id: part.toolCallId,
                name: resolvedToolName,
                arguments: serializeToolCallArguments2(part.input),
                ...namespace != null && { namespace },
                ...caller != null && {
                  caller: mapToolCaller(caller)
                }
              });
              break;
            }
            // assistant tool result parts are from provider-executed tools:
            case "tool-result": {
              if (part.output.type === "execution-denied" || part.output.type === "json" && typeof part.output.value === "object" && part.output.value != null && "type" in part.output.value && part.output.value.type === "execution-denied") {
                break;
              }
              if (hasConversation) {
                break;
              }
              const resolvedResultToolName = toolNameMapping.toProviderToolName(
                part.toolName
              );
              if (resolvedResultToolName === "tool_search") {
                const itemId = (_u = (_t = (_q = (_p = part.providerOptions) == null ? void 0 : _p[providerOptionsName]) == null ? void 0 : _q.itemId) != null ? _t : (_s = (_r = part.providerMetadata) == null ? void 0 : _r[providerOptionsName]) == null ? void 0 : _s.itemId) != null ? _u : part.toolCallId;
                if (store) {
                  input.push({ type: "item_reference", id: itemId });
                } else if (part.output.type === "json") {
                  const parsedOutput = await validateTypes({
                    value: part.output.value,
                    schema: toolSearchOutputSchema
                  });
                  input.push({
                    type: "tool_search_output",
                    id: itemId,
                    execution: "server",
                    call_id: null,
                    status: "completed",
                    tools: parsedOutput.tools
                  });
                }
                break;
              }
              if (resolvedResultToolName === "programmatic_tool_calling") {
                const itemId = (_A = (_z = (_w = (_v = part.providerOptions) == null ? void 0 : _v[providerOptionsName]) == null ? void 0 : _w.itemId) != null ? _z : (_y = (_x = part.providerMetadata) == null ? void 0 : _x[providerOptionsName]) == null ? void 0 : _y.itemId) != null ? _A : part.toolCallId;
                if (store) {
                  input.push({ type: "item_reference", id: itemId });
                } else if (part.output.type === "json") {
                  const parsedOutput = await validateTypes({
                    value: part.output.value,
                    schema: programmaticToolCallingOutputSchema
                  });
                  input.push({
                    type: "program_output",
                    id: itemId,
                    call_id: part.toolCallId,
                    result: parsedOutput.result,
                    status: parsedOutput.status
                  });
                }
                break;
              }
              if (hasShellTool && resolvedResultToolName === "shell") {
                if (part.output.type === "json") {
                  const parsedOutput = await validateTypes({
                    value: part.output.value,
                    schema: shellOutputSchema
                  });
                  input.push({
                    type: "shell_call_output",
                    call_id: part.toolCallId,
                    output: parsedOutput.output.map((item) => ({
                      stdout: item.stdout,
                      stderr: item.stderr,
                      outcome: item.outcome.type === "timeout" ? { type: "timeout" } : {
                        type: "exit",
                        exit_code: item.outcome.exitCode
                      }
                    }))
                  });
                }
                break;
              }
              if (store) {
                const itemId = (_D = (_C = (_B = part.providerOptions) == null ? void 0 : _B[providerOptionsName]) == null ? void 0 : _C.itemId) != null ? _D : part.toolCallId;
                input.push({ type: "item_reference", id: itemId });
              } else {
                warnings.push({
                  type: "other",
                  message: `Results for OpenAI tool ${part.toolName} are not sent to the API when store is false`
                });
              }
              break;
            }
            case "reasoning": {
              const providerOptions2 = await parseProviderOptions6({
                provider: providerOptionsName,
                providerOptions: part.providerOptions,
                schema: openaiResponsesReasoningProviderOptionsSchema
              });
              const reasoningId = providerOptions2 == null ? void 0 : providerOptions2.itemId;
              if ((hasConversation || hasPreviousResponseId) && reasoningId != null) {
                break;
              }
              if (reasoningId != null) {
                const reasoningMessage = reasoningMessages[reasoningId];
                if (store) {
                  if (reasoningMessage === void 0) {
                    input.push({ type: "item_reference", id: reasoningId });
                    reasoningMessages[reasoningId] = {
                      type: "reasoning",
                      id: reasoningId,
                      summary: []
                    };
                  }
                } else {
                  const summaryParts = [];
                  if (part.text.length > 0) {
                    summaryParts.push({
                      type: "summary_text",
                      text: part.text
                    });
                  } else if (reasoningMessage !== void 0) {
                    warnings.push({
                      type: "other",
                      message: `Cannot append empty reasoning part to existing reasoning sequence. Skipping reasoning part: ${JSON.stringify(part)}.`
                    });
                  }
                  if (reasoningMessage === void 0) {
                    reasoningMessages[reasoningId] = {
                      type: "reasoning",
                      id: reasoningId,
                      encrypted_content: providerOptions2 == null ? void 0 : providerOptions2.reasoningEncryptedContent,
                      summary: summaryParts
                    };
                    input.push(reasoningMessages[reasoningId]);
                  } else {
                    reasoningMessage.summary.push(...summaryParts);
                    if ((providerOptions2 == null ? void 0 : providerOptions2.reasoningEncryptedContent) != null) {
                      reasoningMessage.encrypted_content = providerOptions2.reasoningEncryptedContent;
                    }
                  }
                }
              } else {
                const encryptedContent = providerOptions2 == null ? void 0 : providerOptions2.reasoningEncryptedContent;
                if (encryptedContent != null) {
                  const summaryParts = [];
                  if (part.text.length > 0) {
                    summaryParts.push({
                      type: "summary_text",
                      text: part.text
                    });
                  }
                  input.push({
                    type: "reasoning",
                    encrypted_content: encryptedContent,
                    summary: summaryParts
                  });
                } else {
                  warnings.push({
                    type: "other",
                    message: `Non-OpenAI reasoning parts are not supported. Skipping reasoning part: ${JSON.stringify(part)}.`
                  });
                }
              }
              break;
            }
            case "custom": {
              if (part.kind === "openai.compaction") {
                const providerOptions2 = (_E = part.providerOptions) == null ? void 0 : _E[providerOptionsName];
                const id = providerOptions2 == null ? void 0 : providerOptions2.itemId;
                if (hasConversation && id != null) {
                  break;
                }
                if (store && id != null) {
                  input.push({ type: "item_reference", id });
                  break;
                }
                const encryptedContent = providerOptions2 == null ? void 0 : providerOptions2.encryptedContent;
                if (id != null) {
                  input.push({
                    type: "compaction",
                    id,
                    encrypted_content: encryptedContent
                  });
                }
              }
              break;
            }
          }
        }
        break;
      }
      case "tool": {
        for (const part of content) {
          if (part.type === "tool-approval-response") {
            const approvalResponse = part;
            if (processedApprovalIds.has(approvalResponse.approvalId)) {
              continue;
            }
            processedApprovalIds.add(approvalResponse.approvalId);
            if (store) {
              input.push({
                type: "item_reference",
                id: approvalResponse.approvalId
              });
            }
            input.push({
              type: "mcp_approval_response",
              approval_request_id: approvalResponse.approvalId,
              approve: approvalResponse.approved
            });
            continue;
          }
          const output = part.output;
          if (output.type === "execution-denied") {
            const approvalId = (_G = (_F = output.providerOptions) == null ? void 0 : _F.openai) == null ? void 0 : _G.approvalId;
            if (approvalId) {
              continue;
            }
          }
          const resolvedToolName = toolNameMapping.toProviderToolName(
            part.toolName
          );
          if (resolvedToolName === "tool_search" && output.type === "json") {
            const parsedOutput = await validateTypes({
              value: output.value,
              schema: toolSearchOutputSchema
            });
            input.push({
              type: "tool_search_output",
              execution: "client",
              call_id: part.toolCallId,
              status: "completed",
              tools: parsedOutput.tools
            });
            continue;
          }
          if (hasLocalShellTool && resolvedToolName === "local_shell" && output.type === "json") {
            const parsedOutput = await validateTypes({
              value: output.value,
              schema: localShellOutputSchema
            });
            input.push({
              type: "local_shell_call_output",
              call_id: part.toolCallId,
              output: parsedOutput.output
            });
            continue;
          }
          if (hasShellTool && resolvedToolName === "shell" && output.type === "json") {
            const parsedOutput = await validateTypes({
              value: output.value,
              schema: shellOutputSchema
            });
            input.push({
              type: "shell_call_output",
              call_id: part.toolCallId,
              output: parsedOutput.output.map((item) => ({
                stdout: item.stdout,
                stderr: item.stderr,
                outcome: item.outcome.type === "timeout" ? { type: "timeout" } : {
                  type: "exit",
                  exit_code: item.outcome.exitCode
                }
              }))
            });
            continue;
          }
          if (hasApplyPatchTool && part.toolName === "apply_patch" && output.type === "json") {
            const parsedOutput = await validateTypes({
              value: output.value,
              schema: applyPatchOutputSchema
            });
            input.push({
              type: "apply_patch_call_output",
              call_id: part.toolCallId,
              status: parsedOutput.status,
              output: parsedOutput.output
            });
            continue;
          }
          if (hasComputerTool && resolvedToolName === "computer" && output.type === "json") {
            const parsedOutput = await validateTypes({
              value: output.value,
              schema: computerOutputSchema
            });
            input.push({
              type: "computer_call_output",
              call_id: part.toolCallId,
              output: {
                type: "computer_screenshot",
                image_url: parsedOutput.output.imageUrl,
                file_id: parsedOutput.output.fileId,
                detail: parsedOutput.output.detail
              },
              acknowledged_safety_checks: (_H = parsedOutput.acknowledgedSafetyChecks) == null ? void 0 : _H.map((safetyCheck) => ({
                id: safetyCheck.id,
                code: safetyCheck.code,
                message: safetyCheck.message
              }))
            });
            continue;
          }
          if (customProviderToolNames == null ? void 0 : customProviderToolNames.has(resolvedToolName)) {
            let outputValue;
            switch (output.type) {
              case "text":
              case "error-text":
                outputValue = output.value;
                break;
              case "execution-denied":
                outputValue = (_I = output.reason) != null ? _I : "Tool call execution denied.";
                break;
              case "json":
              case "error-json":
                outputValue = JSON.stringify(output.value);
                break;
              case "content":
                outputValue = output.value.map((item) => {
                  var _a2, _b2, _c2;
                  const promptCacheBreakpoint = getPromptCacheBreakpoint2(
                    item.providerOptions,
                    providerOptionsName
                  );
                  switch (item.type) {
                    case "text":
                      return {
                        type: "input_text",
                        text: item.text,
                        ...promptCacheBreakpoint != null && {
                          prompt_cache_breakpoint: promptCacheBreakpoint
                        }
                      };
                    case "file": {
                      const topLevel = getTopLevelMediaType2(item.mediaType);
                      const imageDetail = (_b2 = (_a2 = item.providerOptions) == null ? void 0 : _a2[providerOptionsName]) == null ? void 0 : _b2.imageDetail;
                      if (item.data.type === "data") {
                        const fullMediaType = resolveFullMediaType2({
                          part: item
                        });
                        if (topLevel === "image") {
                          return {
                            type: "input_image",
                            image_url: `data:${fullMediaType};base64,${convertToBase642(item.data.data)}`,
                            detail: imageDetail,
                            ...promptCacheBreakpoint != null && {
                              prompt_cache_breakpoint: promptCacheBreakpoint
                            }
                          };
                        }
                        return {
                          type: "input_file",
                          filename: (_c2 = item.filename) != null ? _c2 : "data",
                          file_data: `data:${fullMediaType};base64,${convertToBase642(item.data.data)}`,
                          ...promptCacheBreakpoint != null && {
                            prompt_cache_breakpoint: promptCacheBreakpoint
                          }
                        };
                      }
                      if (item.data.type === "url") {
                        if (topLevel === "image") {
                          return {
                            type: "input_image",
                            image_url: item.data.url.toString(),
                            detail: imageDetail,
                            ...promptCacheBreakpoint != null && {
                              prompt_cache_breakpoint: promptCacheBreakpoint
                            }
                          };
                        }
                        return {
                          type: "input_file",
                          file_url: item.data.url.toString(),
                          ...promptCacheBreakpoint != null && {
                            prompt_cache_breakpoint: promptCacheBreakpoint
                          }
                        };
                      }
                      warnings.push({
                        type: "other",
                        message: `unsupported custom tool content part type: ${item.type} with data type: ${item.data.type}`
                      });
                      return void 0;
                    }
                    default:
                      warnings.push({
                        type: "other",
                        message: `unsupported custom tool content part type: ${item.type}`
                      });
                      return void 0;
                  }
                }).filter(isNonNullable);
                break;
              default:
                outputValue = "";
            }
            input.push({
              type: "custom_tool_call_output",
              call_id: part.toolCallId,
              output: outputValue
            });
            continue;
          }
          let contentValue;
          switch (output.type) {
            case "text":
            case "error-text":
              contentValue = output.value;
              break;
            case "execution-denied":
              contentValue = (_J = output.reason) != null ? _J : "Tool call execution denied.";
              break;
            case "json":
            case "error-json":
              contentValue = JSON.stringify(output.value);
              break;
            case "content":
              contentValue = output.value.map((item) => {
                var _a2, _b2, _c2;
                const promptCacheBreakpoint = getPromptCacheBreakpoint2(
                  item.providerOptions,
                  providerOptionsName
                );
                switch (item.type) {
                  case "text": {
                    return {
                      type: "input_text",
                      text: item.text,
                      ...promptCacheBreakpoint != null && {
                        prompt_cache_breakpoint: promptCacheBreakpoint
                      }
                    };
                  }
                  case "file": {
                    const topLevel = getTopLevelMediaType2(item.mediaType);
                    const imageDetail = (_b2 = (_a2 = item.providerOptions) == null ? void 0 : _a2[providerOptionsName]) == null ? void 0 : _b2.imageDetail;
                    if (item.data.type === "data") {
                      const fullMediaType = resolveFullMediaType2({
                        part: item
                      });
                      if (topLevel === "image") {
                        return {
                          type: "input_image",
                          image_url: `data:${fullMediaType};base64,${convertToBase642(item.data.data)}`,
                          detail: imageDetail,
                          ...promptCacheBreakpoint != null && {
                            prompt_cache_breakpoint: promptCacheBreakpoint
                          }
                        };
                      }
                      return {
                        type: "input_file",
                        filename: (_c2 = item.filename) != null ? _c2 : "data",
                        file_data: `data:${fullMediaType};base64,${convertToBase642(item.data.data)}`,
                        ...promptCacheBreakpoint != null && {
                          prompt_cache_breakpoint: promptCacheBreakpoint
                        }
                      };
                    }
                    if (item.data.type === "url") {
                      if (topLevel === "image") {
                        return {
                          type: "input_image",
                          image_url: item.data.url.toString(),
                          detail: imageDetail,
                          ...promptCacheBreakpoint != null && {
                            prompt_cache_breakpoint: promptCacheBreakpoint
                          }
                        };
                      }
                      return {
                        type: "input_file",
                        file_url: item.data.url.toString(),
                        ...promptCacheBreakpoint != null && {
                          prompt_cache_breakpoint: promptCacheBreakpoint
                        }
                      };
                    }
                    warnings.push({
                      type: "other",
                      message: `unsupported tool content part type: ${item.type} with data type: ${item.data.type}`
                    });
                    return void 0;
                  }
                  default: {
                    warnings.push({
                      type: "other",
                      message: `unsupported tool content part type: ${item.type}`
                    });
                    return void 0;
                  }
                }
              }).filter(isNonNullable);
              break;
          }
          const caller = mapToolCaller(
            (_L = (_K = part.providerOptions) == null ? void 0 : _K[providerOptionsName]) == null ? void 0 : _L.caller
          );
          input.push({
            type: "function_call_output",
            call_id: part.toolCallId,
            output: contentValue,
            ...caller != null && { caller }
          });
        }
        break;
      }
      default: {
        const _exhaustiveCheck = role;
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`);
      }
    }
  }
  if (!store && input.some(
    (item) => "type" in item && item.type === "reasoning" && item.encrypted_content == null
  )) {
    warnings.push({
      type: "other",
      message: "Reasoning parts without encrypted content are not supported when store is false. Skipping reasoning parts."
    });
    input = input.filter(
      (item) => !("type" in item) || item.type !== "reasoning" || item.encrypted_content != null
    );
  }
  return { input, warnings };
}
var openaiResponsesReasoningProviderOptionsSchema = z25.object({
  itemId: z25.string().nullish(),
  reasoningEncryptedContent: z25.string().nullish()
});

// src/responses/map-openai-responses-finish-reason.ts
function mapOpenAIResponseFinishReason({
  finishReason,
  hasFunctionCall
}) {
  switch (finishReason) {
    case void 0:
    case null:
      return hasFunctionCall ? "tool-calls" : "stop";
    case "max_output_tokens":
      return "length";
    case "content_filter":
      return "content-filter";
    default:
      return hasFunctionCall ? "tool-calls" : "other";
  }
}

// src/responses/openai-responses-api.ts
import {
  lazySchema as lazySchema24,
  zodSchema as zodSchema24
} from "@ai-sdk/provider-utils";
import { z as z26 } from "zod/v4";
var jsonValueSchema2 = z26.lazy(
  () => z26.union([
    z26.string(),
    z26.number(),
    z26.boolean(),
    z26.null(),
    z26.array(jsonValueSchema2),
    z26.record(z26.string(), jsonValueSchema2.optional())
  ])
);
var openaiResponsesComputerSafetyCheckSchema = z26.object({
  id: z26.string(),
  code: z26.string().nullish(),
  message: z26.string().nullish()
});
var openaiResponsesComputerActionSchema = z26.discriminatedUnion("type", [
  z26.object({
    type: z26.literal("click"),
    button: z26.enum(["left", "right", "wheel", "back", "forward"]),
    x: z26.number(),
    y: z26.number(),
    keys: z26.array(z26.string()).nullish()
  }),
  z26.object({
    type: z26.literal("double_click"),
    x: z26.number(),
    y: z26.number(),
    keys: z26.array(z26.string()).nullish()
  }),
  z26.object({
    type: z26.literal("drag"),
    path: z26.array(z26.object({ x: z26.number(), y: z26.number() })),
    keys: z26.array(z26.string()).nullish()
  }),
  z26.object({
    type: z26.literal("keypress"),
    keys: z26.array(z26.string())
  }),
  z26.object({
    type: z26.literal("move"),
    x: z26.number(),
    y: z26.number(),
    keys: z26.array(z26.string()).nullish()
  }),
  z26.object({
    type: z26.literal("screenshot")
  }),
  z26.object({
    type: z26.literal("scroll"),
    x: z26.number(),
    y: z26.number(),
    scroll_x: z26.number(),
    scroll_y: z26.number(),
    keys: z26.array(z26.string()).nullish()
  }),
  z26.object({
    type: z26.literal("type"),
    text: z26.string()
  }),
  z26.object({
    type: z26.literal("wait")
  })
]);
var openaiResponsesComputerCallSchema = z26.object({
  type: z26.literal("computer_call"),
  id: z26.string(),
  call_id: z26.string().nullish(),
  status: z26.enum(["in_progress", "completed", "incomplete"]),
  action: openaiResponsesComputerActionSchema.nullish(),
  actions: z26.array(openaiResponsesComputerActionSchema).nullish(),
  pending_safety_checks: z26.array(openaiResponsesComputerSafetyCheckSchema).nullish()
});
var openaiResponsesToolCallerSchema = z26.discriminatedUnion("type", [
  z26.object({ type: z26.literal("direct") }),
  z26.object({
    type: z26.literal("program"),
    caller_id: z26.string()
  })
]);
var openaiResponsesProgramSchema = z26.object({
  type: z26.literal("program"),
  id: z26.string(),
  call_id: z26.string(),
  code: z26.string(),
  fingerprint: z26.string()
});
var openaiResponsesProgramOutputSchema = z26.object({
  type: z26.literal("program_output"),
  id: z26.string(),
  call_id: z26.string(),
  result: z26.string(),
  status: z26.enum(["completed", "incomplete"])
});
var openaiResponsesNestedErrorChunkSchema = z26.object({
  type: z26.literal("error"),
  sequence_number: z26.number(),
  error: z26.object({
    type: z26.string(),
    code: z26.string(),
    message: z26.string(),
    param: z26.string().nullish()
  })
});
var openaiResponsesErrorChunkSchema = z26.object({
  type: z26.literal("error"),
  sequence_number: z26.number(),
  code: z26.string().nullish(),
  message: z26.string(),
  param: z26.string().nullish()
});
var openaiResponsesChunkSchema = lazySchema24(
  () => zodSchema24(
    z26.union([
      z26.object({
        type: z26.literal("response.output_text.delta"),
        item_id: z26.string(),
        delta: z26.string(),
        logprobs: z26.array(
          z26.object({
            token: z26.string(),
            logprob: z26.number(),
            top_logprobs: z26.array(
              z26.object({
                token: z26.string(),
                logprob: z26.number()
              })
            )
          })
        ).nullish()
      }),
      z26.object({
        type: z26.enum(["response.completed", "response.incomplete"]),
        response: z26.object({
          incomplete_details: z26.object({ reason: z26.string() }).nullish(),
          usage: z26.object({
            input_tokens: z26.number(),
            input_tokens_details: z26.object({
              cached_tokens: z26.number().nullish(),
              cache_write_tokens: z26.number().nullish(),
              orchestration_input_tokens: z26.number().nullish(),
              orchestration_input_cached_tokens: z26.number().nullish()
            }).nullish(),
            output_tokens: z26.number(),
            output_tokens_details: z26.object({
              reasoning_tokens: z26.number().nullish(),
              orchestration_output_tokens: z26.number().nullish()
            }).nullish()
          }),
          reasoning: z26.object({
            context: z26.string().nullish()
          }).nullish(),
          service_tier: z26.string().nullish()
        })
      }),
      z26.object({
        type: z26.literal("response.failed"),
        sequence_number: z26.number(),
        response: z26.object({
          error: z26.object({
            code: z26.string().nullish(),
            message: z26.string()
          }).nullish(),
          incomplete_details: z26.object({ reason: z26.string() }).nullish(),
          usage: z26.object({
            input_tokens: z26.number(),
            input_tokens_details: z26.object({
              cached_tokens: z26.number().nullish(),
              cache_write_tokens: z26.number().nullish(),
              orchestration_input_tokens: z26.number().nullish(),
              orchestration_input_cached_tokens: z26.number().nullish()
            }).nullish(),
            output_tokens: z26.number(),
            output_tokens_details: z26.object({
              reasoning_tokens: z26.number().nullish(),
              orchestration_output_tokens: z26.number().nullish()
            }).nullish()
          }).nullish(),
          reasoning: z26.object({
            context: z26.string().nullish()
          }).nullish(),
          service_tier: z26.string().nullish()
        })
      }),
      z26.object({
        type: z26.literal("response.created"),
        response: z26.object({
          id: z26.string(),
          created_at: z26.number(),
          model: z26.string(),
          service_tier: z26.string().nullish()
        })
      }),
      z26.object({
        type: z26.literal("response.output_item.added"),
        output_index: z26.number(),
        item: z26.discriminatedUnion("type", [
          z26.object({
            type: z26.literal("message"),
            id: z26.string(),
            phase: z26.enum(["commentary", "final_answer"]).nullish()
          }),
          z26.object({
            type: z26.literal("reasoning"),
            id: z26.string(),
            encrypted_content: z26.string().nullish()
          }),
          z26.object({
            type: z26.literal("function_call"),
            id: z26.string(),
            call_id: z26.string(),
            name: z26.string(),
            arguments: z26.string(),
            namespace: z26.string().nullish(),
            caller: openaiResponsesToolCallerSchema.nullish()
          }),
          openaiResponsesProgramSchema,
          openaiResponsesProgramOutputSchema,
          z26.object({
            type: z26.literal("web_search_call"),
            id: z26.string(),
            status: z26.string()
          }),
          openaiResponsesComputerCallSchema,
          z26.object({
            type: z26.literal("file_search_call"),
            id: z26.string()
          }),
          z26.object({
            type: z26.literal("image_generation_call"),
            id: z26.string()
          }),
          z26.object({
            type: z26.literal("code_interpreter_call"),
            id: z26.string(),
            container_id: z26.string(),
            code: z26.string().nullable(),
            outputs: z26.array(
              z26.discriminatedUnion("type", [
                z26.object({ type: z26.literal("logs"), logs: z26.string() }),
                z26.object({ type: z26.literal("image"), url: z26.string() })
              ])
            ).nullable(),
            status: z26.string()
          }),
          z26.object({
            type: z26.literal("mcp_call"),
            id: z26.string(),
            status: z26.string(),
            approval_request_id: z26.string().nullish()
          }),
          z26.object({
            type: z26.literal("mcp_list_tools"),
            id: z26.string()
          }),
          z26.object({
            type: z26.literal("mcp_approval_request"),
            id: z26.string()
          }),
          z26.object({
            type: z26.literal("apply_patch_call"),
            id: z26.string(),
            call_id: z26.string(),
            status: z26.enum(["in_progress", "completed"]),
            operation: z26.discriminatedUnion("type", [
              z26.object({
                type: z26.literal("create_file"),
                path: z26.string(),
                diff: z26.string()
              }),
              z26.object({
                type: z26.literal("delete_file"),
                path: z26.string()
              }),
              z26.object({
                type: z26.literal("update_file"),
                path: z26.string(),
                diff: z26.string()
              })
            ])
          }),
          z26.object({
            type: z26.literal("custom_tool_call"),
            id: z26.string(),
            call_id: z26.string(),
            name: z26.string(),
            input: z26.string()
          }),
          z26.object({
            type: z26.literal("shell_call"),
            id: z26.string(),
            call_id: z26.string(),
            status: z26.enum(["in_progress", "completed", "incomplete"]),
            action: z26.object({
              commands: z26.array(z26.string())
            })
          }),
          z26.object({
            type: z26.literal("compaction"),
            id: z26.string(),
            encrypted_content: z26.string().nullish()
          }),
          z26.object({
            type: z26.literal("shell_call_output"),
            id: z26.string(),
            call_id: z26.string(),
            status: z26.enum(["in_progress", "completed", "incomplete"]),
            output: z26.array(
              z26.object({
                stdout: z26.string(),
                stderr: z26.string(),
                outcome: z26.discriminatedUnion("type", [
                  z26.object({ type: z26.literal("timeout") }),
                  z26.object({
                    type: z26.literal("exit"),
                    exit_code: z26.number()
                  })
                ])
              })
            )
          }),
          z26.object({
            type: z26.literal("tool_search_call"),
            id: z26.string(),
            execution: z26.enum(["server", "client"]),
            call_id: z26.string().nullable(),
            status: z26.enum(["in_progress", "completed", "incomplete"]),
            arguments: z26.unknown()
          }),
          z26.object({
            type: z26.literal("tool_search_output"),
            id: z26.string(),
            execution: z26.enum(["server", "client"]),
            call_id: z26.string().nullable(),
            status: z26.enum(["in_progress", "completed", "incomplete"]),
            tools: z26.array(z26.record(z26.string(), jsonValueSchema2.optional()))
          })
        ])
      }),
      z26.object({
        type: z26.literal("response.output_item.done"),
        output_index: z26.number(),
        item: z26.discriminatedUnion("type", [
          z26.object({
            type: z26.literal("message"),
            id: z26.string(),
            phase: z26.enum(["commentary", "final_answer"]).nullish()
          }),
          z26.object({
            type: z26.literal("reasoning"),
            id: z26.string(),
            encrypted_content: z26.string().nullish()
          }),
          z26.object({
            type: z26.literal("function_call"),
            id: z26.string(),
            call_id: z26.string(),
            name: z26.string(),
            arguments: z26.string(),
            status: z26.enum(["in_progress", "completed", "incomplete"]),
            namespace: z26.string().nullish(),
            caller: openaiResponsesToolCallerSchema.nullish()
          }),
          openaiResponsesProgramSchema,
          openaiResponsesProgramOutputSchema,
          z26.object({
            type: z26.literal("custom_tool_call"),
            id: z26.string(),
            call_id: z26.string(),
            name: z26.string(),
            input: z26.string(),
            status: z26.literal("completed")
          }),
          z26.object({
            type: z26.literal("code_interpreter_call"),
            id: z26.string(),
            code: z26.string().nullable(),
            container_id: z26.string(),
            outputs: z26.array(
              z26.discriminatedUnion("type", [
                z26.object({ type: z26.literal("logs"), logs: z26.string() }),
                z26.object({ type: z26.literal("image"), url: z26.string() })
              ])
            ).nullable()
          }),
          z26.object({
            type: z26.literal("image_generation_call"),
            id: z26.string(),
            result: z26.string()
          }),
          z26.object({
            type: z26.literal("web_search_call"),
            id: z26.string(),
            status: z26.string(),
            action: z26.discriminatedUnion("type", [
              z26.object({
                type: z26.literal("search"),
                query: z26.string().nullish(),
                queries: z26.array(z26.string()).nullish(),
                sources: z26.array(
                  z26.discriminatedUnion("type", [
                    z26.object({ type: z26.literal("url"), url: z26.string() }),
                    z26.object({ type: z26.literal("api"), name: z26.string() })
                  ])
                ).nullish()
              }),
              z26.object({
                type: z26.literal("open_page"),
                url: z26.string().nullish()
              }),
              z26.object({
                type: z26.literal("find_in_page"),
                url: z26.string().nullish(),
                pattern: z26.string().nullish()
              })
            ]).nullish()
          }),
          z26.object({
            type: z26.literal("file_search_call"),
            id: z26.string(),
            queries: z26.array(z26.string()),
            results: z26.array(
              z26.object({
                attributes: z26.record(
                  z26.string(),
                  z26.union([z26.string(), z26.number(), z26.boolean()])
                ),
                file_id: z26.string(),
                filename: z26.string(),
                score: z26.number(),
                text: z26.string()
              })
            ).nullish()
          }),
          z26.object({
            type: z26.literal("local_shell_call"),
            id: z26.string(),
            call_id: z26.string(),
            action: z26.object({
              type: z26.literal("exec"),
              command: z26.array(z26.string()),
              timeout_ms: z26.number().optional(),
              user: z26.string().optional(),
              working_directory: z26.string().optional(),
              env: z26.record(z26.string(), z26.string()).optional()
            })
          }),
          openaiResponsesComputerCallSchema,
          z26.object({
            type: z26.literal("mcp_call"),
            id: z26.string(),
            status: z26.string(),
            arguments: z26.string(),
            name: z26.string(),
            server_label: z26.string(),
            output: z26.string().nullish(),
            error: z26.union([
              z26.string(),
              z26.object({
                type: z26.string().optional(),
                code: z26.union([z26.number(), z26.string()]).optional(),
                message: z26.string().optional()
              }).loose()
            ]).nullish(),
            approval_request_id: z26.string().nullish()
          }),
          z26.object({
            type: z26.literal("mcp_list_tools"),
            id: z26.string(),
            server_label: z26.string(),
            tools: z26.array(
              z26.object({
                name: z26.string(),
                description: z26.string().optional(),
                input_schema: z26.any(),
                annotations: z26.record(z26.string(), z26.unknown()).optional()
              })
            ),
            error: z26.union([
              z26.string(),
              z26.object({
                type: z26.string().optional(),
                code: z26.union([z26.number(), z26.string()]).optional(),
                message: z26.string().optional()
              }).loose()
            ]).optional()
          }),
          z26.object({
            type: z26.literal("mcp_approval_request"),
            id: z26.string(),
            server_label: z26.string(),
            name: z26.string(),
            arguments: z26.string(),
            approval_request_id: z26.string().optional()
          }),
          z26.object({
            type: z26.literal("apply_patch_call"),
            id: z26.string(),
            call_id: z26.string(),
            status: z26.enum(["in_progress", "completed"]),
            operation: z26.discriminatedUnion("type", [
              z26.object({
                type: z26.literal("create_file"),
                path: z26.string(),
                diff: z26.string()
              }),
              z26.object({
                type: z26.literal("delete_file"),
                path: z26.string()
              }),
              z26.object({
                type: z26.literal("update_file"),
                path: z26.string(),
                diff: z26.string()
              })
            ])
          }),
          z26.object({
            type: z26.literal("shell_call"),
            id: z26.string(),
            call_id: z26.string(),
            status: z26.enum(["in_progress", "completed", "incomplete"]),
            action: z26.object({
              commands: z26.array(z26.string())
            })
          }),
          z26.object({
            type: z26.literal("compaction"),
            id: z26.string(),
            encrypted_content: z26.string()
          }),
          z26.object({
            type: z26.literal("shell_call_output"),
            id: z26.string(),
            call_id: z26.string(),
            status: z26.enum(["in_progress", "completed", "incomplete"]),
            output: z26.array(
              z26.object({
                stdout: z26.string(),
                stderr: z26.string(),
                outcome: z26.discriminatedUnion("type", [
                  z26.object({ type: z26.literal("timeout") }),
                  z26.object({
                    type: z26.literal("exit"),
                    exit_code: z26.number()
                  })
                ])
              })
            )
          }),
          z26.object({
            type: z26.literal("tool_search_call"),
            id: z26.string(),
            execution: z26.enum(["server", "client"]),
            call_id: z26.string().nullable(),
            status: z26.enum(["in_progress", "completed", "incomplete"]),
            arguments: z26.unknown()
          }),
          z26.object({
            type: z26.literal("tool_search_output"),
            id: z26.string(),
            execution: z26.enum(["server", "client"]),
            call_id: z26.string().nullable(),
            status: z26.enum(["in_progress", "completed", "incomplete"]),
            tools: z26.array(z26.record(z26.string(), jsonValueSchema2.optional()))
          })
        ])
      }),
      z26.object({
        type: z26.literal("response.function_call_arguments.delta"),
        item_id: z26.string(),
        output_index: z26.number(),
        delta: z26.string()
      }),
      z26.object({
        type: z26.literal("response.custom_tool_call_input.delta"),
        item_id: z26.string(),
        output_index: z26.number(),
        delta: z26.string()
      }),
      z26.object({
        type: z26.literal("response.image_generation_call.partial_image"),
        item_id: z26.string(),
        output_index: z26.number(),
        partial_image_b64: z26.string()
      }),
      z26.object({
        type: z26.literal("response.code_interpreter_call_code.delta"),
        item_id: z26.string(),
        output_index: z26.number(),
        delta: z26.string()
      }),
      z26.object({
        type: z26.literal("response.code_interpreter_call_code.done"),
        item_id: z26.string(),
        output_index: z26.number(),
        code: z26.string()
      }),
      z26.object({
        type: z26.literal("response.output_text.annotation.added"),
        annotation: z26.discriminatedUnion("type", [
          z26.object({
            type: z26.literal("url_citation"),
            start_index: z26.number(),
            end_index: z26.number(),
            url: z26.string(),
            title: z26.string()
          }),
          z26.object({
            type: z26.literal("file_citation"),
            file_id: z26.string(),
            filename: z26.string(),
            index: z26.number()
          }),
          z26.object({
            type: z26.literal("container_file_citation"),
            container_id: z26.string(),
            file_id: z26.string(),
            filename: z26.string(),
            start_index: z26.number(),
            end_index: z26.number()
          }),
          z26.object({
            type: z26.literal("file_path"),
            file_id: z26.string(),
            index: z26.number()
          })
        ])
      }),
      z26.object({
        type: z26.literal("response.reasoning_summary_part.added"),
        item_id: z26.string(),
        summary_index: z26.number()
      }),
      z26.object({
        type: z26.literal("response.reasoning_summary_text.delta"),
        item_id: z26.string(),
        summary_index: z26.number(),
        delta: z26.string()
      }),
      z26.object({
        type: z26.literal("response.reasoning_summary_part.done"),
        item_id: z26.string(),
        summary_index: z26.number()
      }),
      z26.object({
        type: z26.literal("response.apply_patch_call_operation_diff.delta"),
        item_id: z26.string(),
        output_index: z26.number(),
        delta: z26.string(),
        obfuscation: z26.string().nullish()
      }),
      z26.object({
        type: z26.literal("response.apply_patch_call_operation_diff.done"),
        item_id: z26.string(),
        output_index: z26.number(),
        diff: z26.string()
      }),
      openaiResponsesNestedErrorChunkSchema,
      openaiResponsesErrorChunkSchema,
      z26.object({ type: z26.string() }).loose().transform((value) => ({
        type: "unknown_chunk",
        message: value.type
      }))
      // fallback for unknown chunks
    ])
  )
);
var openaiResponsesResponseSchema = lazySchema24(
  () => zodSchema24(
    z26.object({
      id: z26.string().optional(),
      created_at: z26.number().optional(),
      error: z26.object({
        message: z26.string(),
        type: z26.string(),
        param: z26.string().nullish(),
        code: z26.string()
      }).nullish(),
      model: z26.string().optional(),
      output: z26.array(
        z26.discriminatedUnion("type", [
          z26.object({
            type: z26.literal("message"),
            role: z26.literal("assistant"),
            id: z26.string(),
            phase: z26.enum(["commentary", "final_answer"]).nullish(),
            content: z26.array(
              z26.object({
                type: z26.literal("output_text"),
                text: z26.string(),
                logprobs: z26.array(
                  z26.object({
                    token: z26.string(),
                    logprob: z26.number(),
                    top_logprobs: z26.array(
                      z26.object({
                        token: z26.string(),
                        logprob: z26.number()
                      })
                    )
                  })
                ).nullish(),
                annotations: z26.array(
                  z26.discriminatedUnion("type", [
                    z26.object({
                      type: z26.literal("url_citation"),
                      start_index: z26.number(),
                      end_index: z26.number(),
                      url: z26.string(),
                      title: z26.string()
                    }),
                    z26.object({
                      type: z26.literal("file_citation"),
                      file_id: z26.string(),
                      filename: z26.string(),
                      index: z26.number()
                    }),
                    z26.object({
                      type: z26.literal("container_file_citation"),
                      container_id: z26.string(),
                      file_id: z26.string(),
                      filename: z26.string(),
                      start_index: z26.number(),
                      end_index: z26.number()
                    }),
                    z26.object({
                      type: z26.literal("file_path"),
                      file_id: z26.string(),
                      index: z26.number()
                    })
                  ])
                )
              })
            )
          }),
          z26.object({
            type: z26.literal("web_search_call"),
            id: z26.string(),
            status: z26.string(),
            action: z26.discriminatedUnion("type", [
              z26.object({
                type: z26.literal("search"),
                query: z26.string().nullish(),
                queries: z26.array(z26.string()).nullish(),
                sources: z26.array(
                  z26.discriminatedUnion("type", [
                    z26.object({ type: z26.literal("url"), url: z26.string() }),
                    z26.object({
                      type: z26.literal("api"),
                      name: z26.string()
                    })
                  ])
                ).nullish()
              }),
              z26.object({
                type: z26.literal("open_page"),
                url: z26.string().nullish()
              }),
              z26.object({
                type: z26.literal("find_in_page"),
                url: z26.string().nullish(),
                pattern: z26.string().nullish()
              })
            ]).nullish()
          }),
          z26.object({
            type: z26.literal("file_search_call"),
            id: z26.string(),
            queries: z26.array(z26.string()),
            results: z26.array(
              z26.object({
                attributes: z26.record(
                  z26.string(),
                  z26.union([z26.string(), z26.number(), z26.boolean()])
                ),
                file_id: z26.string(),
                filename: z26.string(),
                score: z26.number(),
                text: z26.string()
              })
            ).nullish()
          }),
          z26.object({
            type: z26.literal("code_interpreter_call"),
            id: z26.string(),
            code: z26.string().nullable(),
            container_id: z26.string(),
            outputs: z26.array(
              z26.discriminatedUnion("type", [
                z26.object({ type: z26.literal("logs"), logs: z26.string() }),
                z26.object({ type: z26.literal("image"), url: z26.string() })
              ])
            ).nullable()
          }),
          z26.object({
            type: z26.literal("image_generation_call"),
            id: z26.string(),
            result: z26.string()
          }),
          z26.object({
            type: z26.literal("local_shell_call"),
            id: z26.string(),
            call_id: z26.string(),
            action: z26.object({
              type: z26.literal("exec"),
              command: z26.array(z26.string()),
              timeout_ms: z26.number().optional(),
              user: z26.string().optional(),
              working_directory: z26.string().optional(),
              env: z26.record(z26.string(), z26.string()).optional()
            })
          }),
          z26.object({
            type: z26.literal("function_call"),
            call_id: z26.string(),
            name: z26.string(),
            arguments: z26.string(),
            id: z26.string(),
            namespace: z26.string().nullish(),
            caller: openaiResponsesToolCallerSchema.nullish()
          }),
          openaiResponsesProgramSchema,
          openaiResponsesProgramOutputSchema,
          z26.object({
            type: z26.literal("custom_tool_call"),
            call_id: z26.string(),
            name: z26.string(),
            input: z26.string(),
            id: z26.string()
          }),
          openaiResponsesComputerCallSchema,
          z26.object({
            type: z26.literal("reasoning"),
            id: z26.string(),
            encrypted_content: z26.string().nullish(),
            summary: z26.array(
              z26.object({
                type: z26.literal("summary_text"),
                text: z26.string()
              })
            )
          }),
          z26.object({
            type: z26.literal("mcp_call"),
            id: z26.string(),
            status: z26.string(),
            arguments: z26.string(),
            name: z26.string(),
            server_label: z26.string(),
            output: z26.string().nullish(),
            error: z26.union([
              z26.string(),
              z26.object({
                type: z26.string().optional(),
                code: z26.union([z26.number(), z26.string()]).optional(),
                message: z26.string().optional()
              }).loose()
            ]).nullish(),
            approval_request_id: z26.string().nullish()
          }),
          z26.object({
            type: z26.literal("mcp_list_tools"),
            id: z26.string(),
            server_label: z26.string(),
            tools: z26.array(
              z26.object({
                name: z26.string(),
                description: z26.string().optional(),
                input_schema: z26.any(),
                annotations: z26.record(z26.string(), z26.unknown()).optional()
              })
            ),
            error: z26.union([
              z26.string(),
              z26.object({
                type: z26.string().optional(),
                code: z26.union([z26.number(), z26.string()]).optional(),
                message: z26.string().optional()
              }).loose()
            ]).optional()
          }),
          z26.object({
            type: z26.literal("mcp_approval_request"),
            id: z26.string(),
            server_label: z26.string(),
            name: z26.string(),
            arguments: z26.string(),
            approval_request_id: z26.string().optional()
          }),
          z26.object({
            type: z26.literal("apply_patch_call"),
            id: z26.string(),
            call_id: z26.string(),
            status: z26.enum(["in_progress", "completed"]),
            operation: z26.discriminatedUnion("type", [
              z26.object({
                type: z26.literal("create_file"),
                path: z26.string(),
                diff: z26.string()
              }),
              z26.object({
                type: z26.literal("delete_file"),
                path: z26.string()
              }),
              z26.object({
                type: z26.literal("update_file"),
                path: z26.string(),
                diff: z26.string()
              })
            ])
          }),
          z26.object({
            type: z26.literal("shell_call"),
            id: z26.string(),
            call_id: z26.string(),
            status: z26.enum(["in_progress", "completed", "incomplete"]),
            action: z26.object({
              commands: z26.array(z26.string())
            })
          }),
          z26.object({
            type: z26.literal("compaction"),
            id: z26.string(),
            encrypted_content: z26.string()
          }),
          z26.object({
            type: z26.literal("shell_call_output"),
            id: z26.string(),
            call_id: z26.string(),
            status: z26.enum(["in_progress", "completed", "incomplete"]),
            output: z26.array(
              z26.object({
                stdout: z26.string(),
                stderr: z26.string(),
                outcome: z26.discriminatedUnion("type", [
                  z26.object({ type: z26.literal("timeout") }),
                  z26.object({
                    type: z26.literal("exit"),
                    exit_code: z26.number()
                  })
                ])
              })
            )
          }),
          z26.object({
            type: z26.literal("tool_search_call"),
            id: z26.string(),
            execution: z26.enum(["server", "client"]),
            call_id: z26.string().nullable(),
            status: z26.enum(["in_progress", "completed", "incomplete"]),
            arguments: z26.unknown()
          }),
          z26.object({
            type: z26.literal("tool_search_output"),
            id: z26.string(),
            execution: z26.enum(["server", "client"]),
            call_id: z26.string().nullable(),
            status: z26.enum(["in_progress", "completed", "incomplete"]),
            tools: z26.array(z26.record(z26.string(), jsonValueSchema2.optional()))
          })
        ])
      ).optional(),
      service_tier: z26.string().nullish(),
      reasoning: z26.object({
        context: z26.string().nullish()
      }).nullish(),
      incomplete_details: z26.object({ reason: z26.string() }).nullish(),
      usage: z26.object({
        input_tokens: z26.number(),
        input_tokens_details: z26.object({
          cached_tokens: z26.number().nullish(),
          cache_write_tokens: z26.number().nullish(),
          orchestration_input_tokens: z26.number().nullish(),
          orchestration_input_cached_tokens: z26.number().nullish()
        }).nullish(),
        output_tokens: z26.number(),
        output_tokens_details: z26.object({
          reasoning_tokens: z26.number().nullish(),
          orchestration_output_tokens: z26.number().nullish()
        }).nullish()
      }).optional()
    })
  )
);

// src/responses/openai-responses-language-model-options.ts
import {
  lazySchema as lazySchema25,
  zodSchema as zodSchema25
} from "@ai-sdk/provider-utils";
import { z as z27 } from "zod/v4";
var TOP_LOGPROBS_MAX = 20;
var openaiResponsesReasoningModelIds = [
  "o1",
  "o1-2024-12-17",
  "o3",
  "o3-2025-04-16",
  "o3-mini",
  "o3-mini-2025-01-31",
  "o4-mini",
  "o4-mini-2025-04-16",
  "gpt-5",
  "gpt-5-2025-08-07",
  "gpt-5-codex",
  "gpt-5-mini",
  "gpt-5-mini-2025-08-07",
  "gpt-5-nano",
  "gpt-5-nano-2025-08-07",
  "gpt-5-pro",
  "gpt-5-pro-2025-10-06",
  "gpt-5.1",
  "gpt-5.1-chat-latest",
  "gpt-5.1-codex-mini",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.2",
  "gpt-5.2-chat-latest",
  "gpt-5.2-pro",
  "gpt-5.2-codex",
  "gpt-5.3-chat-latest",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.4-2026-03-05",
  "gpt-5.4-mini",
  "gpt-5.4-mini-2026-03-17",
  "gpt-5.4-nano",
  "gpt-5.4-nano-2026-03-17",
  "gpt-5.4-pro",
  "gpt-5.4-pro-2026-03-05",
  "gpt-5.5",
  "gpt-5.5-2026-04-23",
  "gpt-5.6",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra"
];
var openaiResponsesModelIds = [
  "gpt-4.1",
  "gpt-4.1-2025-04-14",
  "gpt-4.1-mini",
  "gpt-4.1-mini-2025-04-14",
  "gpt-4.1-nano",
  "gpt-4.1-nano-2025-04-14",
  "gpt-4o",
  "gpt-4o-2024-05-13",
  "gpt-4o-2024-08-06",
  "gpt-4o-2024-11-20",
  "gpt-4o-audio-preview",
  "gpt-4o-audio-preview-2024-12-17",
  "gpt-4o-search-preview",
  "gpt-4o-search-preview-2025-03-11",
  "gpt-4o-mini-search-preview",
  "gpt-4o-mini-search-preview-2025-03-11",
  "gpt-4o-mini",
  "gpt-4o-mini-2024-07-18",
  "gpt-3.5-turbo-0125",
  "gpt-3.5-turbo",
  "gpt-3.5-turbo-1106",
  "gpt-5-chat-latest",
  ...openaiResponsesReasoningModelIds
];
var openaiLanguageModelResponsesOptionsSchema = lazySchema25(
  () => zodSchema25(
    z27.object({
      /**
       * The ID of the OpenAI Conversation to continue.
       * You must create a conversation first via the OpenAI API.
       * Cannot be used in conjunction with `previousResponseId`.
       * Defaults to `undefined`.
       * @see https://platform.openai.com/docs/api-reference/conversations/create
       */
      conversation: z27.string().nullish(),
      /**
       * The set of extra fields to include in the response (advanced, usually not needed).
       * Example values: 'reasoning.encrypted_content', 'file_search_call.results', 'web_search_call.results', 'message.output_text.logprobs'.
       */
      include: z27.array(
        z27.enum([
          "reasoning.encrypted_content",
          // handled internally by default, only needed for unknown reasoning models
          "file_search_call.results",
          "web_search_call.results",
          "message.output_text.logprobs"
        ])
      ).nullish(),
      /**
       * Instructions for the model.
       * They can be used to change the system or developer message when continuing a conversation using the `previousResponseId` option.
       * Defaults to `undefined`.
       */
      instructions: z27.string().nullish(),
      /**
       * Return the log probabilities of the tokens. Including logprobs will increase
       * the response size and can slow down response times. However, it can
       * be useful to better understand how the model is behaving.
       *
       * Setting to true will return the log probabilities of the tokens that
       * were generated.
       *
       * Setting to a number will return the log probabilities of the top n
       * tokens that were generated.
       *
       * @see https://platform.openai.com/docs/api-reference/responses/create
       * @see https://cookbook.openai.com/examples/using_logprobs
       */
      logprobs: z27.union([z27.boolean(), z27.number().min(1).max(TOP_LOGPROBS_MAX)]).optional(),
      /**
       * The maximum number of total calls to built-in tools that can be processed in a response.
       * This maximum number applies across all built-in tool calls, not per individual tool.
       * Any further attempts to call a tool by the model will be ignored.
       */
      maxToolCalls: z27.number().nullish(),
      /**
       * Additional metadata to store with the generation.
       */
      metadata: z27.any().nullish(),
      /**
       * Whether to use parallel tool calls. Defaults to `true`.
       */
      parallelToolCalls: z27.boolean().nullish(),
      /**
       * The ID of the previous response. You can use it to continue a conversation.
       * Defaults to `undefined`.
       */
      previousResponseId: z27.string().nullish(),
      /**
       * Sets a cache key to tie this prompt to cached prefixes for better caching performance.
       */
      promptCacheKey: z27.string().nullish(),
      /**
       * Prompt cache behavior for GPT-5.6 and later models.
       * `mode` controls whether OpenAI also places an implicit breakpoint.
       * `ttl` sets the minimum cache lifetime and currently only supports 30 minutes.
       */
      promptCacheOptions: z27.object({
        mode: z27.enum(["implicit", "explicit"]).optional(),
        ttl: z27.literal("30m").optional()
      }).optional(),
      /**
       * The retention policy for the prompt cache.
       * - 'in_memory': Default. Standard prompt caching behavior.
       * - '24h': Extended prompt caching that keeps cached prefixes active for up to 24 hours.
       *          Available for models before GPT-5.6 that support extended caching.
       *
       * @deprecated For GPT-5.6 and later models, use `promptCacheOptions.ttl`.
       *
       * @default 'in_memory'
       */
      promptCacheRetention: z27.enum(["in_memory", "24h"]).nullish(),
      /**
       * Reasoning effort for reasoning models. Defaults to `medium`. If you use
       * `providerOptions` to set the `reasoningEffort` option, this model setting will be ignored.
       * GPT-5.6 supports 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'.
       * Supported values vary by model.
       */
      reasoningEffort: z27.string().nullish(),
      /**
       * Controls how much model work GPT-5.6 performs before returning a final answer.
       * `standard` is the default. `pro` increases quality, latency, and token usage.
       */
      reasoningMode: z27.enum(["standard", "pro"]).optional(),
      /**
       * Controls which available reasoning items GPT-5.6 can use.
       * `auto` uses the model default, `current_turn` excludes reasoning from earlier
       * turns, and `all_turns` makes compatible earlier reasoning available.
       */
      reasoningContext: z27.enum(["auto", "current_turn", "all_turns"]).optional(),
      /**
       * Controls reasoning summary output from the model.
       * Set to "auto" to automatically receive the richest level available,
       * or "detailed" for comprehensive summaries.
       */
      reasoningSummary: z27.string().nullish(),
      /**
       * The identifier for safety monitoring and tracking.
       */
      safetyIdentifier: z27.string().nullish(),
      /**
       * Service tier for the request.
       * Set to 'flex' for 50% cheaper processing at the cost of increased latency (available for o3, o4-mini, and gpt-5 models).
       * Set to 'priority' for faster processing with Enterprise access (available for gpt-4, gpt-5, gpt-5-mini, o3, o4-mini; gpt-5-nano is not supported).
       *
       * Defaults to 'auto'.
       */
      serviceTier: z27.enum(["auto", "flex", "priority", "default"]).nullish(),
      /**
       * Whether to store the generation. Defaults to `true`.
       */
      store: z27.boolean().nullish(),
      /**
       * Whether to pass through non-image file types as generic input files.
       *
       * By default, inline file inputs are restricted to images and PDFs.
       * Enable this when the target OpenAI Responses model supports additional
       * file media types, such as text/csv.
       */
      passThroughUnsupportedFiles: z27.boolean().optional(),
      /**
       * Whether to use strict JSON schema validation.
       * Defaults to `true`.
       */
      strictJsonSchema: z27.boolean().nullish(),
      /**
       * Controls the verbosity of the model's responses. Lower values ('low') will result
       * in more concise responses, while higher values ('high') will result in more verbose responses.
       * Valid values: 'low', 'medium', 'high'.
       */
      textVerbosity: z27.enum(["low", "medium", "high"]).nullish(),
      /**
       * Controls output truncation. 'auto' (default) performs truncation automatically;
       * 'disabled' turns truncation off.
       */
      truncation: z27.enum(["auto", "disabled"]).nullish(),
      /**
       * A unique identifier representing your end-user, which can help OpenAI to
       * monitor and detect abuse.
       * Defaults to `undefined`.
       * @see https://platform.openai.com/docs/guides/safety-best-practices/end-user-ids
       */
      user: z27.string().nullish(),
      /**
       * Override the system message mode for this model.
       * - 'system': Use the 'system' role for system messages (default for most models)
       * - 'developer': Use the 'developer' role for system messages (used by reasoning models)
       * - 'remove': Remove system messages entirely
       *
       * If not specified, the mode is automatically determined based on the model.
       */
      systemMessageMode: z27.enum(["system", "developer", "remove"]).optional(),
      /**
       * Force treating this model as a reasoning model.
       *
       * This is useful for "stealth" reasoning models (e.g. via a custom baseURL)
       * where the model ID is not recognized by the SDK's allowlist.
       *
       * When enabled, the SDK applies reasoning-model parameter compatibility rules
       * and defaults `systemMessageMode` to `developer` unless overridden.
       */
      forceReasoning: z27.boolean().optional(),
      /**
       * Enable server-side context management (compaction).
       */
      contextManagement: z27.array(
        z27.object({
          type: z27.literal("compaction"),
          compactThreshold: z27.number()
        })
      ).nullish(),
      /**
       * Restrict the callable tools to a subset while keeping the full tools
       * list intact, so prompt caching is preserved across requests with
       * different allowlists.
       *
       * When set, this overrides the request-level `toolChoice` and emits
       * `tool_choice: { type: "allowed_tools", mode, tools }` on the wire.
       *
       * @see https://developers.openai.com/api/reference/resources/responses/methods/create#(resource)%20responses%20%3E%20(model)%20tool_choice_allowed%20%3E%20(schema)
       */
      allowedTools: z27.object({
        toolNames: z27.array(z27.string()).min(1),
        mode: z27.enum(["auto", "required"]).optional()
      }).optional()
    })
  )
);

// src/responses/openai-responses-prepare-tools.ts
import {
  UnsupportedFunctionalityError as UnsupportedFunctionalityError5
} from "@ai-sdk/provider";
import {
  resolveProviderReference as resolveProviderReference3,
  validateTypes as validateTypes2
} from "@ai-sdk/provider-utils";
async function prepareResponsesTools({
  tools,
  toolChoice,
  allowedTools,
  toolNameMapping,
  customProviderToolNames
}) {
  var _a, _b, _c;
  tools = (tools == null ? void 0 : tools.length) ? tools : void 0;
  const toolWarnings = [];
  if (tools == null) {
    return { tools: void 0, toolChoice: void 0, toolWarnings };
  }
  const openaiTools2 = [];
  const namespaceTools = /* @__PURE__ */ new Map();
  const resolvedCustomProviderToolNames = customProviderToolNames != null ? customProviderToolNames : /* @__PURE__ */ new Set();
  for (const tool of tools) {
    switch (tool.type) {
      case "function": {
        const openaiOptions = (_a = tool.providerOptions) == null ? void 0 : _a.openai;
        const openaiFunctionTool = prepareFunctionTool({
          tool,
          options: openaiOptions
        });
        const namespace = openaiOptions == null ? void 0 : openaiOptions.namespace;
        if (namespace == null) {
          openaiTools2.push(openaiFunctionTool);
        } else {
          let namespaceTool = namespaceTools.get(namespace.name);
          if (namespaceTool == null) {
            namespaceTool = {
              type: "namespace",
              name: namespace.name,
              description: namespace.description,
              tools: []
            };
            namespaceTools.set(namespace.name, namespaceTool);
            openaiTools2.push(namespaceTool);
          } else if (namespaceTool.description !== namespace.description) {
            throw new UnsupportedFunctionalityError5({
              functionality: `conflicting descriptions for OpenAI tool namespace "${namespace.name}"`
            });
          }
          namespaceTool.tools.push(openaiFunctionTool);
        }
        break;
      }
      case "provider": {
        switch (tool.id) {
          case "openai.file_search": {
            const args = await validateTypes2({
              value: tool.args,
              schema: fileSearchArgsSchema
            });
            openaiTools2.push({
              type: "file_search",
              vector_store_ids: args.vectorStoreIds,
              max_num_results: args.maxNumResults,
              ranking_options: args.ranking ? {
                ranker: args.ranking.ranker,
                score_threshold: args.ranking.scoreThreshold
              } : void 0,
              filters: args.filters
            });
            break;
          }
          case "openai.local_shell": {
            openaiTools2.push({
              type: "local_shell"
            });
            break;
          }
          case "openai.shell": {
            const args = await validateTypes2({
              value: tool.args,
              schema: shellArgsSchema
            });
            openaiTools2.push({
              type: "shell",
              ...args.environment && {
                environment: mapShellEnvironment(args.environment)
              }
            });
            break;
          }
          case "openai.apply_patch": {
            openaiTools2.push({
              type: "apply_patch"
            });
            break;
          }
          case "openai.computer": {
            openaiTools2.push({
              type: "computer"
            });
            break;
          }
          case "openai.web_search_preview": {
            const args = await validateTypes2({
              value: tool.args,
              schema: webSearchPreviewArgsSchema
            });
            openaiTools2.push({
              type: "web_search_preview",
              search_context_size: args.searchContextSize,
              user_location: args.userLocation
            });
            break;
          }
          case "openai.web_search": {
            const args = await validateTypes2({
              value: tool.args,
              schema: webSearchArgsSchema
            });
            openaiTools2.push({
              type: "web_search",
              filters: args.filters != null ? { allowed_domains: args.filters.allowedDomains } : void 0,
              external_web_access: args.externalWebAccess,
              search_context_size: args.searchContextSize,
              user_location: args.userLocation
            });
            break;
          }
          case "openai.code_interpreter": {
            const args = await validateTypes2({
              value: tool.args,
              schema: codeInterpreterArgsSchema
            });
            openaiTools2.push({
              type: "code_interpreter",
              container: args.container == null ? { type: "auto", file_ids: void 0 } : typeof args.container === "string" ? args.container : { type: "auto", file_ids: args.container.fileIds }
            });
            break;
          }
          case "openai.image_generation": {
            const args = await validateTypes2({
              value: tool.args,
              schema: imageGenerationArgsSchema
            });
            openaiTools2.push({
              type: "image_generation",
              background: args.background,
              input_fidelity: args.inputFidelity,
              input_image_mask: args.inputImageMask ? {
                file_id: args.inputImageMask.fileId,
                image_url: args.inputImageMask.imageUrl
              } : void 0,
              model: args.model,
              moderation: args.moderation,
              partial_images: args.partialImages,
              quality: args.quality,
              output_compression: args.outputCompression,
              output_format: args.outputFormat,
              size: args.size
            });
            break;
          }
          case "openai.mcp": {
            const args = await validateTypes2({
              value: tool.args,
              schema: mcpArgsSchema
            });
            const mapApprovalFilter = (filter) => ({
              tool_names: filter.toolNames
            });
            const requireApproval = args.requireApproval;
            const requireApprovalParam = requireApproval == null ? void 0 : typeof requireApproval === "string" ? requireApproval : requireApproval.never != null ? { never: mapApprovalFilter(requireApproval.never) } : void 0;
            openaiTools2.push({
              type: "mcp",
              server_label: args.serverLabel,
              allowed_tools: Array.isArray(args.allowedTools) ? args.allowedTools : args.allowedTools ? {
                read_only: args.allowedTools.readOnly,
                tool_names: args.allowedTools.toolNames
              } : void 0,
              authorization: args.authorization,
              connector_id: args.connectorId,
              headers: args.headers,
              require_approval: requireApprovalParam != null ? requireApprovalParam : "never",
              server_description: args.serverDescription,
              server_url: args.serverUrl
            });
            break;
          }
          case "openai.custom": {
            const args = await validateTypes2({
              value: tool.args,
              schema: customArgsSchema
            });
            openaiTools2.push({
              type: "custom",
              name: tool.name,
              description: args.description,
              format: args.format
            });
            resolvedCustomProviderToolNames.add(tool.name);
            break;
          }
          case "openai.programmatic_tool_calling": {
            openaiTools2.push({
              type: "programmatic_tool_calling"
            });
            break;
          }
          case "openai.tool_search": {
            const args = await validateTypes2({
              value: tool.args,
              schema: toolSearchArgsSchema
            });
            openaiTools2.push({
              type: "tool_search",
              ...args.execution != null ? { execution: args.execution } : {},
              ...args.description != null ? { description: args.description } : {},
              ...args.parameters != null ? { parameters: args.parameters } : {}
            });
            break;
          }
        }
        break;
      }
      default:
        toolWarnings.push({
          type: "unsupported",
          feature: `function tool ${tool}`
        });
        break;
    }
  }
  if (allowedTools != null) {
    return {
      tools: openaiTools2,
      toolChoice: {
        type: "allowed_tools",
        mode: (_b = allowedTools.mode) != null ? _b : "auto",
        tools: allowedTools.toolNames.map((name) => {
          var _a2;
          return {
            type: "function",
            name: (_a2 = toolNameMapping == null ? void 0 : toolNameMapping.toProviderToolName(name)) != null ? _a2 : name
          };
        })
      },
      toolWarnings
    };
  }
  if (toolChoice == null) {
    return { tools: openaiTools2, toolChoice: void 0, toolWarnings };
  }
  const type = toolChoice.type;
  switch (type) {
    case "auto":
    case "none":
    case "required":
      return { tools: openaiTools2, toolChoice: type, toolWarnings };
    case "tool": {
      const resolvedToolName = (_c = toolNameMapping == null ? void 0 : toolNameMapping.toProviderToolName(toolChoice.toolName)) != null ? _c : toolChoice.toolName;
      return {
        tools: openaiTools2,
        toolChoice: resolvedToolName === "code_interpreter" || resolvedToolName === "file_search" || resolvedToolName === "image_generation" || resolvedToolName === "web_search_preview" || resolvedToolName === "web_search" || resolvedToolName === "mcp" || resolvedToolName === "apply_patch" || resolvedToolName === "computer" || resolvedToolName === "programmatic_tool_calling" ? { type: resolvedToolName } : resolvedCustomProviderToolNames.has(resolvedToolName) ? { type: "custom", name: resolvedToolName } : { type: "function", name: resolvedToolName },
        toolWarnings
      };
    }
    default: {
      const _exhaustiveCheck = type;
      throw new UnsupportedFunctionalityError5({
        functionality: `tool choice type: ${_exhaustiveCheck}`
      });
    }
  }
}
function prepareFunctionTool({
  tool,
  options
}) {
  const deferLoading = options == null ? void 0 : options.deferLoading;
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    ...tool.strict != null ? { strict: tool.strict } : {},
    ...deferLoading != null ? { defer_loading: deferLoading } : {},
    ...(options == null ? void 0 : options.allowedCallers) != null ? { allowed_callers: options.allowedCallers } : {},
    ...(options == null ? void 0 : options.outputSchema) != null ? { output_schema: options.outputSchema } : {}
  };
}
function mapShellEnvironment(environment) {
  if (environment.type === "containerReference") {
    const env2 = environment;
    return {
      type: "container_reference",
      container_id: env2.containerId
    };
  }
  if (environment.type === "containerAuto") {
    const env2 = environment;
    return {
      type: "container_auto",
      file_ids: env2.fileIds,
      memory_limit: env2.memoryLimit,
      network_policy: env2.networkPolicy == null ? void 0 : env2.networkPolicy.type === "disabled" ? { type: "disabled" } : {
        type: "allowlist",
        allowed_domains: env2.networkPolicy.allowedDomains,
        domain_secrets: env2.networkPolicy.domainSecrets
      },
      skills: mapShellSkills(env2.skills)
    };
  }
  const env = environment;
  return {
    type: "local",
    skills: env.skills
  };
}
function mapShellSkills(skills) {
  return skills == null ? void 0 : skills.map(
    (skill) => {
      var _a, _b;
      return skill.type === "skillReference" ? {
        type: "skill_reference",
        skill_id: resolveProviderReference3({
          reference: (_a = skill.providerReference) != null ? _a : {},
          provider: "openai"
        }),
        version: (_b = skill.version) != null ? _b : "latest"
      } : {
        type: "inline",
        name: skill.name,
        description: skill.description,
        source: {
          type: "base64",
          media_type: skill.source.mediaType,
          data: skill.source.data
        }
      };
    }
  );
}

// src/responses/openai-responses-language-model.ts
function extractApprovalRequestIdToToolCallIdMapping(prompt) {
  var _a, _b;
  const mapping = {};
  for (const message of prompt) {
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "tool-call") continue;
      const approvalRequestId = (_b = (_a = part.providerOptions) == null ? void 0 : _a.openai) == null ? void 0 : _b.approvalRequestId;
      if (approvalRequestId != null) {
        mapping[approvalRequestId] = part.toolCallId;
      }
    }
  }
  return mapping;
}
function mapComputerAction(action) {
  switch (action.type) {
    case "click":
      return {
        type: "click",
        button: action.button,
        x: action.x,
        y: action.y,
        ...action.keys != null && { keys: action.keys }
      };
    case "double_click":
      return {
        type: "double_click",
        x: action.x,
        y: action.y,
        ...action.keys != null && { keys: action.keys }
      };
    case "drag":
      return {
        type: "drag",
        path: action.path,
        ...action.keys != null && { keys: action.keys }
      };
    case "keypress":
      return action;
    case "move":
      return {
        type: "move",
        x: action.x,
        y: action.y,
        ...action.keys != null && { keys: action.keys }
      };
    case "screenshot":
      return action;
    case "scroll":
      return {
        type: "scroll",
        x: action.x,
        y: action.y,
        scrollX: action.scroll_x,
        scrollY: action.scroll_y,
        ...action.keys != null && { keys: action.keys }
      };
    case "type":
      return action;
    case "wait":
      return action;
  }
}
function mapComputerCallInput({
  action,
  actions,
  pending_safety_checks,
  status
}) {
  var _a;
  return {
    actions: (actions != null ? actions : action != null ? [action] : []).map(
      mapComputerAction
    ),
    pendingSafetyChecks: (_a = pending_safety_checks == null ? void 0 : pending_safety_checks.map((safetyCheck) => ({
      id: safetyCheck.id,
      ...safetyCheck.code != null && { code: safetyCheck.code },
      ...safetyCheck.message != null && { message: safetyCheck.message }
    }))) != null ? _a : [],
    status
  };
}
var OpenAIResponsesLanguageModel = class _OpenAIResponsesLanguageModel {
  constructor(modelId, config) {
    this.specificationVersion = "v4";
    this.supportedUrls = {
      "image/*": [/^https?:\/\/.*$/],
      "application/pdf": [/^https?:\/\/.*$/]
    };
    this.modelId = modelId;
    this.config = config;
  }
  static [WORKFLOW_SERIALIZE5](model) {
    return serializeModelOptions5({
      modelId: model.modelId,
      config: model.config
    });
  }
  static [WORKFLOW_DESERIALIZE5](options) {
    return new _OpenAIResponsesLanguageModel(options.modelId, options.config);
  }
  get provider() {
    return this.config.provider;
  }
  async getArgs({
    maxOutputTokens,
    temperature,
    stopSequences,
    topP,
    topK,
    presencePenalty,
    frequencyPenalty,
    seed,
    prompt,
    reasoning,
    providerOptions,
    tools,
    toolChoice,
    responseFormat
  }) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
    const warnings = [];
    const modelCapabilities = getOpenAILanguageModelCapabilities(this.modelId);
    if (topK != null) {
      warnings.push({ type: "unsupported", feature: "topK" });
    }
    if (seed != null) {
      warnings.push({ type: "unsupported", feature: "seed" });
    }
    if (presencePenalty != null) {
      warnings.push({ type: "unsupported", feature: "presencePenalty" });
    }
    if (frequencyPenalty != null) {
      warnings.push({ type: "unsupported", feature: "frequencyPenalty" });
    }
    if (stopSequences != null) {
      warnings.push({ type: "unsupported", feature: "stopSequences" });
    }
    const providerOptionsName = this.config.provider.includes("azure") ? "azure" : "openai";
    let openaiOptions = await parseProviderOptions7({
      provider: providerOptionsName,
      providerOptions,
      schema: openaiLanguageModelResponsesOptionsSchema
    });
    if (openaiOptions == null && providerOptionsName !== "openai") {
      openaiOptions = await parseProviderOptions7({
        provider: "openai",
        providerOptions,
        schema: openaiLanguageModelResponsesOptionsSchema
      });
    }
    const resolvedReasoningEffort = (_a = openaiOptions == null ? void 0 : openaiOptions.reasoningEffort) != null ? _a : isCustomReasoning2(reasoning) ? reasoning : void 0;
    const resolvedReasoningSummary = (openaiOptions == null ? void 0 : openaiOptions.reasoningSummary) !== void 0 ? openaiOptions.reasoningSummary : resolvedReasoningEffort != null && resolvedReasoningEffort !== "none" ? "detailed" : void 0;
    const isReasoningModel = (_b = openaiOptions == null ? void 0 : openaiOptions.forceReasoning) != null ? _b : modelCapabilities.isReasoningModel;
    if ((openaiOptions == null ? void 0 : openaiOptions.conversation) && (openaiOptions == null ? void 0 : openaiOptions.previousResponseId)) {
      warnings.push({
        type: "unsupported",
        feature: "conversation",
        details: "conversation and previousResponseId cannot be used together"
      });
    }
    const toolNameMapping = createToolNameMapping({
      tools,
      providerToolNames: {
        "openai.code_interpreter": "code_interpreter",
        "openai.computer": "computer",
        "openai.file_search": "file_search",
        "openai.image_generation": "image_generation",
        "openai.local_shell": "local_shell",
        "openai.shell": "shell",
        "openai.web_search": "web_search",
        "openai.web_search_preview": "web_search_preview",
        "openai.mcp": "mcp",
        "openai.apply_patch": "apply_patch",
        "openai.tool_search": "tool_search",
        "openai.programmatic_tool_calling": "programmatic_tool_calling"
      }
    });
    const customProviderToolNames = /* @__PURE__ */ new Set();
    const {
      tools: openaiTools2,
      toolChoice: openaiToolChoice,
      toolWarnings
    } = await prepareResponsesTools({
      tools,
      toolChoice,
      allowedTools: (_c = openaiOptions == null ? void 0 : openaiOptions.allowedTools) != null ? _c : void 0,
      toolNameMapping,
      customProviderToolNames
    });
    const { input, warnings: inputWarnings } = await convertToOpenAIResponsesInput({
      prompt,
      toolNameMapping,
      systemMessageMode: (_d = openaiOptions == null ? void 0 : openaiOptions.systemMessageMode) != null ? _d : isReasoningModel ? "developer" : modelCapabilities.systemMessageMode,
      providerOptionsName,
      fileIdPrefixes: this.config.fileIdPrefixes,
      passThroughUnsupportedFiles: (_e = openaiOptions == null ? void 0 : openaiOptions.passThroughUnsupportedFiles) != null ? _e : false,
      store: (_f = openaiOptions == null ? void 0 : openaiOptions.store) != null ? _f : true,
      hasConversation: (openaiOptions == null ? void 0 : openaiOptions.conversation) != null,
      hasPreviousResponseId: (openaiOptions == null ? void 0 : openaiOptions.previousResponseId) != null,
      hasLocalShellTool: hasOpenAITool("openai.local_shell"),
      hasShellTool: hasOpenAITool("openai.shell"),
      hasApplyPatchTool: hasOpenAITool("openai.apply_patch"),
      hasComputerTool: hasOpenAITool("openai.computer"),
      customProviderToolNames: customProviderToolNames.size > 0 ? customProviderToolNames : void 0
    });
    warnings.push(...inputWarnings);
    const strictJsonSchema = (_g = openaiOptions == null ? void 0 : openaiOptions.strictJsonSchema) != null ? _g : true;
    let include = openaiOptions == null ? void 0 : openaiOptions.include;
    function addInclude(key) {
      if (include == null) {
        include = [key];
      } else if (!include.includes(key)) {
        include = [...include, key];
      }
    }
    function hasOpenAITool(id) {
      return (tools == null ? void 0 : tools.find((tool) => tool.type === "provider" && tool.id === id)) != null;
    }
    const topLogprobs = typeof (openaiOptions == null ? void 0 : openaiOptions.logprobs) === "number" ? openaiOptions == null ? void 0 : openaiOptions.logprobs : (openaiOptions == null ? void 0 : openaiOptions.logprobs) === true ? TOP_LOGPROBS_MAX : void 0;
    if (topLogprobs) {
      addInclude("message.output_text.logprobs");
    }
    const webSearchToolName = (_h = tools == null ? void 0 : tools.find(
      (tool) => tool.type === "provider" && (tool.id === "openai.web_search" || tool.id === "openai.web_search_preview")
    )) == null ? void 0 : _h.name;
    if (webSearchToolName) {
      addInclude("web_search_call.action.sources");
    }
    if (hasOpenAITool("openai.code_interpreter")) {
      addInclude("code_interpreter_call.outputs");
    }
    const store = openaiOptions == null ? void 0 : openaiOptions.store;
    if (store === false && isReasoningModel) {
      addInclude("reasoning.encrypted_content");
    }
    const baseArgs = {
      model: this.modelId,
      input,
      temperature,
      top_p: topP,
      max_output_tokens: maxOutputTokens,
      ...((responseFormat == null ? void 0 : responseFormat.type) === "json" || (openaiOptions == null ? void 0 : openaiOptions.textVerbosity)) && {
        text: {
          ...(responseFormat == null ? void 0 : responseFormat.type) === "json" && {
            format: responseFormat.schema != null ? {
              type: "json_schema",
              strict: strictJsonSchema,
              name: (_i = responseFormat.name) != null ? _i : "response",
              description: responseFormat.description,
              schema: responseFormat.schema
            } : { type: "json_object" }
          },
          ...(openaiOptions == null ? void 0 : openaiOptions.textVerbosity) && {
            verbosity: openaiOptions.textVerbosity
          }
        }
      },
      // provider options:
      conversation: openaiOptions == null ? void 0 : openaiOptions.conversation,
      max_tool_calls: openaiOptions == null ? void 0 : openaiOptions.maxToolCalls,
      metadata: openaiOptions == null ? void 0 : openaiOptions.metadata,
      parallel_tool_calls: openaiOptions == null ? void 0 : openaiOptions.parallelToolCalls,
      previous_response_id: openaiOptions == null ? void 0 : openaiOptions.previousResponseId,
      store,
      user: openaiOptions == null ? void 0 : openaiOptions.user,
      instructions: openaiOptions == null ? void 0 : openaiOptions.instructions,
      service_tier: openaiOptions == null ? void 0 : openaiOptions.serviceTier,
      include,
      prompt_cache_key: openaiOptions == null ? void 0 : openaiOptions.promptCacheKey,
      prompt_cache_options: openaiOptions == null ? void 0 : openaiOptions.promptCacheOptions,
      prompt_cache_retention: openaiOptions == null ? void 0 : openaiOptions.promptCacheRetention,
      safety_identifier: openaiOptions == null ? void 0 : openaiOptions.safetyIdentifier,
      top_logprobs: topLogprobs,
      truncation: openaiOptions == null ? void 0 : openaiOptions.truncation,
      // context management (server-side compaction):
      ...(openaiOptions == null ? void 0 : openaiOptions.contextManagement) && {
        context_management: openaiOptions.contextManagement.map((cm) => ({
          type: cm.type,
          compact_threshold: cm.compactThreshold
        }))
      },
      // model-specific settings:
      ...isReasoningModel && (resolvedReasoningEffort != null || resolvedReasoningSummary != null || (openaiOptions == null ? void 0 : openaiOptions.reasoningMode) != null || (openaiOptions == null ? void 0 : openaiOptions.reasoningContext) != null) && {
        reasoning: {
          ...resolvedReasoningEffort != null && {
            effort: resolvedReasoningEffort
          },
          ...resolvedReasoningSummary != null && {
            summary: resolvedReasoningSummary
          },
          ...(openaiOptions == null ? void 0 : openaiOptions.reasoningMode) != null && {
            mode: openaiOptions.reasoningMode
          },
          ...(openaiOptions == null ? void 0 : openaiOptions.reasoningContext) != null && {
            context: openaiOptions.reasoningContext
          }
        }
      }
    };
    if (isReasoningModel) {
      if (!(resolvedReasoningEffort === "none" && modelCapabilities.supportsNonReasoningParameters)) {
        if (baseArgs.temperature != null) {
          baseArgs.temperature = void 0;
          warnings.push({
            type: "unsupported",
            feature: "temperature",
            details: "temperature is not supported for reasoning models"
          });
        }
        if (baseArgs.top_p != null) {
          baseArgs.top_p = void 0;
          warnings.push({
            type: "unsupported",
            feature: "topP",
            details: "topP is not supported for reasoning models"
          });
        }
      }
    } else {
      if ((openaiOptions == null ? void 0 : openaiOptions.reasoningEffort) != null) {
        warnings.push({
          type: "unsupported",
          feature: "reasoningEffort",
          details: "reasoningEffort is not supported for non-reasoning models"
        });
      }
      if ((openaiOptions == null ? void 0 : openaiOptions.reasoningSummary) != null) {
        warnings.push({
          type: "unsupported",
          feature: "reasoningSummary",
          details: "reasoningSummary is not supported for non-reasoning models"
        });
      }
      if ((openaiOptions == null ? void 0 : openaiOptions.reasoningMode) != null) {
        warnings.push({
          type: "unsupported",
          feature: "reasoningMode",
          details: "reasoningMode is not supported for non-reasoning models"
        });
      }
      if ((openaiOptions == null ? void 0 : openaiOptions.reasoningContext) != null) {
        warnings.push({
          type: "unsupported",
          feature: "reasoningContext",
          details: "reasoningContext is not supported for non-reasoning models"
        });
      }
    }
    if ((openaiOptions == null ? void 0 : openaiOptions.serviceTier) === "flex" && !modelCapabilities.supportsFlexProcessing) {
      warnings.push({
        type: "unsupported",
        feature: "serviceTier",
        details: "flex processing is only available for o3, o4-mini, and gpt-5 models"
      });
      delete baseArgs.service_tier;
    }
    if ((openaiOptions == null ? void 0 : openaiOptions.serviceTier) === "priority" && !modelCapabilities.supportsPriorityProcessing) {
      warnings.push({
        type: "unsupported",
        feature: "serviceTier",
        details: "priority processing is only available for supported models (gpt-4, gpt-5, gpt-5-mini, o3, o4-mini) and requires Enterprise access. gpt-5-nano is not supported"
      });
      delete baseArgs.service_tier;
    }
    const shellToolEnvType = (_l = (_k = (_j = tools == null ? void 0 : tools.find(
      (tool) => tool.type === "provider" && tool.id === "openai.shell"
    )) == null ? void 0 : _j.args) == null ? void 0 : _k.environment) == null ? void 0 : _l.type;
    const isShellProviderExecuted = shellToolEnvType === "containerAuto" || shellToolEnvType === "containerReference";
    return {
      webSearchToolName,
      args: {
        ...baseArgs,
        tools: openaiTools2,
        tool_choice: openaiToolChoice
      },
      warnings: [...warnings, ...toolWarnings],
      store,
      toolNameMapping,
      providerOptionsName,
      isShellProviderExecuted
    };
  }
  async doGenerate(options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E, _F;
    const {
      args: body,
      warnings,
      webSearchToolName,
      toolNameMapping,
      providerOptionsName,
      isShellProviderExecuted
    } = await this.getArgs(options);
    const url = this.config.url({
      path: "/responses",
      modelId: this.modelId
    });
    const approvalRequestIdToDummyToolCallIdFromPrompt = extractApprovalRequestIdToToolCallIdMapping(options.prompt);
    const {
      responseHeaders,
      value: response,
      rawValue: rawResponse
    } = await postJsonToApi5({
      url,
      headers: combineHeaders6((_b = (_a = this.config).headers) == null ? void 0 : _b.call(_a), options.headers),
      body,
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler6(
        openaiResponsesResponseSchema
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch
    });
    if (response.error) {
      throw new APICallError2({
        message: response.error.message,
        url,
        requestBodyValues: body,
        statusCode: 400,
        responseHeaders,
        responseBody: rawResponse,
        isRetryable: false
      });
    }
    if (response.output == null) {
      const detail = (_c = response.incomplete_details) == null ? void 0 : _c.reason;
      throw new APICallError2({
        message: detail ? `Responses API returned no output (${detail})` : "Responses API returned no output",
        url,
        requestBodyValues: body,
        statusCode: 500,
        responseHeaders,
        responseBody: rawResponse,
        isRetryable: false
      });
    }
    const content = [];
    const logprobs = [];
    let hasFunctionCall = false;
    const hostedToolSearchCallIds = [];
    for (const part of response.output) {
      switch (part.type) {
        case "reasoning": {
          if (part.summary.length === 0) {
            part.summary.push({ type: "summary_text", text: "" });
          }
          for (const summary of part.summary) {
            content.push({
              type: "reasoning",
              text: summary.text,
              providerMetadata: {
                [providerOptionsName]: {
                  itemId: part.id,
                  reasoningEncryptedContent: (_d = part.encrypted_content) != null ? _d : null
                }
              }
            });
          }
          break;
        }
        case "image_generation_call": {
          content.push({
            type: "tool-call",
            toolCallId: part.id,
            toolName: toolNameMapping.toCustomToolName("image_generation"),
            input: "{}",
            providerExecuted: true
          });
          content.push({
            type: "tool-result",
            toolCallId: part.id,
            toolName: toolNameMapping.toCustomToolName("image_generation"),
            result: {
              result: part.result
            }
          });
          break;
        }
        case "tool_search_call": {
          const toolCallId = (_e = part.call_id) != null ? _e : part.id;
          const isHosted = part.execution === "server";
          if (isHosted) {
            hostedToolSearchCallIds.push(toolCallId);
          }
          content.push({
            type: "tool-call",
            toolCallId,
            toolName: toolNameMapping.toCustomToolName("tool_search"),
            input: JSON.stringify({
              arguments: part.arguments,
              call_id: part.call_id
            }),
            ...isHosted ? { providerExecuted: true } : {},
            providerMetadata: {
              [providerOptionsName]: {
                itemId: part.id
              }
            }
          });
          break;
        }
        case "tool_search_output": {
          const toolCallId = (_g = (_f = part.call_id) != null ? _f : hostedToolSearchCallIds.shift()) != null ? _g : part.id;
          content.push({
            type: "tool-result",
            toolCallId,
            toolName: toolNameMapping.toCustomToolName("tool_search"),
            result: {
              tools: part.tools
            },
            providerMetadata: {
              [providerOptionsName]: {
                itemId: part.id
              }
            }
          });
          break;
        }
        case "local_shell_call": {
          content.push({
            type: "tool-call",
            toolCallId: part.call_id,
            toolName: toolNameMapping.toCustomToolName("local_shell"),
            input: JSON.stringify({
              action: part.action
            }),
            providerMetadata: {
              [providerOptionsName]: {
                itemId: part.id
              }
            }
          });
          break;
        }
        case "shell_call": {
          content.push({
            type: "tool-call",
            toolCallId: part.call_id,
            toolName: toolNameMapping.toCustomToolName("shell"),
            input: JSON.stringify({
              action: {
                commands: part.action.commands
              }
            }),
            ...isShellProviderExecuted && { providerExecuted: true },
            providerMetadata: {
              [providerOptionsName]: {
                itemId: part.id
              }
            }
          });
          break;
        }
        case "shell_call_output": {
          content.push({
            type: "tool-result",
            toolCallId: part.call_id,
            toolName: toolNameMapping.toCustomToolName("shell"),
            result: {
              output: part.output.map((item) => ({
                stdout: item.stdout,
                stderr: item.stderr,
                outcome: item.outcome.type === "exit" ? {
                  type: "exit",
                  exitCode: item.outcome.exit_code
                } : { type: "timeout" }
              }))
            }
          });
          break;
        }
        case "message": {
          for (const contentPart of part.content) {
            if (((_i = (_h = options.providerOptions) == null ? void 0 : _h[providerOptionsName]) == null ? void 0 : _i.logprobs) && contentPart.logprobs) {
              logprobs.push(contentPart.logprobs);
            }
            const providerMetadata2 = {
              itemId: part.id,
              ...part.phase != null && { phase: part.phase },
              ...contentPart.annotations.length > 0 && {
                annotations: contentPart.annotations
              }
            };
            content.push({
              type: "text",
              text: contentPart.text,
              providerMetadata: {
                [providerOptionsName]: providerMetadata2
              }
            });
            for (const annotation of contentPart.annotations) {
              if (annotation.type === "url_citation") {
                content.push({
                  type: "source",
                  sourceType: "url",
                  id: (_l = (_k = (_j = this.config).generateId) == null ? void 0 : _k.call(_j)) != null ? _l : generateId2(),
                  url: annotation.url,
                  title: annotation.title
                });
              } else if (annotation.type === "file_citation") {
                content.push({
                  type: "source",
                  sourceType: "document",
                  id: (_o = (_n = (_m = this.config).generateId) == null ? void 0 : _n.call(_m)) != null ? _o : generateId2(),
                  mediaType: "text/plain",
                  title: annotation.filename,
                  filename: annotation.filename,
                  providerMetadata: {
                    [providerOptionsName]: {
                      type: annotation.type,
                      fileId: annotation.file_id,
                      index: annotation.index
                    }
                  }
                });
              } else if (annotation.type === "container_file_citation") {
                content.push({
                  type: "source",
                  sourceType: "document",
                  id: (_r = (_q = (_p = this.config).generateId) == null ? void 0 : _q.call(_p)) != null ? _r : generateId2(),
                  mediaType: "text/plain",
                  title: annotation.filename,
                  filename: annotation.filename,
                  providerMetadata: {
                    [providerOptionsName]: {
                      type: annotation.type,
                      fileId: annotation.file_id,
                      containerId: annotation.container_id
                    }
                  }
                });
              } else if (annotation.type === "file_path") {
                content.push({
                  type: "source",
                  sourceType: "document",
                  id: (_u = (_t = (_s = this.config).generateId) == null ? void 0 : _t.call(_s)) != null ? _u : generateId2(),
                  mediaType: "application/octet-stream",
                  title: annotation.file_id,
                  filename: annotation.file_id,
                  providerMetadata: {
                    [providerOptionsName]: {
                      type: annotation.type,
                      fileId: annotation.file_id,
                      index: annotation.index
                    }
                  }
                });
              }
            }
          }
          break;
        }
        case "function_call": {
          hasFunctionCall = true;
          content.push({
            type: "tool-call",
            toolCallId: part.call_id,
            toolName: part.name,
            input: part.arguments,
            providerMetadata: {
              [providerOptionsName]: {
                itemId: part.id,
                ...part.namespace != null && { namespace: part.namespace },
                ...part.caller != null && {
                  caller: part.caller.type === "program" ? {
                    type: "program",
                    callerId: part.caller.caller_id
                  } : part.caller
                }
              }
            }
          });
          break;
        }
        case "program": {
          content.push({
            type: "tool-call",
            toolCallId: part.call_id,
            toolName: toolNameMapping.toCustomToolName(
              "programmatic_tool_calling"
            ),
            input: JSON.stringify({
              code: part.code,
              fingerprint: part.fingerprint
            }),
            providerExecuted: true,
            providerMetadata: {
              [providerOptionsName]: {
                itemId: part.id
              }
            }
          });
          break;
        }
        case "program_output": {
          content.push({
            type: "tool-result",
            toolCallId: part.call_id,
            toolName: toolNameMapping.toCustomToolName(
              "programmatic_tool_calling"
            ),
            result: {
              result: part.result,
              status: part.status
            },
            providerMetadata: {
              [providerOptionsName]: {
                itemId: part.id
              }
            }
          });
          break;
        }
        case "custom_tool_call": {
          hasFunctionCall = true;
          const toolName = toolNameMapping.toCustomToolName(part.name);
          content.push({
            type: "tool-call",
            toolCallId: part.call_id,
            toolName,
            input: JSON.stringify(part.input),
            providerMetadata: {
              [providerOptionsName]: {
                itemId: part.id
              }
            }
          });
          break;
        }
        case "web_search_call": {
          content.push({
            type: "tool-call",
            toolCallId: part.id,
            toolName: toolNameMapping.toCustomToolName(
              webSearchToolName != null ? webSearchToolName : "web_search"
            ),
            input: JSON.stringify({}),
            providerExecuted: true
          });
          content.push({
            type: "tool-result",
            toolCallId: part.id,
            toolName: toolNameMapping.toCustomToolName(
              webSearchToolName != null ? webSearchToolName : "web_search"
            ),
            result: mapWebSearchOutput(part.action)
          });
          break;
        }
        case "mcp_call": {
          const toolCallId = part.approval_request_id != null ? (_v = approvalRequestIdToDummyToolCallIdFromPrompt[part.approval_request_id]) != null ? _v : part.id : part.id;
          const toolName = `mcp.${part.name}`;
          content.push({
            type: "tool-call",
            toolCallId,
            toolName,
            input: part.arguments,
            providerExecuted: true,
            dynamic: true
          });
          content.push({
            type: "tool-result",
            toolCallId,
            toolName,
            result: {
              type: "call",
              serverLabel: part.server_label,
              name: part.name,
              arguments: part.arguments,
              ...part.output != null ? { output: part.output } : {},
              ...part.error != null ? { error: part.error } : {}
            },
            providerMetadata: {
              [providerOptionsName]: {
                itemId: part.id
              }
            }
          });
          break;
        }
        case "mcp_list_tools": {
          break;
        }
        case "mcp_approval_request": {
          const approvalRequestId = (_w = part.approval_request_id) != null ? _w : part.id;
          const dummyToolCallId = (_z = (_y = (_x = this.config).generateId) == null ? void 0 : _y.call(_x)) != null ? _z : generateId2();
          const toolName = `mcp.${part.name}`;
          content.push({
            type: "tool-call",
            toolCallId: dummyToolCallId,
            toolName,
            input: part.arguments,
            providerExecuted: true,
            dynamic: true
          });
          content.push({
            type: "tool-approval-request",
            approvalId: approvalRequestId,
            toolCallId: dummyToolCallId
          });
          break;
        }
        case "computer_call": {
          if (part.call_id == null) {
            content.push({
              type: "tool-call",
              toolCallId: part.id,
              toolName: toolNameMapping.toCustomToolName("computer_use"),
              input: "",
              providerExecuted: true
            });
            content.push({
              type: "tool-result",
              toolCallId: part.id,
              toolName: toolNameMapping.toCustomToolName("computer_use"),
              result: {
                type: "computer_use_tool_result",
                status: part.status
              }
            });
            break;
          }
          hasFunctionCall = true;
          const toolName = toolNameMapping.toCustomToolName("computer");
          content.push({
            type: "tool-call",
            toolCallId: part.call_id,
            toolName,
            input: JSON.stringify(mapComputerCallInput(part)),
            providerMetadata: {
              [providerOptionsName]: {
                itemId: part.id
              }
            }
          });
          break;
        }
        case "file_search_call": {
          content.push({
            type: "tool-call",
            toolCallId: part.id,
            toolName: toolNameMapping.toCustomToolName("file_search"),
            input: "{}",
            providerExecuted: true
          });
          content.push({
            type: "tool-result",
            toolCallId: part.id,
            toolName: toolNameMapping.toCustomToolName("file_search"),
            result: {
              queries: part.queries,
              results: (_B = (_A = part.results) == null ? void 0 : _A.map((result) => ({
                attributes: result.attributes,
                fileId: result.file_id,
                filename: result.filename,
                score: result.score,
                text: result.text
              }))) != null ? _B : null
            }
          });
          break;
        }
        case "code_interpreter_call": {
          content.push({
            type: "tool-call",
            toolCallId: part.id,
            toolName: toolNameMapping.toCustomToolName("code_interpreter"),
            input: JSON.stringify({
              code: part.code,
              containerId: part.container_id
            }),
            providerExecuted: true
          });
          content.push({
            type: "tool-result",
            toolCallId: part.id,
            toolName: toolNameMapping.toCustomToolName("code_interpreter"),
            result: {
              outputs: part.outputs
            }
          });
          break;
        }
        case "apply_patch_call": {
          content.push({
            type: "tool-call",
            toolCallId: part.call_id,
            toolName: toolNameMapping.toCustomToolName("apply_patch"),
            input: JSON.stringify({
              callId: part.call_id,
              operation: part.operation
            }),
            providerMetadata: {
              [providerOptionsName]: {
                itemId: part.id
              }
            }
          });
          break;
        }
        case "compaction": {
          content.push({
            type: "custom",
            kind: "openai.compaction",
            providerMetadata: {
              [providerOptionsName]: {
                type: "compaction",
                itemId: part.id,
                encryptedContent: part.encrypted_content
              }
            }
          });
          break;
        }
      }
    }
    const providerMetadata = {
      [providerOptionsName]: {
        responseId: response.id,
        ...logprobs.length > 0 ? { logprobs } : {},
        ...typeof response.service_tier === "string" ? { serviceTier: response.service_tier } : {},
        ...((_C = response.reasoning) == null ? void 0 : _C.context) != null ? { reasoningContext: response.reasoning.context } : {}
      }
    };
    const usage = response.usage;
    return {
      content,
      finishReason: {
        unified: mapOpenAIResponseFinishReason({
          finishReason: (_D = response.incomplete_details) == null ? void 0 : _D.reason,
          hasFunctionCall
        }),
        raw: (_F = (_E = response.incomplete_details) == null ? void 0 : _E.reason) != null ? _F : void 0
      },
      usage: convertOpenAIResponsesUsage(usage),
      request: { body },
      response: {
        id: response.id,
        timestamp: new Date(response.created_at * 1e3),
        modelId: response.model,
        headers: responseHeaders,
        body: rawResponse
      },
      providerMetadata,
      warnings
    };
  }
  async doStream(options) {
    var _a, _b;
    const {
      args: body,
      warnings,
      webSearchToolName,
      toolNameMapping,
      store,
      providerOptionsName,
      isShellProviderExecuted
    } = await this.getArgs(options);
    const url = this.config.url({
      path: "/responses",
      modelId: this.modelId
    });
    const { responseHeaders, value: response } = await postJsonToApi5({
      url,
      headers: combineHeaders6((_b = (_a = this.config).headers) == null ? void 0 : _b.call(_a), options.headers),
      body: {
        ...body,
        stream: true
      },
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler3(
        openaiResponsesChunkSchema
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch
    });
    const checkedResponse = await throwIfOpenAIStreamErrorBeforeOutput({
      stream: response,
      getError: (chunk) => isErrorChunk(chunk) || isResponseFailedChunk(chunk) && chunk.response.error != null ? chunk : void 0,
      isOutputChunk: isResponseOutputChunk,
      url,
      requestBodyValues: body,
      responseHeaders
    });
    const self = this;
    const approvalRequestIdToDummyToolCallIdFromPrompt = extractApprovalRequestIdToToolCallIdMapping(options.prompt);
    const approvalRequestIdToDummyToolCallIdFromStream = /* @__PURE__ */ new Map();
    let finishReason = {
      unified: "other",
      raw: void 0
    };
    let usage = void 0;
    const logprobs = [];
    let responseId = null;
    const ongoingToolCalls = {};
    const ongoingAnnotations = [];
    let activeMessagePhase;
    let hasFunctionCall = false;
    const activeReasoning = {};
    let serviceTier;
    let reasoningContext;
    const hostedToolSearchCallIds = [];
    let encounteredStreamError = false;
    const result = {
      stream: checkedResponse.pipeThrough(
        new TransformStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings });
          },
          transform(chunk, controller) {
            var _a2, _b2, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E, _F, _G, _H, _I, _J, _K, _L, _M, _N, _O;
            if (options.includeRawChunks) {
              controller.enqueue({ type: "raw", rawValue: chunk.rawValue });
            }
            if (!chunk.success) {
              const error = isOpenAIChatCompletionChunk(chunk.rawValue) ? createOpenAIResponsesChatCompletionsMismatchError({
                value: chunk.rawValue,
                cause: chunk.error,
                url,
                requestBodyValues: body,
                responseHeaders
              }) : chunk.error;
              finishReason = { unified: "error", raw: void 0 };
              controller.enqueue({ type: "error", error });
              return;
            }
            const value = chunk.value;
            if (isResponseOutputItemAddedChunk(value)) {
              if (value.item.type === "function_call") {
                ongoingToolCalls[value.output_index] = {
                  toolName: value.item.name,
                  toolCallId: value.item.call_id
                };
                controller.enqueue({
                  type: "tool-input-start",
                  id: value.item.call_id,
                  toolName: value.item.name
                });
              } else if (value.item.type === "custom_tool_call") {
                const toolName = toolNameMapping.toCustomToolName(
                  value.item.name
                );
                ongoingToolCalls[value.output_index] = {
                  toolName,
                  toolCallId: value.item.call_id
                };
                controller.enqueue({
                  type: "tool-input-start",
                  id: value.item.call_id,
                  toolName
                });
              } else if (value.item.type === "web_search_call") {
                ongoingToolCalls[value.output_index] = {
                  toolName: toolNameMapping.toCustomToolName(
                    webSearchToolName != null ? webSearchToolName : "web_search"
                  ),
                  toolCallId: value.item.id
                };
                controller.enqueue({
                  type: "tool-input-start",
                  id: value.item.id,
                  toolName: toolNameMapping.toCustomToolName(
                    webSearchToolName != null ? webSearchToolName : "web_search"
                  ),
                  providerExecuted: true
                });
                controller.enqueue({
                  type: "tool-input-end",
                  id: value.item.id
                });
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: value.item.id,
                  toolName: toolNameMapping.toCustomToolName(
                    webSearchToolName != null ? webSearchToolName : "web_search"
                  ),
                  input: JSON.stringify({}),
                  providerExecuted: true
                });
              } else if (value.item.type === "computer_call") {
                const toolCallId = (_a2 = value.item.call_id) != null ? _a2 : value.item.id;
                ongoingToolCalls[value.output_index] = {
                  toolName: toolNameMapping.toCustomToolName("computer"),
                  toolCallId
                };
                controller.enqueue({
                  type: "tool-input-start",
                  id: toolCallId,
                  toolName: toolNameMapping.toCustomToolName("computer")
                });
              } else if (value.item.type === "code_interpreter_call") {
                ongoingToolCalls[value.output_index] = {
                  toolName: toolNameMapping.toCustomToolName("code_interpreter"),
                  toolCallId: value.item.id,
                  codeInterpreter: {
                    containerId: value.item.container_id
                  }
                };
                controller.enqueue({
                  type: "tool-input-start",
                  id: value.item.id,
                  toolName: toolNameMapping.toCustomToolName("code_interpreter"),
                  providerExecuted: true
                });
                controller.enqueue({
                  type: "tool-input-delta",
                  id: value.item.id,
                  delta: `{"containerId":"${value.item.container_id}","code":"`
                });
              } else if (value.item.type === "file_search_call") {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: value.item.id,
                  toolName: toolNameMapping.toCustomToolName("file_search"),
                  input: "{}",
                  providerExecuted: true
                });
              } else if (value.item.type === "image_generation_call") {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: value.item.id,
                  toolName: toolNameMapping.toCustomToolName("image_generation"),
                  input: "{}",
                  providerExecuted: true
                });
              } else if (value.item.type === "tool_search_call") {
                const toolCallId = value.item.id;
                const toolName = toolNameMapping.toCustomToolName("tool_search");
                const isHosted = value.item.execution === "server";
                ongoingToolCalls[value.output_index] = {
                  toolName,
                  toolCallId,
                  toolSearchExecution: (_b2 = value.item.execution) != null ? _b2 : "server"
                };
                if (isHosted) {
                  controller.enqueue({
                    type: "tool-input-start",
                    id: toolCallId,
                    toolName,
                    providerExecuted: true
                  });
                }
              } else if (value.item.type === "tool_search_output") {
              } else if (value.item.type === "mcp_call" || value.item.type === "mcp_list_tools" || value.item.type === "mcp_approval_request") {
              } else if (value.item.type === "apply_patch_call") {
                const { call_id: callId, operation } = value.item;
                ongoingToolCalls[value.output_index] = {
                  toolName: toolNameMapping.toCustomToolName("apply_patch"),
                  toolCallId: callId,
                  applyPatch: {
                    // delete_file doesn't have diff
                    hasDiff: operation.type === "delete_file",
                    endEmitted: operation.type === "delete_file"
                  }
                };
                controller.enqueue({
                  type: "tool-input-start",
                  id: callId,
                  toolName: toolNameMapping.toCustomToolName("apply_patch")
                });
                if (operation.type === "delete_file") {
                  const inputString = JSON.stringify({
                    callId,
                    operation
                  });
                  controller.enqueue({
                    type: "tool-input-delta",
                    id: callId,
                    delta: inputString
                  });
                  controller.enqueue({
                    type: "tool-input-end",
                    id: callId
                  });
                } else {
                  controller.enqueue({
                    type: "tool-input-delta",
                    id: callId,
                    delta: `{"callId":"${escapeJSONDelta(callId)}","operation":{"type":"${escapeJSONDelta(operation.type)}","path":"${escapeJSONDelta(operation.path)}","diff":"`
                  });
                }
              } else if (value.item.type === "shell_call") {
                ongoingToolCalls[value.output_index] = {
                  toolName: toolNameMapping.toCustomToolName("shell"),
                  toolCallId: value.item.call_id
                };
              } else if (value.item.type === "shell_call_output") {
              } else if (value.item.type === "message") {
                ongoingAnnotations.splice(0, ongoingAnnotations.length);
                activeMessagePhase = (_c = value.item.phase) != null ? _c : void 0;
                controller.enqueue({
                  type: "text-start",
                  id: value.item.id,
                  providerMetadata: {
                    [providerOptionsName]: {
                      itemId: value.item.id,
                      ...value.item.phase != null && {
                        phase: value.item.phase
                      }
                    }
                  }
                });
              } else if (isResponseOutputItemAddedChunk(value) && value.item.type === "reasoning") {
                activeReasoning[value.item.id] = {
                  encryptedContent: value.item.encrypted_content,
                  summaryParts: { 0: "active" }
                };
                controller.enqueue({
                  type: "reasoning-start",
                  id: `${value.item.id}:0`,
                  providerMetadata: {
                    [providerOptionsName]: {
                      itemId: value.item.id,
                      reasoningEncryptedContent: (_d = value.item.encrypted_content) != null ? _d : null
                    }
                  }
                });
              }
            } else if (isResponseOutputItemDoneChunk(value)) {
              if (value.item.type === "message") {
                const phase = (_e = value.item.phase) != null ? _e : activeMessagePhase;
                activeMessagePhase = void 0;
                controller.enqueue({
                  type: "text-end",
                  id: value.item.id,
                  providerMetadata: {
                    [providerOptionsName]: {
                      itemId: value.item.id,
                      ...phase != null && { phase },
                      ...ongoingAnnotations.length > 0 && {
                        annotations: ongoingAnnotations
                      }
                    }
                  }
                });
              } else if (value.item.type === "function_call") {
                ongoingToolCalls[value.output_index] = void 0;
                hasFunctionCall = true;
                controller.enqueue({
                  type: "tool-input-end",
                  id: value.item.call_id,
                  ...value.item.namespace != null && {
                    providerMetadata: {
                      [providerOptionsName]: {
                        namespace: value.item.namespace
                      }
                    }
                  }
                });
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: value.item.call_id,
                  toolName: value.item.name,
                  input: value.item.arguments,
                  providerMetadata: {
                    [providerOptionsName]: {
                      itemId: value.item.id,
                      ...value.item.namespace != null && {
                        namespace: value.item.namespace
                      },
                      ...value.item.caller != null && {
                        caller: value.item.caller.type === "program" ? {
                          type: "program",
                          callerId: value.item.caller.caller_id
                        } : value.item.caller
                      }
                    }
                  }
                });
              } else if (value.item.type === "program") {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: value.item.call_id,
                  toolName: toolNameMapping.toCustomToolName(
                    "programmatic_tool_calling"
                  ),
                  input: JSON.stringify({
                    code: value.item.code,
                    fingerprint: value.item.fingerprint
                  }),
                  providerExecuted: true,
                  providerMetadata: {
                    [providerOptionsName]: {
                      itemId: value.item.id
                    }
                  }
                });
              } else if (value.item.type === "program_output") {
                controller.enqueue({
                  type: "tool-result",
                  toolCallId: value.item.call_id,
                  toolName: toolNameMapping.toCustomToolName(
                    "programmatic_tool_calling"
                  ),
                  result: {
                    result: value.item.result,
                    status: value.item.status
                  },
                  providerMetadata: {
                    [providerOptionsName]: {
                      itemId: value.item.id
                    }
                  }
                });
              } else if (value.item.type === "custom_tool_call") {
                ongoingToolCalls[value.output_index] = void 0;
                hasFunctionCall = true;
                const toolName = toolNameMapping.toCustomToolName(
                  value.item.name
                );
                controller.enqueue({
                  type: "tool-input-end",
                  id: value.item.call_id
                });
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: value.item.call_id,
                  toolName,
                  input: JSON.stringify(value.item.input),
                  providerMetadata: {
                    [providerOptionsName]: {
                      itemId: value.item.id
                    }
                  }
                });
              } else if (value.item.type === "web_search_call") {
                ongoingToolCalls[value.output_index] = void 0;
                controller.enqueue({
                  type: "tool-result",
                  toolCallId: value.item.id,
                  toolName: toolNameMapping.toCustomToolName(
                    webSearchToolName != null ? webSearchToolName : "web_search"
                  ),
                  result: mapWebSearchOutput(value.item.action)
                });
              } else if (value.item.type === "computer_call") {
                ongoingToolCalls[value.output_index] = void 0;
                if (value.item.call_id == null) {
                  controller.enqueue({
                    type: "tool-input-end",
                    id: value.item.id
                  });
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: value.item.id,
                    toolName: toolNameMapping.toCustomToolName("computer_use"),
                    input: "",
                    providerExecuted: true
                  });
                  controller.enqueue({
                    type: "tool-result",
                    toolCallId: value.item.id,
                    toolName: toolNameMapping.toCustomToolName("computer_use"),
                    result: {
                      type: "computer_use_tool_result",
                      status: value.item.status
                    }
                  });
                  return;
                }
                hasFunctionCall = true;
                const toolName = toolNameMapping.toCustomToolName("computer");
                const input = JSON.stringify(mapComputerCallInput(value.item));
                controller.enqueue({
                  type: "tool-input-delta",
                  id: value.item.call_id,
                  delta: input
                });
                controller.enqueue({
                  type: "tool-input-end",
                  id: value.item.call_id
                });
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: value.item.call_id,
                  toolName,
                  input,
                  providerMetadata: {
                    [providerOptionsName]: {
                      itemId: value.item.id
                    }
                  }
                });
              } else if (value.item.type === "file_search_call") {
                ongoingToolCalls[value.output_index] = void 0;
                controller.enqueue({
                  type: "tool-result",
                  toolCallId: value.item.id,
                  toolName: toolNameMapping.toCustomToolName("file_search"),
                  result: {
                    queries: value.item.queries,
                    results: (_g = (_f = value.item.results) == null ? void 0 : _f.map((result2) => ({
                      attributes: result2.attributes,
                      fileId: result2.file_id,
                      filename: result2.filename,
                      score: result2.score,
                      text: result2.text
                    }))) != null ? _g : null
                  }
                });
              } else if (value.item.type === "code_interpreter_call") {
                ongoingToolCalls[value.output_index] = void 0;
                controller.enqueue({
                  type: "tool-result",
                  toolCallId: value.item.id,
                  toolName: toolNameMapping.toCustomToolName("code_interpreter"),
                  result: {
                    outputs: value.item.outputs
                  }
                });
              } else if (value.item.type === "image_generation_call") {
                controller.enqueue({
                  type: "tool-result",
                  toolCallId: value.item.id,
                  toolName: toolNameMapping.toCustomToolName("image_generation"),
                  result: {
                    result: value.item.result
                  }
                });
              } else if (value.item.type === "tool_search_call") {
                const toolCall = ongoingToolCalls[value.output_index];
                const isHosted = value.item.execution === "server";
                if (toolCall != null) {
                  const toolCallId = isHosted ? toolCall.toolCallId : (_h = value.item.call_id) != null ? _h : value.item.id;
                  if (isHosted) {
                    hostedToolSearchCallIds.push(toolCallId);
                  } else {
                    controller.enqueue({
                      type: "tool-input-start",
                      id: toolCallId,
                      toolName: toolCall.toolName
                    });
                  }
                  controller.enqueue({
                    type: "tool-input-end",
                    id: toolCallId
                  });
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId,
                    toolName: toolCall.toolName,
                    input: JSON.stringify({
                      arguments: value.item.arguments,
                      call_id: isHosted ? null : toolCallId
                    }),
                    ...isHosted ? { providerExecuted: true } : {},
                    providerMetadata: {
                      [providerOptionsName]: {
                        itemId: value.item.id
                      }
                    }
                  });
                }
                ongoingToolCalls[value.output_index] = void 0;
              } else if (value.item.type === "tool_search_output") {
                const toolCallId = (_j = (_i = value.item.call_id) != null ? _i : hostedToolSearchCallIds.shift()) != null ? _j : value.item.id;
                controller.enqueue({
                  type: "tool-result",
                  toolCallId,
                  toolName: toolNameMapping.toCustomToolName("tool_search"),
                  result: {
                    tools: value.item.tools
                  },
                  providerMetadata: {
                    [providerOptionsName]: {
                      itemId: value.item.id
                    }
                  }
                });
              } else if (value.item.type === "mcp_call") {
                ongoingToolCalls[value.output_index] = void 0;
                const approvalRequestId = (_k = value.item.approval_request_id) != null ? _k : void 0;
                const aliasedToolCallId = approvalRequestId != null ? (_m = (_l = approvalRequestIdToDummyToolCallIdFromStream.get(
                  approvalRequestId
                )) != null ? _l : approvalRequestIdToDummyToolCallIdFromPrompt[approvalRequestId]) != null ? _m : value.item.id : value.item.id;
                const toolName = `mcp.${value.item.name}`;
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: aliasedToolCallId,
                  toolName,
                  input: value.item.arguments,
                  providerExecuted: true,
                  dynamic: true
                });
                controller.enqueue({
                  type: "tool-result",
                  toolCallId: aliasedToolCallId,
                  toolName,
                  result: {
                    type: "call",
                    serverLabel: value.item.server_label,
                    name: value.item.name,
                    arguments: value.item.arguments,
                    ...value.item.output != null ? { output: value.item.output } : {},
                    ...value.item.error != null ? { error: value.item.error } : {}
                  },
                  providerMetadata: {
                    [providerOptionsName]: {
                      itemId: value.item.id
                    }
                  }
                });
              } else if (value.item.type === "mcp_list_tools") {
                ongoingToolCalls[value.output_index] = void 0;
              } else if (value.item.type === "apply_patch_call") {
                const toolCall = ongoingToolCalls[value.output_index];
                if ((toolCall == null ? void 0 : toolCall.applyPatch) && !toolCall.applyPatch.endEmitted && value.item.operation.type !== "delete_file") {
                  if (!toolCall.applyPatch.hasDiff) {
                    controller.enqueue({
                      type: "tool-input-delta",
                      id: toolCall.toolCallId,
                      delta: escapeJSONDelta(value.item.operation.diff)
                    });
                  }
                  controller.enqueue({
                    type: "tool-input-delta",
                    id: toolCall.toolCallId,
                    delta: '"}}'
                  });
                  controller.enqueue({
                    type: "tool-input-end",
                    id: toolCall.toolCallId
                  });
                  toolCall.applyPatch.endEmitted = true;
                }
                if (toolCall && value.item.status === "completed") {
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: toolCall.toolCallId,
                    toolName: toolNameMapping.toCustomToolName("apply_patch"),
                    input: JSON.stringify({
                      callId: value.item.call_id,
                      operation: value.item.operation
                    }),
                    providerMetadata: {
                      [providerOptionsName]: {
                        itemId: value.item.id
                      }
                    }
                  });
                }
                ongoingToolCalls[value.output_index] = void 0;
              } else if (value.item.type === "mcp_approval_request") {
                ongoingToolCalls[value.output_index] = void 0;
                const dummyToolCallId = (_p = (_o = (_n = self.config).generateId) == null ? void 0 : _o.call(_n)) != null ? _p : generateId2();
                const approvalRequestId = (_q = value.item.approval_request_id) != null ? _q : value.item.id;
                approvalRequestIdToDummyToolCallIdFromStream.set(
                  approvalRequestId,
                  dummyToolCallId
                );
                const toolName = `mcp.${value.item.name}`;
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: dummyToolCallId,
                  toolName,
                  input: value.item.arguments,
                  providerExecuted: true,
                  dynamic: true
                });
                controller.enqueue({
                  type: "tool-approval-request",
                  approvalId: approvalRequestId,
                  toolCallId: dummyToolCallId
                });
              } else if (value.item.type === "local_shell_call") {
                ongoingToolCalls[value.output_index] = void 0;
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: value.item.call_id,
                  toolName: toolNameMapping.toCustomToolName("local_shell"),
                  input: JSON.stringify({
                    action: {
                      type: "exec",
                      command: value.item.action.command,
                      timeoutMs: value.item.action.timeout_ms,
                      user: value.item.action.user,
                      workingDirectory: value.item.action.working_directory,
                      env: value.item.action.env
                    }
                  }),
                  providerMetadata: {
                    [providerOptionsName]: { itemId: value.item.id }
                  }
                });
              } else if (value.item.type === "shell_call") {
                ongoingToolCalls[value.output_index] = void 0;
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: value.item.call_id,
                  toolName: toolNameMapping.toCustomToolName("shell"),
                  input: JSON.stringify({
                    action: {
                      commands: value.item.action.commands
                    }
                  }),
                  ...isShellProviderExecuted && {
                    providerExecuted: true
                  },
                  providerMetadata: {
                    [providerOptionsName]: { itemId: value.item.id }
                  }
                });
              } else if (value.item.type === "shell_call_output") {
                controller.enqueue({
                  type: "tool-result",
                  toolCallId: value.item.call_id,
                  toolName: toolNameMapping.toCustomToolName("shell"),
                  result: {
                    output: value.item.output.map(
                      (item) => ({
                        stdout: item.stdout,
                        stderr: item.stderr,
                        outcome: item.outcome.type === "exit" ? {
                          type: "exit",
                          exitCode: item.outcome.exit_code
                        } : { type: "timeout" }
                      })
                    )
                  }
                });
              } else if (value.item.type === "reasoning") {
                const activeReasoningPart = activeReasoning[value.item.id];
                const summaryPartIndices = Object.entries(
                  activeReasoningPart.summaryParts
                ).filter(
                  ([_, status]) => status === "active" || status === "can-conclude"
                ).map(([summaryIndex]) => summaryIndex);
                for (const summaryIndex of summaryPartIndices) {
                  controller.enqueue({
                    type: "reasoning-end",
                    id: `${value.item.id}:${summaryIndex}`,
                    providerMetadata: {
                      [providerOptionsName]: {
                        itemId: value.item.id,
                        reasoningEncryptedContent: (_r = value.item.encrypted_content) != null ? _r : null
                      }
                    }
                  });
                }
                delete activeReasoning[value.item.id];
              } else if (value.item.type === "compaction") {
                controller.enqueue({
                  type: "custom",
                  kind: "openai.compaction",
                  providerMetadata: {
                    [providerOptionsName]: {
                      type: "compaction",
                      itemId: value.item.id,
                      encryptedContent: value.item.encrypted_content
                    }
                  }
                });
              }
            } else if (isResponseFunctionCallArgumentsDeltaChunk(value)) {
              const toolCall = ongoingToolCalls[value.output_index];
              if (toolCall != null) {
                controller.enqueue({
                  type: "tool-input-delta",
                  id: toolCall.toolCallId,
                  delta: value.delta
                });
              }
            } else if (isResponseCustomToolCallInputDeltaChunk(value)) {
              const toolCall = ongoingToolCalls[value.output_index];
              if (toolCall != null) {
                controller.enqueue({
                  type: "tool-input-delta",
                  id: toolCall.toolCallId,
                  delta: value.delta
                });
              }
            } else if (isResponseApplyPatchCallOperationDiffDeltaChunk(value)) {
              const toolCall = ongoingToolCalls[value.output_index];
              if (toolCall == null ? void 0 : toolCall.applyPatch) {
                controller.enqueue({
                  type: "tool-input-delta",
                  id: toolCall.toolCallId,
                  delta: escapeJSONDelta(value.delta)
                });
                toolCall.applyPatch.hasDiff = true;
              }
            } else if (isResponseApplyPatchCallOperationDiffDoneChunk(value)) {
              const toolCall = ongoingToolCalls[value.output_index];
              if ((toolCall == null ? void 0 : toolCall.applyPatch) && !toolCall.applyPatch.endEmitted) {
                if (!toolCall.applyPatch.hasDiff) {
                  controller.enqueue({
                    type: "tool-input-delta",
                    id: toolCall.toolCallId,
                    delta: escapeJSONDelta(value.diff)
                  });
                  toolCall.applyPatch.hasDiff = true;
                }
                controller.enqueue({
                  type: "tool-input-delta",
                  id: toolCall.toolCallId,
                  delta: '"}}'
                });
                controller.enqueue({
                  type: "tool-input-end",
                  id: toolCall.toolCallId
                });
                toolCall.applyPatch.endEmitted = true;
              }
            } else if (isResponseImageGenerationCallPartialImageChunk(value)) {
              controller.enqueue({
                type: "tool-result",
                toolCallId: value.item_id,
                toolName: toolNameMapping.toCustomToolName("image_generation"),
                result: {
                  result: value.partial_image_b64
                },
                preliminary: true
              });
            } else if (isResponseCodeInterpreterCallCodeDeltaChunk(value)) {
              const toolCall = ongoingToolCalls[value.output_index];
              if (toolCall != null) {
                controller.enqueue({
                  type: "tool-input-delta",
                  id: toolCall.toolCallId,
                  delta: escapeJSONDelta(value.delta)
                });
              }
            } else if (isResponseCodeInterpreterCallCodeDoneChunk(value)) {
              const toolCall = ongoingToolCalls[value.output_index];
              if (toolCall != null) {
                controller.enqueue({
                  type: "tool-input-delta",
                  id: toolCall.toolCallId,
                  delta: '"}'
                });
                controller.enqueue({
                  type: "tool-input-end",
                  id: toolCall.toolCallId
                });
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: toolCall.toolCallId,
                  toolName: toolNameMapping.toCustomToolName("code_interpreter"),
                  input: JSON.stringify({
                    code: value.code,
                    containerId: toolCall.codeInterpreter.containerId
                  }),
                  providerExecuted: true
                });
              }
            } else if (isResponseCreatedChunk(value)) {
              responseId = value.response.id;
              controller.enqueue({
                type: "response-metadata",
                id: value.response.id,
                timestamp: new Date(value.response.created_at * 1e3),
                modelId: value.response.model
              });
            } else if (isTextDeltaChunk(value)) {
              controller.enqueue({
                type: "text-delta",
                id: value.item_id,
                delta: value.delta
              });
              if (((_t = (_s = options.providerOptions) == null ? void 0 : _s[providerOptionsName]) == null ? void 0 : _t.logprobs) && value.logprobs) {
                logprobs.push(value.logprobs);
              }
            } else if (value.type === "response.reasoning_summary_part.added") {
              if (value.summary_index > 0) {
                const activeReasoningPart = activeReasoning[value.item_id];
                activeReasoningPart.summaryParts[value.summary_index] = "active";
                for (const summaryIndex of Object.keys(
                  activeReasoningPart.summaryParts
                )) {
                  if (activeReasoningPart.summaryParts[summaryIndex] === "can-conclude") {
                    controller.enqueue({
                      type: "reasoning-end",
                      id: `${value.item_id}:${summaryIndex}`,
                      providerMetadata: {
                        [providerOptionsName]: {
                          itemId: value.item_id
                        }
                      }
                    });
                    activeReasoningPart.summaryParts[summaryIndex] = "concluded";
                  }
                }
                controller.enqueue({
                  type: "reasoning-start",
                  id: `${value.item_id}:${value.summary_index}`,
                  providerMetadata: {
                    [providerOptionsName]: {
                      itemId: value.item_id,
                      reasoningEncryptedContent: (_v = (_u = activeReasoning[value.item_id]) == null ? void 0 : _u.encryptedContent) != null ? _v : null
                    }
                  }
                });
              }
            } else if (value.type === "response.reasoning_summary_text.delta") {
              controller.enqueue({
                type: "reasoning-delta",
                id: `${value.item_id}:${value.summary_index}`,
                delta: value.delta,
                providerMetadata: {
                  [providerOptionsName]: {
                    itemId: value.item_id
                  }
                }
              });
            } else if (value.type === "response.reasoning_summary_part.done") {
              if (store) {
                controller.enqueue({
                  type: "reasoning-end",
                  id: `${value.item_id}:${value.summary_index}`,
                  providerMetadata: {
                    [providerOptionsName]: {
                      itemId: value.item_id
                    }
                  }
                });
                activeReasoning[value.item_id].summaryParts[value.summary_index] = "concluded";
              } else {
                activeReasoning[value.item_id].summaryParts[value.summary_index] = "can-conclude";
              }
            } else if (isResponseFinishedChunk(value)) {
              finishReason = {
                unified: mapOpenAIResponseFinishReason({
                  finishReason: (_w = value.response.incomplete_details) == null ? void 0 : _w.reason,
                  hasFunctionCall
                }),
                raw: (_y = (_x = value.response.incomplete_details) == null ? void 0 : _x.reason) != null ? _y : void 0
              };
              usage = value.response.usage;
              if (typeof value.response.service_tier === "string") {
                serviceTier = value.response.service_tier;
              }
              if (((_z = value.response.reasoning) == null ? void 0 : _z.context) != null) {
                reasoningContext = value.response.reasoning.context;
              }
            } else if (isResponseFailedChunk(value)) {
              const incompleteReason = (_A = value.response.incomplete_details) == null ? void 0 : _A.reason;
              finishReason = {
                unified: incompleteReason ? mapOpenAIResponseFinishReason({
                  finishReason: incompleteReason,
                  hasFunctionCall
                }) : "error",
                raw: incompleteReason != null ? incompleteReason : "error"
              };
              usage = (_B = value.response.usage) != null ? _B : void 0;
              if (((_C = value.response.reasoning) == null ? void 0 : _C.context) != null) {
                reasoningContext = value.response.reasoning.context;
              }
              if (!encounteredStreamError && value.response.error != null) {
                encounteredStreamError = true;
                controller.enqueue({
                  type: "error",
                  error: {
                    type: "response.failed",
                    sequence_number: value.sequence_number,
                    response: {
                      error: value.response.error,
                      incomplete_details: value.response.incomplete_details,
                      service_tier: value.response.service_tier
                    }
                  }
                });
              }
            } else if (isResponseAnnotationAddedChunk(value)) {
              ongoingAnnotations.push(value.annotation);
              if (value.annotation.type === "url_citation") {
                controller.enqueue({
                  type: "source",
                  sourceType: "url",
                  id: (_F = (_E = (_D = self.config).generateId) == null ? void 0 : _E.call(_D)) != null ? _F : generateId2(),
                  url: value.annotation.url,
                  title: value.annotation.title
                });
              } else if (value.annotation.type === "file_citation") {
                controller.enqueue({
                  type: "source",
                  sourceType: "document",
                  id: (_I = (_H = (_G = self.config).generateId) == null ? void 0 : _H.call(_G)) != null ? _I : generateId2(),
                  mediaType: "text/plain",
                  title: value.annotation.filename,
                  filename: value.annotation.filename,
                  providerMetadata: {
                    [providerOptionsName]: {
                      type: value.annotation.type,
                      fileId: value.annotation.file_id,
                      index: value.annotation.index
                    }
                  }
                });
              } else if (value.annotation.type === "container_file_citation") {
                controller.enqueue({
                  type: "source",
                  sourceType: "document",
                  id: (_L = (_K = (_J = self.config).generateId) == null ? void 0 : _K.call(_J)) != null ? _L : generateId2(),
                  mediaType: "text/plain",
                  title: value.annotation.filename,
                  filename: value.annotation.filename,
                  providerMetadata: {
                    [providerOptionsName]: {
                      type: value.annotation.type,
                      fileId: value.annotation.file_id,
                      containerId: value.annotation.container_id
                    }
                  }
                });
              } else if (value.annotation.type === "file_path") {
                controller.enqueue({
                  type: "source",
                  sourceType: "document",
                  id: (_O = (_N = (_M = self.config).generateId) == null ? void 0 : _N.call(_M)) != null ? _O : generateId2(),
                  mediaType: "application/octet-stream",
                  title: value.annotation.file_id,
                  filename: value.annotation.file_id,
                  providerMetadata: {
                    [providerOptionsName]: {
                      type: value.annotation.type,
                      fileId: value.annotation.file_id,
                      index: value.annotation.index
                    }
                  }
                });
              }
            } else if (isErrorChunk(value)) {
              encounteredStreamError = true;
              finishReason = { unified: "error", raw: "error" };
              controller.enqueue({ type: "error", error: value });
            }
          },
          flush(controller) {
            const providerMetadata = {
              [providerOptionsName]: {
                responseId,
                ...logprobs.length > 0 ? { logprobs } : {},
                ...serviceTier !== void 0 ? { serviceTier } : {},
                ...reasoningContext !== void 0 ? { reasoningContext } : {}
              }
            };
            controller.enqueue({
              type: "finish",
              finishReason,
              usage: convertOpenAIResponsesUsage(usage),
              providerMetadata
            });
          }
        })
      ),
      request: { body },
      response: { headers: responseHeaders }
    };
    return result;
  }
};
function isTextDeltaChunk(chunk) {
  return chunk.type === "response.output_text.delta";
}
function isOpenAIChatCompletionChunk(value) {
  const chunk = asRecord2(value);
  return chunk != null && Array.isArray(chunk.choices) && typeof chunk.type !== "string";
}
function createOpenAIResponsesChatCompletionsMismatchError({
  value,
  cause,
  url,
  requestBodyValues,
  responseHeaders
}) {
  return new APICallError2({
    message: "Received a Chat Completions stream while using the OpenAI Responses API. The default OpenAI provider model uses the Responses API. If your custom baseURL targets a Chat Completions-compatible endpoint, use openai.chat('model-id') or createOpenAI(...).chat('model-id') instead. You can also use @ai-sdk/openai-compatible for OpenAI-compatible providers.",
    url,
    requestBodyValues,
    responseHeaders,
    responseBody: JSON.stringify(value),
    cause,
    data: value,
    isRetryable: false
  });
}
function asRecord2(value) {
  return typeof value === "object" && value != null ? value : void 0;
}
function isResponseOutputItemDoneChunk(chunk) {
  return chunk.type === "response.output_item.done";
}
function isResponseFinishedChunk(chunk) {
  return chunk.type === "response.completed" || chunk.type === "response.incomplete";
}
function isResponseFailedChunk(chunk) {
  return chunk.type === "response.failed";
}
function isResponseCreatedChunk(chunk) {
  return chunk.type === "response.created";
}
function isResponseFunctionCallArgumentsDeltaChunk(chunk) {
  return chunk.type === "response.function_call_arguments.delta";
}
function isResponseCustomToolCallInputDeltaChunk(chunk) {
  return chunk.type === "response.custom_tool_call_input.delta";
}
function isResponseImageGenerationCallPartialImageChunk(chunk) {
  return chunk.type === "response.image_generation_call.partial_image";
}
function isResponseCodeInterpreterCallCodeDeltaChunk(chunk) {
  return chunk.type === "response.code_interpreter_call_code.delta";
}
function isResponseCodeInterpreterCallCodeDoneChunk(chunk) {
  return chunk.type === "response.code_interpreter_call_code.done";
}
function isResponseApplyPatchCallOperationDiffDeltaChunk(chunk) {
  return chunk.type === "response.apply_patch_call_operation_diff.delta";
}
function isResponseApplyPatchCallOperationDiffDoneChunk(chunk) {
  return chunk.type === "response.apply_patch_call_operation_diff.done";
}
function isResponseOutputItemAddedChunk(chunk) {
  return chunk.type === "response.output_item.added";
}
function isResponseAnnotationAddedChunk(chunk) {
  return chunk.type === "response.output_text.annotation.added";
}
function isErrorChunk(chunk) {
  return chunk.type === "error";
}
function isResponseOutputChunk(chunk) {
  return !(chunk.type === "response.created" || chunk.type === "response.failed" || chunk.type === "error" || chunk.type === "unknown_chunk");
}
function mapWebSearchOutput(action) {
  var _a;
  if (action == null) {
    return {};
  }
  switch (action.type) {
    case "search":
      return {
        action: {
          type: "search",
          query: (_a = action.query) != null ? _a : void 0,
          ...action.queries != null && { queries: action.queries }
        },
        // include sources when provided by the Responses API (behind include flag)
        ...action.sources != null && { sources: action.sources }
      };
    case "open_page":
      return { action: { type: "openPage", url: action.url } };
    case "find_in_page":
      return {
        action: {
          type: "findInPage",
          url: action.url,
          pattern: action.pattern
        }
      };
  }
}
function escapeJSONDelta(delta) {
  return JSON.stringify(delta).slice(1, -1);
}

// src/speech/openai-speech-model.ts
import {
  combineHeaders as combineHeaders7,
  createBinaryResponseHandler,
  parseProviderOptions as parseProviderOptions8,
  postJsonToApi as postJsonToApi6,
  serializeModelOptions as serializeModelOptions6,
  WORKFLOW_DESERIALIZE as WORKFLOW_DESERIALIZE6,
  WORKFLOW_SERIALIZE as WORKFLOW_SERIALIZE6
} from "@ai-sdk/provider-utils";

// src/speech/openai-speech-model-options.ts
import {
  lazySchema as lazySchema26,
  zodSchema as zodSchema26
} from "@ai-sdk/provider-utils";
import { z as z28 } from "zod/v4";
var openaiSpeechModelOptionsSchema = lazySchema26(
  () => zodSchema26(
    z28.object({
      instructions: z28.string().nullish(),
      speed: z28.number().min(0.25).max(4).default(1).nullish()
    })
  )
);

// src/speech/openai-speech-model.ts
var OpenAISpeechModel = class _OpenAISpeechModel {
  constructor(modelId, config) {
    this.modelId = modelId;
    this.config = config;
    this.specificationVersion = "v4";
  }
  static [WORKFLOW_SERIALIZE6](model) {
    return serializeModelOptions6({
      modelId: model.modelId,
      config: model.config
    });
  }
  static [WORKFLOW_DESERIALIZE6](options) {
    return new _OpenAISpeechModel(options.modelId, options.config);
  }
  get provider() {
    return this.config.provider;
  }
  async getArgs({
    text,
    voice = "alloy",
    outputFormat = "mp3",
    speed,
    instructions,
    language,
    providerOptions
  }) {
    const warnings = [];
    const openAIOptions = await parseProviderOptions8({
      provider: "openai",
      providerOptions,
      schema: openaiSpeechModelOptionsSchema
    });
    const requestBody = {
      model: this.modelId,
      input: text,
      voice,
      response_format: "mp3",
      speed,
      instructions
    };
    if (outputFormat) {
      if (["mp3", "opus", "aac", "flac", "wav", "pcm"].includes(outputFormat)) {
        requestBody.response_format = outputFormat;
      } else {
        warnings.push({
          type: "unsupported",
          feature: "outputFormat",
          details: `Unsupported output format: ${outputFormat}. Using mp3 instead.`
        });
      }
    }
    if (openAIOptions) {
      const speechModelOptions = {};
      for (const key in speechModelOptions) {
        const value = speechModelOptions[key];
        if (value !== void 0) {
          requestBody[key] = value;
        }
      }
    }
    if (language) {
      warnings.push({
        type: "unsupported",
        feature: "language",
        details: `OpenAI speech models do not support language selection. Language parameter "${language}" was ignored.`
      });
    }
    return {
      requestBody,
      warnings
    };
  }
  async doGenerate(options) {
    var _a, _b, _c, _d, _e;
    const currentDate = (_c = (_b = (_a = this.config._internal) == null ? void 0 : _a.currentDate) == null ? void 0 : _b.call(_a)) != null ? _c : /* @__PURE__ */ new Date();
    const { requestBody, warnings } = await this.getArgs(options);
    const {
      value: audio,
      responseHeaders,
      rawValue: rawResponse
    } = await postJsonToApi6({
      url: this.config.url({
        path: "/audio/speech",
        modelId: this.modelId
      }),
      headers: combineHeaders7((_e = (_d = this.config).headers) == null ? void 0 : _e.call(_d), options.headers),
      body: requestBody,
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createBinaryResponseHandler(),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch
    });
    return {
      audio,
      warnings,
      request: {
        body: JSON.stringify(requestBody)
      },
      response: {
        timestamp: currentDate,
        modelId: this.modelId,
        headers: responseHeaders,
        body: rawResponse
      }
    };
  }
};

// src/transcription/openai-transcription-model.ts
import {
  UnsupportedFunctionalityError as UnsupportedFunctionalityError6
} from "@ai-sdk/provider";
import {
  combineHeaders as combineHeaders8,
  convertBase64ToUint8Array as convertBase64ToUint8Array2,
  convertToBase64 as convertToBase643,
  createJsonResponseHandler as createJsonResponseHandler7,
  connectToWebSocket,
  mediaTypeToExtension,
  parseProviderOptions as parseProviderOptions9,
  postFormDataToApi as postFormDataToApi3,
  safeParseJSON,
  serializeModelOptions as serializeModelOptions7,
  toWebSocketUrl,
  WORKFLOW_DESERIALIZE as WORKFLOW_DESERIALIZE7,
  WORKFLOW_SERIALIZE as WORKFLOW_SERIALIZE7,
  waitForWebSocketBufferDrain
} from "@ai-sdk/provider-utils";

// src/transcription/openai-transcription-api.ts
import { lazySchema as lazySchema27, zodSchema as zodSchema27 } from "@ai-sdk/provider-utils";
import { z as z29 } from "zod/v4";
var openaiTranscriptionResponseSchema = lazySchema27(
  () => zodSchema27(
    z29.object({
      text: z29.string(),
      language: z29.string().nullish(),
      duration: z29.number().nullish(),
      words: z29.array(
        z29.object({
          word: z29.string(),
          start: z29.number(),
          end: z29.number()
        })
      ).nullish(),
      segments: z29.array(
        z29.object({
          id: z29.number(),
          seek: z29.number(),
          start: z29.number(),
          end: z29.number(),
          text: z29.string(),
          tokens: z29.array(z29.number()),
          temperature: z29.number(),
          avg_logprob: z29.number(),
          compression_ratio: z29.number(),
          no_speech_prob: z29.number()
        })
      ).nullish()
    })
  )
);

// src/transcription/openai-transcription-model-options.ts
import {
  lazySchema as lazySchema28,
  zodSchema as zodSchema28
} from "@ai-sdk/provider-utils";
import { z as z30 } from "zod/v4";
var openAITranscriptionModelOptions = lazySchema28(
  () => zodSchema28(
    z30.object({
      /**
       * Additional information to include in the transcription response.
       */
      include: z30.array(z30.string()).optional(),
      /**
       * The language of the input audio in ISO-639-1 format.
       */
      language: z30.string().optional(),
      /**
       * An optional text to guide the model's style or continue a previous audio segment.
       */
      prompt: z30.string().optional(),
      /**
       * The sampling temperature, between 0 and 1.
       * @default 0
       */
      temperature: z30.number().min(0).max(1).default(0).optional(),
      /**
       * The timestamp granularities to populate for this transcription.
       * @default ['segment']
       */
      timestampGranularities: z30.array(z30.enum(["word", "segment"])).default(["segment"]).optional(),
      /**
       * Options for streaming transcription models such as `gpt-realtime-whisper`.
       */
      streaming: z30.object({
        /**
         * Latency/accuracy tradeoff for realtime transcription.
         */
        delay: z30.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
        /**
         * Additional fields to include in realtime transcription events.
         */
        include: z30.array(z30.string()).optional()
      }).optional()
    })
  )
);

// src/transcription/openai-transcription-model.ts
function isRealtimeTranscriptionModelId(modelId) {
  return modelId === "gpt-realtime-whisper" || modelId.startsWith("gpt-realtime-whisper-");
}
var languageMap = {
  afrikaans: "af",
  arabic: "ar",
  armenian: "hy",
  azerbaijani: "az",
  belarusian: "be",
  bosnian: "bs",
  bulgarian: "bg",
  catalan: "ca",
  chinese: "zh",
  croatian: "hr",
  czech: "cs",
  danish: "da",
  dutch: "nl",
  english: "en",
  estonian: "et",
  finnish: "fi",
  french: "fr",
  galician: "gl",
  german: "de",
  greek: "el",
  hebrew: "he",
  hindi: "hi",
  hungarian: "hu",
  icelandic: "is",
  indonesian: "id",
  italian: "it",
  japanese: "ja",
  kannada: "kn",
  kazakh: "kk",
  korean: "ko",
  latvian: "lv",
  lithuanian: "lt",
  macedonian: "mk",
  malay: "ms",
  marathi: "mr",
  maori: "mi",
  nepali: "ne",
  norwegian: "no",
  persian: "fa",
  polish: "pl",
  portuguese: "pt",
  romanian: "ro",
  russian: "ru",
  serbian: "sr",
  slovak: "sk",
  slovenian: "sl",
  spanish: "es",
  swahili: "sw",
  swedish: "sv",
  tagalog: "tl",
  tamil: "ta",
  thai: "th",
  turkish: "tr",
  ukrainian: "uk",
  urdu: "ur",
  vietnamese: "vi",
  welsh: "cy"
};
var OpenAITranscriptionModel = class _OpenAITranscriptionModel {
  constructor(modelId, config) {
    this.modelId = modelId;
    this.config = config;
    this.specificationVersion = "v4";
  }
  static [WORKFLOW_SERIALIZE7](model) {
    return serializeModelOptions7({
      modelId: model.modelId,
      config: model.config
    });
  }
  static [WORKFLOW_DESERIALIZE7](options) {
    return new _OpenAITranscriptionModel(options.modelId, options.config);
  }
  get provider() {
    return this.config.provider;
  }
  async getArgs({
    audio,
    mediaType,
    providerOptions
  }) {
    const warnings = [];
    const openAIOptions = await parseProviderOptions9({
      provider: "openai",
      providerOptions,
      schema: openAITranscriptionModelOptions
    });
    const formData = new FormData();
    const blob = audio instanceof Uint8Array ? new Blob([audio]) : new Blob([convertBase64ToUint8Array2(audio)]);
    formData.append("model", this.modelId);
    const fileExtension = mediaTypeToExtension(mediaType);
    formData.append(
      "file",
      new File([blob], "audio", { type: mediaType }),
      `audio.${fileExtension}`
    );
    if (this.modelId === "whisper-1") {
      formData.append("response_format", "verbose_json");
    }
    if (openAIOptions) {
      const isGpt4oTranscribeModel = [
        "gpt-4o-transcribe",
        "gpt-4o-mini-transcribe"
      ].includes(this.modelId);
      const transcriptionModelOptions = {
        include: openAIOptions.include,
        language: openAIOptions.language,
        prompt: openAIOptions.prompt,
        // https://platform.openai.com/docs/api-reference/audio/createTranscription#audio_createtranscription-response_format
        // prefer verbose_json to get segments for models that support it
        ...this.modelId !== "whisper-1" && {
          response_format: isGpt4oTranscribeModel ? "json" : "verbose_json"
        },
        temperature: openAIOptions.temperature,
        timestamp_granularities: openAIOptions.timestampGranularities
      };
      for (const [key, value] of Object.entries(transcriptionModelOptions)) {
        if (value != null) {
          if (Array.isArray(value)) {
            for (const item of value) {
              formData.append(`${key}[]`, String(item));
            }
          } else {
            formData.append(key, String(value));
          }
        }
      }
    }
    return {
      formData,
      warnings
    };
  }
  async doGenerate(options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    if (isRealtimeTranscriptionModelId(this.modelId)) {
      throw new UnsupportedFunctionalityError6({
        functionality: `non-streaming transcription with ${this.modelId}`
      });
    }
    const currentDate = (_c = (_b = (_a = this.config._internal) == null ? void 0 : _a.currentDate) == null ? void 0 : _b.call(_a)) != null ? _c : /* @__PURE__ */ new Date();
    const { formData, warnings } = await this.getArgs(options);
    const {
      value: response,
      responseHeaders,
      rawValue: rawResponse
    } = await postFormDataToApi3({
      url: this.config.url({
        path: "/audio/transcriptions",
        modelId: this.modelId
      }),
      headers: combineHeaders8((_e = (_d = this.config).headers) == null ? void 0 : _e.call(_d), options.headers),
      formData,
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler7(
        openaiTranscriptionResponseSchema
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch
    });
    const language = response.language != null && response.language in languageMap ? languageMap[response.language] : void 0;
    return {
      text: response.text,
      segments: (_i = (_h = (_f = response.segments) == null ? void 0 : _f.map((segment) => ({
        text: segment.text,
        startSecond: segment.start,
        endSecond: segment.end
      }))) != null ? _h : (_g = response.words) == null ? void 0 : _g.map((word) => ({
        text: word.word,
        startSecond: word.start,
        endSecond: word.end
      }))) != null ? _i : [],
      language,
      durationInSeconds: (_j = response.duration) != null ? _j : void 0,
      warnings,
      response: {
        timestamp: currentDate,
        modelId: this.modelId,
        headers: responseHeaders,
        body: rawResponse
      }
    };
  }
  async doStream(options) {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!isRealtimeTranscriptionModelId(this.modelId)) {
      throw new UnsupportedFunctionalityError6({
        functionality: `streaming transcription with ${this.modelId}`
      });
    }
    const currentDate = (_c = (_b = (_a = this.config._internal) == null ? void 0 : _a.currentDate) == null ? void 0 : _b.call(_a)) != null ? _c : /* @__PURE__ */ new Date();
    const openAIOptions = await parseProviderOptions9({
      provider: "openai",
      providerOptions: options.providerOptions,
      schema: openAITranscriptionModelOptions
    });
    const warnings = [];
    const rawOpenAIOptions = (_e = (_d = options.providerOptions) == null ? void 0 : _d.openai) != null ? _e : {};
    for (const option of [
      "include",
      "prompt",
      "temperature",
      "timestampGranularities"
    ]) {
      if (rawOpenAIOptions[option] != null) {
        warnings.push({
          type: "unsupported",
          feature: `providerOptions.openai.${option}`,
          details: `OpenAI streaming transcription does not support ${option}.`
        });
      }
    }
    const headers = combineHeaders8((_g = (_f = this.config).headers) == null ? void 0 : _g.call(_f), options.headers);
    const sessionUpdate = buildOpenAIRealtimeTranscriptionSession({
      modelId: this.modelId,
      inputAudioFormat: options.inputAudioFormat,
      providerOptions: openAIOptions
    });
    return {
      request: { body: sessionUpdate },
      response: {
        timestamp: currentDate,
        modelId: this.modelId
      },
      stream: createOpenAIRealtimeTranscriptionStream({
        webSocket: this.config.webSocket,
        url: toWebSocketUrl(
          this.config.url({
            path: "/realtime?intent=transcription",
            modelId: this.modelId
          })
        ),
        headers,
        sessionUpdate,
        language: openAIOptions == null ? void 0 : openAIOptions.language,
        warnings,
        audio: options.audio,
        abortSignal: options.abortSignal,
        includeRawChunks: options.includeRawChunks
      })
    };
  }
};
function createOpenAIRealtimeTranscriptionStream({
  webSocket,
  url,
  headers,
  sessionUpdate,
  language,
  warnings,
  audio,
  abortSignal,
  includeRawChunks
}) {
  let finished = false;
  let cleanup = () => {
  };
  return new ReadableStream({
    start: (controller) => {
      const realtimeConnection = getOpenAIRealtimeConnection(headers);
      let audioReader;
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
      const finishWithError = (error) => {
        if (finished) return;
        finished = true;
        cleanup();
        controller.error(error);
      };
      const finish = (text, id) => {
        if (finished) return;
        finished = true;
        if (id != null) {
          controller.enqueue({ type: "transcript-final", id, text });
        }
        controller.enqueue({
          type: "finish",
          text,
          segments: [],
          language
        });
        controller.close();
        cleanup(1e3);
      };
      const sendAudio = async (socket) => {
        audioReader = audio.getReader();
        try {
          while (true) {
            const { done, value } = await audioReader.read();
            if (done || finished) break;
            socket.send(
              JSON.stringify({
                type: "input_audio_buffer.append",
                audio: convertToBase643(value)
              })
            );
            await waitForWebSocketBufferDrain(socket);
          }
        } finally {
          audioReader.releaseLock();
          audioReader = void 0;
        }
        if (!finished) {
          socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        }
      };
      connection = connectToWebSocket({
        url,
        protocols: realtimeConnection.protocols,
        headers: realtimeConnection.headers,
        webSocket,
        abortSignal,
        onAbort: finishWithError,
        onProcessingError: finishWithError,
        onOpen: (socket) => {
          controller.enqueue({ type: "stream-start", warnings });
          socket.send(JSON.stringify(sessionUpdate));
          void sendAudio(socket).catch(finishWithError);
        },
        onMessageText: async (text) => {
          var _a, _b, _c, _d;
          const parsed = await safeParseJSON({ text });
          if (!parsed.success) return;
          const raw = parsed.value;
          if (includeRawChunks) {
            controller.enqueue({ type: "raw", rawValue: raw });
          }
          switch (raw.type) {
            case "conversation.item.input_audio_transcription.delta": {
              controller.enqueue({
                type: "transcript-delta",
                id: raw.item_id,
                delta: (_a = raw.delta) != null ? _a : ""
              });
              break;
            }
            case "conversation.item.input_audio_transcription.completed": {
              finish((_b = raw.transcript) != null ? _b : "", raw.item_id);
              break;
            }
            case "error": {
              finishWithError(
                new Error((_d = (_c = raw.error) == null ? void 0 : _c.message) != null ? _d : "OpenAI realtime error")
              );
              break;
            }
          }
        },
        onSocketError: () => {
          finishWithError(new Error("OpenAI realtime transcription error"));
        },
        onClose: () => {
          if (finished) return;
          finished = true;
          cleanup();
          controller.close();
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
function buildOpenAIRealtimeTranscriptionSession({
  modelId,
  inputAudioFormat,
  providerOptions
}) {
  var _a, _b;
  return {
    type: "session.update",
    session: {
      type: "transcription",
      audio: {
        input: {
          format: {
            type: inputAudioFormat.type,
            ...inputAudioFormat.rate != null ? { rate: inputAudioFormat.rate } : {}
          },
          transcription: {
            model: modelId,
            ...(providerOptions == null ? void 0 : providerOptions.language) != null ? { language: providerOptions.language } : {},
            ...((_a = providerOptions == null ? void 0 : providerOptions.streaming) == null ? void 0 : _a.delay) != null ? { delay: providerOptions.streaming.delay } : {}
          },
          turn_detection: null
        }
      },
      ...((_b = providerOptions == null ? void 0 : providerOptions.streaming) == null ? void 0 : _b.include) != null ? { include: providerOptions.streaming.include } : {}
    }
  };
}
function getOpenAIRealtimeConnection(headers) {
  var _a;
  let authorization;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "authorization" && value != null) {
      authorization = value;
    }
  }
  const token = (_a = authorization == null ? void 0 : authorization.match(/^bearer\s+(.+)$/i)) == null ? void 0 : _a[1];
  if (token == null) {
    return { protocols: ["realtime"], headers };
  }
  return {
    protocols: ["realtime", `openai-insecure-api-key.${token}`],
    headers: Object.fromEntries(
      Object.entries(headers).filter(
        ([key]) => key.toLowerCase() !== "authorization"
      )
    )
  };
}

// src/skills/openai-skills.ts
import {
  combineHeaders as combineHeaders9,
  convertInlineFileDataToUint8Array as convertInlineFileDataToUint8Array2,
  createJsonResponseHandler as createJsonResponseHandler8,
  postFormDataToApi as postFormDataToApi4
} from "@ai-sdk/provider-utils";

// src/skills/openai-skills-api.ts
import { lazySchema as lazySchema29, zodSchema as zodSchema29 } from "@ai-sdk/provider-utils";
import { z as z31 } from "zod/v4";
var openaiSkillResponseSchema = lazySchema29(
  () => zodSchema29(
    z31.object({
      id: z31.string(),
      name: z31.string().nullish(),
      description: z31.string().nullish(),
      default_version: z31.string().nullish(),
      latest_version: z31.string().nullish(),
      created_at: z31.number(),
      updated_at: z31.number().nullish()
    })
  )
);
var openaiSkillVersionResponseSchema = lazySchema29(
  () => zodSchema29(
    z31.object({
      id: z31.string(),
      version: z31.string().nullish(),
      name: z31.string().nullish(),
      description: z31.string().nullish()
    })
  )
);

// src/skills/openai-skills.ts
var OpenAISkills = class {
  constructor(config) {
    this.config = config;
    this.specificationVersion = "v4";
  }
  get provider() {
    return this.config.provider;
  }
  async uploadSkill(params) {
    const warnings = [];
    if (params.displayTitle != null) {
      warnings.push({
        type: "unsupported",
        feature: "displayTitle"
      });
    }
    const formData = new FormData();
    for (const file of params.files) {
      const content = convertInlineFileDataToUint8Array2(file.data);
      formData.append("files[]", new Blob([content]), file.path);
    }
    const { value: response } = await postFormDataToApi4({
      url: this.config.url({ path: "/skills" }),
      headers: combineHeaders9(this.config.headers()),
      formData,
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler8(
        openaiSkillResponseSchema
      ),
      fetch: this.config.fetch
    });
    return {
      providerReference: { openai: response.id },
      ...response.name != null ? { name: response.name } : {},
      ...response.description != null ? { description: response.description } : {},
      ...response.latest_version != null ? { latestVersion: response.latest_version } : {},
      providerMetadata: {
        openai: {
          ...response.default_version != null ? { defaultVersion: response.default_version } : {},
          ...response.created_at != null ? { createdAt: response.created_at } : {},
          ...response.updated_at != null ? { updatedAt: response.updated_at } : {}
        }
      },
      warnings
    };
  }
};

// src/version.ts
var VERSION = true ? "4.0.20" : "0.0.0-test";

// src/openai-provider.ts
function createOpenAI(options = {}) {
  var _a, _b;
  const baseURL = (_a = withoutTrailingSlash(
    validateBaseURL(
      loadOptionalSetting({
        settingValue: options.baseURL,
        environmentVariableName: "OPENAI_BASE_URL"
      })
    )
  )) != null ? _a : "https://api.openai.com/v1";
  const providerName = (_b = options.name) != null ? _b : "openai";
  const getHeaders = () => withUserAgentSuffix(
    {
      Authorization: `Bearer ${loadApiKey({
        apiKey: options.apiKey,
        environmentVariableName: "OPENAI_API_KEY",
        description: "OpenAI"
      })}`,
      "OpenAI-Organization": options.organization,
      "OpenAI-Project": options.project,
      ...options.headers
    },
    `ai-sdk/openai/${VERSION}`
  );
  const createChatModel = (modelId) => new OpenAIChatLanguageModel(modelId, {
    provider: `${providerName}.chat`,
    url: ({ path }) => `${baseURL}${path}`,
    headers: getHeaders,
    fetch: options.fetch
  });
  const createCompletionModel = (modelId) => new OpenAICompletionLanguageModel(modelId, {
    provider: `${providerName}.completion`,
    url: ({ path }) => `${baseURL}${path}`,
    headers: getHeaders,
    fetch: options.fetch
  });
  const createEmbeddingModel = (modelId) => new OpenAIEmbeddingModel(modelId, {
    provider: `${providerName}.embedding`,
    url: ({ path }) => `${baseURL}${path}`,
    headers: getHeaders,
    fetch: options.fetch
  });
  const createImageModel = (modelId) => new OpenAIImageModel(modelId, {
    provider: `${providerName}.image`,
    url: ({ path }) => `${baseURL}${path}`,
    headers: getHeaders,
    fetch: options.fetch
  });
  const createTranscriptionModel = (modelId) => new OpenAITranscriptionModel(modelId, {
    provider: `${providerName}.transcription`,
    url: ({ path }) => `${baseURL}${path}`,
    headers: getHeaders,
    fetch: options.fetch,
    webSocket: options.webSocket
  });
  const createSpeechModel = (modelId) => new OpenAISpeechModel(modelId, {
    provider: `${providerName}.speech`,
    url: ({ path }) => `${baseURL}${path}`,
    headers: getHeaders,
    fetch: options.fetch
  });
  const createFiles = () => new OpenAIFiles({
    provider: `${providerName}.files`,
    baseURL,
    headers: getHeaders,
    fetch: options.fetch
  });
  const createSkills = () => new OpenAISkills({
    provider: `${providerName}.skills`,
    url: ({ path }) => `${baseURL}${path}`,
    headers: getHeaders,
    fetch: options.fetch
  });
  const createLanguageModel = (modelId) => {
    if (new.target) {
      throw new Error(
        "The OpenAI model function cannot be called with the new keyword."
      );
    }
    return createResponsesModel(modelId);
  };
  const createResponsesModel = (modelId) => {
    return new OpenAIResponsesLanguageModel(modelId, {
      provider: `${providerName}.responses`,
      url: ({ path }) => `${baseURL}${path}`,
      headers: getHeaders,
      fetch: options.fetch,
      // Soft-deprecated. TODO: remove in v8
      fileIdPrefixes: ["file-"]
    });
  };
  const createRealtimeModel = (modelId) => new OpenAIRealtimeModel(modelId, {
    provider: `${providerName}.realtime`,
    baseURL,
    headers: getHeaders,
    fetch: options.fetch
  });
  const experimentalRealtimeFactory = Object.assign(
    (modelId) => createRealtimeModel(modelId),
    {
      getToken: async (tokenOptions) => {
        const model = createRealtimeModel(tokenOptions.model);
        const secret = await model.doCreateClientSecret({
          sessionConfig: tokenOptions.sessionConfig,
          expiresAfterSeconds: tokenOptions.expiresAfterSeconds
        });
        return {
          token: secret.token,
          url: secret.url,
          expiresAt: secret.expiresAt
        };
      }
    }
  );
  const provider = function(modelId) {
    return createLanguageModel(modelId);
  };
  provider.specificationVersion = "v4";
  provider.languageModel = createLanguageModel;
  provider.chat = createChatModel;
  provider.completion = createCompletionModel;
  provider.responses = createResponsesModel;
  provider.embedding = createEmbeddingModel;
  provider.embeddingModel = createEmbeddingModel;
  provider.textEmbedding = createEmbeddingModel;
  provider.textEmbeddingModel = createEmbeddingModel;
  provider.image = createImageModel;
  provider.imageModel = createImageModel;
  provider.transcription = createTranscriptionModel;
  provider.transcriptionModel = createTranscriptionModel;
  provider.speech = createSpeechModel;
  provider.speechModel = createSpeechModel;
  provider.files = createFiles;
  provider.skills = createSkills;
  provider.experimental_realtime = experimentalRealtimeFactory;
  provider.tools = openaiTools;
  return provider;
}
var openai = createOpenAI();
export {
  OpenAIRealtimeModel as Experimental_OpenAIRealtimeModel,
  VERSION,
  createOpenAI,
  openai
};
//# sourceMappingURL=index.js.map