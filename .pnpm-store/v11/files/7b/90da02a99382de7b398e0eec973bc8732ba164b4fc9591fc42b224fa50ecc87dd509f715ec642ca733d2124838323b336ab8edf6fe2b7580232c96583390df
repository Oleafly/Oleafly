"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.CollapsiblePanel = void 0;
var React = _interopRequireWildcard(require("react"));
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _warn = require("@base-ui/utils/warn");
var _resolveStyle = require("../../utils/resolveStyle");
var _useRenderElement = require("../../internals/useRenderElement");
var _CollapsibleRootContext = require("../root/CollapsibleRootContext");
var _stateAttributesMapping = require("../root/stateAttributesMapping");
var _useCollapsiblePanel = require("./useCollapsiblePanel");
var _CollapsiblePanelCssVars = require("./CollapsiblePanelCssVars");
/**
 * A panel with the collapsible contents.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Collapsible](https://base-ui.com/react/components/collapsible)
 */
const CollapsiblePanel = exports.CollapsiblePanel = /*#__PURE__*/React.forwardRef(function CollapsiblePanel(componentProps, forwardedRef) {
  const {
    className,
    hiddenUntilFound: hiddenUntilFoundProp,
    keepMounted: keepMountedProp,
    render,
    id: idProp,
    style,
    ...elementProps
  } = componentProps;
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
      if (hiddenUntilFoundProp && keepMountedProp === false) {
        (0, _warn.warn)('The `keepMounted={false}` prop on `Collapsible.Panel` is ignored when `hiddenUntilFound` is enabled, since the panel must remain mounted while closed.');
      }
    }, [hiddenUntilFoundProp, keepMountedProp]);
  }
  const {
    mounted,
    onOpenChange,
    open,
    panelId,
    setMounted,
    setPanelIdState,
    setOpen,
    state,
    transitionStatus
  } = (0, _CollapsibleRootContext.useCollapsibleRootContext)();
  const hiddenUntilFound = hiddenUntilFoundProp ?? false;
  const keepMounted = keepMountedProp ?? false;
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (idProp) {
      setPanelIdState(idProp);
      return () => {
        setPanelIdState(undefined);
      };
    }
    return undefined;
  }, [idProp, setPanelIdState]);
  const {
    height,
    props,
    ref,
    shouldPreventOpenAnimation,
    shouldRender,
    transitionStatus: panelTransitionStatus,
    width
  } = (0, _useCollapsiblePanel.useCollapsiblePanel)({
    externalRef: forwardedRef,
    hiddenUntilFound,
    id: panelId,
    keepMounted,
    mounted,
    onOpenChange,
    open,
    setMounted,
    setOpen,
    transitionStatus
  });
  const panelState = {
    ...state,
    transitionStatus: panelTransitionStatus
  };
  const resolvedStyle = (0, _resolveStyle.resolveStyle)(style, panelState);
  const element = (0, _useRenderElement.useRenderElement)('div', {
    ...componentProps,
    style: undefined
  }, {
    state: panelState,
    ref,
    props: [props, {
      style: {
        [_CollapsiblePanelCssVars.CollapsiblePanelCssVars.collapsiblePanelHeight]: height === undefined ? 'auto' : `${height}px`,
        [_CollapsiblePanelCssVars.CollapsiblePanelCssVars.collapsiblePanelWidth]: width === undefined ? 'auto' : `${width}px`
      }
    }, elementProps, resolvedStyle ? {
      style: resolvedStyle
    } : undefined,
    // Resolve the public `style` prop so temporary `animationName: 'none'`
    // can still win after user's inline styles have been merged.
    shouldPreventOpenAnimation ? {
      style: {
        animationName: 'none'
      }
    } : undefined],
    stateAttributesMapping: _stateAttributesMapping.collapsibleStateAttributesMapping
  });
  if (!shouldRender) {
    return null;
  }
  return element;
});
if (process.env.NODE_ENV !== "production") CollapsiblePanel.displayName = "CollapsiblePanel";