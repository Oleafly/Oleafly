"use strict";
/* eslint-disable react-hooks/rules-of-hooks */
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PopoverStore = void 0;
var React = _interopRequireWildcard(require("react"));
var ReactDOM = _interopRequireWildcard(require("react-dom"));
var _store = require("@base-ui/utils/store");
var _useTimeout = require("@base-ui/utils/useTimeout");
var _reasons = require("../../internals/reasons");
var _popups = require("../../utils/popups");
var _constants = require("../../internals/constants");
function createInitialState() {
  return {
    ...(0, _popups.createInitialPopupStoreState)(),
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
  ..._popups.popupStoreSelectors,
  disabled: (0, _store.createSelector)(state => state.disabled),
  instantType: (0, _store.createSelector)(state => state.instantType),
  openMethod: (0, _store.createSelector)(state => state.openMethod),
  openChangeReason: (0, _store.createSelector)(state => state.openChangeReason),
  modal: (0, _store.createSelector)(state => state.modal),
  focusManagerModal: (0, _store.createSelector)(state => state.focusManagerModal),
  stickIfOpen: (0, _store.createSelector)(state => state.stickIfOpen),
  titleElementId: (0, _store.createSelector)(state => state.titleElementId),
  descriptionElementId: (0, _store.createSelector)(state => state.descriptionElementId),
  openOnHover: (0, _store.createSelector)(state => state.openOnHover),
  closeDelay: (0, _store.createSelector)(state => state.closeDelay),
  hasViewport: (0, _store.createSelector)(state => state.hasViewport)
};
class PopoverStore extends _store.ReactStore {
  constructor(initialState, floatingId, nested = false) {
    const initial = {
      ...createInitialState(),
      ...initialState
    };
    const triggerElements = new _popups.PopupTriggerMap();
    if (initial.open && initialState?.mounted === undefined) {
      initial.mounted = true;
    }
    initial.floatingRootContext = (0, _popups.createPopupFloatingRootContext)(triggerElements, floatingId, nested);
    super(initial, {
      popupRef: /*#__PURE__*/React.createRef(),
      backdropRef: /*#__PURE__*/React.createRef(),
      internalBackdropRef: /*#__PURE__*/React.createRef(),
      onOpenChange: undefined,
      onOpenChangeComplete: undefined,
      triggerFocusTargetRef: /*#__PURE__*/React.createRef(),
      beforeContentFocusGuardRef: /*#__PURE__*/React.createRef(),
      stickIfOpenTimeout: new _useTimeout.Timeout(),
      triggerElements
    }, selectors);
  }
  setOpen = (nextOpen, eventDetails) => {
    const isHover = eventDetails.reason === _reasons.REASONS.triggerHover;
    const isKeyboardClick = eventDetails.reason === _reasons.REASONS.triggerPress && eventDetails.event.detail === 0;
    const isDismissClose = !nextOpen && (eventDetails.reason === _reasons.REASONS.escapeKey || eventDetails.reason == null);
    const shouldPreventUnmountOnClose = (0, _popups.attachPreventUnmountOnClose)(eventDetails);
    const activeTriggerId = this.select('activeTriggerId');
    if (!nextOpen && eventDetails.reason === _reasons.REASONS.closePress && eventDetails.trigger == null && activeTriggerId != null) {
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
      (0, _popups.setPopupOpenState)(updatedState, nextOpen, eventDetails.trigger, shouldPreventUnmountOnClose());
      this.update(updatedState);
    };
    if (isHover) {
      // Only allow "patient" clicks to close the popover if it's open.
      // If they clicked within 500ms of the popover opening, keep it open.
      this.set('stickIfOpen', true);
      this.context.stickIfOpenTimeout.start(_constants.PATIENT_CLICK_THRESHOLD, () => {
        this.set('stickIfOpen', false);
      });
      ReactDOM.flushSync(changeState);
    } else {
      changeState();
    }
    if (isKeyboardClick || isDismissClose) {
      this.set('instantType', isKeyboardClick ? 'click' : 'dismiss');
    } else if (eventDetails.reason === _reasons.REASONS.focusOut) {
      this.set('instantType', 'focus');
    } else {
      this.set('instantType', undefined);
    }
  };
  static useStore(externalStore, initialState) {
    const {
      store,
      internalStore
    } = (0, _popups.usePopupStore)(externalStore, (floatingId, nested) => new PopoverStore(initialState, floatingId, nested));
    React.useEffect(() => internalStore?.disposeEffect(), [internalStore]);
    return store;
  }
  disposeEffect = () => {
    return this.context.stickIfOpenTimeout.disposeEffect();
  };
}
exports.PopoverStore = PopoverStore;