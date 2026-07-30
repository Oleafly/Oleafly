"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useCollapsibleRoot = useCollapsibleRoot;
var React = _interopRequireWildcard(require("react"));
var _useControlled = require("@base-ui/utils/useControlled");
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _useBaseUiId = require("../../internals/useBaseUiId");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
var _useTransitionStatus = require("../../internals/useTransitionStatus");
function useCollapsibleRoot(parameters) {
  const {
    open: openParam,
    defaultOpen,
    onOpenChange,
    disabled
  } = parameters;
  const [open, setOpen] = (0, _useControlled.useControlled)({
    controlled: openParam,
    default: defaultOpen,
    name: 'Collapsible',
    state: 'open'
  });
  const {
    mounted,
    setMounted,
    transitionStatus
  } = (0, _useTransitionStatus.useTransitionStatus)(open, true, true);
  const defaultPanelId = (0, _useBaseUiId.useBaseUiId)();
  const [panelIdState, setPanelIdState] = React.useState();
  const panelId = panelIdState ?? defaultPanelId;
  const handleTrigger = (0, _useStableCallback.useStableCallback)(event => {
    const nextOpen = !open;
    const eventDetails = (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.triggerPress, event.nativeEvent);
    onOpenChange(nextOpen, eventDetails);
    if (eventDetails.isCanceled) {
      return;
    }
    setOpen(nextOpen);
  });
  return React.useMemo(() => ({
    disabled,
    handleTrigger,
    mounted,
    open,
    panelId,
    setMounted,
    setOpen,
    setPanelIdState,
    transitionStatus
  }), [disabled, handleTrigger, mounted, open, panelId, setMounted, setOpen, setPanelIdState, transitionStatus]);
}