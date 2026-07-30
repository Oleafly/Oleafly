'use client';

import * as React from 'react';
import { ownerDocument } from '@base-ui/utils/owner';
import { useTimeout } from '@base-ui/utils/useTimeout';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { useValueAsRef } from '@base-ui/utils/useValueAsRef';
import { useStore } from '@base-ui/utils/store';
import { useSelectRootContext } from "../root/SelectRootContext.mjs";
import { useFieldRootContext } from "../../internals/field-root-context/FieldRootContext.mjs";
import { useLabelableContext } from "../../internals/labelable-provider/LabelableContext.mjs";
import { pressableTriggerOpenStateMapping } from "../../utils/popupStateMapping.mjs";
import { fieldValidityMapping } from "../../internals/field-constants/constants.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { selectors } from "../store.mjs";
import { getPseudoElementBounds } from "../../utils/getPseudoElementBounds.mjs";
import { contains, getFloatingFocusElement } from "../../floating-ui-react/utils.mjs";
import { mergeProps } from "../../merge-props/index.mjs";
import { useButton } from "../../internals/use-button/index.mjs";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { useLabelableId } from "../../internals/labelable-provider/useLabelableId.mjs";
import { resolveAriaLabelledBy } from "../../utils/resolveAriaLabelledBy.mjs";
const BOUNDARY_OFFSET = 2;
const SELECTED_DELAY = 400;
const stateAttributesMapping = {
  ...pressableTriggerOpenStateMapping,
  ...fieldValidityMapping,
  popupSide: side => side ? {
    'data-popup-side': side
  } : null,
  value: () => null
};

/**
 * A button that opens the select popup.
 * Renders a `<button>` element.
 *
 * Documentation: [Base UI Select](https://base-ui.com/react/components/select)
 */
export const SelectTrigger = /*#__PURE__*/React.forwardRef(function SelectTrigger(componentProps, forwardedRef) {
  const {
    render,
    className,
    id: idProp,
    disabled: disabledProp = false,
    nativeButton = true,
    style,
    ...elementProps
  } = componentProps;
  const {
    setTouched,
    setFocused,
    validationMode,
    state: fieldState,
    disabled: fieldDisabled
  } = useFieldRootContext();
  const {
    labelId: fieldLabelId
  } = useLabelableContext();
  const {
    store,
    setOpen,
    selectionRef,
    validation,
    readOnly,
    required,
    alignItemWithTriggerActiveRef,
    disabled: selectDisabled
  } = useSelectRootContext();
  const disabled = fieldDisabled || selectDisabled || disabledProp;
  const open = useStore(store, selectors.open);
  const mounted = useStore(store, selectors.mounted);
  const value = useStore(store, selectors.value);
  const triggerProps = useStore(store, selectors.triggerProps);
  const positionerElement = useStore(store, selectors.positionerElement);
  const listElement = useStore(store, selectors.listElement);
  const popupSideValue = useStore(store, selectors.popupSide);
  const rootId = useStore(store, selectors.id);
  const selectLabelId = useStore(store, selectors.labelId);
  const hasSelectedValue = useStore(store, selectors.hasSelectedValue);
  const popupSide = mounted && positionerElement ? popupSideValue : null;
  const id = idProp ?? rootId;
  const ariaLabelledBy = resolveAriaLabelledBy(fieldLabelId, selectLabelId);
  useLabelableId({
    id
  });
  const positionerRef = useValueAsRef(positionerElement);
  const triggerRef = React.useRef(null);
  const {
    getButtonProps,
    buttonRef
  } = useButton({
    disabled,
    native: nativeButton
  });
  const setTriggerElement = useStableCallback(element => {
    store.set('triggerElement', element);
  });
  const timeoutFocus = useTimeout();
  const timeoutMouseDown = useTimeout();
  const selectedDelayTimeout = useTimeout();
  React.useEffect(() => {
    if (open) {
      // A mousedown on the trigger can open the popup under the cursor. Keep mouseup selection
      // disabled briefly so releasing over either the selected item or a neighboring item doesn't
      // commit an accidental selection. SelectItem can still opt into unselected mouseup sooner
      // after a real drag over the item.
      selectedDelayTimeout.start(SELECTED_DELAY, () => {
        selectionRef.current.allowUnselectedMouseUp = true;
        selectionRef.current.allowSelectedMouseUp = true;
      });
      return () => {
        selectedDelayTimeout.clear();
      };
    }
    selectionRef.current = {
      allowSelectedMouseUp: false,
      allowUnselectedMouseUp: false,
      dragY: 0
    };
    timeoutMouseDown.clear();
    return undefined;
  }, [open, selectionRef, timeoutMouseDown, selectedDelayTimeout]);
  const mergedProps = mergeProps(triggerProps, {
    id,
    role: 'combobox',
    'aria-expanded': open ? 'true' : 'false',
    'aria-haspopup': 'listbox',
    'aria-controls': open ? listElement?.id ?? getFloatingFocusElement(positionerElement)?.id : undefined,
    'aria-labelledby': ariaLabelledBy,
    'aria-readonly': readOnly || undefined,
    'aria-required': required || undefined,
    tabIndex: disabled ? -1 : 0,
    onFocus(event) {
      setFocused(true);

      // The popup element shouldn't obscure the focused trigger.
      if (open && alignItemWithTriggerActiveRef.current) {
        setOpen(false, createChangeEventDetails(REASONS.none, event.nativeEvent));
      }

      // Saves a re-render on initial click: `forceMount === true` mounts
      // the items before `open === true`. We could sync those cycles better
      // without a timeout, but this is enough for now.
      timeoutFocus.start(0, () => {
        store.set('forceMount', true);
      });
    },
    onBlur(event) {
      // If focus is moving into the popup, don't count it as a blur.
      if (contains(positionerElement, event.relatedTarget)) {
        return;
      }
      setTouched(true);
      setFocused(false);
      if (validationMode === 'onBlur') {
        validation.commit(value);
      }
    },
    onMouseDown(event) {
      if (open) {
        return;
      }
      const doc = ownerDocument(event.currentTarget);
      function handleMouseUp(mouseEvent) {
        if (!triggerRef.current) {
          return;
        }
        const mouseUpTarget = mouseEvent.target;

        // Don't treat the release as an outside press when it lands on the trigger or inside
        // the popup positioner (or their children).
        if (contains(triggerRef.current, mouseUpTarget) || contains(positionerRef.current, mouseUpTarget)) {
          return;
        }
        const bounds = getPseudoElementBounds(triggerRef.current);
        if (mouseEvent.clientX >= bounds.left - BOUNDARY_OFFSET && mouseEvent.clientX <= bounds.right + BOUNDARY_OFFSET && mouseEvent.clientY >= bounds.top - BOUNDARY_OFFSET && mouseEvent.clientY <= bounds.bottom + BOUNDARY_OFFSET) {
          return;
        }
        setOpen(false, createChangeEventDetails(REASONS.cancelOpen, mouseEvent));
      }

      // Firefox can fire this upon mousedown
      timeoutMouseDown.start(0, () => {
        doc.addEventListener('mouseup', handleMouseUp, {
          once: true
        });
      });
    }
  }, elementProps, getButtonProps);
  const props = validation.getValidationProps(disabled, mergedProps);

  // ensure nested useButton does not overwrite the combobox role:
  // <Toolbar.Button render={<Select.Trigger />} />
  props.role = 'combobox';
  const state = {
    ...fieldState,
    open,
    disabled,
    value,
    readOnly,
    popupSide,
    placeholder: !hasSelectedValue
  };
  return useRenderElement('button', componentProps, {
    ref: [forwardedRef, triggerRef, buttonRef, setTriggerElement],
    state,
    stateAttributesMapping,
    props
  });
});
if (process.env.NODE_ENV !== "production") SelectTrigger.displayName = "SelectTrigger";