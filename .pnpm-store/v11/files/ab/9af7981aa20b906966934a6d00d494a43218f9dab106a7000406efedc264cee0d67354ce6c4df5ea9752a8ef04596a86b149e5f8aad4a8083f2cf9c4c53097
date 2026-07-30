"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PopoverRoot = PopoverRoot;
var React = _interopRequireWildcard(require("react"));
var _empty = require("@base-ui/utils/empty");
var _floatingUiReact = require("../../floating-ui-react");
var _PopoverRootContext = require("./PopoverRootContext");
var _PopoverStore = require("../store/PopoverStore");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
var _popups = require("../../utils/popups");
var _mergeProps = require("../../merge-props");
var _jsxRuntime = require("react/jsx-runtime");
function PopoverRootComponent({
  props
}) {
  const {
    children,
    open: openProp,
    defaultOpen = false,
    onOpenChange,
    onOpenChangeComplete,
    modal = false,
    handle,
    triggerId: triggerIdProp,
    defaultTriggerId: defaultTriggerIdProp = null
  } = props;
  const store = _PopoverStore.PopoverStore.useStore(handle?.store, {
    modal,
    open: defaultOpen,
    openProp,
    activeTriggerId: defaultTriggerIdProp,
    triggerIdProp
  });
  (0, _popups.useInitialOpenSync)(store, openProp, defaultOpen, defaultTriggerIdProp);
  store.useControlledProp('openProp', openProp);
  store.useControlledProp('triggerIdProp', triggerIdProp);
  const open = store.useState('open');
  const mounted = store.useState('mounted');
  const payload = store.useState('payload');
  const nested = (0, _floatingUiReact.useFloatingParentNodeId)() != null;
  store.useContextCallback('onOpenChange', onOpenChange);
  store.useContextCallback('onOpenChangeComplete', onOpenChangeComplete);
  (0, _popups.usePopupRootSync)(store, open);
  (0, _popups.useImplicitActiveTrigger)(store);
  const {
    forceUnmount
  } = (0, _popups.useOpenStateTransitions)(open, store, () => {
    store.update({
      stickIfOpen: true,
      openChangeReason: null
    });
  });
  store.useSyncedValues({
    modal,
    nested
  });
  React.useEffect(() => {
    if (!open) {
      store.context.stickIfOpenTimeout.clear();
    }
  }, [store, open]);
  const handleImperativeClose = React.useCallback(() => {
    store.setOpen(false, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.imperativeAction));
  }, [store]);
  React.useImperativeHandle(props.actionsRef, () => ({
    unmount: forceUnmount,
    close: handleImperativeClose
  }), [forceUnmount, handleImperativeClose]);
  const shouldRenderInteractions = open || mounted;
  const popoverContext = React.useMemo(() => ({
    store
  }), [store]);
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_PopoverRootContext.PopoverRootContext.Provider, {
    value: popoverContext,
    children: [shouldRenderInteractions && /*#__PURE__*/(0, _jsxRuntime.jsx)(PopoverInteractions, {
      store: store,
      modal: modal
    }), typeof children === 'function' ? children({
      payload
    }) : children]
  });
}

/**
 * Groups all parts of the popover.
 * Doesn't render its own HTML element.
 *
 * Documentation: [Base UI Popover](https://base-ui.com/react/components/popover)
 */
function PopoverRoot(props) {
  if ((0, _PopoverRootContext.usePopoverRootContext)(true)) {
    return /*#__PURE__*/(0, _jsxRuntime.jsx)(PopoverRootComponent, {
      props: props
    });
  }
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_floatingUiReact.FloatingTree, {
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(PopoverRootComponent, {
      props: props
    })
  });
}
function PopoverInteractions({
  store,
  modal
}) {
  const floatingRootContext = store.useState('floatingRootContext');
  const dismiss = (0, _floatingUiReact.useDismiss)(floatingRootContext, {
    outsidePressEvent: {
      // Ensure `aria-hidden` on outside elements is removed immediately
      // on outside press when trapping focus.
      mouse: modal === 'trap-focus' ? 'sloppy' : 'intentional',
      touch: 'sloppy'
    }
  });
  const activeTriggerProps = dismiss.reference ?? _empty.EMPTY_OBJECT;
  const inactiveTriggerProps = dismiss.trigger ?? _empty.EMPTY_OBJECT;
  const popupProps = React.useMemo(() => (0, _mergeProps.mergeProps)(_popups.FOCUSABLE_POPUP_PROPS, dismiss.floating), [dismiss.floating]);
  (0, _popups.usePopupInteractionProps)(store, {
    activeTriggerProps,
    inactiveTriggerProps,
    popupProps
  });
  return null;
}