"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ProgressRoot = void 0;
var React = _interopRequireWildcard(require("react"));
var _useValueAsRef = require("@base-ui/utils/useValueAsRef");
var _visuallyHidden = require("@base-ui/utils/visuallyHidden");
var _formatNumber = require("../../utils/formatNumber");
var _useRenderElement = require("../../internals/useRenderElement");
var _ProgressRootContext = require("./ProgressRootContext");
var _stateAttributesMapping = require("./stateAttributesMapping");
var _jsxRuntime = require("react/jsx-runtime");
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
const ProgressRoot = exports.ProgressRoot = /*#__PURE__*/React.forwardRef(function ProgressRoot(componentProps, forwardedRef) {
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
  const formatOptionsRef = (0, _useValueAsRef.useValueAsRef)(format);
  let status = 'indeterminate';
  if (Number.isFinite(value)) {
    status = value === max ? 'complete' : 'progressing';
  }
  const formattedValue = (0, _formatNumber.formatNumberValue)(value, locale, formatOptionsRef.current);
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
    children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(React.Fragment, {
      children: [children, /*#__PURE__*/(0, _jsxRuntime.jsx)("span", {
        role: "presentation",
        style: _visuallyHidden.visuallyHidden,
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
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    state,
    ref: forwardedRef,
    props: [defaultProps, elementProps],
    stateAttributesMapping: _stateAttributesMapping.progressStateAttributesMapping
  });
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_ProgressRootContext.ProgressRootContext.Provider, {
    value: contextValue,
    children: element
  });
});
if (process.env.NODE_ENV !== "production") ProgressRoot.displayName = "ProgressRoot";