import * as React from 'react';
import type { FloatingRootContext, Delay, FloatingContext } from "../types.js";
export interface FloatingDelayGroupProps {
  children?: React.ReactNode;
  /**
   * The delay to use for the group when it's not in the instant phase.
   */
  delay: Delay;
  /**
   * An optional explicit timeout to use for the group, which represents when
   * grouping logic will no longer be active after the close delay completes.
   * This is useful if you want grouping to “last” longer than the close delay,
   * for example if there is no close delay at all.
   */
  timeoutMs?: number | undefined;
}
/**
 * Experimental next version of `FloatingDelayGroup` to become the default
 * in the future. This component is not yet stable.
 * Provides context for a group of floating elements that should share a
 * `delay`. Unlike `FloatingDelayGroup`, `useDelayGroup` with this
 * component does not cause a re-render of unrelated consumers of the
 * context when the delay changes.
 * @see https://floating-ui.com/docs/FloatingDelayGroup
 * @internal
 */
export declare function FloatingDelayGroup(props: FloatingDelayGroupProps): React.JSX.Element;
interface UseDelayGroupOptions {
  /**
   * Whether the trigger this hook is used in has opened the tooltip.
   */
  open: boolean;
}
interface UseDelayGroupReturn {
  /**
   * The delay reference object.
   */
  delayRef: React.RefObject<Delay>;
  /**
   * Whether animations should be removed.
   */
  isInstantPhase: boolean;
  /**
   * Whether a `<FloatingDelayGroup>` provider is present.
   */
  hasProvider: boolean;
}
/**
 * Enables grouping when called inside a component that's a child of a
 * `FloatingDelayGroup`.
 * @see https://floating-ui.com/docs/FloatingDelayGroup
 * @internal
 */
export declare function useDelayGroup(context: FloatingRootContext | FloatingContext, options?: UseDelayGroupOptions): UseDelayGroupReturn;
export {};