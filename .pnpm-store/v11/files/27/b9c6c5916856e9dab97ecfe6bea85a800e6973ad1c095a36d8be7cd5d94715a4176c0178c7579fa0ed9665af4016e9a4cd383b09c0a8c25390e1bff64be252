"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ComboboxBackdrop = void 0;
var React = _interopRequireWildcard(require("react"));
var _store = require("@base-ui/utils/store");
var _ComboboxRootContext = require("../root/ComboboxRootContext");
var _popupStateMapping = require("../../utils/popupStateMapping");
var _stateAttributesMapping = require("../../internals/stateAttributesMapping");
var _useRenderElement = require("../../internals/useRenderElement");
var _store2 = require("../store");
const stateAttributesMapping = {
  ..._popupStateMapping.popupStateMapping,
  ..._stateAttributesMapping.transitionStatusMapping
};

/**
 * An overlay displayed beneath the popup.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Combobox](https://base-ui.com/react/components/combobox)
 */
const ComboboxBackdrop = exports.ComboboxBackdrop = /*#__PURE__*/React.forwardRef(function ComboboxBackdrop(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    ...elementProps
  } = componentProps;
  const store = (0, _ComboboxRootContext.useComboboxRootContext)();
  const open = (0, _store.useStore)(store, _store2.selectors.open);
  const mounted = (0, _store.useStore)(store, _store2.selectors.mounted);
  const transitionStatus = (0, _store.useStore)(store, _store2.selectors.transitionStatus);
  const state = {
    open,
    transitionStatus
  };
  return (0, _useRenderElement.useRenderElement)('div', componentProps, {
    state,
    ref: forwardedRef,
    stateAttributesMapping,
    props: [{
      role: 'presentation',
      hidden: !mounted,
      style: {
        userSelect: 'none',
        WebkitUserSelect: 'none'
      }
    }, elementProps]
  });
});
if (process.env.NODE_ENV !== "production") ComboboxBackdrop.displayName = "ComboboxBackdrop";