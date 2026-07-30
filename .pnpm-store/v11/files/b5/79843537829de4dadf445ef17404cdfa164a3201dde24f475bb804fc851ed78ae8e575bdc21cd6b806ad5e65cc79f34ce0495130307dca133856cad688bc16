import { createSelector } from '@base-ui/utils/store';
import { compareItemEquality } from "../internals/itemEquality.mjs";
import { hasNullItemLabel, stringifyAsValue } from "../internals/resolveValueLabel.mjs";
export const selectors = {
  id: createSelector(state => state.id),
  labelId: createSelector(state => state.labelId),
  modal: createSelector(state => state.modal),
  multiple: createSelector(state => state.multiple),
  items: createSelector(state => state.items),
  itemToStringLabel: createSelector(state => state.itemToStringLabel),
  itemToStringValue: createSelector(state => state.itemToStringValue),
  isItemEqualToValue: createSelector(state => state.isItemEqualToValue),
  value: createSelector(state => state.value),
  hasSelectedValue: createSelector(state => {
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
    return stringifyAsValue(value, itemToStringValue) !== '';
  }),
  hasNullItemLabel: createSelector((state, enabled) => {
    return enabled ? hasNullItemLabel(state.items) : false;
  }),
  open: createSelector(state => state.open),
  mounted: createSelector(state => state.mounted),
  forceMount: createSelector(state => state.forceMount),
  transitionStatus: createSelector(state => state.transitionStatus),
  openMethod: createSelector(state => state.openMethod),
  activeIndex: createSelector(state => state.activeIndex),
  selectedIndex: createSelector(state => state.selectedIndex),
  isActive: createSelector((state, index) => state.activeIndex === index),
  isSelected: createSelector((state, itemValue) => {
    const comparer = state.isItemEqualToValue;
    const storeValue = state.value;
    if (state.multiple) {
      return Array.isArray(storeValue) && storeValue.some(selectedItem => compareItemEquality(itemValue, selectedItem, comparer));
    }

    // The value is the source of truth: a stale `selectedIndex` (e.g. the controlled
    // value changes while the popup is open, where the index sync is deferred) must not
    // keep a previously selected item marked as selected.
    return compareItemEquality(itemValue, storeValue, comparer);
  }),
  isSelectedByFocus: createSelector((state, index) => {
    return state.selectedIndex === index;
  }),
  popupProps: createSelector(state => state.popupProps),
  triggerProps: createSelector(state => state.triggerProps),
  triggerElement: createSelector(state => state.triggerElement),
  positionerElement: createSelector(state => state.positionerElement),
  listElement: createSelector(state => state.listElement),
  popupSide: createSelector(state => state.popupSide),
  scrollUpArrowVisible: createSelector(state => state.scrollUpArrowVisible),
  scrollDownArrowVisible: createSelector(state => state.scrollDownArrowVisible),
  hasScrollArrows: createSelector(state => state.hasScrollArrows)
};