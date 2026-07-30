import { createSelector } from '@base-ui/utils/store';
import { EMPTY_OBJECT } from '@base-ui/utils/empty';
import { FloatingRootStore } from "../../floating-ui-react/components/FloatingRootStore.mjs";
import { getEmptyRootContext } from "../../floating-ui-react/utils/getEmptyRootContext.mjs";

/**
 * State common to all popup stores.
 */

export function createInitialPopupStoreState() {
  return {
    open: false,
    openProp: undefined,
    mounted: false,
    transitionStatus: undefined,
    floatingRootContext: getEmptyRootContext(),
    floatingId: undefined,
    triggerCount: 0,
    preventUnmountingOnClose: false,
    payload: undefined,
    activeTriggerId: null,
    activeTriggerElement: null,
    triggerIdProp: undefined,
    popupElement: null,
    positionerElement: null,
    activeTriggerProps: EMPTY_OBJECT,
    inactiveTriggerProps: EMPTY_OBJECT,
    popupProps: EMPTY_OBJECT
  };
}
export function createPopupFloatingRootContext(triggerElements, floatingId, nested = false) {
  return new FloatingRootStore({
    open: false,
    transitionStatus: undefined,
    floatingElement: null,
    referenceElement: null,
    triggerElements,
    floatingId,
    syncOnly: true,
    nested,
    onOpenChange: undefined
  });
}
const activeTriggerIdSelector = createSelector(state => state.triggerIdProp ?? state.activeTriggerId);
const openSelector = createSelector(state => state.openProp ?? state.open);
const popupIdSelector = createSelector(state => {
  const popupId = state.popupElement?.id ?? state.floatingId;
  return popupId || undefined;
});
function triggerOwnsOpenPopup(state, triggerId) {
  return triggerId !== undefined && openSelector(state) && activeTriggerIdSelector(state) === triggerId;
}
function triggerOwnsOpenPopupOrIsOnlyTrigger(state, triggerId) {
  if (triggerOwnsOpenPopup(state, triggerId)) {
    return true;
  }
  return triggerId !== undefined && openSelector(state) && activeTriggerIdSelector(state) == null && state.triggerCount === 1;
}
export const popupStoreSelectors = {
  open: openSelector,
  mounted: createSelector(state => state.mounted),
  transitionStatus: createSelector(state => state.transitionStatus),
  floatingRootContext: createSelector(state => state.floatingRootContext),
  triggerCount: createSelector(state => state.triggerCount),
  preventUnmountingOnClose: createSelector(state => state.preventUnmountingOnClose),
  payload: createSelector(state => state.payload),
  activeTriggerId: activeTriggerIdSelector,
  activeTriggerElement: createSelector(state => state.mounted ? state.activeTriggerElement : null),
  popupId: popupIdSelector,
  /**
   * Whether the trigger with the given ID was used to open the popup.
   */
  isTriggerActive: createSelector((state, triggerId) => triggerId !== undefined && activeTriggerIdSelector(state) === triggerId),
  /**
   * Whether the popup is open and was activated by a trigger with the given ID.
   */
  isOpenedByTrigger: createSelector((state, triggerId) => triggerOwnsOpenPopup(state, triggerId)),
  /**
   * Whether the popup is mounted and was activated by a trigger with the given ID.
   */
  isMountedByTrigger: createSelector((state, triggerId) => triggerId !== undefined && activeTriggerIdSelector(state) === triggerId && state.mounted),
  triggerProps: createSelector((state, isActive) => isActive ? state.activeTriggerProps : state.inactiveTriggerProps),
  /**
   * Popup id for the trigger that currently owns the open popup.
   */
  triggerPopupId: createSelector((state, triggerId) => triggerOwnsOpenPopupOrIsOnlyTrigger(state, triggerId) ? popupIdSelector(state) : undefined),
  popupProps: createSelector(state => state.popupProps),
  popupElement: createSelector(state => state.popupElement),
  positionerElement: createSelector(state => state.positionerElement)
};