"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PopoverBackdrop = void 0;
var React = _interopRequireWildcard(require("react"));
var _PopoverRootContext = require("../root/PopoverRootContext");
var _popupStateMapping = require("../../utils/popupStateMapping");
var _stateAttributesMapping = require("../../internals/stateAttributesMapping");
var _useRenderElement = require("../../internals/useRenderElement");
var _reasons = require("../../internals/reasons");
const stateAttributesMapping = {
  ..._popupStateMapping.popupStateMapping,
  ..._stateAttributesMapping.transitionStatusMapping
};

/**
 * An overlay displayed beneath the popover.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Popover](https://base-ui.com/react/components/popover)
 */
const PopoverBackdrop = exports.PopoverBackdrop = /*#__PURE__*/React.forwardRef(function PopoverBackdrop(props, forwardedRef) {
  const {
    render,
    className,
    style,
    ...elementProps
  } = props;
  const {
    store
  } = (0, _PopoverRootContext.usePopoverRootContext)();
  const open = store.useState('open');
  const mounted = store.useState('mounted');
  const transitionStatus = store.useState('transitionStatus');
  const openReason = store.useState('openChangeReason');
  const state = {
    open,
    transitionStatus
  };
  const element = (0, _useRenderElement.useRenderElement)('div', props, {
    state,
    ref: [store.context.backdropRef, forwardedRef],
    props: [{
      role: 'presentation',
      hidden: !mounted,
      style: {
        pointerEvents: openReason === _reasons.REASONS.triggerHover ? 'none' : undefined,
        userSelect: 'none',
        WebkitUserSelect: 'none'
      }
    }, elementProps],
    stateAttributesMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") PopoverBackdrop.displayName = "PopoverBackdrop";