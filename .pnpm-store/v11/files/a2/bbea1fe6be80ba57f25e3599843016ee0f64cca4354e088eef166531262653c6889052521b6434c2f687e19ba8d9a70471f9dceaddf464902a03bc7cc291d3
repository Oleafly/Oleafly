'use client';

import * as React from 'react';
import { useStore } from '@base-ui/utils/store';
import { useSelectPositionerContext } from "../positioner/SelectPositionerContext.mjs";
import { useSelectRootContext } from "../root/SelectRootContext.mjs";
import { popupStateMapping as baseMapping } from "../../utils/popupStateMapping.mjs";
import { transitionStatusMapping } from "../../internals/stateAttributesMapping.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { selectors } from "../store.mjs";
const stateAttributesMapping = {
  ...baseMapping,
  ...transitionStatusMapping
};

/**
 * Displays an element positioned against the select popup anchor.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Select](https://base-ui.com/react/components/select)
 */
export const SelectArrow = /*#__PURE__*/React.forwardRef(function SelectArrow(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    ...elementProps
  } = componentProps;
  const {
    store
  } = useSelectRootContext();
  const {
    side,
    align,
    arrowRef,
    arrowStyles,
    arrowUncentered,
    alignItemWithTriggerActive
  } = useSelectPositionerContext();
  const open = useStore(store, selectors.open);
  const state = {
    open,
    side,
    align,
    uncentered: arrowUncentered
  };
  const element = useRenderElement('div', componentProps, {
    state,
    ref: [arrowRef, forwardedRef],
    props: [{
      style: arrowStyles,
      'aria-hidden': true
    }, elementProps],
    stateAttributesMapping
  });
  if (alignItemWithTriggerActive) {
    return null;
  }
  return element;
});
if (process.env.NODE_ENV !== "production") SelectArrow.displayName = "SelectArrow";