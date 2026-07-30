'use client';

import * as React from 'react';
import { useTooltipRootContext } from "../root/TooltipRootContext.mjs";
import { useTooltipPositionerContext } from "../positioner/TooltipPositionerContext.mjs";
import { popupStateMapping as baseMapping } from "../../utils/popupStateMapping.mjs";
import { transitionStatusMapping } from "../../internals/stateAttributesMapping.mjs";
import { useOpenChangeComplete } from "../../internals/useOpenChangeComplete.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { getDisabledMountTransitionStyles } from "../../utils/getDisabledMountTransitionStyles.mjs";
import { useHoverFloatingInteraction } from "../../floating-ui-react/index.mjs";
const stateAttributesMapping = {
  ...baseMapping,
  ...transitionStatusMapping
};

/**
 * A container for the tooltip contents.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Tooltip](https://base-ui.com/react/components/tooltip)
 */
export const TooltipPopup = /*#__PURE__*/React.forwardRef(function TooltipPopup(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    ...elementProps
  } = componentProps;
  const store = useTooltipRootContext();
  const {
    side,
    align
  } = useTooltipPositionerContext();
  const open = store.useState('open');
  const instantType = store.useState('instantType');
  const transitionStatus = store.useState('transitionStatus');
  const popupProps = store.useState('popupProps');
  const floatingContext = store.useState('floatingRootContext');
  const disabled = store.useState('disabled');
  const closeDelay = store.useState('closeDelay');
  useOpenChangeComplete({
    open,
    ref: store.context.popupRef,
    onComplete() {
      if (open) {
        store.context.onOpenChangeComplete?.(true);
      }
    }
  });
  useHoverFloatingInteraction(floatingContext, {
    enabled: !disabled,
    closeDelay
  });
  const setPopupElement = store.useStateSetter('popupElement');
  const state = {
    open,
    side,
    align,
    instant: instantType,
    transitionStatus
  };
  const element = useRenderElement('div', componentProps, {
    state,
    ref: [forwardedRef, store.context.popupRef, setPopupElement],
    props: [popupProps, getDisabledMountTransitionStyles(transitionStatus), elementProps],
    stateAttributesMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") TooltipPopup.displayName = "TooltipPopup";