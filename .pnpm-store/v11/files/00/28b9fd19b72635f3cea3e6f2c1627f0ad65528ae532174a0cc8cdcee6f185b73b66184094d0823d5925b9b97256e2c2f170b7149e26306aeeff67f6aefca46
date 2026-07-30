"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AccordionPanel = void 0;
var React = _interopRequireWildcard(require("react"));
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _warn = require("@base-ui/utils/warn");
var _resolveStyle = require("../../utils/resolveStyle");
var _CollapsibleRootContext = require("../../collapsible/root/CollapsibleRootContext");
var _useCollapsiblePanel = require("../../collapsible/panel/useCollapsiblePanel");
var _AccordionRootContext = require("../root/AccordionRootContext");
var _AccordionItemContext = require("../item/AccordionItemContext");
var _stateAttributesMapping = require("../item/stateAttributesMapping");
var _AccordionPanelCssVars = require("./AccordionPanelCssVars");
var _useRenderElement = require("../../internals/useRenderElement");
/**
 * A collapsible panel with the accordion item contents.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Accordion](https://base-ui.com/react/components/accordion)
 */
const AccordionPanel = exports.AccordionPanel = /*#__PURE__*/React.forwardRef(function AccordionPanel(componentProps, forwardedRef) {
  const {
    className,
    hiddenUntilFound: hiddenUntilFoundProp,
    keepMounted: keepMountedProp,
    id: idProp,
    render,
    style,
    ...elementProps
  } = componentProps;
  const {
    hiddenUntilFound: contextHiddenUntilFound,
    keepMounted: contextKeepMounted
  } = (0, _AccordionRootContext.useAccordionRootContext)();
  const {
    mounted,
    onOpenChange,
    open,
    panelId,
    setMounted,
    setOpen,
    setPanelIdState,
    transitionStatus
  } = (0, _CollapsibleRootContext.useCollapsibleRootContext)();
  const hiddenUntilFound = hiddenUntilFoundProp ?? contextHiddenUntilFound;
  const keepMounted = keepMountedProp ?? contextKeepMounted;
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
      if (keepMountedProp === false && hiddenUntilFound) {
        (0, _warn.warn)('The `keepMounted={false}` prop on an `Accordion.Panel` is ignored when `hiddenUntilFound` is enabled on the panel or root, since the panel must remain mounted while closed.');
      }
    }, [hiddenUntilFound, keepMountedProp]);
  }
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
    id: idProp ?? panelId,
    keepMounted,
    mounted,
    onOpenChange,
    open,
    setMounted,
    setOpen,
    transitionStatus
  });
  const {
    state,
    triggerId
  } = (0, _AccordionItemContext.useAccordionItemContext)();
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
      'aria-labelledby': triggerId,
      role: 'region',
      style: {
        [_AccordionPanelCssVars.AccordionPanelCssVars.accordionPanelHeight]: height === undefined ? 'auto' : `${height}px`,
        [_AccordionPanelCssVars.AccordionPanelCssVars.accordionPanelWidth]: width === undefined ? 'auto' : `${width}px`
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
    stateAttributesMapping: _stateAttributesMapping.accordionStateAttributesMapping
  });
  if (!shouldRender) {
    return null;
  }
  return element;
});
if (process.env.NODE_ENV !== "production") AccordionPanel.displayName = "AccordionPanel";