"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PreviewCardPopup = void 0;
var React = _interopRequireWildcard(require("react"));
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _PreviewCardContext = require("../root/PreviewCardContext");
var _PreviewCardPositionerContext = require("../positioner/PreviewCardPositionerContext");
var _popupStateMapping = require("../../utils/popupStateMapping");
var _stateAttributesMapping = require("../../internals/stateAttributesMapping");
var _useOpenChangeComplete = require("../../internals/useOpenChangeComplete");
var _useRenderElement = require("../../internals/useRenderElement");
var _getDisabledMountTransitionStyles = require("../../utils/getDisabledMountTransitionStyles");
var _floatingUiReact = require("../../floating-ui-react");
const stateAttributesMapping = {
  ..._popupStateMapping.popupStateMapping,
  ..._stateAttributesMapping.transitionStatusMapping
};

/**
 * A container for the preview card contents.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Preview Card](https://base-ui.com/react/components/preview-card)
 */
const PreviewCardPopup = exports.PreviewCardPopup = /*#__PURE__*/React.forwardRef(function PreviewCardPopup(componentProps, forwardedRef) {
  const {
    className,
    render,
    style,
    ...elementProps
  } = componentProps;
  const store = (0, _PreviewCardContext.usePreviewCardRootContext)();
  const {
    side,
    align
  } = (0, _PreviewCardPositionerContext.usePreviewCardPositionerContext)();
  const open = store.useState('open');
  const instantType = store.useState('instantType');
  const transitionStatus = store.useState('transitionStatus');
  const popupProps = store.useState('popupProps');
  const floatingContext = store.useState('floatingRootContext');
  (0, _useOpenChangeComplete.useOpenChangeComplete)({
    open,
    ref: store.context.popupRef,
    onComplete() {
      if (open) {
        store.context.onOpenChangeComplete?.(true);
      }
    }
  });
  const getCloseDelay = (0, _useStableCallback.useStableCallback)(() => store.context.closeDelayRef.current);
  (0, _floatingUiReact.useHoverFloatingInteraction)(floatingContext, {
    closeDelay: getCloseDelay
  });
  const state = {
    open,
    side,
    align,
    instant: instantType,
    transitionStatus
  };
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    state,
    ref: [forwardedRef, store.context.popupRef, store.useStateSetter('popupElement')],
    props: [popupProps, (0, _getDisabledMountTransitionStyles.getDisabledMountTransitionStyles)(transitionStatus), elementProps],
    stateAttributesMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") PreviewCardPopup.displayName = "PreviewCardPopup";