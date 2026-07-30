'use client';

import * as React from 'react';
import { usePreviewCardRootContext } from "../root/PreviewCardContext.mjs";
import { popupStateMapping as baseMapping } from "../../utils/popupStateMapping.mjs";
import { transitionStatusMapping } from "../../internals/stateAttributesMapping.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
const stateAttributesMapping = {
  ...baseMapping,
  ...transitionStatusMapping
};

/**
 * An overlay displayed beneath the popup.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Preview Card](https://base-ui.com/react/components/preview-card)
 */
export const PreviewCardBackdrop = /*#__PURE__*/React.forwardRef(function PreviewCardBackdrop(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    ...elementProps
  } = componentProps;
  const store = usePreviewCardRootContext();
  const open = store.useState('open');
  const mounted = store.useState('mounted');
  const transitionStatus = store.useState('transitionStatus');
  const state = {
    open,
    transitionStatus
  };
  const element = useRenderElement('div', componentProps, {
    state,
    ref: [forwardedRef],
    props: [{
      role: 'presentation',
      hidden: !mounted,
      style: {
        pointerEvents: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none'
      }
    }, elementProps],
    stateAttributesMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") PreviewCardBackdrop.displayName = "PreviewCardBackdrop";