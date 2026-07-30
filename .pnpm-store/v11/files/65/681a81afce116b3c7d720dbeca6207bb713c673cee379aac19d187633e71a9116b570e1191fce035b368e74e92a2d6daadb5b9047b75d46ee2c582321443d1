'use client';

import * as React from 'react';
import { useValueAsRef } from '@base-ui/utils/useValueAsRef';
import { visuallyHidden } from '@base-ui/utils/visuallyHidden';
import { formatNumberValue } from "../../utils/formatNumber.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { ProgressRootContext } from "./ProgressRootContext.mjs";
import { progressStateAttributesMapping } from "./stateAttributesMapping.mjs";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
function getDefaultAriaValueText(formattedValue, value) {
  if (value == null) {
    return 'indeterminate progress';
  }
  return formattedValue || `${value}%`;
}

/**
 * Groups all parts of the progress bar and provides the task completion status to screen readers.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Progress](https://base-ui.com/react/components/progress)
 */
export const ProgressRoot = /*#__PURE__*/React.forwardRef(function ProgressRoot(componentProps, forwardedRef) {
  const {
    format,
    getAriaValueText = getDefaultAriaValueText,
    locale,
    max = 100,
    min = 0,
    value,
    render,
    className,
    children,
    style,
    ...elementProps
  } = componentProps;
  const [labelId, setLabelId] = React.useState();
  const formatOptionsRef = useValueAsRef(format);
  let status = 'indeterminate';
  if (Number.isFinite(value)) {
    status = value === max ? 'complete' : 'progressing';
  }
  const formattedValue = formatNumberValue(value, locale, formatOptionsRef.current);
  const state = React.useMemo(() => ({
    status
  }), [status]);
  const defaultProps = {
    'aria-labelledby': labelId,
    'aria-valuemax': max,
    'aria-valuemin': min,
    'aria-valuenow': value ?? undefined,
    'aria-valuetext': getAriaValueText(formattedValue, value),
    role: 'progressbar',
    children: /*#__PURE__*/_jsxs(React.Fragment, {
      children: [children, /*#__PURE__*/_jsx("span", {
        role: "presentation",
        style: visuallyHidden,
        children: "x"
      })]
    })
  };
  const contextValue = React.useMemo(() => ({
    formattedValue,
    max,
    min,
    setLabelId,
    state,
    status,
    value
  }), [formattedValue, max, min, setLabelId, state, status, value]);
  const element = useRenderElement('div', componentProps, {
    state,
    ref: forwardedRef,
    props: [defaultProps, elementProps],
    stateAttributesMapping: progressStateAttributesMapping
  });
  return /*#__PURE__*/_jsx(ProgressRootContext.Provider, {
    value: contextValue,
    children: element
  });
});
if (process.env.NODE_ENV !== "production") ProgressRoot.displayName = "ProgressRoot";