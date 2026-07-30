"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SelectList = void 0;
var React = _interopRequireWildcard(require("react"));
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _store = require("@base-ui/utils/store");
var _SelectRootContext = require("../root/SelectRootContext");
var _SelectPositionerContext = require("../positioner/SelectPositionerContext");
var _useRenderElement = require("../../internals/useRenderElement");
var _styles = require("../../utils/styles");
var _utils = require("../popup/utils");
var _store2 = require("../store");
/**
 * A container for the select items.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Select](https://base-ui.com/react/components/select)
 */
const SelectList = exports.SelectList = /*#__PURE__*/React.forwardRef(function SelectList(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    ...elementProps
  } = componentProps;
  const {
    store,
    scrollHandlerRef
  } = (0, _SelectRootContext.useSelectRootContext)();
  const {
    alignItemWithTriggerActive
  } = (0, _SelectPositionerContext.useSelectPositionerContext)();
  const hasScrollArrows = (0, _store.useStore)(store, _store2.selectors.hasScrollArrows);
  const openMethod = (0, _store.useStore)(store, _store2.selectors.openMethod);
  const multiple = (0, _store.useStore)(store, _store2.selectors.multiple);
  const id = (0, _store.useStore)(store, _store2.selectors.id);
  const defaultProps = {
    id: `${id}-list`,
    role: 'listbox',
    'aria-multiselectable': multiple || undefined,
    onScroll(event) {
      scrollHandlerRef.current?.(event.currentTarget);
    },
    ...(alignItemWithTriggerActive && {
      style: _utils.LIST_FUNCTIONAL_STYLES
    }),
    className: hasScrollArrows && openMethod !== 'touch' ? _styles.styleDisableScrollbar.className : undefined
  };
  const setListElement = (0, _useStableCallback.useStableCallback)(element => {
    store.set('listElement', element);
  });
  return (0, _useRenderElement.useRenderElement)('div', componentProps, {
    ref: [forwardedRef, setListElement],
    props: [defaultProps, elementProps]
  });
});
if (process.env.NODE_ENV !== "production") SelectList.displayName = "SelectList";