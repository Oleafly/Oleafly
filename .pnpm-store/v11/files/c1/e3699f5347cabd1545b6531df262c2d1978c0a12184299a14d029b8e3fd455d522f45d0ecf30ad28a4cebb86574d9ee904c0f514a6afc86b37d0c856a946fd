import * as React from 'react';
import { createSelector, ReactStore } from '@base-ui/utils/store';
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { applyPopupOpenChange, createPopupFloatingRootContext, createInitialPopupStoreState, popupStoreSelectors, PopupTriggerMap, usePopupStore } from "../../utils/popups/index.mjs";
const selectors = {
  ...popupStoreSelectors,
  disabled: createSelector(state => state.disabled),
  instantType: createSelector(state => state.instantType),
  isInstantPhase: createSelector(state => state.isInstantPhase),
  trackCursorAxis: createSelector(state => state.trackCursorAxis),
  disableHoverablePopup: createSelector(state => state.disableHoverablePopup),
  lastOpenChangeReason: createSelector(state => state.openChangeReason),
  closeOnClick: createSelector(state => state.closeOnClick),
  closeDelay: createSelector(state => state.closeDelay),
  hasViewport: createSelector(state => state.hasViewport)
};
export class TooltipStore extends ReactStore {
  constructor(initialState, floatingId, nested = false) {
    const triggerElements = new PopupTriggerMap();
    const state = {
      ...createInitialState(),
      ...initialState
    };
    state.floatingRootContext = createPopupFloatingRootContext(triggerElements, floatingId, nested);
    super(state, {
      popupRef: /*#__PURE__*/React.createRef(),
      onOpenChange: undefined,
      onOpenChangeComplete: undefined,
      triggerElements
    }, selectors);
  }
  setOpen = (nextOpen, eventDetails) => {
    applyPopupOpenChange(this, nextOpen, eventDetails, {
      extraState: {
        openChangeReason: eventDetails.reason
      }
    });
  };

  // Used by trigger clicks to clear a delayed hover open without reporting a public open-state change.
  cancelPendingOpen(event) {
    this.state.floatingRootContext.dispatchOpenChange(false, createChangeEventDetails(REASONS.triggerPress, event));
  }
  static useStore(externalStore, initialState) {
    /* eslint-disable react-hooks/rules-of-hooks */
    const store = usePopupStore(externalStore, (floatingId, nested) => new TooltipStore(initialState, floatingId, nested)).store;
    /* eslint-enable react-hooks/rules-of-hooks */

    return store;
  }
}
function createInitialState() {
  return {
    ...createInitialPopupStoreState(),
    disabled: false,
    instantType: undefined,
    isInstantPhase: false,
    trackCursorAxis: 'none',
    disableHoverablePopup: false,
    openChangeReason: null,
    closeOnClick: true,
    closeDelay: 0,
    hasViewport: false
  };
}