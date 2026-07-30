export declare const isNonNullable: <T>(val: T) => val is NonNullable<T>;
export declare const isReactRenderable: <T>(val: T) => val is Exclude<NonNullable<T>, false | "">;
export declare const isNumber: (val: any) => val is number;
export declare const isString: (val: any) => val is string;
export declare const isPlainObject: <T extends object = object>(val: any) => val is T;
export declare const isFunction: <Value, Args extends unknown[], Result>(val: Value | ((...args: Args) => Result)) => val is (...args: Args) => Result;
export declare const isThenable: <T>(val?: PromiseLike<T>) => val is PromiseLike<T>;
export declare const isPrimitive: (val: any) => boolean;
export declare const isTransitionEvent: (event: Event) => event is TransitionEvent;
