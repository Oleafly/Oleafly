import { useCallback, useEffect, useMemo } from 'react';

import { PlainObject } from './types';
import { useIsMounted } from './useIsMounted';
import { useMemoizedValue } from './useMemoizedValue';
import { usePrevious } from './usePrevious';
import { useSetState } from './useSetState';
import { isPlainObject, isURL } from './utils';

export const USE_FETCH_STATUS = {
  IDLE: 'IDLE',
  LOADING: 'LOADING',
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
} as const;

interface UseFetchError extends Error {
  response?: unknown;
  status?: number;
}

interface UseFetchState<TDataType> {
  data?: TDataType;
  error?: UseFetchError;
  isCached: boolean;
  retryCount: number | null;
  status: UseFetchStatus;
  url: string;
}

export type UseFetchStatus = keyof typeof USE_FETCH_STATUS;

export interface UseFetchOptions<TDataType = unknown> {
  body?: BodyInit | Record<string, any>;
  /**
   * Time to cache the request if provided.
   * When the cache is expired, the request will be triggered again.
   */
  cacheTTL?: number;
  headers?: PlainObject<string>;
  /**
   * HTTP method.
   * @default: 'GET'
   */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS' | 'CONNECT' | 'TRACE';
  /**
   * Request mode.
   * @default: 'cors'
   */
  mode?: 'cors' | 'navigate' | 'no-cors' | 'same-origin';
  /** Callback fired when an error occurs */
  onError?: (error: UseFetchError) => void;
  /** Callback fired when the request completes (success or error) */
  onFinally?: () => void;
  /** Callback fired when the loading state changes */
  onLoading?: () => void;
  /** Callback fired when data is successfully fetched */
  onSuccess?: (data: TDataType) => void;
  /**
   * Number of retries.
   */
  retries?: number;
  /**
   * Time to wait before retrying.
   * A function like attempt => Math.min(attempt > 1 ? 2 ** attempt * 1000 : 1000, 30 * 1000) applies exponential backoff.
   * A function like attempt => attempt * 1000 applies linear backoff.
   * @default: attempt => attempt * 1000
   */
  retryDelay?: number | ((attempt: number) => number);
  /**
   * Request type.
   * @default: 'json'
   */
  type?: 'json' | 'urlencoded';
  url: string;
  /**
   * Wait for the user to trigger the request.
   * @default: false
   */
  wait?: boolean;
}

export interface UseFetchResult<TDataType> extends UseFetchState<TDataType> {
  /**
   * Whether the response is cached.
   */
  isCached: boolean;
  isError: () => boolean;
  isFetched: () => boolean;
  isLoading: () => boolean;
  isPaused: () => boolean;
  isSuccess: () => boolean;
  refetch: (eraseData?: boolean) => void;
}

const globalCache = new Map<string, { data: any; expiry: number }>();

async function request(options: UseFetchOptions): Promise<any> {
  const {
    body = undefined,
    headers = {},
    method = 'GET',
    mode = 'cors',
    type = 'json',
    url = '',
  } = options;

  const contentTypes = {
    json: 'application/json',
    urlencoded: 'application/x-www-form-urlencoded',
  };

  const params: RequestInit = {
    body: undefined,
    cache: 'no-store' as const,
    headers: {
      Accept: 'application/json',
      'Content-Type': contentTypes[type],
      ...headers,
    },
    method,
    mode,
    credentials: undefined,
  };

  if (body) {
    params.body = (
      isPlainObject(body) && type === 'json' ? JSON.stringify(body) : body
    ) as BodyInit;
  }

  try {
    const response = await fetch(url, params);
    let content: unknown;

    try {
      content = await response.json();
    } catch {
      content = await response.text();
    }

    if (response.status > 299) {
      const error = new Error(response.statusText) as UseFetchError;

      error.status = response.status;
      error.response = content;

      throw error;
    }

    return content;
  } catch (error) {
    // Handle hard failures (network issues, CORS errors, fetch rejection)
    const fetchError = new Error('Network request failed') as UseFetchError;

    fetchError.status = 0; // Status 0 indicates a network error
    fetchError.response = error instanceof Error ? error.message : error;
    throw fetchError;
  }
}

export const useFetchCache = {
  /**
   * Retrieve data from the cache.
   * @param url The URL to retrieve data for.
   * @returns Cached data or `undefined` if not found or expired.
   */
  get(url: string) {
    const cached = globalCache.get(url);

    if (cached && Date.now() < cached.expiry) {
      return cached;
    }

    globalCache.delete(url); // Remove expired entry

    return undefined;
  },

  /**
   * Set data in the cache.
   * @param url The URL to cache data for.
   * @param data The data to cache.
   * @param ttl Time-to-live in milliseconds.
   */
  set(url: string, data: any, ttl: number) {
    globalCache.set(url, { data, expiry: Date.now() + ttl });
  },

  /**
   * Clear the cache.
   * @param url Optional URL to clear. Clears all cache if not specified.
   */
  clear(url?: string) {
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
  has(url: string) {
    const cached = globalCache.get(url);

    return !!cached && Date.now() < cached.expiry;
  },
};

export function useFetch<TDataType = unknown>(
  urlOrOptions: string | UseFetchOptions<TDataType>,
): UseFetchResult<TDataType> {
  const {
    cacheTTL = 0,
    onError,
    onFinally,
    onLoading,
    onSuccess,
    retries = 0,
    retryDelay = (attempt: number) => attempt * 1000,
    wait = false,
    ...options
  } = useMemoizedValue(
    (isURL(urlOrOptions)
      ? ({ type: 'json', url: urlOrOptions } as const)
      : urlOrOptions) as UseFetchOptions,
  );
  const [{ data, error, isCached, retryCount, status, url }, setState] = useSetState<
    UseFetchState<TDataType>
  >({
    data: undefined,
    error: undefined,
    isCached: false,
    retryCount: null,
    status: USE_FETCH_STATUS.IDLE,
    url: options.url,
  });
  const isMounted = useIsMounted();
  const previousRetryCount = usePrevious(retryCount);

  if (!isPlainObject(options) || !isURL(url)) {
    throw new Error('Expected an options object or URL');
  }

  const getData = useCallback(
    (eraseData?: boolean) => {
      setState(s => ({
        data: eraseData ? undefined : s.data,
        error: undefined,
        isCached: false,
        status: USE_FETCH_STATUS.LOADING,
      }));

      onLoading?.();

      // Check cache
      if (cacheTTL && useFetchCache.has(url) && !eraseData) {
        const cached = useFetchCache.get(url);

        if (cached) {
          setState({
            data: cached.data,
            error: undefined,
            isCached: true,
            status: USE_FETCH_STATUS.SUCCESS,
          });

          onSuccess?.(cached.data);
          onFinally?.();

          return;
        }
      }

      // eslint-disable-next-line promise/catch-or-return
      request({ ...options })
        .then(response => {
          if (!isMounted()) {
            return;
          }

          if (cacheTTL) {
            useFetchCache.set(url, response, cacheTTL);
          }

          setState({
            data: response,
            retryCount: null,
            status: USE_FETCH_STATUS.SUCCESS,
          });
          onSuccess?.(response);
        })
        .catch(responseError => {
          if (!isMounted()) {
            return;
          }

          const counter = retryCount ?? 0;

          if (!retries || counter >= retries) {
            setState({
              error: responseError,
              status: USE_FETCH_STATUS.ERROR,
            });
            onError?.(responseError);
          }

          if (retries && counter < retries) {
            setState({
              retryCount: counter + 1,
            });
          }
        })
        .finally(() => {
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
      url,
    ],
  );

  useEffect(() => {
    if (url !== options.url) {
      setState({
        data: undefined,
        error: undefined,
        status: USE_FETCH_STATUS.IDLE,
        url: options.url,
      });
    }
  }, [options.url, setState, url]);

  useEffect(() => {
    if (status === USE_FETCH_STATUS.IDLE && !wait) {
      getData();
    }
  }, [getData, status, wait]);

  useEffect(() => {
    if (retries && typeof retryCount === 'number' && retryCount !== previousRetryCount) {
      setTimeout(getData, typeof retryDelay === 'function' ? retryDelay(retryCount) : retryDelay);
    }
  }, [getData, previousRetryCount, retries, retryCount, retryDelay]);

  const isError = useCallback(() => status === USE_FETCH_STATUS.ERROR, [status]);
  const isFetched = useCallback(
    () => ([USE_FETCH_STATUS.SUCCESS, USE_FETCH_STATUS.ERROR] as UseFetchStatus[]).includes(status),
    [status],
  );
  const isLoading = useCallback(() => status === USE_FETCH_STATUS.LOADING, [status]);
  const isPaused = useCallback(() => status === USE_FETCH_STATUS.IDLE && wait, [status, wait]);
  const isSuccess = useCallback(() => status === USE_FETCH_STATUS.SUCCESS, [status]);
  const refetch = useCallback((eraseData = false) => getData(eraseData), [getData]);

  return useMemo(
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
      url,
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
      url,
    ],
  );
}
