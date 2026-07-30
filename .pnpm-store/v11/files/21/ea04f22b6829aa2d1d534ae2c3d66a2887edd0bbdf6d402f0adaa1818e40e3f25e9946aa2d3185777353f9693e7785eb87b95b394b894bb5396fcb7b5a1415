"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DialogInteractions = DialogInteractions;
exports.useDialogRoot = useDialogRoot;
var React = _interopRequireWildcard(require("react"));
var _useScrollLock = require("@base-ui/utils/useScrollLock");
var _empty = require("@base-ui/utils/empty");
var _floatingUiReact = require("../../floating-ui-react");
var _utils = require("../../floating-ui-react/utils");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
var _popups = require("../../utils/popups");
function useDialogRoot(params) {
  const {
    store,
    actionsRef
  } = params;
  const open = store.useState('open');
  (0, _popups.usePopupRootSync)(store, open);
  (0, _popups.useImplicitActiveTrigger)(store);
  const {
    forceUnmount
  } = (0, _popups.useOpenStateTransitions)(open, store);
  const handleImperativeClose = React.useCallback(() => {
    store.setOpen(false, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.imperativeAction));
  }, [store]);
  React.useImperativeHandle(actionsRef, () => ({
    unmount: forceUnmount,
    close: handleImperativeClose
  }), [forceUnmount, handleImperativeClose]);
}
function DialogInteractions({
  store,
  parentContext,
  isDrawer
}) {
  const open = store.useState('open');
  const disablePointerDismissal = store.useState('disablePointerDismissal');
  const modal = store.useState('modal');
  const popupElement = store.useState('popupElement');
  const floatingRootContext = store.useState('floatingRootContext');
  const [ownNestedOpenDialogs, setOwnNestedOpenDialogs] = React.useState(0);
  const [ownNestedOpenDrawers, setOwnNestedOpenDrawers] = React.useState(0);
  const isTopmost = ownNestedOpenDialogs === 0;
  const dismiss = (0, _floatingUiReact.useDismiss)(floatingRootContext, {
    outsidePressEvent() {
      if (store.context.internalBackdropRef.current || store.context.backdropRef.current) {
        return 'intentional';
      }
      // Ensure `aria-hidden` on outside elements is removed immediately
      // on outside press when trapping focus.
      return {
        mouse: modal === 'trap-focus' ? 'sloppy' : 'intentional',
        touch: 'sloppy'
      };
    },
    outsidePress(event) {
      if (!store.context.outsidePressEnabledRef.current) {
        return false;
      }

      // For mouse events, only accept left button (button 0)
      // For touch events, a single touch is equivalent to left button
      if ('button' in event && event.button !== 0) {
        return false;
      }
      if ('touches' in event && event.touches.length !== 1) {
        return false;
      }
      const target = (0, _utils.getTarget)(event);
      if (isTopmost && !disablePointerDismissal) {
        // Only close if the click occurred on the dialog's owning backdrop.
        // This supports multiple modal dialogs that aren't nested in the React tree:
        // https://github.com/mui/base-ui/issues/1320
        if (modal) {
          return store.context.internalBackdropRef.current || store.context.backdropRef.current ? store.context.internalBackdropRef.current === target || store.context.backdropRef.current === target || (0, _utils.contains)(target, popupElement) && !target?.hasAttribute('data-base-ui-portal') : true;
        }
        return true;
      }
      return false;
    },
    escapeKey: isTopmost
  });
  (0, _useScrollLock.useScrollLock)(open && modal === true, popupElement);

  // Listen for nested open/close events on this store to maintain the counts.
  store.useContextCallback('onNestedDialogOpen', (dialogCount, drawerCount) => {
    setOwnNestedOpenDialogs(dialogCount);
    setOwnNestedOpenDrawers(drawerCount);
  });
  store.useContextCallback('onNestedDialogClose', () => {
    setOwnNestedOpenDialogs(0);
    setOwnNestedOpenDrawers(0);
  });

  // Notify parent of our open/close state using parent callbacks, if any
  React.useEffect(() => {
    if (parentContext?.onNestedDialogOpen && open) {
      parentContext.onNestedDialogOpen(ownNestedOpenDialogs + 1, ownNestedOpenDrawers + (isDrawer ? 1 : 0));
    }
    if (parentContext?.onNestedDialogClose && !open) {
      parentContext.onNestedDialogClose();
    }
    return () => {
      if (parentContext?.onNestedDialogClose && open) {
        parentContext.onNestedDialogClose();
      }
    };
  }, [isDrawer, open, ownNestedOpenDialogs, ownNestedOpenDrawers, parentContext]);
  const activeTriggerProps = dismiss.reference ?? _empty.EMPTY_OBJECT;
  const inactiveTriggerProps = dismiss.trigger ?? _empty.EMPTY_OBJECT;
  // Consumers (DialogPopup/DrawerPopup) already spread `FOCUSABLE_POPUP_PROPS`
  // directly, so the popup props only need to carry the dismiss handlers.
  const popupProps = dismiss.floating ?? _empty.EMPTY_OBJECT;
  (0, _popups.usePopupInteractionProps)(store, {
    activeTriggerProps,
    inactiveTriggerProps,
    popupProps,
    nestedOpenDialogCount: ownNestedOpenDialogs,
    nestedOpenDrawerCount: ownNestedOpenDrawers
  });
  return null;
}