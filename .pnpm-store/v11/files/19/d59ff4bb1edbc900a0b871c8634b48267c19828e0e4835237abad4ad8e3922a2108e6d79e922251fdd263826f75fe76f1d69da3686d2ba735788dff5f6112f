"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ComboboxPopup = void 0;
var React = _interopRequireWildcard(require("react"));
var _store = require("@base-ui/utils/store");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _floatingUiReact = require("../../floating-ui-react");
var _useRenderElement = require("../../internals/useRenderElement");
var _ComboboxRootContext = require("../root/ComboboxRootContext");
var _store2 = require("../store");
var _popupStateMapping = require("../../utils/popupStateMapping");
var _ComboboxPositionerContext = require("../positioner/ComboboxPositionerContext");
var _useOpenChangeComplete = require("../../internals/useOpenChangeComplete");
var _stateAttributesMapping = require("../../internals/stateAttributesMapping");
var _utils = require("../../floating-ui-react/utils");
var _getDisabledMountTransitionStyles = require("../../utils/getDisabledMountTransitionStyles");
var _ComboboxInternalDismissButton = require("../utils/ComboboxInternalDismissButton");
var _utils2 = require("../root/utils");
var _jsxRuntime = require("react/jsx-runtime");
const stateAttributesMapping = {
  ..._popupStateMapping.popupStateMapping,
  ..._stateAttributesMapping.transitionStatusMapping
};

/**
 * A container for the list.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Combobox](https://base-ui.com/react/components/combobox)
 */
const ComboboxPopup = exports.ComboboxPopup = /*#__PURE__*/React.forwardRef(function ComboboxPopup(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    initialFocus,
    finalFocus,
    ...elementProps
  } = componentProps;
  const store = (0, _ComboboxRootContext.useComboboxRootContext)();
  const positioning = (0, _ComboboxPositionerContext.useComboboxPositionerContext)();
  const floatingRootContext = (0, _ComboboxRootContext.useComboboxFloatingContext)();
  const {
    filteredItems
  } = (0, _ComboboxRootContext.useComboboxDerivedItemsContext)();
  const mounted = (0, _store.useStore)(store, _store2.selectors.mounted);
  const open = (0, _store.useStore)(store, _store2.selectors.open);
  const openMethod = (0, _store.useStore)(store, _store2.selectors.openMethod);
  const transitionStatus = (0, _store.useStore)(store, _store2.selectors.transitionStatus);
  const inputInsidePopup = (0, _store.useStore)(store, _store2.selectors.inputInsidePopup);
  const inputElement = (0, _store.useStore)(store, _store2.selectors.inputElement);
  const modal = (0, _store.useStore)(store, _store2.selectors.modal);
  const rootId = (0, _store.useStore)(store, _store2.selectors.id);
  const empty = filteredItems.length === 0;
  const popupId = elementProps.id ?? (inputInsidePopup ? (0, _utils2.getComboboxPopupId)(rootId) : undefined);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    // Prefer the rendered DOM id, which a `render` prop element or function may override.
    store.set('popupId', store.state.popupRef.current?.id || popupId);
    return () => {
      store.set('popupId', undefined);
    };
  }, [store, popupId]);
  (0, _useOpenChangeComplete.useOpenChangeComplete)({
    open,
    ref: store.state.popupRef,
    onComplete() {
      if (open) {
        store.state.onOpenChangeComplete(true);
      }
    }
  });
  const state = {
    open,
    side: positioning.side,
    align: positioning.align,
    anchorHidden: positioning.anchorHidden,
    transitionStatus,
    empty
  };
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    state,
    ref: [forwardedRef, store.state.popupRef],
    props: [{
      id: popupId,
      role: inputInsidePopup ? 'dialog' : 'presentation',
      tabIndex: -1,
      onFocus(event) {
        const target = (0, _utils.getTarget)(event.nativeEvent);
        if (openMethod !== 'touch' && ((0, _utils.contains)(store.state.listElement, target) || target === event.currentTarget)) {
          store.state.inputRef.current?.focus();
        }
      }
    }, (0, _getDisabledMountTransitionStyles.getDisabledMountTransitionStyles)(transitionStatus), elementProps],
    stateAttributesMapping
  });

  // Default initial focus logic:
  // If opened by touch, focus the popup element to prevent the virtual keyboard from opening
  // (this is required for Android specifically as iOS handles this automatically).
  const computedDefaultInitialFocus = inputInsidePopup ? interactionType => interactionType === 'touch' ? store.state.popupRef.current : inputElement : false;
  const resolvedInitialFocus = initialFocus === undefined ? computedDefaultInitialFocus : initialFocus;
  let resolvedFinalFocus;
  if (finalFocus != null) {
    resolvedFinalFocus = finalFocus;
  } else {
    resolvedFinalFocus = inputInsidePopup ? undefined : false;
  }
  const focusManagerModal = !inputInsidePopup || modal;
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_floatingUiReact.FloatingFocusManager, {
    context: floatingRootContext,
    disabled: !mounted,
    modal: focusManagerModal,
    openInteractionType: openMethod,
    initialFocus: resolvedInitialFocus,
    returnFocus: resolvedFinalFocus,
    getInsideElements: () => [store.state.startDismissRef.current, store.state.endDismissRef.current],
    children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(React.Fragment, {
      children: [element, focusManagerModal && /*#__PURE__*/(0, _jsxRuntime.jsx)(_ComboboxInternalDismissButton.ComboboxInternalDismissButton, {
        ref: store.state.endDismissRef
      })]
    })
  });
});
if (process.env.NODE_ENV !== "production") ComboboxPopup.displayName = "ComboboxPopup";