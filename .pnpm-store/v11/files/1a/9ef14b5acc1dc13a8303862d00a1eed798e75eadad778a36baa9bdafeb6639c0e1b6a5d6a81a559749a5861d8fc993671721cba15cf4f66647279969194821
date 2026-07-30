"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SelectLabel = void 0;
var React = _interopRequireWildcard(require("react"));
var _store = require("@base-ui/utils/store");
var _useRenderElement = require("../../internals/useRenderElement");
var _FieldRootContext = require("../../internals/field-root-context/FieldRootContext");
var _constants = require("../../internals/field-constants/constants");
var _useLabel = require("../../internals/labelable-provider/useLabel");
var _resolveAriaLabelledBy = require("../../utils/resolveAriaLabelledBy");
var _SelectRootContext = require("../root/SelectRootContext");
var _store2 = require("../store");
/**
 * An accessible label that is automatically associated with the select trigger.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Select](https://base-ui.com/react/components/select)
 */
const SelectLabel = exports.SelectLabel = /*#__PURE__*/React.forwardRef(function SelectLabel(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    ...elementProps
  } = componentProps;
  // Keep label id derived from the root and ignore runtime `id` overrides from untyped consumers.
  const elementPropsWithoutId = elementProps;
  delete elementPropsWithoutId.id;
  const fieldRootContext = (0, _FieldRootContext.useFieldRootContext)();
  const {
    store
  } = (0, _SelectRootContext.useSelectRootContext)();
  const triggerElement = (0, _store.useStore)(store, _store2.selectors.triggerElement);
  const rootId = (0, _store.useStore)(store, _store2.selectors.id);
  const defaultLabelId = (0, _resolveAriaLabelledBy.getDefaultLabelId)(rootId);
  const labelProps = (0, _useLabel.useLabel)({
    id: defaultLabelId,
    fallbackControlId: triggerElement?.id ?? rootId,
    setLabelId(nextLabelId) {
      store.set('labelId', nextLabelId);
    }
  });
  return (0, _useRenderElement.useRenderElement)('div', componentProps, {
    ref: forwardedRef,
    state: fieldRootContext.state,
    props: [labelProps, elementProps],
    stateAttributesMapping: _constants.fieldValidityMapping
  });
});
if (process.env.NODE_ENV !== "production") SelectLabel.displayName = "SelectLabel";