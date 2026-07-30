"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MeterRoot = void 0;
var React = _interopRequireWildcard(require("react"));
var _visuallyHidden = require("@base-ui/utils/visuallyHidden");
var _MeterRootContext = require("./MeterRootContext");
var _formatNumber = require("../../utils/formatNumber");
var _valueToPercent = require("../../utils/valueToPercent");
var _clamp = require("../../internals/clamp");
var _useRenderElement = require("../../internals/useRenderElement");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * Groups all parts of the meter and provides the value for screen readers.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Meter](https://base-ui.com/react/components/meter)
 */
const MeterRoot = exports.MeterRoot = /*#__PURE__*/React.forwardRef(function MeterRoot(componentProps, forwardedRef) {
  const {
    format,
    getAriaValueText,
    locale,
    max = 100,
    min = 0,
    value: valueProp,
    render,
    className,
    children,
    style,
    ...elementProps
  } = componentProps;
  const [labelId, setLabelId] = React.useState();

  // `clamp` handles infinity, but NaN needs an explicit fallback before normalizing range outputs.
  const rawPercentage = (0, _valueToPercent.valueToPercent)(valueProp, min, max);
  const percentageValue = (0, _clamp.clamp)(Number.isNaN(rawPercentage) ? 0 : rawPercentage, 0, 100);
  const clampedValue = (0, _clamp.clamp)(Number.isNaN(valueProp) ? min : valueProp, min, max);

  // Without an explicit `format`, the value is displayed as its position within the range so the
  // text stays in sync with the indicator fill for any `min`/`max` (not just the default 0–100).
  const formattedValue = format ? (0, _formatNumber.formatNumber)(valueProp, locale, format) : (0, _formatNumber.formatNumber)(percentageValue / 100, locale, {
    style: 'percent'
  });
  let ariaValuetext = formattedValue;
  if (getAriaValueText) {
    ariaValuetext = getAriaValueText(formattedValue, valueProp);
  }
  const defaultProps = {
    'aria-labelledby': labelId,
    'aria-valuemax': max,
    'aria-valuemin': min,
    'aria-valuenow': clampedValue,
    'aria-valuetext': ariaValuetext,
    role: 'meter',
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
    percentageValue,
    setLabelId,
    value: valueProp
  }), [formattedValue, max, min, percentageValue, setLabelId, valueProp]);
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    ref: forwardedRef,
    props: [defaultProps, elementProps]
  });
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_MeterRootContext.MeterRootContext.Provider, {
    value: contextValue,
    children: element
  });
});
if (process.env.NODE_ENV !== "production") MeterRoot.displayName = "MeterRoot";