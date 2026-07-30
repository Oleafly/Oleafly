"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.selectors = exports.ToastStore = void 0;
var _store = require("@base-ui/utils/store");
var _generateId = require("@base-ui/utils/generateId");
var _owner = require("@base-ui/utils/owner");
var _useTimeout = require("@base-ui/utils/useTimeout");
var _resolvePromiseOptions = require("./utils/resolvePromiseOptions");
var _utils = require("../floating-ui-react/utils");
var _focusVisible = require("./utils/focusVisible");
function createToastMetadata(toasts) {
  const metadata = new Map();
  let visibleIndex = 0;
  let offsetY = 0;
  toasts.forEach((toast, toastIndex) => {
    const isEnding = toast.transitionStatus === 'ending';
    metadata.set(toast.id, {
      value: toast,
      domIndex: toastIndex,
      visibleIndex: isEnding ? -1 : visibleIndex,
      offsetY
    });
    offsetY += toast.height || 0;
    if (!isEnding) {
      visibleIndex += 1;
    }
  });
  return metadata;
}

// Marks the active (non-ending) toasts beyond `limit` as limited. Callers pass
// toasts in newest-first order, so the newest `limit` toasts stay visible and
// the rest are flagged. Returns the same toast reference when its `limited`
// flag is unchanged to avoid unnecessary re-renders.
function applyLimited(toasts, limit) {
  let activeIndex = 0;
  return toasts.map(toast => {
    if (toast.transitionStatus === 'ending') {
      return toast;
    }
    const limited = activeIndex >= limit;
    activeIndex += 1;
    return toast.limited === limited ? toast : {
      ...toast,
      limited
    };
  });
}
const toastMetadataSelector = state => state.toastMetadata;
const selectors = exports.selectors = {
  toasts: (0, _store.createSelector)(state => state.toasts),
  isEmpty: (0, _store.createSelector)(state => state.toasts.length === 0),
  toast: (0, _store.createSelector)(toastMetadataSelector, (toastMetadata, id) => toastMetadata.get(id)?.value),
  toastIndex: (0, _store.createSelector)(toastMetadataSelector, (toastMetadata, id) => toastMetadata.get(id)?.domIndex ?? -1),
  toastOffsetY: (0, _store.createSelector)(toastMetadataSelector, (toastMetadata, id) => toastMetadata.get(id)?.offsetY ?? 0),
  toastVisibleIndex: (0, _store.createSelector)(toastMetadataSelector, (toastMetadata, id) => toastMetadata.get(id)?.visibleIndex ?? -1),
  hovering: (0, _store.createSelector)(state => state.hovering),
  focused: (0, _store.createSelector)(state => state.focused),
  expanded: (0, _store.createSelector)(state => state.hovering || state.focused),
  expandedOrOutOfFocus: (0, _store.createSelector)(state => state.hovering || state.focused || !state.isWindowFocused),
  prevFocusElement: (0, _store.createSelector)(state => state.prevFocusElement)
};
class ToastStore extends _store.ReactStore {
  timers = new Map();
  areTimersPaused = false;
  constructor(initialState) {
    super({
      ...initialState,
      toastMetadata: createToastMetadata(initialState.toasts)
    }, {}, selectors);
  }
  setFocused(focused) {
    this.set('focused', focused);
  }
  setHovering(hovering) {
    this.set('hovering', hovering);
  }
  setIsWindowFocused(isWindowFocused) {
    this.set('isWindowFocused', isWindowFocused);
  }
  setPrevFocusElement(prevFocusElement) {
    this.set('prevFocusElement', prevFocusElement);
  }
  setViewport = viewport => {
    this.set('viewport', viewport);
  };
  syncProviderProps(props) {
    const limitChanged = this.state.limit !== props.limit;
    if (this.state.timeout === props.timeout && !limitChanged) {
      return;
    }
    const updates = {
      timeout: props.timeout,
      limit: props.limit
    };
    if (limitChanged) {
      const newToasts = applyLimited(this.state.toasts, props.limit);
      updates.toasts = newToasts;
      updates.toastMetadata = createToastMetadata(newToasts);
    }
    this.update(updates);
  }
  disposeEffect = () => {
    return () => {
      this.timers.forEach(timer => {
        timer.timeout?.clear();
      });
      this.timers.clear();
    };
  };
  removeToast(toastId, behavior = {}) {
    const index = selectors.toastIndex(this.state, toastId);
    if (index === -1) {
      return;
    }
    const toast = this.state.toasts[index];
    if (!behavior.skipOnRemove) {
      toast?.onRemove?.();
    }
    const newToasts = [...this.state.toasts];
    newToasts.splice(index, 1);
    this.setToasts(newToasts);
  }
  addToast = toast => {
    const {
      timeout,
      limit
    } = this.state;
    const id = toast.id || (0, _generateId.generateId)('toast');
    if (toast.id) {
      const existingToast = selectors.toast(this.state, toast.id);
      if (existingToast) {
        if (existingToast.transitionStatus === 'ending') {
          this.removeToast(toast.id, {
            skipOnRemove: true
          });
        } else {
          const {
            id: ignoredId,
            transitionStatus: ignoredTransitionStatus,
            ...updates
          } = toast;
          this.updateToastInternal(toast.id, updates, {
            resetTimer: true,
            markUpdated: true
          });
          return toast.id;
        }
      }
    }
    const toastToAdd = {
      ...toast,
      id,
      updateKey: 0,
      transitionStatus: 'starting'
    };
    const updatedToasts = [toastToAdd, ...this.state.toasts];
    this.setToasts(applyLimited(updatedToasts, limit));
    const duration = toastToAdd.timeout ?? timeout;
    if (toastToAdd.type !== 'loading' && duration > 0) {
      this.scheduleTimer(id, duration, () => this.closeToast(id));
    }
    if (selectors.expandedOrOutOfFocus(this.state)) {
      this.pauseTimers();
    }
    return id;
  };
  updateToast = (id, updates) => {
    this.updateToastInternal(id, updates, {
      markUpdated: true
    });
  };
  updateToastInternal = (id, updates, behavior = {}) => {
    const {
      timeout,
      toasts
    } = this.state;
    const prevToast = selectors.toast(this.state, id) ?? null;
    if (!prevToast) {
      return;
    }

    // Ignore updates for toasts that are already closing.
    // This prevents races where async updates (e.g. promise success/error)
    // can block a dismissal from completing.
    if (prevToast.transitionStatus === 'ending') {
      return;
    }
    const nextToast = {
      ...prevToast,
      ...updates,
      ...(behavior.markUpdated && {
        updateKey: (prevToast.updateKey ?? 0) + 1
      })
    };
    this.setToasts(toasts.map(toast => toast.id === id ? nextToast : toast));
    const nextTimeout = nextToast.timeout ?? timeout;
    const prevTimeout = prevToast?.timeout ?? timeout;
    const timeoutUpdated = Object.hasOwn(updates, 'timeout');
    const shouldHaveTimer = nextToast.transitionStatus !== 'ending' && nextToast.type !== 'loading' && nextTimeout > 0;
    const hasTimer = this.timers.has(id);
    const timeoutChanged = prevTimeout !== nextTimeout;
    const wasLoading = prevToast?.type === 'loading';
    if (!shouldHaveTimer && hasTimer) {
      this.clearTimer(id);
      return;
    }

    // Schedule or reschedule timer if needed
    if (shouldHaveTimer && (!hasTimer || timeoutChanged || timeoutUpdated || wasLoading || behavior.resetTimer)) {
      this.clearTimer(id);
      this.scheduleTimer(id, nextTimeout, () => this.closeToast(id));
      if (selectors.expandedOrOutOfFocus(this.state)) {
        this.pauseTimers();
      }
    }
  };
  closeToast = toastId => {
    const closeAll = toastId === undefined;
    const {
      limit,
      toasts
    } = this.state;
    let toastsToClose;
    if (closeAll) {
      toastsToClose = toasts;
      this.clearTimers();
    } else {
      const toast = selectors.toast(this.state, toastId);
      if (!toast) {
        return;
      }
      toastsToClose = [toast];
      this.clearTimer(toastId);
    }
    const endingToasts = toasts.map(item => closeAll || item.id === toastId ? {
      ...item,
      transitionStatus: 'ending',
      height: 0
    } : item);
    const newToasts = applyLimited(endingToasts, limit);
    const updates = {
      toasts: newToasts,
      toastMetadata: createToastMetadata(newToasts)
    };
    const hasActiveToasts = newToasts.some(toast => toast.transitionStatus !== 'ending');
    if (!hasActiveToasts) {
      updates.hovering = false;
      updates.focused = false;
    }
    this.update(updates);
    toastsToClose.forEach(toast => {
      if (toast.transitionStatus !== 'ending') {
        toast.onClose?.();
      }
    });
    this.handleFocusManagement(toastId);
  };
  promiseToast = (promiseValue, options) => {
    // Create a loading toast (which does not auto-dismiss).
    const loadingOptions = (0, _resolvePromiseOptions.resolvePromiseOptions)(options.loading);
    const id = this.addToast({
      ...loadingOptions,
      type: 'loading'
    });
    const handledPromise = promiseValue.then(result => {
      const successOptions = (0, _resolvePromiseOptions.resolvePromiseOptions)(options.success, result);
      this.updateToast(id, {
        ...successOptions,
        type: 'success',
        timeout: successOptions.timeout
      });
      return result;
    }).catch(error => {
      const errorOptions = (0, _resolvePromiseOptions.resolvePromiseOptions)(options.error, error);
      this.updateToast(id, {
        ...errorOptions,
        type: 'error',
        timeout: errorOptions.timeout
      });
      return Promise.reject(error);
    });

    // Private API used exclusively by `Manager` to handoff the promise
    // back to the manager after it's handled here.
    if ({}.hasOwnProperty.call(options, 'setPromise')) {
      options.setPromise(handledPromise);
    }
    return handledPromise;
  };
  pauseTimers() {
    if (this.areTimersPaused) {
      return;
    }
    this.areTimersPaused = true;
    this.timers.forEach(timer => {
      if (timer.timeout) {
        timer.timeout.clear();
        const elapsed = Date.now() - timer.start;
        const remaining = timer.delay - elapsed;
        timer.remaining = remaining > 0 ? remaining : 0;
      }
    });
  }
  resumeTimers() {
    if (!this.areTimersPaused) {
      return;
    }
    this.areTimersPaused = false;
    this.timers.forEach((timer, id) => {
      timer.remaining = timer.remaining > 0 ? timer.remaining : timer.delay;
      timer.timeout ??= _useTimeout.Timeout.create();
      timer.timeout.start(timer.remaining, () => {
        this.handleTimerFired(id);
        timer.callback();
      });
      timer.start = Date.now();
    });
  }
  restoreFocusToPrevElement() {
    this.state.prevFocusElement?.focus({
      preventScroll: true
    });
  }
  handleDocumentPointerDown = event => {
    if (event.pointerType !== 'touch') {
      return;
    }
    const target = (0, _utils.getTarget)(event);
    if ((0, _utils.contains)(this.state.viewport, target)) {
      return;
    }

    // This is explicit touch activity outside the viewport, so the paused
    // interaction state should end even if the window focus state is unchanged.
    this.resumeTimers();
    this.update({
      hovering: false,
      focused: false
    });
  };
  scheduleTimer(id, delay, callback) {
    const start = Date.now();
    const shouldStartActive = !selectors.expandedOrOutOfFocus(this.state);
    const currentTimeout = shouldStartActive ? _useTimeout.Timeout.create() : undefined;
    currentTimeout?.start(delay, () => {
      this.handleTimerFired(id);
      callback();
    });
    this.timers.set(id, {
      timeout: currentTimeout,
      start: shouldStartActive ? start : 0,
      delay,
      remaining: delay,
      callback
    });
  }
  clearTimers() {
    this.timers.forEach(timer => {
      timer.timeout?.clear();
    });
    this.timers.clear();
    this.areTimersPaused = false;
  }
  clearTimer(id) {
    const timer = this.timers.get(id);
    timer?.timeout?.clear();
    this.timers.delete(id);
    this.resetPausedStateIfNoTimersRemain();
  }
  handleTimerFired(id) {
    this.timers.delete(id);
    this.resetPausedStateIfNoTimersRemain();
  }
  resetPausedStateIfNoTimersRemain() {
    if (this.timers.size === 0) {
      // No timers remain to keep paused; clear the flag so a fresh toast's
      // running timer can be paused again on hover/focus.
      this.areTimersPaused = false;
    }
  }
  setToasts(newToasts) {
    const updates = {
      toasts: newToasts,
      toastMetadata: createToastMetadata(newToasts)
    };
    if (newToasts.length === 0) {
      updates.hovering = false;
      updates.focused = false;
    }
    this.update(updates);
  }
  handleFocusManagement(toastId) {
    const activeEl = (0, _utils.activeElement)((0, _owner.ownerDocument)(this.state.viewport));
    if (!this.state.viewport || !(0, _utils.contains)(this.state.viewport, activeEl) || !(0, _focusVisible.isFocusVisible)(activeEl)) {
      return;
    }
    if (toastId === undefined) {
      this.restoreFocusToPrevElement();
      return;
    }
    const toasts = selectors.toasts(this.state);
    const currentIndex = selectors.toastIndex(this.state, toastId);
    let nextToast = null;

    // Try to find the next toast that isn't animating out
    let index = currentIndex + 1;
    while (index < toasts.length) {
      if (toasts[index].transitionStatus !== 'ending') {
        nextToast = toasts[index];
        break;
      }
      index += 1;
    }

    // Go backwards if no next toast is found
    if (!nextToast) {
      index = currentIndex - 1;
      while (index >= 0) {
        if (toasts[index].transitionStatus !== 'ending') {
          nextToast = toasts[index];
          break;
        }
        index -= 1;
      }
    }
    if (nextToast) {
      nextToast.ref?.current?.focus();
    } else {
      this.restoreFocusToPrevElement();
    }
  }
}
exports.ToastStore = ToastStore;