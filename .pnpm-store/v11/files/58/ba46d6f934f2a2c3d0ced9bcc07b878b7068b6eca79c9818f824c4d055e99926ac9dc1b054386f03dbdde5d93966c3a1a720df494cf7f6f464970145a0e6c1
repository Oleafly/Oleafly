// src/google-language-model.ts
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  generateId,
  isCustomReasoning,
  lazySchema as lazySchema3,
  mapReasoningToProviderBudget,
  mapReasoningToProviderEffort,
  parseProviderOptions,
  postJsonToApi,
  resolve,
  serializeModelOptions,
  WORKFLOW_SERIALIZE,
  WORKFLOW_DESERIALIZE,
  zodSchema as zodSchema3
} from "@ai-sdk/provider-utils";
import { z as z3 } from "zod/v4";

// src/convert-google-usage.ts
function convertGoogleUsage(usage) {
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
  const promptTokens = (_a = usage.promptTokenCount) != null ? _a : 0;
  const candidatesTokens = (_b = usage.candidatesTokenCount) != null ? _b : 0;
  const cachedContentTokens = (_c = usage.cachedContentTokenCount) != null ? _c : 0;
  const thoughtsTokens = (_d = usage.thoughtsTokenCount) != null ? _d : 0;
  return {
    inputTokens: {
      total: promptTokens,
      noCache: promptTokens - cachedContentTokens,
      cacheRead: cachedContentTokens,
      cacheWrite: void 0
    },
    outputTokens: {
      total: candidatesTokens + thoughtsTokens,
      text: candidatesTokens,
      reasoning: thoughtsTokens
    },
    raw: usage
  };
}

// src/convert-json-schema-to-openapi-schema.ts
function convertJSONSchemaToOpenAPISchema(jsonSchema, isRoot = true) {
  if (jsonSchema == null) {
    return void 0;
  }
  if (isEmptyObjectSchema(jsonSchema)) {
    if (isRoot) {
      return void 0;
    }
    if (typeof jsonSchema === "object" && jsonSchema.description) {
      return { type: "object", description: jsonSchema.description };
    }
    return { type: "object" };
  }
  if (typeof jsonSchema === "boolean") {
    return { type: "boolean", properties: {} };
  }
  const {
    type,
    description,
    required,
    properties,
    items,
    allOf,
    anyOf,
    oneOf,
    format,
    const: constValue,
    minLength,
    enum: enumValues
  } = jsonSchema;
  const result = {};
  if (description) result.description = description;
  if (required) result.required = required;
  if (format) result.format = format;
  if (constValue !== void 0) {
    result.enum = [constValue];
  }
  if (type) {
    if (Array.isArray(type)) {
      const hasNull = type.includes("null");
      const nonNullTypes = type.filter((t) => t !== "null");
      if (nonNullTypes.length === 0) {
        result.type = "null";
      } else {
        result.anyOf = nonNullTypes.map((t) => ({ type: t }));
        if (hasNull) {
          result.nullable = true;
        }
      }
    } else {
      result.type = type;
    }
  }
  if (enumValues !== void 0) {
    result.enum = enumValues;
  }
  if (properties != null) {
    result.properties = Object.entries(properties).reduce(
      (acc, [key, value]) => {
        acc[key] = convertJSONSchemaToOpenAPISchema(value, false);
        return acc;
      },
      {}
    );
  }
  if (items) {
    result.items = Array.isArray(items) ? items.map((item) => convertJSONSchemaToOpenAPISchema(item, false)) : convertJSONSchemaToOpenAPISchema(items, false);
  }
  if (allOf) {
    result.allOf = allOf.map(
      (item) => convertJSONSchemaToOpenAPISchema(item, false)
    );
  }
  if (anyOf) {
    if (anyOf.some(
      (schema) => typeof schema === "object" && (schema == null ? void 0 : schema.type) === "null"
    )) {
      const nonNullSchemas = anyOf.filter(
        (schema) => !(typeof schema === "object" && (schema == null ? void 0 : schema.type) === "null")
      );
      if (nonNullSchemas.length === 1) {
        const converted = convertJSONSchemaToOpenAPISchema(
          nonNullSchemas[0],
          false
        );
        if (typeof converted === "object") {
          result.nullable = true;
          Object.assign(result, converted);
        }
      } else {
        result.anyOf = nonNullSchemas.map(
          (item) => convertJSONSchemaToOpenAPISchema(item, false)
        );
        result.nullable = true;
      }
    } else {
      result.anyOf = anyOf.map(
        (item) => convertJSONSchemaToOpenAPISchema(item, false)
      );
    }
  }
  if (oneOf) {
    result.oneOf = oneOf.map(
      (item) => convertJSONSchemaToOpenAPISchema(item, false)
    );
  }
  if (minLength !== void 0) {
    result.minLength = minLength;
  }
  return result;
}
function isEmptyObjectSchema(jsonSchema) {
  return jsonSchema != null && typeof jsonSchema === "object" && jsonSchema.type === "object" && (jsonSchema.properties == null || Object.keys(jsonSchema.properties).length === 0) && !jsonSchema.additionalProperties;
}

// src/convert-to-google-messages.ts
import {
  UnsupportedFunctionalityError
} from "@ai-sdk/provider";
import {
  convertToBase64,
  getTopLevelMediaType,
  isFullMediaType,
  resolveFullMediaType,
  resolveProviderReference,
  secureJsonParse
} from "@ai-sdk/provider-utils";
var SKIP_THOUGHT_SIGNATURE_VALIDATOR = "skip_thought_signature_validator";
var dataUrlRegex = /^data:([^;,]+);base64,(.+)$/s;
function parseBase64DataUrl(value) {
  const match = dataUrlRegex.exec(value);
  if (match == null) {
    return void 0;
  }
  return {
    mediaType: match[1],
    data: match[2]
  };
}
function convertUrlToolResultPart(url) {
  const parsedDataUrl = parseBase64DataUrl(url);
  if (parsedDataUrl == null) {
    return void 0;
  }
  return {
    inlineData: {
      mimeType: parsedDataUrl.mediaType,
      data: parsedDataUrl.data
    }
  };
}
function appendToolResultParts(parts, toolName, outputValue, toolCallId, includeFunctionCallIds = true) {
  const functionResponseParts = [];
  const responseTextParts = [];
  for (const contentPart of outputValue) {
    switch (contentPart.type) {
      case "text": {
        responseTextParts.push(contentPart.text);
        break;
      }
      case "file": {
        if (contentPart.data.type === "data") {
          functionResponseParts.push({
            inlineData: {
              mimeType: resolveFullMediaType({ part: contentPart }),
              data: convertToBase64(contentPart.data.data)
            }
          });
        } else if (contentPart.data.type === "url") {
          const functionResponsePart = convertUrlToolResultPart(
            contentPart.data.url.toString()
          );
          if (functionResponsePart != null) {
            functionResponseParts.push(functionResponsePart);
          } else {
            responseTextParts.push(JSON.stringify(contentPart));
          }
        } else {
          responseTextParts.push(JSON.stringify(contentPart));
        }
        break;
      }
      default: {
        responseTextParts.push(JSON.stringify(contentPart));
        break;
      }
    }
  }
  parts.push({
    functionResponse: {
      ...includeFunctionCallIds && toolCallId != null ? { id: toolCallId } : {},
      name: toolName,
      response: {
        name: toolName,
        content: responseTextParts.length > 0 ? responseTextParts.join("\n") : "Tool executed successfully."
      },
      ...functionResponseParts.length > 0 ? { parts: functionResponseParts } : {}
    }
  });
}
function appendLegacyToolResultParts(parts, toolName, outputValue, toolCallId, includeFunctionCallIds = true) {
  for (const contentPart of outputValue) {
    switch (contentPart.type) {
      case "text":
        parts.push({
          functionResponse: {
            ...includeFunctionCallIds && toolCallId != null ? { id: toolCallId } : {},
            name: toolName,
            response: {
              name: toolName,
              content: contentPart.text
            }
          }
        });
        break;
      case "file": {
        if (contentPart.data.type === "data") {
          const topLevelMediaType = getTopLevelMediaType(contentPart.mediaType);
          parts.push(
            {
              inlineData: {
                mimeType: resolveFullMediaType({ part: contentPart }),
                data: convertToBase64(contentPart.data.data)
              }
            },
            {
              text: `Tool executed successfully and returned this ${topLevelMediaType === "image" ? "image" : "file"} as a response`
            }
          );
        } else {
          parts.push({ text: JSON.stringify(contentPart) });
        }
        break;
      }
      default:
        parts.push({ text: JSON.stringify(contentPart) });
        break;
    }
  }
}
function convertToGoogleMessages(prompt, options) {
  var _a, _b, _c, _d, _e, _f;
  const systemInstructionParts = [];
  const contents = [];
  let systemMessagesAllowed = true;
  const isGemmaModel = (_a = options == null ? void 0 : options.isGemmaModel) != null ? _a : false;
  const isGemini3Model = (_b = options == null ? void 0 : options.isGemini3Model) != null ? _b : false;
  const onWarning = options == null ? void 0 : options.onWarning;
  const providerOptionsNames = (_c = options == null ? void 0 : options.providerOptionsNames) != null ? _c : ["google"];
  const isVertexLike = !providerOptionsNames.includes("google");
  const supportsFunctionResponseParts = (_d = options == null ? void 0 : options.supportsFunctionResponseParts) != null ? _d : true;
  const includeFunctionCallIds = (_e = options == null ? void 0 : options.includeFunctionCallIds) != null ? _e : true;
  let sentinelInjected = false;
  const missingSignatureToolNames = [];
  const injectSkipSignature = (toolName) => {
    missingSignatureToolNames.push(toolName);
    sentinelInjected = true;
    return SKIP_THOUGHT_SIGNATURE_VALIDATOR;
  };
  const readProviderOpts = (part) => {
    var _a2, _b2, _c2, _d2, _e2;
    for (const name of providerOptionsNames) {
      const v = (_a2 = part.providerOptions) == null ? void 0 : _a2[name];
      if (v != null) return v;
    }
    if (isVertexLike) {
      return (_b2 = part.providerOptions) == null ? void 0 : _b2.google;
    }
    return (_e2 = (_c2 = part.providerOptions) == null ? void 0 : _c2.googleVertex) != null ? _e2 : (_d2 = part.providerOptions) == null ? void 0 : _d2.vertex;
  };
  for (const { role, content } of prompt) {
    switch (role) {
      case "system": {
        if (!systemMessagesAllowed) {
          throw new UnsupportedFunctionalityError({
            functionality: "system messages are only supported at the beginning of the conversation"
          });
        }
        systemInstructionParts.push({ text: content });
        break;
      }
      case "user": {
        systemMessagesAllowed = false;
        const parts = [];
        for (const part of content) {
          switch (part.type) {
            case "text": {
              parts.push({ text: part.text });
              break;
            }
            case "file": {
              switch (part.data.type) {
                case "url": {
                  parts.push({
                    fileData: {
                      mimeType: resolveFullMediaType({ part }),
                      fileUri: part.data.url.toString()
                    }
                  });
                  break;
                }
                case "reference": {
                  if (isVertexLike) {
                    throw new UnsupportedFunctionalityError({
                      functionality: "file parts with provider references"
                    });
                  }
                  parts.push({
                    fileData: {
                      mimeType: resolveFullMediaType({ part }),
                      fileUri: resolveProviderReference({
                        reference: part.data.reference,
                        provider: "google"
                      })
                    }
                  });
                  break;
                }
                case "text": {
                  parts.push({
                    inlineData: {
                      mimeType: isFullMediaType(part.mediaType) ? part.mediaType : "text/plain",
                      data: convertToBase64(
                        new TextEncoder().encode(part.data.text)
                      )
                    }
                  });
                  break;
                }
                case "data": {
                  parts.push({
                    inlineData: {
                      mimeType: resolveFullMediaType({ part }),
                      data: convertToBase64(part.data.data)
                    }
                  });
                  break;
                }
              }
              break;
            }
          }
        }
        contents.push({ role: "user", parts });
        break;
      }
      case "assistant": {
        systemMessagesAllowed = false;
        let modelResponseHasSignedFunctionCall = false;
        contents.push({
          role: "model",
          parts: content.map((part) => {
            const providerOpts = readProviderOpts(part);
            const thoughtSignature = (providerOpts == null ? void 0 : providerOpts.thoughtSignature) != null ? String(providerOpts.thoughtSignature) : void 0;
            switch (part.type) {
              case "text": {
                return part.text.length === 0 ? void 0 : {
                  text: part.text,
                  thoughtSignature
                };
              }
              case "reasoning": {
                return part.text.length === 0 ? void 0 : {
                  text: part.text,
                  thought: true,
                  thoughtSignature
                };
              }
              case "reasoning-file": {
                switch (part.data.type) {
                  case "url": {
                    throw new UnsupportedFunctionalityError({
                      functionality: "File data URLs in assistant messages are not supported"
                    });
                  }
                  case "data": {
                    return {
                      inlineData: {
                        mimeType: part.mediaType,
                        data: convertToBase64(part.data.data)
                      },
                      thought: true,
                      thoughtSignature
                    };
                  }
                }
                break;
              }
              case "file": {
                switch (part.data.type) {
                  case "url": {
                    throw new UnsupportedFunctionalityError({
                      functionality: "File data URLs in assistant messages are not supported"
                    });
                  }
                  case "reference": {
                    if (isVertexLike) {
                      throw new UnsupportedFunctionalityError({
                        functionality: "file parts with provider references"
                      });
                    }
                    return {
                      fileData: {
                        mimeType: part.mediaType,
                        fileUri: resolveProviderReference({
                          reference: part.data.reference,
                          provider: "google"
                        })
                      },
                      ...(providerOpts == null ? void 0 : providerOpts.thought) === true ? { thought: true } : {},
                      thoughtSignature
                    };
                  }
                  case "text": {
                    return {
                      inlineData: {
                        mimeType: isFullMediaType(part.mediaType) ? part.mediaType : "text/plain",
                        data: convertToBase64(
                          new TextEncoder().encode(part.data.text)
                        )
                      },
                      ...(providerOpts == null ? void 0 : providerOpts.thought) === true ? { thought: true } : {},
                      thoughtSignature
                    };
                  }
                  case "data": {
                    return {
                      inlineData: {
                        mimeType: part.mediaType,
                        data: convertToBase64(part.data.data)
                      },
                      ...(providerOpts == null ? void 0 : providerOpts.thought) === true ? { thought: true } : {},
                      thoughtSignature
                    };
                  }
                }
                break;
              }
              case "tool-call": {
                const serverToolCallId = (providerOpts == null ? void 0 : providerOpts.serverToolCallId) != null ? String(providerOpts.serverToolCallId) : void 0;
                const serverToolType = (providerOpts == null ? void 0 : providerOpts.serverToolType) != null ? String(providerOpts.serverToolType) : void 0;
                const isServerToolCall = serverToolCallId != null && serverToolType != null;
                const shouldSkipMissingSignatureMitigation = (
                  // Gemini 3 returns a single signature for a parallel
                  // function-call response on the first standard function
                  // call. Subsequent standard function calls in the same
                  // model response legitimately have no signature.
                  !isServerToolCall && thoughtSignature == null && modelResponseHasSignedFunctionCall
                );
                const effectiveThoughtSignature = thoughtSignature != null ? thoughtSignature : isGemini3Model && !shouldSkipMissingSignatureMitigation ? injectSkipSignature(part.toolName) : void 0;
                if (!isServerToolCall && thoughtSignature != null) {
                  modelResponseHasSignedFunctionCall = true;
                }
                if (isServerToolCall) {
                  return {
                    toolCall: {
                      toolType: serverToolType,
                      args: typeof part.input === "string" ? secureJsonParse(part.input) : part.input,
                      id: serverToolCallId
                    },
                    thoughtSignature: effectiveThoughtSignature
                  };
                }
                return {
                  functionCall: {
                    ...includeFunctionCallIds && part.toolCallId != null ? { id: part.toolCallId } : {},
                    name: part.toolName,
                    args: part.input
                  },
                  thoughtSignature: effectiveThoughtSignature
                };
              }
              case "tool-result": {
                const serverToolCallId = (providerOpts == null ? void 0 : providerOpts.serverToolCallId) != null ? String(providerOpts.serverToolCallId) : void 0;
                const serverToolType = (providerOpts == null ? void 0 : providerOpts.serverToolType) != null ? String(providerOpts.serverToolType) : void 0;
                if (serverToolCallId && serverToolType) {
                  return {
                    toolResponse: {
                      toolType: serverToolType,
                      response: part.output.type === "json" ? part.output.value : {},
                      id: serverToolCallId
                    },
                    thoughtSignature
                  };
                }
                return void 0;
              }
            }
          }).filter((part) => part !== void 0)
        });
        break;
      }
      case "tool": {
        systemMessagesAllowed = false;
        const parts = [];
        for (const part of content) {
          if (part.type === "tool-approval-response") {
            continue;
          }
          const partProviderOpts = readProviderOpts(part);
          const serverToolCallId = (partProviderOpts == null ? void 0 : partProviderOpts.serverToolCallId) != null ? String(partProviderOpts.serverToolCallId) : void 0;
          const serverToolType = (partProviderOpts == null ? void 0 : partProviderOpts.serverToolType) != null ? String(partProviderOpts.serverToolType) : void 0;
          if (serverToolCallId && serverToolType) {
            const serverThoughtSignature = (partProviderOpts == null ? void 0 : partProviderOpts.thoughtSignature) != null ? String(partProviderOpts.thoughtSignature) : void 0;
            if (contents.length > 0) {
              const lastContent = contents[contents.length - 1];
              if (lastContent.role === "model") {
                lastContent.parts.push({
                  toolResponse: {
                    toolType: serverToolType,
                    response: part.output.type === "json" ? part.output.value : {},
                    id: serverToolCallId
                  },
                  thoughtSignature: serverThoughtSignature
                });
                continue;
              }
            }
          }
          const output = part.output;
          if (output.type === "content") {
            if (supportsFunctionResponseParts) {
              appendToolResultParts(
                parts,
                part.toolName,
                output.value,
                part.toolCallId,
                includeFunctionCallIds
              );
            } else {
              appendLegacyToolResultParts(
                parts,
                part.toolName,
                output.value,
                part.toolCallId,
                includeFunctionCallIds
              );
            }
          } else {
            parts.push({
              functionResponse: {
                ...includeFunctionCallIds && part.toolCallId != null ? { id: part.toolCallId } : {},
                name: part.toolName,
                response: {
                  name: part.toolName,
                  content: output.type === "execution-denied" ? (_f = output.reason) != null ? _f : "Tool call execution denied." : output.value
                }
              }
            });
          }
        }
        contents.push({
          role: "user",
          parts
        });
        break;
      }
    }
  }
  if (isGemmaModel && systemInstructionParts.length > 0 && contents.length > 0 && contents[0].role === "user") {
    const systemText = systemInstructionParts.map((part) => part.text).join("\n\n");
    contents[0].parts.unshift({ text: systemText + "\n\n" });
  }
  if (sentinelInjected && onWarning != null) {
    const uniqueToolNames = Array.from(new Set(missingSignatureToolNames));
    onWarning({
      type: "other",
      message: `Replayed ${missingSignatureToolNames.length} \`functionCall\` part(s) for a Gemini 3 model without a \`thoughtSignature\` (tools: ${uniqueToolNames.map((name) => `\`${name}\``).join(", ")}). Injected the documented \`skip_thought_signature_validator\` sentinel to keep the request from failing with HTTP 400. The likely cause is application code that drops \`providerOptions.google.thoughtSignature\` when persisting or serializing assistant tool-call messages. See https://ai.google.dev/gemini-api/docs/thought-signatures.`
    });
  }
  return {
    systemInstruction: systemInstructionParts.length > 0 && !isGemmaModel ? { parts: systemInstructionParts } : void 0,
    contents
  };
}

// src/get-model-path.ts
function getModelPath(modelId) {
  return modelId.includes("/") ? modelId : `models/${modelId}`;
}

// src/google-error.ts
import {
  createJsonErrorResponseHandler,
  lazySchema,
  zodSchema
} from "@ai-sdk/provider-utils";
import { z } from "zod/v4";
var googleErrorDataSchema = lazySchema(
  () => zodSchema(
    z.object({
      error: z.object({
        code: z.number().nullable(),
        message: z.string(),
        status: z.string()
      })
    })
  )
);
var googleFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: googleErrorDataSchema,
  errorToMessage: (data) => data.error.message
});

// src/google-language-model-options.ts
import {
  lazySchema as lazySchema2,
  zodSchema as zodSchema2
} from "@ai-sdk/provider-utils";
import { z as z2 } from "zod/v4";
var googleLanguageModelOptions = lazySchema2(
  () => zodSchema2(
    z2.object({
      responseModalities: z2.array(z2.enum(["TEXT", "IMAGE"])).optional(),
      thinkingConfig: z2.object({
        thinkingBudget: z2.number().optional(),
        includeThoughts: z2.boolean().optional(),
        // https://ai.google.dev/gemini-api/docs/gemini-3?thinking=high#thinking_level
        thinkingLevel: z2.enum(["minimal", "low", "medium", "high"]).optional()
      }).optional(),
      /**
       * Optional.
       * The name of the cached content used as context to serve the prediction.
       * Format: cachedContents/{cachedContent}
       */
      cachedContent: z2.string().optional(),
      /**
       * Optional. Enable structured output. Default is true.
       *
       * This is useful when the JSON Schema contains elements that are
       * not supported by the OpenAPI schema version that
       * Google uses. You can use this to disable
       * structured outputs if you need to.
       */
      structuredOutputs: z2.boolean().optional(),
      /**
       * Optional. A list of unique safety settings for blocking unsafe content.
       */
      safetySettings: z2.array(
        z2.object({
          category: z2.enum([
            "HARM_CATEGORY_UNSPECIFIED",
            "HARM_CATEGORY_HATE_SPEECH",
            "HARM_CATEGORY_DANGEROUS_CONTENT",
            "HARM_CATEGORY_HARASSMENT",
            "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            "HARM_CATEGORY_CIVIC_INTEGRITY"
          ]),
          threshold: z2.enum([
            "HARM_BLOCK_THRESHOLD_UNSPECIFIED",
            "BLOCK_LOW_AND_ABOVE",
            "BLOCK_MEDIUM_AND_ABOVE",
            "BLOCK_ONLY_HIGH",
            "BLOCK_NONE",
            "OFF"
          ])
        })
      ).optional(),
      threshold: z2.enum([
        "HARM_BLOCK_THRESHOLD_UNSPECIFIED",
        "BLOCK_LOW_AND_ABOVE",
        "BLOCK_MEDIUM_AND_ABOVE",
        "BLOCK_ONLY_HIGH",
        "BLOCK_NONE",
        "OFF"
      ]).optional(),
      /**
       * Optional. Enables timestamp understanding for audio-only files.
       *
       * https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/audio-understanding
       */
      audioTimestamp: z2.boolean().optional(),
      /**
       * Optional. Defines labels used in billing reports. Available on Vertex AI only.
       *
       * https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/add-labels-to-api-calls
       */
      labels: z2.record(z2.string(), z2.string()).optional(),
      /**
       * Optional. If specified, the media resolution specified will be used.
       *
       * https://ai.google.dev/api/generate-content#MediaResolution
       */
      mediaResolution: z2.enum([
        "MEDIA_RESOLUTION_UNSPECIFIED",
        "MEDIA_RESOLUTION_LOW",
        "MEDIA_RESOLUTION_MEDIUM",
        "MEDIA_RESOLUTION_HIGH"
      ]).optional(),
      /**
       * Optional. Configures the image generation aspect ratio for Gemini models.
       *
       * https://ai.google.dev/gemini-api/docs/image-generation#aspect_ratios
       */
      imageConfig: z2.object({
        aspectRatio: z2.enum([
          "1:1",
          "2:3",
          "3:2",
          "3:4",
          "4:3",
          "4:5",
          "5:4",
          "9:16",
          "16:9",
          "21:9",
          "1:8",
          "8:1",
          "1:4",
          "4:1"
        ]).optional(),
        imageSize: z2.enum(["1K", "2K", "4K", "512"]).optional(),
        /**
         * Optional. Controls the generation of people in images.
         * Vertex AI only.
         */
        personGeneration: z2.enum([
          "PERSON_GENERATION_UNSPECIFIED",
          "ALLOW_ALL",
          "ALLOW_ADULT",
          "ALLOW_NONE"
        ]).optional(),
        /**
         * Optional. Controls whether generation of prominent people
         * (celebrities) is allowed. When set together with
         * `personGeneration`, `personGeneration` takes precedence.
         * Vertex AI only.
         *
         * https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/GenerationConfig
         */
        prominentPeople: z2.enum([
          "PROMINENT_PEOPLE_UNSPECIFIED",
          "ALLOW_PROMINENT_PEOPLE",
          "BLOCK_PROMINENT_PEOPLE"
        ]).optional(),
        /**
         * Optional. The image output format for generated images.
         * Vertex AI only.
         */
        imageOutputOptions: z2.object({
          mimeType: z2.enum(["image/jpeg", "image/png"]).optional(),
          compressionQuality: z2.number().optional()
        }).optional()
      }).optional(),
      /**
       * Optional. Configuration for grounding retrieval.
       * Used to provide location context for Google Maps and Google Search grounding.
       *
       * https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-maps
       */
      retrievalConfig: z2.object({
        latLng: z2.object({
          latitude: z2.number(),
          longitude: z2.number()
        }).optional()
      }).optional(),
      /**
       * Optional. When set to true, function call arguments will be streamed
       * incrementally via partialArgs in streaming responses. Only supported
       * on the Vertex AI API (not the Gemini API) and only for Gemini 3+
       * models.
       *
       * @default false
       *
       * https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling#streaming-fc
       */
      streamFunctionCallArguments: z2.boolean().optional(),
      /**
       * Optional. The service tier to use for the request. Sent as the
       * `serviceTier` body field. Gemini API only.
       */
      serviceTier: z2.enum(["standard", "flex", "priority"]).optional(),
      /**
       * Optional. Vertex AI only. Sent as the
       * `X-Vertex-AI-LLM-Shared-Request-Type` request header to select a
       * shared (PayGo) tier. With Provisioned Throughput allocated and
       * `requestType` unset, the request falls back to this tier only if
       * PT capacity is exhausted.
       *
       * https://docs.cloud.google.com/vertex-ai/generative-ai/docs/priority-paygo
       * https://docs.cloud.google.com/vertex-ai/generative-ai/docs/flex-paygo
       */
      sharedRequestType: z2.enum(["priority", "flex", "standard"]).optional(),
      /**
       * Optional. Vertex AI only. Sent as the `X-Vertex-AI-LLM-Request-Type`
       * request header. Set to `'shared'` together with `sharedRequestType`
       * to bypass Provisioned Throughput entirely.
       *
       * https://docs.cloud.google.com/vertex-ai/generative-ai/docs/priority-paygo
       */
      requestType: z2.enum(["shared"]).optional()
    })
  )
);

// src/google-model-capabilities.ts
var gemini1ModelPattern = /(^|\/)gemini-1(?:[.-]|$)/i;
var gemini2ModelPattern = /(^|\/)gemini-2(?:[.-]|$)/i;
var gemini25ModelPattern = /(^|\/)gemini-2\.5(?:[.-]|$)/i;
var geminiModelPattern = /(^|\/)gemini-/i;
function isKnownPreGemini2Model(modelId) {
  return gemini1ModelPattern.test(modelId) || /(^|\/)gemini-pro(?:-vision)?$/i.test(modelId) || /(^|\/)gemini-robotics-er-1\.5(?:[.-]|$)/i.test(modelId);
}
function getGoogleModelCapabilities(modelId) {
  const isGeminiModel = geminiModelPattern.test(modelId);
  const isGemini2Model = gemini2ModelPattern.test(modelId);
  const isKnownPreGemini2 = isKnownPreGemini2Model(modelId);
  const isKnownOlderModel = isKnownPreGemini2 || isGemini2Model;
  const usesGemini3Features = isGeminiModel && !isKnownOlderModel;
  return {
    supportsGemini2Tools: isGeminiModel && !isKnownPreGemini2 || modelId.toLowerCase().includes("nano-banana"),
    supportsFileSearch: gemini25ModelPattern.test(modelId) || usesGemini3Features,
    usesGemini3Features
  };
}

// src/google-prepare-tools.ts
import {
  UnsupportedFunctionalityError as UnsupportedFunctionalityError2
} from "@ai-sdk/provider";
function prepareTools({
  tools,
  toolChoice,
  modelId,
  isVertexProvider = false
}) {
  var _a, _b;
  tools = (tools == null ? void 0 : tools.length) ? tools : void 0;
  const toolWarnings = [];
  const { supportsGemini2Tools, supportsFileSearch, usesGemini3Features } = getGoogleModelCapabilities(modelId);
  if (tools == null) {
    return { tools: void 0, toolConfig: void 0, toolWarnings };
  }
  const hasFunctionTools = tools.some((tool) => tool.type === "function");
  const hasProviderTools = tools.some((tool) => tool.type === "provider");
  if (hasFunctionTools && hasProviderTools && !usesGemini3Features) {
    toolWarnings.push({
      type: "unsupported",
      feature: `combination of function and provider-defined tools`
    });
  }
  if (hasProviderTools) {
    const googleTools2 = [];
    const ProviderTools = tools.filter((tool) => tool.type === "provider");
    ProviderTools.forEach((tool) => {
      switch (tool.id) {
        case "google.google_search":
          if (supportsGemini2Tools) {
            googleTools2.push({ googleSearch: { ...tool.args } });
          } else {
            toolWarnings.push({
              type: "unsupported",
              feature: `provider-defined tool ${tool.id}`,
              details: "Google Search requires Gemini 2.0 or newer."
            });
          }
          break;
        case "google.enterprise_web_search":
          if (supportsGemini2Tools) {
            googleTools2.push({ enterpriseWebSearch: {} });
          } else {
            toolWarnings.push({
              type: "unsupported",
              feature: `provider-defined tool ${tool.id}`,
              details: "Enterprise Web Search requires Gemini 2.0 or newer."
            });
          }
          break;
        case "google.url_context":
          if (supportsGemini2Tools) {
            googleTools2.push({ urlContext: {} });
          } else {
            toolWarnings.push({
              type: "unsupported",
              feature: `provider-defined tool ${tool.id}`,
              details: "The URL context tool is not supported with other Gemini models than Gemini 2."
            });
          }
          break;
        case "google.code_execution":
          if (supportsGemini2Tools) {
            googleTools2.push({ codeExecution: {} });
          } else {
            toolWarnings.push({
              type: "unsupported",
              feature: `provider-defined tool ${tool.id}`,
              details: "The code execution tool is not supported with other Gemini models than Gemini 2."
            });
          }
          break;
        case "google.file_search":
          if (supportsFileSearch) {
            googleTools2.push({ fileSearch: { ...tool.args } });
          } else {
            toolWarnings.push({
              type: "unsupported",
              feature: `provider-defined tool ${tool.id}`,
              details: "The file search tool is only supported with Gemini 2.5 models and Gemini 3 models."
            });
          }
          break;
        case "google.vertex_rag_store":
          if (supportsGemini2Tools) {
            googleTools2.push({
              retrieval: {
                vertex_rag_store: {
                  rag_resources: {
                    rag_corpus: tool.args.ragCorpus
                  },
                  similarity_top_k: tool.args.topK
                }
              }
            });
          } else {
            toolWarnings.push({
              type: "unsupported",
              feature: `provider-defined tool ${tool.id}`,
              details: "The RAG store tool is not supported with other Gemini models than Gemini 2."
            });
          }
          break;
        case "google.google_maps":
          if (supportsGemini2Tools) {
            googleTools2.push({ googleMaps: {} });
          } else {
            toolWarnings.push({
              type: "unsupported",
              feature: `provider-defined tool ${tool.id}`,
              details: "The Google Maps grounding tool is not supported with Gemini models other than Gemini 2 or newer."
            });
          }
          break;
        default:
          toolWarnings.push({
            type: "unsupported",
            feature: `provider-defined tool ${tool.id}`
          });
          break;
      }
    });
    if (hasFunctionTools && usesGemini3Features && googleTools2.length > 0) {
      const functionDeclarations2 = [];
      for (const tool of tools) {
        if (tool.type === "function") {
          functionDeclarations2.push({
            name: tool.name,
            description: (_a = tool.description) != null ? _a : "",
            parameters: convertJSONSchemaToOpenAPISchema(tool.inputSchema)
          });
        }
      }
      const combinedToolConfig = {
        functionCallingConfig: { mode: "VALIDATED" },
        ...!isVertexProvider && {
          includeServerSideToolInvocations: true
        }
      };
      if (toolChoice != null) {
        switch (toolChoice.type) {
          case "auto":
            break;
          case "none":
            combinedToolConfig.functionCallingConfig = { mode: "NONE" };
            break;
          case "required":
            combinedToolConfig.functionCallingConfig = { mode: "ANY" };
            break;
          case "tool":
            combinedToolConfig.functionCallingConfig = {
              mode: "ANY",
              allowedFunctionNames: [toolChoice.toolName]
            };
            break;
        }
      }
      return {
        tools: [...googleTools2, { functionDeclarations: functionDeclarations2 }],
        toolConfig: combinedToolConfig,
        toolWarnings
      };
    }
    return {
      tools: googleTools2.length > 0 ? googleTools2 : void 0,
      toolConfig: void 0,
      toolWarnings
    };
  }
  const functionDeclarations = [];
  let hasStrictTools = false;
  for (const tool of tools) {
    switch (tool.type) {
      case "function":
        functionDeclarations.push({
          name: tool.name,
          description: (_b = tool.description) != null ? _b : "",
          parameters: convertJSONSchemaToOpenAPISchema(tool.inputSchema)
        });
        if (tool.strict === true) {
          hasStrictTools = true;
        }
        break;
      default:
        toolWarnings.push({
          type: "unsupported",
          feature: `function tool ${tool.name}`
        });
        break;
    }
  }
  if (toolChoice == null) {
    return {
      tools: [{ functionDeclarations }],
      toolConfig: hasStrictTools ? { functionCallingConfig: { mode: "VALIDATED" } } : void 0,
      toolWarnings
    };
  }
  const type = toolChoice.type;
  switch (type) {
    case "auto":
      return {
        tools: [{ functionDeclarations }],
        toolConfig: {
          functionCallingConfig: {
            mode: hasStrictTools ? "VALIDATED" : "AUTO"
          }
        },
        toolWarnings
      };
    case "none":
      return {
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: "NONE" } },
        toolWarnings
      };
    case "required":
      return {
        tools: [{ functionDeclarations }],
        toolConfig: {
          functionCallingConfig: {
            mode: hasStrictTools ? "VALIDATED" : "ANY"
          }
        },
        toolWarnings
      };
    case "tool":
      return {
        tools: [{ functionDeclarations }],
        toolConfig: {
          functionCallingConfig: {
            mode: hasStrictTools ? "VALIDATED" : "ANY",
            allowedFunctionNames: [toolChoice.toolName]
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

// src/google-json-accumulator.ts
var GoogleJSONAccumulator = class {
  constructor() {
    this.accumulatedArgs = {};
    this.jsonText = "";
    /**
     * Stack representing the currently "open" containers in the JSON output.
     * Entry 0 is always the root `{` object once the first value is written.
     */
    this.pathStack = [];
    /**
     * Whether a string value is currently "open" (willContinue was true),
     * meaning the closing quote has not yet been emitted.
     */
    this.stringOpen = false;
  }
  /**
   * Input: [{jsonPath:"$.brightness",numberValue:50}]
   * Output: { currentJSON:{brightness:50}, textDelta:'{"brightness":50' }
   */
  processPartialArgs(partialArgs) {
    let delta = "";
    for (const arg of partialArgs) {
      const rawPath = arg.jsonPath.replace(/^\$\./, "");
      if (!rawPath) continue;
      const segments = parsePath(rawPath);
      const existingValue = getNestedValue(this.accumulatedArgs, segments);
      const isStringContinuation = arg.stringValue != null && existingValue !== void 0;
      if (isStringContinuation) {
        const escaped = JSON.stringify(arg.stringValue).slice(1, -1);
        setNestedValue(
          this.accumulatedArgs,
          segments,
          existingValue + arg.stringValue
        );
        delta += escaped;
        continue;
      }
      const resolved = resolvePartialArgValue(arg);
      if (resolved == null) continue;
      setNestedValue(this.accumulatedArgs, segments, resolved.value);
      delta += this.emitNavigationTo(segments, arg, resolved.json);
    }
    this.jsonText += delta;
    return {
      currentJSON: this.accumulatedArgs,
      textDelta: delta
    };
  }
  /**
   * Input: jsonText='{"brightness":50', accumulatedArgs={brightness:50}
   * Output: { finalJSON:'{"brightness":50}', closingDelta:'}' }
   */
  finalize() {
    const finalArgs = JSON.stringify(this.accumulatedArgs);
    const closingDelta = finalArgs.slice(this.jsonText.length);
    return { finalJSON: finalArgs, closingDelta };
  }
  /**
   * Input: pathStack=[] (first call) or pathStack=[root,...] (subsequent calls)
   * Output: '{' (first call) or '' (subsequent calls)
   */
  ensureRoot() {
    if (this.pathStack.length === 0) {
      this.pathStack.push({ segment: "", isArray: false, childCount: 0 });
      return "{";
    }
    return "";
  }
  /**
   * Emits the JSON text fragment needed to navigate from the current open
   * path to the new leaf at `targetSegments`, then writes the value.
   *
   * Input: targetSegments=["recipe","name"], arg={jsonPath:"$.recipe.name",stringValue:"Lasagna"}, valueJson='"Lasagna"'
   * Output: '{"recipe":{"name":"Lasagna"'
   */
  emitNavigationTo(targetSegments, arg, valueJson) {
    let fragment = "";
    if (this.stringOpen) {
      fragment += '"';
      this.stringOpen = false;
    }
    fragment += this.ensureRoot();
    const targetContainerSegments = targetSegments.slice(0, -1);
    const leafSegment = targetSegments[targetSegments.length - 1];
    const commonDepth = this.findCommonStackDepth(targetContainerSegments);
    fragment += this.closeDownTo(commonDepth);
    fragment += this.openDownTo(targetContainerSegments, leafSegment);
    fragment += this.emitLeaf(leafSegment, arg, valueJson);
    return fragment;
  }
  /**
   * Returns the stack depth to preserve when navigating to a new target
   * container path. Always >= 1 (the root is never popped).
   *
   * Input: stack=[root,"recipe","ingredients",0], target=["recipe","ingredients",1]
   * Output: 3 (keep root+"recipe"+"ingredients")
   */
  findCommonStackDepth(targetContainer) {
    const maxDepth = Math.min(
      this.pathStack.length - 1,
      targetContainer.length
    );
    let common = 0;
    for (let i = 0; i < maxDepth; i++) {
      if (this.pathStack[i + 1].segment === targetContainer[i]) {
        common++;
      } else {
        break;
      }
    }
    return common + 1;
  }
  /**
   * Closes containers from the current stack depth back down to `targetDepth`.
   *
   * Input: this.pathStack=[root,"recipe","ingredients",0], targetDepth=3
   * Output: '}'
   */
  closeDownTo(targetDepth) {
    let fragment = "";
    while (this.pathStack.length > targetDepth) {
      const entry = this.pathStack.pop();
      fragment += entry.isArray ? "]" : "}";
    }
    return fragment;
  }
  /**
   * Opens containers from the current stack depth down to the full target
   * container path, emitting opening `{`, `[`, keys, and commas as needed.
   * `leafSegment` is used to determine if the innermost container is an array.
   *
   * Input: this.pathStack=[root], targetContainer=["recipe","ingredients"], leafSegment=0
   * Output: '"recipe":{"ingredients":['
   */
  openDownTo(targetContainer, leafSegment) {
    let fragment = "";
    const startIdx = this.pathStack.length - 1;
    for (let i = startIdx; i < targetContainer.length; i++) {
      const pathSegment = targetContainer[i];
      const parentEntry = this.pathStack[this.pathStack.length - 1];
      if (parentEntry.childCount > 0) {
        fragment += ",";
      }
      parentEntry.childCount++;
      if (typeof pathSegment === "string") {
        fragment += `${JSON.stringify(pathSegment)}:`;
      }
      const childSeg = i + 1 < targetContainer.length ? targetContainer[i + 1] : leafSegment;
      const isArray = typeof childSeg === "number";
      fragment += isArray ? "[" : "{";
      this.pathStack.push({ segment: pathSegment, isArray, childCount: 0 });
    }
    return fragment;
  }
  /**
   * Emits the comma, key, and value for a leaf entry in the current container.
   *
   * Input: leafSegment="name", arg={stringValue:"Lasagna"}, valueJson='"Lasagna"'
   * Output: '"name":"Lasagna"' (or ',"name":"Lasagna"' if container.childCount > 0)
   */
  emitLeaf(leafSegment, arg, valueJson) {
    let fragment = "";
    const container = this.pathStack[this.pathStack.length - 1];
    if (container.childCount > 0) {
      fragment += ",";
    }
    container.childCount++;
    if (typeof leafSegment === "string") {
      fragment += `${JSON.stringify(leafSegment)}:`;
    }
    if (arg.stringValue != null && arg.willContinue) {
      fragment += valueJson.slice(0, -1);
      this.stringOpen = true;
    } else {
      fragment += valueJson;
    }
    return fragment;
  }
};
function parsePath(rawPath) {
  const segments = [];
  for (const part of rawPath.split(".")) {
    const bracketIdx = part.indexOf("[");
    if (bracketIdx === -1) {
      segments.push(part);
    } else {
      if (bracketIdx > 0) segments.push(part.slice(0, bracketIdx));
      for (const m of part.matchAll(/\[(\d+)\]/g)) {
        segments.push(parseInt(m[1], 10));
      }
    }
  }
  return segments;
}
var hasOwn = Object.prototype.hasOwnProperty;
function hasOwnProperty(obj, key) {
  return hasOwn.call(obj, key);
}
function defineOwnProperty(obj, key, value) {
  Object.defineProperty(obj, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  });
}
function getNestedValue(obj, segments) {
  let current = obj;
  for (const pathSegment of segments) {
    if (current == null || typeof current !== "object") return void 0;
    const currentRecord = current;
    if (!hasOwnProperty(currentRecord, pathSegment)) return void 0;
    current = currentRecord[pathSegment];
  }
  return current;
}
function setNestedValue(obj, segments, value) {
  let current = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const pathSegment = segments[i];
    const nextSeg = segments[i + 1];
    if (!hasOwnProperty(current, pathSegment) || current[pathSegment] == null) {
      defineOwnProperty(
        current,
        pathSegment,
        typeof nextSeg === "number" ? [] : {}
      );
    }
    current = current[pathSegment];
  }
  defineOwnProperty(current, segments[segments.length - 1], value);
}
function resolvePartialArgValue(arg) {
  var _a, _b;
  const value = (_b = (_a = arg.stringValue) != null ? _a : arg.numberValue) != null ? _b : arg.boolValue;
  if (value != null) return { value, json: JSON.stringify(value) };
  if ("nullValue" in arg) return { value: null, json: "null" };
  return void 0;
}

// src/map-google-finish-reason.ts
function mapGoogleFinishReason({
  finishReason,
  hasToolCalls
}) {
  switch (finishReason) {
    case "STOP":
      return hasToolCalls ? "tool-calls" : "stop";
    case "MAX_TOKENS":
      return "length";
    case "IMAGE_SAFETY":
    case "RECITATION":
    case "SAFETY":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return "content-filter";
    case "MALFORMED_FUNCTION_CALL":
      return "error";
    case "FINISH_REASON_UNSPECIFIED":
    case "OTHER":
    default:
      return "other";
  }
}

// src/google-language-model.ts
var configurableSafetySettingCategories = [
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT"
];
var GoogleLanguageModel = class _GoogleLanguageModel {
  constructor(modelId, config) {
    this.specificationVersion = "v4";
    var _a;
    this.modelId = modelId;
    this.config = config;
    this.generateId = (_a = config.generateId) != null ? _a : generateId;
  }
  static [WORKFLOW_SERIALIZE](model) {
    return serializeModelOptions({
      modelId: model.modelId,
      config: model.config
    });
  }
  static [WORKFLOW_DESERIALIZE](options) {
    return new _GoogleLanguageModel(options.modelId, options.config);
  }
  get provider() {
    return this.config.provider;
  }
  get supportedUrls() {
    var _a, _b, _c;
    return (_c = (_b = (_a = this.config).supportedUrls) == null ? void 0 : _b.call(_a)) != null ? _c : {};
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
  }, { isStreaming = false } = {}) {
    var _a, _b, _c;
    const warnings = [];
    const providerOptionsNames = this.config.provider.includes("vertex") ? ["googleVertex", "vertex"] : ["google"];
    let googleOptions;
    for (const name of providerOptionsNames) {
      googleOptions = await parseProviderOptions({
        provider: name,
        providerOptions,
        schema: googleLanguageModelOptions
      });
      if (googleOptions != null) break;
    }
    if (googleOptions == null && !providerOptionsNames.includes("google")) {
      googleOptions = await parseProviderOptions({
        provider: "google",
        providerOptions,
        schema: googleLanguageModelOptions
      });
    }
    const isVertexProvider = this.config.provider.startsWith("google.vertex.");
    if ((tools == null ? void 0 : tools.some(
      (tool) => tool.type === "provider" && tool.id === "google.vertex_rag_store"
    )) && !isVertexProvider) {
      warnings.push({
        type: "other",
        message: `The 'vertex_rag_store' tool is only supported with the Google Vertex provider and might not be supported or could behave unexpectedly with the current Google provider (${this.config.provider}).`
      });
    }
    if ((googleOptions == null ? void 0 : googleOptions.streamFunctionCallArguments) && !isVertexProvider) {
      warnings.push({
        type: "other",
        message: `'streamFunctionCallArguments' is only supported on the Vertex AI API and will be ignored with the current Google provider (${this.config.provider}). See https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling#streaming-fc`
      });
    }
    if ((googleOptions == null ? void 0 : googleOptions.serviceTier) && isVertexProvider) {
      warnings.push({
        type: "other",
        message: "'serviceTier' is a Gemini API option and is not supported on Vertex AI. Use 'sharedRequestType' (and optionally 'requestType') instead. See https://docs.cloud.google.com/vertex-ai/generative-ai/docs/priority-paygo"
      });
    }
    if (((googleOptions == null ? void 0 : googleOptions.sharedRequestType) || (googleOptions == null ? void 0 : googleOptions.requestType)) && !isVertexProvider) {
      warnings.push({
        type: "other",
        message: `'sharedRequestType' and 'requestType' are Vertex AI options and are ignored with the current Google provider (${this.config.provider}).`
      });
    }
    const vertexPaygoHeaders = isVertexProvider && ((googleOptions == null ? void 0 : googleOptions.sharedRequestType) || (googleOptions == null ? void 0 : googleOptions.requestType)) ? {
      ...googleOptions.sharedRequestType && {
        "X-Vertex-AI-LLM-Shared-Request-Type": googleOptions.sharedRequestType
      },
      ...googleOptions.requestType && {
        "X-Vertex-AI-LLM-Request-Type": googleOptions.requestType
      }
    } : void 0;
    const bodyServiceTier = isVertexProvider ? void 0 : googleOptions == null ? void 0 : googleOptions.serviceTier;
    let imageConfig = googleOptions == null ? void 0 : googleOptions.imageConfig;
    if (imageConfig != null && !isVertexProvider) {
      const {
        personGeneration,
        prominentPeople,
        imageOutputOptions,
        ...geminiApiImageConfig
      } = imageConfig;
      const droppedImageConfigFields = Object.entries({
        personGeneration,
        prominentPeople,
        imageOutputOptions
      }).filter(([, value]) => value != null).map(([key]) => `'imageConfig.${key}'`);
      if (droppedImageConfigFields.length > 0) {
        warnings.push({
          type: "other",
          message: `${droppedImageConfigFields.join(", ")} ${droppedImageConfigFields.length === 1 ? "is a Vertex AI option and is" : "are Vertex AI options and are"} ignored with the current Google provider (${this.config.provider}).`
        });
        imageConfig = geminiApiImageConfig;
      }
    }
    const isGemmaModel = this.modelId.toLowerCase().startsWith("gemma-");
    const { usesGemini3Features } = getGoogleModelCapabilities(this.modelId);
    const { contents, systemInstruction } = convertToGoogleMessages(prompt, {
      isGemmaModel,
      isGemini3Model: usesGemini3Features,
      onWarning: (warning) => warnings.push(warning),
      providerOptionsNames,
      supportsFunctionResponseParts: usesGemini3Features,
      includeFunctionCallIds: !isVertexProvider
    });
    const {
      tools: googleTools2,
      toolConfig: googleToolConfig,
      toolWarnings
    } = prepareTools({
      tools,
      toolChoice,
      modelId: this.modelId,
      isVertexProvider
    });
    const resolvedThinking = resolveThinkingConfig({
      reasoning,
      modelId: this.modelId,
      warnings
    });
    const thinkingConfig = (googleOptions == null ? void 0 : googleOptions.thinkingConfig) || resolvedThinking ? { ...resolvedThinking, ...googleOptions == null ? void 0 : googleOptions.thinkingConfig } : void 0;
    const streamFunctionCallArguments = isStreaming && isVertexProvider ? (_a = googleOptions == null ? void 0 : googleOptions.streamFunctionCallArguments) != null ? _a : false : void 0;
    const safetyThreshold = googleOptions == null ? void 0 : googleOptions.threshold;
    const safetySettings = (_b = googleOptions == null ? void 0 : googleOptions.safetySettings) != null ? _b : safetyThreshold != null ? configurableSafetySettingCategories.map((category) => ({
      category,
      threshold: safetyThreshold
    })) : void 0;
    const toolConfig = googleToolConfig || streamFunctionCallArguments || (googleOptions == null ? void 0 : googleOptions.retrievalConfig) ? {
      ...googleToolConfig,
      ...streamFunctionCallArguments && {
        functionCallingConfig: {
          ...googleToolConfig == null ? void 0 : googleToolConfig.functionCallingConfig,
          streamFunctionCallArguments: true
        }
      },
      ...(googleOptions == null ? void 0 : googleOptions.retrievalConfig) && {
        retrievalConfig: googleOptions.retrievalConfig
      }
    } : void 0;
    return {
      args: {
        generationConfig: {
          // standardized settings:
          maxOutputTokens,
          temperature,
          topK,
          topP,
          frequencyPenalty,
          presencePenalty,
          stopSequences,
          seed,
          // response format:
          responseMimeType: (responseFormat == null ? void 0 : responseFormat.type) === "json" ? "application/json" : void 0,
          responseSchema: (responseFormat == null ? void 0 : responseFormat.type) === "json" && responseFormat.schema != null && // Google GenAI does not support all OpenAPI Schema features,
          // so this is needed as an escape hatch:
          // TODO convert into provider option
          ((_c = googleOptions == null ? void 0 : googleOptions.structuredOutputs) != null ? _c : true) ? convertJSONSchemaToOpenAPISchema(responseFormat.schema) : void 0,
          ...(googleOptions == null ? void 0 : googleOptions.audioTimestamp) && {
            audioTimestamp: googleOptions.audioTimestamp
          },
          // provider options:
          responseModalities: googleOptions == null ? void 0 : googleOptions.responseModalities,
          thinkingConfig,
          ...(googleOptions == null ? void 0 : googleOptions.mediaResolution) && {
            mediaResolution: googleOptions.mediaResolution
          },
          ...imageConfig && { imageConfig }
        },
        contents,
        systemInstruction: isGemmaModel ? void 0 : systemInstruction,
        safetySettings,
        tools: googleTools2,
        toolConfig,
        cachedContent: googleOptions == null ? void 0 : googleOptions.cachedContent,
        labels: googleOptions == null ? void 0 : googleOptions.labels,
        serviceTier: bodyServiceTier
      },
      warnings: [...warnings, ...toolWarnings],
      providerOptionsNames,
      extraHeaders: vertexPaygoHeaders
    };
  }
  async doGenerate(options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s;
    const { args, warnings, providerOptionsNames, extraHeaders } = await this.getArgs(options);
    const wrapProviderMetadata = (payload) => Object.fromEntries(
      providerOptionsNames.map((name) => [name, payload])
    );
    const mergedHeaders = combineHeaders(
      this.config.headers ? await resolve(this.config.headers) : void 0,
      options.headers,
      extraHeaders
    );
    const {
      responseHeaders,
      value: response,
      rawValue: rawResponse
    } = await postJsonToApi({
      url: `${this.config.baseURL}/${getModelPath(
        this.modelId
      )}:generateContent`,
      headers: mergedHeaders,
      body: args,
      failedResponseHandler: googleFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(responseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch
    });
    const candidate = response.candidates[0];
    const content = [];
    const parts = (_b = (_a = candidate.content) == null ? void 0 : _a.parts) != null ? _b : [];
    const usageMetadata = response.usageMetadata;
    let lastCodeExecutionToolCallId;
    let lastServerToolCallId;
    for (const part of parts) {
      if ("executableCode" in part && ((_c = part.executableCode) == null ? void 0 : _c.code)) {
        const toolCallId = this.config.generateId();
        lastCodeExecutionToolCallId = toolCallId;
        content.push({
          type: "tool-call",
          toolCallId,
          toolName: "code_execution",
          input: JSON.stringify(part.executableCode),
          providerExecuted: true
        });
      } else if ("codeExecutionResult" in part && part.codeExecutionResult) {
        content.push({
          type: "tool-result",
          // Results correspond to the most recent executable code part.
          toolCallId: lastCodeExecutionToolCallId,
          toolName: "code_execution",
          result: {
            outcome: part.codeExecutionResult.outcome,
            output: (_d = part.codeExecutionResult.output) != null ? _d : ""
          }
        });
      } else if ("text" in part && part.text != null) {
        const thoughtSignatureMetadata = part.thoughtSignature ? wrapProviderMetadata({
          thoughtSignature: part.thoughtSignature
        }) : void 0;
        if (part.text.length === 0) {
          if (thoughtSignatureMetadata != null && content.length > 0) {
            const lastContent = content[content.length - 1];
            lastContent.providerMetadata = thoughtSignatureMetadata;
          }
        } else {
          content.push({
            type: part.thought === true ? "reasoning" : "text",
            text: part.text,
            providerMetadata: thoughtSignatureMetadata
          });
        }
      } else if ("functionCall" in part && part.functionCall.name != null) {
        content.push({
          type: "tool-call",
          toolCallId: (_e = part.functionCall.id) != null ? _e : this.config.generateId(),
          toolName: part.functionCall.name,
          input: JSON.stringify((_f = part.functionCall.args) != null ? _f : {}),
          providerMetadata: part.thoughtSignature ? wrapProviderMetadata({
            thoughtSignature: part.thoughtSignature
          }) : void 0
        });
      } else if ("inlineData" in part) {
        const hasThought = part.thought === true;
        const hasThoughtSignature = !!part.thoughtSignature;
        content.push({
          type: hasThought ? "reasoning-file" : "file",
          data: { type: "data", data: part.inlineData.data },
          mediaType: part.inlineData.mimeType,
          providerMetadata: hasThoughtSignature ? wrapProviderMetadata({
            thoughtSignature: part.thoughtSignature
          }) : void 0
        });
      } else if ("toolCall" in part && part.toolCall) {
        const toolCallId = (_g = part.toolCall.id) != null ? _g : this.config.generateId();
        lastServerToolCallId = toolCallId;
        content.push({
          type: "tool-call",
          toolCallId,
          toolName: `server:${part.toolCall.toolType}`,
          input: JSON.stringify((_h = part.toolCall.args) != null ? _h : {}),
          providerExecuted: true,
          dynamic: true,
          providerMetadata: part.thoughtSignature ? wrapProviderMetadata({
            thoughtSignature: part.thoughtSignature,
            serverToolCallId: toolCallId,
            serverToolType: part.toolCall.toolType
          }) : wrapProviderMetadata({
            serverToolCallId: toolCallId,
            serverToolType: part.toolCall.toolType
          })
        });
      } else if ("toolResponse" in part && part.toolResponse) {
        const responseToolCallId = (_i = lastServerToolCallId != null ? lastServerToolCallId : part.toolResponse.id) != null ? _i : this.config.generateId();
        content.push({
          type: "tool-result",
          toolCallId: responseToolCallId,
          toolName: `server:${part.toolResponse.toolType}`,
          result: (_j = part.toolResponse.response) != null ? _j : {},
          providerMetadata: part.thoughtSignature ? wrapProviderMetadata({
            thoughtSignature: part.thoughtSignature,
            serverToolCallId: responseToolCallId,
            serverToolType: part.toolResponse.toolType
          }) : wrapProviderMetadata({
            serverToolCallId: responseToolCallId,
            serverToolType: part.toolResponse.toolType
          })
        });
        lastServerToolCallId = void 0;
      }
    }
    const sources = (_k = extractSources({
      groundingMetadata: candidate.groundingMetadata,
      generateId: this.config.generateId
    })) != null ? _k : [];
    for (const source of sources) {
      content.push(source);
    }
    return {
      content,
      finishReason: {
        unified: mapGoogleFinishReason({
          finishReason: candidate.finishReason,
          // Only count client-executed tool calls for finish reason determination.
          hasToolCalls: content.some(
            (part) => part.type === "tool-call" && !part.providerExecuted
          )
        }),
        raw: (_l = candidate.finishReason) != null ? _l : void 0
      },
      usage: convertGoogleUsage(usageMetadata),
      warnings,
      providerMetadata: wrapProviderMetadata({
        promptFeedback: (_m = response.promptFeedback) != null ? _m : null,
        groundingMetadata: (_n = candidate.groundingMetadata) != null ? _n : null,
        urlContextMetadata: (_o = candidate.urlContextMetadata) != null ? _o : null,
        safetyRatings: (_p = candidate.safetyRatings) != null ? _p : null,
        usageMetadata: usageMetadata != null ? usageMetadata : null,
        finishMessage: (_q = candidate.finishMessage) != null ? _q : null,
        serviceTier: (_r = usageMetadata == null ? void 0 : usageMetadata.serviceTier) != null ? _r : null
      }),
      request: { body: args },
      response: {
        // TODO timestamp, model id
        id: (_s = response.responseId) != null ? _s : void 0,
        headers: responseHeaders,
        body: rawResponse
      }
    };
  }
  async doStream(options) {
    const { args, warnings, providerOptionsNames, extraHeaders } = await this.getArgs(options, { isStreaming: true });
    const wrapProviderMetadata = (payload) => Object.fromEntries(
      providerOptionsNames.map((name) => [name, payload])
    );
    const headers = combineHeaders(
      this.config.headers ? await resolve(this.config.headers) : void 0,
      options.headers,
      extraHeaders
    );
    const { responseHeaders, value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/${getModelPath(
        this.modelId
      )}:streamGenerateContent?alt=sse`,
      headers,
      body: args,
      failedResponseHandler: googleFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(chunkSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch
    });
    let finishReason = {
      unified: "other",
      raw: void 0
    };
    let usage = void 0;
    let providerMetadata = void 0;
    let lastGroundingMetadata = null;
    let lastUrlContextMetadata = null;
    const generateId2 = this.config.generateId;
    let hasToolCalls = false;
    let hasEmittedResponseMetadata = false;
    let currentTextBlockId = null;
    let currentReasoningBlockId = null;
    let blockCounter = 0;
    const emittedSourceUrls = /* @__PURE__ */ new Set();
    let lastCodeExecutionToolCallId;
    let lastServerToolCallId;
    const activeStreamingToolCalls = [];
    const finishActiveStreamingToolCall = (controller) => {
      const active = activeStreamingToolCalls.pop();
      if (active == null) {
        return;
      }
      const { finalJSON, closingDelta } = active.accumulator.finalize();
      if (closingDelta.length > 0) {
        controller.enqueue({
          type: "tool-input-delta",
          id: active.toolCallId,
          delta: closingDelta,
          providerMetadata: active.providerMetadata
        });
      }
      controller.enqueue({
        type: "tool-input-end",
        id: active.toolCallId,
        providerMetadata: active.providerMetadata
      });
      controller.enqueue({
        type: "tool-call",
        toolCallId: active.toolCallId,
        toolName: active.toolName,
        input: finalJSON,
        providerMetadata: active.providerMetadata
      });
      hasToolCalls = true;
    };
    return {
      stream: response.pipeThrough(
        new TransformStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings });
          },
          transform(chunk, controller) {
            var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p;
            if (options.includeRawChunks) {
              controller.enqueue({ type: "raw", rawValue: chunk.rawValue });
            }
            if (!chunk.success) {
              controller.enqueue({ type: "error", error: chunk.error });
              return;
            }
            const value = chunk.value;
            if (!hasEmittedResponseMetadata && value.responseId != null) {
              hasEmittedResponseMetadata = true;
              controller.enqueue({
                type: "response-metadata",
                id: value.responseId
              });
            }
            const usageMetadata = value.usageMetadata;
            if (usageMetadata != null) {
              usage = usageMetadata;
            }
            const candidate = (_a = value.candidates) == null ? void 0 : _a[0];
            if (candidate == null) {
              return;
            }
            const content = candidate.content;
            if (candidate.groundingMetadata != null) {
              lastGroundingMetadata = candidate.groundingMetadata;
            }
            if (candidate.urlContextMetadata != null) {
              lastUrlContextMetadata = candidate.urlContextMetadata;
            }
            const sources = extractSources({
              groundingMetadata: candidate.groundingMetadata,
              generateId: generateId2
            });
            if (sources != null) {
              for (const source of sources) {
                if (source.sourceType === "url" && !emittedSourceUrls.has(source.url)) {
                  emittedSourceUrls.add(source.url);
                  controller.enqueue(source);
                }
              }
            }
            if (content != null) {
              const parts = (_b = content.parts) != null ? _b : [];
              for (const part of parts) {
                if ("executableCode" in part && ((_c = part.executableCode) == null ? void 0 : _c.code)) {
                  const toolCallId = generateId2();
                  lastCodeExecutionToolCallId = toolCallId;
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId,
                    toolName: "code_execution",
                    input: JSON.stringify(part.executableCode),
                    providerExecuted: true
                  });
                } else if ("codeExecutionResult" in part && part.codeExecutionResult) {
                  const toolCallId = lastCodeExecutionToolCallId;
                  if (toolCallId) {
                    controller.enqueue({
                      type: "tool-result",
                      toolCallId,
                      toolName: "code_execution",
                      result: {
                        outcome: part.codeExecutionResult.outcome,
                        output: (_d = part.codeExecutionResult.output) != null ? _d : ""
                      }
                    });
                  }
                } else if ("text" in part && part.text != null) {
                  const thoughtSignatureMetadata = part.thoughtSignature ? wrapProviderMetadata({
                    thoughtSignature: part.thoughtSignature
                  }) : void 0;
                  if (part.text.length === 0) {
                    if (thoughtSignatureMetadata != null && currentTextBlockId !== null) {
                      controller.enqueue({
                        type: "text-delta",
                        id: currentTextBlockId,
                        delta: "",
                        providerMetadata: thoughtSignatureMetadata
                      });
                    }
                  } else if (part.thought === true) {
                    if (currentTextBlockId !== null) {
                      controller.enqueue({
                        type: "text-end",
                        id: currentTextBlockId
                      });
                      currentTextBlockId = null;
                    }
                    if (currentReasoningBlockId === null) {
                      currentReasoningBlockId = String(blockCounter++);
                      controller.enqueue({
                        type: "reasoning-start",
                        id: currentReasoningBlockId,
                        providerMetadata: thoughtSignatureMetadata
                      });
                    }
                    controller.enqueue({
                      type: "reasoning-delta",
                      id: currentReasoningBlockId,
                      delta: part.text,
                      providerMetadata: thoughtSignatureMetadata
                    });
                  } else {
                    if (currentReasoningBlockId !== null) {
                      controller.enqueue({
                        type: "reasoning-end",
                        id: currentReasoningBlockId
                      });
                      currentReasoningBlockId = null;
                    }
                    if (currentTextBlockId === null) {
                      currentTextBlockId = String(blockCounter++);
                      controller.enqueue({
                        type: "text-start",
                        id: currentTextBlockId,
                        providerMetadata: thoughtSignatureMetadata
                      });
                    }
                    controller.enqueue({
                      type: "text-delta",
                      id: currentTextBlockId,
                      delta: part.text,
                      providerMetadata: thoughtSignatureMetadata
                    });
                  }
                } else if ("inlineData" in part) {
                  if (currentTextBlockId !== null) {
                    controller.enqueue({
                      type: "text-end",
                      id: currentTextBlockId
                    });
                    currentTextBlockId = null;
                  }
                  if (currentReasoningBlockId !== null) {
                    controller.enqueue({
                      type: "reasoning-end",
                      id: currentReasoningBlockId
                    });
                    currentReasoningBlockId = null;
                  }
                  const hasThought = part.thought === true;
                  const hasThoughtSignature = !!part.thoughtSignature;
                  const fileMeta = hasThoughtSignature ? wrapProviderMetadata({
                    thoughtSignature: part.thoughtSignature
                  }) : void 0;
                  controller.enqueue({
                    type: hasThought ? "reasoning-file" : "file",
                    mediaType: part.inlineData.mimeType,
                    data: { type: "data", data: part.inlineData.data },
                    providerMetadata: fileMeta
                  });
                } else if ("toolCall" in part && part.toolCall) {
                  const toolCallId = (_e = part.toolCall.id) != null ? _e : generateId2();
                  lastServerToolCallId = toolCallId;
                  const serverMeta = wrapProviderMetadata({
                    ...part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {},
                    serverToolCallId: toolCallId,
                    serverToolType: part.toolCall.toolType
                  });
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId,
                    toolName: `server:${part.toolCall.toolType}`,
                    input: JSON.stringify((_f = part.toolCall.args) != null ? _f : {}),
                    providerExecuted: true,
                    dynamic: true,
                    providerMetadata: serverMeta
                  });
                } else if ("toolResponse" in part && part.toolResponse) {
                  const responseToolCallId = (_g = lastServerToolCallId != null ? lastServerToolCallId : part.toolResponse.id) != null ? _g : generateId2();
                  const serverMeta = wrapProviderMetadata({
                    ...part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {},
                    serverToolCallId: responseToolCallId,
                    serverToolType: part.toolResponse.toolType
                  });
                  controller.enqueue({
                    type: "tool-result",
                    toolCallId: responseToolCallId,
                    toolName: `server:${part.toolResponse.toolType}`,
                    result: (_h = part.toolResponse.response) != null ? _h : {},
                    providerMetadata: serverMeta
                  });
                  lastServerToolCallId = void 0;
                }
              }
              for (const part of parts) {
                if (!("functionCall" in part)) continue;
                const providerMeta = part.thoughtSignature ? wrapProviderMetadata({
                  thoughtSignature: part.thoughtSignature
                }) : void 0;
                const isStreamingChunk = part.functionCall.partialArgs != null || part.functionCall.name != null && part.functionCall.willContinue === true;
                const isTerminalChunk = part.functionCall.name == null && part.functionCall.args == null && part.functionCall.partialArgs == null && part.functionCall.willContinue == null;
                const isCompleteCall = part.functionCall.name != null && part.functionCall.args != null && part.functionCall.partialArgs == null;
                const isNoArgsCompleteCall = part.functionCall.name != null && part.functionCall.args == null && part.functionCall.partialArgs == null && part.functionCall.willContinue !== true;
                if (isStreamingChunk) {
                  if (part.functionCall.name != null) {
                    const toolCallId = (_i = part.functionCall.id) != null ? _i : generateId2();
                    const accumulator = new GoogleJSONAccumulator();
                    activeStreamingToolCalls.push({
                      toolCallId,
                      toolName: part.functionCall.name,
                      accumulator,
                      providerMetadata: providerMeta
                    });
                    controller.enqueue({
                      type: "tool-input-start",
                      id: toolCallId,
                      toolName: part.functionCall.name,
                      providerMetadata: providerMeta
                    });
                    if (part.functionCall.partialArgs != null) {
                      const partialArgs = part.functionCall.partialArgs;
                      const { textDelta } = accumulator.processPartialArgs(partialArgs);
                      if (textDelta.length > 0) {
                        controller.enqueue({
                          type: "tool-input-delta",
                          id: toolCallId,
                          delta: textDelta,
                          providerMetadata: providerMeta
                        });
                      }
                      if (part.functionCall.willContinue !== true && partialArgs.every((arg) => arg.willContinue !== true)) {
                        finishActiveStreamingToolCall(controller);
                      }
                    }
                  } else if (part.functionCall.partialArgs != null && activeStreamingToolCalls.length > 0) {
                    const active = activeStreamingToolCalls[activeStreamingToolCalls.length - 1];
                    const partialArgs = part.functionCall.partialArgs;
                    const { textDelta } = active.accumulator.processPartialArgs(partialArgs);
                    if (textDelta.length > 0) {
                      controller.enqueue({
                        type: "tool-input-delta",
                        id: active.toolCallId,
                        delta: textDelta,
                        providerMetadata: providerMeta
                      });
                    }
                    if (part.functionCall.willContinue !== true && partialArgs.every((arg) => arg.willContinue !== true)) {
                      finishActiveStreamingToolCall(controller);
                    }
                  }
                } else if (isTerminalChunk && activeStreamingToolCalls.length > 0) {
                  finishActiveStreamingToolCall(controller);
                } else if (isCompleteCall) {
                  const toolCallId = (_j = part.functionCall.id) != null ? _j : generateId2();
                  const toolName = part.functionCall.name;
                  const args2 = typeof part.functionCall.args === "string" ? part.functionCall.args : JSON.stringify((_k = part.functionCall.args) != null ? _k : {});
                  controller.enqueue({
                    type: "tool-input-start",
                    id: toolCallId,
                    toolName,
                    providerMetadata: providerMeta
                  });
                  controller.enqueue({
                    type: "tool-input-delta",
                    id: toolCallId,
                    delta: args2,
                    providerMetadata: providerMeta
                  });
                  controller.enqueue({
                    type: "tool-input-end",
                    id: toolCallId,
                    providerMetadata: providerMeta
                  });
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId,
                    toolName,
                    input: args2,
                    providerMetadata: providerMeta
                  });
                  hasToolCalls = true;
                } else if (isNoArgsCompleteCall) {
                  const toolCallId = (_l = part.functionCall.id) != null ? _l : generateId2();
                  const toolName = part.functionCall.name;
                  controller.enqueue({
                    type: "tool-input-start",
                    id: toolCallId,
                    toolName,
                    providerMetadata: providerMeta
                  });
                  controller.enqueue({
                    type: "tool-input-end",
                    id: toolCallId,
                    providerMetadata: providerMeta
                  });
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId,
                    toolName,
                    input: "{}",
                    providerMetadata: providerMeta
                  });
                  hasToolCalls = true;
                }
              }
            }
            if (candidate.finishReason != null) {
              finishReason = {
                unified: mapGoogleFinishReason({
                  finishReason: candidate.finishReason,
                  hasToolCalls
                }),
                raw: candidate.finishReason
              };
              providerMetadata = wrapProviderMetadata({
                promptFeedback: (_m = value.promptFeedback) != null ? _m : null,
                groundingMetadata: lastGroundingMetadata,
                urlContextMetadata: lastUrlContextMetadata,
                safetyRatings: (_n = candidate.safetyRatings) != null ? _n : null,
                usageMetadata: usageMetadata != null ? usageMetadata : null,
                finishMessage: (_o = candidate.finishMessage) != null ? _o : null,
                serviceTier: (_p = usage == null ? void 0 : usage.serviceTier) != null ? _p : null
              });
            }
          },
          flush(controller) {
            if (currentTextBlockId !== null) {
              controller.enqueue({
                type: "text-end",
                id: currentTextBlockId
              });
            }
            if (currentReasoningBlockId !== null) {
              controller.enqueue({
                type: "reasoning-end",
                id: currentReasoningBlockId
              });
            }
            controller.enqueue({
              type: "finish",
              finishReason,
              usage: convertGoogleUsage(usage),
              providerMetadata
            });
          }
        })
      ),
      response: { headers: responseHeaders },
      request: { body: args }
    };
  }
};
function getMaxOutputTokensForGemini25Model() {
  return 65536;
}
function getMaxThinkingTokensForGemini25Model(modelId) {
  const id = modelId.toLowerCase();
  if (id.includes("2.5-pro") || id.includes("gemini-3-pro-image")) {
    return 32768;
  }
  return 24576;
}
function resolveThinkingConfig({
  reasoning,
  modelId,
  warnings
}) {
  if (!isCustomReasoning(reasoning)) {
    return void 0;
  }
  if (getGoogleModelCapabilities(modelId).usesGemini3Features && !modelId.includes("gemini-3-pro-image")) {
    return resolveGemini3ThinkingConfig({ reasoning, warnings });
  }
  return resolveGemini25ThinkingConfig({ reasoning, modelId, warnings });
}
function resolveGemini3ThinkingConfig({
  reasoning,
  warnings
}) {
  if (reasoning === "none") {
    return { thinkingLevel: "minimal" };
  }
  const thinkingLevel = mapReasoningToProviderEffort({
    reasoning,
    effortMap: {
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "high"
    },
    warnings
  });
  if (thinkingLevel == null) {
    return void 0;
  }
  return { thinkingLevel };
}
function resolveGemini25ThinkingConfig({
  reasoning,
  modelId,
  warnings
}) {
  if (reasoning === "none") {
    return { thinkingBudget: 0 };
  }
  const thinkingBudget = mapReasoningToProviderBudget({
    reasoning,
    maxOutputTokens: getMaxOutputTokensForGemini25Model(),
    maxReasoningBudget: getMaxThinkingTokensForGemini25Model(modelId),
    minReasoningBudget: 0,
    warnings
  });
  if (thinkingBudget == null) {
    return void 0;
  }
  return { thinkingBudget };
}
function extractSources({
  groundingMetadata,
  generateId: generateId2
}) {
  var _a, _b, _c, _d, _e, _f;
  if (!(groundingMetadata == null ? void 0 : groundingMetadata.groundingChunks)) {
    return void 0;
  }
  const sources = [];
  for (const chunk of groundingMetadata.groundingChunks) {
    if (chunk.web != null) {
      sources.push({
        type: "source",
        sourceType: "url",
        id: generateId2(),
        url: chunk.web.uri,
        title: (_a = chunk.web.title) != null ? _a : void 0
      });
    } else if (chunk.image != null) {
      sources.push({
        type: "source",
        sourceType: "url",
        id: generateId2(),
        // Google requires attribution to the source URI, not the actual image URI.
        // TODO: add another type in v7 to allow both the image and source URL to be included separately
        url: chunk.image.sourceUri,
        title: (_b = chunk.image.title) != null ? _b : void 0
      });
    } else if (chunk.retrievedContext != null) {
      const uri = chunk.retrievedContext.uri;
      const fileSearchStore = chunk.retrievedContext.fileSearchStore;
      if (uri && (uri.startsWith("http://") || uri.startsWith("https://"))) {
        sources.push({
          type: "source",
          sourceType: "url",
          id: generateId2(),
          url: uri,
          title: (_c = chunk.retrievedContext.title) != null ? _c : void 0
        });
      } else if (uri) {
        const title = (_d = chunk.retrievedContext.title) != null ? _d : "Unknown Document";
        let mediaType = "application/octet-stream";
        let filename = void 0;
        if (uri.endsWith(".pdf")) {
          mediaType = "application/pdf";
          filename = uri.split("/").pop();
        } else if (uri.endsWith(".txt")) {
          mediaType = "text/plain";
          filename = uri.split("/").pop();
        } else if (uri.endsWith(".docx")) {
          mediaType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          filename = uri.split("/").pop();
        } else if (uri.endsWith(".doc")) {
          mediaType = "application/msword";
          filename = uri.split("/").pop();
        } else if (uri.match(/\.(md|markdown)$/)) {
          mediaType = "text/markdown";
          filename = uri.split("/").pop();
        } else {
          filename = uri.split("/").pop();
        }
        sources.push({
          type: "source",
          sourceType: "document",
          id: generateId2(),
          mediaType,
          title,
          filename
        });
      } else if (fileSearchStore) {
        const title = (_e = chunk.retrievedContext.title) != null ? _e : "Unknown Document";
        sources.push({
          type: "source",
          sourceType: "document",
          id: generateId2(),
          mediaType: "application/octet-stream",
          title,
          filename: fileSearchStore.split("/").pop()
        });
      }
    } else if (chunk.maps != null) {
      if (chunk.maps.uri) {
        sources.push({
          type: "source",
          sourceType: "url",
          id: generateId2(),
          url: chunk.maps.uri,
          title: (_f = chunk.maps.title) != null ? _f : void 0
        });
      }
    }
  }
  return sources.length > 0 ? sources : void 0;
}
var getGroundingMetadataSchema = () => z3.object({
  webSearchQueries: z3.array(z3.string()).nullish(),
  imageSearchQueries: z3.array(z3.string()).nullish(),
  retrievalQueries: z3.array(z3.string()).nullish(),
  searchEntryPoint: z3.object({ renderedContent: z3.string() }).nullish(),
  groundingChunks: z3.array(
    z3.object({
      web: z3.object({ uri: z3.string(), title: z3.string().nullish() }).nullish(),
      image: z3.object({
        sourceUri: z3.string(),
        imageUri: z3.string(),
        title: z3.string().nullish(),
        domain: z3.string().nullish()
      }).nullish(),
      retrievedContext: z3.object({
        uri: z3.string().nullish(),
        title: z3.string().nullish(),
        text: z3.string().nullish(),
        fileSearchStore: z3.string().nullish()
      }).nullish(),
      maps: z3.object({
        uri: z3.string().nullish(),
        title: z3.string().nullish(),
        text: z3.string().nullish(),
        placeId: z3.string().nullish()
      }).nullish()
    })
  ).nullish(),
  groundingSupports: z3.array(
    z3.object({
      segment: z3.object({
        startIndex: z3.number().nullish(),
        endIndex: z3.number().nullish(),
        text: z3.string().nullish()
      }).nullish(),
      segment_text: z3.string().nullish(),
      groundingChunkIndices: z3.array(z3.number()).nullish(),
      supportChunkIndices: z3.array(z3.number()).nullish(),
      confidenceScores: z3.array(z3.number()).nullish(),
      confidenceScore: z3.array(z3.number()).nullish()
    })
  ).nullish(),
  retrievalMetadata: z3.union([
    z3.object({
      webDynamicRetrievalScore: z3.number()
    }),
    z3.object({})
  ]).nullish()
});
var partialArgSchema = z3.object({
  jsonPath: z3.string(),
  stringValue: z3.string().nullish(),
  numberValue: z3.number().nullish(),
  boolValue: z3.boolean().nullish(),
  nullValue: z3.unknown().nullish(),
  willContinue: z3.boolean().nullish()
});
var getContentSchema = () => z3.object({
  parts: z3.array(
    z3.union([
      // note: order matters since text can be fully empty
      z3.object({
        functionCall: z3.object({
          id: z3.string().nullish(),
          name: z3.string().nullish(),
          args: z3.unknown().nullish(),
          partialArgs: z3.array(partialArgSchema).nullish(),
          willContinue: z3.boolean().nullish()
        }),
        thoughtSignature: z3.string().nullish()
      }),
      z3.object({
        inlineData: z3.object({
          mimeType: z3.string(),
          data: z3.string()
        }),
        thought: z3.boolean().nullish(),
        thoughtSignature: z3.string().nullish()
      }),
      z3.object({
        toolCall: z3.object({
          toolType: z3.string(),
          args: z3.unknown().nullish(),
          id: z3.string()
        }),
        thoughtSignature: z3.string().nullish()
      }),
      z3.object({
        toolResponse: z3.object({
          toolType: z3.string(),
          response: z3.unknown().nullish(),
          id: z3.string()
        }),
        thoughtSignature: z3.string().nullish()
      }),
      z3.object({
        executableCode: z3.object({
          language: z3.string(),
          code: z3.string()
        }).nullish(),
        codeExecutionResult: z3.object({
          outcome: z3.string(),
          output: z3.string().nullish()
        }).nullish(),
        text: z3.string().nullish(),
        thought: z3.boolean().nullish(),
        thoughtSignature: z3.string().nullish()
      })
    ])
  ).nullish()
});
var getSafetyRatingSchema = () => z3.object({
  category: z3.string().nullish(),
  probability: z3.string().nullish(),
  probabilityScore: z3.number().nullish(),
  severity: z3.string().nullish(),
  severityScore: z3.number().nullish(),
  blocked: z3.boolean().nullish()
});
var tokenDetailsSchema = z3.array(
  z3.object({
    modality: z3.string(),
    tokenCount: z3.number()
  })
).nullish();
var usageSchema = z3.object({
  cachedContentTokenCount: z3.number().nullish(),
  thoughtsTokenCount: z3.number().nullish(),
  promptTokenCount: z3.number().nullish(),
  candidatesTokenCount: z3.number().nullish(),
  totalTokenCount: z3.number().nullish(),
  // https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/GenerateContentResponse#TrafficType
  trafficType: z3.string().nullish(),
  serviceTier: z3.string().nullish(),
  // https://ai.google.dev/api/generate-content#Modality
  promptTokensDetails: tokenDetailsSchema,
  candidatesTokensDetails: tokenDetailsSchema
});
var getUrlContextMetadataSchema = () => z3.object({
  urlMetadata: z3.array(
    z3.object({
      retrievedUrl: z3.string(),
      urlRetrievalStatus: z3.string()
    })
  ).nullish()
});
var responseSchema = lazySchema3(
  () => zodSchema3(
    z3.object({
      responseId: z3.string().nullish(),
      candidates: z3.array(
        z3.object({
          content: getContentSchema().nullish().or(z3.object({}).strict()),
          finishReason: z3.string().nullish(),
          finishMessage: z3.string().nullish(),
          safetyRatings: z3.array(getSafetyRatingSchema()).nullish(),
          groundingMetadata: getGroundingMetadataSchema().nullish(),
          urlContextMetadata: getUrlContextMetadataSchema().nullish()
        })
      ),
      usageMetadata: usageSchema.nullish(),
      promptFeedback: z3.object({
        blockReason: z3.string().nullish(),
        safetyRatings: z3.array(getSafetyRatingSchema()).nullish()
      }).nullish()
    })
  )
);
var chunkSchema = lazySchema3(
  () => zodSchema3(
    z3.object({
      responseId: z3.string().nullish(),
      candidates: z3.array(
        z3.object({
          content: getContentSchema().nullish(),
          finishReason: z3.string().nullish(),
          finishMessage: z3.string().nullish(),
          safetyRatings: z3.array(getSafetyRatingSchema()).nullish(),
          groundingMetadata: getGroundingMetadataSchema().nullish(),
          urlContextMetadata: getUrlContextMetadataSchema().nullish()
        })
      ).nullish(),
      usageMetadata: usageSchema.nullish(),
      promptFeedback: z3.object({
        blockReason: z3.string().nullish(),
        safetyRatings: z3.array(getSafetyRatingSchema()).nullish()
      }).nullish()
    })
  )
);

// src/google-speech-model.ts
import {
  combineHeaders as combineHeaders2,
  convertBase64ToUint8Array,
  createJsonResponseHandler as createJsonResponseHandler2,
  parseProviderOptions as parseProviderOptions2,
  postJsonToApi as postJsonToApi2,
  resolve as resolve2,
  serializeModelOptions as serializeModelOptions2,
  WORKFLOW_DESERIALIZE as WORKFLOW_DESERIALIZE2,
  WORKFLOW_SERIALIZE as WORKFLOW_SERIALIZE2
} from "@ai-sdk/provider-utils";

// src/google-speech-api.ts
import { lazySchema as lazySchema4, zodSchema as zodSchema4 } from "@ai-sdk/provider-utils";
import { z as z4 } from "zod/v4";
var googleSpeechResponseSchema = lazySchema4(
  () => zodSchema4(
    z4.object({
      candidates: z4.array(
        z4.object({
          content: z4.object({
            parts: z4.array(
              z4.object({
                inlineData: z4.object({
                  mimeType: z4.string().nullish(),
                  data: z4.string().nullish()
                }).nullish()
              })
            ).nullish()
          }).nullish()
        })
      ).nullish()
    })
  )
);

// src/google-speech-model-options.ts
import {
  lazySchema as lazySchema5,
  zodSchema as zodSchema5
} from "@ai-sdk/provider-utils";
import { z as z5 } from "zod/v4";
var prebuiltVoiceConfigSchema = z5.object({
  voiceName: z5.string()
});
var voiceConfigSchema = z5.object({
  prebuiltVoiceConfig: prebuiltVoiceConfigSchema
});
var googleSpeechProviderOptionsSchema = lazySchema5(
  () => zodSchema5(
    z5.object({
      /**
       * Multi-speaker configuration for dialogue audio. When provided, this
       * overrides the top-level `voice`. The Gemini TTS API supports up to two
       * speakers; each speaker name must match a name used in the input text.
       *
       * https://ai.google.dev/gemini-api/docs/speech-generation#multi-speaker
       */
      multiSpeakerVoiceConfig: z5.object({
        speakerVoiceConfigs: z5.array(
          z5.object({
            speaker: z5.string(),
            voiceConfig: voiceConfigSchema
          })
        )
      }).optional()
    })
  )
);

// src/google-speech-model.ts
var DEFAULT_VOICE = "Kore";
var DEFAULT_SAMPLE_RATE = 24e3;
var GoogleSpeechModel = class _GoogleSpeechModel {
  constructor(modelId, config) {
    this.modelId = modelId;
    this.config = config;
    this.specificationVersion = "v4";
  }
  static [WORKFLOW_SERIALIZE2](model) {
    return serializeModelOptions2({
      modelId: model.modelId,
      config: model.config
    });
  }
  static [WORKFLOW_DESERIALIZE2](options) {
    return new _GoogleSpeechModel(options.modelId, options.config);
  }
  get provider() {
    return this.config.provider;
  }
  async getArgs({
    text,
    voice = DEFAULT_VOICE,
    outputFormat,
    instructions,
    speed,
    language,
    providerOptions
  }) {
    const warnings = [];
    const providerOptionsNames = this.config.provider.includes("vertex") ? ["googleVertex", "vertex"] : ["google"];
    let googleOptions;
    for (const name of providerOptionsNames) {
      googleOptions = await parseProviderOptions2({
        provider: name,
        providerOptions,
        schema: googleSpeechProviderOptionsSchema
      });
      if (googleOptions != null) {
        break;
      }
    }
    if (googleOptions == null && !providerOptionsNames.includes("google")) {
      googleOptions = await parseProviderOptions2({
        provider: "google",
        providerOptions,
        schema: googleSpeechProviderOptionsSchema
      });
    }
    const multiSpeakerVoiceConfig = googleOptions == null ? void 0 : googleOptions.multiSpeakerVoiceConfig;
    const speechConfig = multiSpeakerVoiceConfig ? { multiSpeakerVoiceConfig } : { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } };
    let promptText = text;
    if (instructions != null) {
      if (multiSpeakerVoiceConfig) {
        warnings.push({
          type: "unsupported",
          feature: "instructions",
          details: "Google Gemini TTS ignores `instructions` when `multiSpeakerVoiceConfig` is set, because prepending them would break multi-speaker transcript parsing."
        });
      } else {
        promptText = `${instructions}: ${text}`;
      }
    }
    if (speed != null) {
      warnings.push({
        type: "unsupported",
        feature: "speed",
        details: "Google Gemini TTS models do not support the `speed` option. It was ignored."
      });
    }
    if (language != null) {
      warnings.push({
        type: "unsupported",
        feature: "language",
        details: "Google Gemini TTS models do not support the `language` option. Language is detected automatically from the input text."
      });
    }
    let resolvedOutputFormat = "wav";
    if (outputFormat === "pcm") {
      resolvedOutputFormat = "pcm";
    } else if (outputFormat != null && outputFormat !== "wav") {
      warnings.push({
        type: "unsupported",
        feature: "outputFormat",
        details: `Unsupported output format: ${outputFormat}. Using wav instead.`
      });
    }
    const requestBody = {
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig
      }
    };
    return { requestBody, warnings, outputFormat: resolvedOutputFormat };
  }
  async doGenerate(options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    const currentDate = (_c = (_b = (_a = this.config._internal) == null ? void 0 : _a.currentDate) == null ? void 0 : _b.call(_a)) != null ? _c : /* @__PURE__ */ new Date();
    const { requestBody, warnings, outputFormat } = await this.getArgs(options);
    const {
      value: response,
      responseHeaders,
      rawValue: rawResponse
    } = await postJsonToApi2({
      url: `${this.config.baseURL}/models/${this.modelId}:generateContent`,
      headers: combineHeaders2(
        this.config.headers ? await resolve2(this.config.headers) : void 0,
        options.headers
      ),
      body: requestBody,
      failedResponseHandler: googleFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler2(
        googleSpeechResponseSchema
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch
    });
    let base64Audio;
    let mimeType;
    for (const candidate of (_d = response.candidates) != null ? _d : []) {
      for (const part of (_f = (_e = candidate.content) == null ? void 0 : _e.parts) != null ? _f : []) {
        if ((_g = part.inlineData) == null ? void 0 : _g.data) {
          base64Audio = part.inlineData.data;
          mimeType = (_h = part.inlineData.mimeType) != null ? _h : void 0;
          break;
        }
      }
      if (base64Audio != null) {
        break;
      }
    }
    const sampleRate = (_i = parseSampleRate(mimeType)) != null ? _i : DEFAULT_SAMPLE_RATE;
    const pcm = base64Audio != null ? convertBase64ToUint8Array(base64Audio) : new Uint8Array(0);
    const audio = outputFormat === "pcm" || pcm.length === 0 ? pcm : addWavHeader(pcm, sampleRate);
    if (outputFormat === "pcm" && pcm.length > 0) {
      warnings.push({
        type: "unsupported",
        feature: "outputFormat",
        details: `Returning raw PCM audio (signed 16-bit little-endian, mono, ${sampleRate} Hz). These bytes have no container header and are not directly playable; see providerMetadata.google for the sample rate and mime type.`
      });
    }
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
      },
      providerMetadata: {
        google: {
          sampleRate,
          mimeType: mimeType != null ? mimeType : null
        }
      }
    };
  }
};
function parseSampleRate(mimeType) {
  if (mimeType == null) {
    return void 0;
  }
  const match = /rate=(\d+)/.exec(mimeType);
  return match ? Number.parseInt(match[1], 10) : void 0;
}
function addWavHeader(pcm, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * bitsPerSample / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  const out = new Uint8Array(buffer);
  out.set(pcm, 44);
  return out;
}
function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

// src/tool/code-execution.ts
import { createProviderExecutedToolFactory } from "@ai-sdk/provider-utils";
import { z as z6 } from "zod/v4";
var codeExecution = createProviderExecutedToolFactory({
  id: "google.code_execution",
  inputSchema: z6.object({
    language: z6.string().describe("The programming language of the code."),
    code: z6.string().describe("The code to be executed.")
  }),
  outputSchema: z6.object({
    outcome: z6.string().describe('The outcome of the execution (e.g., "OUTCOME_OK").'),
    output: z6.string().describe("The output from the code execution.")
  })
});

// src/tool/enterprise-web-search.ts
import {
  createProviderExecutedToolFactory as createProviderExecutedToolFactory2,
  lazySchema as lazySchema6,
  zodSchema as zodSchema6
} from "@ai-sdk/provider-utils";
import { z as z7 } from "zod/v4";
var enterpriseWebSearch = createProviderExecutedToolFactory2({
  id: "google.enterprise_web_search",
  inputSchema: lazySchema6(() => zodSchema6(z7.object({}))),
  outputSchema: lazySchema6(() => zodSchema6(z7.object({})))
});

// src/tool/file-search.ts
import {
  createProviderExecutedToolFactory as createProviderExecutedToolFactory3,
  lazySchema as lazySchema7,
  zodSchema as zodSchema7
} from "@ai-sdk/provider-utils";
import { z as z8 } from "zod/v4";
var fileSearchArgsBaseSchema = z8.looseObject({
  /** The names of the file_search_stores to retrieve from.
   *  Example: `fileSearchStores/my-file-search-store-123`
   */
  fileSearchStoreNames: z8.array(z8.string()).describe(
    "The names of the file_search_stores to retrieve from. Example: `fileSearchStores/my-file-search-store-123`"
  ),
  /** The number of file search retrieval chunks to retrieve. */
  topK: z8.number().int().positive().describe("The number of file search retrieval chunks to retrieve.").optional(),
  /** Metadata filter to apply to the file search retrieval documents.
   *  See https://google.aip.dev/160 for the syntax of the filter expression.
   */
  metadataFilter: z8.string().describe(
    "Metadata filter to apply to the file search retrieval documents. See https://google.aip.dev/160 for the syntax of the filter expression."
  ).optional()
});
var fileSearch = createProviderExecutedToolFactory3({
  id: "google.file_search",
  inputSchema: lazySchema7(() => zodSchema7(z8.object({}))),
  outputSchema: lazySchema7(() => zodSchema7(z8.object({})))
});

// src/tool/google-maps.ts
import {
  createProviderExecutedToolFactory as createProviderExecutedToolFactory4,
  lazySchema as lazySchema8,
  zodSchema as zodSchema8
} from "@ai-sdk/provider-utils";
import { z as z9 } from "zod/v4";
var googleMaps = createProviderExecutedToolFactory4({
  id: "google.google_maps",
  inputSchema: lazySchema8(() => zodSchema8(z9.object({}))),
  outputSchema: lazySchema8(() => zodSchema8(z9.object({})))
});

// src/tool/google-search.ts
import {
  createProviderExecutedToolFactory as createProviderExecutedToolFactory5,
  lazySchema as lazySchema9,
  zodSchema as zodSchema9
} from "@ai-sdk/provider-utils";
import { z as z10 } from "zod/v4";
var googleSearchToolArgsBaseSchema = z10.looseObject({
  searchTypes: z10.object({
    webSearch: z10.object({}).optional(),
    imageSearch: z10.object({}).optional()
  }).optional(),
  timeRangeFilter: z10.object({
    startTime: z10.string(),
    endTime: z10.string()
  }).optional()
});
var googleSearch = createProviderExecutedToolFactory5({
  id: "google.google_search",
  inputSchema: lazySchema9(() => zodSchema9(z10.object({}))),
  outputSchema: lazySchema9(() => zodSchema9(z10.object({})))
});

// src/tool/url-context.ts
import {
  createProviderExecutedToolFactory as createProviderExecutedToolFactory6,
  lazySchema as lazySchema10,
  zodSchema as zodSchema10
} from "@ai-sdk/provider-utils";
import { z as z11 } from "zod/v4";
var urlContext = createProviderExecutedToolFactory6({
  id: "google.url_context",
  inputSchema: lazySchema10(() => zodSchema10(z11.object({}))),
  outputSchema: lazySchema10(() => zodSchema10(z11.object({})))
});

// src/tool/vertex-rag-store.ts
import {
  createProviderExecutedToolFactory as createProviderExecutedToolFactory7,
  lazySchema as lazySchema11,
  zodSchema as zodSchema11
} from "@ai-sdk/provider-utils";
import { z as z12 } from "zod/v4";
var vertexRagStore = createProviderExecutedToolFactory7({
  id: "google.vertex_rag_store",
  inputSchema: lazySchema11(() => zodSchema11(z12.object({}))),
  outputSchema: lazySchema11(() => zodSchema11(z12.object({})))
});

// src/google-tools.ts
var googleTools = {
  /**
   * Creates a Google search tool that gives Google direct access to real-time web content.
   * Must have name "google_search".
   */
  googleSearch,
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
  enterpriseWebSearch,
  /**
   * Creates a Google Maps grounding tool that gives the model access to Google Maps data.
   * Must have name "google_maps".
   *
   * @see https://ai.google.dev/gemini-api/docs/maps-grounding
   * @see https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-maps
   */
  googleMaps,
  /**
   * Creates a URL context tool that gives Google direct access to real-time web content.
   * Must have name "url_context".
   */
  urlContext,
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
  fileSearch,
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
  codeExecution,
  /**
   * Creates a Vertex RAG Store tool that enables the model to perform RAG searches against a Vertex RAG Store.
   * Must have name "vertex_rag_store".
   */
  vertexRagStore
};

// src/interactions/google-interactions-language-model.ts
import {
  combineHeaders as combineHeaders4,
  createEventSourceResponseHandler as createEventSourceResponseHandler3,
  createJsonResponseHandler as createJsonResponseHandler4,
  generateId as defaultGenerateId,
  parseProviderOptions as parseProviderOptions3,
  postJsonToApi as postJsonToApi3,
  resolve as resolve3,
  serializeModelOptions as serializeModelOptions3,
  WORKFLOW_DESERIALIZE as WORKFLOW_DESERIALIZE3,
  WORKFLOW_SERIALIZE as WORKFLOW_SERIALIZE3
} from "@ai-sdk/provider-utils";

// src/interactions/convert-google-interactions-usage.ts
function convertGoogleInteractionsUsage(usage) {
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
  const totalInput = (_a = usage.total_input_tokens) != null ? _a : 0;
  const totalOutput = (_b = usage.total_output_tokens) != null ? _b : 0;
  const totalThought = (_c = usage.total_thought_tokens) != null ? _c : 0;
  const totalCached = (_d = usage.total_cached_tokens) != null ? _d : 0;
  return {
    inputTokens: {
      total: (_e = usage.total_input_tokens) != null ? _e : void 0,
      noCache: usage.total_input_tokens == null ? void 0 : totalInput - totalCached,
      cacheRead: (_f = usage.total_cached_tokens) != null ? _f : void 0,
      cacheWrite: void 0
    },
    outputTokens: {
      total: usage.total_output_tokens == null && usage.total_thought_tokens == null ? void 0 : totalOutput + totalThought,
      text: (_g = usage.total_output_tokens) != null ? _g : void 0,
      reasoning: (_h = usage.total_thought_tokens) != null ? _h : void 0
    },
    raw: usage
  };
}
function getGoogleInteractionsOutputTokensByModality(usage) {
  const byModality = usage == null ? void 0 : usage.output_tokens_by_modality;
  if (byModality == null) {
    return void 0;
  }
  const result = {};
  for (const entry of byModality) {
    if ((entry == null ? void 0 : entry.modality) != null && entry.tokens != null) {
      result[entry.modality] = entry.tokens;
    }
  }
  return Object.keys(result).length > 0 ? result : void 0;
}

// src/interactions/extract-google-interactions-sources.ts
var KNOWN_DOC_EXTENSIONS = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};
function inferDocMediaType(uriOrName) {
  const lower = uriOrName.toLowerCase();
  for (const [ext, media] of Object.entries(KNOWN_DOC_EXTENSIONS)) {
    if (lower.endsWith(`.${ext}`)) return media;
  }
  return "application/octet-stream";
}
function basename(uriOrName) {
  const parts = uriOrName.split("/");
  const last = parts[parts.length - 1];
  return last && last.length > 0 ? last : void 0;
}
function annotationToSource({
  annotation,
  generateId: generateId2
}) {
  var _a, _b, _c, _d, _e;
  switch (annotation.type) {
    case "url_citation": {
      const urlCitation = annotation;
      if (urlCitation.url == null || urlCitation.url.length === 0) {
        return void 0;
      }
      return {
        type: "source",
        sourceType: "url",
        id: generateId2(),
        url: urlCitation.url,
        ...urlCitation.title != null ? { title: urlCitation.title } : {}
      };
    }
    case "file_citation": {
      const fileCitation = annotation;
      const uri = (_b = (_a = fileCitation.url) != null ? _a : fileCitation.document_uri) != null ? _b : fileCitation.file_name;
      if (uri == null || uri.length === 0) return void 0;
      if (uri.startsWith("http://") || uri.startsWith("https://")) {
        return {
          type: "source",
          sourceType: "url",
          id: generateId2(),
          url: uri,
          ...fileCitation.file_name != null ? { title: fileCitation.file_name } : {}
        };
      }
      const filename = (_c = fileCitation.file_name) != null ? _c : basename(uri);
      const mediaType = inferDocMediaType(uri);
      return {
        type: "source",
        sourceType: "document",
        id: generateId2(),
        mediaType,
        title: (_e = (_d = fileCitation.file_name) != null ? _d : filename) != null ? _e : uri,
        ...filename != null ? { filename } : {}
      };
    }
    case "place_citation": {
      const placeCitation = annotation;
      if (placeCitation.url == null || placeCitation.url.length === 0) {
        return void 0;
      }
      return {
        type: "source",
        sourceType: "url",
        id: generateId2(),
        url: placeCitation.url,
        ...placeCitation.name != null ? { title: placeCitation.name } : {}
      };
    }
    default:
      return void 0;
  }
}
function builtinToolResultToSources({
  block,
  generateId: generateId2
}) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
  const sources = [];
  switch (block.type) {
    case "url_context_result": {
      const result = (_a = block.result) != null ? _a : [];
      for (const entry of result) {
        if ((entry == null ? void 0 : entry.url) == null || entry.url.length === 0) continue;
        if (entry.status != null && entry.status !== "success") continue;
        sources.push({
          type: "source",
          sourceType: "url",
          id: generateId2(),
          url: entry.url
        });
      }
      break;
    }
    case "google_search_result": {
      const result = (_b = block.result) != null ? _b : [];
      for (const entry of result) {
        const url = entry == null ? void 0 : entry.url;
        if (url == null || url.length === 0) continue;
        sources.push({
          type: "source",
          sourceType: "url",
          id: generateId2(),
          url,
          ...entry.title != null ? { title: entry.title } : {}
        });
      }
      break;
    }
    case "google_maps_result": {
      const result = (_c = block.result) != null ? _c : [];
      for (const entry of result) {
        for (const place of (_d = entry.places) != null ? _d : []) {
          if (place.url == null || place.url.length === 0) continue;
          sources.push({
            type: "source",
            sourceType: "url",
            id: generateId2(),
            url: place.url,
            ...place.name != null ? { title: place.name } : {}
          });
        }
      }
      break;
    }
    case "file_search_result": {
      const result = (_e = block.result) != null ? _e : [];
      for (const raw of result) {
        if (raw == null || typeof raw !== "object") continue;
        const entry = raw;
        const uri = (_g = (_f = entry.url) != null ? _f : entry.document_uri) != null ? _g : entry.file_name;
        if (uri == null || uri.length === 0) continue;
        if (uri.startsWith("http://") || uri.startsWith("https://")) {
          sources.push({
            type: "source",
            sourceType: "url",
            id: generateId2(),
            url: uri,
            ...entry.title != null ? { title: entry.title } : {}
          });
          continue;
        }
        const filename = (_h = entry.file_name) != null ? _h : basename(uri);
        const mediaType = inferDocMediaType(uri);
        sources.push({
          type: "source",
          sourceType: "document",
          id: generateId2(),
          mediaType,
          title: (_k = (_j = (_i = entry.title) != null ? _i : entry.file_name) != null ? _j : filename) != null ? _k : uri,
          ...filename != null ? { filename } : {}
        });
      }
      break;
    }
    default:
      break;
  }
  return sources;
}
function annotationsToSources({
  annotations,
  generateId: generateId2
}) {
  var _a;
  if (annotations == null) return [];
  const seen = /* @__PURE__ */ new Set();
  const sources = [];
  for (const annotation of annotations) {
    const source = annotationToSource({ annotation, generateId: generateId2 });
    if (source == null) continue;
    const key = source.sourceType === "url" ? `url:${source.url}` : `doc:${(_a = source.filename) != null ? _a : source.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  return sources;
}

// src/interactions/map-google-interactions-finish-reason.ts
function mapGoogleInteractionsFinishReason({
  status,
  hasFunctionCall
}) {
  switch (status) {
    case "completed":
      return hasFunctionCall ? "tool-calls" : "stop";
    case "requires_action":
      return "tool-calls";
    case "failed":
      return "error";
    case "incomplete":
      return "length";
    case "cancelled":
      return "other";
    case "in_progress":
    default:
      return "other";
  }
}

// src/interactions/build-google-interactions-stream-transform.ts
var BUILTIN_TOOL_CALL_TYPES = /* @__PURE__ */ new Set([
  "google_search_call",
  "code_execution_call",
  "url_context_call",
  "file_search_call",
  "google_maps_call",
  "mcp_server_tool_call"
]);
var BUILTIN_TOOL_RESULT_TYPES = /* @__PURE__ */ new Set([
  "google_search_result",
  "code_execution_result",
  "url_context_result",
  "file_search_result",
  "google_maps_result",
  "mcp_server_tool_result"
]);
function builtinToolNameFromCallType(type) {
  return type.replace(/_call$/, "");
}
function builtinToolNameFromResultType(type) {
  return type.replace(/_result$/, "");
}
function buildGoogleInteractionsStreamTransform({
  warnings,
  generateId: generateId2,
  includeRawChunks,
  serviceTier: headerServiceTier
}) {
  let interactionId;
  let usage;
  let serviceTier = headerServiceTier;
  let finishStatus;
  let hasFunctionCall = false;
  const openBlocks = /* @__PURE__ */ new Map();
  const emittedSourceKeys = /* @__PURE__ */ new Set();
  function sourceKey(source) {
    var _a;
    return source.sourceType === "url" ? `url:${source.url}` : `doc:${(_a = source.filename) != null ? _a : source.title}`;
  }
  return new TransformStream({
    start(controller) {
      controller.enqueue({ type: "stream-start", warnings });
    },
    transform(chunk, controller) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t;
      if (includeRawChunks) {
        controller.enqueue({ type: "raw", rawValue: chunk.rawValue });
      }
      if (!chunk.success) {
        finishStatus = "failed";
        controller.enqueue({ type: "error", error: chunk.error });
        return;
      }
      const value = chunk.value;
      const eventType = value.event_type;
      switch (eventType) {
        case "interaction.created": {
          const event = value;
          const interaction = event.interaction;
          interactionId = (interaction == null ? void 0 : interaction.id) != null && interaction.id.length > 0 ? interaction.id : void 0;
          const created = interaction == null ? void 0 : interaction.created;
          let timestamp;
          if (typeof created === "string") {
            const parsed = new Date(created);
            if (!Number.isNaN(parsed.getTime())) {
              timestamp = parsed;
            }
          }
          controller.enqueue({
            type: "response-metadata",
            ...interactionId != null ? { id: interactionId } : {},
            modelId: interaction == null ? void 0 : interaction.model,
            ...timestamp ? { timestamp } : {}
          });
          break;
        }
        case "step.start": {
          const event = value;
          const step = event.step;
          const index = event.index;
          const blockId = `${interactionId != null ? interactionId : "interaction"}:${index}`;
          const stepType = step == null ? void 0 : step.type;
          if (stepType === "model_output") {
            const initial = (_a = step == null ? void 0 : step.content) == null ? void 0 : _a[0];
            if ((initial == null ? void 0 : initial.type) === "text") {
              openBlocks.set(index, {
                kind: "text",
                id: blockId,
                emittedSourceKeys: /* @__PURE__ */ new Set()
              });
              controller.enqueue({ type: "text-start", id: blockId });
              const initialSources = annotationsToSources({
                annotations: initial.annotations,
                generateId: generateId2
              });
              for (const source of initialSources) {
                const key = sourceKey(source);
                if (emittedSourceKeys.has(key)) continue;
                emittedSourceKeys.add(key);
                controller.enqueue(source);
              }
            } else if ((initial == null ? void 0 : initial.type) === "image") {
              openBlocks.set(index, {
                kind: "image",
                id: blockId,
                ...initial.data != null ? { data: initial.data } : {},
                ...initial.mime_type != null ? { mimeType: initial.mime_type } : {},
                ...initial.uri != null ? { uri: initial.uri } : {}
              });
            } else {
              openBlocks.set(index, {
                kind: "pending_model_output",
                id: blockId
              });
            }
          } else if (stepType === "thought") {
            const signature = step == null ? void 0 : step.signature;
            openBlocks.set(index, {
              kind: "reasoning",
              id: blockId,
              ...signature != null ? { signature } : {}
            });
            controller.enqueue({ type: "reasoning-start", id: blockId });
            if (Array.isArray(step == null ? void 0 : step.summary)) {
              for (const item of step.summary) {
                if ((item == null ? void 0 : item.type) === "text" && typeof item.text === "string") {
                  controller.enqueue({
                    type: "reasoning-delta",
                    id: blockId,
                    delta: item.text
                  });
                }
              }
            }
          } else if (stepType === "function_call") {
            const toolCallId = (_b = step == null ? void 0 : step.id) != null ? _b : blockId;
            const toolName = (_c = step == null ? void 0 : step.name) != null ? _c : "unknown";
            hasFunctionCall = true;
            const state = {
              kind: "function_call",
              id: blockId,
              toolCallId,
              toolName,
              argumentsAccum: "",
              ...(step == null ? void 0 : step.signature) != null ? { signature: step.signature } : {}
            };
            openBlocks.set(index, state);
            controller.enqueue({
              type: "tool-input-start",
              id: toolCallId,
              toolName
            });
          } else if (stepType != null && BUILTIN_TOOL_CALL_TYPES.has(stepType)) {
            const toolName = stepType === "mcp_server_tool_call" ? (_d = step == null ? void 0 : step.name) != null ? _d : "mcp_server_tool" : builtinToolNameFromCallType(stepType);
            const toolCallId = (_e = step == null ? void 0 : step.id) != null ? _e : blockId;
            const state = {
              kind: "builtin_tool_call",
              id: blockId,
              blockType: stepType,
              toolCallId,
              toolName,
              arguments: (_f = step == null ? void 0 : step.arguments) != null ? _f : {},
              callEmitted: false
            };
            openBlocks.set(index, state);
          } else if (stepType != null && BUILTIN_TOOL_RESULT_TYPES.has(stepType)) {
            const toolName = stepType === "mcp_server_tool_result" ? (_g = step == null ? void 0 : step.name) != null ? _g : "mcp_server_tool" : builtinToolNameFromResultType(stepType);
            const callId = (_h = step == null ? void 0 : step.call_id) != null ? _h : blockId;
            const state = {
              kind: "builtin_tool_result",
              id: blockId,
              blockType: stepType,
              callId,
              toolName,
              result: (_i = step == null ? void 0 : step.result) != null ? _i : null,
              ...(step == null ? void 0 : step.is_error) != null ? { isError: step.is_error } : {},
              resultEmitted: false
            };
            openBlocks.set(index, state);
          } else {
            openBlocks.set(index, { kind: "unknown", id: blockId });
          }
          break;
        }
        case "step.delta": {
          const event = value;
          let open = openBlocks.get(event.index);
          if (open == null) break;
          const dtype = (_j = event.delta) == null ? void 0 : _j.type;
          if (open.kind === "pending_model_output") {
            if (dtype === "text" || dtype === "text_annotation" || dtype === "text_annotation_delta") {
              const promoted = {
                kind: "text",
                id: open.id,
                emittedSourceKeys: /* @__PURE__ */ new Set()
              };
              openBlocks.set(event.index, promoted);
              open = promoted;
              controller.enqueue({ type: "text-start", id: promoted.id });
            }
          }
          if (dtype === "image" && (open.kind === "pending_model_output" || open.kind === "text" || open.kind === "image")) {
            const imageDelta = event.delta;
            const google = {};
            if (interactionId != null) google.interactionId = interactionId;
            const providerMetadata = Object.keys(google).length > 0 ? { google } : void 0;
            if ((imageDelta == null ? void 0 : imageDelta.data) != null && imageDelta.data.length > 0) {
              controller.enqueue({
                type: "file",
                mediaType: (_k = imageDelta.mime_type) != null ? _k : "image/png",
                data: { type: "data", data: imageDelta.data },
                ...providerMetadata ? { providerMetadata } : {}
              });
            } else if ((imageDelta == null ? void 0 : imageDelta.uri) != null && imageDelta.uri.length > 0) {
              controller.enqueue({
                type: "file",
                mediaType: (_l = imageDelta.mime_type) != null ? _l : "image/png",
                data: { type: "url", url: new URL(imageDelta.uri) },
                ...providerMetadata ? { providerMetadata } : {}
              });
            }
            if (open.kind === "image") {
              open.data = void 0;
              open.uri = void 0;
            }
            break;
          }
          if (dtype === "video" && (open.kind === "pending_model_output" || open.kind === "text")) {
            const videoDelta = event.delta;
            const google = {};
            if (interactionId != null) google.interactionId = interactionId;
            const providerMetadata = Object.keys(google).length > 0 ? { google } : void 0;
            if ((videoDelta == null ? void 0 : videoDelta.data) != null && videoDelta.data.length > 0) {
              controller.enqueue({
                type: "file",
                mediaType: (_m = videoDelta.mime_type) != null ? _m : "video/mp4",
                data: { type: "data", data: videoDelta.data },
                ...providerMetadata ? { providerMetadata } : {}
              });
            } else if ((videoDelta == null ? void 0 : videoDelta.uri) != null && videoDelta.uri.length > 0) {
              controller.enqueue({
                type: "file",
                mediaType: (_n = videoDelta.mime_type) != null ? _n : "video/mp4",
                data: { type: "url", url: new URL(videoDelta.uri) },
                ...providerMetadata ? { providerMetadata } : {}
              });
            }
            break;
          }
          const delta = event.delta;
          if (open.kind === "text" && (delta == null ? void 0 : delta.type) === "text") {
            const text = (_o = delta.text) != null ? _o : "";
            if (text.length > 0) {
              controller.enqueue({
                type: "text-delta",
                id: open.id,
                delta: text
              });
            }
          } else if (open.kind === "text" && ((delta == null ? void 0 : delta.type) === "text_annotation" || (delta == null ? void 0 : delta.type) === "text_annotation_delta")) {
            const sources = annotationsToSources({
              annotations: delta.annotations,
              generateId: generateId2
            });
            for (const source of sources) {
              const key = sourceKey(source);
              if (emittedSourceKeys.has(key)) continue;
              emittedSourceKeys.add(key);
              open.emittedSourceKeys.add(key);
              controller.enqueue(source);
            }
          } else if (open.kind === "image" && (delta == null ? void 0 : delta.type) === "image") {
            if (delta.data != null) open.data = delta.data;
            if (delta.mime_type != null) open.mimeType = delta.mime_type;
            if (delta.uri != null) open.uri = delta.uri;
          } else if (open.kind === "reasoning") {
            if ((delta == null ? void 0 : delta.type) === "thought_summary") {
              const item = delta.content;
              if ((item == null ? void 0 : item.type) === "text" && typeof item.text === "string") {
                controller.enqueue({
                  type: "reasoning-delta",
                  id: open.id,
                  delta: item.text
                });
              }
            } else if ((delta == null ? void 0 : delta.type) === "thought_signature") {
              const signature = delta.signature;
              if (signature != null) {
                open.signature = signature;
              }
            }
          } else if (open.kind === "function_call" && (delta == null ? void 0 : delta.type) === "arguments_delta") {
            const slice = typeof delta.arguments === "string" ? delta.arguments : "";
            if (slice.length > 0) {
              open.argumentsAccum += slice;
              controller.enqueue({
                type: "tool-input-delta",
                id: open.toolCallId,
                delta: slice
              });
            }
            if (delta.id != null) {
              open.toolCallId = delta.id;
            }
            if (delta.signature != null) {
              open.signature = delta.signature;
            }
            hasFunctionCall = true;
          } else if (open.kind === "builtin_tool_call" && (delta == null ? void 0 : delta.type) === open.blockType) {
            if (delta.id != null) open.toolCallId = delta.id;
            if (delta.arguments != null && typeof delta.arguments === "object") {
              open.arguments = delta.arguments;
            }
            if (delta.name != null && open.blockType === "mcp_server_tool_call") {
              open.toolName = delta.name;
            }
          } else if (open.kind === "builtin_tool_result" && (delta == null ? void 0 : delta.type) === open.blockType) {
            if (delta.call_id != null) open.callId = delta.call_id;
            if (delta.result !== void 0) open.result = delta.result;
            if (delta.is_error != null) open.isError = delta.is_error;
            if (delta.name != null && open.blockType === "mcp_server_tool_result") {
              open.toolName = delta.name;
            }
          }
          break;
        }
        case "step.stop": {
          const event = value;
          const open = openBlocks.get(event.index);
          if (open == null) break;
          if (open.kind === "text") {
            const textProviderMetadata = interactionId != null ? { google: { interactionId } } : void 0;
            controller.enqueue({
              type: "text-end",
              id: open.id,
              ...textProviderMetadata ? { providerMetadata: textProviderMetadata } : {}
            });
          } else if (open.kind === "reasoning") {
            const google = {};
            if (open.signature != null) google.signature = open.signature;
            if (interactionId != null) google.interactionId = interactionId;
            const providerMetadata = Object.keys(google).length > 0 ? { google } : void 0;
            controller.enqueue({
              type: "reasoning-end",
              id: open.id,
              ...providerMetadata ? { providerMetadata } : {}
            });
          } else if (open.kind === "image") {
            const google = {};
            if (interactionId != null) google.interactionId = interactionId;
            const providerMetadata = Object.keys(google).length > 0 ? { google } : void 0;
            if (open.data != null && open.data.length > 0) {
              controller.enqueue({
                type: "file",
                mediaType: (_p = open.mimeType) != null ? _p : "image/png",
                data: { type: "data", data: open.data },
                ...providerMetadata ? { providerMetadata } : {}
              });
            } else if (open.uri != null && open.uri.length > 0) {
              controller.enqueue({
                type: "file",
                mediaType: (_q = open.mimeType) != null ? _q : "image/png",
                data: { type: "url", url: new URL(open.uri) },
                ...providerMetadata ? { providerMetadata } : {}
              });
            }
          } else if (open.kind === "function_call") {
            const accumulated = open.argumentsAccum.length > 0 ? open.argumentsAccum : "{}";
            controller.enqueue({
              type: "tool-input-end",
              id: open.toolCallId
            });
            const google = {};
            if (open.signature != null) google.signature = open.signature;
            if (interactionId != null) google.interactionId = interactionId;
            const providerMetadata = Object.keys(google).length > 0 ? { google } : void 0;
            controller.enqueue({
              type: "tool-call",
              toolCallId: open.toolCallId,
              toolName: open.toolName,
              input: accumulated,
              ...providerMetadata ? { providerMetadata } : {}
            });
          } else if (open.kind === "builtin_tool_call" && !open.callEmitted) {
            controller.enqueue({
              type: "tool-call",
              toolCallId: open.toolCallId,
              toolName: open.toolName,
              input: JSON.stringify((_r = open.arguments) != null ? _r : {}),
              providerExecuted: true
            });
            open.callEmitted = true;
          } else if (open.kind === "builtin_tool_result" && !open.resultEmitted) {
            controller.enqueue({
              type: "tool-result",
              toolCallId: open.callId,
              toolName: open.toolName,
              result: (_s = open.result) != null ? _s : null
            });
            open.resultEmitted = true;
            const sources = builtinToolResultToSources({
              block: {
                type: open.blockType,
                call_id: open.callId,
                result: open.result
              },
              generateId: generateId2
            });
            for (const source of sources) {
              const key = sourceKey(source);
              if (emittedSourceKeys.has(key)) continue;
              emittedSourceKeys.add(key);
              controller.enqueue(source);
            }
          }
          openBlocks.delete(event.index);
          break;
        }
        case "interaction.status_update":
        case "interaction.in_progress":
        case "interaction.requires_action": {
          const event = value;
          if (event.status != null) {
            finishStatus = event.status;
          } else if (eventType === "interaction.requires_action") {
            finishStatus = "requires_action";
          } else {
            finishStatus = "in_progress";
          }
          break;
        }
        case "interaction.completed": {
          const event = value;
          const interaction = event.interaction;
          if ((interaction == null ? void 0 : interaction.id) != null && interaction.id.length > 0) {
            interactionId = interaction.id;
          }
          if ((interaction == null ? void 0 : interaction.status) != null) {
            finishStatus = interaction.status;
          }
          if ((interaction == null ? void 0 : interaction.usage) != null) {
            usage = interaction.usage;
          }
          if ((interaction == null ? void 0 : interaction.service_tier) != null) {
            serviceTier = interaction.service_tier;
          }
          break;
        }
        case "error": {
          const event = value;
          finishStatus = "failed";
          const errorPayload = (_t = event.error) != null ? _t : {
            message: "Unknown interaction error"
          };
          controller.enqueue({ type: "error", error: errorPayload });
          break;
        }
        default:
          break;
      }
    },
    flush(controller) {
      const finishReason = {
        unified: mapGoogleInteractionsFinishReason({
          status: finishStatus,
          hasFunctionCall
        }),
        raw: finishStatus
      };
      const outputTokensByModality = getGoogleInteractionsOutputTokensByModality(usage);
      const providerMetadata = {
        google: {
          ...interactionId != null ? { interactionId } : {},
          ...serviceTier != null ? { serviceTier } : {},
          ...outputTokensByModality != null ? { outputTokensByModality } : {}
        }
      };
      controller.enqueue({
        type: "finish",
        finishReason,
        usage: convertGoogleInteractionsUsage(usage),
        providerMetadata
      });
    }
  });
}

// src/interactions/convert-to-google-interactions-input.ts
import {
  convertToBase64 as convertToBase642,
  getTopLevelMediaType as getTopLevelMediaType2,
  isFullMediaType as isFullMediaType2,
  resolveFullMediaType as resolveFullMediaType2,
  resolveProviderReference as resolveProviderReference2,
  secureJsonParse as secureJsonParse2
} from "@ai-sdk/provider-utils";
function convertToGoogleInteractionsInput({
  prompt,
  previousInteractionId,
  store,
  mediaResolution
}) {
  var _a, _b, _c, _d, _e, _f, _g;
  const warnings = [];
  const incoherentCombo = previousInteractionId != null && store === false;
  const shouldCompact = previousInteractionId != null && store !== false;
  if (incoherentCombo) {
    warnings.push({
      type: "other",
      message: "google.interactions: providerOptions.google.previousInteractionId was set together with store: false. These are incoherent (the prior interaction cannot be referenced when nothing was stored on the server); the full history will be sent and previous_interaction_id will still be emitted."
    });
  }
  const compactedPrompt = shouldCompact ? compactPromptForPreviousInteraction({
    prompt,
    previousInteractionId
  }) : prompt;
  const systemTexts = [];
  const steps = [];
  for (const message of compactedPrompt) {
    switch (message.role) {
      case "system": {
        systemTexts.push(message.content);
        break;
      }
      case "user": {
        const content = [];
        for (const part of message.content) {
          if (part.type === "text") {
            content.push({ type: "text", text: part.text });
          } else if (part.type === "file") {
            const fileBlock = convertFilePartToContent({
              part,
              warnings,
              mediaResolution
            });
            if (fileBlock != null) {
              content.push(fileBlock);
            }
          }
        }
        const merged = mergeAdjacentTextContent(content);
        if (merged.length > 0) {
          steps.push({ type: "user_input", content: merged });
        }
        break;
      }
      case "assistant": {
        let pendingModelOutput = [];
        const flushModelOutput = () => {
          if (pendingModelOutput.length > 0) {
            steps.push({ type: "model_output", content: pendingModelOutput });
            pendingModelOutput = [];
          }
        };
        for (const part of message.content) {
          if (part.type === "text") {
            pendingModelOutput.push({ type: "text", text: part.text });
          } else if (part.type === "reasoning") {
            flushModelOutput();
            const signature = (_b = (_a = part.providerOptions) == null ? void 0 : _a.google) == null ? void 0 : _b.signature;
            steps.push({
              type: "thought",
              ...signature != null ? { signature } : {},
              summary: part.text.length > 0 ? [{ type: "text", text: part.text }] : void 0
            });
          } else if (part.type === "file") {
            const fileBlock = convertFilePartToContent({
              part,
              warnings,
              mediaResolution
            });
            if (fileBlock != null) {
              pendingModelOutput.push(fileBlock);
            }
          } else if (part.type === "tool-call") {
            flushModelOutput();
            const signature = (_d = (_c = part.providerOptions) == null ? void 0 : _c.google) == null ? void 0 : _d.signature;
            const args = typeof part.input === "string" ? safeParseToolArgs(part.input) : (_e = part.input) != null ? _e : {};
            steps.push({
              type: "function_call",
              id: part.toolCallId,
              name: part.toolName,
              arguments: args,
              ...signature != null ? { signature } : {}
            });
          } else {
            warnings.push({
              type: "other",
              message: `google.interactions: unsupported assistant content part type "${part.type}"; part dropped.`
            });
          }
        }
        flushModelOutput();
        break;
      }
      case "tool": {
        const content = [];
        for (const part of message.content) {
          if (part.type !== "tool-result") {
            warnings.push({
              type: "other",
              message: `google.interactions: unsupported tool message part type "${part.type}"; part dropped.`
            });
            continue;
          }
          const block = convertToolResultPart({
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: part.output,
            signature: (_g = (_f = part.providerOptions) == null ? void 0 : _f.google) == null ? void 0 : _g.signature,
            warnings
          });
          content.push(block);
        }
        if (content.length > 0) {
          steps.push({ type: "user_input", content });
        }
        break;
      }
    }
  }
  const systemInstruction = systemTexts.length > 0 ? systemTexts.join("\n\n") : void 0;
  return { input: steps, systemInstruction, warnings };
}
function convertFilePartToContent({
  part,
  warnings,
  mediaResolution
}) {
  if (part.data.type === "text") {
    return {
      type: "text",
      text: part.data.text
    };
  }
  const topLevel = getTopLevelMediaType2(part.mediaType);
  let kind;
  switch (topLevel) {
    case "image":
      kind = "image";
      break;
    case "audio":
      kind = "audio";
      break;
    case "video":
      kind = "video";
      break;
    case "application":
    case "text":
      kind = "document";
      break;
    default:
      kind = void 0;
  }
  if (kind == null) {
    warnings.push({
      type: "other",
      message: `google.interactions: unsupported file media type "${part.mediaType}"; part dropped.`
    });
    return void 0;
  }
  const resolutionField = mediaResolution != null && (kind === "image" || kind === "video") ? { resolution: mediaResolution } : {};
  switch (part.data.type) {
    case "data": {
      const mimeType = resolveFullMediaType2({ part });
      return {
        type: kind,
        data: convertToBase642(part.data.data),
        mime_type: mimeType,
        ...resolutionField
      };
    }
    case "url": {
      return {
        type: kind,
        uri: part.data.url.toString(),
        ...isFullMediaType2(part.mediaType) ? { mime_type: part.mediaType } : {},
        ...resolutionField
      };
    }
    case "reference": {
      const uri = resolveProviderReference2({
        reference: part.data.reference,
        provider: "google"
      });
      return {
        type: kind,
        uri,
        ...isFullMediaType2(part.mediaType) ? { mime_type: part.mediaType } : {},
        ...resolutionField
      };
    }
  }
}
function compactPromptForPreviousInteraction({
  prompt,
  previousInteractionId
}) {
  const out = [];
  const droppedToolCallIds = /* @__PURE__ */ new Set();
  for (const message of prompt) {
    if (message.role === "assistant") {
      const matchesLinkedInteraction = message.content.some((part) => {
        var _a, _b;
        const partInteractionId = (_b = (_a = part.providerOptions) == null ? void 0 : _a.google) == null ? void 0 : _b.interactionId;
        return partInteractionId === previousInteractionId;
      });
      if (matchesLinkedInteraction) {
        for (const part of message.content) {
          if (part.type === "tool-call") {
            droppedToolCallIds.add(part.toolCallId);
          }
        }
        continue;
      }
      out.push(message);
      continue;
    }
    if (message.role === "tool") {
      const remaining = message.content.filter((part) => {
        if (part.type !== "tool-result") {
          return true;
        }
        return !droppedToolCallIds.has(part.toolCallId);
      });
      if (remaining.length === 0) {
        continue;
      }
      out.push({
        ...message,
        content: remaining
      });
      continue;
    }
    out.push(message);
  }
  return out;
}
function safeParseToolArgs(input) {
  try {
    const parsed = secureJsonParse2(input);
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return { value: parsed };
  } catch (e) {
    return { value: input };
  }
}
function convertToolResultPart({
  toolCallId,
  toolName,
  output,
  signature,
  warnings
}) {
  var _a;
  const base = {
    type: "function_result",
    call_id: toolCallId,
    name: toolName,
    ...signature != null ? { signature } : {}
  };
  switch (output.type) {
    case "text":
      return { ...base, result: output.value };
    case "json":
      return { ...base, result: JSON.stringify(output.value) };
    case "error-text":
      return { ...base, is_error: true, result: output.value };
    case "error-json":
      return { ...base, is_error: true, result: JSON.stringify(output.value) };
    case "execution-denied":
      return {
        ...base,
        is_error: true,
        result: (_a = output.reason) != null ? _a : "Tool execution denied by user."
      };
    case "content": {
      const blocks = [];
      for (const item of output.value) {
        if (item.type === "text") {
          blocks.push({ type: "text", text: item.text });
        } else if (item.type === "file") {
          const topLevel = getTopLevelMediaType2(item.mediaType);
          if (topLevel !== "image") {
            warnings.push({
              type: "other",
              message: `google.interactions: tool-result file with mediaType "${item.mediaType}" is not supported (Interactions \`function_result.result\` accepts only text and image content); part dropped.`
            });
            continue;
          }
          const imageBlock = filePartToImageBlock({ part: item, warnings });
          if (imageBlock != null) {
            blocks.push(imageBlock);
          }
        } else {
          warnings.push({
            type: "other",
            message: `google.interactions: tool-result content part type "${item.type}" is not supported; part dropped.`
          });
        }
      }
      return { ...base, result: blocks };
    }
  }
}
function filePartToImageBlock({
  part,
  warnings
}) {
  switch (part.data.type) {
    case "data": {
      const mimeType = isFullMediaType2(part.mediaType) ? part.mediaType : resolveFullMediaType2({
        part: {
          type: "file",
          mediaType: part.mediaType,
          data: part.data
        }
      });
      return {
        type: "image",
        data: convertToBase642(part.data.data),
        mime_type: mimeType
      };
    }
    case "url":
      return {
        type: "image",
        uri: part.data.url.toString(),
        ...isFullMediaType2(part.mediaType) ? { mime_type: part.mediaType } : {}
      };
    case "reference": {
      const uri = resolveProviderReference2({
        reference: part.data.reference,
        provider: "google"
      });
      return {
        type: "image",
        uri,
        ...isFullMediaType2(part.mediaType) ? { mime_type: part.mediaType } : {}
      };
    }
    case "text": {
      warnings.push({
        type: "other",
        message: 'google.interactions: tool-result image part with `data.type === "text"` is not representable as an image; part dropped.'
      });
      return void 0;
    }
  }
}
function mergeAdjacentTextContent(content) {
  if (content.length < 2) {
    return content;
  }
  const result = [];
  for (const block of content) {
    const last = result[result.length - 1];
    if (block.type === "text" && last != null && last.type === "text" && last.annotations == null && block.annotations == null) {
      const merged = {
        type: "text",
        text: `${last.text}

${block.text}`
      };
      result[result.length - 1] = merged;
      continue;
    }
    result.push(block);
  }
  return result;
}

// src/interactions/google-interactions-api.ts
import {
  lazySchema as lazySchema12,
  zodSchema as zodSchema12
} from "@ai-sdk/provider-utils";
import { z as z13 } from "zod/v4";
var tokenByModalitySchema = () => z13.object({
  modality: z13.string().nullish(),
  tokens: z13.number().nullish()
}).loose();
var usageSchema2 = () => z13.object({
  total_input_tokens: z13.number().nullish(),
  total_output_tokens: z13.number().nullish(),
  total_thought_tokens: z13.number().nullish(),
  total_cached_tokens: z13.number().nullish(),
  total_tool_use_tokens: z13.number().nullish(),
  total_tokens: z13.number().nullish(),
  input_tokens_by_modality: z13.array(tokenByModalitySchema()).nullish(),
  output_tokens_by_modality: z13.array(tokenByModalitySchema()).nullish(),
  cached_tokens_by_modality: z13.array(tokenByModalitySchema()).nullish(),
  tool_use_tokens_by_modality: z13.array(tokenByModalitySchema()).nullish(),
  grounding_tool_count: z13.array(
    z13.object({
      type: z13.string().nullish(),
      count: z13.number().nullish()
    }).loose()
  ).nullish()
}).loose();
var interactionStatusSchema = () => z13.enum([
  "in_progress",
  "requires_action",
  "completed",
  "failed",
  "cancelled",
  "incomplete"
]);
var annotationSchema = () => {
  const urlCitation = z13.object({
    type: z13.literal("url_citation"),
    url: z13.string().nullish(),
    title: z13.string().nullish(),
    start_index: z13.number().nullish(),
    end_index: z13.number().nullish()
  }).loose();
  const fileCitation = z13.object({
    type: z13.literal("file_citation"),
    file_name: z13.string().nullish(),
    document_uri: z13.string().nullish(),
    url: z13.string().nullish(),
    page_number: z13.number().nullish(),
    media_id: z13.string().nullish(),
    start_index: z13.number().nullish(),
    end_index: z13.number().nullish(),
    custom_metadata: z13.record(z13.string(), z13.unknown()).nullish()
  }).loose();
  const placeCitation = z13.object({
    type: z13.literal("place_citation"),
    name: z13.string().nullish(),
    url: z13.string().nullish(),
    place_id: z13.string().nullish(),
    start_index: z13.number().nullish(),
    end_index: z13.number().nullish()
  }).loose();
  return z13.union([
    urlCitation,
    fileCitation,
    placeCitation,
    z13.object({ type: z13.string() }).loose()
  ]);
};
var thoughtSummaryItemSchema = () => z13.object({
  type: z13.string(),
  text: z13.string().nullish(),
  data: z13.string().nullish(),
  mime_type: z13.string().nullish()
}).loose();
var contentBlockSchema = () => {
  const textContent = z13.object({
    type: z13.literal("text"),
    text: z13.string(),
    annotations: z13.array(annotationSchema()).nullish()
  }).loose();
  const imageContent = z13.object({
    type: z13.literal("image"),
    data: z13.string().nullish(),
    mime_type: z13.string().nullish(),
    resolution: z13.enum(["low", "medium", "high", "ultra_high"]).nullish(),
    uri: z13.string().nullish()
  }).loose();
  const videoContent = z13.object({
    type: z13.literal("video"),
    data: z13.string().nullish(),
    mime_type: z13.string().nullish(),
    uri: z13.string().nullish()
  }).loose();
  return z13.union([
    textContent,
    imageContent,
    videoContent,
    z13.object({ type: z13.string() }).loose()
  ]);
};
var BUILTIN_TOOL_CALL_STEP_TYPES = [
  "google_search_call",
  "code_execution_call",
  "url_context_call",
  "file_search_call",
  "google_maps_call",
  "mcp_server_tool_call"
];
var BUILTIN_TOOL_RESULT_STEP_TYPES = [
  "google_search_result",
  "code_execution_result",
  "url_context_result",
  "file_search_result",
  "google_maps_result",
  "mcp_server_tool_result"
];
var stepSchema = () => {
  const userInputStep = z13.object({
    type: z13.literal("user_input"),
    content: z13.array(contentBlockSchema()).nullish()
  }).loose();
  const modelOutputStep = z13.object({
    type: z13.literal("model_output"),
    content: z13.array(contentBlockSchema()).nullish()
  }).loose();
  const functionCallStep = z13.object({
    type: z13.literal("function_call"),
    id: z13.string(),
    name: z13.string(),
    arguments: z13.record(z13.string(), z13.unknown()).nullish(),
    signature: z13.string().nullish()
  }).loose();
  const thoughtStep = z13.object({
    type: z13.literal("thought"),
    signature: z13.string().nullish(),
    summary: z13.array(thoughtSummaryItemSchema()).nullish()
  }).loose();
  const builtinToolCallStep = z13.object({
    type: z13.enum(BUILTIN_TOOL_CALL_STEP_TYPES),
    id: z13.string(),
    arguments: z13.record(z13.string(), z13.unknown()).nullish(),
    name: z13.string().nullish(),
    server_name: z13.string().nullish(),
    search_type: z13.string().nullish(),
    signature: z13.string().nullish()
  }).loose();
  const builtinToolResultStep = z13.object({
    type: z13.enum(BUILTIN_TOOL_RESULT_STEP_TYPES),
    call_id: z13.string(),
    result: z13.unknown().nullish(),
    is_error: z13.boolean().nullish(),
    name: z13.string().nullish(),
    server_name: z13.string().nullish(),
    signature: z13.string().nullish()
  }).loose();
  return z13.union([
    userInputStep,
    modelOutputStep,
    functionCallStep,
    thoughtStep,
    builtinToolCallStep,
    builtinToolResultStep,
    z13.object({ type: z13.string() }).loose()
  ]);
};
var googleInteractionsResponseSchema = lazySchema12(
  () => zodSchema12(
    z13.object({
      /*
       * `id` is omitted from the response body when `store: false` (fully
       * stateless mode) — there is no server-side interaction record for the
       * client to reference. `nullish` lets the schema accept that shape.
       */
      id: z13.string().nullish(),
      created: z13.string().nullish(),
      updated: z13.string().nullish(),
      status: interactionStatusSchema(),
      model: z13.string().nullish(),
      agent: z13.string().nullish(),
      steps: z13.array(stepSchema()).nullish(),
      usage: usageSchema2().nullish(),
      service_tier: z13.string().nullish(),
      previous_interaction_id: z13.string().nullish(),
      response_modalities: z13.array(z13.string()).nullish()
    }).loose()
  )
);
var googleInteractionsEventSchema = lazySchema12(
  () => zodSchema12(
    (() => {
      const status = interactionStatusSchema();
      const annotation = annotationSchema();
      const thoughtSummaryItem = thoughtSummaryItemSchema();
      const interactionCreatedEvent = z13.object({
        event_type: z13.literal("interaction.created"),
        event_id: z13.string().nullish(),
        interaction: z13.object({
          /*
           * `id` is omitted when `store: false` (fully stateless mode);
           * see the matching note on `googleInteractionsResponseSchema.id`.
           */
          id: z13.string().nullish(),
          created: z13.string().nullish(),
          model: z13.string().nullish(),
          agent: z13.string().nullish(),
          status: status.nullish()
        }).loose()
      }).loose();
      const stepStartEvent = z13.object({
        event_type: z13.literal("step.start"),
        event_id: z13.string().nullish(),
        index: z13.number(),
        step: stepSchema()
      }).loose();
      const stepDeltaText = z13.object({
        type: z13.literal("text"),
        text: z13.string()
      }).loose();
      const stepDeltaThoughtSummary = z13.object({
        type: z13.literal("thought_summary"),
        content: thoughtSummaryItem.nullish()
      }).loose();
      const stepDeltaThoughtSignature = z13.object({
        type: z13.literal("thought_signature"),
        signature: z13.string().nullish()
      }).loose();
      const stepDeltaArgumentsDelta = z13.object({
        type: z13.literal("arguments_delta"),
        arguments: z13.string().nullish(),
        id: z13.string().nullish(),
        signature: z13.string().nullish()
      }).loose();
      const stepDeltaTextAnnotation = z13.object({
        type: z13.enum(["text_annotation_delta", "text_annotation"]),
        annotations: z13.array(annotation).nullish()
      }).loose();
      const stepDeltaImage = z13.object({
        type: z13.literal("image"),
        data: z13.string().nullish(),
        mime_type: z13.string().nullish(),
        resolution: z13.enum(["low", "medium", "high", "ultra_high"]).nullish(),
        uri: z13.string().nullish()
      }).loose();
      const stepDeltaVideo = z13.object({
        type: z13.literal("video"),
        data: z13.string().nullish(),
        mime_type: z13.string().nullish(),
        uri: z13.string().nullish()
      }).loose();
      const stepDeltaBuiltinToolCall = z13.object({
        type: z13.enum(BUILTIN_TOOL_CALL_STEP_TYPES),
        id: z13.string().nullish(),
        arguments: z13.record(z13.string(), z13.unknown()).nullish(),
        name: z13.string().nullish(),
        server_name: z13.string().nullish(),
        search_type: z13.string().nullish(),
        signature: z13.string().nullish()
      }).loose();
      const stepDeltaBuiltinToolResult = z13.object({
        type: z13.enum(BUILTIN_TOOL_RESULT_STEP_TYPES),
        call_id: z13.string().nullish(),
        result: z13.unknown().nullish(),
        is_error: z13.boolean().nullish(),
        name: z13.string().nullish(),
        server_name: z13.string().nullish(),
        signature: z13.string().nullish()
      }).loose();
      const stepDeltaUnknown = z13.object({ type: z13.string() }).loose();
      const stepDeltaUnion = z13.union([
        stepDeltaText,
        stepDeltaImage,
        stepDeltaVideo,
        stepDeltaThoughtSummary,
        stepDeltaThoughtSignature,
        stepDeltaArgumentsDelta,
        stepDeltaTextAnnotation,
        stepDeltaBuiltinToolCall,
        stepDeltaBuiltinToolResult,
        stepDeltaUnknown
      ]);
      const stepDeltaEvent = z13.object({
        event_type: z13.literal("step.delta"),
        event_id: z13.string().nullish(),
        index: z13.number(),
        delta: stepDeltaUnion
      }).loose();
      const stepStopEvent = z13.object({
        event_type: z13.literal("step.stop"),
        event_id: z13.string().nullish(),
        index: z13.number()
      }).loose();
      const interactionStatusUpdateEvent = z13.object({
        event_type: z13.literal("interaction.status_update"),
        event_id: z13.string().nullish(),
        interaction_id: z13.string().nullish(),
        status: status.nullish()
      }).loose();
      const interactionInProgressEvent = z13.object({
        event_type: z13.literal("interaction.in_progress"),
        event_id: z13.string().nullish(),
        interaction_id: z13.string().nullish(),
        status: status.nullish()
      }).loose();
      const interactionRequiresActionEvent = z13.object({
        event_type: z13.literal("interaction.requires_action"),
        event_id: z13.string().nullish(),
        interaction_id: z13.string().nullish(),
        status: status.nullish()
      }).loose();
      const interactionCompletedEvent = z13.object({
        event_type: z13.literal("interaction.completed"),
        event_id: z13.string().nullish(),
        interaction: z13.object({
          id: z13.string().nullish(),
          status: status.nullish(),
          usage: usageSchema2().nullish(),
          service_tier: z13.string().nullish()
        }).loose()
      }).loose();
      const errorEvent = z13.object({
        event_type: z13.literal("error"),
        event_id: z13.string().nullish(),
        error: z13.object({
          code: z13.string().nullish(),
          message: z13.string().nullish()
        }).loose().nullish()
      }).loose();
      const unknownEvent = z13.object({ event_type: z13.string() }).loose();
      return z13.union([
        interactionCreatedEvent,
        stepStartEvent,
        stepDeltaEvent,
        stepStopEvent,
        interactionStatusUpdateEvent,
        interactionInProgressEvent,
        interactionRequiresActionEvent,
        interactionCompletedEvent,
        errorEvent,
        unknownEvent
      ]);
    })()
  )
);

// src/interactions/google-interactions-language-model-options.ts
import {
  lazySchema as lazySchema13,
  zodSchema as zodSchema13
} from "@ai-sdk/provider-utils";
import { z as z14 } from "zod/v4";
var googleInteractionsLanguageModelOptions = lazySchema13(
  () => zodSchema13(
    z14.object({
      previousInteractionId: z14.string().nullish(),
      store: z14.boolean().nullish(),
      agent: z14.string().nullish(),
      agentConfig: z14.union([
        z14.object({
          type: z14.literal("dynamic")
        }).loose(),
        z14.object({
          type: z14.literal("deep-research"),
          thinkingSummaries: z14.enum(["auto", "none"]).nullish(),
          visualization: z14.enum(["off", "auto"]).nullish(),
          collaborativePlanning: z14.boolean().nullish()
        })
      ]).nullish(),
      thinkingLevel: z14.enum(["minimal", "low", "medium", "high"]).nullish(),
      thinkingSummaries: z14.enum(["auto", "none"]).nullish(),
      /**
       * Output-format entries that map directly to the API's `response_format`
       * array. Use this to request image, audio, or non-JSON text outputs
       * with full control over `mime_type`, `aspect_ratio`, and `image_size`.
       *
       * Entries are sent in order. The AI SDK call-level `responseFormat: {
       * type: 'json', schema }` still drives JSON-mode and adds a matching
       * text entry automatically; entries listed here are appended.
       */
      responseFormat: z14.array(
        z14.union([
          z14.object({
            type: z14.literal("text"),
            mimeType: z14.string().nullish(),
            schema: z14.unknown().nullish()
          }).loose(),
          z14.object({
            type: z14.literal("image"),
            mimeType: z14.string().nullish(),
            aspectRatio: z14.enum([
              "1:1",
              "2:3",
              "3:2",
              "3:4",
              "4:3",
              "4:5",
              "5:4",
              "9:16",
              "16:9",
              "21:9",
              "1:8",
              "8:1",
              "1:4",
              "4:1"
            ]).nullish(),
            imageSize: z14.enum(["1K", "2K", "4K", "512"]).nullish()
          }).loose(),
          z14.object({
            type: z14.literal("audio"),
            mimeType: z14.string().nullish()
          }).loose()
        ])
      ).nullish(),
      /**
       * @deprecated Use `responseFormat` with a `{ type: 'image', ... }`
       * entry instead. Retained for backwards compatibility; the SDK
       * translates it into a matching `response_format` image entry and
       * emits a warning when set.
       */
      imageConfig: z14.object({
        aspectRatio: z14.enum([
          "1:1",
          "2:3",
          "3:2",
          "3:4",
          "4:3",
          "4:5",
          "5:4",
          "9:16",
          "16:9",
          "21:9",
          "1:8",
          "8:1",
          "1:4",
          "4:1"
        ]).nullish(),
        imageSize: z14.enum(["1K", "2K", "4K", "512"]).nullish()
      }).nullish(),
      mediaResolution: z14.enum(["low", "medium", "high", "ultra_high"]).nullish(),
      responseModalities: z14.array(z14.enum(["text", "image", "audio", "video", "document"])).nullish(),
      serviceTier: z14.enum(["flex", "standard", "priority"]).nullish(),
      /**
       * Alternative to AI SDK `system` message. If both are set, the AI SDK
       * `system` message wins and a warning is emitted.
       */
      systemInstruction: z14.string().nullish(),
      /**
       * Per-block signature for round-tripping `thought.signature` and
       * `function_call.signature` blocks. Set by the SDK on output reasoning /
       * tool-call parts; passed back unchanged on input parts so the API
       * accepts the prior turn.
       */
      signature: z14.string().nullish(),
      /**
       * Set by the SDK on output assistant messages. The converter uses it to
       * decide which messages to drop when compacting under
       * `previousInteractionId`.
       */
      interactionId: z14.string().nullish(),
      /**
       * Maximum time, in milliseconds, to poll a background interaction (agent
       * call) before giving up. Defaults to 30 minutes. Long-running agents
       * such as deep research can take tens of minutes — increase if needed.
       */
      pollingTimeoutMs: z14.number().int().positive().nullish(),
      /**
       * Run the interaction in the background. Required for agents whose
       * server-side workflow cannot complete within a single request/response.
       * When `true`, the POST returns with a non-terminal status and the SDK
       * polls `GET /interactions/{id}` until the work completes. Some agents
       * reject `true`; see the agent's documentation for which mode it
       * requires.
       */
      background: z14.boolean().nullish(),
      /**
       * Environment configuration for the agent sandbox. Only applies to agent
       * calls (`google.interactions({ agent })`); ignored on model-id calls.
       *
       *   - `"remote"`: provision a fresh sandbox for this call.
       *   - any other string: an existing `environment_id` to reuse.
       *   - object: provision a fresh sandbox and optionally preload `sources`
       *     and/or constrain outbound traffic via `network`.
       */
      environment: z14.union([
        z14.string(),
        z14.object({
          type: z14.literal("remote"),
          sources: z14.array(
            z14.union([
              z14.object({
                type: z14.literal("gcs"),
                source: z14.string(),
                target: z14.string().nullish()
              }),
              z14.object({
                type: z14.literal("repository"),
                source: z14.string(),
                target: z14.string().nullish()
              }),
              z14.object({
                type: z14.literal("inline"),
                content: z14.string(),
                target: z14.string()
              })
            ])
          ).nullish(),
          network: z14.union([
            z14.literal("disabled"),
            z14.object({
              allowlist: z14.array(
                z14.object({
                  domain: z14.string(),
                  transform: z14.array(z14.record(z14.string(), z14.string())).nullish()
                })
              )
            })
          ]).nullish()
        })
      ]).nullish()
    })
  )
);

// src/interactions/parse-google-interactions-outputs.ts
function googleProviderMetadata({
  signature,
  interactionId
}) {
  const google = {};
  if (signature != null) {
    google.signature = signature;
  }
  if (interactionId != null) {
    google.interactionId = interactionId;
  }
  return Object.keys(google).length > 0 ? { providerMetadata: { google } } : {};
}
var BUILTIN_TOOL_CALL_TYPES2 = /* @__PURE__ */ new Set([
  "google_search_call",
  "code_execution_call",
  "url_context_call",
  "file_search_call",
  "google_maps_call",
  "mcp_server_tool_call"
]);
var BUILTIN_TOOL_RESULT_TYPES2 = /* @__PURE__ */ new Set([
  "google_search_result",
  "code_execution_result",
  "url_context_result",
  "file_search_result",
  "google_maps_result",
  "mcp_server_tool_result"
]);
function builtinToolNameFromCallType2(type) {
  return type.replace(/_call$/, "");
}
function builtinToolNameFromResultType2(type) {
  return type.replace(/_result$/, "");
}
function parseGoogleInteractionsOutputs({
  steps,
  generateId: generateId2,
  interactionId
}) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
  const content = [];
  let hasFunctionCall = false;
  if (steps == null) {
    return { content, hasFunctionCall };
  }
  for (const step of steps) {
    if (step == null || typeof step !== "object") continue;
    const type = step.type;
    if (typeof type !== "string") continue;
    switch (type) {
      case "user_input": {
        break;
      }
      case "model_output": {
        const blocks = (_a = step.content) != null ? _a : [];
        for (const block of blocks) {
          if (block == null || typeof block !== "object") continue;
          const blockType = block.type;
          if (blockType === "text") {
            const text = (_b = block.text) != null ? _b : "";
            const annotations = block.annotations;
            content.push({
              type: "text",
              text,
              ...googleProviderMetadata({ interactionId })
            });
            const sources = annotationsToSources({ annotations, generateId: generateId2 });
            for (const source of sources) {
              content.push(source);
            }
          } else if (blockType === "image") {
            const image = block;
            if (image.data != null && image.data.length > 0) {
              content.push({
                type: "file",
                mediaType: (_c = image.mime_type) != null ? _c : "image/png",
                data: { type: "data", data: image.data },
                ...googleProviderMetadata({ interactionId })
              });
            } else if (image.uri != null && image.uri.length > 0) {
              content.push({
                type: "file",
                mediaType: (_d = image.mime_type) != null ? _d : "image/png",
                data: { type: "url", url: new URL(image.uri) },
                ...googleProviderMetadata({ interactionId })
              });
            }
          } else if (blockType === "video") {
            const video = block;
            if (video.data != null && video.data.length > 0) {
              content.push({
                type: "file",
                mediaType: (_e = video.mime_type) != null ? _e : "video/mp4",
                data: { type: "data", data: video.data },
                ...googleProviderMetadata({ interactionId })
              });
            } else if (video.uri != null && video.uri.length > 0) {
              content.push({
                type: "file",
                mediaType: (_f = video.mime_type) != null ? _f : "video/mp4",
                data: { type: "url", url: new URL(video.uri) },
                ...googleProviderMetadata({ interactionId })
              });
            }
          }
        }
        break;
      }
      case "thought": {
        const thought = step;
        const summary = Array.isArray(thought.summary) ? thought.summary : [];
        const text = summary.filter(
          (item) => (item == null ? void 0 : item.type) === "text" && typeof item.text === "string"
        ).map((item) => item.text).join("\n");
        content.push({
          type: "reasoning",
          text,
          ...googleProviderMetadata({
            signature: thought.signature,
            interactionId
          })
        });
        break;
      }
      case "function_call": {
        hasFunctionCall = true;
        const call = step;
        content.push({
          type: "tool-call",
          toolCallId: call.id,
          toolName: call.name,
          input: JSON.stringify((_g = call.arguments) != null ? _g : {}),
          ...googleProviderMetadata({
            signature: call.signature,
            interactionId
          })
        });
        break;
      }
      default: {
        if (BUILTIN_TOOL_CALL_TYPES2.has(type)) {
          const call = step;
          const toolName = type === "mcp_server_tool_call" ? (_h = call.name) != null ? _h : "mcp_server_tool" : builtinToolNameFromCallType2(type);
          const input = JSON.stringify((_i = call.arguments) != null ? _i : {});
          content.push({
            type: "tool-call",
            toolCallId: (_j = call.id) != null ? _j : generateId2(),
            toolName,
            input,
            providerExecuted: true
          });
        } else if (BUILTIN_TOOL_RESULT_TYPES2.has(type)) {
          const result = step;
          const toolName = type === "mcp_server_tool_result" ? (_k = result.name) != null ? _k : "mcp_server_tool" : builtinToolNameFromResultType2(type);
          content.push({
            type: "tool-result",
            toolCallId: (_l = result.call_id) != null ? _l : generateId2(),
            toolName,
            result: (_m = result.result) != null ? _m : null
          });
          const sources = builtinToolResultToSources({
            block: step,
            generateId: generateId2
          });
          for (const source of sources) {
            content.push(source);
          }
        }
        break;
      }
    }
  }
  return { content, hasFunctionCall };
}

// src/interactions/poll-google-interactions.ts
import {
  createJsonResponseHandler as createJsonResponseHandler3,
  delay,
  getFromApi,
  isAbortError
} from "@ai-sdk/provider-utils";

// src/interactions/cancel-google-interaction.ts
import {
  combineHeaders as combineHeaders3,
  getRuntimeEnvironmentUserAgent,
  withUserAgentSuffix
} from "@ai-sdk/provider-utils";
var getOriginalFetch = () => globalThis.fetch;
async function cancelGoogleInteraction({
  baseURL,
  interactionId,
  headers,
  fetch = getOriginalFetch()
}) {
  if (interactionId == null || interactionId.length === 0) {
    return;
  }
  const url = `${baseURL}/interactions/${encodeURIComponent(interactionId)}/cancel`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: withUserAgentSuffix(
        combineHeaders3({ "Content-Type": "application/json" }, headers),
        getRuntimeEnvironmentUserAgent()
      ),
      body: "{}"
    });
    try {
      await response.text();
    } catch (e) {
    }
  } catch (e) {
  }
}

// src/interactions/poll-google-interactions.ts
var TERMINAL_STATUSES = /* @__PURE__ */ new Set(["completed", "failed", "cancelled", "incomplete"]);
function isTerminalStatus(status) {
  return status != null && TERMINAL_STATUSES.has(status);
}
var DEFAULT_INITIAL_DELAY_MS = 1e3;
var DEFAULT_MAX_DELAY_MS = 1e4;
var DEFAULT_TIMEOUT_MS = 30 * 60 * 1e3;
async function pollGoogleInteractionUntilTerminal({
  baseURL,
  interactionId,
  headers,
  fetch,
  abortSignal,
  initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  if (interactionId == null || interactionId.length === 0) {
    throw new Error(
      "google.interactions: cannot poll a background interaction without an id. The POST response did not include an interaction id."
    );
  }
  const startedAt = Date.now();
  let nextDelayMs = initialDelayMs;
  const url = `${baseURL}/interactions/${encodeURIComponent(interactionId)}`;
  const cancelOnServer = () => cancelGoogleInteraction({ baseURL, interactionId, headers, fetch });
  try {
    while (true) {
      if (abortSignal == null ? void 0 : abortSignal.aborted) {
        await cancelOnServer();
        throw new DOMException("Polling was aborted", "AbortError");
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `google.interactions: timed out polling interaction ${interactionId} after ${timeoutMs}ms.`
        );
      }
      await delay(nextDelayMs, { abortSignal });
      const {
        value: response,
        rawValue: rawResponse,
        responseHeaders
      } = await getFromApi({
        url,
        validateUrl: false,
        headers,
        failedResponseHandler: googleFailedResponseHandler,
        successfulResponseHandler: createJsonResponseHandler3(
          googleInteractionsResponseSchema
        ),
        abortSignal,
        fetch
      });
      if (isTerminalStatus(response.status)) {
        return { response, rawResponse, responseHeaders };
      }
      nextDelayMs = Math.min(nextDelayMs * 2, maxDelayMs);
    }
  } catch (error) {
    if (isAbortError(error)) {
      await cancelOnServer();
    }
    throw error;
  }
}

// src/interactions/prepare-google-interactions-tools.ts
function prepareGoogleInteractionsTools({
  tools,
  toolChoice
}) {
  var _a, _b, _c, _d;
  const toolWarnings = [];
  const normalized = (tools == null ? void 0 : tools.length) ? tools : void 0;
  if (normalized == null) {
    return { tools: void 0, toolChoice: void 0, toolWarnings };
  }
  const interactionsTools = [];
  for (const tool of normalized) {
    if (tool.type === "function") {
      interactionsTools.push({
        type: "function",
        name: tool.name,
        description: (_a = tool.description) != null ? _a : "",
        parameters: tool.inputSchema
      });
      continue;
    }
    if (tool.type === "provider") {
      const args = (_b = tool.args) != null ? _b : {};
      switch (tool.id) {
        case "google.google_search": {
          const searchTypesArg = args.searchTypes;
          let search_types;
          if (searchTypesArg != null && typeof searchTypesArg === "object") {
            const list = [];
            if (searchTypesArg.webSearch != null) list.push("web_search");
            if (searchTypesArg.imageSearch != null) list.push("image_search");
            if (list.length > 0) {
              search_types = list;
            }
          }
          interactionsTools.push({
            type: "google_search",
            ...search_types != null ? { search_types } : {}
          });
          break;
        }
        case "google.code_execution": {
          interactionsTools.push({ type: "code_execution" });
          break;
        }
        case "google.url_context": {
          interactionsTools.push({ type: "url_context" });
          break;
        }
        case "google.file_search": {
          interactionsTools.push({
            type: "file_search",
            ...args.fileSearchStoreNames != null ? {
              file_search_store_names: args.fileSearchStoreNames
            } : {},
            ...args.topK != null ? { top_k: args.topK } : {},
            ...args.metadataFilter != null ? { metadata_filter: args.metadataFilter } : {}
          });
          break;
        }
        case "google.google_maps": {
          interactionsTools.push({
            type: "google_maps",
            ...args.latitude != null ? { latitude: args.latitude } : {},
            ...args.longitude != null ? { longitude: args.longitude } : {},
            ...args.enableWidget != null ? { enable_widget: args.enableWidget } : {}
          });
          break;
        }
        case "google.computer_use": {
          interactionsTools.push({
            type: "computer_use",
            environment: (_c = args.environment) != null ? _c : "browser",
            ...args.excludedPredefinedFunctions != null ? {
              excludedPredefinedFunctions: args.excludedPredefinedFunctions
            } : {}
          });
          break;
        }
        case "google.mcp_server": {
          interactionsTools.push({
            type: "mcp_server",
            ...args.name != null ? { name: args.name } : {},
            ...args.url != null ? { url: args.url } : {},
            ...args.headers != null ? { headers: args.headers } : {},
            ...args.allowedTools != null ? { allowed_tools: args.allowedTools } : {}
          });
          break;
        }
        case "google.retrieval": {
          const vertexAiSearchConfig = (_d = args.vertexAiSearchConfig) != null ? _d : void 0;
          interactionsTools.push({
            type: "retrieval",
            ...args.retrievalTypes != null ? {
              retrieval_types: args.retrievalTypes
            } : { retrieval_types: ["vertex_ai_search"] },
            ...vertexAiSearchConfig != null ? { vertex_ai_search_config: vertexAiSearchConfig } : {}
          });
          break;
        }
        default: {
          toolWarnings.push({
            type: "unsupported",
            feature: `provider-defined tool ${tool.id}`,
            details: `provider-defined tool ${tool.id} is not supported by google.interactions; tool dropped.`
          });
          break;
        }
      }
      continue;
    }
    toolWarnings.push({
      type: "unsupported",
      feature: `tool of type ${tool.type}`,
      details: "Only function tools and google.* provider-defined tools are supported by google.interactions; tool dropped."
    });
  }
  const hasFunctionTool = interactionsTools.some((t) => t.type === "function");
  let mappedToolChoice;
  if (toolChoice != null && hasFunctionTool) {
    switch (toolChoice.type) {
      case "auto":
        mappedToolChoice = "auto";
        break;
      case "required":
        mappedToolChoice = "any";
        break;
      case "none":
        mappedToolChoice = "none";
        break;
      case "tool":
        mappedToolChoice = {
          allowed_tools: {
            mode: "validated",
            tools: [toolChoice.toolName]
          }
        };
        break;
    }
  }
  return {
    tools: interactionsTools.length > 0 ? interactionsTools : void 0,
    toolChoice: mappedToolChoice,
    toolWarnings
  };
}

// src/interactions/stream-google-interactions.ts
import {
  createEventSourceResponseHandler as createEventSourceResponseHandler2,
  delay as delay2,
  getFromApi as getFromApi2,
  isAbortError as isAbortError2
} from "@ai-sdk/provider-utils";
var DEFAULT_MAX_RETRIES = 3;
var DEFAULT_RETRY_DELAY_MS = 500;
function streamGoogleInteractionEvents({
  baseURL,
  interactionId,
  headers,
  fetch,
  abortSignal,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS
}) {
  if (interactionId.length === 0) {
    throw new Error(
      "google.interactions: cannot stream a background interaction without an id."
    );
  }
  const eventSourceHeaders = {
    ...headers,
    accept: "text/event-stream"
  };
  let lastEventId;
  let complete = false;
  let attempt = 0;
  let receivedAnyEventThisAttempt = false;
  let currentReader;
  const internalAbort = new AbortController();
  const upstreamAbortHandler = () => internalAbort.abort();
  if (abortSignal != null) {
    if (abortSignal.aborted) {
      internalAbort.abort();
    } else {
      abortSignal.addEventListener("abort", upstreamAbortHandler, {
        once: true
      });
    }
  }
  const effectiveSignal = internalAbort.signal;
  function buildUrl() {
    const base = `${baseURL}/interactions/${encodeURIComponent(interactionId)}`;
    const params = new URLSearchParams({ stream: "true" });
    if (lastEventId != null) {
      params.set("last_event_id", lastEventId);
    }
    return `${base}?${params.toString()}`;
  }
  async function openReader() {
    const { value: stream } = await getFromApi2({
      url: buildUrl(),
      validateUrl: false,
      headers: eventSourceHeaders,
      failedResponseHandler: googleFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler2(
        googleInteractionsEventSchema
      ),
      abortSignal: effectiveSignal,
      fetch
    });
    return stream.getReader();
  }
  return new ReadableStream({
    async start(controller) {
      try {
        while (!complete && !effectiveSignal.aborted) {
          if (currentReader == null) {
            try {
              currentReader = await openReader();
              receivedAnyEventThisAttempt = false;
            } catch (error) {
              if (isAbortError2(error) || effectiveSignal.aborted) {
                controller.error(error);
                return;
              }
              attempt++;
              if (attempt >= maxRetries) {
                controller.error(error);
                return;
              }
              await delay2(retryDelayMs * attempt, {
                abortSignal: effectiveSignal
              });
              continue;
            }
          }
          try {
            const { done, value } = await currentReader.read();
            if (done) {
              currentReader = void 0;
              if (complete) break;
              if (!receivedAnyEventThisAttempt) {
                attempt++;
                if (attempt >= maxRetries) {
                  controller.error(
                    new Error(
                      "google.interactions: SSE stream closed without producing any events."
                    )
                  );
                  return;
                }
                await delay2(retryDelayMs * attempt, {
                  abortSignal: effectiveSignal
                });
              } else {
                attempt = 0;
              }
              continue;
            }
            receivedAnyEventThisAttempt = true;
            if (value.success) {
              const streamEvent = value.value;
              if (typeof streamEvent.event_id === "string" && streamEvent.event_id.length > 0) {
                lastEventId = streamEvent.event_id;
              }
              if (streamEvent.event_type === "interaction.completed" || streamEvent.event_type === "error") {
                complete = true;
              }
            }
            controller.enqueue(value);
          } catch (error) {
            if (isAbortError2(error) || effectiveSignal.aborted) {
              controller.error(error);
              return;
            }
            currentReader = void 0;
            attempt++;
            if (attempt >= maxRetries) {
              controller.error(error);
              return;
            }
            await delay2(retryDelayMs * attempt, {
              abortSignal: effectiveSignal
            });
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        if (abortSignal != null) {
          abortSignal.removeEventListener("abort", upstreamAbortHandler);
        }
        currentReader == null ? void 0 : currentReader.cancel().catch(() => {
        });
        currentReader = void 0;
        if (effectiveSignal.aborted && !complete) {
          await cancelGoogleInteraction({
            baseURL,
            interactionId,
            headers,
            fetch
          });
        }
      }
    },
    cancel() {
      internalAbort.abort();
      currentReader == null ? void 0 : currentReader.cancel().catch(() => {
      });
      currentReader = void 0;
    }
  });
}

// src/interactions/synthesize-google-interactions-agent-stream.ts
function synthesizeGoogleInteractionsAgentStream({
  response,
  warnings,
  generateId: generateId2,
  includeRawChunks,
  headerServiceTier
}) {
  return new ReadableStream({
    start(controller) {
      var _a, _b, _c;
      controller.enqueue({ type: "stream-start", warnings });
      const interactionId = typeof response.id === "string" && response.id.length > 0 ? response.id : void 0;
      let timestamp;
      const created = response.created;
      if (typeof created === "string") {
        const parsed = new Date(created);
        if (!Number.isNaN(parsed.getTime())) {
          timestamp = parsed;
        }
      }
      controller.enqueue({
        type: "response-metadata",
        ...interactionId != null ? { id: interactionId } : {},
        modelId: (_a = response.model) != null ? _a : void 0,
        ...timestamp ? { timestamp } : {}
      });
      if (includeRawChunks) {
        controller.enqueue({ type: "raw", rawValue: response });
      }
      const { content, hasFunctionCall } = parseGoogleInteractionsOutputs({
        steps: (_b = response.steps) != null ? _b : null,
        generateId: generateId2,
        interactionId
      });
      let blockCounter = 0;
      const nextBlockId = () => `${interactionId != null ? interactionId : "agent"}:${blockCounter++}`;
      for (const part of content) {
        switch (part.type) {
          case "text": {
            const id = nextBlockId();
            const providerMetadata2 = part.providerMetadata;
            controller.enqueue({ type: "text-start", id });
            if (part.text.length > 0) {
              controller.enqueue({ type: "text-delta", id, delta: part.text });
            }
            controller.enqueue({
              type: "text-end",
              id,
              ...providerMetadata2 ? { providerMetadata: providerMetadata2 } : {}
            });
            break;
          }
          case "reasoning": {
            const id = nextBlockId();
            const providerMetadata2 = part.providerMetadata;
            controller.enqueue({ type: "reasoning-start", id });
            if (part.text.length > 0) {
              controller.enqueue({
                type: "reasoning-delta",
                id,
                delta: part.text
              });
            }
            controller.enqueue({
              type: "reasoning-end",
              id,
              ...providerMetadata2 ? { providerMetadata: providerMetadata2 } : {}
            });
            break;
          }
          case "tool-call": {
            const providerMetadata2 = part.providerMetadata;
            controller.enqueue({
              type: "tool-input-start",
              id: part.toolCallId,
              toolName: part.toolName,
              ...part.providerExecuted ? { providerExecuted: part.providerExecuted } : {}
            });
            controller.enqueue({
              type: "tool-input-delta",
              id: part.toolCallId,
              delta: part.input
            });
            controller.enqueue({
              type: "tool-input-end",
              id: part.toolCallId
            });
            controller.enqueue({
              type: "tool-call",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
              ...part.providerExecuted ? { providerExecuted: part.providerExecuted } : {},
              ...providerMetadata2 ? { providerMetadata: providerMetadata2 } : {}
            });
            break;
          }
          case "tool-result": {
            controller.enqueue({
              type: "tool-result",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              result: part.result
            });
            break;
          }
          case "source":
          case "file": {
            controller.enqueue(part);
            break;
          }
          default:
            break;
        }
      }
      const serviceTier = (_c = response.service_tier) != null ? _c : headerServiceTier;
      const finishReason = {
        unified: mapGoogleInteractionsFinishReason({
          status: response.status,
          hasFunctionCall
        }),
        raw: response.status
      };
      const providerMetadata = {
        google: {
          ...interactionId != null ? { interactionId } : {},
          ...serviceTier != null ? { serviceTier } : {}
        }
      };
      controller.enqueue({
        type: "finish",
        finishReason,
        usage: convertGoogleInteractionsUsage(response.usage),
        providerMetadata
      });
      controller.close();
    }
  });
}

// src/interactions/google-interactions-language-model.ts
var GoogleInteractionsLanguageModel = class _GoogleInteractionsLanguageModel {
  constructor(modelOrAgent, config) {
    this.specificationVersion = "v4";
    if (typeof modelOrAgent === "string") {
      this.modelId = modelOrAgent;
      this.agent = void 0;
    } else if ("managedAgent" in modelOrAgent) {
      this.modelId = modelOrAgent.managedAgent;
      this.agent = modelOrAgent.managedAgent;
    } else {
      this.modelId = modelOrAgent.agent;
      this.agent = modelOrAgent.agent;
    }
    this.config = config;
  }
  static [WORKFLOW_SERIALIZE3](model) {
    return {
      ...serializeModelOptions3({
        modelId: model.modelId,
        config: model.config
      }),
      agent: model.agent
    };
  }
  static [WORKFLOW_DESERIALIZE3](options) {
    return new _GoogleInteractionsLanguageModel(
      options.agent != null ? { agent: options.agent } : options.modelId,
      options.config
    );
  }
  get provider() {
    return this.config.provider;
  }
  get supportedUrls() {
    if (this.config.supportedUrls) {
      return this.config.supportedUrls();
    }
    return {
      "image/*": [/^https?:\/\/.+/],
      "application/pdf": [/^https?:\/\/.+/],
      "audio/*": [/^https?:\/\/.+/],
      "video/*": [
        /^https?:\/\/(www\.)?youtube\.com\/watch\?v=.+/,
        /^https?:\/\/youtu\.be\/.+/,
        /^gs:\/\/.+/
      ]
    };
  }
  async getArgs(options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z;
    const warnings = [];
    const googleOptions = await parseProviderOptions3({
      provider: "google",
      providerOptions: options.providerOptions,
      schema: googleInteractionsLanguageModelOptions
    });
    const isAgent = this.agent != null;
    const hasTools = options.tools != null && options.tools.length > 0;
    let toolsForBody;
    let toolChoiceForBody;
    if (hasTools) {
      const prepared = prepareGoogleInteractionsTools({
        tools: options.tools,
        toolChoice: options.toolChoice
      });
      toolsForBody = prepared.tools;
      toolChoiceForBody = prepared.toolChoice;
      warnings.push(...prepared.toolWarnings);
    }
    const responseFormatEntries = [];
    if (((_a = options.responseFormat) == null ? void 0 : _a.type) === "json") {
      if (isAgent) {
        warnings.push({
          type: "other",
          message: "google.interactions: structured output (responseFormat) is not supported when an agent is set; responseFormat will be ignored."
        });
      } else {
        const entry = {
          type: "text",
          mime_type: "application/json",
          ...options.responseFormat.schema != null ? { schema: options.responseFormat.schema } : {}
        };
        responseFormatEntries.push(entry);
      }
    }
    if ((googleOptions == null ? void 0 : googleOptions.responseFormat) != null) {
      for (const entry of googleOptions.responseFormat) {
        if (entry.type === "text") {
          responseFormatEntries.push(
            pruneUndefined({
              type: "text",
              mime_type: (_b = entry.mimeType) != null ? _b : void 0,
              schema: (_c = entry.schema) != null ? _c : void 0
            })
          );
        } else if (entry.type === "image") {
          responseFormatEntries.push(
            pruneUndefined({
              type: "image",
              mime_type: (_d = entry.mimeType) != null ? _d : void 0,
              aspect_ratio: (_e = entry.aspectRatio) != null ? _e : void 0,
              image_size: (_f = entry.imageSize) != null ? _f : void 0
            })
          );
        } else if (entry.type === "audio") {
          responseFormatEntries.push(
            pruneUndefined({
              type: "audio",
              mime_type: (_g = entry.mimeType) != null ? _g : void 0
            })
          );
        }
      }
    }
    const {
      input,
      systemInstruction: convertedSystemInstruction,
      warnings: convWarnings
    } = convertToGoogleInteractionsInput({
      prompt: options.prompt,
      previousInteractionId: (_h = googleOptions == null ? void 0 : googleOptions.previousInteractionId) != null ? _h : void 0,
      store: (_i = googleOptions == null ? void 0 : googleOptions.store) != null ? _i : void 0,
      mediaResolution: (_j = googleOptions == null ? void 0 : googleOptions.mediaResolution) != null ? _j : void 0
    });
    warnings.push(...convWarnings);
    let systemInstruction = convertedSystemInstruction;
    const optionSystemInstruction = (_k = googleOptions == null ? void 0 : googleOptions.systemInstruction) != null ? _k : void 0;
    if (systemInstruction != null && optionSystemInstruction != null) {
      warnings.push({
        type: "other",
        message: "google.interactions: both AI SDK system message and providerOptions.google.systemInstruction were set; using the AI SDK system message."
      });
    } else if (systemInstruction == null && optionSystemInstruction != null) {
      systemInstruction = optionSystemInstruction;
    }
    let generationConfig;
    if (isAgent) {
      const droppedFields = [];
      if (options.temperature != null) droppedFields.push("temperature");
      if (options.topP != null) droppedFields.push("topP");
      if (options.seed != null) droppedFields.push("seed");
      if (options.stopSequences != null && options.stopSequences.length > 0) {
        droppedFields.push("stopSequences");
      }
      if (options.maxOutputTokens != null)
        droppedFields.push("maxOutputTokens");
      if ((googleOptions == null ? void 0 : googleOptions.thinkingLevel) != null)
        droppedFields.push("thinkingLevel");
      if ((googleOptions == null ? void 0 : googleOptions.thinkingSummaries) != null) {
        droppedFields.push("thinkingSummaries");
      }
      if ((googleOptions == null ? void 0 : googleOptions.imageConfig) != null) droppedFields.push("imageConfig");
      if (droppedFields.length > 0) {
        warnings.push({
          type: "other",
          message: `google.interactions: ${droppedFields.join(", ")} ${droppedFields.length === 1 ? "is" : "are"} not supported when an agent is set; use providerOptions.google.agentConfig instead. Dropped from the request body.`
        });
      }
      generationConfig = void 0;
    } else {
      generationConfig = pruneUndefined({
        temperature: (_l = options.temperature) != null ? _l : void 0,
        top_p: (_m = options.topP) != null ? _m : void 0,
        seed: (_n = options.seed) != null ? _n : void 0,
        stop_sequences: options.stopSequences != null && options.stopSequences.length > 0 ? options.stopSequences : void 0,
        max_output_tokens: (_o = options.maxOutputTokens) != null ? _o : void 0,
        thinking_level: (_p = googleOptions == null ? void 0 : googleOptions.thinkingLevel) != null ? _p : void 0,
        thinking_summaries: (_q = googleOptions == null ? void 0 : googleOptions.thinkingSummaries) != null ? _q : void 0,
        tool_choice: toolChoiceForBody
      });
      if ((googleOptions == null ? void 0 : googleOptions.imageConfig) != null) {
        const alreadyHasImageEntry = responseFormatEntries.some(
          (entry) => entry.type === "image"
        );
        warnings.push({
          type: "other",
          message: alreadyHasImageEntry ? "google.interactions: providerOptions.google.imageConfig is deprecated and was ignored because providerOptions.google.responseFormat already supplies an image entry. Use responseFormat exclusively." : 'google.interactions: providerOptions.google.imageConfig is deprecated. Use providerOptions.google.responseFormat with a { type: "image", ... } entry instead.'
        });
        if (!alreadyHasImageEntry) {
          responseFormatEntries.push({
            type: "image",
            mime_type: "image/png",
            ...googleOptions.imageConfig.aspectRatio != null ? { aspect_ratio: googleOptions.imageConfig.aspectRatio } : {},
            ...googleOptions.imageConfig.imageSize != null ? { image_size: googleOptions.imageConfig.imageSize } : {}
          });
        }
      }
    }
    let agentConfig;
    if (isAgent && (googleOptions == null ? void 0 : googleOptions.agentConfig) != null) {
      const agentConfigOptions = googleOptions.agentConfig;
      if (agentConfigOptions.type === "deep-research") {
        agentConfig = pruneUndefined({
          type: "deep-research",
          thinking_summaries: (_r = agentConfigOptions.thinkingSummaries) != null ? _r : void 0,
          visualization: (_s = agentConfigOptions.visualization) != null ? _s : void 0,
          collaborative_planning: (_t = agentConfigOptions.collaborativePlanning) != null ? _t : void 0
        });
      } else if (agentConfigOptions.type === "dynamic") {
        agentConfig = { type: "dynamic" };
      }
    }
    let environment;
    if ((googleOptions == null ? void 0 : googleOptions.environment) != null) {
      if (!isAgent) {
        warnings.push({
          type: "other",
          message: "google.interactions: environment is only supported when an agent is set; environment will be omitted from the request body."
        });
      } else if (typeof googleOptions.environment === "string") {
        environment = googleOptions.environment;
      } else {
        const environmentOptions = googleOptions.environment;
        const sources = (_u = environmentOptions.sources) == null ? void 0 : _u.map((source) => {
          var _a2;
          if (source.type === "inline") {
            return {
              type: "inline",
              content: source.content,
              target: source.target
            };
          }
          return pruneUndefined({
            type: source.type,
            source: source.source,
            target: (_a2 = source.target) != null ? _a2 : void 0
          });
        });
        let network;
        if (environmentOptions.network === "disabled") {
          network = "disabled";
        } else if (environmentOptions.network != null) {
          network = {
            allowlist: environmentOptions.network.allowlist.map(
              (entry) => {
                var _a2;
                return pruneUndefined({
                  domain: entry.domain,
                  transform: (_a2 = entry.transform) != null ? _a2 : void 0
                });
              }
            )
          };
        }
        environment = pruneUndefined({
          type: "remote",
          sources: sources != null && sources.length > 0 ? sources : void 0,
          network
        });
      }
    }
    const args = pruneUndefined({
      ...isAgent ? { agent: this.agent } : { model: this.modelId },
      input,
      system_instruction: systemInstruction,
      tools: toolsForBody,
      response_format: responseFormatEntries.length > 0 ? responseFormatEntries : void 0,
      response_modalities: (googleOptions == null ? void 0 : googleOptions.responseModalities) != null ? googleOptions.responseModalities : void 0,
      previous_interaction_id: (_v = googleOptions == null ? void 0 : googleOptions.previousInteractionId) != null ? _v : void 0,
      service_tier: (_w = googleOptions == null ? void 0 : googleOptions.serviceTier) != null ? _w : void 0,
      store: (_x = googleOptions == null ? void 0 : googleOptions.store) != null ? _x : void 0,
      generation_config: generationConfig != null && Object.keys(generationConfig).length > 0 ? generationConfig : void 0,
      agent_config: agentConfig,
      environment,
      background: (_y = googleOptions == null ? void 0 : googleOptions.background) != null ? _y : void 0
    });
    return {
      args,
      warnings,
      isAgent,
      isBackground: (googleOptions == null ? void 0 : googleOptions.background) === true,
      pollingTimeoutMs: (_z = googleOptions == null ? void 0 : googleOptions.pollingTimeoutMs) != null ? _z : void 0
    };
  }
  async doGenerate(options) {
    var _a, _b, _c, _d, _e, _f;
    const { args, warnings, isAgent, pollingTimeoutMs } = await this.getArgs(options);
    const url = `${this.config.baseURL}/interactions`;
    const mergedHeaders = combineHeaders4(
      this.config.headers ? await resolve3(this.config.headers) : void 0,
      options.headers
    );
    const postResult = await postJsonToApi3({
      url,
      headers: mergedHeaders,
      body: args,
      failedResponseHandler: googleFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler4(
        googleInteractionsResponseSchema
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch
    });
    let {
      responseHeaders,
      value: response,
      rawValue: rawResponse
    } = postResult;
    if (isAgent && !isTerminalStatus(response.status)) {
      const polled = await pollGoogleInteractionUntilTerminal({
        baseURL: this.config.baseURL,
        interactionId: response.id,
        headers: mergedHeaders,
        fetch: this.config.fetch,
        abortSignal: options.abortSignal,
        timeoutMs: pollingTimeoutMs
      });
      response = polled.response;
      rawResponse = polled.rawResponse;
      responseHeaders = (_a = polled.responseHeaders) != null ? _a : responseHeaders;
    }
    const interactionId = typeof response.id === "string" && response.id.length > 0 ? response.id : void 0;
    const { content, hasFunctionCall } = parseGoogleInteractionsOutputs({
      steps: (_b = response.steps) != null ? _b : null,
      generateId: (_c = this.config.generateId) != null ? _c : defaultGenerateId,
      interactionId
    });
    const finishReason = {
      unified: mapGoogleInteractionsFinishReason({
        status: response.status,
        hasFunctionCall
      }),
      raw: response.status
    };
    const serviceTier = (_e = (_d = response.service_tier) != null ? _d : responseHeaders == null ? void 0 : responseHeaders["x-gemini-service-tier"]) != null ? _e : void 0;
    const outputTokensByModality = getGoogleInteractionsOutputTokensByModality(
      response.usage
    );
    const providerMetadata = {
      google: {
        ...interactionId != null ? { interactionId } : {},
        ...serviceTier != null ? { serviceTier } : {},
        ...outputTokensByModality != null ? { outputTokensByModality } : {}
      }
    };
    let timestamp;
    if (typeof response.created === "string") {
      const parsed = new Date(response.created);
      if (!Number.isNaN(parsed.getTime())) {
        timestamp = parsed;
      }
    }
    return {
      content,
      finishReason,
      usage: convertGoogleInteractionsUsage(response.usage),
      warnings,
      providerMetadata,
      request: { body: args },
      response: {
        headers: responseHeaders,
        body: rawResponse,
        ...interactionId != null ? { id: interactionId } : {},
        ...timestamp ? { timestamp } : {},
        modelId: (_f = response.model) != null ? _f : void 0
      }
    };
  }
  async doStream(options) {
    var _a;
    const { args, warnings, isBackground, pollingTimeoutMs } = await this.getArgs(options);
    const url = `${this.config.baseURL}/interactions`;
    const mergedHeaders = combineHeaders4(
      this.config.headers ? await resolve3(this.config.headers) : void 0,
      options.headers
    );
    if (isBackground) {
      return this.doStreamBackground({
        args,
        warnings,
        url,
        mergedHeaders,
        options,
        pollingTimeoutMs
      });
    }
    const body = { ...args, stream: true };
    const { responseHeaders, value: response } = await postJsonToApi3({
      url,
      headers: mergedHeaders,
      body,
      failedResponseHandler: googleFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler3(
        googleInteractionsEventSchema
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch
    });
    const headerServiceTier = responseHeaders == null ? void 0 : responseHeaders["x-gemini-service-tier"];
    const transform = buildGoogleInteractionsStreamTransform({
      warnings,
      generateId: (_a = this.config.generateId) != null ? _a : defaultGenerateId,
      includeRawChunks: options.includeRawChunks,
      serviceTier: headerServiceTier
    });
    return {
      stream: response.pipeThrough(transform),
      request: { body },
      response: { headers: responseHeaders }
    };
  }
  /*
   * Drive the streaming surface for agent calls. Agents require
   * `background: true`, which is incompatible with `stream: true` on POST.
   *
   * Approach:
   *   1. POST `/interactions` with `background: true`. The response includes
   *      the interaction id and an initial (usually non-terminal) status.
   *   2. If the POST status is already terminal (rare), synthesize a stream
   *      from the polled outputs and we're done.
   *   3. Otherwise open `GET /interactions/{id}?stream=true` and pipe the
   *      SSE events through `buildGoogleInteractionsStreamTransform` so the
   *      consumer receives text deltas / thinking summaries / tool events as
   *      they happen instead of all at once at the end.
   *
   * The SSE connection can drop while the agent idles between events
   * (`UND_ERR_BODY_TIMEOUT`); `streamGoogleInteractionEvents` handles the
   * reconnect-with-`last_event_id` loop transparently.
   */
  async doStreamBackground({
    args,
    warnings,
    url,
    mergedHeaders,
    options,
    pollingTimeoutMs
  }) {
    var _a, _b;
    const postResult = await postJsonToApi3({
      url,
      headers: mergedHeaders,
      body: args,
      failedResponseHandler: googleFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler4(
        googleInteractionsResponseSchema
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch
    });
    const { responseHeaders: postHeaders, value: postResponse } = postResult;
    const interactionId = postResponse.id;
    if (interactionId == null || interactionId.length === 0) {
      throw new Error(
        "google.interactions: background POST response did not include an interaction id; cannot stream the result."
      );
    }
    const headerServiceTier = postHeaders == null ? void 0 : postHeaders["x-gemini-service-tier"];
    if (isTerminalStatus(postResponse.status)) {
      const synthesized = synthesizeGoogleInteractionsAgentStream({
        response: postResponse,
        warnings,
        generateId: (_a = this.config.generateId) != null ? _a : defaultGenerateId,
        includeRawChunks: options.includeRawChunks,
        headerServiceTier
      });
      return {
        stream: synthesized,
        request: { body: args },
        response: { headers: postHeaders }
      };
    }
    void pollingTimeoutMs;
    const events = streamGoogleInteractionEvents({
      baseURL: this.config.baseURL,
      interactionId,
      headers: mergedHeaders,
      fetch: this.config.fetch,
      abortSignal: options.abortSignal
    });
    const transform = buildGoogleInteractionsStreamTransform({
      warnings,
      generateId: (_b = this.config.generateId) != null ? _b : defaultGenerateId,
      includeRawChunks: options.includeRawChunks,
      serviceTier: headerServiceTier
    });
    return {
      stream: events.pipeThrough(transform),
      request: { body: args },
      response: { headers: postHeaders }
    };
  }
};
function pruneUndefined(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === void 0) continue;
    result[key] = value;
  }
  return result;
}
export {
  GoogleInteractionsLanguageModel,
  GoogleLanguageModel,
  GoogleSpeechModel,
  getGroundingMetadataSchema,
  getUrlContextMetadataSchema,
  googleTools
};
//# sourceMappingURL=index.js.map