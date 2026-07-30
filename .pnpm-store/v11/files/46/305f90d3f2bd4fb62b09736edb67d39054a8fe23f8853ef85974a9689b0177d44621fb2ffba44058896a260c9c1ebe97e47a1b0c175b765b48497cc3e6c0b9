"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PreviewCardRoot = void 0;
var React = _interopRequireWildcard(require("react"));
var _fastHooks = require("@base-ui/utils/fastHooks");
var _empty = require("@base-ui/utils/empty");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _floatingUiReact = require("../../floating-ui-react");
var _PreviewCardContext = require("./PreviewCardContext");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
var _PreviewCardStore = require("../store/PreviewCardStore");
var _popups = require("../../utils/popups");
var _mergeProps = require("../../merge-props");
var _jsxRuntime = require("react/jsx-runtime");
function PreviewCardRootComponent(props) {
  const {
    open: openProp,
    defaultOpen = false,
    onOpenChange,
    onOpenChangeComplete,
    actionsRef,
    handle,
    triggerId: triggerIdProp,
    defaultTriggerId: defaultTriggerIdProp = null,
    children
  } = props;
  const store = _PreviewCardStore.PreviewCardStore.useStore(handle?.store, {
    open: defaultOpen,
    openProp,
    activeTriggerId: defaultTriggerIdProp,
    triggerIdProp
  });
  (0, _popups.useInitialOpenSync)(store, openProp, defaultOpen, defaultTriggerIdProp);
  store.useControlledProp('openProp', openProp);
  store.useControlledProp('triggerIdProp', triggerIdProp);
  store.useContextCallback('onOpenChange', onOpenChange);
  store.useContextCallback('onOpenChangeComplete', onOpenChangeComplete);
  const open = store.useState('open');
  const activeTriggerId = store.useState('activeTriggerId');
  const mounted = store.useState('mounted');
  const payload = store.useState('payload');
  (0, _popups.useImplicitActiveTrigger)(store, {
    closeOnActiveTriggerUnmount: true
  });
  const {
    forceUnmount
  } = (0, _popups.useOpenStateTransitions)(open, store, () => {
    store.context.inlineRectCoordsRef.current = undefined;
  });
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (open) {
      if (activeTriggerId == null) {
        store.set('payload', undefined);
      }
    }
  }, [store, activeTriggerId, open]);
  const handleImperativeClose = React.useCallback(() => {
    store.setOpen(false, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.imperativeAction));
  }, [store]);
  React.useImperativeHandle(actionsRef, () => ({
    unmount: forceUnmount,
    close: handleImperativeClose
  }), [forceUnmount, handleImperativeClose]);
  const shouldRenderInteractions = open || mounted;
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_PreviewCardContext.PreviewCardRootContext.Provider, {
    value: store,
    children: [shouldRenderInteractions && /*#__PURE__*/(0, _jsxRuntime.jsx)(PreviewCardInteractions, {
      store: store
    }), typeof children === 'function' ? children({
      payload
    }) : children]
  });
}
function PreviewCardInteractions({
  store
}) {
  const floatingRootContext = store.useState('floatingRootContext');
  const dismiss = (0, _floatingUiReact.useDismiss)(floatingRootContext);
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

/**
 * Groups all parts of the preview card.
 * Doesn't render its own HTML element.
 *
 * Documentation: [Base UI Preview Card](https://base-ui.com/react/components/preview-card)
 */
const PreviewCardRoot = exports.PreviewCardRoot = (0, _fastHooks.fastComponent)(function PreviewCardRoot(props) {
  if ((0, _PreviewCardContext.usePreviewCardRootContext)(true)) {
    return /*#__PURE__*/(0, _jsxRuntime.jsx)(PreviewCardRootComponent, {
      ...props
    });
  }
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_floatingUiReact.FloatingTree, {
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(PreviewCardRootComponent, {
      ...props
    })
  });
});
if (process.env.NODE_ENV !== "production") PreviewCardRoot.displayName = "PreviewCardRoot";