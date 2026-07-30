import { ReactStore } from '@base-ui/utils/store';
import { BaseUIChangeEventDetails } from "../../types/index.js";
import { PopupStoreContext, PopupStoreSelectors, PopupStoreState } from "../../utils/popups/index.js";
import { FloatingRootStore } from "../components/FloatingRootStore.js";
export interface UseSyncedFloatingRootContextOptions<State extends PopupStoreState<unknown>, ContextEventDetails extends BaseUIChangeEventDetails<string>, OpenChangeEventDetails extends BaseUIChangeEventDetails<string>> {
  popupStore: ReactStore<State, PopupStoreContext<ContextEventDetails>, PopupStoreSelectors>;
  /**
   * Whether the Popup element is passed to Floating UI as the floating element instead of the default Positioner.
   */
  treatPopupAsFloatingElement?: boolean | undefined;
  floatingRootContext?: FloatingRootStore | undefined;
  floatingId: string | undefined;
  nested: boolean;
  onOpenChange(open: boolean, eventDetails: OpenChangeEventDetails): void;
}
/**
 * Keeps a FloatingRootStore in sync with the provided PopupStore.
 * Uses the provided FloatingRootStore when one exists, otherwise creates one once and updates it on every render.
 */
export declare function useSyncedFloatingRootContext<State extends PopupStoreState<unknown>, ContextEventDetails extends BaseUIChangeEventDetails<string>, OpenChangeEventDetails extends BaseUIChangeEventDetails<string>>(options: UseSyncedFloatingRootContextOptions<State, ContextEventDetails, OpenChangeEventDetails>): FloatingRootStore;