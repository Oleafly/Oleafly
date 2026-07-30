'use client';

import * as React from 'react';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { useBaseUiId } from "../../internals/useBaseUiId.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { useFieldsetRootContext } from "../root/FieldsetRootContext.mjs";
/**
 * An accessible label that is automatically associated with the fieldset.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Fieldset](https://base-ui.com/react/components/fieldset)
 */
export const FieldsetLegend = /*#__PURE__*/React.forwardRef(function FieldsetLegend(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    id: idProp,
    ...elementProps
  } = componentProps;
  const {
    disabled,
    setLegendId
  } = useFieldsetRootContext();
  const id = useBaseUiId(idProp);
  useIsoLayoutEffect(() => {
    setLegendId(id);
    return () => {
      setLegendId(undefined);
    };
  }, [setLegendId, id]);
  const state = {
    disabled: disabled ?? false
  };
  const element = useRenderElement('div', componentProps, {
    state,
    ref: forwardedRef,
    props: [{
      id
    }, elementProps]
  });
  return element;
});
if (process.env.NODE_ENV !== "production") FieldsetLegend.displayName = "FieldsetLegend";