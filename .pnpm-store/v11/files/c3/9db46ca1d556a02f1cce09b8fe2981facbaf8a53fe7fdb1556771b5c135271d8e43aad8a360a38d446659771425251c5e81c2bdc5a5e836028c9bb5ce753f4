'use client';

import * as React from 'react';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { useId } from '@base-ui/utils/useId';
import { useToastRootContext } from "../root/ToastRootContext.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";

/**
 * A title that labels the toast.
 * Renders an `<h2>` element.
 *
 * Documentation: [Base UI Toast](https://base-ui.com/react/components/toast)
 */
export const ToastTitle = /*#__PURE__*/React.forwardRef(function ToastTitle(componentProps, forwardedRef) {
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
    setTitleId
  } = useToastRootContext();
  const children = childrenProp ?? toast.title;
  const shouldRender = Boolean(children);
  const id = useId(idProp);
  useIsoLayoutEffect(() => {
    if (!shouldRender) {
      return undefined;
    }
    setTitleId(id);
    return () => {
      setTitleId(undefined);
    };
  }, [shouldRender, id, setTitleId]);
  const state = {
    type: toast.type
  };
  const element = useRenderElement('h2', componentProps, {
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
if (process.env.NODE_ENV !== "production") ToastTitle.displayName = "ToastTitle";