"use strict";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DialogStore = void 0;
var React = _interopRequireWildcard(require("react"));
var _store = require("@base-ui/utils/store");
var _popups = require("../../utils/popups");
const selectors = {
  ..._popups.popupStoreSelectors,
  modal: (0, _store.createSelector)(state => state.modal),
  nested: (0, _store.createSelector)(state => state.nested),
  nestedOpenDialogCount: (0, _store.createSelector)(state => state.nestedOpenDialogCount),
  nestedOpenDrawerCount: (0, _store.createSelector)(state => state.nestedOpenDrawerCount),
  disablePointerDismissal: (0, _store.createSelector)(state => state.disablePointerDismissal),
  openMethod: (0, _store.createSelector)(state => state.openMethod),
  descriptionElementId: (0, _store.createSelector)(state => state.descriptionElementId),
  titleElementId: (0, _store.createSelector)(state => state.titleElementId),
  viewportElement: (0, _store.createSelector)(state => state.viewportElement),
  role: (0, _store.createSelector)(state => state.role)
};
class DialogStore extends _store.ReactStore {
  constructor(initialState, floatingId, nested = false) {
    const triggerElements = new _popups.PopupTriggerMap();
    const state = createInitialState(initialState);
    state.floatingRootContext = (0, _popups.createPopupFloatingRootContext)(triggerElements, floatingId, nested);
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
    (0, _popups.setPopupOpenState)(updatedState, nextOpen, eventDetails.trigger);
    this.update(updatedState);
  };
  static useStore(externalStore, initialState) {
    /* eslint-disable react-hooks/rules-of-hooks */
    const store = (0, _popups.usePopupStore)(externalStore, (floatingId, nested) => new DialogStore(initialState, floatingId, nested), true).store;
    /* eslint-enable react-hooks/rules-of-hooks */

    return store;
  }
}
exports.DialogStore = DialogStore;
function createInitialState(initialState = {}) {
  return {
    ...(0, _popups.createInitialPopupStoreState)(),
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