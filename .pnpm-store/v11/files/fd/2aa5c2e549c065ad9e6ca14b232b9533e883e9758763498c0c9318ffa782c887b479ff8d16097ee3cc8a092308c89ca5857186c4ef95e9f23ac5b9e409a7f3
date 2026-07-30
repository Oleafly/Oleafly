import * as React from 'react';
import { type UseRenderElementComponentProps } from "../../internals/useRenderElement.js";
import type { BaseUIComponentProps } from "../../internals/types.js";
type FocusManagerState = null | {
  modal: boolean;
  open: boolean;
  onOpenChange(open: boolean, data?: {
    reason?: string | undefined;
    event?: Event | undefined;
  }): void;
  domReference: Element | null;
  closeOnFocusOut: boolean;
};
export declare const usePortalContext: () => {
  portalNode: HTMLElement | null;
  setFocusManagerState: React.Dispatch<React.SetStateAction<FocusManagerState>>;
  beforeInsideRef: React.RefObject<HTMLSpanElement | null>;
  afterInsideRef: React.RefObject<HTMLSpanElement | null>;
  beforeOutsideRef: React.RefObject<HTMLSpanElement | null>;
  afterOutsideRef: React.RefObject<HTMLSpanElement | null>;
} | null;
export interface UseFloatingPortalNodeProps {
  ref?: React.Ref<HTMLDivElement> | undefined;
  container?: HTMLElement | ShadowRoot | null | React.RefObject<HTMLElement | ShadowRoot | null> | undefined;
  componentProps?: UseRenderElementComponentProps<any> | undefined;
  elementProps?: React.HTMLAttributes<HTMLDivElement> | undefined;
}
export interface UseFloatingPortalNodeResult {
  portalNode: HTMLElement | null;
  portalSubtree: React.ReactPortal | null;
}
export declare function useFloatingPortalNode(props?: UseFloatingPortalNodeProps): UseFloatingPortalNodeResult;
/**
 * Portals the floating element into a given container element — by default,
 * outside of the app root and into the body.
 * This is necessary to ensure the floating element can appear outside any
 * potential parent containers that cause clipping (such as `overflow: hidden`),
 * while retaining its location in the React tree.
 * @see https://floating-ui.com/docs/FloatingPortal
 * @internal
 */
export declare const FloatingPortal: React.ForwardRefExoticComponent<Omit<FloatingPortal.Props<any> & {
  renderGuards?: boolean | undefined;
}, "ref"> & React.RefAttributes<HTMLDivElement>>;
export interface FloatingPortalState {}
export declare namespace FloatingPortal {
  type State = FloatingPortalState;
  interface Props<TState> extends BaseUIComponentProps<'div', TState> {
    /**
     * A parent element to render the portal element into.
     */
    container?: UseFloatingPortalNodeProps['container'] | undefined;
  }
}
export {};