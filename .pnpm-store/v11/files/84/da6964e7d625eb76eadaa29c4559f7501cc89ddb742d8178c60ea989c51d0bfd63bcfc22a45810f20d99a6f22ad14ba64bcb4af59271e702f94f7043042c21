"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useRenderDialogRoot = useRenderDialogRoot;
var React = _interopRequireWildcard(require("react"));
var _useOnFirstRender = require("@base-ui/utils/useOnFirstRender");
var _useDialogRoot = require("./useDialogRoot");
var _DialogRootContext = require("./DialogRootContext");
var _DialogStore = require("../store/DialogStore");
var _jsxRuntime = require("react/jsx-runtime");
function useRenderDialogRoot(props, mode = 'dialog') {
  const {
    children,
    open: openProp,
    defaultOpen = false,
    onOpenChange,
    onOpenChangeComplete,
    disablePointerDismissal: disablePointerDismissalProp = false,
    modal: modalProp = true,
    actionsRef,
    handle,
    triggerId: triggerIdProp,
    defaultTriggerId: defaultTriggerIdProp = null
  } = props;
  const isDrawer = mode === 'drawer';
  const isAlertDialog = mode === 'alert-dialog';
  const modal = isAlertDialog ? true : modalProp;
  const disablePointerDismissal = isAlertDialog || disablePointerDismissalProp;
  const role = isAlertDialog ? 'alertdialog' : 'dialog';
  const parentDialogRootContext = (0, _DialogRootContext.useDialogRootContext)(true);
  const nested = Boolean(parentDialogRootContext);
  const rootState = {
    modal,
    disablePointerDismissal,
    nested,
    role
  };
  const store = _DialogStore.DialogStore.useStore(handle?.store, {
    open: defaultOpen,
    openProp,
    activeTriggerId: defaultTriggerIdProp,
    triggerIdProp,
    ...rootState
  });

  // Support initially open state when uncontrolled
  (0, _useOnFirstRender.useOnFirstRender)(() => {
    const nextState = openProp === undefined && store.state.open === false && defaultOpen === true ? {
      open: true,
      activeTriggerId: defaultTriggerIdProp
    } : null;
    if (isAlertDialog) {
      // Handles can reuse plain Dialog stores; alert dialog invariants must exist immediately.
      store.update(nextState ? {
        ...rootState,
        ...nextState
      } : rootState);
    } else if (nextState) {
      store.update(nextState);
    }
  });
  store.useControlledProp('openProp', openProp);
  store.useControlledProp('triggerIdProp', triggerIdProp);
  store.useSyncedValues(rootState);
  store.useContextCallback('onOpenChange', onOpenChange);
  store.useContextCallback('onOpenChangeComplete', onOpenChangeComplete);
  const open = store.useState('open');
  const mounted = store.useState('mounted');
  const payload = store.useState('payload');
  (0, _useDialogRoot.useDialogRoot)({
    store,
    actionsRef
  });
  const shouldRenderInteractions = open || mounted;
  const contextValue = React.useMemo(() => ({
    store
  }), [store]);
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_DialogRootContext.IsDrawerContext.Provider, {
    value: false,
    children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(_DialogRootContext.DialogRootContext.Provider, {
      value: contextValue,
      children: [shouldRenderInteractions && /*#__PURE__*/(0, _jsxRuntime.jsx)(_useDialogRoot.DialogInteractions, {
        store: store,
        parentContext: parentDialogRootContext?.store.context,
        isDrawer: isDrawer
      }), typeof children === 'function' ? children({
        payload
      }) : children]
    })
  });
}