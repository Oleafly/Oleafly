'use client';

import * as React from 'react';
import { useToastPositionerContext } from "../positioner/ToastPositionerContext.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";

/**
 * Displays an element positioned against the toast anchor.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Toast](https://base-ui.com/react/components/toast)
 */
export const ToastArrow = /*#__PURE__*/React.forwardRef(function ToastArrow(componentProps, forwardedRef) {
  const {
    className,
    render,
    style,
    ...elementProps
  } = componentProps;
  const {
    arrowRef,
    side,
    align,
    arrowUncentered,
    arrowStyles
  } = useToastPositionerContext();
  const state = {
    side,
    align,
    uncentered: arrowUncentered
  };
  const element = useRenderElement('div', componentProps, {
    state,
    ref: [forwardedRef, arrowRef],
    props: [{
      style: arrowStyles,
      'aria-hidden': true
    }, elementProps]
  });
  return element;
});
if (process.env.NODE_ENV !== "production") ToastArrow.displayName = "ToastArrow";