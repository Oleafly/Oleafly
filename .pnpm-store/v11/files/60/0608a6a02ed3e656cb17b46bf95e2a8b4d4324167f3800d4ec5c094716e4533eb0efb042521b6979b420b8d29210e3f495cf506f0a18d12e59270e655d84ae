'use client';

import * as React from 'react';
import { fastComponent } from '@base-ui/utils/fastHooks';
import { EMPTY_OBJECT } from '@base-ui/utils/empty';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { useDismiss, FloatingTree } from "../../floating-ui-react/index.mjs";
import { PreviewCardRootContext, usePreviewCardRootContext } from "./PreviewCardContext.mjs";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { PreviewCardStore } from "../store/PreviewCardStore.mjs";
import { FOCUSABLE_POPUP_PROPS, useImplicitActiveTrigger, useInitialOpenSync, useOpenStateTransitions, usePopupInteractionProps } from "../../utils/popups/index.mjs";
import { mergeProps } from "../../merge-props/index.mjs";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
  const store = PreviewCardStore.useStore(handle?.store, {
    open: defaultOpen,
    openProp,
    activeTriggerId: defaultTriggerIdProp,
    triggerIdProp
  });
  useInitialOpenSync(store, openProp, defaultOpen, defaultTriggerIdProp);
  store.useControlledProp('openProp', openProp);
  store.useControlledProp('triggerIdProp', triggerIdProp);
  store.useContextCallback('onOpenChange', onOpenChange);
  store.useContextCallback('onOpenChangeComplete', onOpenChangeComplete);
  const open = store.useState('open');
  const activeTriggerId = store.useState('activeTriggerId');
  const mounted = store.useState('mounted');
  const payload = store.useState('payload');
  useImplicitActiveTrigger(store, {
    closeOnActiveTriggerUnmount: true
  });
  const {
    forceUnmount
  } = useOpenStateTransitions(open, store, () => {
    store.context.inlineRectCoordsRef.current = undefined;
  });
  useIsoLayoutEffect(() => {
    if (open) {
      if (activeTriggerId == null) {
        store.set('payload', undefined);
      }
    }
  }, [store, activeTriggerId, open]);
  const handleImperativeClose = React.useCallback(() => {
    store.setOpen(false, createChangeEventDetails(REASONS.imperativeAction));
  }, [store]);
  React.useImperativeHandle(actionsRef, () => ({
    unmount: forceUnmount,
    close: handleImperativeClose
  }), [forceUnmount, handleImperativeClose]);
  const shouldRenderInteractions = open || mounted;
  return /*#__PURE__*/_jsxs(PreviewCardRootContext.Provider, {
    value: store,
    children: [shouldRenderInteractions && /*#__PURE__*/_jsx(PreviewCardInteractions, {
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
  const dismiss = useDismiss(floatingRootContext);
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

/**
 * Groups all parts of the preview card.
 * Doesn't render its own HTML element.
 *
 * Documentation: [Base UI Preview Card](https://base-ui.com/react/components/preview-card)
 */
export const PreviewCardRoot = fastComponent(function PreviewCardRoot(props) {
  if (usePreviewCardRootContext(true)) {
    return /*#__PURE__*/_jsx(PreviewCardRootComponent, {
      ...props
    });
  }
  return /*#__PURE__*/_jsx(FloatingTree, {
    children: /*#__PURE__*/_jsx(PreviewCardRootComponent, {
      ...props
    })
  });
});
if (process.env.NODE_ENV !== "production") PreviewCardRoot.displayName = "PreviewCardRoot";