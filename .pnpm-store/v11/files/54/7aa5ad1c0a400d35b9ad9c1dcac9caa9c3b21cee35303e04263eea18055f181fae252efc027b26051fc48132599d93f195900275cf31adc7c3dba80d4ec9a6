import * as React from 'react';
import { createSelector, ReactStore } from '@base-ui/utils/store';
import { EMPTY_OBJECT } from '@base-ui/utils/empty';
import { useRefWithInit } from '@base-ui/utils/useRefWithInit';
import { FloatingTreeStore } from "../../floating-ui-react/components/FloatingTreeStore.mjs";
import { createInitialPopupStoreState, popupStoreSelectors, PopupTriggerMap } from "../../utils/popups/index.mjs";
const selectors = {
  ...popupStoreSelectors,
  disabled: createSelector(state => state.parent.type === 'menubar' ? state.parent.context.disabled || state.disabled : state.disabled),
  modal: createSelector(state => (state.parent.type === undefined || state.parent.type === 'context-menu') && (state.modal ?? true)),
  openMethod: createSelector(state => state.openMethod),
  allowMouseEnter: createSelector(state => state.allowMouseEnter),
  highlightItemOnHover: createSelector(state => state.highlightItemOnHover),
  stickIfOpen: createSelector(state => state.stickIfOpen),
  parent: createSelector(state => state.parent),
  rootId: createSelector(state => {
    if (state.parent.type === 'menu') {
      return state.parent.store.select('rootId');
    }
    return state.parent.type !== undefined ? state.parent.context.rootId : state.rootId;
  }),
  activeIndex: createSelector(state => state.activeIndex),
  isActive: createSelector((state, itemIndex) => state.activeIndex === itemIndex),
  hoverEnabled: createSelector(state => state.hoverEnabled),
  instantType: createSelector(state => state.instantType),
  lastOpenChangeReason: createSelector(state => state.openChangeReason),
  floatingTreeRoot: createSelector(state => {
    if (state.parent.type === 'menu') {
      return state.parent.store.select('floatingTreeRoot');
    }
    return state.floatingTreeRoot;
  }),
  floatingNodeId: createSelector(state => state.floatingNodeId),
  floatingParentNodeId: createSelector(state => state.floatingParentNodeId),
  itemProps: createSelector(state => state.itemProps),
  closeDelay: createSelector(state => state.closeDelay),
  hasViewport: createSelector(state => state.hasViewport),
  keyboardEventRelay: createSelector(state => {
    if (state.keyboardEventRelay) {
      return state.keyboardEventRelay;
    }
    if (state.parent.type === 'menu') {
      return state.parent.store.select('keyboardEventRelay');
    }
    return undefined;
  })
};
export class MenuStore extends ReactStore {
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
      triggerElements: new PopupTriggerMap()
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
    const internalStore = useRefWithInit(() => {
      return new MenuStore(initialState);
    }).current;
    return externalStore ?? internalStore;
  }
  unsubscribeParentListener = null;
}
function createInitialState() {
  return {
    ...createInitialPopupStoreState(),
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
    floatingTreeRoot: new FloatingTreeStore(),
    floatingNodeId: undefined,
    floatingParentNodeId: null,
    itemProps: EMPTY_OBJECT,
    keyboardEventRelay: undefined,
    closeDelay: 0,
    hasViewport: false
  };
}