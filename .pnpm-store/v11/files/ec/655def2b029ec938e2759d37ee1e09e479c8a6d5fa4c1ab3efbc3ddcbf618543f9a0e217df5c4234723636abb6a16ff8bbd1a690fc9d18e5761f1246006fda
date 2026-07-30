/* eslint-disable react-hooks/rules-of-hooks */
'use client';

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { ReactStore, createSelector } from '@base-ui/utils/store';
import { Timeout } from '@base-ui/utils/useTimeout';
import { REASONS } from "../../internals/reasons.mjs";
import { attachPreventUnmountOnClose, createPopupFloatingRootContext, createInitialPopupStoreState, popupStoreSelectors, PopupTriggerMap, setPopupOpenState, usePopupStore } from "../../utils/popups/index.mjs";
import { PATIENT_CLICK_THRESHOLD } from "../../internals/constants.mjs";
function createInitialState() {
  return {
    ...createInitialPopupStoreState(),
    disabled: false,
    modal: false,
    focusManagerModal: false,
    instantType: undefined,
    openMethod: null,
    openChangeReason: null,
    titleElementId: undefined,
    descriptionElementId: undefined,
    stickIfOpen: true,
    nested: false,
    openOnHover: false,
    closeDelay: 0,
    hasViewport: false
  };
}
const selectors = {
  ...popupStoreSelectors,
  disabled: createSelector(state => state.disabled),
  instantType: createSelector(state => state.instantType),
  openMethod: createSelector(state => state.openMethod),
  openChangeReason: createSelector(state => state.openChangeReason),
  modal: createSelector(state => state.modal),
  focusManagerModal: createSelector(state => state.focusManagerModal),
  stickIfOpen: createSelector(state => state.stickIfOpen),
  titleElementId: createSelector(state => state.titleElementId),
  descriptionElementId: createSelector(state => state.descriptionElementId),
  openOnHover: createSelector(state => state.openOnHover),
  closeDelay: createSelector(state => state.closeDelay),
  hasViewport: createSelector(state => state.hasViewport)
};
export class PopoverStore extends ReactStore {
  constructor(initialState, floatingId, nested = false) {
    const initial = {
      ...createInitialState(),
      ...initialState
    };
    const triggerElements = new PopupTriggerMap();
    if (initial.open && initialState?.mounted === undefined) {
      initial.mounted = true;
    }
    initial.floatingRootContext = createPopupFloatingRootContext(triggerElements, floatingId, nested);
    super(initial, {
      popupRef: /*#__PURE__*/React.createRef(),
      backdropRef: /*#__PURE__*/React.createRef(),
      internalBackdropRef: /*#__PURE__*/React.createRef(),
      onOpenChange: undefined,
      onOpenChangeComplete: undefined,
      triggerFocusTargetRef: /*#__PURE__*/React.createRef(),
      beforeContentFocusGuardRef: /*#__PURE__*/React.createRef(),
      stickIfOpenTimeout: new Timeout(),
      triggerElements
    }, selectors);
  }
  setOpen = (nextOpen, eventDetails) => {
    const isHover = eventDetails.reason === REASONS.triggerHover;
    const isKeyboardClick = eventDetails.reason === REASONS.triggerPress && eventDetails.event.detail === 0;
    const isDismissClose = !nextOpen && (eventDetails.reason === REASONS.escapeKey || eventDetails.reason == null);
    const shouldPreventUnmountOnClose = attachPreventUnmountOnClose(eventDetails);
    const activeTriggerId = this.select('activeTriggerId');
    if (!nextOpen && eventDetails.reason === REASONS.closePress && eventDetails.trigger == null && activeTriggerId != null) {
      eventDetails.trigger = this.context.triggerElements.getById(activeTriggerId) ?? this.select('activeTriggerElement') ?? undefined;
    }
    this.context.onOpenChange?.(nextOpen, eventDetails);
    if (eventDetails.isCanceled) {
      return;
    }
    this.state.floatingRootContext.dispatchOpenChange(nextOpen, eventDetails);
    const changeState = () => {
      const updatedState = {
        open: nextOpen,
        openChangeReason: eventDetails.reason
      };
      setPopupOpenState(updatedState, nextOpen, eventDetails.trigger, shouldPreventUnmountOnClose());
      this.update(updatedState);
    };
    if (isHover) {
      // Only allow "patient" clicks to close the popover if it's open.
      // If they clicked within 500ms of the popover opening, keep it open.
      this.set('stickIfOpen', true);
      this.context.stickIfOpenTimeout.start(PATIENT_CLICK_THRESHOLD, () => {
        this.set('stickIfOpen', false);
      });
      ReactDOM.flushSync(changeState);
    } else {
      changeState();
    }
    if (isKeyboardClick || isDismissClose) {
      this.set('instantType', isKeyboardClick ? 'click' : 'dismiss');
    } else if (eventDetails.reason === REASONS.focusOut) {
      this.set('instantType', 'focus');
    } else {
      this.set('instantType', undefined);
    }
  };
  static useStore(externalStore, initialState) {
    const {
      store,
      internalStore
    } = usePopupStore(externalStore, (floatingId, nested) => new PopoverStore(initialState, floatingId, nested));
    React.useEffect(() => internalStore?.disposeEffect(), [internalStore]);
    return store;
  }
  disposeEffect = () => {
    return this.context.stickIfOpenTimeout.disposeEffect();
  };
}