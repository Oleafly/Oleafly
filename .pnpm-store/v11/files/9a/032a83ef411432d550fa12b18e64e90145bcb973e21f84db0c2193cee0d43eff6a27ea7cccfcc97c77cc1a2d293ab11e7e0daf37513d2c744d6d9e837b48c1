'use client';

import * as React from 'react';
import { EMPTY_OBJECT } from '@base-ui/utils/empty';
import { useDismiss, FloatingTree, useFloatingParentNodeId } from "../../floating-ui-react/index.mjs";
import { PopoverRootContext, usePopoverRootContext } from "./PopoverRootContext.mjs";
import { PopoverStore } from "../store/PopoverStore.mjs";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { FOCUSABLE_POPUP_PROPS, useImplicitActiveTrigger, useInitialOpenSync, useOpenStateTransitions, usePopupInteractionProps, usePopupRootSync } from "../../utils/popups/index.mjs";
import { mergeProps } from "../../merge-props/index.mjs";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
  const store = PopoverStore.useStore(handle?.store, {
    modal,
    open: defaultOpen,
    openProp,
    activeTriggerId: defaultTriggerIdProp,
    triggerIdProp
  });
  useInitialOpenSync(store, openProp, defaultOpen, defaultTriggerIdProp);
  store.useControlledProp('openProp', openProp);
  store.useControlledProp('triggerIdProp', triggerIdProp);
  const open = store.useState('open');
  const mounted = store.useState('mounted');
  const payload = store.useState('payload');
  const nested = useFloatingParentNodeId() != null;
  store.useContextCallback('onOpenChange', onOpenChange);
  store.useContextCallback('onOpenChangeComplete', onOpenChangeComplete);
  usePopupRootSync(store, open);
  useImplicitActiveTrigger(store);
  const {
    forceUnmount
  } = useOpenStateTransitions(open, store, () => {
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
    store.setOpen(false, createChangeEventDetails(REASONS.imperativeAction));
  }, [store]);
  React.useImperativeHandle(props.actionsRef, () => ({
    unmount: forceUnmount,
    close: handleImperativeClose
  }), [forceUnmount, handleImperativeClose]);
  const shouldRenderInteractions = open || mounted;
  const popoverContext = React.useMemo(() => ({
    store
  }), [store]);
  return /*#__PURE__*/_jsxs(PopoverRootContext.Provider, {
    value: popoverContext,
    children: [shouldRenderInteractions && /*#__PURE__*/_jsx(PopoverInteractions, {
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
export function PopoverRoot(props) {
  if (usePopoverRootContext(true)) {
    return /*#__PURE__*/_jsx(PopoverRootComponent, {
      props: props
    });
  }
  return /*#__PURE__*/_jsx(FloatingTree, {
    children: /*#__PURE__*/_jsx(PopoverRootComponent, {
      props: props
    })
  });
}
function PopoverInteractions({
  store,
  modal
}) {
  const floatingRootContext = store.useState('floatingRootContext');
  const dismiss = useDismiss(floatingRootContext, {
    outsidePressEvent: {
      // Ensure `aria-hidden` on outside elements is removed immediately
      // on outside press when trapping focus.
      mouse: modal === 'trap-focus' ? 'sloppy' : 'intentional',
      touch: 'sloppy'
    }
  });
  const activeTriggerProps = dismiss.reference ?? EMPTY_OBJECT;
  const inactiveTriggerProps = dismiss.trigger ?? EMPTY_OBJECT;
  const popupProps = React.useMemo(() => mergeProps(FOCUSABLE_POPUP_PROPS, dismiss.floating), [dismiss.floating]);
  usePopupInteractionProps(store, {
    activeTriggerProps,
    inactiveTriggerProps,
    popupProps
  });
  return null;
}