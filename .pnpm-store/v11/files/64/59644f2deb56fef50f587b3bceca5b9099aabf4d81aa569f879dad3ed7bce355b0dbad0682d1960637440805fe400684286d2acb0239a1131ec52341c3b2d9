'use client';

import * as React from 'react';
import { useSelectRootContext } from "../root/SelectRootContext.mjs";
import { useSelectItemContext } from "../item/SelectItemContext.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";

/**
 * A text label of the select item.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Select](https://base-ui.com/react/components/select)
 */
export const SelectItemText = /*#__PURE__*/React.memo(/*#__PURE__*/React.forwardRef(function SelectItemText(componentProps, forwardedRef) {
  const {
    index,
    textRef,
    selectedByFocus,
    hasRegistered
  } = useSelectItemContext();
  const {
    firstItemTextRef,
    selectedItemTextRef
  } = useSelectRootContext();
  const {
    render,
    className,
    style,
    ...elementProps
  } = componentProps;
  const localRef = React.useCallback(node => {
    if (!node) {
      return;
    }
    if (hasRegistered && index === 0) {
      firstItemTextRef.current = node;
    }
    if (hasRegistered && selectedByFocus) {
      selectedItemTextRef.current = node;
    }
  }, [firstItemTextRef, selectedItemTextRef, index, selectedByFocus, hasRegistered]);
  const element = useRenderElement('div', componentProps, {
    ref: [localRef, forwardedRef, textRef],
    props: elementProps
  });
  return element;
}));
if (process.env.NODE_ENV !== "production") SelectItemText.displayName = "SelectItemText";