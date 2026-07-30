'use client';

import * as React from 'react';
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { useProgressRootContext } from "../root/ProgressRootContext.mjs";
import { progressStateAttributesMapping } from "../root/stateAttributesMapping.mjs";
/**
 * A text label displaying the current value.
 * Renders a `<span>` element.
 *
 * Documentation: [Base UI Progress](https://base-ui.com/react/components/progress)
 */
export const ProgressValue = /*#__PURE__*/React.forwardRef(function ProgressValue(componentProps, forwardedRef) {
  const {
    className,
    render,
    children,
    style,
    ...elementProps
  } = componentProps;
  const {
    value,
    formattedValue,
    state
  } = useProgressRootContext();
  const formattedValueArg = value == null ? 'indeterminate' : formattedValue;
  const formattedValueDisplay = value == null ? null : formattedValue;
  const element = useRenderElement('span', componentProps, {
    state,
    ref: forwardedRef,
    props: [{
      'aria-hidden': true,
      children: typeof children === 'function' ? children(formattedValueArg, value) : formattedValueDisplay
    }, elementProps],
    stateAttributesMapping: progressStateAttributesMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") ProgressValue.displayName = "ProgressValue";