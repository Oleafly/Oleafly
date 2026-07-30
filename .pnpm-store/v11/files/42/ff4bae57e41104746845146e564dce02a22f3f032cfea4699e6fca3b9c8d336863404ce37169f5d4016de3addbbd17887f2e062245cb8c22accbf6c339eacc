"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ComboboxInput = void 0;
var React = _interopRequireWildcard(require("react"));
var _store = require("@base-ui/utils/store");
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _platform = require("@base-ui/utils/platform");
var _useBaseUiId = require("../../internals/useBaseUiId");
var _useRenderElement = require("../../internals/useRenderElement");
var _ComboboxRootContext = require("../root/ComboboxRootContext");
var _stateAttributesMapping = require("../utils/stateAttributesMapping");
var _store2 = require("../store");
var _FieldRootContext = require("../../internals/field-root-context/FieldRootContext");
var _constants = require("../../internals/field-constants/constants");
var _LabelableContext = require("../../internals/labelable-provider/LabelableContext");
var _ComboboxChipsContext = require("../chips/ComboboxChipsContext");
var _utils = require("../../floating-ui-react/utils");
var _ComboboxPositionerContext = require("../positioner/ComboboxPositionerContext");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
var _DirectionContext = require("../../internals/direction-context/DirectionContext");
var _resolveAriaLabelledBy = require("../../utils/resolveAriaLabelledBy");
var _ComboboxInternalDismissButton = require("../utils/ComboboxInternalDismissButton");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * A text input to search for items in the list.
 * Renders an `<input>` element.
 *
 * Documentation: [Base UI Combobox](https://base-ui.com/react/components/combobox)
 */
const ComboboxInput = exports.ComboboxInput = /*#__PURE__*/React.forwardRef(function ComboboxInput(componentProps, forwardedRef) {
  const {
    render,
    className,
    disabled: disabledProp = false,
    id: idProp,
    style,
    ...elementProps
  } = componentProps;
  const {
    state: fieldState,
    disabled: fieldDisabled,
    setTouched,
    setFocused,
    validationMode,
    validation
  } = (0, _FieldRootContext.useFieldRootContext)();
  const {
    labelId: fieldLabelId
  } = (0, _LabelableContext.useLabelableContext)();
  const comboboxChipsContext = (0, _ComboboxChipsContext.useComboboxChipsContext)();
  const positioning = (0, _ComboboxPositionerContext.useComboboxPositionerContext)(true);
  const hasPositionerParent = Boolean(positioning);
  const store = (0, _ComboboxRootContext.useComboboxRootContext)();
  const {
    filteredItems
  } = (0, _ComboboxRootContext.useComboboxDerivedItemsContext)();
  // `inputValue` can't be placed in the store.
  // https://github.com/mui/base-ui/issues/2703
  const inputValue = (0, _ComboboxRootContext.useComboboxInputValueContext)();
  const direction = (0, _DirectionContext.useDirection)();
  const required = (0, _store.useStore)(store, _store2.selectors.required);
  const comboboxDisabled = (0, _store.useStore)(store, _store2.selectors.disabled);
  const readOnly = (0, _store.useStore)(store, _store2.selectors.readOnly);
  const name = (0, _store.useStore)(store, _store2.selectors.name);
  const form = (0, _store.useStore)(store, _store2.selectors.form);
  const selectionMode = (0, _store.useStore)(store, _store2.selectors.selectionMode);
  const autoHighlightMode = (0, _store.useStore)(store, _store2.selectors.autoHighlight);
  const inputProps = (0, _store.useStore)(store, _store2.selectors.inputProps);
  const triggerProps = (0, _store.useStore)(store, _store2.selectors.triggerProps);
  const open = (0, _store.useStore)(store, _store2.selectors.open);
  const mounted = (0, _store.useStore)(store, _store2.selectors.mounted);
  const selectedValue = (0, _store.useStore)(store, _store2.selectors.selectedValue);
  const popupSideValue = (0, _store.useStore)(store, _store2.selectors.popupSide);
  const positionerElement = (0, _store.useStore)(store, _store2.selectors.positionerElement);
  const rootId = (0, _store.useStore)(store, _store2.selectors.id);
  const inline = (0, _store.useStore)(store, _store2.selectors.inline);
  const modal = (0, _store.useStore)(store, _store2.selectors.modal);
  const autoHighlightEnabled = Boolean(autoHighlightMode);
  const popupSide = mounted && positionerElement ? popupSideValue : null;
  const disabled = fieldDisabled || comboboxDisabled || disabledProp;
  const listEmpty = filteredItems.length === 0;
  const isInsidePopup = hasPositionerParent || inline;
  const focusManagerModal = !isInsidePopup || modal;
  const id = (0, _useBaseUiId.useBaseUiId)(idProp ?? (!isInsidePopup ? rootId : undefined));
  const ariaLabelledBy = (0, _resolveAriaLabelledBy.resolveAriaLabelledBy)(fieldLabelId, undefined);
  const fieldStateForInput = hasPositionerParent ? _constants.DEFAULT_FIELD_STATE_ATTRIBUTES : fieldState;
  const [composingValue, setComposingValue] = React.useState(null);
  const isComposingRef = React.useRef(false);
  const lastActiveIndexRef = React.useRef(null);
  const shouldRestoreActiveIndexRef = React.useRef(false);
  const inputOwnsFormValue = selectionMode === 'none' && !hasPositionerParent;
  const setInputElement = (0, _useStableCallback.useStableCallback)(element => {
    const nextIsInsidePopup = hasPositionerParent || store.state.inline;
    if (nextIsInsidePopup && !store.state.hasInputValue) {
      store.state.setInputValue('', (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.none));
    }
    store.update({
      inputElement: element,
      inputInsidePopup: nextIsInsidePopup,
      inputOwnsFormValue
    });
  });
  const validationProps = hasPositionerParent || !validation ? elementProps : validation.getValidationProps(disabled, elementProps);
  const state = {
    ...fieldStateForInput,
    open,
    disabled,
    readOnly,
    popupSide,
    listEmpty
  };
  function handleKeyDown(event) {
    if (!comboboxChipsContext) {
      return undefined;
    }
    let nextIndex;
    const {
      highlightedChipIndex
    } = comboboxChipsContext;
    const renderedChipsCount = comboboxChipsContext.chipsRef.current.length;
    const isRtl = direction === 'rtl';
    const previousChipKey = isRtl ? 'ArrowRight' : 'ArrowLeft';
    const nextChipKey = isRtl ? 'ArrowLeft' : 'ArrowRight';
    if (highlightedChipIndex !== undefined) {
      if (event.key === previousChipKey) {
        event.preventDefault();
        if (highlightedChipIndex > 0) {
          nextIndex = highlightedChipIndex - 1;
        } else {
          nextIndex = undefined;
        }
      } else if (event.key === nextChipKey) {
        event.preventDefault();
        if (highlightedChipIndex < renderedChipsCount - 1) {
          nextIndex = highlightedChipIndex + 1;
        } else {
          nextIndex = undefined;
        }
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        // Move highlight appropriately after removal.
        const computedNextIndex = highlightedChipIndex >= selectedValue.length - 1 ? selectedValue.length - 2 : highlightedChipIndex;
        // If the computed index is negative, treat it as no highlight.
        nextIndex = computedNextIndex >= 0 ? computedNextIndex : undefined;
        store.state.setIndices({
          activeIndex: null,
          selectedIndex: null,
          type: 'keyboard'
        });
      }
      return nextIndex;
    }

    // Handle navigation when no chip is highlighted
    if (event.key === previousChipKey && (event.currentTarget.selectionStart ?? 0) === 0 && selectedValue.length > 0) {
      event.preventDefault();
      nextIndex = renderedChipsCount > 0 ? renderedChipsCount - 1 : undefined;
    } else if (event.key === 'Backspace' && event.currentTarget.value === '' && selectedValue.length > 0) {
      store.state.setIndices({
        activeIndex: null,
        selectedIndex: null,
        type: 'keyboard'
      });
      event.preventDefault();
    }
    return nextIndex;
  }
  const element = (0, _useRenderElement.useRenderElement)('input', componentProps, {
    state,
    ref: [forwardedRef, store.state.inputRef, setInputElement],
    props: [inputProps, triggerProps, {
      type: 'text',
      value: componentProps.value ?? composingValue ?? inputValue,
      'aria-readonly': readOnly || undefined,
      'aria-required': required || undefined,
      'aria-labelledby': ariaLabelledBy,
      disabled,
      readOnly,
      required: selectionMode === 'none' ? required : undefined,
      form,
      ...(inputOwnsFormValue && name && {
        name
      }),
      id,
      onFocus() {
        setFocused(true);
        if (!inline || !shouldRestoreActiveIndexRef.current) {
          return;
        }
        shouldRestoreActiveIndexRef.current = false;
        const nextActiveIndex = lastActiveIndexRef.current;
        if (nextActiveIndex == null ||
        // `valuesRef` can be sparse, so guard against restoring a removed slot.
        !Object.hasOwn(store.state.valuesRef.current, nextActiveIndex)) {
          return;
        }
        store.state.setIndices({
          activeIndex: nextActiveIndex
        });
      },
      onBlur() {
        setTouched(true);
        setFocused(false);
        const activeIndex = store.state.activeIndex;
        if (inline && activeIndex !== null && autoHighlightMode !== 'always') {
          lastActiveIndexRef.current = activeIndex;
          shouldRestoreActiveIndexRef.current = true;
          store.state.setIndices({
            activeIndex: null
          });
        }
        if (validationMode === 'onBlur') {
          const valueToValidate = selectionMode === 'none' ? inputValue : selectedValue;
          validation.commit(valueToValidate);
        }
      },
      onCompositionStart(event) {
        if (_platform.platform.os.android) {
          return;
        }
        isComposingRef.current = true;
        setComposingValue(event.currentTarget.value);
      },
      onCompositionEnd(event) {
        isComposingRef.current = false;
        const next = event.currentTarget.value;
        setComposingValue(null);
        store.state.setInputValue(next, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.inputChange, event.nativeEvent));
      },
      onChange(event) {
        // Autofill may not provide `inputType` (Chrome) or may report
        // `insertReplacementText` (Firefox).
        const inputType = event.nativeEvent.inputType;
        const autofillLikeInput = !inputType || inputType === 'insertReplacementText';
        const shouldOpenOnInput = isComposingRef.current || !autofillLikeInput;

        // During IME composition, avoid propagating controlled updates to prevent
        // filtering the options prematurely so `Empty` won't show incorrectly.
        // We can't rely on this check for Android due to how it handles composition
        // events with some keyboards (e.g. Samsung keyboard with predictive text on
        // treats all text as always-composing).
        // https://github.com/mui/base-ui/issues/2942
        if (isComposingRef.current) {
          const nextVal = event.currentTarget.value;
          setComposingValue(nextVal);
          if (nextVal === '' && !store.state.openOnInputClick && !store.state.inputInsidePopup) {
            store.state.setOpen(false, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.inputClear, event.nativeEvent));
          }
          const trimmed = nextVal.trim();
          const shouldMaintainHighlight = autoHighlightEnabled && trimmed !== '';
          if (!readOnly && !disabled && trimmed) {
            if (shouldOpenOnInput) {
              store.state.setOpen(true, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.inputChange, event.nativeEvent));
              if (!autoHighlightEnabled) {
                store.state.setIndices({
                  activeIndex: null,
                  selectedIndex: null,
                  type: store.state.keyboardActiveRef.current ? 'keyboard' : 'pointer'
                });
              }
            }
          }
          if (open && store.state.activeIndex !== null && !shouldMaintainHighlight) {
            store.state.setIndices({
              activeIndex: null,
              selectedIndex: null,
              type: store.state.keyboardActiveRef.current ? 'keyboard' : 'pointer'
            });
          }
          return;
        }
        const inputChangeDetails = (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.inputChange, event.nativeEvent);
        store.state.setInputValue(event.currentTarget.value, inputChangeDetails);
        if (inputChangeDetails.isCanceled) {
          return;
        }
        const empty = event.currentTarget.value === '';
        const clearDetails = (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.inputClear, event.nativeEvent);
        if (empty && !store.state.inputInsidePopup) {
          if (selectionMode === 'single') {
            store.state.setSelectedValue(null, clearDetails);
          }
          if (!store.state.openOnInputClick) {
            store.state.setOpen(false, clearDetails);
          }
        }
        const trimmed = event.currentTarget.value.trim();
        if (!readOnly && !disabled && trimmed) {
          if (shouldOpenOnInput) {
            store.state.setOpen(true, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.inputChange, event.nativeEvent));
            // When autoHighlight is enabled, keep the highlight (will be set to 0 in root).
            if (!autoHighlightEnabled) {
              store.state.setIndices({
                activeIndex: null,
                selectedIndex: null,
                type: store.state.keyboardActiveRef.current ? 'keyboard' : 'pointer'
              });
            }
          }
        }

        // When the user types, ensure the list resets its highlight so that
        // virtual focus returns to the input (aria-activedescendant is
        // cleared).
        if (open && store.state.activeIndex !== null && !autoHighlightEnabled) {
          store.state.setIndices({
            activeIndex: null,
            selectedIndex: null,
            type: store.state.keyboardActiveRef.current ? 'keyboard' : 'pointer'
          });
        }
      },
      onKeyDown(event) {
        if (disabled || readOnly) {
          return;
        }
        if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
          return;
        }
        store.state.keyboardActiveRef.current = true;
        const input = event.currentTarget;
        const scrollAmount = input.scrollWidth - input.clientWidth;
        const isRTL = direction === 'rtl';
        if (event.key === 'Home') {
          (0, _utils.stopEvent)(event);
          const cursor = _platform.platform.engine.gecko && isRTL ? input.value.length : 0;
          input.setSelectionRange(cursor, cursor);
          input.scrollLeft = 0;
          return;
        }
        if (event.key === 'End') {
          (0, _utils.stopEvent)(event);
          const cursor = _platform.platform.engine.gecko && isRTL ? 0 : input.value.length;
          input.setSelectionRange(cursor, cursor);
          input.scrollLeft = isRTL ? -scrollAmount : scrollAmount;
          return;
        }
        if (!mounted && event.key === 'Escape') {
          const isClear = selectionMode === 'multiple' && Array.isArray(selectedValue) ? selectedValue.length === 0 : selectedValue === null;
          const details = (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.escapeKey, event.nativeEvent);
          const value = selectionMode === 'multiple' ? [] : null;
          store.state.setInputValue('', details);
          store.state.setSelectedValue(value, details);
          if (!isClear && !store.state.inline && !details.isPropagationAllowed) {
            event.stopPropagation();
          }
          return;
        }

        // Handle deletion when no chip is highlighted and the input is empty.
        if (comboboxChipsContext && event.key === 'Backspace' && input.value === '' && comboboxChipsContext.highlightedChipIndex === undefined && Array.isArray(selectedValue) && selectedValue.length > 0) {
          const renderedChipsCount = comboboxChipsContext.chipsRef.current.length;
          const removalIndex = renderedChipsCount > 0 ? renderedChipsCount - 1 : selectedValue.length - 1;
          const newValue = selectedValue.filter((_, index) => index !== removalIndex);
          // If the removed item was also the active (highlighted) item, clear highlight
          store.state.setIndices({
            activeIndex: null,
            selectedIndex: null,
            type: store.state.keyboardActiveRef.current ? 'keyboard' : 'pointer'
          });
          store.state.setSelectedValue(newValue, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.none, event.nativeEvent));
          return;
        }
        const hadHighlightedChip = comboboxChipsContext?.highlightedChipIndex !== undefined;
        const nextIndex = handleKeyDown(event);
        comboboxChipsContext?.setHighlightedChipIndex(nextIndex);
        if (nextIndex !== undefined) {
          comboboxChipsContext?.chipsRef.current[nextIndex]?.focus();
        } else if (hadHighlightedChip) {
          store.state.inputRef.current?.focus();
        }

        // event.isComposing
        if (event.which === 229) {
          return;
        }
        if (event.key === 'Enter' && open) {
          const activeIndex = store.state.activeIndex;
          const nativeEvent = event.nativeEvent;
          if (activeIndex === null) {
            if (inline) {
              return;
            }

            // Allow form submission when no item is highlighted.
            store.state.setOpen(false, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.none, nativeEvent));
            return;
          }
          (0, _utils.stopEvent)(event);
          const listItem = store.state.listRef.current[activeIndex];
          if (listItem) {
            store.state.selectionEventRef.current = nativeEvent;
            listItem.click();
            store.state.selectionEventRef.current = null;
          }
        }
      },
      onPointerMove() {
        store.state.keyboardActiveRef.current = false;
      },
      onPointerDown() {
        store.state.keyboardActiveRef.current = false;
      }
    }, validationProps],
    stateAttributesMapping: _stateAttributesMapping.triggerStateAttributesMapping
  });
  const renderedInput = hasPositionerParent ? /*#__PURE__*/(0, _jsxRuntime.jsx)(_FieldRootContext.FieldRootContext.Provider, {
    value: _FieldRootContext.DEFAULT_FIELD_ROOT_CONTEXT,
    children: element
  }) : element;
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(React.Fragment, {
    children: [open && focusManagerModal && /*#__PURE__*/(0, _jsxRuntime.jsx)(_ComboboxInternalDismissButton.ComboboxInternalDismissButton, {
      ref: store.state.startDismissRef
    }), renderedInput]
  });
});
if (process.env.NODE_ENV !== "production") ComboboxInput.displayName = "ComboboxInput";