"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MenuRadioItem = void 0;
var React = _interopRequireWildcard(require("react"));
var _MenuRootContext = require("../root/MenuRootContext");
var _useRenderElement = require("../../internals/useRenderElement");
var _useBaseUiId = require("../../internals/useBaseUiId");
var _MenuRadioGroupContext = require("../radio-group/MenuRadioGroupContext");
var _MenuRadioItemContext = require("./MenuRadioItemContext");
var _stateAttributesMapping = require("../utils/stateAttributesMapping");
var _useCompositeListItem = require("../../internals/composite/list/useCompositeListItem");
var _useMenuItem = require("../item/useMenuItem");
var _MenuPositionerContext = require("../positioner/MenuPositionerContext");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * A menu item that works like a radio button in a given group.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Menu](https://base-ui.com/react/components/menu)
 */
const MenuRadioItem = exports.MenuRadioItem = /*#__PURE__*/React.forwardRef(function MenuRadioItem(componentProps, forwardedRef) {
  const {
    render,
    className,
    id: idProp,
    label,
    nativeButton = false,
    disabled: disabledProp = false,
    closeOnClick = false,
    value,
    style,
    ...elementProps
  } = componentProps;
  const listItem = (0, _useCompositeListItem.useCompositeListItem)({
    label
  });
  const menuPositionerContext = (0, _MenuPositionerContext.useMenuPositionerContext)(true);
  const id = (0, _useBaseUiId.useBaseUiId)(idProp);
  const {
    store
  } = (0, _MenuRootContext.useMenuRootContext)();
  const highlighted = store.useState('isActive', listItem.index);
  const itemProps = store.useState('itemProps');
  const {
    value: selectedValue,
    setValue: setSelectedValue,
    disabled: groupDisabled
  } = (0, _MenuRadioGroupContext.useMenuRadioGroupContext)();
  const disabled = groupDisabled || disabledProp;
  const checked = selectedValue === value;
  const {
    getItemProps,
    itemRef
  } = (0, _useMenuItem.useMenuItem)({
    closeOnClick,
    disabled,
    highlighted,
    id,
    store,
    nativeButton,
    nodeId: menuPositionerContext?.context.nodeId,
    itemMetadata: _useMenuItem.REGULAR_ITEM
  });
  const state = React.useMemo(() => ({
    disabled,
    highlighted,
    checked
  }), [disabled, highlighted, checked]);
  function handleClick(event) {
    const details = (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.itemPress, event.nativeEvent, undefined, {
      preventUnmountOnClose() {}
    });
    setSelectedValue(value, details);
  }
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    state,
    stateAttributesMapping: _stateAttributesMapping.itemMapping,
    props: [itemProps, {
      role: 'menuitemradio',
      'aria-checked': checked,
      onClick: handleClick
    }, elementProps, getItemProps],
    ref: [itemRef, forwardedRef, listItem.ref]
  });
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_MenuRadioItemContext.MenuRadioItemContext.Provider, {
    value: state,
    children: element
  });
});
if (process.env.NODE_ENV !== "production") MenuRadioItem.displayName = "MenuRadioItem";