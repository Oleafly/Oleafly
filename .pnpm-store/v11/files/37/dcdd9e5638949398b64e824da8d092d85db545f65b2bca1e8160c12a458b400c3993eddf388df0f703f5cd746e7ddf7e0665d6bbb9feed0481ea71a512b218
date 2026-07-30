'use client';

import * as React from 'react';
import { useStore } from '@base-ui/utils/store';
import { useSelectRootContext } from "../root/SelectRootContext.mjs";
import { popupStateMapping } from "../../utils/popupStateMapping.mjs";
import { transitionStatusMapping } from "../../internals/stateAttributesMapping.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { selectors } from "../store.mjs";
const stateAttributesMapping = {
  ...popupStateMapping,
  ...transitionStatusMapping
};

/**
 * An overlay displayed beneath the select popup.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Select](https://base-ui.com/react/components/select)
 */
export const SelectBackdrop = /*#__PURE__*/React.forwardRef(function SelectBackdrop(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    ...elementProps
  } = componentProps;
  const {
    store
  } = useSelectRootContext();
  const open = useStore(store, selectors.open);
  const mounted = useStore(store, selectors.mounted);
  const transitionStatus = useStore(store, selectors.transitionStatus);
  const state = {
    open,
    transitionStatus
  };
  const element = useRenderElement('div', componentProps, {
    state,
    ref: forwardedRef,
    props: [{
      role: 'presentation',
      hidden: !mounted,
      style: {
        userSelect: 'none',
        WebkitUserSelect: 'none'
      }
    }, elementProps],
    stateAttributesMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") SelectBackdrop.displayName = "SelectBackdrop";