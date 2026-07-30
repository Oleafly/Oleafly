"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MenuSubmenuTrigger = void 0;
var _formatErrorMessage2 = _interopRequireDefault(require("@base-ui/utils/formatErrorMessage"));
var React = _interopRequireWildcard(require("react"));
var _isElementDisabled = require("@base-ui/utils/isElementDisabled");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _warn = require("@base-ui/utils/warn");
var _safeReact = require("@base-ui/utils/safeReact");
var _empty = require("@base-ui/utils/empty");
var _floatingUiReact = require("../../floating-ui-react");
var _MenuRootContext = require("../root/MenuRootContext");
var _useBaseUiId = require("../../internals/useBaseUiId");
var _popupStateMapping = require("../../utils/popupStateMapping");
var _useCompositeListItem = require("../../internals/composite/list/useCompositeListItem");
var _useMenuItem = require("../item/useMenuItem");
var _useRenderElement = require("../../internals/useRenderElement");
var _MenuPositionerContext = require("../positioner/MenuPositionerContext");
var _popups = require("../../utils/popups");
var _MenuSubmenuRootContext = require("../submenu-root/MenuSubmenuRootContext");
/**
 * A menu item that opens a submenu.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Menu](https://base-ui.com/react/components/menu)
 */
const MenuSubmenuTrigger = exports.MenuSubmenuTrigger = /*#__PURE__*/React.forwardRef(function MenuSubmenuTrigger(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    label,
    id: idProp,
    nativeButton = false,
    openOnHover = true,
    delay = 100,
    closeDelay = 0,
    disabled: disabledProp = false,
    ...elementProps
  } = componentProps;
  const listItem = (0, _useCompositeListItem.useCompositeListItem)({
    label
  });
  const menuPositionerContext = (0, _MenuPositionerContext.useMenuPositionerContext)();
  const {
    store
  } = (0, _MenuRootContext.useMenuRootContext)();
  const thisTriggerId = (0, _useBaseUiId.useBaseUiId)(idProp);
  const open = store.useState('open');
  const floatingRootContext = store.useState('floatingRootContext');
  const floatingTreeRoot = store.useState('floatingTreeRoot');
  const popupId = store.useState('triggerPopupId', thisTriggerId);
  const baseRegisterTrigger = (0, _popups.useTriggerRegistration)(thisTriggerId, store);
  const registerTrigger = React.useCallback(element => {
    const cleanup = baseRegisterTrigger(element);
    if (element !== null && store.select('open') && store.select('activeTriggerId') == null) {
      store.update({
        activeTriggerId: thisTriggerId,
        activeTriggerElement: element,
        closeDelay
      });
    }
    return cleanup;
  }, [baseRegisterTrigger, closeDelay, store, thisTriggerId]);
  const triggerElementRef = React.useRef(null);
  const handleTriggerElementRef = React.useCallback(el => {
    triggerElementRef.current = el;
    store.set('activeTriggerElement', el);
  }, [store]);
  const submenuRootContext = (0, _MenuSubmenuRootContext.useMenuSubmenuRootContext)();
  if (!submenuRootContext?.parentMenu) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: <Menu.SubmenuTrigger> must be placed in <Menu.SubmenuRoot>.' : (0, _formatErrorMessage2.default)(37));
  }
  store.useSyncedValue('closeDelay', closeDelay);
  const parentMenuStore = submenuRootContext.parentMenu;
  const rootDisabled = store.useState('disabled');
  const parentDisabled = parentMenuStore.useState('disabled');
  const disabled = disabledProp || rootDisabled || parentDisabled;
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
      const element = triggerElementRef.current;
      if (element && (0, _isElementDisabled.isElementDisabled)(element) && !disabled) {
        const ownerStackMessage = _safeReact.SafeReact.captureOwnerStack?.() || '';
        (0, _warn.warn)(`A disabled element was detected on <Menu.SubmenuTrigger>. To properly disable the trigger, use the \`disabled\` prop on the component instead of setting it on the rendered element.${ownerStackMessage}`);
      }
    });
  }
  const itemProps = parentMenuStore.useState('itemProps');
  const highlighted = parentMenuStore.useState('isActive', listItem.index);
  const itemMetadata = React.useMemo(() => ({
    type: 'submenu-trigger',
    setActive() {
      if (parentMenuStore.select('highlightItemOnHover')) {
        parentMenuStore.set('activeIndex', listItem.index);
      }
    }
  }), [parentMenuStore, listItem.index]);
  const {
    getItemProps,
    itemRef
  } = (0, _useMenuItem.useMenuItem)({
    closeOnClick: false,
    disabled,
    highlighted,
    id: thisTriggerId,
    store,
    typingRef: parentMenuStore.context.typingRef,
    nativeButton,
    itemMetadata,
    nodeId: menuPositionerContext?.context.nodeId
  });
  const hoverEnabled = store.useState('hoverEnabled');
  const hoverProps = (0, _floatingUiReact.useHoverReferenceInteraction)(floatingRootContext, {
    enabled: hoverEnabled && openOnHover && !disabled,
    handleClose: (0, _floatingUiReact.safePolygon)({
      blockPointerEvents: true
    }),
    mouseOnly: true,
    move: true,
    restMs: delay,
    delay: {
      open: delay,
      close: closeDelay
    },
    shouldOpen: delay > 0 ? () => parentMenuStore.select('allowMouseEnter') : undefined,
    triggerElementRef,
    externalTree: floatingTreeRoot,
    isClosing: () => store.select('transitionStatus') === 'ending'
  });
  const click = (0, _floatingUiReact.useClick)(floatingRootContext, {
    enabled: !disabled,
    event: 'mousedown',
    toggle: !openOnHover,
    ignoreMouse: openOnHover,
    stickIfOpen: false
  });
  const localInteractionProps = click.reference ?? _empty.EMPTY_OBJECT;
  const rootTriggerProps = store.useState('triggerProps', true);
  delete rootTriggerProps.id;
  const state = {
    disabled,
    highlighted,
    open
  };
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    state,
    stateAttributesMapping: _popupStateMapping.triggerOpenStateMapping,
    props: [localInteractionProps, hoverProps, rootTriggerProps, itemProps, {
      'aria-controls': popupId,
      tabIndex: open || highlighted ? 0 : -1,
      onBlur() {
        if (highlighted) {
          parentMenuStore.set('activeIndex', null);
        }
      }
    }, elementProps, getItemProps],
    ref: [forwardedRef, listItem.ref, itemRef, registerTrigger, handleTriggerElementRef]
  });
  return element;
});
if (process.env.NODE_ENV !== "production") MenuSubmenuTrigger.displayName = "MenuSubmenuTrigger";