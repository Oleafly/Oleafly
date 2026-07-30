// internal/index.ts
import { convertAsyncIteratorToReadableStream } from "@ai-sdk/provider-utils";

// src/util/async-iterable-stream.ts
function createAsyncIterableStream(source) {
  return asAsyncIterableStream(source.pipeThrough(new TransformStream()));
}
function asAsyncIterableStream(stream) {
  stream[Symbol.asyncIterator] = function() {
    const reader = this.getReader();
    let finished = false;
    async function cleanup(cancelStream) {
      var _a12;
      if (finished)
        return;
      finished = true;
      try {
        if (cancelStream) {
          await ((_a12 = reader.cancel) == null ? void 0 : _a12.call(reader));
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
  DownloadError,
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
  var _a12;
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
      throw new DownloadError({
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
      mediaType: (_a12 = response.headers.get("content-type")) != null ? _a12 : void 0
    };
  } catch (error) {
    if (DownloadError.isInstance(error)) {
      throw error;
    }
    throw new DownloadError({ url: urlText, cause: error });
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

// src/prompt/invalid-data-content-error.ts
import { AISDKError } from "@ai-sdk/provider";
var name = "AI_InvalidDataContentError";
var marker = `vercel.ai.error.${name}`;
var symbol = Symbol.for(marker);
var _a;
var InvalidDataContentError = class extends AISDKError {
  constructor({
    content,
    cause,
    message = `Invalid data content. Expected a base64 string, Uint8Array, ArrayBuffer, or Buffer, but got ${typeof content}.`
  }) {
    super({ name, message, cause });
    this[_a] = true;
    this.content = content;
  }
  static isInstance(error) {
    return AISDKError.hasMarker(error, marker);
  }
};
_a = symbol;

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

// src/prompt/invalid-message-role-error.ts
import { AISDKError as AISDKError2 } from "@ai-sdk/provider";
var name2 = "AI_InvalidMessageRoleError";
var marker2 = `vercel.ai.error.${name2}`;
var symbol2 = Symbol.for(marker2);
var _a2;
var InvalidMessageRoleError = class extends AISDKError2 {
  constructor({
    role,
    message = `Invalid message role: '${role}'. Must be one of: "system", "user", "assistant", "tool".`
  }) {
    super({ name: name2, message });
    this[_a2] = true;
    this.role = role;
  }
  static isInstance(error) {
    return AISDKError2.hasMarker(error, marker2);
  }
};
_a2 = symbol2;

// src/error/missing-tool-result-error.ts
import { AISDKError as AISDKError3 } from "@ai-sdk/provider";
var name3 = "AI_MissingToolResultsError";
var marker3 = `vercel.ai.error.${name3}`;
var symbol3 = Symbol.for(marker3);
var _a3;
var MissingToolResultsError = class extends AISDKError3 {
  constructor({ toolCallIds }) {
    super({
      name: name3,
      message: `Tool result${toolCallIds.length > 1 ? "s are" : " is"} missing for tool call${toolCallIds.length > 1 ? "s" : ""} ${toolCallIds.join(
        ", "
      )}.`
    });
    this[_a3] = true;
    this.toolCallIds = toolCallIds;
  }
  static isInstance(error) {
    return AISDKError3.hasMarker(error, marker3);
  }
};
_a3 = symbol3;

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
  var _a12;
  if (part.type !== "image") {
    return part;
  }
  return {
    type: "file",
    data: part.image,
    mediaType: (_a12 = part.mediaType) != null ? _a12 : "image",
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
      var _a12;
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
          const mediaType = (_a12 = item.mediaType) != null ? _a12 : getMediaTypeFromUrl(item.url);
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
  var _a12;
  try {
    const pathname = new URL(url).pathname;
    const fileExtension = (_a12 = pathname.split(".").pop()) == null ? void 0 : _a12.toLowerCase();
    if (fileExtension && Object.hasOwn(URL_EXTENSION_TO_MEDIA_TYPE, fileExtension)) {
      return URL_EXTENSION_TO_MEDIA_TYPE[fileExtension];
    }
  } catch (e) {
  }
  return fallbackMediaType;
}

// src/prompt/create-tool-model-output.ts
import { getErrorMessage } from "@ai-sdk/provider";
async function createToolModelOutput({
  toolCallId,
  input,
  output,
  tool,
  errorMode
}) {
  if (errorMode === "text") {
    return { type: "error-text", value: getErrorMessage(output) };
  } else if (errorMode === "json") {
    return { type: "error-json", value: toJSONValue(output) };
  }
  if (tool == null ? void 0 : tool.toModelOutput) {
    return await tool.toModelOutput({ toolCallId, input, output });
  }
  return typeof output === "string" ? { type: "text", value: output } : { type: "json", value: toJSONValue(output) };
}
function toJSONValue(value) {
  return value === void 0 ? null : value;
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
function isNonEmptyObject(object) {
  return object != null && Object.keys(object).length > 0;
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
  for (const [name12, tool] of orderToolEntries({ tools, toolOrder })) {
    const toolType = tool.type;
    switch (toolType) {
      case void 0:
      case "dynamic":
      case "function": {
        const description = resolveToolDescription({
          tool,
          toolName: name12,
          toolsContext,
          experimental_sandbox: sandbox
        });
        const providerOptions = tool.providerOptions;
        const inputExamples = tool.inputExamples;
        const strict = tool.strict;
        languageModelTools.push({
          type: "function",
          name: name12,
          inputSchema: await asSchema(tool.inputSchema).jsonSchema,
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
          name: name12,
          id: tool.id,
          args: tool.args
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
  const orderedTools = toolEntries.filter(([name12]) => toolOrder.includes(name12)).sort(
    ([nameA], [nameB]) => toolOrder.indexOf(nameA) - toolOrder.indexOf(nameB)
  );
  const unorderedTools = toolEntries.filter(([name12]) => !toolOrder.includes(name12)).sort(([nameA], [nameB]) => nameA < nameB ? -1 : nameA > nameB ? 1 : 0);
  return [...orderedTools, ...unorderedTools];
}
function resolveToolDescription({
  tool,
  toolName,
  toolsContext,
  experimental_sandbox: sandbox
}) {
  return tool.description === void 0 ? void 0 : typeof tool.description === "string" ? tool.description : tool.description({
    context: toolsContext[toolName],
    experimental_sandbox: sandbox
  });
}

// src/prompt/standardize-prompt.ts
import { InvalidPromptError } from "@ai-sdk/provider";
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
    throw new InvalidPromptError({
      prompt,
      message: "prompt or messages must be defined"
    });
  }
  if (prompt != null && messages != null) {
    throw new InvalidPromptError({
      prompt,
      message: "prompt and messages cannot be defined at the same time"
    });
  }
  if (typeof instructions !== "string" && !asArray2(instructions).every((message) => message.role === "system")) {
    throw new InvalidPromptError({
      prompt,
      message: "instructions must be a string, SystemModelMessage, or array of SystemModelMessage"
    });
  }
  if (prompt != null && typeof prompt === "string") {
    messages = [{ role: "user", content: prompt }];
  } else if (prompt != null && Array.isArray(prompt)) {
    messages = prompt;
  } else if (messages == null) {
    throw new InvalidPromptError({
      prompt,
      message: "prompt or messages must be defined"
    });
  }
  if (messages.length === 0) {
    throw new InvalidPromptError({
      prompt,
      message: "messages must not be empty"
    });
  }
  if (!allowSystemInMessages && messages.some((message) => message.role === "system")) {
    throw new InvalidPromptError({
      prompt,
      message: "System messages are not allowed in the prompt or messages fields. Use the instructions option instead."
    });
  }
  const validationResult = await safeValidateTypes({
    value: messages,
    schema: z5.array(modelMessageSchema)
  });
  if (!validationResult.success) {
    throw new InvalidPromptError({
      prompt,
      message: "The messages do not match the ModelMessage[] schema.",
      cause: validationResult.error
    });
  }
  return { messages, instructions };
}

// src/error/invalid-argument-error.ts
import { AISDKError as AISDKError4 } from "@ai-sdk/provider";
var name4 = "AI_InvalidArgumentError";
var marker4 = `vercel.ai.error.${name4}`;
var symbol4 = Symbol.for(marker4);
var _a4;
var InvalidArgumentError = class extends AISDKError4 {
  constructor({
    parameter,
    value,
    message
  }) {
    super({
      name: name4,
      message: `Invalid argument for parameter ${parameter}: ${message}`
    });
    this[_a4] = true;
    this.parameter = parameter;
    this.value = value;
  }
  static isInstance(error) {
    return AISDKError4.hasMarker(error, marker4);
  }
};
_a4 = symbol4;

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

// src/util/retry-with-exponential-backoff.ts
import { APICallError } from "@ai-sdk/provider";
import { GatewayError } from "@ai-sdk/gateway";
import {
  retryWithExponentialBackoff
} from "@ai-sdk/provider-utils";

// src/util/retry-error.ts
import { AISDKError as AISDKError5 } from "@ai-sdk/provider";
var name5 = "AI_RetryError";
var marker5 = `vercel.ai.error.${name5}`;
var symbol5 = Symbol.for(marker5);
var _a5;
var RetryError = class extends AISDKError5 {
  constructor({
    message,
    reason,
    errors
  }) {
    super({ name: name5, message });
    this[_a5] = true;
    this.reason = reason;
    this.errors = errors;
    this.lastError = errors[errors.length - 1];
  }
  static isInstance(error) {
    return AISDKError5.hasMarker(error, marker5);
  }
};
_a5 = symbol5;

// src/util/retry-with-exponential-backoff.ts
function getRetryDelayInMs({
  error,
  exponentialBackoffDelay
}) {
  const headers = APICallError.isInstance(error) ? error.responseHeaders : APICallError.isInstance(error.cause) ? error.cause.responseHeaders : void 0;
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
  shouldRetry: (error) => error instanceof Error && (APICallError.isInstance(error) && error.isRetryable === true || GatewayError.isInstance(error) && error.isRetryable === true),
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
  var _a12, _b, _c, _d, _e, _f, _g, _h, _i, _j;
  return {
    inputTokens: addTokenCounts(usage1.inputTokens, usage2.inputTokens),
    inputTokenDetails: {
      noCacheTokens: addTokenCounts(
        (_a12 = usage1.inputTokenDetails) == null ? void 0 : _a12.noCacheTokens,
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

// src/model/resolve-model.ts
import { gateway } from "@ai-sdk/gateway";

// src/error/index.ts
import {
  AISDKError as AISDKError13,
  APICallError as APICallError2,
  EmptyResponseBodyError,
  InvalidPromptError as InvalidPromptError2,
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

// src/error/invalid-tool-approval-error.ts
import { AISDKError as AISDKError6 } from "@ai-sdk/provider";
var name6 = "AI_InvalidToolApprovalError";
var marker6 = `vercel.ai.error.${name6}`;
var symbol6 = Symbol.for(marker6);
var _a6;
var InvalidToolApprovalError = class extends AISDKError6 {
  constructor({ approvalId }) {
    super({
      name: name6,
      message: `Tool approval response references unknown approvalId: "${approvalId}". No matching tool-approval-request found in message history.`
    });
    this[_a6] = true;
    this.approvalId = approvalId;
  }
  static isInstance(error) {
    return AISDKError6.hasMarker(error, marker6);
  }
};
_a6 = symbol6;

// src/error/invalid-tool-approval-signature-error.ts
import { AISDKError as AISDKError7 } from "@ai-sdk/provider";
var name7 = "AI_InvalidToolApprovalSignatureError";
var marker7 = `vercel.ai.error.${name7}`;
var symbol7 = Symbol.for(marker7);
var _a7;
var InvalidToolApprovalSignatureError = class extends AISDKError7 {
  constructor({
    approvalId,
    toolCallId,
    reason
  }) {
    super({
      name: name7,
      message: `Tool approval signature verification failed for approval "${approvalId}" (tool call "${toolCallId}"): ${reason}`
    });
    this[_a7] = true;
    this.approvalId = approvalId;
    this.toolCallId = toolCallId;
  }
  static isInstance(error) {
    return AISDKError7.hasMarker(error, marker7);
  }
};
_a7 = symbol7;

// src/error/invalid-tool-input-error.ts
import { AISDKError as AISDKError8, getErrorMessage as getErrorMessage2 } from "@ai-sdk/provider";
var name8 = "AI_InvalidToolInputError";
var marker8 = `vercel.ai.error.${name8}`;
var symbol8 = Symbol.for(marker8);
var _a8;
var InvalidToolInputError = class extends AISDKError8 {
  constructor({
    toolInput,
    toolName,
    cause,
    message = `Invalid input for tool ${toolName}: ${getErrorMessage2(cause)}`
  }) {
    super({ name: name8, message, cause });
    this[_a8] = true;
    this.toolInput = toolInput;
    this.toolName = toolName;
  }
  static isInstance(error) {
    return AISDKError8.hasMarker(error, marker8);
  }
};
_a8 = symbol8;

// src/error/tool-call-not-found-for-approval-error.ts
import { AISDKError as AISDKError9 } from "@ai-sdk/provider";
var name9 = "AI_ToolCallNotFoundForApprovalError";
var marker9 = `vercel.ai.error.${name9}`;
var symbol9 = Symbol.for(marker9);
var _a9;
var ToolCallNotFoundForApprovalError = class extends AISDKError9 {
  constructor({
    toolCallId,
    approvalId
  }) {
    super({
      name: name9,
      message: `Tool call "${toolCallId}" not found for approval request "${approvalId}".`
    });
    this[_a9] = true;
    this.toolCallId = toolCallId;
    this.approvalId = approvalId;
  }
  static isInstance(error) {
    return AISDKError9.hasMarker(error, marker9);
  }
};
_a9 = symbol9;

// src/error/no-such-tool-error.ts
import { AISDKError as AISDKError10 } from "@ai-sdk/provider";
var name10 = "AI_NoSuchToolError";
var marker10 = `vercel.ai.error.${name10}`;
var symbol10 = Symbol.for(marker10);
var _a10;
var NoSuchToolError = class extends AISDKError10 {
  constructor({
    toolName,
    availableTools = void 0,
    message = `Model tried to call unavailable tool '${toolName}'. ${availableTools === void 0 ? "No tools are available." : `Available tools: ${availableTools.join(", ")}.`}`
  }) {
    super({ name: name10, message });
    this[_a10] = true;
    this.toolName = toolName;
    this.availableTools = availableTools;
  }
  static isInstance(error) {
    return AISDKError10.hasMarker(error, marker10);
  }
};
_a10 = symbol10;

// src/error/tool-call-repair-error.ts
import { AISDKError as AISDKError11, getErrorMessage as getErrorMessage3 } from "@ai-sdk/provider";
var name11 = "AI_ToolCallRepairError";
var marker11 = `vercel.ai.error.${name11}`;
var symbol11 = Symbol.for(marker11);
var _a11;
var ToolCallRepairError = class extends AISDKError11 {
  constructor({
    cause,
    originalError,
    message = `Error repairing tool call: ${getErrorMessage3(cause)}`
  }) {
    super({ name: name11, message, cause });
    this[_a11] = true;
    this.originalError = originalError;
  }
  static isInstance(error) {
    return AISDKError11.hasMarker(error, marker11);
  }
};
_a11 = symbol11;

// src/error/unsupported-model-version-error.ts
import { AISDKError as AISDKError12 } from "@ai-sdk/provider";
var UnsupportedModelVersionError = class extends AISDKError12 {
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

// src/error/index.ts
import { DownloadError as DownloadError2 } from "@ai-sdk/provider-utils";

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
function getGlobalProvider() {
  var _a12;
  const provider = (_a12 = globalThis.AI_SDK_DEFAULT_PROVIDER) != null ? _a12 : gateway;
  return asProviderV4(provider);
}

// src/util/merge-abort-signals.ts
import { filterNullable } from "@ai-sdk/provider-utils";
function mergeAbortSignals(...signals) {
  const validSignals = filterNullable(...signals).map(
    (signal) => signal instanceof AbortSignal ? signal : AbortSignal.timeout(signal)
  );
  return validSignals.length === 0 ? void 0 : validSignals.length === 1 ? validSignals[0] : AbortSignal.any(validSignals);
}

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

// src/telemetry/create-telemetry-dispatcher.ts
import { asArray as asArray3 } from "@ai-sdk/provider-utils";

// src/telemetry/tracing-channel.ts
var AI_SDK_TELEMETRY_TRACING_CHANNEL = "ai:telemetry";

// src/util/is-node-runtime.ts
function isNodeRuntime() {
  var _a12;
  return typeof process !== "undefined" && ((_a12 = process.release) == null ? void 0 : _a12.name) === "node";
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
  var _a12;
  const processWithBuiltins = globalThis.process;
  try {
    return (_a12 = processWithBuiltins == null ? void 0 : processWithBuiltins.getBuiltinModule) == null ? void 0 : _a12.call(processWithBuiltins, id);
  } catch (e) {
    return void 0;
  }
}
async function runWithTracingChannelSpan(message, execute) {
  var _a12;
  const diagnosticsChannel = await loadDiagnosticsChannel();
  const tracingChannel = (_a12 = diagnosticsChannel == null ? void 0 : diagnosticsChannel.tracingChannel) == null ? void 0 : _a12.call(
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
  var _a12;
  if (!isNodeRuntime()) {
    return void 0;
  }
  const diagnosticsChannel = loadBuiltinModule(
    "node:diagnostics_channel"
  );
  const asyncHooks = loadBuiltinModule("node:async_hooks");
  const tracingChannel = (_a12 = diagnosticsChannel == null ? void 0 : diagnosticsChannel.tracingChannel) == null ? void 0 : _a12.call(
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
function getGlobalTelemetryIntegrations() {
  var _a12;
  return (_a12 = globalThis.AI_SDK_TELEMETRY_INTEGRATIONS) != null ? _a12 : [];
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
  const integrations = localIntegrations != null ? asArray3(localIntegrations) : getGlobalTelemetryIntegrations();
  const telemetryMetadata = {
    recordInputs: telemetry == null ? void 0 : telemetry.recordInputs,
    recordOutputs: telemetry == null ? void 0 : telemetry.recordOutputs,
    functionId: telemetry == null ? void 0 : telemetry.functionId
  };
  const mergeTelemetryCallback = (key) => {
    const integrationCallbacks = integrations.map((integration) => {
      var _a12;
      return (_a12 = integration[key]) == null ? void 0 : _a12.bind(integration);
    }).filter(Boolean).map(
      (callback) => (event) => callback(augmentEvent(event, telemetryMetadata))
    );
    const mergedIntegrationCallback = mergeCallbacks(...integrationCallbacks);
    return async (event) => {
      await mergedIntegrationCallback(event);
    };
  };
  const executeLanguageModelCallWrappers = integrations.map((integration) => {
    var _a12;
    return (_a12 = integration.executeLanguageModelCall) == null ? void 0 : _a12.bind(integration);
  }).filter(Boolean);
  const executeToolWrappers = integrations.map((integration) => {
    var _a12;
    return (_a12 = integration.executeTool) == null ? void 0 : _a12.bind(integration);
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

// src/generate-text/reasoning-output.ts
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
      var _a12;
      return (_a12 = telemetryDispatcher.onStart) == null ? void 0 : _a12.call(telemetryDispatcher, {
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
      var _a12;
      return (_a12 = telemetryDispatcher.onStepStart) == null ? void 0 : _a12.call(telemetryDispatcher, {
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
      var _a12;
      return (_a12 = telemetryDispatcher.onStepEnd) == null ? void 0 : _a12.call(
        telemetryDispatcher,
        restrictStepResult({
          step: event,
          includeRuntimeContext,
          includeToolsContext
        })
      );
    },
    onStepFinish: (event) => {
      var _a12;
      return (_a12 = telemetryDispatcher.onStepEnd) == null ? void 0 : _a12.call(
        telemetryDispatcher,
        restrictStepResult({
          step: event,
          includeRuntimeContext,
          includeToolsContext
        })
      );
    },
    onEnd: (event) => {
      var _a12;
      return (_a12 = telemetryDispatcher.onEnd) == null ? void 0 : _a12.call(
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
      var _a12;
      return (_a12 = telemetryDispatcher.onAbort) == null ? void 0 : _a12.call(telemetryDispatcher, {
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
      var _a12;
      return (_a12 = telemetryDispatcher.onToolExecutionStart) == null ? void 0 : _a12.call(telemetryDispatcher, {
        ...event,
        toolContext: filterToolContext({
          toolName: event.toolCall.toolName,
          toolContext: event.toolContext,
          includeToolsContext
        })
      });
    },
    onToolExecutionEnd: (event) => {
      var _a12;
      return (_a12 = telemetryDispatcher.onToolExecutionEnd) == null ? void 0 : _a12.call(telemetryDispatcher, {
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

// src/generate-text/parse-tool-call.ts
import {
  asSchema as asSchema2,
  safeParseJSON,
  safeValidateTypes as safeValidateTypes2
} from "@ai-sdk/provider-utils";

// src/util/get-own.ts
function getOwn(obj, key) {
  return obj != null && Object.hasOwn(obj, key) ? obj[key] : void 0;
}

// src/generate-text/parse-tool-call.ts
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
            var _a12;
            const inputSchema = (_a12 = getOwn(tools, toolName)) == null ? void 0 : _a12.inputSchema;
            return await asSchema2(inputSchema).jsonSchema;
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
    const parsedInput = await safeParseJSON({ text: toolCall.input });
    const input = parsedInput.success ? parsedInput.value : toolCall.input;
    const tool = getOwn(tools, toolCall.toolName);
    return {
      type: "tool-call",
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      input,
      dynamic: true,
      invalid: true,
      error,
      title: tool == null ? void 0 : tool.title,
      providerExecuted: toolCall.providerExecuted,
      providerMetadata: toolCall.providerMetadata,
      ...(tool == null ? void 0 : tool.metadata) != null ? { toolMetadata: tool.metadata } : {}
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
  const parseResult = toolCall.input.trim() === "" ? { success: true, value: {} } : await safeParseJSON({ text: toolCall.input });
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
  const tool = getOwn(tools, toolName);
  if (tool == null) {
    if (toolCall.providerExecuted && toolCall.dynamic) {
      return await parseProviderExecutedDynamicToolCall(toolCall);
    }
    throw new NoSuchToolError({
      toolName: toolCall.toolName,
      availableTools: Object.keys(tools)
    });
  }
  const schema = asSchema2(tool.inputSchema);
  const parseResult = toolCall.input.trim() === "" ? await safeValidateTypes2({ value: {}, schema }) : await safeParseJSON({ text: toolCall.input, schema });
  if (parseResult.success === false) {
    throw new InvalidToolInputError({
      toolName,
      toolInput: toolCall.input,
      cause: parseResult.error
    });
  }
  return tool.type === "dynamic" ? {
    type: "tool-call",
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    input: parseResult.value,
    providerExecuted: toolCall.providerExecuted,
    providerMetadata: toolCall.providerMetadata,
    ...tool.metadata != null ? { toolMetadata: tool.metadata } : {},
    dynamic: true,
    title: tool.title
  } : {
    type: "tool-call",
    toolCallId: toolCall.toolCallId,
    toolName,
    input: parseResult.value,
    providerExecuted: toolCall.providerExecuted,
    providerMetadata: toolCall.providerMetadata,
    ...tool.metadata != null ? { toolMetadata: tool.metadata } : {},
    title: tool.title
  };
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

// src/generate-text/validate-tool-approvals.ts
import {
  asSchema as asSchema3,
  isExecutableTool,
  safeValidateTypes as safeValidateTypes3
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
  const tool = getOwn(tools, toolName);
  const input = toolCall.input;
  const userDefinedToolApprovalStatus = getOwn(toolApproval, toolName);
  if (userDefinedToolApprovalStatus != null) {
    const approvalStatus = typeof userDefinedToolApprovalStatus === "function" ? await userDefinedToolApprovalStatus(input, {
      toolCallId: toolCall.toolCallId,
      messages,
      toolContext: await validateToolContext({
        toolName,
        context: getOwn(toolsContext, toolName),
        contextSchema: tool == null ? void 0 : tool.contextSchema
      }),
      runtimeContext
    }) : userDefinedToolApprovalStatus;
    return normalizeToolApprovalStatus(approvalStatus);
  }
  if ((tool == null ? void 0 : tool.needsApproval) == null) {
    return { type: "not-applicable" };
  }
  const needsApproval = typeof tool.needsApproval === "function" ? await tool.needsApproval(input, {
    toolCallId: toolCall.toolCallId,
    messages,
    context: await validateToolContext({
      toolName,
      context: getOwn(toolsContext, toolName),
      contextSchema: tool == null ? void 0 : tool.contextSchema
    })
  }) : tool.needsApproval;
  return needsApproval ? { type: "user-approval" } : { type: "not-applicable" };
}
function normalizeToolApprovalStatus(status) {
  return status === void 0 ? { type: "not-applicable" } : typeof status === "string" ? { type: status } : status;
}

// src/generate-text/tool-approval-signature.ts
import { convertBase64ToUint8Array } from "@ai-sdk/provider-utils";

// src/util/canonical-hash.ts
import { convertUint8ArrayToBase64 } from "@ai-sdk/provider-utils";
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
  return convertUint8ArrayToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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
  return convertBase64ToUint8Array(str);
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

// src/generate-text/validate-tool-approvals.ts
async function validateApprovedToolApprovals({
  approvedToolApprovals,
  tools,
  toolApproval,
  messages,
  toolsContext,
  runtimeContext,
  toolApprovalSecret
}) {
  var _a12;
  const approved = [];
  const denied = [];
  for (const approval of approvedToolApprovals) {
    const { toolCall, approvalRequest } = approval;
    const tool = getOwn(tools, toolCall.toolName);
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
    if (isExecutableTool(tool) && tool.inputSchema != null) {
      const validation = await safeValidateTypes3({
        value: toolCall.input,
        schema: asSchema3(tool.inputSchema)
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
          reason: (_a12 = approvalStatus.reason) != null ? _a12 : approval.approvalResponse.reason
        }
      });
    } else {
      approved.push(approval);
    }
  }
  return { approvedToolApprovals: approved, deniedToolApprovals: denied };
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
export {
  DefaultStepResult,
  addLanguageModelUsage,
  asLanguageModelUsage,
  collectToolApprovals,
  convertAsyncIteratorToReadableStream,
  convertToLanguageModelPrompt,
  createAsyncIterableStream,
  createDefaultDownloadFunction,
  createNullLanguageModelUsage,
  createRestrictedTelemetryDispatcher,
  createTelemetryDispatcher,
  createToolModelOutput,
  downloadAssets,
  mapToolResultOutput,
  mergeAbortSignals,
  mergeCallbacks,
  parseToolCall,
  prepareLanguageModelCallOptions as prepareCallSettings,
  prepareLanguageModelCallOptions,
  prepareRetries,
  prepareToolChoice,
  prepareTools,
  resolveLanguageModel,
  standardizePrompt,
  toResponseMessages,
  validateApprovedToolApprovals
};
//# sourceMappingURL=index.js.map