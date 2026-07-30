import { FloatingRootContext } from "../../floating-ui-react/index.mjs";
import { FloatingRootStore } from "../../floating-ui-react/components/FloatingRootStore.mjs";
import { TransitionStatus } from "../../internals/useTransitionStatus.mjs";
import { PopupTriggerMap } from "./popupTriggerMap.mjs";
import { HTMLProps } from "../../internals/types.mjs";
/**
 * State common to all popup stores.
 */
export type PopupStoreState<Payload> = {
  /**
   * Whether the popup is open (internal state).
   */
  open: boolean;
  /**
   * Whether the popup is open (external prop).
   */
  readonly openProp: boolean | undefined;
  /**
   * Whether the popup should be mounted in the DOM.
   * This usually follows `open` but can be different during exit transitions.
   */
  mounted: boolean;
  /**
   * The current enter/exit transition status of the popup.
   */
  transitionStatus: TransitionStatus;
  floatingRootContext: FloatingRootContext;
  floatingId: string | undefined;
  /**
   * Number of trigger elements currently registered for this popup.
   */
  triggerCount: number;
  /**
   * Whether to prevent unmounting the popup when closed.
   * Useful for interacting with JS animation libraries that control unmounting themselves.
   */
  preventUnmountingOnClose: boolean;
  /**
   * Optional payload set by the trigger.
   */
  payload: Payload | undefined;
  /**
   * ID of the currently active trigger.
   */
  activeTriggerId: string | null;
  /**
   * The currently active trigger DOM element.
   */
  activeTriggerElement: Element | null;
  /**
   * ID of the trigger (external prop).
   */
  readonly triggerIdProp: string | null | undefined;
  /**
   * The popup DOM element.
   */
  popupElement: HTMLElement | null;
  /**
   * The positioner DOM element.
   */
  positionerElement: HTMLElement | null;
  /**
   * Props to spread onto the active trigger element.
   */
  activeTriggerProps: HTMLProps;
  /**
   * Props to spread onto inactive trigger elements.
   */
  inactiveTriggerProps: HTMLProps;
  /**
   * Props to spread onto the popup element.
   */
  popupProps: HTMLProps;
};
export declare function createInitialPopupStoreState<Payload>(): PopupStoreState<Payload>;
export declare function createPopupFloatingRootContext(triggerElements: PopupTriggerMap, floatingId?: string | undefined, nested?: boolean): FloatingRootStore;
export type PopupStoreContext<ChangeEventDetails> = {
  /**
   * Map of registered trigger elements.
   */
  readonly triggerElements: PopupTriggerMap;
  /**
   * Reference to the popup element.
   */
  readonly popupRef: React.RefObject<HTMLElement | null>;
  /**
   * Callback fired when the open state changes.
   */
  onOpenChange?: ((open: boolean, eventDetails: ChangeEventDetails) => void) | undefined;
  /**
   * Callback fired when the open state change animation completes.
   */
  onOpenChangeComplete: ((open: boolean) => void) | undefined;
};
type S = PopupStoreState<unknown>;
export declare const popupStoreSelectors: {
  open: (state: S) => boolean;
  mounted: (state: S) => boolean;
  transitionStatus: (state: S) => TransitionStatus;
  floatingRootContext: (state: S) => FloatingRootStore;
  triggerCount: (state: S) => number;
  preventUnmountingOnClose: (state: S) => boolean;
  payload: (state: S) => unknown;
  activeTriggerId: (state: S) => string | null;
  activeTriggerElement: (state: S) => Element | null;
  popupId: (state: S) => string | undefined;
  /**
   * Whether the trigger with the given ID was used to open the popup.
   */
  isTriggerActive: (state: S, triggerId: string | undefined) => boolean;
  /**
   * Whether the popup is open and was activated by a trigger with the given ID.
   */
  isOpenedByTrigger: (state: S, triggerId: string | undefined) => boolean;
  /**
   * Whether the popup is mounted and was activated by a trigger with the given ID.
   */
  isMountedByTrigger: (state: S, triggerId: string | undefined) => boolean;
  triggerProps: (state: S, isActive: boolean) => HTMLProps;
  /**
   * Popup id for the trigger that currently owns the open popup.
   */
  triggerPopupId: (state: S, triggerId: string | undefined) => string | undefined;
  popupProps: (state: S) => HTMLProps;
  popupElement: (state: S) => HTMLElement | null;
  positionerElement: (state: S) => HTMLElement | null;
};
export type PopupStoreSelectors = typeof popupStoreSelectors;
export {};