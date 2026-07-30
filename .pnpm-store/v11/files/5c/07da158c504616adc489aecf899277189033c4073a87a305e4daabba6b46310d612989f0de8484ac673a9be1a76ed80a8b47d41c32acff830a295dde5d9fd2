import * as React from 'react';
import { HTMLProps } from "../../internals/types.js";
import type { FloatingTreeStore } from "../components/FloatingTreeStore.js";
import type { Delay, FloatingContext, FloatingRootContext } from "../types.js";
import type { HandleClose, HandleCloseContextBase } from "./useHoverShared.js";
export interface UseHoverReferenceInteractionProps {
  enabled?: boolean | undefined;
  handleClose?: HandleClose | null | undefined;
  restMs?: number | (() => number) | undefined;
  delay?: Delay | (() => Delay) | undefined;
  move?: boolean | undefined;
  mouseOnly?: boolean | undefined;
  externalTree?: FloatingTreeStore | undefined;
  /**
   * Whether the hook controls the active trigger. When false, the props are
   * returned under the `trigger` key so they can be applied to inactive
   * triggers via `getTriggerProps`.
   * @default true
   */
  isActiveTrigger?: boolean | undefined;
  triggerElementRef?: Readonly<React.RefObject<Element | null>> | undefined;
  getHandleCloseContext?: (() => HandleCloseContextBase | null) | undefined;
  isClosing?: (() => boolean) | undefined;
  /**
   * Called before each hover-driven open attempt (immediate, delayed, and rest-ms
   * paths). Return `false` to veto; any other return value permits the open.
   */
  shouldOpen?: (() => boolean) | undefined;
}
/**
 * Provides hover interactions that should be attached to reference or trigger
 * elements.
 */
export declare function useHoverReferenceInteraction(context: FloatingRootContext | FloatingContext, props?: UseHoverReferenceInteractionProps): HTMLProps | undefined;