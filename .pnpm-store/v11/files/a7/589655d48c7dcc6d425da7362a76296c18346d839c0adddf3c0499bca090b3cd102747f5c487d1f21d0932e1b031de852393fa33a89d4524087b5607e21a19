var __accessCheck = (obj, member, msg) => {
  if (!member.has(obj))
    throw TypeError("Cannot " + msg);
};
var __privateGet = (obj, member, getter) => {
  __accessCheck(obj, member, "read from private field");
  return getter ? getter.call(obj) : member.get(obj);
};
var __privateAdd = (obj, member, value) => {
  if (member.has(obj))
    throw TypeError("Cannot add the same private member more than once");
  member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
};
var __privateSet = (obj, member, value, setter) => {
  __accessCheck(obj, member, "write to private field");
  setter ? setter.call(obj, value) : member.set(obj, value);
  return value;
};

// src/use-object.ts
import {
  isAbortError,
  resolve,
  normalizeHeaders,
  safeValidateTypes
} from "@ai-sdk/provider-utils";
import {
  asSchema,
  isDeepEqualData,
  parsePartialJson
} from "ai";
import { useCallback, useId, useRef, useState } from "react";
import useSWR from "swr";
var getOriginalFetch = () => fetch;
function useObject({
  api,
  id,
  schema,
  // required, in the future we will use it for validation
  initialValue,
  fetch: fetch2,
  onError,
  onFinish,
  headers,
  credentials
}) {
  const hookId = useId();
  const completionId = id != null ? id : hookId;
  const { data, mutate } = useSWR(
    [api, completionId],
    null,
    { fallbackData: initialValue }
  );
  const [error, setError] = useState(void 0);
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef(null);
  const stop = useCallback(() => {
    var _a;
    try {
      (_a = abortControllerRef.current) == null ? void 0 : _a.abort();
    } catch (e) {
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, []);
  const submit = async (input) => {
    var _a;
    try {
      clearObject();
      setIsLoading(true);
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const resolvedHeaders = await resolve(headers);
      const actualFetch = fetch2 != null ? fetch2 : getOriginalFetch();
      const response = await actualFetch(api, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...normalizeHeaders(resolvedHeaders)
        },
        credentials,
        signal: abortController.signal,
        body: JSON.stringify(input)
      });
      if (!response.ok) {
        throw new Error(
          (_a = await response.text()) != null ? _a : "Failed to fetch the response."
        );
      }
      if (response.body == null) {
        throw new Error("The response body is empty.");
      }
      let accumulatedText = "";
      let latestObject = void 0;
      await response.body.pipeThrough(new TextDecoderStream()).pipeTo(
        new WritableStream({
          async write(chunk) {
            accumulatedText += chunk;
            const { value } = await parsePartialJson(accumulatedText);
            const currentObject = value;
            if (!isDeepEqualData(latestObject, currentObject)) {
              latestObject = currentObject;
              mutate(currentObject);
            }
          },
          async close() {
            setIsLoading(false);
            abortControllerRef.current = null;
            if (onFinish != null) {
              const validationResult = await safeValidateTypes({
                value: latestObject,
                schema: asSchema(schema)
              });
              onFinish(
                validationResult.success ? { object: validationResult.value, error: void 0 } : { object: void 0, error: validationResult.error }
              );
            }
          }
        })
      );
    } catch (error2) {
      if (isAbortError(error2)) {
        return;
      }
      if (onError && error2 instanceof Error) {
        onError(error2);
      }
      setIsLoading(false);
      setError(error2 instanceof Error ? error2 : new Error(String(error2)));
    }
  };
  const clear = () => {
    stop();
    clearObject();
  };
  const clearObject = () => {
    setError(void 0);
    setIsLoading(false);
    mutate(void 0);
  };
  return {
    submit,
    object: data,
    error,
    isLoading,
    stop,
    clear
  };
}

// src/use-chat.ts
import {
  DefaultChatTransport
} from "ai";
import { useCallback as useCallback2, useEffect, useRef as useRef2, useSyncExternalStore } from "react";

// src/chat.react.ts
import {
  AbstractChat
} from "ai";

// src/throttle.ts
import throttleFunction from "throttleit";
function throttle(fn, waitMs) {
  return waitMs != null ? throttleFunction(fn, waitMs) : fn;
}

// src/chat.react.ts
var _messages, _status, _error, _messagesCallbacks, _statusCallbacks, _errorCallbacks, _callMessagesCallbacks, _callStatusCallbacks, _callErrorCallbacks;
var ReactChatState = class {
  constructor(initialMessages = []) {
    __privateAdd(this, _messages, void 0);
    __privateAdd(this, _status, "ready");
    __privateAdd(this, _error, void 0);
    __privateAdd(this, _messagesCallbacks, /* @__PURE__ */ new Set());
    __privateAdd(this, _statusCallbacks, /* @__PURE__ */ new Set());
    __privateAdd(this, _errorCallbacks, /* @__PURE__ */ new Set());
    this.pushMessage = (message) => {
      __privateSet(this, _messages, __privateGet(this, _messages).concat(message));
      __privateGet(this, _callMessagesCallbacks).call(this);
    };
    this.popMessage = () => {
      __privateSet(this, _messages, __privateGet(this, _messages).slice(0, -1));
      __privateGet(this, _callMessagesCallbacks).call(this);
    };
    this.replaceMessage = (index, message) => {
      __privateSet(this, _messages, [
        ...__privateGet(this, _messages).slice(0, index),
        // We deep clone the message here to ensure the new React Compiler (currently in RC) detects deeply nested parts/metadata changes:
        this.snapshot(message),
        ...__privateGet(this, _messages).slice(index + 1)
      ]);
      __privateGet(this, _callMessagesCallbacks).call(this);
    };
    this.snapshot = (value) => structuredClone(value);
    this["~registerMessagesCallback"] = (onChange, throttleWaitMs) => {
      const callback = throttleWaitMs ? throttle(onChange, throttleWaitMs) : onChange;
      __privateGet(this, _messagesCallbacks).add(callback);
      return () => {
        __privateGet(this, _messagesCallbacks).delete(callback);
      };
    };
    this["~registerStatusCallback"] = (onChange) => {
      __privateGet(this, _statusCallbacks).add(onChange);
      return () => {
        __privateGet(this, _statusCallbacks).delete(onChange);
      };
    };
    this["~registerErrorCallback"] = (onChange) => {
      __privateGet(this, _errorCallbacks).add(onChange);
      return () => {
        __privateGet(this, _errorCallbacks).delete(onChange);
      };
    };
    __privateAdd(this, _callMessagesCallbacks, () => {
      __privateGet(this, _messagesCallbacks).forEach((callback) => callback());
    });
    __privateAdd(this, _callStatusCallbacks, () => {
      __privateGet(this, _statusCallbacks).forEach((callback) => callback());
    });
    __privateAdd(this, _callErrorCallbacks, () => {
      __privateGet(this, _errorCallbacks).forEach((callback) => callback());
    });
    __privateSet(this, _messages, initialMessages);
  }
  get status() {
    return __privateGet(this, _status);
  }
  set status(newStatus) {
    __privateSet(this, _status, newStatus);
    __privateGet(this, _callStatusCallbacks).call(this);
  }
  get error() {
    return __privateGet(this, _error);
  }
  set error(newError) {
    __privateSet(this, _error, newError);
    __privateGet(this, _callErrorCallbacks).call(this);
  }
  get messages() {
    return __privateGet(this, _messages);
  }
  set messages(newMessages) {
    __privateSet(this, _messages, [...newMessages]);
    __privateGet(this, _callMessagesCallbacks).call(this);
  }
};
_messages = new WeakMap();
_status = new WeakMap();
_error = new WeakMap();
_messagesCallbacks = new WeakMap();
_statusCallbacks = new WeakMap();
_errorCallbacks = new WeakMap();
_callMessagesCallbacks = new WeakMap();
_callStatusCallbacks = new WeakMap();
_callErrorCallbacks = new WeakMap();
var _state;
var Chat = class extends AbstractChat {
  constructor({ messages, ...init }) {
    const state = new ReactChatState(messages);
    super({ ...init, state });
    __privateAdd(this, _state, void 0);
    this["~registerMessagesCallback"] = (onChange, throttleWaitMs) => __privateGet(this, _state)["~registerMessagesCallback"](onChange, throttleWaitMs);
    this["~registerStatusCallback"] = (onChange) => __privateGet(this, _state)["~registerStatusCallback"](onChange);
    this["~registerErrorCallback"] = (onChange) => __privateGet(this, _state)["~registerErrorCallback"](onChange);
    __privateSet(this, _state, state);
  }
};
_state = new WeakMap();

// src/use-chat.ts
function useChat({
  throttle: throttle2,
  experimental_throttle,
  resume = false,
  ...options
} = {}) {
  const throttleWaitMs = throttle2 != null ? throttle2 : experimental_throttle;
  const latestRef = useRef2({});
  if (!("chat" in options)) {
    latestRef.current = {
      onToolCall: options.onToolCall,
      onData: options.onData,
      onFinish: options.onFinish,
      onError: options.onError,
      sendAutomaticallyWhen: options.sendAutomaticallyWhen,
      transport: options.transport
    };
  }
  let defaultTransport;
  const getTransport = () => {
    var _a;
    return (_a = latestRef.current.transport) != null ? _a : defaultTransport != null ? defaultTransport : defaultTransport = new DefaultChatTransport();
  };
  const chatOptions = {
    ...options,
    transport: {
      sendMessages: (sendOptions) => getTransport().sendMessages(sendOptions),
      reconnectToStream: (reconnectOptions) => getTransport().reconnectToStream(reconnectOptions)
    },
    onToolCall: (arg) => {
      var _a, _b;
      return (_b = (_a = latestRef.current).onToolCall) == null ? void 0 : _b.call(_a, arg);
    },
    onData: (arg) => {
      var _a, _b;
      return (_b = (_a = latestRef.current).onData) == null ? void 0 : _b.call(_a, arg);
    },
    onFinish: (arg) => {
      var _a, _b;
      return (_b = (_a = latestRef.current).onFinish) == null ? void 0 : _b.call(_a, arg);
    },
    onError: (arg) => {
      var _a, _b;
      return (_b = (_a = latestRef.current).onError) == null ? void 0 : _b.call(_a, arg);
    },
    sendAutomaticallyWhen: (arg) => {
      var _a, _b, _c;
      return (_c = (_b = (_a = latestRef.current).sendAutomaticallyWhen) == null ? void 0 : _b.call(_a, arg)) != null ? _c : false;
    }
  };
  const chatRef = useRef2(
    "chat" in options ? options.chat : new Chat(chatOptions)
  );
  const shouldRecreateChat = "chat" in options && options.chat !== chatRef.current || "id" in options && options.id != null && chatRef.current.id !== options.id;
  if (shouldRecreateChat) {
    chatRef.current = "chat" in options ? options.chat : new Chat(chatOptions);
  }
  const subscribeToMessages = useCallback2(
    (update) => chatRef.current["~registerMessagesCallback"](update, throttleWaitMs),
    // `chatRef.current.id` is required to trigger re-subscription when the chat ID changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [throttleWaitMs, chatRef.current.id]
  );
  const messages = useSyncExternalStore(
    subscribeToMessages,
    () => chatRef.current.messages,
    () => chatRef.current.messages
  );
  const status = useSyncExternalStore(
    chatRef.current["~registerStatusCallback"],
    () => chatRef.current.status,
    () => chatRef.current.status
  );
  const error = useSyncExternalStore(
    chatRef.current["~registerErrorCallback"],
    () => chatRef.current.error,
    () => chatRef.current.error
  );
  const setMessages = useCallback2(
    (messagesParam) => {
      if (typeof messagesParam === "function") {
        messagesParam = messagesParam(chatRef.current.messages);
      }
      chatRef.current.messages = messagesParam;
    },
    [chatRef]
  );
  useEffect(() => {
    if (resume) {
      chatRef.current.resumeStream();
    }
  }, [resume, chatRef]);
  return {
    id: chatRef.current.id,
    messages,
    setMessages,
    sendMessage: chatRef.current.sendMessage,
    regenerate: chatRef.current.regenerate,
    clearError: chatRef.current.clearError,
    stop: chatRef.current.stop,
    error,
    resumeStream: chatRef.current.resumeStream,
    status,
    /**
     * @deprecated Use `addToolOutput` instead.
     */
    addToolResult: chatRef.current.addToolOutput,
    addToolOutput: chatRef.current.addToolOutput,
    addToolApprovalResponse: chatRef.current.addToolApprovalResponse
  };
}

// src/use-completion.ts
import {
  callCompletionApi
} from "ai";
import { useCallback as useCallback3, useEffect as useEffect2, useId as useId2, useRef as useRef3, useState as useState2 } from "react";
import useSWR2 from "swr";
function useCompletion({
  api = "/api/completion",
  id,
  initialCompletion = "",
  initialInput = "",
  credentials,
  headers,
  body,
  streamProtocol = "data",
  fetch: fetch2,
  onFinish,
  onError,
  throttle: throttleWait,
  experimental_throttle
} = {}) {
  const throttleWaitMs = throttleWait != null ? throttleWait : experimental_throttle;
  const hookId = useId2();
  const completionId = id || hookId;
  const { data, mutate } = useSWR2([api, completionId], null, {
    fallbackData: initialCompletion
  });
  const { data: isLoading = false, mutate: mutateLoading } = useSWR2(
    [completionId, "loading"],
    null
  );
  const [error, setError] = useState2(void 0);
  const completion = data;
  const [abortController, setAbortController] = useState2(null);
  const extraMetadataRef = useRef3({
    credentials,
    headers,
    body
  });
  useEffect2(() => {
    extraMetadataRef.current = {
      credentials,
      headers,
      body
    };
  }, [credentials, headers, body]);
  const triggerRequest = useCallback3(
    async (prompt, options) => callCompletionApi({
      api,
      prompt,
      credentials: extraMetadataRef.current.credentials,
      headers: { ...extraMetadataRef.current.headers, ...options == null ? void 0 : options.headers },
      body: {
        ...extraMetadataRef.current.body,
        ...options == null ? void 0 : options.body
      },
      streamProtocol,
      fetch: fetch2,
      // throttle streamed ui updates:
      setCompletion: throttle(
        (completion2) => mutate(completion2, false),
        throttleWaitMs
      ),
      setLoading: mutateLoading,
      setError,
      setAbortController,
      onFinish,
      onError
    }),
    [
      mutate,
      mutateLoading,
      api,
      extraMetadataRef,
      setAbortController,
      onFinish,
      onError,
      setError,
      streamProtocol,
      fetch2,
      throttleWaitMs
    ]
  );
  const stop = useCallback3(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
  }, [abortController]);
  const setCompletion = useCallback3(
    (completion2) => {
      mutate(completion2, false);
    },
    [mutate]
  );
  const complete = useCallback3(
    async (prompt, options) => {
      return triggerRequest(prompt, options);
    },
    [triggerRequest]
  );
  const [input, setInput] = useState2(initialInput);
  const handleSubmit = useCallback3(
    (event) => {
      var _a;
      (_a = event == null ? void 0 : event.preventDefault) == null ? void 0 : _a.call(event);
      return input ? complete(input) : void 0;
    },
    [input, complete]
  );
  const handleInputChange = useCallback3(
    (e) => {
      setInput(e.target.value);
    },
    [setInput]
  );
  return {
    completion,
    complete,
    error,
    setCompletion,
    stop,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    isLoading
  };
}

// src/use-realtime.ts
import {
  Experimental_AbstractRealtimeSession as AbstractRealtimeSession
} from "ai";
import { useCallback as useCallback4, useEffect as useEffect3, useRef as useRef4, useSyncExternalStore as useSyncExternalStore2 } from "react";
function getRealtimeStoreKey(options) {
  return {
    model: options.model,
    token: options.api.token,
    sessionConfig: options.sessionConfig,
    sampleRate: options.sampleRate,
    maxEvents: options.maxEvents
  };
}
function shouldCreateRealtimeStore(currentKey, nextOptions) {
  return currentKey.model !== nextOptions.model || currentKey.token !== nextOptions.api.token || currentKey.sessionConfig !== nextOptions.sessionConfig || currentKey.sampleRate !== nextOptions.sampleRate || currentKey.maxEvents !== nextOptions.maxEvents;
}
var RealtimeStore = class extends AbstractRealtimeSession {
  constructor() {
    super(...arguments);
    this.state = {
      status: "disconnected",
      messages: [],
      events: [],
      isCapturing: false,
      isPlaying: false
    };
    this.callbacks = {
      status: /* @__PURE__ */ new Set(),
      messages: /* @__PURE__ */ new Set(),
      events: /* @__PURE__ */ new Set(),
      isCapturing: /* @__PURE__ */ new Set(),
      isPlaying: /* @__PURE__ */ new Set()
    };
  }
  get status() {
    return this.state.status;
  }
  get messages() {
    return this.state.messages;
  }
  get events() {
    return this.state.events;
  }
  get isCapturing() {
    return this.state.isCapturing;
  }
  get isPlaying() {
    return this.state.isPlaying;
  }
  subscribe(key, onChange) {
    this.callbacks[key].add(onChange);
    return () => {
      this.callbacks[key].delete(onChange);
    };
  }
  setState(key, value) {
    this.state = { ...this.state, [key]: value };
    this.callbacks[key].forEach((callback) => callback());
  }
  pushMessage(message) {
    this.state = {
      ...this.state,
      messages: [...this.state.messages, message]
    };
    this.callbacks.messages.forEach((callback) => callback());
  }
  updateMessages(updater) {
    this.state = {
      ...this.state,
      messages: updater(this.state.messages)
    };
    this.callbacks.messages.forEach((callback) => callback());
  }
  pushEvent(event) {
    const nextEvents = [...this.state.events, event];
    this.state = {
      ...this.state,
      events: nextEvents.length > this.maxEvents ? nextEvents.slice(-this.maxEvents) : nextEvents
    };
    this.callbacks.events.forEach((callback) => callback());
  }
};
function useRealtime(options) {
  const callbacksRef = useRef4({
    onToolCall: options.onToolCall,
    onEvent: options.onEvent,
    onError: options.onError
  });
  callbacksRef.current = {
    onToolCall: options.onToolCall,
    onEvent: options.onEvent,
    onError: options.onError
  };
  const realtimeRef = useRef4(null);
  let realtimeEntry = realtimeRef.current;
  if (realtimeEntry == null || shouldCreateRealtimeStore(realtimeEntry.key, options)) {
    realtimeEntry = {
      store: new RealtimeStore({
        ...options,
        onToolCall: (...args) => {
          var _a, _b;
          return (_b = (_a = callbacksRef.current).onToolCall) == null ? void 0 : _b.call(_a, ...args);
        },
        onEvent: (...args) => {
          var _a, _b;
          return (_b = (_a = callbacksRef.current).onEvent) == null ? void 0 : _b.call(_a, ...args);
        },
        onError: (...args) => {
          var _a, _b;
          return (_b = (_a = callbacksRef.current).onError) == null ? void 0 : _b.call(_a, ...args);
        }
      }),
      key: getRealtimeStoreKey(options)
    };
    realtimeRef.current = realtimeEntry;
  } else {
    realtimeEntry.key = getRealtimeStoreKey(options);
  }
  const rt = realtimeEntry.store;
  const status = useSyncExternalStore2(
    useCallback4((cb) => rt.subscribe("status", cb), [rt]),
    () => rt.status,
    () => rt.status
  );
  const messages = useSyncExternalStore2(
    useCallback4((cb) => rt.subscribe("messages", cb), [rt]),
    () => rt.messages,
    () => rt.messages
  );
  const events = useSyncExternalStore2(
    useCallback4((cb) => rt.subscribe("events", cb), [rt]),
    () => rt.events,
    () => rt.events
  );
  const isCapturing = useSyncExternalStore2(
    useCallback4((cb) => rt.subscribe("isCapturing", cb), [rt]),
    () => rt.isCapturing,
    () => rt.isCapturing
  );
  const isPlaying = useSyncExternalStore2(
    useCallback4((cb) => rt.subscribe("isPlaying", cb), [rt]),
    () => rt.isPlaying,
    () => rt.isPlaying
  );
  useEffect3(() => {
    return () => rt.dispose();
  }, [rt]);
  return {
    status,
    messages,
    events,
    isCapturing,
    isPlaying,
    connect: rt.connect.bind(rt),
    disconnect: rt.disconnect.bind(rt),
    addToolOutput: rt.addToolOutput.bind(rt),
    sendEvent: rt.sendEvent.bind(rt),
    sendTextMessage: rt.sendTextMessage.bind(rt),
    sendAudio: rt.sendAudio.bind(rt),
    commitAudio: rt.commitAudio.bind(rt),
    clearAudioBuffer: rt.clearAudioBuffer.bind(rt),
    requestResponse: rt.requestResponse.bind(rt),
    cancelResponse: rt.cancelResponse.bind(rt),
    startAudioCapture: rt.startAudioCapture.bind(rt),
    stopAudioCapture: rt.stopAudioCapture.bind(rt),
    stopPlayback: rt.stopPlayback.bind(rt)
  };
}
var experimental_useRealtime = useRealtime;

// src/mcp-apps/app-renderer.tsx
import { useEffect as useEffect5, useState as useState3 } from "react";

// src/mcp-apps/app-frame.tsx
import { useEffect as useEffect4, useMemo, useRef as useRef5 } from "react";

// src/mcp-apps/bridge.ts
import { isJSONObject } from "@ai-sdk/provider";
var MCP_APP_PROTOCOL_VERSION = "2026-01-26";
function isJsonRpcMessage(value) {
  return value != null && typeof value === "object" && !Array.isArray(value) && "jsonrpc" in value && value.jsonrpc === "2.0";
}
function isRequest(message) {
  return "method" in message && "id" in message;
}
function isNotification(message) {
  return "method" in message && !("id" in message);
}
function toError(error) {
  return error instanceof Error ? error : new Error(String(error));
}
function assertToolCallParams(params) {
  if (!isJSONObject(params) || typeof params.name !== "string") {
    throw new Error("Invalid tools/call params");
  }
  return {
    name: params.name,
    arguments: isJSONObject(params.arguments) ? params.arguments : void 0
  };
}
function assertResourceReadParams(params) {
  if (!isJSONObject(params) || typeof params.uri !== "string") {
    throw new Error("Invalid resources/read params");
  }
  if (!params.uri.startsWith("ui://")) {
    throw new Error(
      `resources/read is limited to ui:// resources: ${params.uri}`
    );
  }
  return { uri: params.uri };
}
function assertOpenLinkParams(params) {
  if (!isJSONObject(params) || typeof params.url !== "string") {
    throw new Error("Invalid ui/open-link params");
  }
  let scheme;
  try {
    scheme = new URL(params.url).protocol;
  } catch (e) {
    throw new Error(`Invalid ui/open-link url: ${params.url}`);
  }
  if (scheme !== "https:" && scheme !== "http:" && scheme !== "mailto:") {
    throw new Error(`Disallowed ui/open-link scheme: ${scheme}`);
  }
  return { url: params.url };
}
function assertDisplayModeParams(params) {
  if (!isJSONObject(params) || params.mode !== "inline" && params.mode !== "fullscreen" && params.mode !== "pip") {
    throw new Error("Invalid ui/request-display-mode params");
  }
  return { mode: params.mode };
}
var MCPAppBridge = class {
  constructor({
    targetWindow,
    targetOrigin = "*",
    handlers = {},
    hostInfo = { name: "ai-sdk-react", version: "1.0.0" },
    hostContext = { displayMode: "inline" }
  }) {
    this.initialized = false;
    this.pendingNotifications = [];
    this.nextRequestId = 0;
    this.pendingResponses = /* @__PURE__ */ new Map();
    this.targetWindow = targetWindow;
    this.targetOrigin = targetOrigin;
    this.handlers = handlers;
    this.hostInfo = hostInfo;
    this.hostContext = hostContext;
  }
  /**
   * Replaces the callbacks used to serve iframe requests.
   */
  setHandlers(handlers) {
    this.handlers = handlers;
  }
  /**
   * Updates host context and notifies the iframe after initialization.
   *
   * @example
   * ```ts
   * bridge.setHostContext({ theme: 'dark', displayMode: 'inline' });
   * ```
   */
  setHostContext(hostContext) {
    this.hostContext = hostContext;
    this.sendNotification({
      method: "ui/notifications/host-context-changed",
      params: hostContext
    });
  }
  /**
   * Whether a `message` event came from the expected proxy window and origin.
   * The origin check is skipped only when `targetOrigin` is the `'*'` default.
   * Callers that intercept events before {@link handleMessage} share this check.
   */
  acceptsEvent(event) {
    return event.source === this.targetWindow && (this.targetOrigin === "*" || event.origin === this.targetOrigin);
  }
  /**
   * Processes one `message` event from the sandbox proxy iframe.
   */
  handleMessage(event) {
    if (!this.acceptsEvent(event) || !isJsonRpcMessage(event.data)) {
      return;
    }
    const message = event.data;
    if ("result" in message || "error" in message) {
      this.handleResponse(message);
      return;
    }
    if (isRequest(message)) {
      void this.handleRequest(message);
      return;
    }
    if (isNotification(message)) {
      this.handleNotification(message);
    }
  }
  /**
   * Sends app HTML and sandbox settings to the sandbox proxy.
   */
  sendSandboxResourceReady(params) {
    this.post({
      jsonrpc: "2.0",
      method: "ui/notifications/sandbox-resource-ready",
      params
    });
  }
  /**
   * Sends final tool arguments to the MCP App.
   */
  sendToolInput(input) {
    this.sendNotification({
      method: "ui/notifications/tool-input",
      params: { arguments: input }
    });
  }
  /**
   * Sends a completed MCP tool result to the MCP App.
   */
  sendToolResult(result) {
    this.sendNotification({
      method: "ui/notifications/tool-result",
      params: result
    });
  }
  /**
   * Notifies the MCP App that the related tool call was cancelled.
   */
  sendToolCancelled(reason) {
    this.sendNotification({
      method: "ui/notifications/tool-cancelled",
      params: reason != null ? { reason } : {}
    });
  }
  /**
   * Requests graceful teardown before the host removes the iframe.
   */
  teardownResource() {
    return this.request("ui/resource-teardown", {});
  }
  /**
   * Rejects pending bridge requests and clears queued notifications.
   */
  close() {
    for (const pending of this.pendingResponses.values()) {
      pending.reject(new Error("MCP App bridge closed"));
    }
    this.pendingResponses.clear();
    this.pendingNotifications = [];
  }
  /**
   * Resolves or rejects a host-initiated request when the iframe responds.
   */
  handleResponse(response) {
    const pending = this.pendingResponses.get(response.id);
    if (pending == null) {
      return;
    }
    this.pendingResponses.delete(response.id);
    if (response.error != null) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }
  /**
   * Runs a handler for an iframe request and posts the JSON-RPC response.
   */
  async handleRequest(request) {
    var _a, _b;
    try {
      const result = await this.getRequestResult(request);
      this.post({ jsonrpc: "2.0", id: request.id, result });
    } catch (error) {
      const normalizedError = toError(error);
      (_b = (_a = this.handlers).onError) == null ? void 0 : _b.call(_a, normalizedError);
      this.post({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32603, message: normalizedError.message }
      });
    }
  }
  /**
   * Maps supported iframe request methods to host callbacks.
   */
  async getRequestResult(request) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    switch (request.method) {
      case "ui/initialize":
        return {
          protocolVersion: MCP_APP_PROTOCOL_VERSION,
          hostCapabilities: {
            ...this.handlers.callTool != null ? { serverTools: {} } : {},
            ...this.handlers.readResource != null ? { serverResources: {} } : {},
            ...this.handlers.onLog != null ? { logging: {} } : {}
          },
          hostInfo: this.hostInfo,
          hostContext: this.hostContext
        };
      case "tools/call": {
        if (this.handlers.callTool == null) {
          throw new Error("No tools/call handler configured");
        }
        const params = assertToolCallParams(request.params);
        if (this.handlers.allowedTools == null || !this.handlers.allowedTools.includes(params.name)) {
          throw new Error(`Tool is not app-visible: ${params.name}`);
        }
        return this.handlers.callTool(params);
      }
      case "resources/read":
        if (this.handlers.readResource == null) {
          throw new Error("No resources/read handler configured");
        }
        return this.handlers.readResource(
          assertResourceReadParams(request.params)
        );
      case "resources/list":
        if (this.handlers.listResources == null) {
          throw new Error("No resources/list handler configured");
        }
        return this.handlers.listResources(request.params);
      case "ui/open-link":
        if (this.handlers.openLink == null) {
          throw new Error("No ui/open-link handler configured");
        }
        return this.handlers.openLink(assertOpenLinkParams(request.params));
      case "ui/message":
        return (_c = (_b = (_a = this.handlers).sendMessage) == null ? void 0 : _b.call(_a, request.params)) != null ? _c : {};
      case "ui/update-model-context":
        return (_f = (_e = (_d = this.handlers).updateModelContext) == null ? void 0 : _e.call(_d, request.params)) != null ? _f : {};
      case "ui/request-display-mode":
        return (_j = (_h = (_g = this.handlers).requestDisplayMode) == null ? void 0 : _h.call(
          _g,
          assertDisplayModeParams(request.params)
        )) != null ? _j : { mode: (_i = this.hostContext.displayMode) != null ? _i : "inline" };
      default:
        throw new Error(`Unsupported MCP App method: ${request.method}`);
    }
  }
  /**
   * Handles iframe lifecycle and telemetry notifications.
   */
  handleNotification(notification) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    switch (notification.method) {
      case "ui/notifications/initialized":
        this.initialized = true;
        this.flushNotifications();
        (_b = (_a = this.handlers).onInitialized) == null ? void 0 : _b.call(_a);
        break;
      case "ui/notifications/size-changed":
        (_d = (_c = this.handlers).onSizeChange) == null ? void 0 : _d.call(
          _c,
          notification.params
        );
        break;
      case "ui/notifications/request-teardown":
        (_f = (_e = this.handlers).onRequestTeardown) == null ? void 0 : _f.call(_e, notification.params);
        break;
      case "notifications/message":
        (_h = (_g = this.handlers).onLog) == null ? void 0 : _h.call(_g, notification.params);
        break;
    }
  }
  /**
   * Sends a host-to-iframe notification, queueing it until app initialization.
   */
  sendNotification(notification) {
    const message = { jsonrpc: "2.0", ...notification };
    if (!this.initialized && !notification.method.includes("sandbox")) {
      this.pendingNotifications.push(message);
      return;
    }
    this.post(message);
  }
  /**
   * Sends notifications that were queued before `ui/notifications/initialized`.
   */
  flushNotifications() {
    const notifications = this.pendingNotifications;
    this.pendingNotifications = [];
    for (const notification of notifications) {
      this.post(notification);
    }
  }
  /**
   * Sends a host-initiated JSON-RPC request to the iframe.
   */
  request(method, params) {
    const id = this.nextRequestId++;
    this.post({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve2, reject) => {
      this.pendingResponses.set(id, { resolve: resolve2, reject });
    });
  }
  /**
   * Posts a JSON-RPC message to the sandbox proxy iframe.
   */
  post(message) {
    this.targetWindow.postMessage(message, this.targetOrigin);
  }
};

// src/mcp-apps/sandbox.ts
var ALLOWED_CSP_SCHEMES = /* @__PURE__ */ new Set(["https:", "wss:"]);
function sanitizeCSPSources(sources) {
  const result = [];
  for (const source of sources != null ? sources : []) {
    if (typeof source !== "string") {
      continue;
    }
    let origin;
    try {
      const url = new URL(source);
      if (!ALLOWED_CSP_SCHEMES.has(url.protocol) || url.host.length === 0 || url.host === "*") {
        continue;
      }
      origin = url.origin;
    } catch (e) {
      continue;
    }
    if (/["'`\s;,]/.test(origin)) {
      continue;
    }
    result.push(origin);
  }
  return result;
}
var MCP_APP_DEFAULT_OUTER_SANDBOX = "allow-scripts allow-same-origin allow-forms";
var MCP_APP_DEFAULT_INNER_SANDBOX = "allow-scripts allow-forms";
function getMCPAppCSP(csp) {
  if (csp == null) {
    return void 0;
  }
  const connectSrc = ["'self'", ...sanitizeCSPSources(csp.connectDomains)];
  const imgSrc = [
    "'self'",
    "data:",
    ...sanitizeCSPSources(csp.resourceDomains)
  ];
  const frameSrc = ["'self'", ...sanitizeCSPSources(csp.frameDomains)];
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `connect-src ${connectSrc.join(" ")}`,
    `img-src ${imgSrc.join(" ")}`,
    `font-src ${imgSrc.join(" ")}`,
    `frame-src ${frameSrc.join(" ")}`
  ].join("; ");
}
var MCP_APP_PERMISSION_FEATURES = {
  camera: "camera",
  microphone: "microphone",
  geolocation: "geolocation",
  clipboardWrite: "clipboard-write"
};
function getMCPAppAllowAttribute(permissions, allowedPermissions) {
  if (permissions == null || allowedPermissions == null) {
    return void 0;
  }
  const allow = allowedPermissions.filter((permission) => Boolean(permissions[permission])).map((permission) => MCP_APP_PERMISSION_FEATURES[permission]);
  return allow.length > 0 ? allow.join("; ") : void 0;
}

// src/mcp-apps/utils.ts
import { isJSONObject as isJSONObject2 } from "@ai-sdk/provider";
function getMCPAppFromToolPart(part) {
  var _a;
  const rawAppMetadata = (_a = part.toolMetadata) == null ? void 0 : _a.app;
  const appMetadata = isJSONObject2(rawAppMetadata) ? rawAppMetadata : void 0;
  if (appMetadata == null || appMetadata.mimeType !== "text/html;profile=mcp-app" || typeof appMetadata.resourceUri !== "string" || !appMetadata.resourceUri.startsWith("ui://") || appMetadata.visibility != null && (!Array.isArray(appMetadata.visibility) || appMetadata.visibility.some(
    (value) => value !== "model" && value !== "app"
  ))) {
    return void 0;
  }
  return appMetadata;
}
function normalizeMCPAppToolResult(output) {
  if (output != null && typeof output === "object" && "content" in output) {
    return output;
  }
  return {
    content: [],
    structuredContent: output
  };
}

// src/mcp-apps/app-frame.tsx
import { jsx } from "react/jsx-runtime";
function deriveTargetOrigin(url) {
  var _a;
  const location = typeof window !== "undefined" ? window.location : void 0;
  try {
    return new URL(url, location == null ? void 0 : location.href).origin;
  } catch (e) {
    return (_a = location == null ? void 0 : location.origin) != null ? _a : "null";
  }
}
function sendToolState({
  bridge,
  input,
  output
}) {
  if (bridge == null) {
    return;
  }
  if (input !== void 0) {
    bridge.sendToolInput(input);
  }
  if (output !== void 0) {
    bridge.sendToolResult(normalizeMCPAppToolResult(output));
  }
}
function MCPAppFrame({
  app,
  resource,
  input,
  output,
  sandbox,
  handlers,
  hostInfo,
  hostContext
}) {
  var _a, _b, _c, _d, _e, _f;
  const iframeRef = useRef5(null);
  const bridgeRef = useRef5(void 0);
  const inputRef = useRef5(input);
  const outputRef = useRef5(output);
  const hostContextRef = useRef5(hostContext);
  const initializedRef = useRef5(false);
  inputRef.current = input;
  outputRef.current = output;
  hostContextRef.current = hostContext;
  const sandboxUrl = String(sandbox.url);
  const targetOrigin = (_a = sandbox.targetOrigin) != null ? _a : deriveTargetOrigin(sandboxUrl);
  const resourceCSP = getMCPAppCSP((_b = resource.meta) == null ? void 0 : _b.csp);
  const resourceAllow = getMCPAppAllowAttribute(
    (_c = resource.meta) == null ? void 0 : _c.permissions,
    sandbox.allowedPermissions
  );
  const innerSandbox = (_d = sandbox.innerSandbox) != null ? _d : MCP_APP_DEFAULT_INNER_SANDBOX;
  const bridgeHandlers = useMemo(
    () => ({
      ...handlers,
      onInitialized: () => {
        var _a2;
        initializedRef.current = true;
        (_a2 = handlers == null ? void 0 : handlers.onInitialized) == null ? void 0 : _a2.call(handlers);
        sendToolState({
          bridge: bridgeRef.current,
          input: inputRef.current,
          output: outputRef.current
        });
      }
    }),
    [handlers]
  );
  const bridgeHandlersRef = useRef5(bridgeHandlers);
  bridgeHandlersRef.current = bridgeHandlers;
  useEffect4(() => {
    const iframe = iframeRef.current;
    const targetWindow = iframe == null ? void 0 : iframe.contentWindow;
    if (targetWindow == null) {
      return;
    }
    initializedRef.current = false;
    const bridge = new MCPAppBridge({
      targetWindow,
      targetOrigin,
      handlers: bridgeHandlersRef.current,
      hostInfo,
      hostContext: hostContextRef.current
    });
    bridgeRef.current = bridge;
    const onMessage = (event) => {
      var _a2;
      if (!bridge.acceptsEvent(event)) {
        return;
      }
      if (((_a2 = event.data) == null ? void 0 : _a2.jsonrpc) === "2.0" && event.data.method === "ui/notifications/sandbox-proxy-ready") {
        bridge.sendSandboxResourceReady({
          html: resource.html,
          csp: resourceCSP,
          sandbox: innerSandbox,
          allow: resourceAllow
        });
        return;
      }
      bridge.handleMessage(event);
    };
    window.addEventListener("message", onMessage);
    return () => {
      initializedRef.current = false;
      window.removeEventListener("message", onMessage);
      void bridge.teardownResource().catch(() => {
      });
      bridge.close();
      bridgeRef.current = void 0;
    };
  }, [
    hostInfo,
    innerSandbox,
    resource.html,
    resourceAllow,
    resourceCSP,
    sandboxUrl,
    targetOrigin
  ]);
  useEffect4(() => {
    var _a2;
    (_a2 = bridgeRef.current) == null ? void 0 : _a2.setHandlers(bridgeHandlers);
  }, [bridgeHandlers]);
  useEffect4(() => {
    var _a2;
    if (hostContext != null) {
      (_a2 = bridgeRef.current) == null ? void 0 : _a2.setHostContext(hostContext);
    }
  }, [hostContext]);
  useEffect4(() => {
    var _a2;
    if (initializedRef.current && input !== void 0) {
      (_a2 = bridgeRef.current) == null ? void 0 : _a2.sendToolInput(input);
    }
  }, [input]);
  useEffect4(() => {
    var _a2;
    if (initializedRef.current && output !== void 0) {
      (_a2 = bridgeRef.current) == null ? void 0 : _a2.sendToolResult(normalizeMCPAppToolResult(output));
    }
  }, [output]);
  return /* @__PURE__ */ jsx(
    "iframe",
    {
      ref: iframeRef,
      title: "MCP App",
      "aria-label": (_e = sandbox.title) != null ? _e : app.resourceUri,
      src: sandboxUrl,
      className: sandbox.className,
      style: sandbox.style,
      allow: resourceAllow,
      sandbox: (_f = sandbox.outerSandbox) != null ? _f : MCP_APP_DEFAULT_OUTER_SANDBOX
    }
  );
}

// src/mcp-apps/app-renderer.tsx
import { jsx as jsx2 } from "react/jsx-runtime";
function getToolPartOutput(part) {
  return part.state === "output-available" ? part.output : void 0;
}
function getToolPartInput(part) {
  return part.state === "input-available" || part.state === "output-available" ? part.input : void 0;
}
function MCPAppRenderer({
  part,
  sandbox,
  resource: resourceProp,
  loadResource,
  handlers,
  hostInfo,
  hostContext,
  fallback = null
}) {
  const app = getMCPAppFromToolPart(part);
  const [cachedApp, setCachedApp] = useState3();
  const [loadedResource, setLoadedResource] = useState3();
  useEffect5(() => {
    if (app != null) {
      setCachedApp(
        (previous) => (previous == null ? void 0 : previous.resourceUri) === app.resourceUri ? previous : app
      );
    }
  }, [app == null ? void 0 : app.resourceUri]);
  const appForRender = app != null ? app : cachedApp;
  useEffect5(() => {
    if (appForRender == null || resourceProp != null || loadResource == null) {
      return;
    }
    let cancelled = false;
    const resourceUri = appForRender.resourceUri;
    loadResource(appForRender).then((resource2) => {
      if (!cancelled) {
        setLoadedResource({ resourceUri, resource: resource2 });
      }
    }).catch((error2) => {
      if (!cancelled) {
        setLoadedResource({
          resourceUri,
          error: error2 instanceof Error ? error2 : new Error(String(error2))
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [appForRender == null ? void 0 : appForRender.resourceUri, loadResource, resourceProp]);
  const loadedResourceForApp = (loadedResource == null ? void 0 : loadedResource.resourceUri) === (appForRender == null ? void 0 : appForRender.resourceUri) ? loadedResource : void 0;
  const resource = resourceProp != null ? resourceProp : loadedResourceForApp == null ? void 0 : loadedResourceForApp.resource;
  const error = resourceProp == null ? loadedResourceForApp == null ? void 0 : loadedResourceForApp.error : void 0;
  if (appForRender == null || error != null || resource == null) {
    return fallback;
  }
  return /* @__PURE__ */ jsx2(
    MCPAppFrame,
    {
      app: appForRender,
      resource,
      input: getToolPartInput(part),
      output: getToolPartOutput(part),
      sandbox,
      handlers,
      hostInfo,
      hostContext
    }
  );
}

// src/index.ts
var experimental_useObject = useObject;
export {
  Chat,
  MCPAppRenderer as experimental_MCPAppRenderer,
  experimental_useObject,
  experimental_useRealtime,
  useChat,
  useCompletion,
  useObject
};
//# sourceMappingURL=index.js.map