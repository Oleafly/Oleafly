'use client';

import * as React from 'react';
import { useControlled } from '@base-ui/utils/useControlled';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { useOnFirstRender } from '@base-ui/utils/useOnFirstRender';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { useMergedRefs } from '@base-ui/utils/useMergedRefs';
import { useValueAsRef } from '@base-ui/utils/useValueAsRef';
import { visuallyHidden, visuallyHiddenInput } from '@base-ui/utils/visuallyHidden';
import { useRefWithInit } from '@base-ui/utils/useRefWithInit';
import { Store, useStore } from '@base-ui/utils/store';
import { EMPTY_ARRAY, EMPTY_OBJECT } from '@base-ui/utils/empty';
import { useDismiss, useFloatingRootContext, useListNavigation, useClick } from "../../floating-ui-react/index.mjs";
import { gridNavigation } from "../../floating-ui-react/hooks/gridNavigation.mjs";
import { contains, getTarget } from "../../floating-ui-react/utils.mjs";
import { createChangeEventDetails, createGenericEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { ComboboxFloatingContext, ComboboxDerivedItemsContext, ComboboxHasItemsContext, ComboboxRootContext, ComboboxInputValueContext } from "./ComboboxRootContext.mjs";
import { selectors } from "../store.mjs";
import { useOpenChangeComplete } from "../../internals/useOpenChangeComplete.mjs";
import { useFieldRootContext } from "../../internals/field-root-context/FieldRootContext.mjs";
import { useRegisterFieldControl } from "../../internals/field-register-control/useRegisterFieldControl.mjs";
import { useFormContext } from "../../internals/form-context/FormContext.mjs";
import { useLabelableId } from "../../internals/labelable-provider/useLabelableId.mjs";
import { createCollatorItemFilter, createSingleSelectionCollatorFilter } from "./utils/index.mjs";
import { useCoreFilter } from "./utils/useFilter.mjs";
import { useTransitionStatus } from "../../internals/useTransitionStatus.mjs";
import { useOpenInteractionType } from "../../utils/useOpenInteractionType.mjs";
import { useValueChanged } from "../../internals/useValueChanged.mjs";
import { NOOP } from "../../internals/noop.mjs";
import { FOCUSABLE_POPUP_PROPS } from "../../utils/popups/index.mjs";
import { mergeProps } from "../../merge-props/index.mjs";
import { stringifyAsLabel, stringifyAsValue, isGroupedItems } from "../../internals/resolveValueLabel.mjs";
import { compareItemEquality, defaultItemEquality, findItemIndex, removeItem, selectedValueIncludes } from "../../internals/itemEquality.mjs";
import { areArraysEqual } from "../../internals/areArraysEqual.mjs";
import { INITIAL_LAST_HIGHLIGHT, NO_ACTIVE_VALUE } from "./utils/constants.mjs";
import { useDirection } from "../../internals/direction-context/DirectionContext.mjs";

/**
 * @internal
 */
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function AriaCombobox(props) {
  const {
    id: idProp,
    onOpenChangeComplete: onOpenChangeCompleteProp,
    defaultSelectedValue = null,
    selectedValue: selectedValueProp,
    onSelectedValueChange,
    defaultInputValue: defaultInputValueProp,
    inputValue: inputValueProp,
    open: openProp,
    defaultOpen = false,
    selectionMode = 'none',
    onItemHighlighted: onItemHighlightedProp,
    name: nameProp,
    form,
    disabled: disabledProp = false,
    readOnly = false,
    required = false,
    inputRef: inputRefProp,
    grid = false,
    items,
    filteredItems: filteredItemsProp,
    filter: filterProp,
    openOnInputClick = true,
    autoHighlight = false,
    keepHighlight = false,
    highlightItemOnHover = true,
    loopFocus = true,
    itemToStringLabel,
    itemToStringValue,
    isItemEqualToValue = defaultItemEquality,
    virtualized = false,
    inline: inlineProp = false,
    fillInputOnItemPress = true,
    modal = false,
    limit = -1,
    autoComplete = 'list',
    formAutoComplete,
    locale,
    submitOnItemClick = false
  } = props;
  const {
    clearErrors
  } = useFormContext();
  const {
    setDirty,
    validityData,
    setFilled,
    name: fieldName,
    disabled: fieldDisabled,
    setTouched,
    setFocused,
    validationMode,
    validation
  } = useFieldRootContext();
  const direction = useDirection();
  const id = useLabelableId({
    id: idProp
  });
  const collatorFilter = useCoreFilter({
    locale
  });
  const [queryChangedAfterOpen, setQueryChangedAfterOpen] = React.useState(false);
  const [closeQuery, setCloseQuery] = React.useState(null);
  const listRef = React.useRef([]);
  const labelsRef = React.useRef([]);
  const popupRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const startDismissRef = React.useRef(null);
  const endDismissRef = React.useRef(null);
  const emptyRef = React.useRef(null);
  const keyboardActiveRef = React.useRef(true);
  const hadInputClearRef = React.useRef(false);
  const chipsContainerRef = React.useRef(null);
  const clearRef = React.useRef(null);
  const selectionEventRef = React.useRef(null);
  const lastHighlightRef = React.useRef(INITIAL_LAST_HIGHLIGHT);
  const pendingQueryHighlightRef = React.useRef(null);

  /**
   * Contains the currently visible list of item values post-filtering.
   */
  const valuesRef = React.useRef([]);
  /**
   * Contains all item values in a stable, unfiltered order.
   * This is only used when `items` prop is not provided.
   * It accumulates values on first mount and does not remove them on unmount due to
   * filtering, providing a stable index for selected value tracking.
   */
  const allValuesRef = React.useRef([]);
  const disabled = fieldDisabled || disabledProp;
  const name = fieldName ?? nameProp;
  const multiple = selectionMode === 'multiple';
  const single = selectionMode === 'single';
  const hasInputValue = inputValueProp !== undefined || defaultInputValueProp !== undefined;
  const hasItems = items !== undefined;
  const hasFilteredItemsProp = filteredItemsProp !== undefined;
  let autoHighlightMode;
  if (autoHighlight === 'always') {
    autoHighlightMode = 'always';
  } else {
    autoHighlightMode = autoHighlight ? 'input-change' : false;
  }
  const [selectedValue, setSelectedValueUnwrapped] = useControlled({
    controlled: selectedValueProp,
    default: multiple ? defaultSelectedValue ?? EMPTY_ARRAY : defaultSelectedValue,
    name: 'Combobox',
    state: 'selectedValue'
  });
  const filter = React.useMemo(() => {
    if (filterProp === null) {
      return () => true;
    }
    if (filterProp !== undefined) {
      return filterProp;
    }
    if (single && !queryChangedAfterOpen) {
      return createSingleSelectionCollatorFilter(collatorFilter, itemToStringLabel, selectedValue);
    }
    return createCollatorItemFilter(collatorFilter, itemToStringLabel);
  }, [filterProp, single, selectedValue, queryChangedAfterOpen, collatorFilter, itemToStringLabel]);

  // If neither inputValue nor defaultInputValue are provided, derive it from the
  // selected value for single mode so the input reflects the selection on mount.
  const initialDefaultInputValue = useRefWithInit(() => {
    if (hasInputValue) {
      return defaultInputValueProp ?? '';
    }
    if (single) {
      return stringifyAsLabel(selectedValue, itemToStringLabel);
    }
    return '';
  }).current;
  const [inputValue, setInputValueUnwrapped] = useControlled({
    controlled: inputValueProp,
    default: initialDefaultInputValue,
    name: 'Combobox',
    state: 'inputValue'
  });
  const [open, setOpenUnwrapped] = useControlled({
    controlled: openProp,
    default: defaultOpen,
    name: 'Combobox',
    state: 'open'
  });
  const isGrouped = isGroupedItems(items);
  const query = closeQuery ?? (inputValue === '' ? '' : String(inputValue).trim());
  const selectedLabelString = single ? stringifyAsLabel(selectedValue, itemToStringLabel) : '';
  const shouldBypassFiltering = single && !queryChangedAfterOpen && query !== '' && selectedLabelString !== '' && selectedLabelString.length === query.length && collatorFilter.contains(selectedLabelString, query);
  const filterQuery = shouldBypassFiltering ? '' : query;
  const shouldIgnoreExternalFiltering = hasItems && hasFilteredItemsProp && shouldBypassFiltering;
  const flatItems = React.useMemo(() => {
    if (!items) {
      return EMPTY_ARRAY;
    }
    if (isGrouped) {
      return items.flatMap(group => group.items);
    }
    return items;
  }, [items, isGrouped]);
  const filteredItems = React.useMemo(() => {
    if (filteredItemsProp && !shouldIgnoreExternalFiltering) {
      return filteredItemsProp;
    }
    if (!items) {
      return EMPTY_ARRAY;
    }
    if (isGrouped) {
      const groupedItems = items;
      const resultingGroups = [];
      let currentCount = 0;
      for (const group of groupedItems) {
        if (limit > -1 && currentCount >= limit) {
          break;
        }
        const candidateItems = filterQuery === '' ? group.items : group.items.filter(item => filter(item, filterQuery, itemToStringLabel));
        if (candidateItems.length === 0) {
          continue;
        }
        const remainingLimit = limit > -1 ? limit - currentCount : Infinity;
        const itemsToTake = candidateItems.slice(0, remainingLimit);
        if (itemsToTake.length > 0) {
          const newGroup = {
            ...group,
            items: itemsToTake
          };
          resultingGroups.push(newGroup);
          currentCount += itemsToTake.length;
        }
      }
      return resultingGroups;
    }
    if (filterQuery === '') {
      return limit > -1 ? flatItems.slice(0, limit) :
      // The cast here is done as `flatItems` is readonly.
      // valuesRef.current, a mutable ref, can be set to `flatFilteredItems`, which may
      // reference this exact readonly value, creating a mutation risk.
      // However, <Combobox.Item> can never mutate this value as the mutating effect
      // bails early when `items` is provided, and this is only ever returned
      // when `items` is provided due to the early return at the top of this hook.
      flatItems;
    }
    const limitedItems = [];
    for (const item of flatItems) {
      if (limit > -1 && limitedItems.length >= limit) {
        break;
      }
      if (filter(item, filterQuery, itemToStringLabel)) {
        limitedItems.push(item);
      }
    }
    return limitedItems;
  }, [filteredItemsProp, shouldIgnoreExternalFiltering, items, isGrouped, filterQuery, limit, filter, itemToStringLabel, flatItems]);
  const flatFilteredItems = React.useMemo(() => {
    if (isGrouped) {
      const groups = filteredItems;
      return groups.flatMap(g => g.items);
    }
    return filteredItems;
  }, [filteredItems, isGrouped]);
  const store = useRefWithInit(() => new Store({
    id,
    labelId: undefined,
    selectedValue,
    open,
    filter,
    query,
    items,
    selectionMode,
    listRef,
    labelsRef,
    popupRef,
    emptyRef,
    inputRef,
    startDismissRef,
    endDismissRef,
    keyboardActiveRef,
    chipsContainerRef,
    clearRef,
    valuesRef,
    allValuesRef,
    selectionEventRef,
    name,
    form,
    disabled,
    readOnly,
    required,
    grid,
    isGrouped,
    virtualized,
    openOnInputClick,
    itemToStringLabel,
    isItemEqualToValue,
    modal,
    autoHighlight: autoHighlightMode,
    submitOnItemClick,
    hasInputValue,
    mounted: false,
    forceMounted: false,
    transitionStatus: 'idle',
    inline: inlineProp,
    activeIndex: null,
    selectedIndex: null,
    popupProps: {},
    inputProps: {},
    triggerProps: {},
    itemProps: EMPTY_OBJECT,
    positionerElement: null,
    listElement: null,
    popupId: undefined,
    triggerElement: null,
    inputElement: null,
    inputGroupElement: null,
    popupSide: null,
    openMethod: null,
    inputInsidePopup: true,
    // Avoid duplicate names in the server HTML. Popup inputs aren't rendered
    // until after hydration, so the hidden input takes over then if needed.
    inputOwnsFormValue: selectionMode === 'none',
    onOpenChangeComplete: onOpenChangeCompleteProp || NOOP,
    // Placeholder callbacks replaced on first render
    setOpen: NOOP,
    setInputValue: NOOP,
    setSelectedValue: NOOP,
    setIndices: NOOP,
    onItemHighlighted: NOOP,
    handleSelection: NOOP,
    forceMount: NOOP,
    requestSubmit: NOOP
  })).current;
  const fieldRawValue = selectionMode === 'none' ? inputValue : selectedValue;
  const fieldStringValue = React.useMemo(() => {
    if (selectionMode === 'none') {
      return fieldRawValue;
    }
    if (Array.isArray(selectedValue)) {
      return selectedValue.map(value => stringifyAsValue(value, itemToStringValue));
    }
    return stringifyAsValue(selectedValue, itemToStringValue);
  }, [fieldRawValue, itemToStringValue, selectionMode, selectedValue]);
  const onItemHighlighted = useStableCallback(onItemHighlightedProp);
  const onOpenChangeComplete = useStableCallback(onOpenChangeCompleteProp);
  const activeIndex = useStore(store, selectors.activeIndex);
  const selectedIndex = useStore(store, selectors.selectedIndex);
  const positionerElement = useStore(store, selectors.positionerElement);
  const listElement = useStore(store, selectors.listElement);
  const triggerElement = useStore(store, selectors.triggerElement);
  const inputElement = useStore(store, selectors.inputElement);
  const inputGroupElement = useStore(store, selectors.inputGroupElement);
  const inline = useStore(store, selectors.inline);
  const inputInsidePopup = useStore(store, selectors.inputInsidePopup);
  const inputOwnsFormValue = useStore(store, selectors.inputOwnsFormValue);
  const triggerRef = useValueAsRef(triggerElement);
  const {
    mounted,
    setMounted,
    transitionStatus
  } = useTransitionStatus(open);
  const {
    openMethod,
    triggerProps
  } = useOpenInteractionType(open);
  const getStringifiedValueForForm = useStableCallback(() => fieldStringValue);
  useRegisterFieldControl(inputInsidePopup ? triggerRef : inputRef, id, fieldRawValue, getStringifiedValueForForm, !disabled, nameProp);
  const forceMount = useStableCallback(() => {
    if (items) {
      // Ensure typeahead works on a closed list.
      labelsRef.current = flatFilteredItems.map(item => stringifyAsLabel(item, itemToStringLabel));
    } else {
      store.set('forceMounted', true);
    }
  });
  const initialSelectedValueRef = React.useRef(selectedValue);
  useIsoLayoutEffect(() => {
    // Ensure the values and labels are registered for programmatic value changes.
    if (selectedValue !== initialSelectedValueRef.current) {
      forceMount();
    }
  }, [forceMount, selectedValue]);
  const setIndices = useStableCallback(options => {
    store.update(options);
    const type = options.type || 'none';
    if (options.activeIndex === undefined) {
      return;
    }
    if (options.activeIndex === null) {
      if (lastHighlightRef.current !== INITIAL_LAST_HIGHLIGHT) {
        lastHighlightRef.current = INITIAL_LAST_HIGHLIGHT;
        onItemHighlighted(undefined, createGenericEventDetails(type, undefined, {
          index: -1
        }));
      }
    } else {
      const activeValue = valuesRef.current[options.activeIndex];
      lastHighlightRef.current = {
        value: activeValue,
        index: options.activeIndex
      };
      onItemHighlighted(activeValue, createGenericEventDetails(type, undefined, {
        index: options.activeIndex
      }));
    }
  });
  const setInputValue = useStableCallback((next, eventDetails) => {
    hadInputClearRef.current = eventDetails.reason === REASONS.inputClear;
    props.onInputValueChange?.(next, eventDetails);
    if (eventDetails.isCanceled) {
      return;
    }

    // If user is typing, ensure we don't auto-highlight on open due to a race
    // with the post-open effect that sets this flag.
    if (eventDetails.reason === REASONS.inputChange) {
      const event = eventDetails.event;
      const inputType = event.inputType;
      // Treat composition commits as typed input; autofill may omit `inputType` or
      // report `insertReplacementText`.
      const isTypedInput = event.type === 'compositionend' || inputType != null && inputType !== '' && inputType !== 'insertReplacementText';
      if (isTypedInput) {
        const hasQuery = next.trim() !== '';
        if (hasQuery) {
          setQueryChangedAfterOpen(true);
        }
        // Defer index updates until after the filtered items have been derived to ensure
        // `onItemHighlighted` receives the latest item.
        pendingQueryHighlightRef.current = {
          hasQuery
        };
        if (hasQuery && autoHighlightMode && store.state.activeIndex == null) {
          store.set('activeIndex', 0);
        }
      }
    }
    setInputValueUnwrapped(next);
  });
  const setOpen = useStableCallback((nextOpen, eventDetails) => {
    if (open === nextOpen) {
      return;
    }

    // If the `Empty` component is not used, the positioner or popup should be hidden
    // with CSS. In this case, allow the Escape key to bubble to close a parent popup
    // if there are no items to show.
    if (eventDetails.reason === 'escape-key' && hasItems && flatFilteredItems.length === 0 && !store.state.emptyRef.current) {
      eventDetails.allowPropagation();
    }
    props.onOpenChange?.(nextOpen, eventDetails);
    if (eventDetails.isCanceled) {
      return;
    }

    // If reopening interrupts the close animation, handleUnmount won't run to clear the
    // frozen closeQuery and pending popup input.
    if (nextOpen && multiple && inputInsidePopup && !inline && closeQuery !== null) {
      setQueryChangedAfterOpen(false);
      setCloseQuery(null);
      if (inputValue !== '') {
        setInputValue('', createChangeEventDetails(REASONS.inputClear, eventDetails.event));
      }
    }
    if (!nextOpen && queryChangedAfterOpen) {
      if (single) {
        if (!inline) {
          setCloseQuery(query);
        }
        // Avoid a flicker when closing the popup with an empty query.
        if (query === '') {
          setQueryChangedAfterOpen(false);
        }
      } else if (multiple) {
        if (!inline) {
          // Freeze the current query so filtering remains stable while exiting.
          setCloseQuery(query);
        }
        if (inputInsidePopup) {
          setIndices({
            activeIndex: null
          });
        }

        // Clear the input immediately on close while retaining filtering via closeQuery for exit animations
        // if the input is outside the popup. When the input is inside the popup, defer the clear until
        // unmount so the filtered list doesn't flash to unfiltered during the exit animation.
        if (!inputInsidePopup || inline) {
          setInputValue('', createChangeEventDetails(REASONS.inputClear, eventDetails.event));
        }
      }
    }
    setOpenUnwrapped(nextOpen);
    if (!nextOpen && inputInsidePopup && (eventDetails.reason === REASONS.focusOut || eventDetails.reason === REASONS.outsidePress)) {
      setTouched(true);
      setFocused(false);
      if (validationMode === 'onBlur') {
        const valueToValidate = selectionMode === 'none' ? inputValue : selectedValue;
        validation.commit(valueToValidate);
      }
    }
  });
  const setSelectedValue = useStableCallback((nextValue, eventDetails) => {
    // Cast to `any` due to conditional value type (single vs. multiple).
    // The runtime implementation already ensures the correct value shape.
    onSelectedValueChange?.(nextValue, eventDetails);
    if (eventDetails.isCanceled) {
      return;
    }
    setSelectedValueUnwrapped(nextValue);
    const shouldFillInput = selectionMode === 'none' && popupRef.current && fillInputOnItemPress || single && !store.state.inputInsidePopup;
    if (shouldFillInput) {
      setInputValue(stringifyAsLabel(nextValue, itemToStringLabel), createChangeEventDetails(eventDetails.reason, eventDetails.event));
    }
    if (single && nextValue != null && eventDetails.reason !== REASONS.inputChange && queryChangedAfterOpen && !inline) {
      setCloseQuery(query);
    }
  });
  const handleSelection = useStableCallback((event, passedValue) => {
    let itemValue = passedValue;
    if (itemValue === undefined) {
      if (activeIndex === null) {
        return;
      }
      itemValue = valuesRef.current[activeIndex];
    }
    const targetEl = getTarget(event);
    const overrideEvent = selectionEventRef.current ?? event;
    selectionEventRef.current = null;
    const eventDetails = createChangeEventDetails(REASONS.itemPress, overrideEvent);

    // Let the link handle the click.
    const href = targetEl?.closest('a')?.getAttribute('href');
    if (href) {
      if (href.startsWith('#')) {
        setOpen(false, eventDetails);
      }
      return;
    }
    if (multiple) {
      const currentSelectedValue = Array.isArray(selectedValue) ? selectedValue : [];
      const isCurrentlySelected = selectedValueIncludes(currentSelectedValue, itemValue, store.state.isItemEqualToValue);
      const nextValue = isCurrentlySelected ? removeItem(currentSelectedValue, itemValue, store.state.isItemEqualToValue) : [...currentSelectedValue, itemValue];
      setSelectedValue(nextValue, eventDetails);
      if (eventDetails.isCanceled) {
        return;
      }
      const wasFiltering = inputRef.current ? inputRef.current.value.trim() !== '' : false;
      if (!wasFiltering) {
        return;
      }
      if (store.state.inputInsidePopup) {
        setInputValue('', createChangeEventDetails(REASONS.inputClear, eventDetails.event));
      } else {
        setOpen(false, eventDetails);
      }
    } else {
      setSelectedValue(itemValue, eventDetails);
      if (eventDetails.isCanceled) {
        return;
      }
      setOpen(false, eventDetails);
    }
  });
  const requestSubmit = useStableCallback(() => {
    if (!store.state.submitOnItemClick) {
      return;
    }
    const formElement = validation.inputRef.current?.form ?? store.state.inputElement?.form;
    if (formElement && typeof formElement.requestSubmit === 'function') {
      formElement.requestSubmit();
    }
  });
  const handleUnmount = useStableCallback(() => {
    setMounted(false);
    onOpenChangeComplete?.(false);
    setQueryChangedAfterOpen(false);
    setCloseQuery(null);
    if (selectionMode === 'none') {
      setIndices({
        activeIndex: null,
        selectedIndex: null
      });
    } else {
      setIndices({
        activeIndex: null
      });
    }

    // Multiple selection mode:
    // If the user typed a filter and didn't select in multiple mode, clear the input
    // after close completes to avoid mid-exit flicker and start fresh on next open.
    if (multiple && inputRef.current && inputRef.current.value !== '' && !hadInputClearRef.current) {
      setInputValue('', createChangeEventDetails(REASONS.inputClear));
    }

    // Single selection mode:
    // - If input is rendered inside the popup, clear it so the next open is blank
    // - If input is outside the popup, sync it to the selected value
    if (single) {
      if (store.state.inputInsidePopup) {
        if (inputRef.current && inputRef.current.value !== '') {
          setInputValue('', createChangeEventDetails(REASONS.inputClear));
        }
      } else {
        const stringVal = stringifyAsLabel(selectedValue, itemToStringLabel);
        if (inputRef.current && inputRef.current.value !== stringVal) {
          // If no selection was made, treat this as clearing the typed filter.
          const reason = stringVal === '' ? REASONS.inputClear : REASONS.none;
          setInputValue(stringVal, createChangeEventDetails(reason));
        }
      }
    }
  });

  // Support composing the Dialog component around an inline combobox.
  // `[role="dialog"]` is more interoperable than using a context, e.g. it can work
  // with third-party modal libraries, though the limitation is that the closest
  // `role=dialog` part must be the animated element.
  const resolvedPopupRef = React.useMemo(() => {
    if (inline && positionerElement) {
      return {
        current: positionerElement.closest('[role="dialog"]')
      };
    }
    return popupRef;
  }, [inline, positionerElement]);
  useOpenChangeComplete({
    enabled: !props.actionsRef,
    open,
    ref: resolvedPopupRef,
    onComplete() {
      if (!open) {
        handleUnmount();
      }
    }
  });
  React.useImperativeHandle(props.actionsRef, () => ({
    unmount: handleUnmount
  }), [handleUnmount]);
  useIsoLayoutEffect(function syncSelectedIndex() {
    if (open || selectionMode === 'none') {
      return;
    }
    const registry = items ? flatItems : allValuesRef.current;
    if (multiple) {
      const currentValue = Array.isArray(selectedValue) ? selectedValue : [];
      const lastValue = currentValue[currentValue.length - 1];
      const lastIndex = findItemIndex(registry, lastValue, isItemEqualToValue);
      setIndices({
        selectedIndex: lastIndex === -1 ? null : lastIndex
      });
    } else {
      const index = findItemIndex(registry, selectedValue, isItemEqualToValue);
      setIndices({
        selectedIndex: index === -1 ? null : index
      });
    }
  }, [open, selectedValue, items, selectionMode, flatItems, multiple, isItemEqualToValue, setIndices]);
  useIsoLayoutEffect(() => {
    if (items) {
      valuesRef.current = flatFilteredItems;
      listRef.current.length = flatFilteredItems.length;
    }
  }, [items, flatFilteredItems]);
  useIsoLayoutEffect(() => {
    const pendingHighlight = pendingQueryHighlightRef.current;
    if (pendingHighlight) {
      if (pendingHighlight.hasQuery) {
        if (autoHighlightMode) {
          store.set('activeIndex', 0);
        }
      } else if (autoHighlightMode === 'always') {
        store.set('activeIndex', 0);
      }
      pendingQueryHighlightRef.current = null;
    }
    if (!open && !inline) {
      return;
    }
    const shouldUseFlatFilteredItems = hasItems || hasFilteredItemsProp;
    const candidateItems = shouldUseFlatFilteredItems ? flatFilteredItems : valuesRef.current;
    const storeActiveIndex = store.state.activeIndex;
    if (storeActiveIndex == null) {
      if (autoHighlightMode === 'always' && candidateItems.length > 0) {
        store.set('activeIndex', 0);
        return;
      }
      if (lastHighlightRef.current !== INITIAL_LAST_HIGHLIGHT) {
        lastHighlightRef.current = INITIAL_LAST_HIGHLIGHT;
        store.state.onItemHighlighted(undefined, createGenericEventDetails(REASONS.none, undefined, {
          index: -1
        }));
      }
      return;
    }
    if (storeActiveIndex >= candidateItems.length) {
      if (lastHighlightRef.current !== INITIAL_LAST_HIGHLIGHT) {
        lastHighlightRef.current = INITIAL_LAST_HIGHLIGHT;
        store.state.onItemHighlighted(undefined, createGenericEventDetails(REASONS.none, undefined, {
          index: -1
        }));
      }
      store.set('activeIndex', null);
      return;
    }
    const itemValue = candidateItems[storeActiveIndex];
    const previouslyHighlightedItemValue = lastHighlightRef.current.value;
    const isSameItem = previouslyHighlightedItemValue !== NO_ACTIVE_VALUE && compareItemEquality(itemValue, previouslyHighlightedItemValue, store.state.isItemEqualToValue);
    if (lastHighlightRef.current.index !== storeActiveIndex || !isSameItem) {
      lastHighlightRef.current = {
        value: itemValue,
        index: storeActiveIndex
      };
      store.state.onItemHighlighted(itemValue, createGenericEventDetails(REASONS.none, undefined, {
        index: storeActiveIndex
      }));
    }
  }, [activeIndex, autoHighlightMode, hasFilteredItemsProp, hasItems, flatFilteredItems, inline, open, store]);
  useIsoLayoutEffect(() => {
    if (selectionMode === 'none') {
      setFilled(String(inputValue) !== '');
      return;
    }
    setFilled(multiple ? Array.isArray(selectedValue) && selectedValue.length > 0 : selectedValue != null);
  }, [setFilled, selectionMode, inputValue, selectedValue, multiple]);

  // Ensures that the active index is not set to 0 when the list is empty.
  // This avoids needing to press ArrowDown twice under certain conditions.
  React.useEffect(() => {
    if (hasItems && autoHighlightMode && flatFilteredItems.length === 0) {
      setIndices({
        activeIndex: null
      });
    }
  }, [hasItems, autoHighlightMode, flatFilteredItems.length, setIndices]);
  function isSelectedValueDirty(value) {
    const initialValue = validityData.initialValue;
    if (Array.isArray(value) && Array.isArray(initialValue)) {
      return !areArraysEqual(value, initialValue, (itemValue, initialItemValue) => compareItemEquality(itemValue, initialItemValue, isItemEqualToValue));
    }
    return value !== initialValue;
  }
  useValueChanged(query, () => {
    if (!open || query === '' || query === String(initialDefaultInputValue)) {
      return;
    }
    setQueryChangedAfterOpen(true);
  });
  useValueChanged(selectedValue, () => {
    if (selectionMode === 'none') {
      return;
    }
    clearErrors(name);
    setDirty(isSelectedValueDirty(selectedValue));
    validation.change(selectedValue);
    if (single && !hasInputValue && !inputInsidePopup) {
      const nextInputValue = stringifyAsLabel(selectedValue, itemToStringLabel);
      if (inputValue !== nextInputValue) {
        setInputValue(nextInputValue, createChangeEventDetails(REASONS.none));
      }
    }
  });
  useValueChanged(inputValue, () => {
    if (selectionMode !== 'none') {
      return;
    }
    clearErrors(name);
    setDirty(inputValue !== validityData.initialValue);
    validation.change(inputValue);
  });
  useValueChanged(items, () => {
    if (!single || hasInputValue || inputInsidePopup || queryChangedAfterOpen) {
      return;
    }
    const nextInputValue = stringifyAsLabel(selectedValue, itemToStringLabel);
    if (inputValue !== nextInputValue) {
      setInputValue(nextInputValue, createChangeEventDetails(REASONS.none));
    }
  });
  const floatingRootContext = useFloatingRootContext({
    open: inline ? true : open,
    onOpenChange: setOpen,
    elements: {
      reference: inputInsidePopup ? triggerElement : inputElement,
      floating: positionerElement
    }
  });
  let ariaHasPopup;
  let ariaExpanded;
  if (!inline) {
    ariaHasPopup = grid ? 'grid' : 'listbox';
    ariaExpanded = open ? 'true' : 'false';
  }
  const role = React.useMemo(() => {
    const isPlainInput = inputElement?.tagName === 'INPUT';
    // During SSR and initial hydration, the input ref is not available yet.
    // Assume an input-like control so combobox ARIA attributes are present.
    const shouldTreatAsInput = inputElement == null || isPlainInput;
    const shouldApplyAria = shouldTreatAsInput || open;
    const reference = shouldTreatAsInput ? {
      autoComplete: 'off',
      spellCheck: 'false',
      autoCorrect: 'off',
      autoCapitalize: 'none'
    } : {};
    if (shouldApplyAria) {
      reference.role = 'combobox';
      reference['aria-expanded'] = ariaExpanded;
      reference['aria-haspopup'] = ariaHasPopup;
      reference['aria-controls'] = open ? listElement?.id : undefined;
      reference['aria-autocomplete'] = autoComplete;
    }
    return {
      reference,
      floating: {
        role: 'presentation'
      }
    };
  }, [inputElement, open, ariaExpanded, ariaHasPopup, listElement?.id, autoComplete]);
  const click = useClick(floatingRootContext, {
    enabled: !readOnly && !disabled && openOnInputClick,
    event: 'mousedown-only',
    toggle: false,
    // Apply a small delay for touch to let mobile viewport/keyboard positioning settle.
    // This avoids top-bottom flip flickers if the preferred position is "top" when first tapping.
    touchOpenDelay: inputInsidePopup ? 0 : 100,
    reason: REASONS.inputPress
  });
  const dismiss = useDismiss(floatingRootContext, {
    enabled: !readOnly && !disabled && !inline,
    outsidePressEvent: {
      mouse: 'sloppy',
      // The visual viewport (affected by the mobile software keyboard) can be
      // somewhat small. The user may want to scroll the screen to see more of
      // the popup.
      touch: 'intentional'
    },
    // Without a popup, let the Escape key bubble the event up to other popups' handlers.
    bubbles: inline ? true : undefined,
    outsidePress(event) {
      const target = getTarget(event);
      return !contains(triggerElement, target) && !contains(clearRef.current, target) && !contains(chipsContainerRef.current, target) && !contains(inputGroupElement, target);
    }
  });
  const listNavigation = useListNavigation(floatingRootContext, {
    enabled: !readOnly && !disabled,
    id,
    listRef,
    activeIndex,
    selectedIndex,
    virtual: true,
    loopFocus,
    allowEscape: loopFocus && !autoHighlightMode,
    focusItemOnOpen: queryChangedAfterOpen || selectionMode === 'none' && !autoHighlightMode ? false : 'auto',
    focusItemOnHover: highlightItemOnHover,
    resetOnPointerLeave: !keepHighlight,
    orientation: grid ? 'horizontal' : undefined,
    rtl: direction === 'rtl',
    disabledIndices: EMPTY_ARRAY,
    grid: grid ? gridNavigation : undefined,
    onNavigate(nextActiveIndex, event) {
      // Retain the highlight only while actually transitioning out or closed.
      if (!event && !open || transitionStatus === 'ending') {
        return;
      }
      if (!event) {
        setIndices({
          activeIndex: nextActiveIndex
        });
      } else {
        setIndices({
          activeIndex: nextActiveIndex,
          type: keyboardActiveRef.current ? 'keyboard' : 'pointer'
        });
      }
    }
  });
  const inputProps = React.useMemo(() => mergeProps(listNavigation.reference, {
    onKeyDown(event) {
      // In grid mode the navigation hook treats ArrowLeft/ArrowRight as horizontal
      // grid movement. When the input has focus and no item is highlighted the user
      // is still editing the query, so let the input keep its native caret behavior.
      if (grid && store.state.activeIndex == null && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventBaseUIHandler();
      }
    }
  }, dismiss.reference, click.reference, role.reference), [listNavigation.reference, dismiss.reference, click.reference, role.reference, grid, store]);
  const popupProps = React.useMemo(() => mergeProps(FOCUSABLE_POPUP_PROPS, listNavigation.floating, dismiss.floating, role.floating), [listNavigation.floating, dismiss.floating, role.floating]);
  const itemProps = React.useMemo(() => {
    const listNavigationItemProps = listNavigation.item;
    if (!listNavigationItemProps) {
      return EMPTY_OBJECT;
    }

    // Combobox keeps focus on the input; item focus would incorrectly sync
    // list navigation state from DOM focus.
    return {
      ...listNavigationItemProps,
      onFocus: undefined
    };
  }, [listNavigation.item]);
  useOnFirstRender(() => {
    store.update({
      inline: inlineProp,
      popupProps,
      inputProps,
      triggerProps,
      itemProps,
      setOpen,
      setInputValue,
      setSelectedValue,
      setIndices,
      onItemHighlighted,
      handleSelection,
      forceMount,
      requestSubmit
    });
  });
  useIsoLayoutEffect(() => {
    store.update({
      id,
      selectedValue,
      open,
      mounted,
      transitionStatus,
      items,
      inline: inlineProp,
      popupProps,
      inputProps,
      triggerProps,
      openMethod,
      itemProps,
      selectionMode,
      name,
      form,
      disabled,
      readOnly,
      required,
      grid,
      isGrouped,
      virtualized,
      onOpenChangeComplete,
      openOnInputClick,
      itemToStringLabel,
      modal,
      autoHighlight: autoHighlightMode,
      isItemEqualToValue,
      submitOnItemClick,
      hasInputValue,
      requestSubmit,
      inputOwnsFormValue: selectionMode === 'none' && (inlineProp || !store.state.inputInsidePopup)
    });
  }, [store, id, selectedValue, open, mounted, transitionStatus, items, popupProps, inputProps, itemProps, openMethod, triggerProps, selectionMode, name, disabled, readOnly, required, validation, grid, isGrouped, virtualized, onOpenChangeComplete, openOnInputClick, itemToStringLabel, modal, isItemEqualToValue, submitOnItemClick, hasInputValue, inlineProp, requestSubmit, autoHighlightMode, form]);
  const hiddenInputRef = useMergedRefs(inputRefProp, validation.inputRef);
  const itemsContextValue = React.useMemo(() => ({
    query,
    hasItems,
    filteredItems,
    flatFilteredItems
  }), [query, hasItems, filteredItems, flatFilteredItems]);
  const serializedValue = React.useMemo(() => {
    if (Array.isArray(fieldRawValue)) {
      return '';
    }
    return stringifyAsValue(fieldRawValue, itemToStringValue);
  }, [fieldRawValue, itemToStringValue]);
  const hasMultipleSelection = multiple && Array.isArray(selectedValue) && selectedValue.length > 0;
  const hiddenInputName = multiple || selectionMode === 'none' && inputOwnsFormValue ? undefined : name;
  const hiddenInputs = React.useMemo(() => {
    if (!multiple || !Array.isArray(selectedValue) || !name) {
      return null;
    }
    return selectedValue.map(value => {
      const currentSerializedValue = stringifyAsValue(value, itemToStringValue);
      return /*#__PURE__*/_jsx("input", {
        type: "hidden",
        form: form,
        name: name,
        value: currentSerializedValue,
        disabled: disabled
      }, currentSerializedValue);
    });
  }, [multiple, selectedValue, form, name, itemToStringValue, disabled]);
  const children = /*#__PURE__*/_jsxs(React.Fragment, {
    children: [props.children, /*#__PURE__*/_jsx("input", {
      ...validation.getValidationProps(disabled, {
        // Move focus when the hidden input is focused.
        onFocus() {
          if (inputInsidePopup) {
            triggerElement?.focus();
            return;
          }
          (inputRef.current || triggerElement)?.focus();
        },
        // Handle browser autofill.
        onChange(event) {
          // Workaround for https://github.com/facebook/react/issues/9023
          if (event.nativeEvent.defaultPrevented || disabled || readOnly) {
            return;
          }
          const nextValue = event.currentTarget.value;
          const nextValueLower = nextValue.toLowerCase();
          const details = createChangeEventDetails(REASONS.none, event.nativeEvent);
          const findSerializedMatchIndex = () => valuesRef.current.findIndex(candidate => stringifyAsValue(candidate, itemToStringValue).toLowerCase() === nextValueLower || stringifyAsLabel(candidate, itemToStringLabel).toLowerCase() === nextValueLower);
          function handleChange() {
            // Browser autofill only writes a single scalar value.
            if (multiple) {
              return;
            }
            if (selectionMode === 'none') {
              setInputValue(nextValue, details);
              return;
            }

            // Preserve the original serialized matching, then fall back to rendered text,
            // which browsers can autofill for primitive values like `value="US">United States`.
            let matchingIndex = findSerializedMatchIndex();
            if (matchingIndex === -1) {
              matchingIndex = valuesRef.current.findIndex((_, index) => {
                const renderedLabel = labelsRef.current[index];
                return renderedLabel != null && renderedLabel.toLowerCase() === nextValueLower;
              });
            }
            const matchingValue = matchingIndex === -1 ? undefined : valuesRef.current[matchingIndex];
            if (matchingValue != null) {
              // `setSelectedValue` may be canceled by `onValueChange`; rely on
              // `useValueChanged` to mark the field dirty and run validation only
              // when the value actually changes.
              setSelectedValue?.(matchingValue, details);
            }
          }

          // Only single-selection autofill matches against the registered values/labels.
          // `multiple` ignores autofill and `none` just writes the input value, so avoid the
          // sticky `forceMounted` mount (which never resets) for those modes.
          if (single) {
            forceMount();
            if (items && findSerializedMatchIndex() === -1) {
              // `forceMount` only refreshes the derived labels for the `items` prop. When
              // serialized matching misses, also mount the list so rendered labels (which can
              // differ from the serialized values) are registered for autofill matching.
              store.set('forceMounted', true);
            }
          }
          queueMicrotask(handleChange);
        }
      }),
      id: id && hiddenInputName == null ? `${id}-hidden-input` : undefined,
      form: form,
      name: hiddenInputName,
      autoComplete: formAutoComplete,
      disabled: disabled,
      required: required && !hasMultipleSelection,
      readOnly: readOnly,
      value: serializedValue,
      ref: hiddenInputRef,
      style: hiddenInputName ? visuallyHiddenInput : visuallyHidden,
      tabIndex: -1,
      "aria-hidden": true,
      suppressHydrationWarning: true
    }), hiddenInputs]
  });
  return /*#__PURE__*/_jsx(ComboboxRootContext.Provider, {
    value: store,
    children: /*#__PURE__*/_jsx(ComboboxFloatingContext.Provider, {
      value: floatingRootContext,
      children: /*#__PURE__*/_jsx(ComboboxHasItemsContext.Provider, {
        value: hasItems,
        children: /*#__PURE__*/_jsx(ComboboxDerivedItemsContext.Provider, {
          value: itemsContextValue,
          children: /*#__PURE__*/_jsx(ComboboxInputValueContext.Provider, {
            value: inputValue,
            children: children
          })
        })
      })
    })
  });
}