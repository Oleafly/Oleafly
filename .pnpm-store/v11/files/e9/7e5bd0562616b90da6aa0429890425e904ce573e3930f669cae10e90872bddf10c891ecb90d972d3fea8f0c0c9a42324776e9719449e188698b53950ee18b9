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
  items: (0, _store.createSelector)(state => state.items),
  selectedValue: (0, _store.createSelector)(state => state.selectedValue),
  hasSelectionChips: (0, _store.createSelector)(state => {
    const selectedValue = state.selectedValue;
    return Array.isArray(selectedValue) && selectedValue.length > 0;
  }),
  hasSelectedValue: (0, _store.createSelector)(state => {
    const {
      selectedValue,
      selectionMode
    } = state;
    if (selectedValue == null) {
      return false;
    }
    if (selectionMode === 'multiple' && Array.isArray(selectedValue)) {
      return selectedValue.length > 0;
    }
    return true;
  }),
  hasNullItemLabel: (0, _store.createSelector)((state, enabled) => {
    return enabled ? (0, _resolveValueLabel.hasNullItemLabel)(state.items) : false;
  }),
  open: (0, _store.createSelector)(state => state.open),
  mounted: (0, _store.createSelector)(state => state.mounted),
  forceMounted: (0, _store.createSelector)(state => state.forceMounted),
  inline: (0, _store.createSelector)(state => state.inline),
  activeIndex: (0, _store.createSelector)(state => state.activeIndex),
  selectedIndex: (0, _store.createSelector)(state => state.selectedIndex),
  isActive: (0, _store.createSelector)((state, index) => state.activeIndex === index),
  isSelected: (0, _store.createSelector)((state, itemValue) => {
    const comparer = state.isItemEqualToValue;
    const selectedValue = state.selectedValue;
    if (Array.isArray(selectedValue)) {
      return selectedValue.some(selectedItem => (0, _itemEquality.compareItemEquality)(itemValue, selectedItem, comparer));
    }
    return (0, _itemEquality.compareItemEquality)(itemValue, selectedValue, comparer);
  }),
  transitionStatus: (0, _store.createSelector)(state => state.transitionStatus),
  popupProps: (0, _store.createSelector)(state => state.popupProps),
  inputProps: (0, _store.createSelector)(state => state.inputProps),
  triggerProps: (0, _store.createSelector)(state => state.triggerProps),
  itemProps: (0, _store.createSelector)(state => state.itemProps),
  positionerElement: (0, _store.createSelector)(state => state.positionerElement),
  listElement: (0, _store.createSelector)(state => state.listElement),
  popupId: (0, _store.createSelector)(state => state.popupId),
  triggerElement: (0, _store.createSelector)(state => state.triggerElement),
  inputElement: (0, _store.createSelector)(state => state.inputElement),
  inputGroupElement: (0, _store.createSelector)(state => state.inputGroupElement),
  popupSide: (0, _store.createSelector)(state => state.popupSide),
  openMethod: (0, _store.createSelector)(state => state.openMethod),
  inputInsidePopup: (0, _store.createSelector)(state => state.inputInsidePopup),
  inputOwnsFormValue: (0, _store.createSelector)(state => state.inputOwnsFormValue),
  selectionMode: (0, _store.createSelector)(state => state.selectionMode),
  name: (0, _store.createSelector)(state => state.name),
  form: (0, _store.createSelector)(state => state.form),
  disabled: (0, _store.createSelector)(state => state.disabled),
  readOnly: (0, _store.createSelector)(state => state.readOnly),
  required: (0, _store.createSelector)(state => state.required),
  grid: (0, _store.createSelector)(state => state.grid),
  virtualized: (0, _store.createSelector)(state => state.virtualized),
  itemToStringLabel: (0, _store.createSelector)(state => state.itemToStringLabel),
  isItemEqualToValue: (0, _store.createSelector)(state => state.isItemEqualToValue),
  modal: (0, _store.createSelector)(state => state.modal),
  autoHighlight: (0, _store.createSelector)(state => state.autoHighlight),
  submitOnItemClick: (0, _store.createSelector)(state => state.submitOnItemClick)
};