import * as react from 'react';
import { RefObject, DependencyList, EffectCallback, useEffect, Dispatch, SetStateAction, Ref, RefCallback, ActionDispatch, AnyActionArg } from 'react';

type Breakpoints = Record<string, number>;
type UseBreakpointOrientation = 'landscape' | 'portrait';
interface UseBreakpointResult<T extends Breakpoints> {
    /**
     * Returns true if the screen size is between the specified breakpoints and matches the optional orientation.
     */
    between(min: keyof T, max: keyof T, andOrientation?: UseBreakpointOrientation): boolean;
    /**
     * Returns true if the screen size is less than or equal to the specified breakpoint and matches the optional orientation.
     */
    max(breakpoint: keyof T, andOrientation?: UseBreakpointOrientation): boolean;
    /**
     * Returns true if the screen size is greater than or equal to the specified breakpoint and matches the optional orientation.
     */
    min(breakpoint: keyof T, andOrientation?: UseBreakpointOrientation): boolean;
    /**
     * The current screen orientation, either portrait or landscape.
     */
    orientation: UseBreakpointOrientation;
    /**
     * The current active breakpoint, based on the defined breakpoints.
     */
    size: keyof T;
}
declare function useBreakpoint<T extends Breakpoints>(customBreakpoints?: T, initialWidth?: number, initialHeight?: number): UseBreakpointResult<T>;

type FunctionWithArguments = (...arguments_: any[]) => any;
type PlainObject<T = unknown> = Record<PropertyKey, T>;
type Target<T extends Element> = RefObject<T | null> | T | null | string;
type TimerStatus = 'pending' | 'completed' | 'cancelled';

declare function useCallbackDeepCompare<T extends FunctionWithArguments>(callback: T, dependencies: DependencyList): T;

declare function useClickOutside<T extends Element = HTMLElement>(callback: () => void): react.RefObject<T | null>;

type UseDataChangesResult<T> = {
    [K in keyof T]?: {
        from: any;
        to: any;
    };
};
interface UseDataChangesOptions<T> {
    /**
     * Determines whether to use shallow or deep comparison when checking for changes.
     * - `'shallow'` (default) follows React's behavior and only checks for reference changes.
     * - `'deep'` performs a deep comparison to detect nested changes.
     */
    comparison?: 'shallow' | 'deep';
    /**
     * An optional name to include in the console log for easier debugging.
     */
    name?: string;
    /**
     * An array of specific keys to track changes for. If omitted, all keys are tracked.
     */
    only?: Array<keyof T>;
    /**
     * Suppresses console logging when changes are detected.
     *
     * Only needed if `onChange` is **not** used.
     */
    skipLog?: boolean;
}
declare function useDataChanges<T extends PlainObject<any>>(data: T, nameOrOptions?: string | UseDataChangesOptions<T>): UseDataChangesResult<T> | undefined;

type UseDebounceStatus = TimerStatus;
interface UseDebounceResult {
    cancel: () => void;
    getStatus: () => UseDebounceStatus;
}
declare function useDebounce(callback: () => void, delayMs?: number, dependencies?: DependencyList): UseDebounceResult;

declare function useEffectDeepCompare(effect: EffectCallback, dependencies: DependencyList): void;

declare function useEffectOnce(effect: EffectCallback): void;

interface UseElementMeasureResult extends Omit<DOMRectReadOnly, 'toJSON'> {
    absoluteHeight: number;
    absoluteWidth: number;
}
declare function useElementMeasure<T extends Element>(target: Target<T>, debounce?: number): UseElementMeasureResult;

declare const USE_FETCH_STATUS: {
    readonly IDLE: "IDLE";
    readonly LOADING: "LOADING";
    readonly SUCCESS: "SUCCESS";
    readonly ERROR: "ERROR";
};
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
type UseFetchStatus = keyof typeof USE_FETCH_STATUS;
interface UseFetchOptions<TDataType = unknown> {
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
interface UseFetchResult<TDataType> extends UseFetchState<TDataType> {
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
declare function useFetch<TDataType = unknown>(urlOrOptions: string | UseFetchOptions<TDataType>): UseFetchResult<TDataType>;

declare function useHasChanged<T>(value: T, callback?: (previous: T) => void): [hasChanged: boolean, previous: T | undefined];

interface UseIntersectionObserverOptions extends IntersectionObserverInit {
    /**
     * Delay the response update.
     */
    delay?: number;
    /**
     * Trigger the observer only once.
     */
    once?: boolean;
}
declare function useIntersectionObserver<T extends Element>(target: Target<T>, options?: UseIntersectionObserverOptions): IntersectionObserverEntry | undefined;

declare function useInterval(callback: () => void, delayMs?: number | null): void;

declare function useIsFirstRender(): boolean;

declare function useIsMounted(): () => boolean;

declare const useIsomorphicLayoutEffect: typeof useEffect;

declare function useLatest<T>(value: T): react.RefObject<T>;

/**
 * Run the provided functions on mount and unmount.
 */
declare function useLifecycleHooks(mount: () => void, unmount: () => void): void;

type UseLocalStorageOptions<TValue> = {
    raw: true;
} | {
    deserializer: (value: string) => TValue;
    raw: false;
    serializer: (value: TValue) => string;
};
type UseLocalStorageResult<TValue> = [
    value: TValue | undefined,
    setValue: Dispatch<SetStateAction<TValue | undefined>>,
    remove: () => void
];
declare function useLocalStorageHook<TValue>(key: string, initialValue?: TValue, options?: UseLocalStorageOptions<TValue>): UseLocalStorageResult<TValue>;
declare const useLocalStorage: typeof useLocalStorageHook;

interface UseLocationResult {
    hash: string;
    host: string;
    hostname: string;
    href: string;
    origin: string;
    pathname: string;
    port: string;
    protocol: string;
    query: Record<string, string>;
    search: string;
}
declare function useLocation(): UseLocationResult;

declare function useMediaQuery(input: string): boolean;

declare function useMemoDeepCompare<T>(factory: () => T, dependencies: DependencyList): T;

declare function useMemoizedValue<T = any>(value: T): T;

declare function useMergeRefs<T>(...refs: Ref<T>[]): RefCallback<T>;

declare function useMount(callback: () => void): void;

declare function useOnce(callback: () => void): void;

type UsePersistentStateResult<T> = [
    state: T,
    setState: Dispatch<SetStateAction<Partial<T>>>,
    remove: () => void
];
interface UsePersistentStateOptions<TState> {
    /**
     * Check if the saved state keys are different from the initial state and override it if needed.
     * @default false
     */
    overrideDivergentSavedState?: boolean;
    /**
     * Reset properties in the saved state.
     */
    resetProperties?: Partial<TState>;
}
declare function usePersistentState<TState extends object>(key: string, initialState: TState, options?: UsePersistentStateOptions<TState>): UsePersistentStateResult<TState>;

declare function usePrevious<T>(state: T): T | undefined;

declare function useRenderCount(name?: string): number;

declare function useResizeObserver<T extends Element>(target: Target<T>, debounce?: number): ResizeObserverEntry | undefined;

interface UseScriptOptions {
    async?: boolean;
    defer?: boolean;
    id?: string;
    type?: string;
}
type UseScriptResult = [loaded: boolean, error: boolean];
declare function useScript(src: string, idOrOptions?: string | UseScriptOptions): [loaded: boolean, error: boolean];

type Patch<T> = Partial<T> | ((previousState: T) => Partial<T>);
declare function useSetState<T extends object>(initialState?: T): [T, (patch: Patch<T>) => void];

declare function useThrottle<T extends (...arguments_: Array<any>) => void>(callback: T, delayMs?: number, trailing?: boolean): () => void;

declare function useThrottleValue<T>(value: T, delayMs: number): T;

type UseTimeoutStatus = TimerStatus;
interface UseTimeoutResult {
    cancel: () => void;
    getStatus: () => UseTimeoutStatus;
    reset: () => void;
}
declare function useTimeout(callback: () => void, delayMs?: number): UseTimeoutResult;

type UseToggleResult = [
    value: boolean,
    actions: {
        toggle: ActionDispatch<AnyActionArg>;
        toggleOff: () => void;
        toggleOn: () => void;
    }
];
declare function useToggle(initialValue?: boolean): UseToggleResult;

declare function useUnmount(callback: () => void): void;

declare function useUpdate(): () => void;

declare function useUpdateEffect(effect: EffectCallback, dependencies?: DependencyList): void;

interface UseWindowSizeResult {
    height: number;
    width: number;
}
declare function useWindowSize(debounce?: number): UseWindowSizeResult;

export { USE_FETCH_STATUS, type UseBreakpointOrientation, type UseBreakpointResult, type UseDataChangesOptions, type UseDataChangesResult, type UseElementMeasureResult, type UseFetchOptions, type UseFetchResult, type UseFetchStatus, type UseLocalStorageOptions, type UseLocalStorageResult, type UseLocationResult, type UsePersistentStateOptions, type UsePersistentStateResult, type UseScriptResult, type UseTimeoutResult, type UseTimeoutStatus, type UseToggleResult, type UseWindowSizeResult, useBreakpoint, useCallbackDeepCompare, useClickOutside, useDataChanges, useDebounce, useEffectDeepCompare, useEffectOnce, useElementMeasure, useFetch, useHasChanged, useIntersectionObserver, useInterval, useIsFirstRender, useIsMounted, useIsomorphicLayoutEffect, useLatest, useLifecycleHooks, useLocalStorage, useLocation, useMediaQuery, useMemoDeepCompare, useMemoizedValue, useMergeRefs, useMount, useOnce, usePersistentState, usePrevious, useRenderCount, useResizeObserver, useScript, useSetState, useThrottle, useThrottleValue, useTimeout, useToggle, useUnmount, useUpdate, useUpdateEffect, useWindowSize };
