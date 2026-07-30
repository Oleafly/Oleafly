import { Ref, RefCallback } from 'react';

declare function mergeRefsReact19<T>(refs: (Ref<T> | undefined)[]): Ref<T>;

/**
 * Assigns a value to a ref.
 * @param ref The ref to assign the value to.
 * @param value The value to assign to the ref.
 * @returns The ref cleanup callback, if any.
 */
declare function assignRef<T>(ref: Ref<T> | undefined | null, value: T | null): ReturnType<RefCallback<T>>;
/**
 * Merges multiple refs into a single one.
 * @param refs List of refs to merge.
 * @returns Merged ref.
 */
declare const mergeRefs: typeof mergeRefsReact19;
/**
 * Merges multiple refs into a single one and memoizes the result to avoid refs execution on each render.
 * @param refs List of refs to merge.
 * @returns Merged ref.
 */
declare function useMergeRefs<T>(refs: (Ref<T> | undefined)[]): Ref<T>;

export { assignRef, mergeRefs, useMergeRefs };
