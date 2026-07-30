"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FieldsetLegend = void 0;
var React = _interopRequireWildcard(require("react"));
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _useBaseUiId = require("../../internals/useBaseUiId");
var _useRenderElement = require("../../internals/useRenderElement");
var _FieldsetRootContext = require("../root/FieldsetRootContext");
/**
 * An accessible label that is automatically associated with the fieldset.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Fieldset](https://base-ui.com/react/components/fieldset)
 */
const FieldsetLegend = exports.FieldsetLegend = /*#__PURE__*/React.forwardRef(function FieldsetLegend(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    id: idProp,
    ...elementProps
  } = componentProps;
  const {
    disabled,
    setLegendId
  } = (0, _FieldsetRootContext.useFieldsetRootContext)();
  const id = (0, _useBaseUiId.useBaseUiId)(idProp);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    setLegendId(id);
    return () => {
      setLegendId(undefined);
    };
  }, [setLegendId, id]);
  const state = {
    disabled: disabled ?? false
  };
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    state,
    ref: forwardedRef,
    props: [{
      id
    }, elementProps]
  });
  return element;
});
if (process.env.NODE_ENV !== "production") FieldsetLegend.displayName = "FieldsetLegend";