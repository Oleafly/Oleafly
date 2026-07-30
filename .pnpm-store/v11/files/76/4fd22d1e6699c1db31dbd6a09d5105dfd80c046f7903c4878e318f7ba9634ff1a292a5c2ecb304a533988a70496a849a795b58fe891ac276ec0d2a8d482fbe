"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.selectors = void 0;
var _store = require("@base-ui/utils/store");
var _itemEquality = require("../internals/itemEquality");
var _resolveValueLabel = require("../internals/resolveValueLabel");
const selectors = exports.selectors = {
  id: (0, _store.createSelector)(state => state.id),
  labelId: (0, _store.createSelector)(state => state.labelId),
  modal: (0, _store.createSelector)(state => state.modal),
  multiple: (0, _store.createSelector)(state => state.multiple),
  items: (0, _store.createSelector)(state => state.items),
  itemToStringLabel: (0, _store.createSelector)(state => state.itemToStringLabel),
  itemToStringValue: (0, _store.createSelector)(state => state.itemToStringValue),
  isItemEqualToValue: (0, _store.createSelector)(state => state.isItemEqualToValue),
  value: (0, _store.createSelector)(state => state.value),
  hasSelectedValue: (0, _store.createSelector)(state => {
    const {
      value,
      multiple,
      itemToStringValue
    } = state;
    if (value == null) {
      return false;
    }
    if (multiple && Array.isArray(value)) {
      return value.length > 0;
    }
    return (0, _resolveValueLabel.stringifyAsValue)(value, itemToStringValue) !== '';
  }),
  hasNullItemLabel: (0, _store.createSelector)((state, enabled) => {
    return enabled ? (0, _resolveValueLabel.hasNullItemLabel)(state.items) : false;
  }),
  open: (0, _store.createSelector)(state => state.open),
  mounted: (0, _store.createSelector)(state => state.mounted),
  forceMount: (0, _store.createSelector)(state => state.forceMount),
  transitionStatus: (0, _store.createSelector)(state => state.transitionStatus),
  openMethod: (0, _store.createSelector)(state => state.openMethod),
  activeIndex: (0, _store.createSelector)(state => state.activeIndex),
  selectedIndex: (0, _store.createSelector)(state => state.selectedIndex),
  isActive: (0, _store.createSelector)((state, index) => state.activeIndex === index),
  isSelected: (0, _store.createSelector)((state, itemValue) => {
    const comparer = state.isItemEqualToValue;
    const storeValue = state.value;
    if (state.multiple) {
      return Array.isArray(storeValue) && storeValue.some(selectedItem => (0, _itemEquality.compareItemEquality)(itemValue, selectedItem, comparer));
    }

    // The value is the source of truth: a stale `selectedIndex` (e.g. the controlled
    // value changes while the popup is open, where the index sync is deferred) must not
    // keep a previously selected item marked as selected.
    return (0, _itemEquality.compareItemEquality)(itemValue, storeValue, comparer);
  }),
  isSelectedByFocus: (0, _store.createSelector)((state, index) => {
    return state.selectedIndex === index;
  }),
  popupProps: (0, _store.createSelector)(state => state.popupProps),
  triggerProps: (0, _store.createSelector)(state => state.triggerProps),
  triggerElement: (0, _store.createSelector)(state => state.triggerElement),
  positionerElement: (0, _store.createSelector)(state => state.positionerElement),
  listElement: (0, _store.createSelector)(state => state.listElement),
  popupSide: (0, _store.createSelector)(state => state.popupSide),
  scrollUpArrowVisible: (0, _store.createSelector)(state => state.scrollUpArrowVisible),
  scrollDownArrowVisible: (0, _store.createSelector)(state => state.scrollDownArrowVisible),
  hasScrollArrows: (0, _store.createSelector)(state => state.hasScrollArrows)
};