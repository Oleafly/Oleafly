"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ComboboxChipRemove = void 0;
var React = _interopRequireWildcard(require("react"));
var _store = require("@base-ui/utils/store");
var _useRenderElement = require("../../internals/useRenderElement");
var _ComboboxRootContext = require("../root/ComboboxRootContext");
var _ComboboxChipContext = require("../chip/ComboboxChipContext");
var _useButton = require("../../internals/use-button");
var _utils = require("../../floating-ui-react/utils");
var _store2 = require("../store");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
var _itemEquality = require("../../internals/itemEquality");
/**
 * A button to remove a chip.
 * Renders a `<button>` element.
 *
 * Documentation: [Base UI Combobox](https://base-ui.com/react/components/combobox)
 */
const ComboboxChipRemove = exports.ComboboxChipRemove = /*#__PURE__*/React.forwardRef(function ComboboxChipRemove(componentProps, forwardedRef) {
  const {
    render,
    className,
    disabled: disabledProp = false,
    nativeButton = true,
    style,
    ...elementProps
  } = componentProps;
  const store = (0, _ComboboxRootContext.useComboboxRootContext)();
  const {
    index
  } = (0, _ComboboxChipContext.useComboboxChipContext)();
  const comboboxDisabled = (0, _store.useStore)(store, _store2.selectors.disabled);
  const readOnly = (0, _store.useStore)(store, _store2.selectors.readOnly);
  const selectedValue = (0, _store.useStore)(store, _store2.selectors.selectedValue);
  const isItemEqualToValue = (0, _store.useStore)(store, _store2.selectors.isItemEqualToValue);
  const disabled = comboboxDisabled || disabledProp;
  const {
    buttonRef,
    getButtonProps
  } = (0, _useButton.useButton)({
    native: nativeButton,
    disabled: disabled || readOnly,
    focusableWhenDisabled: true
  });
  const state = {
    disabled
  };
  function clearActiveIndexForRemovedItem(removedItem) {
    const activeIndex = store.state.activeIndex;
    if (activeIndex == null) {
      return;
    }

    // Try current visible list first; if not found, it's filtered out.
    // No need to clear highlight in that case since it can't equal activeIndex.
    const removedIndex = (0, _itemEquality.findItemIndex)(store.state.valuesRef.current, removedItem, isItemEqualToValue);
    if (removedIndex !== -1 && activeIndex === removedIndex) {
      store.state.setIndices({
        activeIndex: null,
        type: store.state.keyboardActiveRef.current ? 'keyboard' : 'pointer'
      });
    }
  }
  function removeChip(event) {
    const eventDetails = (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.chipRemovePress, event.nativeEvent);
    const removedItem = selectedValue[index];
    clearActiveIndexForRemovedItem(removedItem);
    store.state.setSelectedValue(selectedValue.filter((_, i) => i !== index), eventDetails);
    store.state.inputRef.current?.focus();
    return eventDetails;
  }
  const element = (0, _useRenderElement.useRenderElement)('button', componentProps, {
    ref: [forwardedRef, buttonRef],
    state,
    props: [{
      tabIndex: -1,
      onMouseDown(event) {
        event.preventDefault();
      },
      onClick(event) {
        if (disabled || readOnly) {
          return;
        }
        const eventDetails = removeChip(event);
        if (!eventDetails.isPropagationAllowed) {
          event.stopPropagation();
        }
      },
      onKeyDown(event) {
        if (disabled || readOnly) {
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          const eventDetails = removeChip(event);
          if (!eventDetails.isPropagationAllowed) {
            (0, _utils.stopEvent)(event);
          }
        }
      }
    }, elementProps, getButtonProps]
  });
  return element;
});
if (process.env.NODE_ENV !== "production") ComboboxChipRemove.displayName = "ComboboxChipRemove";