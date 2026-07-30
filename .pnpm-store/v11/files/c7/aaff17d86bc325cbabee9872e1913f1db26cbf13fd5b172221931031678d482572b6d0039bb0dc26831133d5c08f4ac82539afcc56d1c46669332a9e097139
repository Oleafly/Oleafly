"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  USE_FETCH_STATUS: () => USE_FETCH_STATUS,
  useBreakpoint: () => useBreakpoint,
  useCallbackDeepCompare: () => useCallbackDeepCompare,
  useClickOutside: () => useClickOutside,
  useDataChanges: () => useDataChanges,
  useDebounce: () => useDebounce,
  useEffectDeepCompare: () => useEffectDeepCompare,
  useEffectOnce: () => useEffectOnce,
  useElementMeasure: () => useElementMeasure,
  useFetch: () => useFetch,
  useHasChanged: () => useHasChanged,
  useIntersectionObserver: () => useIntersectionObserver,
  useInterval: () => useInterval,
  useIsFirstRender: () => useIsFirstRender,
  useIsMounted: () => useIsMounted,
  useIsomorphicLayoutEffect: () => useIsomorphicLayoutEffect,
  useLatest: () => useLatest,
  useLifecycleHooks: () => useLifecycleHooks,
  useLocalStorage: () => useLocalStorage,
  useLocation: () => useLocation,
  useMediaQuery: () => useMediaQuery,
  useMemoDeepCompare: () => useMemoDeepCompare,
  useMemoizedValue: () => useMemoizedValue,
  useMergeRefs: () => useMergeRefs,
  useMount: () => useMount,
  useOnce: () => useOnce,
  usePersistentState: () => usePersistentState,
  usePrevious: () => usePrevious,
  useRenderCount: () => useRenderCount,
  useResizeObserver: () => useResizeObserver,
  useScript: () => useScript,
  useSetState: () => useSetState,
  useThrottle: () => useThrottle,
  useThrottleValue: () => useThrottleValue,
  useTimeout: () => useTimeout,
  useToggle: () => useToggle,
  useUnmount: () => useUnmount,
  useUpdate: () => useUpdate,
  useUpdateEffect: () => useUpdateEffect,
  useWindowSize: () => useWindowSize
});
module.exports = __toCommonJS(index_exports);

// src/useBreakpoint.tsx
var import_react = require("react");

// src/utils.ts
function canUseDOM() {
  return !!(typeof window !== "undefined" && window?.document?.createElement);
}
function getElement(target) {
  if (!canUseDOM()) {
    return null;
  }
  let targetEl;
  if (typeof target === "string") {
    targetEl = document.querySelector(target);
  } else {
    targetEl = target && "current" in target ? target.current : target;
  }
  return targetEl;
}
function isPlainObject(value) {
  if (Object.prototype.toString.call(value) !== "[object Object]") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.getPrototypeOf({});
}
function isPrimitive(value) {
  return value !== Object(value);
}
function isString(value) {
  return typeof value === "string";
}
function isURL(value) {
  if (!isString(value)) {
    return false;
  }
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
function noop() {
  return void 0;
}
function off(target, ...rest) {
  if (target && target.removeEventListener) {
    target.removeEventListener(...rest);
  }
}
function on(target, ...rest) {
  if (target && target.addEventListener) {
    target.addEventListener(...rest);
  }
}
function validateDependencies(dependencies, name, fallback) {
  if (process.env.NODE_ENV !== "production") {
    if (!(dependencies instanceof Array) || !dependencies.length) {
      console.warn(
        `${name} should not be used with no dependencies. Use React.${fallback} instead.`
      );
    }
    if (dependencies.length && dependencies.every(isPrimitive)) {
      console.warn(
        `${name} should not be used with dependencies that are all primitive values. Use React.${fallback} instead.`
      );
    }
  }
}

// src/useBreakpoint.tsx
var defaultBreakpoints = { xs: 0, sm: 400, md: 768, lg: 1024, xl: 1280 };
function useBreakpoint(customBreakpoints, initialWidth = Infinity, initialHeight = Infinity) {
  const breakpoints = customBreakpoints ?? defaultBreakpoints;
  const sizes = (0, import_react.useMemo)(
    () => Object.entries(breakpoints).sort(([, aSize], [, bSize]) => bSize - aSize),
    [breakpoints]
  );
  const smallestBreakpoint = sizes[sizes.length - 1];
  if (smallestBreakpoint[1] !== 0) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`The "${smallestBreakpoint[0]}" breakpoint should be 0`);
    }
  }
  const getScreen = (0, import_react.useCallback)(() => {
    const height = canUseDOM() ? window.innerHeight : initialHeight;
    const width = canUseDOM() ? window.innerWidth : initialWidth;
    const size = sizes.find(([, s]) => s <= width) || sizes[0];
    const orientation = width > height ? "landscape" : "portrait";
    return {
      between: (min, max, andOrientation) => width >= breakpoints[min] && width < breakpoints[max] && (!andOrientation || andOrientation === orientation),
      min: (breakpoint, andOrientation) => width >= breakpoints[breakpoint] && (!andOrientation || andOrientation === orientation),
      max: (breakpoint, andOrientation) => width < breakpoints[breakpoint] && (!andOrientation || andOrientation === orientation),
      orientation,
      size: size[0]
    };
  }, [breakpoints, initialHeight, initialWidth, sizes]);
  const [screen, setScreen] = (0, import_react.useState)(getScreen);
  (0, import_react.useEffect)(() => {
    const onResize = () => {
      setScreen((previous) => {
        const current = getScreen();
        return current.size !== previous.size || current.orientation !== previous.orientation ? current : previous;
      });
    };
    on(window, "resize", onResize);
    return () => off(window, "resize", onResize);
  }, [getScreen]);
  return screen;
}

// src/useCallbackDeepCompare.ts
var import_react2 = require("react");
var import_deep_equal = __toESM(require("@gilbarbara/deep-equal"));
function useCallbackDeepCompare(callback, dependencies) {
  validateDependencies(dependencies, "useCallbackDeepCompare", "useCallback");
  const ref = (0, import_react2.useRef)(dependencies);
  const callbackRef = (0, import_react2.useRef)(callback);
  if (!(0, import_deep_equal.default)(dependencies, ref.current)) {
    ref.current = dependencies;
    callbackRef.current = callback;
  }
  return (0, import_react2.useCallback)(
    (...arguments_) => callbackRef.current(...arguments_),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ref.current
  );
}

// src/useClickOutside.ts
var import_react6 = require("react");

// src/useMemoizedValue.ts
var import_react5 = require("react");

// src/useEffectDeepCompare.ts
var import_react3 = require("react");
var import_deep_equal2 = __toESM(require("@gilbarbara/deep-equal"));
function useEffectDeepCompare(effect, dependencies) {
  validateDependencies(dependencies, "useEffectDeepCompare", "useEffect");
  const ref = (0, import_react3.useRef)(dependencies);
  if (!(0, import_deep_equal2.default)(dependencies, ref.current)) {
    ref.current = dependencies;
  }
  (0, import_react3.useEffect)(effect, ref.current);
}

// src/useIsFirstRender.ts
var import_react4 = require("react");
function useIsFirstRender() {
  const isFirstRender = (0, import_react4.useRef)(true);
  if (isFirstRender.current) {
    isFirstRender.current = false;
    return true;
  }
  return isFirstRender.current;
}

// src/useMemoizedValue.ts
function useMemoizedValue(value) {
  const [stableValue, setStableValue] = (0, import_react5.useState)(() => value);
  const isFirstRender = useIsFirstRender();
  useEffectDeepCompare(() => {
    if (isFirstRender) {
      return;
    }
    setStableValue(() => value);
  }, [value]);
  return stableValue;
}

// src/useClickOutside.ts
function useClickOutside(callback) {
  const ref = (0, import_react6.useRef)(null);
  const memoizedCallback = useMemoizedValue(callback);
  (0, import_react6.useEffect)(() => {
    const handleClick = (event) => {
      if (!ref.current?.contains(event.target)) {
        memoizedCallback();
      }
    };
    on(document, "click", handleClick);
    return () => {
      off(document, "click", handleClick);
    };
  }, [memoizedCallback]);
  return ref;
}

// src/useDataChanges.tsx
var import_react8 = require("react");
var import_deep_equal3 = __toESM(require("@gilbarbara/deep-equal"));

// src/useUpdateEffect.ts
var import_react7 = require("react");
function useUpdateEffect(effect, dependencies) {
  const isFirstRender = useIsFirstRender();
  (0, import_react7.useEffect)(() => {
    if (!isFirstRender) {
      return effect();
    }
    return void 0;
  }, dependencies);
}

// src/useDataChanges.tsx
function useDataChanges(data, nameOrOptions = {}) {
  const previousData = (0, import_react8.useRef)(data);
  const [changes, setChanges] = (0, import_react8.useState)(void 0);
  const {
    comparison = "shallow",
    name,
    only,
    skipLog = false
  } = useMemoizedValue(isString(nameOrOptions) ? { name: nameOrOptions } : nameOrOptions);
  useUpdateEffect(() => {
    const keysToCheck = only ?? Object.keys({ ...previousData.current, ...data });
    const changesObject = {};
    keysToCheck.forEach((key) => {
      const hasChanged = comparison === "deep" ? !(0, import_deep_equal3.default)(previousData.current[key], data[key]) : previousData.current[key] !== data[key];
      if (hasChanged) {
        changesObject[key] = {
          from: previousData.current[key],
          to: data[key]
        };
      }
    });
    const hasChanges = Object.keys(changesObject).length > 0;
    setChanges(hasChanges ? changesObject : void 0);
    if (hasChanges && !skipLog) {
      const nameToken = name ? `: ${name}` : "";
      console.log(`[data-changes${nameToken}]`, changesObject);
    }
    previousData.current = data;
  }, [name, data, only, comparison, skipLog]);
  return changes;
}

// src/useDebounce.ts
var import_react9 = require("react");
function useDebounce(callback, delayMs = 250, dependencies = []) {
  const status = (0, import_react9.useRef)("pending");
  const timeout = (0, import_react9.useRef)(null);
  const savedCallback = (0, import_react9.useRef)(callback);
  const isFirstRender = useIsFirstRender();
  const clear = (0, import_react9.useCallback)(() => {
    status.current = "cancelled";
    timeout.current && clearTimeout(timeout.current);
  }, []);
  const set = (0, import_react9.useCallback)(() => {
    status.current = "pending";
    timeout.current && clearTimeout(timeout.current);
    timeout.current = setTimeout(() => {
      status.current = "completed";
      savedCallback.current();
    }, delayMs);
  }, [delayMs]);
  const getStatus = (0, import_react9.useCallback)(() => status.current, []);
  (0, import_react9.useEffect)(() => {
    savedCallback.current = callback;
  }, [callback]);
  useEffectDeepCompare(() => {
    if (!isFirstRender) {
      set();
      return clear;
    }
    return void 0;
  }, [set, clear, dependencies, delayMs]);
  return { cancel: clear, getStatus };
}

// src/useEffectOnce.ts
var import_react10 = require("react");
function useEffectOnce(effect) {
  const destroyFn = (0, import_react10.useRef)(null);
  const effectCalled = (0, import_react10.useRef)(false);
  const effectFn = (0, import_react10.useRef)(effect);
  (0, import_react10.useEffect)(() => {
    if (!effectCalled.current) {
      destroyFn.current = effectFn.current();
      effectCalled.current = true;
    }
    return () => {
      if (destroyFn.current) {
        destroyFn.current();
        destroyFn.current = null;
      }
    };
  }, []);
}

// src/useElementMeasure.tsx
var import_react13 = require("react");

// src/defaults.ts
var defaultElementDimensions = {
  absoluteHeight: 0,
  absoluteWidth: 0,
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  top: 0,
  width: 0,
  x: 0,
  y: 0
};

// src/useIsomorphicLayoutEffect.ts
var import_react11 = require("react");
var useIsomorphicLayoutEffect = canUseDOM() ? import_react11.useLayoutEffect : import_react11.useEffect;

// src/useResizeObserver.ts
var import_react12 = require("react");
function useResizeObserver(target, debounce = 0) {
  const [element, setElement] = (0, import_react12.useState)(getElement(target));
  const [value, setValue] = (0, import_react12.useState)();
  const timeoutRef = (0, import_react12.useRef)(null);
  const isFirstCall = (0, import_react12.useRef)(true);
  const observer = (0, import_react12.useMemo)(() => {
    if (!canUseDOM()) {
      return {};
    }
    return new window.ResizeObserver((entries) => {
      if (debounce && !isFirstCall.current) {
        if (timeoutRef.current) {
          window.clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = window.setTimeout(() => {
          setValue(entries[0]);
        }, debounce);
        return;
      }
      setValue(entries[0]);
      isFirstCall.current = false;
    });
  }, [debounce]);
  useIsomorphicLayoutEffect(() => {
    setElement(getElement(target));
  }, [target]);
  useIsomorphicLayoutEffect(() => {
    if (!canUseDOM() || !(observer instanceof ResizeObserver)) {
      return () => void 0;
    }
    if (!element) {
      return () => void 0;
    }
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element, observer]);
  return value;
}

// src/useElementMeasure.tsx
function getElementMeasure(element) {
  if (!canUseDOM() || !element) {
    return defaultElementDimensions;
  }
  const { bottom, height, left, right, top, width, x, y } = element.getBoundingClientRect();
  const {
    borderBottom,
    borderLeft,
    borderRight,
    borderTop,
    paddingBottom,
    paddingLeft,
    paddingRight,
    paddingTop
  } = getComputedStyle(element);
  return {
    absoluteHeight: height - parseFloatValue(paddingTop) - parseFloatValue(paddingBottom) - parseFloatValue(borderTop) - parseFloatValue(borderBottom),
    absoluteWidth: width - parseFloatValue(paddingLeft) - parseFloatValue(paddingRight) - parseFloatValue(borderLeft) - parseFloatValue(borderRight),
    bottom,
    height,
    left,
    right,
    top,
    width,
    x,
    y
  };
}
function parseFloatValue(value) {
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
function useElementMeasure(target, debounce = 0) {
  const [element, setElement] = (0, import_react13.useState)(getElement(target));
  const [dimensions, setDimensions] = (0, import_react13.useState)(getElementMeasure(element));
  const entry = useResizeObserver(element, debounce);
  useIsomorphicLayoutEffect(() => {
    const nextElement = getElement(target);
    setElement(nextElement);
    setDimensions(getElementMeasure(nextElement));
  }, [target]);
  useIsomorphicLayoutEffect(() => {
    if (!entry) {
      return;
    }
    const { bottom, height, left, right, top, width, x, y } = entry.contentRect;
    const { blockSize, inlineSize } = entry.borderBoxSize[0];
    setDimensions({
      absoluteHeight: blockSize,
      absoluteWidth: inlineSize,
      bottom,
      height,
      left,
      right,
      top,
      width,
      x,
      y
    });
  }, [entry]);
  return dimensions;
}

// src/useFetch.ts
var import_react17 = require("react");

// src/useIsMounted.ts
var import_react14 = require("react");
function useIsMounted() {
  const isMounted = (0, import_react14.useRef)(false);
  (0, import_react14.useEffect)(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);
  return (0, import_react14.useCallback)(() => isMounted.current, []);
}

// src/usePrevious.ts
var import_react15 = require("react");
function usePrevious(state) {
  const ref = (0, import_react15.useRef)(void 0);
  (0, import_react15.useEffect)(() => {
    ref.current = state;
  });
  return ref.current;
}

// src/useSetState.ts
var import_react16 = require("react");
function useSetState(initialState = {}) {
  const [state, set] = (0, import_react16.useState)(initialState);
  const setState = (0, import_react16.useCallback)((patch) => {
    set((previousState) => ({
      ...previousState,
      ...patch instanceof Function ? patch(previousState) : patch
    }));
  }, []);
  return [state, setState];
}

// src/useFetch.ts
var USE_FETCH_STATUS = {
  IDLE: "IDLE",
  LOADING: "LOADING",
  SUCCESS: "SUCCESS",
  ERROR: "ERROR"
};
var globalCache = /* @__PURE__ */ new Map();
async function request(options) {
  const {
    body = void 0,
    headers = {},
    method = "GET",
    mode = "cors",
    type = "json",
    url = ""
  } = options;
  const contentTypes = {
    json: "application/json",
    urlencoded: "application/x-www-form-urlencoded"
  };
  const params = {
    body: void 0,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": contentTypes[type],
      ...headers
    },
    method,
    mode,
    credentials: void 0
  };
  if (body) {
    params.body = isPlainObject(body) && type === "json" ? JSON.stringify(body) : body;
  }
  try {
    const response = await fetch(url, params);
    let content;
    try {
      content = await response.json();
    } catch {
      content = await response.text();
    }
    if (response.status > 299) {
      const error = new Error(response.statusText);
      error.status = response.status;
      error.response = content;
      throw error;
    }
    return content;
  } catch (error) {
    const fetchError = new Error("Network request failed");
    fetchError.status = 0;
    fetchError.response = error instanceof Error ? error.message : error;
    throw fetchError;
  }
}
var useFetchCache = {
  /**
   * Retrieve data from the cache.
   * @param url The URL to retrieve data for.
   * @returns Cached data or `undefined` if not found or expired.
   */
  get(url) {
    const cached = globalCache.get(url);
    if (cached && Date.now() < cached.expiry) {
      return cached;
    }
    globalCache.delete(url);
    return void 0;
  },
  /**
   * Set data in the cache.
   * @param url The URL to cache data for.
   * @param data The data to cache.
   * @param ttl Time-to-live in milliseconds.
   */
  set(url, data, ttl) {
    globalCache.set(url, { data, expiry: Date.now() + ttl });
  },
  /**
   * Clear the cache.
   * @param url Optional URL to clear. Clears all cache if not specified.
   */
  clear(url) {
    if (url) {
      globalCache.delete(url);
    } else {
      globalCache.clear();
    }
  },
  /**
   * Check if a URL is cached and still valid.
   * @param url The URL to check.
   * @returns `true` if cached and valid, `false` otherwise.
   */
  has(url) {
    const cached = globalCache.get(url);
    return !!cached && Date.now() < cached.expiry;
  }
};
function useFetch(urlOrOptions) {
  const {
    cacheTTL = 0,
    onError,
    onFinally,
    onLoading,
    onSuccess,
    retries = 0,
    retryDelay = (attempt) => attempt * 1e3,
    wait = false,
    ...options
  } = useMemoizedValue(
    isURL(urlOrOptions) ? { type: "json", url: urlOrOptions } : urlOrOptions
  );
  const [{ data, error, isCached, retryCount, status, url }, setState] = useSetState({
    data: void 0,
    error: void 0,
    isCached: false,
    retryCount: null,
    status: USE_FETCH_STATUS.IDLE,
    url: options.url
  });
  const isMounted = useIsMounted();
  const previousRetryCount = usePrevious(retryCount);
  if (!isPlainObject(options) || !isURL(url)) {
    throw new Error("Expected an options object or URL");
  }
  const getData = (0, import_react17.useCallback)(
    (eraseData) => {
      setState((s) => ({
        data: eraseData ? void 0 : s.data,
        error: void 0,
        isCached: false,
        status: USE_FETCH_STATUS.LOADING
      }));
      onLoading?.();
      if (cacheTTL && useFetchCache.has(url) && !eraseData) {
        const cached = useFetchCache.get(url);
        if (cached) {
          setState({
            data: cached.data,
            error: void 0,
            isCached: true,
            status: USE_FETCH_STATUS.SUCCESS
          });
          onSuccess?.(cached.data);
          onFinally?.();
          return;
        }
      }
      request({ ...options }).then((response) => {
        if (!isMounted()) {
          return;
        }
        if (cacheTTL) {
          useFetchCache.set(url, response, cacheTTL);
        }
        setState({
          data: response,
          retryCount: null,
          status: USE_FETCH_STATUS.SUCCESS
        });
        onSuccess?.(response);
      }).catch((responseError) => {
        if (!isMounted()) {
          return;
        }
        const counter = retryCount ?? 0;
        if (!retries || counter >= retries) {
          setState({
            error: responseError,
            status: USE_FETCH_STATUS.ERROR
          });
          onError?.(responseError);
        }
        if (retries && counter < retries) {
          setState({
            retryCount: counter + 1
          });
        }
      }).finally(() => {
        if (isMounted()) {
          onFinally?.();
        }
      });
    },
    [
      cacheTTL,
      isMounted,
      onError,
      onFinally,
      onLoading,
      onSuccess,
      options,
      retries,
      retryCount,
      setState,
      url
    ]
  );
  (0, import_react17.useEffect)(() => {
    if (url !== options.url) {
      setState({
        data: void 0,
        error: void 0,
        status: USE_FETCH_STATUS.IDLE,
        url: options.url
      });
    }
  }, [options.url, setState, url]);
  (0, import_react17.useEffect)(() => {
    if (status === USE_FETCH_STATUS.IDLE && !wait) {
      getData();
    }
  }, [getData, status, wait]);
  (0, import_react17.useEffect)(() => {
    if (retries && typeof retryCount === "number" && retryCount !== previousRetryCount) {
      setTimeout(getData, typeof retryDelay === "function" ? retryDelay(retryCount) : retryDelay);
    }
  }, [getData, previousRetryCount, retries, retryCount, retryDelay]);
  const isError = (0, import_react17.useCallback)(() => status === USE_FETCH_STATUS.ERROR, [status]);
  const isFetched = (0, import_react17.useCallback)(
    () => [USE_FETCH_STATUS.SUCCESS, USE_FETCH_STATUS.ERROR].includes(status),
    [status]
  );
  const isLoading = (0, import_react17.useCallback)(() => status === USE_FETCH_STATUS.LOADING, [status]);
  const isPaused = (0, import_react17.useCallback)(() => status === USE_FETCH_STATUS.IDLE && wait, [status, wait]);
  const isSuccess = (0, import_react17.useCallback)(() => status === USE_FETCH_STATUS.SUCCESS, [status]);
  const refetch = (0, import_react17.useCallback)((eraseData = false) => getData(eraseData), [getData]);
  return (0, import_react17.useMemo)(
    () => ({
      data,
      error,
      isCached,
      isError,
      isFetched,
      isLoading,
      isPaused,
      isSuccess,
      refetch,
      retryCount,
      status,
      url
    }),
    [
      data,
      error,
      isCached,
      isError,
      isFetched,
      isLoading,
      isPaused,
      isSuccess,
      refetch,
      retryCount,
      status,
      url
    ]
  );
}

// src/useHasChanged.ts
var import_react18 = require("react");
function useHasChanged(value, callback) {
  const previous = usePrevious(value);
  const hasChanged = typeof previous !== "undefined" && previous !== value;
  (0, import_react18.useEffect)(() => {
    if (hasChanged) {
      callback?.(previous);
    }
  }, [callback, hasChanged, previous]);
  return [hasChanged, previous];
}

// src/useIntersectionObserver.ts
var import_react19 = require("react");
function useIntersectionObserver(target, options) {
  const { delay = 0, once = false, root = null, rootMargin = "0%", threshold = 0 } = options || {};
  const [value, setValue] = (0, import_react19.useState)();
  const disabled = value?.isIntersecting && once;
  const observer = (0, import_react19.useMemo)(() => {
    if (!canUseDOM()) {
      return {};
    }
    return new IntersectionObserver(
      ([entry]) => {
        if (delay) {
          setTimeout(() => setValue(entry), delay);
          return;
        }
        setValue(entry);
      },
      { threshold, root, rootMargin }
    );
  }, [delay, root, rootMargin, threshold]);
  (0, import_react19.useEffect)(() => {
    if (!canUseDOM() || !(observer instanceof IntersectionObserver) || disabled) {
      return () => void 0;
    }
    const element = getElement(target);
    if (!element) {
      return () => void 0;
    }
    observer.observe(element);
    return () => observer.disconnect();
  }, [target, root, rootMargin, disabled, observer]);
  return value;
}

// src/useInterval.ts
var import_react20 = require("react");
function useInterval(callback, delayMs = 100) {
  const savedCallback = (0, import_react20.useRef)(callback);
  (0, import_react20.useEffect)(() => {
    savedCallback.current = callback;
  });
  (0, import_react20.useEffect)(() => {
    if (delayMs !== null) {
      const interval = setInterval(() => savedCallback.current(), delayMs);
      return () => {
        clearInterval(interval);
      };
    }
    return void 0;
  }, [delayMs]);
}

// src/useLatest.ts
var import_react21 = require("react");
function useLatest(value) {
  const ref = (0, import_react21.useRef)(value);
  (0, import_react21.useEffect)(() => {
    ref.current = value;
  });
  return ref;
}

// src/useLifecycleHooks.ts
var import_react22 = require("react");
function useLifecycleHooks(mount, unmount) {
  (0, import_react22.useEffect)(() => {
    mount();
    return unmount;
  }, []);
}

// src/useLocalStorage.ts
var import_react23 = require("react");
function useLocalStorageHook(key, initialValue, options) {
  if (!key) {
    throw new Error('useLocalStorage: "key" is required');
  }
  const deserializer = (0, import_react23.useMemo)(
    () => options?.raw ? (value) => value : options?.deserializer ?? JSON.parse,
    [options]
  );
  const serializer = (0, import_react23.useMemo)(
    () => options?.raw ? String : options?.serializer ?? JSON.stringify,
    [options]
  );
  const initializer = (0, import_react23.useRef)((k) => {
    try {
      const localStorageValue = localStorage.getItem(k);
      if (localStorageValue !== null) {
        return deserializer(localStorageValue);
      }
      initialValue && localStorage.setItem(k, serializer(initialValue));
      return initialValue;
    } catch {
      return initialValue;
    }
  });
  const [state, setState] = (0, import_react23.useState)(() => initializer.current(key));
  (0, import_react23.useLayoutEffect)(() => setState(initializer.current(key)), [key]);
  const set = (0, import_react23.useCallback)(
    (patch) => {
      try {
        const newState = patch instanceof Function ? patch(state) : patch;
        if (typeof newState === "undefined") {
          return;
        }
        let value;
        if (options) {
          if (options.raw) {
            value = typeof newState === "string" ? newState : JSON.stringify(newState);
          } else if (options?.serializer) {
            value = options.serializer(newState);
          } else {
            value = JSON.stringify(newState);
          }
        } else {
          value = JSON.stringify(newState);
        }
        localStorage.setItem(key, value);
        setState(deserializer(value));
      } catch {
      }
    },
    [deserializer, key, options, state]
  );
  const remove = (0, import_react23.useCallback)(() => {
    try {
      localStorage.removeItem(key);
      setState(void 0);
    } catch {
    }
  }, [key, setState]);
  return [state, set, remove];
}
function useLocalStorageSSR(_key, initialValue, _options) {
  return [initialValue, noop, noop];
}
var useLocalStorage = canUseDOM() ? useLocalStorageHook : useLocalStorageSSR;

// src/useLocation.ts
function useLocation() {
  const { hash, host, hostname, href, origin, pathname, port, protocol, search } = window.location;
  const query = search ? search.slice(1).split("&").reduce((acc, pair) => {
    const [key, value] = pair.split("=");
    if (key && value) {
      acc[key] = value;
    }
    return acc;
  }, {}) : {};
  return { hash, host, hostname, href, origin, pathname, port, protocol, query, search };
}

// src/useMediaQuery.ts
var import_react24 = require("react");
function useMediaQuery(input) {
  const getMatches = (query) => {
    if (!canUseDOM()) {
      return false;
    }
    return window.matchMedia(query).matches;
  };
  const [matches, setMatches] = (0, import_react24.useState)(getMatches(input));
  function handleChange() {
    setMatches(getMatches(input));
  }
  (0, import_react24.useEffect)(() => {
    const matchMedia = window.matchMedia(input);
    handleChange();
    try {
      matchMedia.addEventListener("change", handleChange);
    } catch {
      matchMedia.addListener(handleChange);
    }
    return () => {
      try {
        matchMedia.removeEventListener("change", handleChange);
      } catch {
        matchMedia.removeListener(handleChange);
      }
    };
  }, [input]);
  return matches;
}

// src/useMemoDeepCompare.ts
var import_react25 = require("react");
var import_deep_equal4 = __toESM(require("@gilbarbara/deep-equal"));
function useMemoDeepCompare(factory, dependencies) {
  validateDependencies(dependencies, "useMemoDeepCompare", "useMemo");
  const ref = (0, import_react25.useRef)(dependencies);
  if (!(0, import_deep_equal4.default)(dependencies, ref.current)) {
    ref.current = dependencies;
  }
  return (0, import_react25.useMemo)(factory, ref.current);
}

// src/useMergeRefs.tsx
var import_react26 = require("react");
function useMergeRefs(...refs) {
  return (0, import_react26.useCallback)(
    (value) => {
      for (const ref of refs) {
        if (typeof ref === "function") {
          ref(value);
        } else if (ref && typeof ref === "object") {
          ref.current = value;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    refs
  );
}

// src/useMount.ts
var import_react27 = require("react");
function useMount(callback) {
  (0, import_react27.useEffect)(() => {
    callback();
  }, []);
}

// src/useOnce.tsx
var import_react28 = require("react");
function useOnce(callback) {
  const hasBeenCalled = (0, import_react28.useRef)(false);
  if (hasBeenCalled.current) {
    return;
  }
  callback();
  hasBeenCalled.current = true;
}

// src/usePersistentState.ts
function getState(initialState, savedState, shouldOverride, restoreProperties) {
  if (shouldOverride) {
    const initialStateKeys = Object.keys(initialState);
    const savedStateKeys = savedState ? Object.keys(savedState) : [];
    const restorePropertiesKeys = restoreProperties ? Object.keys(restoreProperties) : [];
    if (![...initialStateKeys, ...restorePropertiesKeys].every((k) => savedStateKeys.includes(k))) {
      return { ...initialState, ...restoreProperties };
    }
    return { ...savedState, ...restoreProperties };
  }
  return { ...savedState, ...restoreProperties };
}
function usePersistentState(key, initialState, options) {
  const { overrideDivergentSavedState = false, resetProperties } = options || {};
  const [value, setValue, remove] = useLocalStorage(key, initialState);
  const [state, setState] = useSetState(
    getState(initialState, value, overrideDivergentSavedState, resetProperties)
  );
  useEffectDeepCompare(() => {
    setValue(state);
  }, [setValue, state]);
  return [state, setState, remove];
}

// src/useRenderCount.tsx
var import_react29 = require("react");
function useRenderCount(name) {
  const count = (0, import_react29.useRef)(1);
  (0, import_react29.useEffect)(() => {
    count.current += 1;
  });
  console.log(
    `%c${name || "RenderCount"}: %c${count.current}`,
    "font-size: 14px;  font-weight: bold;",
    "color: #999; font-size: 14px;"
  );
  return count.current;
}

// src/useScript.tsx
var import_react30 = require("react");
function useScript(src, idOrOptions = {}) {
  const options = (0, import_react30.useMemo)(
    () => isString(idOrOptions) ? { id: idOrOptions } : idOrOptions,
    [idOrOptions]
  );
  const script = (0, import_react30.useRef)(null);
  const [state, setState] = (0, import_react30.useState)({
    loaded: false,
    error: false
  });
  const onLoad = (0, import_react30.useCallback)(() => {
    setState({
      loaded: true,
      error: false
    });
  }, []);
  const onError = (0, import_react30.useCallback)(() => {
    if (script.current) {
      script.current.remove();
    }
    setState({
      loaded: false,
      error: true
    });
  }, []);
  (0, import_react30.useEffect)(
    () => {
      if (!canUseDOM() || script.current) {
        return void 0;
      }
      const element = document.createElement("script");
      element.async = options.async ?? true;
      element.defer = options.defer ?? false;
      element.type = options.type || "text/javascript";
      element.id = options.id || src;
      element.src = src;
      script.current = element;
      const { current } = script;
      on(current, "load", onLoad);
      on(current, "error", onError);
      document.body.appendChild(current);
      return () => {
        off(current, "load", onLoad);
        off(current, "error", onError);
      };
    },
    [onError, onLoad, options, src]
    // Only re-run effect if script src changes
  );
  return [state.loaded, state.error];
}

// src/useThrottle.ts
var import_react32 = require("react");

// src/useUnmount.ts
var import_react31 = require("react");
function useUnmount(callback) {
  const callbackRef = useLatest(callback);
  (0, import_react31.useEffect)(() => {
    return () => callbackRef.current();
  }, []);
}

// src/useThrottle.ts
function useThrottle(callback, delayMs = 500, trailing = false) {
  const [now, setNow] = (0, import_react32.useState)(0);
  const callbackRef = (0, import_react32.useRef)(callback);
  const hasPendingCall = (0, import_react32.useRef)(false);
  const timer = (0, import_react32.useRef)(void 0);
  (0, import_react32.useEffect)(() => {
    callbackRef.current = callback;
  }, [callback]);
  (0, import_react32.useEffect)(() => {
    if (!now) {
      return;
    }
    if (!timer.current) {
      callbackRef.current();
      const timerCallback = () => {
        if (hasPendingCall.current) {
          hasPendingCall.current = false;
          if (trailing) {
            callbackRef.current();
          }
          timer.current = void 0;
        } else {
          timer.current = void 0;
        }
      };
      timer.current = window.setTimeout(timerCallback, delayMs);
    } else {
      hasPendingCall.current = true;
    }
  }, [delayMs, now, trailing]);
  useUnmount(() => {
    window.clearTimeout(timer.current);
    timer.current = void 0;
  });
  return () => setNow(Date.now());
}

// src/useThrottleValue.ts
var import_react33 = require("react");
function useThrottleValue(value, delayMs) {
  const [throttledValue, setThrottledValue] = (0, import_react33.useState)(value);
  const hasNextValue = (0, import_react33.useRef)(false);
  const nextValue = (0, import_react33.useRef)(null);
  const timer = (0, import_react33.useRef)(void 0);
  (0, import_react33.useEffect)(() => {
    if (!timer.current) {
      setThrottledValue(value);
      const timeoutCallback = () => {
        if (hasNextValue.current) {
          hasNextValue.current = false;
          setThrottledValue(nextValue.current);
          timer.current = window.setTimeout(timeoutCallback, delayMs);
        } else {
          timer.current = void 0;
        }
      };
      timer.current = window.setTimeout(timeoutCallback, delayMs);
    } else {
      hasNextValue.current = true;
      nextValue.current = value;
    }
  }, [delayMs, value]);
  useUnmount(() => {
    window.clearTimeout(timer.current);
    timer.current = void 0;
  });
  return throttledValue;
}

// src/useTimeout.ts
var import_react34 = require("react");
function useTimeout(callback, delayMs = 0) {
  const status = (0, import_react34.useRef)("pending");
  const timeout = (0, import_react34.useRef)(null);
  const savedCallback = (0, import_react34.useRef)(callback);
  const clear = (0, import_react34.useCallback)(() => {
    status.current = "cancelled";
    timeout.current && clearTimeout(timeout.current);
  }, []);
  const set = (0, import_react34.useCallback)(() => {
    status.current = "pending";
    timeout.current && clearTimeout(timeout.current);
    timeout.current = setTimeout(() => {
      status.current = "completed";
      savedCallback.current();
    }, delayMs);
  }, [delayMs]);
  const getStatus = (0, import_react34.useCallback)(() => status.current, []);
  (0, import_react34.useEffect)(() => {
    savedCallback.current = callback;
  }, [callback]);
  (0, import_react34.useEffect)(() => {
    set();
    return clear;
  }, [set, clear]);
  return { cancel: clear, getStatus, reset: set };
}

// src/useToggle.ts
var import_react35 = require("react");
function useToggle(initialValue = true) {
  const [value, toggle] = (0, import_react35.useReducer)(
    (state, nextValue) => typeof nextValue === "boolean" ? nextValue : !state,
    initialValue
  );
  const toggleOn = (0, import_react35.useCallback)(() => toggle(true), []);
  const toggleOff = (0, import_react35.useCallback)(() => toggle(false), []);
  return [value, { toggle, toggleOn, toggleOff }];
}

// src/useUpdate.ts
var import_react36 = require("react");
var updateReducer = (number) => (number + 1) % 1e6;
function useUpdate() {
  const [, update] = (0, import_react36.useReducer)(updateReducer, 0);
  return update;
}

// src/useWindowSize.ts
var import_react37 = require("react");
function useWindowSize(debounce = 0) {
  const [size, setSize] = (0, import_react37.useState)({
    height: canUseDOM() ? window.innerHeight : 0,
    width: canUseDOM() ? window.innerWidth : 0
  });
  const timeoutRef = (0, import_react37.useRef)(0);
  const handleResize = (0, import_react37.useRef)(() => {
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    }, debounce);
  });
  (0, import_react37.useEffect)(() => {
    if (!canUseDOM()) {
      return () => void 0;
    }
    const getSize = handleResize.current;
    setSize({
      height: window.innerHeight,
      width: window.innerWidth
    });
    on(window, "resize", getSize);
    return () => {
      off(window, "resize", getSize);
    };
  }, []);
  return size;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  USE_FETCH_STATUS,
  useBreakpoint,
  useCallbackDeepCompare,
  useClickOutside,
  useDataChanges,
  useDebounce,
  useEffectDeepCompare,
  useEffectOnce,
  useElementMeasure,
  useFetch,
  useHasChanged,
  useIntersectionObserver,
  useInterval,
  useIsFirstRender,
  useIsMounted,
  useIsomorphicLayoutEffect,
  useLatest,
  useLifecycleHooks,
  useLocalStorage,
  useLocation,
  useMediaQuery,
  useMemoDeepCompare,
  useMemoizedValue,
  useMergeRefs,
  useMount,
  useOnce,
  usePersistentState,
  usePrevious,
  useRenderCount,
  useResizeObserver,
  useScript,
  useSetState,
  useThrottle,
  useThrottleValue,
  useTimeout,
  useToggle,
  useUnmount,
  useUpdate,
  useUpdateEffect,
  useWindowSize
});
//# sourceMappingURL=index.js.map