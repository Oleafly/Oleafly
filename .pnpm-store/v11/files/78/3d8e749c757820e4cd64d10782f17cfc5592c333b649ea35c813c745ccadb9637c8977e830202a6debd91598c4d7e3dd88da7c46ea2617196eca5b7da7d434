"use strict";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MenuStore = void 0;
var React = _interopRequireWildcard(require("react"));
var _store = require("@base-ui/utils/store");
var _empty = require("@base-ui/utils/empty");
var _useRefWithInit = require("@base-ui/utils/useRefWithInit");
var _FloatingTreeStore = require("../../floating-ui-react/components/FloatingTreeStore");
var _popups = require("../../utils/popups");
const selectors = {
  ..._popups.popupStoreSelectors,
  disabled: (0, _store.createSelector)(state => state.parent.type === 'menubar' ? state.parent.context.disabled || state.disabled : state.disabled),
  modal: (0, _store.createSelector)(state => (state.parent.type === undefined || state.parent.type === 'context-menu') && (state.modal ?? true)),
  openMethod: (0, _store.createSelector)(state => state.openMethod),
  allowMouseEnter: (0, _store.createSelector)(state => state.allowMouseEnter),
  highlightItemOnHover: (0, _store.createSelector)(state => state.highlightItemOnHover),
  stickIfOpen: (0, _store.createSelector)(state => state.stickIfOpen),
  parent: (0, _store.createSelector)(state => state.parent),
  rootId: (0, _store.createSelector)(state => {
    if (state.parent.type === 'menu') {
      return state.parent.store.select('rootId');
    }
    return state.parent.type !== undefined ? state.parent.context.rootId : state.rootId;
  }),
  activeIndex: (0, _store.createSelector)(state => state.activeIndex),
  isActive: (0, _store.createSelector)((state, itemIndex) => state.activeIndex === itemIndex),
  hoverEnabled: (0, _store.createSelector)(state => state.hoverEnabled),
  instantType: (0, _store.createSelector)(state => state.instantType),
  lastOpenChangeReason: (0, _store.createSelector)(state => state.openChangeReason),
  floatingTreeRoot: (0, _store.createSelector)(state => {
    if (state.parent.type === 'menu') {
      return state.parent.store.select('floatingTreeRoot');
    }
    return state.floatingTreeRoot;
  }),
  floatingNodeId: (0, _store.createSelector)(state => state.floatingNodeId),
  floatingParentNodeId: (0, _store.createSelector)(state => state.floatingParentNodeId),
  itemProps: (0, _store.createSelector)(state => state.itemProps),
  closeDelay: (0, _store.createSelector)(state => state.closeDelay),
  hasViewport: (0, _store.createSelector)(state => state.hasViewport),
  keyboardEventRelay: (0, _store.createSelector)(state => {
    if (state.keyboardEventRelay) {
      return state.keyboardEventRelay;
    }
    if (state.parent.type === 'menu') {
      return state.parent.store.select('keyboardEventRelay');
    }
    return undefined;
  })
};
class MenuStore extends _store.ReactStore {
  constructor(initialState) {
    super({
      ...createInitialState(),
      ...initialState
    }, {
      positionerRef: /*#__PURE__*/React.createRef(),
      popupRef: /*#__PURE__*/React.createRef(),
      typingRef: {
        current: false
      },
      itemDomElements: {
        current: []
      },
      itemLabels: {
        current: []
      },
      allowMouseUpTriggerRef: {
        current: false
      },
      triggerFocusTargetRef: /*#__PURE__*/React.createRef(),
      beforeContentFocusGuardRef: /*#__PURE__*/React.createRef(),
      onOpenChangeComplete: undefined,
      triggerElements: new _popups.PopupTriggerMap()
    }, selectors);

    // Set up propagation of state from parent menu if applicable.
    this.unsubscribeParentListener = this.observe('parent', parent => {
      this.unsubscribeParentListener?.();
      if (parent.type === 'menu') {
        let rootId = parent.store.select('rootId');
        let floatingTreeRoot = parent.store.select('floatingTreeRoot');
        let keyboardEventRelay = parent.store.select('keyboardEventRelay');
        this.unsubscribeParentListener = parent.store.subscribe(() => {
          const nextRootId = parent.store.select('rootId');
          const nextFloatingTreeRoot = parent.store.select('floatingTreeRoot');
          const nextKeyboardEventRelay = parent.store.select('keyboardEventRelay');
          if (rootId === nextRootId && floatingTreeRoot === nextFloatingTreeRoot && keyboardEventRelay === nextKeyboardEventRelay) {
            return;
          }
          rootId = nextRootId;
          floatingTreeRoot = nextFloatingTreeRoot;
          keyboardEventRelay = nextKeyboardEventRelay;
          this.notifyAll();
        });
        this.context.allowMouseUpTriggerRef = parent.store.context.allowMouseUpTriggerRef;
        return;
      }
      if (parent.type !== undefined) {
        this.context.allowMouseUpTriggerRef = parent.context.allowMouseUpTriggerRef;
      }
      this.unsubscribeParentListener = null;
    });
  }
  setOpen(open, eventDetails) {
    this.state.floatingRootContext.context.events.emit('setOpen', {
      open,
      eventDetails
    });
  }
  static useStore(externalStore, initialState) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const internalStore = (0, _useRefWithInit.useRefWithInit)(() => {
      return new MenuStore(initialState);
    }).current;
    return externalStore ?? internalStore;
  }
  unsubscribeParentListener = null;
}
exports.MenuStore = MenuStore;
function createInitialState() {
  return {
    ...(0, _popups.createInitialPopupStoreState)(),
    disabled: false,
    modal: true,
    openMethod: null,
    allowMouseEnter: false,
    highlightItemOnHover: true,
    stickIfOpen: true,
    parent: {
      type: undefined
    },
    rootId: undefined,
    activeIndex: null,
    hoverEnabled: true,
    instantType: undefined,
    openChangeReason: null,
    floatingTreeRoot: new _FloatingTreeStore.FloatingTreeStore(),
    floatingNodeId: undefined,
    floatingParentNodeId: null,
    itemProps: _empty.EMPTY_OBJECT,
    keyboardEventRelay: undefined,
    closeDelay: 0,
    hasViewport: false
  };
}