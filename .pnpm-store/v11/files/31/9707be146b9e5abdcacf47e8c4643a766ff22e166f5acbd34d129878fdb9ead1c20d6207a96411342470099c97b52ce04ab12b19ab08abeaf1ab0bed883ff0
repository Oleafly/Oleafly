"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ToastViewport = void 0;
var React = _interopRequireWildcard(require("react"));
var _addEventListener = require("@base-ui/utils/addEventListener");
var _mergeCleanups = require("@base-ui/utils/mergeCleanups");
var _owner = require("@base-ui/utils/owner");
var _visuallyHidden = require("@base-ui/utils/visuallyHidden");
var _useTimeout = require("@base-ui/utils/useTimeout");
var _utils = require("../../floating-ui-react/utils");
var _FocusGuard = require("../../utils/FocusGuard");
var _ToastProviderContext = require("../provider/ToastProviderContext");
var _useRenderElement = require("../../internals/useRenderElement");
var _focusVisible = require("../utils/focusVisible");
var _ToastViewportCssVars = require("./ToastViewportCssVars");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * A container viewport for toasts.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Toast](https://base-ui.com/react/components/toast)
 */
const ToastViewport = exports.ToastViewport = /*#__PURE__*/React.forwardRef(function ToastViewport(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    children,
    ...elementProps
  } = componentProps;
  const store = (0, _ToastProviderContext.useToastProviderContext)();
  const windowFocusTimeout = (0, _useTimeout.useTimeout)();
  const handlingFocusGuardRef = React.useRef(false);
  const markedReadyForMouseLeaveRef = React.useRef(false);
  const touchActiveRef = React.useRef(false);
  const isEmpty = store.useState('isEmpty');
  const toasts = store.useState('toasts');
  const focused = store.useState('focused');
  const expanded = store.useState('expanded');
  const prevFocusElement = store.useState('prevFocusElement');
  const frontmostHeight = toasts[0]?.height ?? 0;
  const hasTransitioningToasts = React.useMemo(() => toasts.some(toast => toast.transitionStatus === 'ending'), [toasts]);
  const highPriorityToasts = React.useMemo(() => toasts.filter(toast => toast.priority === 'high'), [toasts]);

  // Listen globally for F6 so we can force-focus the viewport.
  React.useEffect(() => {
    const viewport = store.state.viewport;
    if (!viewport) {
      return undefined;
    }
    function handleGlobalKeyDown(event) {
      if (isEmpty) {
        return;
      }
      if (event.key === 'F6' && (0, _utils.getTarget)(event) !== viewport) {
        event.preventDefault();
        store.setPrevFocusElement((0, _utils.activeElement)((0, _owner.ownerDocument)(viewport)));
        viewport?.focus({
          preventScroll: true
        });
        store.pauseTimers();
        store.setFocused(true);
      }
    }
    const win = (0, _owner.ownerWindow)(viewport);
    return (0, _addEventListener.addEventListener)(win, 'keydown', handleGlobalKeyDown);
  }, [store, isEmpty]);
  React.useEffect(() => {
    const viewport = store.state.viewport;
    if (!viewport || isEmpty) {
      return undefined;
    }
    const win = (0, _owner.ownerWindow)(viewport);
    function handleWindowBlur(event) {
      if ((0, _utils.getTarget)(event) !== win) {
        return;
      }
      store.setIsWindowFocused(false);
      store.pauseTimers();
    }
    function handleWindowFocus(event) {
      if (event.relatedTarget) {
        return;
      }
      const target = (0, _utils.getTarget)(event);
      const activeEl = (0, _utils.activeElement)((0, _owner.ownerDocument)(viewport));
      if (target === win || !(0, _utils.contains)(viewport, target) || !(0, _focusVisible.isFocusVisible)(activeEl)) {
        store.resumeTimers();
      }

      // Wait for the `handleFocus` event to fire.
      windowFocusTimeout.start(0, () => store.setIsWindowFocused(true));
    }
    return (0, _mergeCleanups.mergeCleanups)((0, _addEventListener.addEventListener)(win, 'blur', handleWindowBlur, true), (0, _addEventListener.addEventListener)(win, 'focus', handleWindowFocus, true));
  }, [store, windowFocusTimeout,
  // `store.state.viewport` isn't available on the first render,
  // since the portal node hasn't yet been created.
  // By adding this dependency, we ensure the window listeners
  // are added when toasts have been created, once the ref is available.
  isEmpty]);
  React.useEffect(() => {
    const viewport = store.state.viewport;
    if (!viewport || isEmpty) {
      return undefined;
    }
    const doc = (0, _owner.ownerDocument)(viewport);
    return (0, _addEventListener.addEventListener)(doc, 'pointerdown', store.handleDocumentPointerDown, true);
  }, [isEmpty, store]);
  function handleFocusGuard(event) {
    const viewport = store.state.viewport;
    if (!viewport) {
      return;
    }
    handlingFocusGuardRef.current = true;

    // If we're coming off the container, move to the first toast that can hold
    // focus, skipping toasts that are animating out or inert because they're limited.
    if (event.relatedTarget === viewport) {
      const firstFocusableToast = toasts.find(toast => toast.transitionStatus !== 'ending' && !toast.limited);
      if (firstFocusableToast) {
        firstFocusableToast.ref?.current?.focus();
      } else {
        store.restoreFocusToPrevElement();
      }
    } else {
      store.restoreFocusToPrevElement();
    }
  }
  function handleKeyDown(event) {
    if (event.key === 'Tab' && event.shiftKey && (0, _utils.getTarget)(event.nativeEvent) === store.state.viewport) {
      event.preventDefault();
      store.restoreFocusToPrevElement();
      // Shift+Tab is explicit keyboard navigation out of the viewport.
      store.resumeTimers();
    }
  }
  function flushMouseLeave() {
    const hasEndingToasts = store.state.toasts.some(toast => toast.transitionStatus === 'ending');
    if (hasEndingToasts || touchActiveRef.current || !markedReadyForMouseLeaveRef.current) {
      return;
    }

    // Once transitions have finished, see if a mouseleave was already triggered
    // but blocked from taking effect. If so, we can now safely collapse the viewport
    // without restarting timers while the window is blurred.
    if (store.state.isWindowFocused) {
      store.resumeTimers();
    }
    store.setHovering(false);
    markedReadyForMouseLeaveRef.current = false;
  }
  React.useEffect(flushMouseLeave, [hasTransitioningToasts, store]);
  function handleMouseEnter() {
    store.pauseTimers();
    store.setHovering(true);
    markedReadyForMouseLeaveRef.current = false;
  }
  function resumeTimersIfWindowFocused() {
    if (store.state.isWindowFocused) {
      store.resumeTimers();
    }
  }
  function handleMouseLeave() {
    const hasEndingToasts = store.state.toasts.some(toast => toast.transitionStatus === 'ending');
    if (hasEndingToasts || touchActiveRef.current) {
      // When swiping to dismiss, wait until the transitions have settled
      // or the touch interaction ends to avoid collapsing mid-gesture.
      markedReadyForMouseLeaveRef.current = true;
    } else {
      resumeTimersIfWindowFocused();
      store.setHovering(false);
    }
  }
  function handlePointerDown(event) {
    if (event.pointerType === 'touch') {
      touchActiveRef.current = true;
    }
  }
  function handlePointerEnd(event) {
    if (event.pointerType !== 'touch') {
      return;
    }
    touchActiveRef.current = false;
    flushMouseLeave();
  }
  function handleFocus() {
    if (handlingFocusGuardRef.current) {
      handlingFocusGuardRef.current = false;
      return;
    }
    if (focused) {
      return;
    }

    // Only set focused when the active element is focus-visible.
    // This prevents the viewport from staying expanded when clicking inside without
    // keyboard navigation.
    if ((0, _focusVisible.isFocusVisible)((0, _utils.activeElement)((0, _owner.ownerDocument)(store.state.viewport)))) {
      store.setFocused(true);
      store.pauseTimers();
    }
  }
  function handleBlur(event) {
    if (!focused || (0, _utils.contains)(store.state.viewport, event.relatedTarget)) {
      return;
    }
    store.setFocused(false);
    resumeTimersIfWindowFocused();
  }
  const defaultProps = {
    tabIndex: -1,
    role: 'region',
    'aria-live': 'polite',
    'aria-atomic': false,
    'aria-relevant': 'additions text',
    'aria-label': 'Notifications',
    onMouseEnter: handleMouseEnter,
    onMouseMove: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    onFocus: handleFocus,
    onBlur: handleBlur,
    onKeyDown: handleKeyDown,
    onClick: handleFocus,
    onPointerDown: handlePointerDown,
    onPointerUp: handlePointerEnd,
    onPointerCancel: handlePointerEnd
  };
  const state = {
    expanded
  };
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    ref: [forwardedRef, store.setViewport],
    state,
    props: [defaultProps, {
      style: {
        [_ToastViewportCssVars.ToastViewportCssVars.frontmostHeight]: frontmostHeight ? `${frontmostHeight}px` : undefined
      }
    }, elementProps, {
      children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(React.Fragment, {
        children: [!isEmpty && prevFocusElement && /*#__PURE__*/(0, _jsxRuntime.jsx)(_FocusGuard.FocusGuard, {
          onFocus: handleFocusGuard
        }), children, !isEmpty && prevFocusElement && /*#__PURE__*/(0, _jsxRuntime.jsx)(_FocusGuard.FocusGuard, {
          onFocus: handleFocusGuard
        })]
      })
    }]
  });
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(React.Fragment, {
    children: [!isEmpty && prevFocusElement && /*#__PURE__*/(0, _jsxRuntime.jsx)(_FocusGuard.FocusGuard, {
      onFocus: handleFocusGuard
    }), element, !focused && highPriorityToasts.length > 0 && /*#__PURE__*/(0, _jsxRuntime.jsx)("div", {
      style: _visuallyHidden.visuallyHidden,
      children: highPriorityToasts.map(toast => /*#__PURE__*/(0, _jsxRuntime.jsxs)("div", {
        role: "alert",
        "aria-atomic": true,
        children: [/*#__PURE__*/(0, _jsxRuntime.jsx)("div", {
          children: toast.title
        }), /*#__PURE__*/(0, _jsxRuntime.jsx)("div", {
          children: toast.description
        })]
      }, toast.id))
    })]
  });
});
if (process.env.NODE_ENV !== "production") ToastViewport.displayName = "ToastViewport";