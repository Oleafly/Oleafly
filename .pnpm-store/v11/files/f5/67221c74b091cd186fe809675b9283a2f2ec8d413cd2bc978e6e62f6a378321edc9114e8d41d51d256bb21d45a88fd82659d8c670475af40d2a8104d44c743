import * as React from 'react';
import { createSelector, ReactStore } from '@base-ui/utils/store';
import { createPopupFloatingRootContext, createInitialPopupStoreState, popupStoreSelectors, PopupTriggerMap, setPopupOpenState, usePopupStore } from "../../utils/popups/index.mjs";
const selectors = {
  ...popupStoreSelectors,
  modal: createSelector(state => state.modal),
  nested: createSelector(state => state.nested),
  nestedOpenDialogCount: createSelector(state => state.nestedOpenDialogCount),
  nestedOpenDrawerCount: createSelector(state => state.nestedOpenDrawerCount),
  disablePointerDismissal: createSelector(state => state.disablePointerDismissal),
  openMethod: createSelector(state => state.openMethod),
  descriptionElementId: createSelector(state => state.descriptionElementId),
  titleElementId: createSelector(state => state.titleElementId),
  viewportElement: createSelector(state => state.viewportElement),
  role: createSelector(state => state.role)
};
export class DialogStore extends ReactStore {
  constructor(initialState, floatingId, nested = false) {
    const triggerElements = new PopupTriggerMap();
    const state = createInitialState(initialState);
    state.floatingRootContext = createPopupFloatingRootContext(triggerElements, floatingId, nested);
    super(state, {
      popupRef: /*#__PURE__*/React.createRef(),
      backdropRef: /*#__PURE__*/React.createRef(),
      internalBackdropRef: /*#__PURE__*/React.createRef(),
      outsidePressEnabledRef: {
        current: true
      },
      triggerElements,
      onOpenChange: undefined,
      onOpenChangeComplete: undefined
    }, selectors);
  }
  setOpen = (nextOpen, eventDetails) => {
    eventDetails.preventUnmountOnClose = () => {
      this.set('preventUnmountingOnClose', true);
    };
    if (!nextOpen && eventDetails.trigger == null && this.state.activeTriggerId != null) {
      // When closing the dialog, pass the old trigger to the onOpenChange event
      // so it's not reset too early (potentially causing focus issues in controlled scenarios).
      eventDetails.trigger = this.state.activeTriggerElement ?? undefined;
    }
    this.context.onOpenChange?.(nextOpen, eventDetails);
    if (eventDetails.isCanceled) {
      return;
    }
    this.state.floatingRootContext.dispatchOpenChange(nextOpen, eventDetails);
    const updatedState = {
      open: nextOpen
    };
    setPopupOpenState(updatedState, nextOpen, eventDetails.trigger);
    this.update(updatedState);
  };
  static useStore(externalStore, initialState) {
    /* eslint-disable react-hooks/rules-of-hooks */
    const store = usePopupStore(externalStore, (floatingId, nested) => new DialogStore(initialState, floatingId, nested), true).store;
    /* eslint-enable react-hooks/rules-of-hooks */

    return store;
  }
}
function createInitialState(initialState = {}) {
  return {
    ...createInitialPopupStoreState(),
    modal: true,
    disablePointerDismissal: false,
    popupElement: null,
    viewportElement: null,
    descriptionElementId: undefined,
    titleElementId: undefined,
    openMethod: null,
    nested: false,
    nestedOpenDialogCount: 0,
    nestedOpenDrawerCount: 0,
    role: 'dialog',
    ...initialState
  };
}