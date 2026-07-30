"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AccordionRoot = void 0;
var React = _interopRequireWildcard(require("react"));
var _useControlled = require("@base-ui/utils/useControlled");
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _warn = require("@base-ui/utils/warn");
var _CompositeList = require("../../internals/composite/list/CompositeList");
var _DirectionContext = require("../../internals/direction-context/DirectionContext");
var _AccordionRootContext = require("./AccordionRootContext");
var _useRenderElement = require("../../internals/useRenderElement");
var _jsxRuntime = require("react/jsx-runtime");
const rootStateAttributesMapping = {
  value: () => null
};

/**
 * Groups all parts of the accordion.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Accordion](https://base-ui.com/react/components/accordion)
 */
const AccordionRoot = exports.AccordionRoot = /*#__PURE__*/React.forwardRef(function AccordionRoot(componentProps, forwardedRef) {
  const {
    render,
    className,
    disabled = false,
    hiddenUntilFound: hiddenUntilFoundProp,
    keepMounted: keepMountedProp,
    loopFocus,
    onValueChange,
    multiple = false,
    orientation = 'vertical',
    value: valueProp,
    defaultValue: defaultValueProp,
    style,
    ...elementProps
  } = componentProps;
  const direction = (0, _DirectionContext.useDirection)();
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
      if (hiddenUntilFoundProp && keepMountedProp === false) {
        (0, _warn.warn)('The `keepMounted={false}` prop on `Accordion.Root` is ignored when `hiddenUntilFound` is enabled, since panels must remain mounted while closed.');
      }
    }, [hiddenUntilFoundProp, keepMountedProp]);
  }

  // memoized to allow omitting both defaultValue and value
  // which would otherwise trigger a warning in useControlled
  const defaultValue = React.useMemo(() => {
    if (valueProp === undefined) {
      return defaultValueProp ?? [];
    }
    return undefined;
  }, [valueProp, defaultValueProp]);
  const accordionItemRefs = React.useRef([]);
  const [value, setValue] = (0, _useControlled.useControlled)({
    controlled: valueProp,
    default: defaultValue,
    name: 'Accordion',
    state: 'value'
  });
  const handleValueChange = (0, _useStableCallback.useStableCallback)((newValue, nextOpen, details) => {
    if (!multiple) {
      const nextValue = value[0] === newValue ? [] : [newValue];
      onValueChange?.(nextValue, details);
      if (details.isCanceled) {
        return;
      }
      setValue(nextValue);
    } else if (nextOpen) {
      const nextOpenValues = value.slice();
      nextOpenValues.push(newValue);
      onValueChange?.(nextOpenValues, details);
      if (details.isCanceled) {
        return;
      }
      setValue(nextOpenValues);
    } else {
      const nextOpenValues = value.filter(v => v !== newValue);
      onValueChange?.(nextOpenValues, details);
      if (details.isCanceled) {
        return;
      }
      setValue(nextOpenValues);
    }
  });
  const state = React.useMemo(() => ({
    value,
    disabled,
    orientation
  }), [value, disabled, orientation]);
  const contextValue = React.useMemo(() => ({
    disabled,
    handleValueChange,
    hiddenUntilFound: hiddenUntilFoundProp ?? false,
    keepMounted: keepMountedProp ?? false,
    state,
    value
  }), [disabled, handleValueChange, hiddenUntilFoundProp, keepMountedProp, state, value]);
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    state,
    ref: forwardedRef,
    props: [{
      dir: direction
    }, elementProps],
    stateAttributesMapping: rootStateAttributesMapping
  });
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_AccordionRootContext.AccordionRootContext.Provider, {
    value: contextValue,
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_CompositeList.CompositeList, {
      elementsRef: accordionItemRefs,
      children: element
    })
  });
});
if (process.env.NODE_ENV !== "production") AccordionRoot.displayName = "AccordionRoot";