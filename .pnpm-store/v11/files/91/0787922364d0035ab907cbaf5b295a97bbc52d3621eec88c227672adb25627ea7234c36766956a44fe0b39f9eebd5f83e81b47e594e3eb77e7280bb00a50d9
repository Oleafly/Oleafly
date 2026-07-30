'use client';

import * as React from 'react';
import { fastComponent } from '@base-ui/utils/fastHooks';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { TooltipRootContext } from "./TooltipRootContext.mjs";
import { useClientPoint, useDismiss } from "../../floating-ui-react/index.mjs";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { FOCUSABLE_POPUP_PROPS, useImplicitActiveTrigger, useInitialOpenSync, useOpenStateTransitions, usePopupInteractionProps } from "../../utils/popups/index.mjs";
import { mergeProps } from "../../merge-props/index.mjs";
import { TooltipStore } from "../store/TooltipStore.mjs";
import { REASONS } from "../../internals/reasons.mjs";

/**
 * Groups all parts of the tooltip.
 * Doesn't render its own HTML element.
 *
 * Documentation: [Base UI Tooltip](https://base-ui.com/react/components/tooltip)
 */
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const TooltipRoot = fastComponent(function TooltipRoot(props) {
  const {
    disabled = false,
    defaultOpen = false,
    open: openProp,
    disableHoverablePopup = false,
    trackCursorAxis = 'none',
    actionsRef,
    onOpenChange,
    onOpenChangeComplete,
    handle,
    triggerId: triggerIdProp,
    defaultTriggerId: defaultTriggerIdProp = null,
    children
  } = props;
  const store = TooltipStore.useStore(handle?.store, {
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
  const openState = store.useState('open');
  const open = !disabled && openState;
  const activeTriggerId = store.useState('activeTriggerId');
  const mounted = store.useState('mounted');
  const payload = store.useState('payload');
  store.useSyncedValues({
    trackCursorAxis,
    disableHoverablePopup
  });
  store.useSyncedValue('disabled', disabled);
  useImplicitActiveTrigger(store, {
    closeOnActiveTriggerUnmount: true
  });
  const {
    forceUnmount,
    transitionStatus
  } = useOpenStateTransitions(open, store);
  const isInstantPhase = store.useState('isInstantPhase');
  const instantType = store.useState('instantType');
  const lastOpenChangeReason = store.useState('lastOpenChangeReason');

  // Animations should be instant in two cases:
  // 1) Opening during the provider's instant phase (adjacent tooltip opens instantly)
  // 2) Closing because another tooltip opened (reason === 'none')
  // Otherwise, allow the animation to play. In particular, do not disable animations
  // during the 'ending' phase unless it's due to a sibling opening.
  const previousInstantTypeRef = React.useRef(null);
  useIsoLayoutEffect(() => {
    if (openState && disabled) {
      store.setOpen(false, createChangeEventDetails(REASONS.disabled));
    }
  }, [openState, disabled, store]);
  useIsoLayoutEffect(() => {
    if (transitionStatus === 'ending' && lastOpenChangeReason === REASONS.none || transitionStatus !== 'ending' && isInstantPhase) {
      // Capture the current instant type so we can restore it later
      // and set to 'delay' to disable animations while moving from one trigger to another
      // within a delay group.
      if (instantType !== 'delay') {
        previousInstantTypeRef.current = instantType;
      }
      store.set('instantType', 'delay');
    } else if (previousInstantTypeRef.current !== null) {
      store.set('instantType', previousInstantTypeRef.current);
      previousInstantTypeRef.current = null;
    }
  }, [transitionStatus, isInstantPhase, lastOpenChangeReason, instantType, store]);
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
  const shouldRenderInteractions = open || mounted || !disabled && trackCursorAxis !== 'none';
  return /*#__PURE__*/_jsxs(TooltipRootContext.Provider, {
    value: store,
    children: [shouldRenderInteractions && /*#__PURE__*/_jsx(TooltipInteractions, {
      store: store,
      disabled: disabled,
      trackCursorAxis: trackCursorAxis
    }), typeof children === 'function' ? children({
      payload
    }) : children]
  });
});
if (process.env.NODE_ENV !== "production") TooltipRoot.displayName = "TooltipRoot";
function TooltipInteractions({
  store,
  disabled,
  trackCursorAxis
}) {
  const floatingRootContext = store.useState('floatingRootContext');
  const dismiss = useDismiss(floatingRootContext, {
    enabled: !disabled,
    referencePress: () => store.select('closeOnClick')
  });
  const clientPoint = useClientPoint(floatingRootContext, {
    enabled: !disabled && trackCursorAxis !== 'none',
    axis: trackCursorAxis === 'none' ? undefined : trackCursorAxis
  });
  const activeTriggerProps = React.useMemo(() => mergeProps(clientPoint.reference, dismiss.reference), [clientPoint.reference, dismiss.reference]);
  const inactiveTriggerProps = React.useMemo(() => mergeProps(clientPoint.trigger, dismiss.trigger), [clientPoint.trigger, dismiss.trigger]);
  const popupProps = React.useMemo(() => mergeProps(FOCUSABLE_POPUP_PROPS, clientPoint.floating, dismiss.floating), [clientPoint.floating, dismiss.floating]);
  usePopupInteractionProps(store, {
    activeTriggerProps,
    inactiveTriggerProps,
    popupProps
  });
  return null;
}