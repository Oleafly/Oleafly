'use client';

import * as React from 'react';
import { useId } from '@base-ui/utils/useId';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { useToastRootContext } from "../root/ToastRootContext.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";

/**
 * A description that describes the toast.
 * Can be used as the default message for the toast when no title is provided.
 * Renders a `<p>` element.
 *
 * Documentation: [Base UI Toast](https://base-ui.com/react/components/toast)
 */
export const ToastDescription = /*#__PURE__*/React.forwardRef(function ToastDescription(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    id: idProp,
    children: childrenProp,
    ...elementProps
  } = componentProps;
  const {
    toast,
    setDescriptionId
  } = useToastRootContext();
  const children = childrenProp ?? toast.description;
  const shouldRender = Boolean(children);
  const id = useId(idProp);
  useIsoLayoutEffect(() => {
    if (!shouldRender) {
      return undefined;
    }
    setDescriptionId(id);
    return () => {
      setDescriptionId(undefined);
    };
  }, [shouldRender, id, setDescriptionId]);
  const state = {
    type: toast.type
  };
  const element = useRenderElement('p', componentProps, {
    ref: forwardedRef,
    state,
    props: {
      ...elementProps,
      id,
      children
    }
  });
  if (!shouldRender) {
    return null;
  }
  return element;
});
if (process.env.NODE_ENV !== "production") ToastDescription.displayName = "ToastDescription";