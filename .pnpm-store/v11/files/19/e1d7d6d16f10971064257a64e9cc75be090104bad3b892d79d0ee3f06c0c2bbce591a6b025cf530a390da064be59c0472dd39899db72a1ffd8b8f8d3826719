import { isElement } from '@floating-ui/utils/dom';
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { getTarget, isInteractiveElement } from "../../floating-ui-react/utils/element.mjs";
export function handleInputPress(event, store, disabled, readOnly, shouldIgnoreTarget) {
  if (event.baseUIHandlerPrevented || readOnly) {
    return;
  }
  const target = getTarget(event.nativeEvent);
  const targetElement = isElement(target) ? target : null;
  if (targetElement !== event.currentTarget && (shouldIgnoreTarget?.(targetElement) || isInteractiveElement(targetElement))) {
    return;
  }
  event.preventDefault();
  if (disabled) {
    return;
  }
  store.state.inputRef.current?.focus();
  if (store.state.openOnInputClick) {
    store.state.setOpen(true, createChangeEventDetails(REASONS.inputPress, event.nativeEvent));
  }
}