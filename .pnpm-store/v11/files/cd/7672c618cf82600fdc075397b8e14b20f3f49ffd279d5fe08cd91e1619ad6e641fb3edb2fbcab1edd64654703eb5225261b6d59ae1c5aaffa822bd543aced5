import * as React from 'react';
import { createSelector, ReactStore } from '@base-ui/utils/store';
import { applyPopupOpenChange, createPopupFloatingRootContext, createInitialPopupStoreState, popupStoreSelectors, PopupTriggerMap, updateInlineRectCoords, usePopupStore } from "../../utils/popups/index.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { CLOSE_DELAY } from "../utils/constants.mjs";
const selectors = {
  ...popupStoreSelectors,
  instantType: createSelector(state => state.instantType),
  hasViewport: createSelector(state => state.hasViewport)
};
export class PreviewCardStore extends ReactStore {
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
      triggerElements,
      closeDelayRef: {
        current: CLOSE_DELAY
      },
      inlineRectCoordsRef: {
        current: undefined
      }
    }, selectors);
  }
  setOpen = (nextOpen, eventDetails) => {
    const {
      inlineRectCoordsRef
    } = this.context;
    applyPopupOpenChange(this, nextOpen, eventDetails, {
      onBeforeDispatch() {
        // Capture the hovered inline-rect coordinates so the card anchors to the
        // exact point on the link that was hovered.
        const event = eventDetails.event;
        if (nextOpen && eventDetails.reason === REASONS.triggerHover && eventDetails.trigger && 'clientX' in event && 'clientY' in event && inlineRectCoordsRef.current?.element !== eventDetails.trigger) {
          updateInlineRectCoords(inlineRectCoordsRef, eventDetails.trigger, event.clientX, event.clientY);
        }
      }
    });
  };
  static useStore(externalStore, initialState) {
    /* eslint-disable react-hooks/rules-of-hooks */
    const store = usePopupStore(externalStore, (floatingId, nested) => new PreviewCardStore(initialState, floatingId, nested)).store;
    /* eslint-enable react-hooks/rules-of-hooks */

    return store;
  }
}
function createInitialState() {
  return {
    ...createInitialPopupStoreState(),
    instantType: undefined,
    hasViewport: false
  };
}