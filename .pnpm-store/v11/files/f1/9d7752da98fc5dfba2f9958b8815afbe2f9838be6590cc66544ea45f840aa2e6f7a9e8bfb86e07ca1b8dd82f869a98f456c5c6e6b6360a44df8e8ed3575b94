import * as React from 'react';
/**
 * Executes a function once all animations have finished on the provided element.
 * @param elementOrRef - The element to watch for animations.
 * @param waitForStartingStyleRemoved - Whether to wait for [data-starting-style] to be removed before checking for animations.
 * @param treatAbortedAsFinished - Whether to treat aborted animations as finished. If `false`, and there are aborted animations,
 *   the function will check again if any new animations have started and wait for them to finish.
 * @returns A function that takes a callback to execute once all animations have finished, and an optional AbortSignal to abort the callback
 */
export declare function useAnimationsFinished(elementOrRef: React.RefObject<HTMLElement | null> | HTMLElement | null, waitForStartingStyleRemoved?: boolean, treatAbortedAsFinished?: boolean): (fnToExecute: () => void, signal?: AbortSignal | null) => void;