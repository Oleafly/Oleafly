import * as React from 'react';
import { ReactStore } from '@base-ui/utils/store';
import type { InteractionType } from '@base-ui/utils/useEnhancedClickHandler';
import { type BaseUIChangeEventDetails } from "../../internals/createBaseUIEventDetails.js";
import { REASONS } from "../../internals/reasons.js";
import { PopupStoreState, PopupStoreContext, popupStoreSelectors, PopupStoreSelectors } from "./store.js";
export declare const FOCUSABLE_POPUP_PROPS: {
  tabIndex: number;
  "data-base-ui-focusable": string;
};
/**
 * Returns the default `initialFocus` resolver for a popup. When opened by touch it focuses the
 * popup element itself to prevent the virtual keyboard from opening (required for Android
 * specifically; iOS handles this automatically). Otherwise it falls back to the default behavior.
 */
export declare function createDefaultInitialFocus(popupRef: React.RefObject<HTMLElement | null>): (interactionType: InteractionType) => true | HTMLElement | null;
type PopupStoreWithOpen<State extends PopupStoreState<unknown>, SetOpenEventDetails extends BaseUIChangeEventDetails<string>> = ReactStore<State, PopupStoreContext<never>, PopupStoreSelectors> & {
  setOpen(open: boolean, eventDetails: SetOpenEventDetails): void;
};
export declare function usePopupStore<State extends PopupStoreState<unknown>, SetOpenEventDetails extends BaseUIChangeEventDetails<string>, Store extends PopupStoreWithOpen<State, SetOpenEventDetails>>(externalStore: Store | undefined, createStore: (floatingId: string | undefined, nested: boolean) => Store, treatPopupAsFloatingElement?: boolean): {
  store: Store;
  internalStore: Store | null;
};
/**
 * Returns a callback ref that registers/unregisters the trigger element in the store.
 *
 * @param store The Store instance where the trigger should be registered.
 */
export declare function useTriggerRegistration<State extends PopupStoreState<unknown>>(id: string | undefined, store: ReactStore<State, PopupStoreContext<never>, PopupStoreSelectors>): (element: Element | null) => void;
export declare function setPopupOpenState(state: Partial<PopupStoreState<unknown>>, open: boolean, trigger: Element | undefined, preventUnmountOnClose?: boolean): void;
export declare function attachPreventUnmountOnClose(eventDetails: {
  preventUnmountOnClose(): void;
}): () => boolean;
/**
 * Runs the shared open-change sequence for a popup store: notifies `onOpenChange`,
 * honors cancellation, dispatches the floating root change, maps the reason to an
 * `instantType`, and commits the state update (synchronously for hover so
 * `getAnimations()` observes it). Stores supply their own differences via
 * `extraState` (e.g. the last change reason) and `onBeforeDispatch` (e.g. updating
 * inline-rect coordinates).
 */
export declare function applyPopupOpenChange<State extends PopupStoreState<unknown> & {
  instantType?: 'delay' | 'dismiss' | 'focus' | undefined;
}, EventDetails extends BaseUIChangeEventDetails<string>>(store: {
  readonly context: Pick<PopupStoreContext<EventDetails>, 'onOpenChange'>;
  readonly state: Pick<PopupStoreState<unknown>, 'floatingRootContext'>;
  update(state: Partial<State>): void;
}, nextOpen: boolean, eventDetails: EventDetails & {
  preventUnmountOnClose(): void;
}, options?: {
  onBeforeDispatch?: (() => void) | undefined;
  extraState?: Partial<State> | undefined;
}): void;
export declare function useInitialOpenSync<State extends PopupStoreState<unknown>>(store: ReactStore<State, PopupStoreContext<never>, PopupStoreSelectors>, openProp: boolean | undefined, defaultOpen: boolean, defaultTriggerId: string | null): void;
/**
 * Sets up trigger data forwarding to the store.
 *
 * @param triggerId Id of the trigger.
 * @param triggerElementRef Ref for the trigger DOM element.
 * @param store The Store instance managing the popup state.
 * @param stateUpdates An object with state updates to apply when the trigger is active.
 */
export declare function useTriggerDataForwarding<State extends PopupStoreState<unknown>>(triggerId: string | undefined, triggerElementRef: React.RefObject<Element | null>, store: ReactStore<State, PopupStoreContext<never>, typeof popupStoreSelectors>, stateUpdates: Omit<Partial<State>, 'activeTriggerId' | 'activeTriggerElement'>): {
  registerTrigger: (element: Element | null) => void;
  isMountedByThisTrigger: boolean;
};
export type PayloadChildRenderFunction<Payload> = (arg: {
  payload: Payload | undefined;
}) => React.ReactNode;
/**
 * Keeps trigger registration state synchronized while the popup is open.
 *
 * When a popup opens without an explicit trigger id and exactly one trigger is registered, that
 * trigger is claimed as the active trigger. When the active trigger id is still registered but its
 * element changed, the active element is refreshed. When the active trigger unregisters, the
 * default path preserves existing ownership so non-closing popup families do not silently claim a
 * different trigger while staying open.
 *
 * If `closeOnActiveTriggerUnmount` is enabled, unregistering the active trigger requests a close
 * after a microtask so a same-tick replacement trigger with the same id can register first.
 *
 * This should be called on the Root part.
 *
 * @param store The Store instance managing the popup state.
 * @param options Options for active trigger unmount behavior.
 */
export declare function useImplicitActiveTrigger<State extends PopupStoreState<unknown>>(store: PopupStoreWithOpen<State, BaseUIChangeEventDetails<typeof REASONS.none>>, options?: {
  closeOnActiveTriggerUnmount?: boolean | undefined;
}): void;
/**
 * Manages the mounted state of the popup.
 * Sets up the transition status listeners and handles unmounting when needed.
 * Updates the `mounted`, `transitionStatus`, and `preventUnmountingOnClose` states in the store.
 *
 * @param open Whether the popup is open.
 * @param store The Store instance managing the popup state.
 * @param onUnmount Optional callback to be called when the popup is unmounted.
 *
 * @returns A function to forcibly unmount the popup.
 */
export declare function useOpenStateTransitions<State extends PopupStoreState<unknown>>(open: boolean, store: ReactStore<State, PopupStoreContext<never>, typeof popupStoreSelectors>, onUnmount?: () => void): {
  forceUnmount: () => void;
  transitionStatus: import("../../internals/useTransitionStatus.js").TransitionStatus;
};
export declare function usePopupInteractionProps<State extends PopupStoreState<unknown>>(store: ReactStore<State, PopupStoreContext<never>, typeof popupStoreSelectors>, statePart: Partial<State> & Pick<State, 'activeTriggerProps' | 'inactiveTriggerProps' | 'popupProps'>): void;
export declare function usePopupRootSync<State extends PopupStoreState<unknown> & {
  openMethod: InteractionType | null;
}>(store: ReactStore<State, PopupStoreContext<never>, typeof popupStoreSelectors>, open: boolean): void;
export {};