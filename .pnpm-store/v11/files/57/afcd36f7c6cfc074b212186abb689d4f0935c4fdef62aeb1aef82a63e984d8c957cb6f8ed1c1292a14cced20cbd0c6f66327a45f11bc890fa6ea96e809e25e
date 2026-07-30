'use client';

import { EMPTY_OBJECT, EMPTY_ARRAY } from '@base-ui/utils/empty';
import { useRenderElement } from "../../useRenderElement.mjs";
import { useCompositeItem } from "./useCompositeItem.mjs";
/**
 * @internal
 */
export function CompositeItem(componentProps) {
  const {
    render,
    className,
    style,
    state = EMPTY_OBJECT,
    props = EMPTY_ARRAY,
    refs = EMPTY_ARRAY,
    metadata,
    stateAttributesMapping,
    tag = 'div',
    ...elementProps
  } = componentProps;
  const {
    compositeProps,
    compositeRef
  } = useCompositeItem({
    metadata
  });
  return useRenderElement(tag, componentProps, {
    state,
    ref: [...refs, compositeRef],
    props: [compositeProps, ...props, elementProps],
    stateAttributesMapping
  });
}