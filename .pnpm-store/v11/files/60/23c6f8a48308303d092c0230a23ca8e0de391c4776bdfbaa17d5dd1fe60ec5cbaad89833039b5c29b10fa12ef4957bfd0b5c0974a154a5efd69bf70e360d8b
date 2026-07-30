"use strict";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PreviewCardStore = void 0;
var React = _interopRequireWildcard(require("react"));
var _store = require("@base-ui/utils/store");
var _popups = require("../../utils/popups");
var _reasons = require("../../internals/reasons");
var _constants = require("../utils/constants");
const selectors = {
  ..._popups.popupStoreSelectors,
  instantType: (0, _store.createSelector)(state => state.instantType),
  hasViewport: (0, _store.createSelector)(state => state.hasViewport)
};
class PreviewCardStore extends _store.ReactStore {
  constructor(initialState, floatingId, nested = false) {
    const triggerElements = new _popups.PopupTriggerMap();
    const state = {
      ...createInitialState(),
      ...initialState
    };
    state.floatingRootContext = (0, _popups.createPopupFloatingRootContext)(triggerElements, floatingId, nested);
    super(state, {
      popupRef: /*#__PURE__*/React.createRef(),
      onOpenChange: undefined,
      onOpenChangeComplete: undefined,
      triggerElements,
      closeDelayRef: {
        current: _constants.CLOSE_DELAY
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
    (0, _popups.applyPopupOpenChange)(this, nextOpen, eventDetails, {
      onBeforeDispatch() {
        // Capture the hovered inline-rect coordinates so the card anchors to the
        // exact point on the link that was hovered.
        const event = eventDetails.event;
        if (nextOpen && eventDetails.reason === _reasons.REASONS.triggerHover && eventDetails.trigger && 'clientX' in event && 'clientY' in event && inlineRectCoordsRef.current?.element !== eventDetails.trigger) {
          (0, _popups.updateInlineRectCoords)(inlineRectCoordsRef, eventDetails.trigger, event.clientX, event.clientY);
        }
      }
    });
  };
  static useStore(externalStore, initialState) {
    /* eslint-disable react-hooks/rules-of-hooks */
    const store = (0, _popups.usePopupStore)(externalStore, (floatingId, nested) => new PreviewCardStore(initialState, floatingId, nested)).store;
    /* eslint-enable react-hooks/rules-of-hooks */

    return store;
  }
}
exports.PreviewCardStore = PreviewCardStore;
function createInitialState() {
  return {
    ...(0, _popups.createInitialPopupStoreState)(),
    instantType: undefined,
    hasViewport: false
  };
}