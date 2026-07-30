'use client';

import * as React from 'react';
import { useStore } from '@base-ui/utils/store';
import { useComboboxRootContext } from "../root/ComboboxRootContext.mjs";
import { popupStateMapping } from "../../utils/popupStateMapping.mjs";
import { transitionStatusMapping } from "../../internals/stateAttributesMapping.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { selectors } from "../store.mjs";
const stateAttributesMapping = {
  ...popupStateMapping,
  ...transitionStatusMapping
};

/**
 * An overlay displayed beneath the popup.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Combobox](https://base-ui.com/react/components/combobox)
 */
export const ComboboxBackdrop = /*#__PURE__*/React.forwardRef(function ComboboxBackdrop(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    ...elementProps
  } = componentProps;
  const store = useComboboxRootContext();
  const open = useStore(store, selectors.open);
  const mounted = useStore(store, selectors.mounted);
  const transitionStatus = useStore(store, selectors.transitionStatus);
  const state = {
    open,
    transitionStatus
  };
  return useRenderElement('div', componentProps, {
    state,
    ref: forwardedRef,
    stateAttributesMapping,
    props: [{
      role: 'presentation',
      hidden: !mounted,
      style: {
        userSelect: 'none',
        WebkitUserSelect: 'none'
      }
    }, elementProps]
  });
});
if (process.env.NODE_ENV !== "production") ComboboxBackdrop.displayName = "ComboboxBackdrop";