"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createInitialPopupStoreState = createInitialPopupStoreState;
exports.createPopupFloatingRootContext = createPopupFloatingRootContext;
exports.popupStoreSelectors = void 0;
var _store = require("@base-ui/utils/store");
var _empty = require("@base-ui/utils/empty");
var _FloatingRootStore = require("../../floating-ui-react/components/FloatingRootStore");
var _getEmptyRootContext = require("../../floating-ui-react/utils/getEmptyRootContext");
/**
 * State common to all popup stores.
 */

function createInitialPopupStoreState() {
  return {
    open: false,
    openProp: undefined,
    mounted: false,
    transitionStatus: undefined,
    floatingRootContext: (0, _getEmptyRootContext.getEmptyRootContext)(),
    floatingId: undefined,
    triggerCount: 0,
    preventUnmountingOnClose: false,
    payload: undefined,
    activeTriggerId: null,
    activeTriggerElement: null,
    triggerIdProp: undefined,
    popupElement: null,
    positionerElement: null,
    activeTriggerProps: _empty.EMPTY_OBJECT,
    inactiveTriggerProps: _empty.EMPTY_OBJECT,
    popupProps: _empty.EMPTY_OBJECT
  };
}
function createPopupFloatingRootContext(triggerElements, floatingId, nested = false) {
  return new _FloatingRootStore.FloatingRootStore({
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
const activeTriggerIdSelector = (0, _store.createSelector)(state => state.triggerIdProp ?? state.activeTriggerId);
const openSelector = (0, _store.createSelector)(state => state.openProp ?? state.open);
const popupIdSelector = (0, _store.createSelector)(state => {
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
const popupStoreSelectors = exports.popupStoreSelectors = {
  open: openSelector,
  mounted: (0, _store.createSelector)(state => state.mounted),
  transitionStatus: (0, _store.createSelector)(state => state.transitionStatus),
  floatingRootContext: (0, _store.createSelector)(state => state.floatingRootContext),
  triggerCount: (0, _store.createSelector)(state => state.triggerCount),
  preventUnmountingOnClose: (0, _store.createSelector)(state => state.preventUnmountingOnClose),
  payload: (0, _store.createSelector)(state => state.payload),
  activeTriggerId: activeTriggerIdSelector,
  activeTriggerElement: (0, _store.createSelector)(state => state.mounted ? state.activeTriggerElement : null),
  popupId: popupIdSelector,
  /**
   * Whether the trigger with the given ID was used to open the popup.
   */
  isTriggerActive: (0, _store.createSelector)((state, triggerId) => triggerId !== undefined && activeTriggerIdSelector(state) === triggerId),
  /**
   * Whether the popup is open and was activated by a trigger with the given ID.
   */
  isOpenedByTrigger: (0, _store.createSelector)((state, triggerId) => triggerOwnsOpenPopup(state, triggerId)),
  /**
   * Whether the popup is mounted and was activated by a trigger with the given ID.
   */
  isMountedByTrigger: (0, _store.createSelector)((state, triggerId) => triggerId !== undefined && activeTriggerIdSelector(state) === triggerId && state.mounted),
  triggerProps: (0, _store.createSelector)((state, isActive) => isActive ? state.activeTriggerProps : state.inactiveTriggerProps),
  /**
   * Popup id for the trigger that currently owns the open popup.
   */
  triggerPopupId: (0, _store.createSelector)((state, triggerId) => triggerOwnsOpenPopupOrIsOnlyTrigger(state, triggerId) ? popupIdSelector(state) : undefined),
  popupProps: (0, _store.createSelector)(state => state.popupProps),
  popupElement: (0, _store.createSelector)(state => state.popupElement),
  positionerElement: (0, _store.createSelector)(state => state.positionerElement)
};