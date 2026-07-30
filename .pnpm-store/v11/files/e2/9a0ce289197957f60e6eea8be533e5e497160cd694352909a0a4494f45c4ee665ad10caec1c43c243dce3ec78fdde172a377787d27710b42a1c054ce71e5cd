import { createSelector } from '@base-ui/utils/store';
import { compareItemEquality } from "../internals/itemEquality.mjs";
import { hasNullItemLabel } from "../internals/resolveValueLabel.mjs";
export const selectors = {
  id: createSelector(state => state.id),
  labelId: createSelector(state => state.labelId),
  items: createSelector(state => state.items),
  selectedValue: createSelector(state => state.selectedValue),
  hasSelectionChips: createSelector(state => {
    const selectedValue = state.selectedValue;
    return Array.isArray(selectedValue) && selectedValue.length > 0;
  }),
  hasSelectedValue: createSelector(state => {
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
  hasNullItemLabel: createSelector((state, enabled) => {
    return enabled ? hasNullItemLabel(state.items) : false;
  }),
  open: createSelector(state => state.open),
  mounted: createSelector(state => state.mounted),
  forceMounted: createSelector(state => state.forceMounted),
  inline: createSelector(state => state.inline),
  activeIndex: createSelector(state => state.activeIndex),
  selectedIndex: createSelector(state => state.selectedIndex),
  isActive: createSelector((state, index) => state.activeIndex === index),
  isSelected: createSelector((state, itemValue) => {
    const comparer = state.isItemEqualToValue;
    const selectedValue = state.selectedValue;
    if (Array.isArray(selectedValue)) {
      return selectedValue.some(selectedItem => compareItemEquality(itemValue, selectedItem, comparer));
    }
    return compareItemEquality(itemValue, selectedValue, comparer);
  }),
  transitionStatus: createSelector(state => state.transitionStatus),
  popupProps: createSelector(state => state.popupProps),
  inputProps: createSelector(state => state.inputProps),
  triggerProps: createSelector(state => state.triggerProps),
  itemProps: createSelector(state => state.itemProps),
  positionerElement: createSelector(state => state.positionerElement),
  listElement: createSelector(state => state.listElement),
  popupId: createSelector(state => state.popupId),
  triggerElement: createSelector(state => state.triggerElement),
  inputElement: createSelector(state => state.inputElement),
  inputGroupElement: createSelector(state => state.inputGroupElement),
  popupSide: createSelector(state => state.popupSide),
  openMethod: createSelector(state => state.openMethod),
  inputInsidePopup: createSelector(state => state.inputInsidePopup),
  inputOwnsFormValue: createSelector(state => state.inputOwnsFormValue),
  selectionMode: createSelector(state => state.selectionMode),
  name: createSelector(state => state.name),
  form: createSelector(state => state.form),
  disabled: createSelector(state => state.disabled),
  readOnly: createSelector(state => state.readOnly),
  required: createSelector(state => state.required),
  grid: createSelector(state => state.grid),
  virtualized: createSelector(state => state.virtualized),
  itemToStringLabel: createSelector(state => state.itemToStringLabel),
  isItemEqualToValue: createSelector(state => state.isItemEqualToValue),
  modal: createSelector(state => state.modal),
  autoHighlight: createSelector(state => state.autoHighlight),
  submitOnItemClick: createSelector(state => state.submitOnItemClick)
};