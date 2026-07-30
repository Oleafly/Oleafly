// src/useBreakpoint.tsx
import { useCallback, useEffect, useMemo, useState } from "react";

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
  const sizes = useMemo(
    () => Object.entries(breakpoints).sort(([, aSize], [, bSize]) => bSize - aSize),
    [breakpoints]
  );
  const smallestBreakpoint = sizes[sizes.length - 1];
  if (smallestBreakpoint[1] !== 0) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`The "${smallestBreakpoint[0]}" breakpoint should be 0`);
    }
  }
  const getScreen = useCallback(() => {
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
  const [screen, setScreen] = useState(getScreen);
  useEffect(() => {
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
import { useCallback as useCallback2, useRef } from "react";
import deepEqual from "@gilbarbara/deep-equal";
function useCallbackDeepCompare(callback, dependencies) {
  validateDependencies(dependencies, "useCallbackDeepCompare", "useCallback");
  const ref = useRef(dependencies);
  const callbackRef = useRef(callback);
  if (!deepEqual(dependencies, ref.current)) {
    ref.current = dependencies;
    callbackRef.current = callback;
  }
  return useCallback2(
    (...arguments_) => callbackRef.current(...arguments_),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ref.current
  );
}

// src/useClickOutside.ts
import { useEffect as useEffect3, useRef as useRef4 } from "react";

// src/useMemoizedValue.ts
import { useState as useState2 } from "react";

// src/useEffectDeepCompare.ts
import { useEffect as useEffect2, useRef as useRef2 } from "react";
import deepEqual2 from "@gilbarbara/deep-equal";
function useEffectDeepCompare(effect, dependencies) {
  validateDependencies(dependencies, "useEffectDeepCompare", "useEffect");
  const ref = useRef2(dependencies);
  if (!deepEqual2(dependencies, ref.current)) {
    ref.current = dependencies;
  }
  useEffect2(effect, ref.current);
}

// src/useIsFirstRender.ts
import { useRef as useRef3 } from "react";
function useIsFirstRender() {
  const isFirstRender = useRef3(true);
  if (isFirstRender.current) {
    isFirstRender.current = false;
    return true;
  }
  return isFirstRender.current;
}

// src/useMemoizedValue.ts
function useMemoizedValue(value) {
  const [stableValue, setStableValue] = useState2(() => value);
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
  const ref = useRef4(null);
  const memoizedCallback = useMemoizedValue(callback);
  useEffect3(() => {
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
import { useRef as useRef5, useState as useState3 } from "react";
import deepEqual3 from "@gilbarbara/deep-equal";

// src/useUpdateEffect.ts
import { useEffect as useEffect4 } from "react";
function useUpdateEffect(effect, dependencies) {
  const isFirstRender = useIsFirstRender();
  useEffect4(() => {
    if (!isFirstRender) {
      return effect();
    }
    return void 0;
  }, dependencies);
}

// src/useDataChanges.tsx
function useDataChanges(data, nameOrOptions = {}) {
  const previousData = useRef5(data);
  const [changes, setChanges] = useState3(void 0);
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
      const hasChanged = comparison === "deep" ? !deepEqual3(previousData.current[key], data[key]) : previousData.current[key] !== data[key];
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
import { useCallback as useCallback3, useEffect as useEffect5, useRef as useRef6 } from "react";
function useDebounce(callback, delayMs = 250, dependencies = []) {
  const status = useRef6("pending");
  const timeout = useRef6(null);
  const savedCallback = useRef6(callback);
  const isFirstRender = useIsFirstRender();
  const clear = useCallback3(() => {
    status.current = "cancelled";
    timeout.current && clearTimeout(timeout.current);
  }, []);
  const set = useCallback3(() => {
    status.current = "pending";
    timeout.current && clearTimeout(timeout.current);
    timeout.current = setTimeout(() => {
      status.current = "completed";
      savedCallback.current();
    }, delayMs);
  }, [delayMs]);
  const getStatus = useCallback3(() => status.current, []);
  useEffect5(() => {
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
import { useEffect as useEffect6, useRef as useRef7 } from "react";
function useEffectOnce(effect) {
  const destroyFn = useRef7(null);
  const effectCalled = useRef7(false);
  const effectFn = useRef7(effect);
  useEffect6(() => {
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
import { useState as useState5 } from "react";

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
import { useEffect as useEffect7, useLayoutEffect } from "react";
var useIsomorphicLayoutEffect = canUseDOM() ? useLayoutEffect : useEffect7;

// src/useResizeObserver.ts
import { useMemo as useMemo2, useRef as useRef8, useState as useState4 } from "react";
function useResizeObserver(target, debounce = 0) {
  const [element, setElement] = useState4(getElement(target));
  const [value, setValue] = useState4();
  const timeoutRef = useRef8(null);
  const isFirstCall = useRef8(true);
  const observer = useMemo2(() => {
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
  const [element, setElement] = useState5(getElement(target));
  const [dimensions, setDimensions] = useState5(getElementMeasure(element));
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
import { useCallback as useCallback6, useEffect as useEffect10, useMemo as useMemo3 } from "react";

// src/useIsMounted.ts
import { useCallback as useCallback4, useEffect as useEffect8, useRef as useRef9 } from "react";
function useIsMounted() {
  const isMounted = useRef9(false);
  useEffect8(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);
  return useCallback4(() => isMounted.current, []);
}

// src/usePrevious.ts
import { useEffect as useEffect9, useRef as useRef10 } from "react";
function usePrevious(state) {
  const ref = useRef10(void 0);
  useEffect9(() => {
    ref.current = state;
  });
  return ref.current;
}

// src/useSetState.ts
import { useCallback as useCallback5, useState as useState6 } from "react";
function useSetState(initialState = {}) {
  const [state, set] = useState6(initialState);
  const setState = useCallback5((patch) => {
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
  const getData = useCallback6(
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
  useEffect10(() => {
    if (url !== options.url) {
      setState({
        data: void 0,
        error: void 0,
        status: USE_FETCH_STATUS.IDLE,
        url: options.url
      });
    }
  }, [options.url, setState, url]);
  useEffect10(() => {
    if (status === USE_FETCH_STATUS.IDLE && !wait) {
      getData();
    }
  }, [getData, status, wait]);
  useEffect10(() => {
    if (retries && typeof retryCount === "number" && retryCount !== previousRetryCount) {
      setTimeout(getData, typeof retryDelay === "function" ? retryDelay(retryCount) : retryDelay);
    }
  }, [getData, previousRetryCount, retries, retryCount, retryDelay]);
  const isError = useCallback6(() => status === USE_FETCH_STATUS.ERROR, [status]);
  const isFetched = useCallback6(
    () => [USE_FETCH_STATUS.SUCCESS, USE_FETCH_STATUS.ERROR].includes(status),
    [status]
  );
  const isLoading = useCallback6(() => status === USE_FETCH_STATUS.LOADING, [status]);
  const isPaused = useCallback6(() => status === USE_FETCH_STATUS.IDLE && wait, [status, wait]);
  const isSuccess = useCallback6(() => status === USE_FETCH_STATUS.SUCCESS, [status]);
  const refetch = useCallback6((eraseData = false) => getData(eraseData), [getData]);
  return useMemo3(
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
import { useEffect as useEffect11 } from "react";
function useHasChanged(value, callback) {
  const previous = usePrevious(value);
  const hasChanged = typeof previous !== "undefined" && previous !== value;
  useEffect11(() => {
    if (hasChanged) {
      callback?.(previous);
    }
  }, [callback, hasChanged, previous]);
  return [hasChanged, previous];
}

// src/useIntersectionObserver.ts
import { useEffect as useEffect12, useMemo as useMemo4, useState as useState7 } from "react";
function useIntersectionObserver(target, options) {
  const { delay = 0, once = false, root = null, rootMargin = "0%", threshold = 0 } = options || {};
  const [value, setValue] = useState7();
  const disabled = value?.isIntersecting && once;
  const observer = useMemo4(() => {
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
  useEffect12(() => {
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
import { useEffect as useEffect13, useRef as useRef11 } from "react";
function useInterval(callback, delayMs = 100) {
  const savedCallback = useRef11(callback);
  useEffect13(() => {
    savedCallback.current = callback;
  });
  useEffect13(() => {
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
import { useEffect as useEffect14, useRef as useRef12 } from "react";
function useLatest(value) {
  const ref = useRef12(value);
  useEffect14(() => {
    ref.current = value;
  });
  return ref;
}

// src/useLifecycleHooks.ts
import { useEffect as useEffect15 } from "react";
function useLifecycleHooks(mount, unmount) {
  useEffect15(() => {
    mount();
    return unmount;
  }, []);
}

// src/useLocalStorage.ts
import {
  useCallback as useCallback7,
  useLayoutEffect as useLayoutEffect2,
  useMemo as useMemo5,
  useRef as useRef13,
  useState as useState8
} from "react";
function useLocalStorageHook(key, initialValue, options) {
  if (!key) {
    throw new Error('useLocalStorage: "key" is required');
  }
  const deserializer = useMemo5(
    () => options?.raw ? (value) => value : options?.deserializer ?? JSON.parse,
    [options]
  );
  const serializer = useMemo5(
    () => options?.raw ? String : options?.serializer ?? JSON.stringify,
    [options]
  );
  const initializer = useRef13((k) => {
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
  const [state, setState] = useState8(() => initializer.current(key));
  useLayoutEffect2(() => setState(initializer.current(key)), [key]);
  const set = useCallback7(
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
  const remove = useCallback7(() => {
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
import { useEffect as useEffect16, useState as useState9 } from "react";
function useMediaQuery(input) {
  const getMatches = (query) => {
    if (!canUseDOM()) {
      return false;
    }
    return window.matchMedia(query).matches;
  };
  const [matches, setMatches] = useState9(getMatches(input));
  function handleChange() {
    setMatches(getMatches(input));
  }
  useEffect16(() => {
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
import { useMemo as useMemo6, useRef as useRef14 } from "react";
import deepEqual4 from "@gilbarbara/deep-equal";
function useMemoDeepCompare(factory, dependencies) {
  validateDependencies(dependencies, "useMemoDeepCompare", "useMemo");
  const ref = useRef14(dependencies);
  if (!deepEqual4(dependencies, ref.current)) {
    ref.current = dependencies;
  }
  return useMemo6(factory, ref.current);
}

// src/useMergeRefs.tsx
import { useCallback as useCallback8 } from "react";
function useMergeRefs(...refs) {
  return useCallback8(
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
import { useEffect as useEffect17 } from "react";
function useMount(callback) {
  useEffect17(() => {
    callback();
  }, []);
}

// src/useOnce.tsx
import { useRef as useRef15 } from "react";
function useOnce(callback) {
  const hasBeenCalled = useRef15(false);
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
import { useEffect as useEffect18, useRef as useRef16 } from "react";
function useRenderCount(name) {
  const count = useRef16(1);
  useEffect18(() => {
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
import { useCallback as useCallback9, useEffect as useEffect19, useMemo as useMemo7, useRef as useRef17, useState as useState10 } from "react";
function useScript(src, idOrOptions = {}) {
  const options = useMemo7(
    () => isString(idOrOptions) ? { id: idOrOptions } : idOrOptions,
    [idOrOptions]
  );
  const script = useRef17(null);
  const [state, setState] = useState10({
    loaded: false,
    error: false
  });
  const onLoad = useCallback9(() => {
    setState({
      loaded: true,
      error: false
    });
  }, []);
  const onError = useCallback9(() => {
    if (script.current) {
      script.current.remove();
    }
    setState({
      loaded: false,
      error: true
    });
  }, []);
  useEffect19(
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
import { useEffect as useEffect21, useRef as useRef18, useState as useState11 } from "react";

// src/useUnmount.ts
import { useEffect as useEffect20 } from "react";
function useUnmount(callback) {
  const callbackRef = useLatest(callback);
  useEffect20(() => {
    return () => callbackRef.current();
  }, []);
}

// src/useThrottle.ts
function useThrottle(callback, delayMs = 500, trailing = false) {
  const [now, setNow] = useState11(0);
  const callbackRef = useRef18(callback);
  const hasPendingCall = useRef18(false);
  const timer = useRef18(void 0);
  useEffect21(() => {
    callbackRef.current = callback;
  }, [callback]);
  useEffect21(() => {
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
import { useEffect as useEffect22, useRef as useRef19, useState as useState12 } from "react";
function useThrottleValue(value, delayMs) {
  const [throttledValue, setThrottledValue] = useState12(value);
  const hasNextValue = useRef19(false);
  const nextValue = useRef19(null);
  const timer = useRef19(void 0);
  useEffect22(() => {
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
import { useCallback as useCallback10, useEffect as useEffect23, useRef as useRef20 } from "react";
function useTimeout(callback, delayMs = 0) {
  const status = useRef20("pending");
  const timeout = useRef20(null);
  const savedCallback = useRef20(callback);
  const clear = useCallback10(() => {
    status.current = "cancelled";
    timeout.current && clearTimeout(timeout.current);
  }, []);
  const set = useCallback10(() => {
    status.current = "pending";
    timeout.current && clearTimeout(timeout.current);
    timeout.current = setTimeout(() => {
      status.current = "completed";
      savedCallback.current();
    }, delayMs);
  }, [delayMs]);
  const getStatus = useCallback10(() => status.current, []);
  useEffect23(() => {
    savedCallback.current = callback;
  }, [callback]);
  useEffect23(() => {
    set();
    return clear;
  }, [set, clear]);
  return { cancel: clear, getStatus, reset: set };
}

// src/useToggle.ts
import { useCallback as useCallback11, useReducer } from "react";
function useToggle(initialValue = true) {
  const [value, toggle] = useReducer(
    (state, nextValue) => typeof nextValue === "boolean" ? nextValue : !state,
    initialValue
  );
  const toggleOn = useCallback11(() => toggle(true), []);
  const toggleOff = useCallback11(() => toggle(false), []);
  return [value, { toggle, toggleOn, toggleOff }];
}

// src/useUpdate.ts
import { useReducer as useReducer2 } from "react";
var updateReducer = (number) => (number + 1) % 1e6;
function useUpdate() {
  const [, update] = useReducer2(updateReducer, 0);
  return update;
}

// src/useWindowSize.ts
import { useEffect as useEffect24, useRef as useRef21, useState as useState13 } from "react";
function useWindowSize(debounce = 0) {
  const [size, setSize] = useState13({
    height: canUseDOM() ? window.innerHeight : 0,
    width: canUseDOM() ? window.innerWidth : 0
  });
  const timeoutRef = useRef21(0);
  const handleResize = useRef21(() => {
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    }, debounce);
  });
  useEffect24(() => {
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
export {
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
};
//# sourceMappingURL=index.mjs.map