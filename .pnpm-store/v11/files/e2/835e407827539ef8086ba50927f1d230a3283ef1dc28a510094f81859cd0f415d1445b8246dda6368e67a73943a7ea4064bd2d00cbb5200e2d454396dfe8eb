'use client';

import * as React from 'react';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { usePreviewCardRootContext } from "../root/PreviewCardContext.mjs";
import { usePreviewCardPositionerContext } from "../positioner/PreviewCardPositionerContext.mjs";
import { popupStateMapping as baseMapping } from "../../utils/popupStateMapping.mjs";
import { transitionStatusMapping } from "../../internals/stateAttributesMapping.mjs";
import { useOpenChangeComplete } from "../../internals/useOpenChangeComplete.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { getDisabledMountTransitionStyles } from "../../utils/getDisabledMountTransitionStyles.mjs";
import { useHoverFloatingInteraction } from "../../floating-ui-react/index.mjs";
const stateAttributesMapping = {
  ...baseMapping,
  ...transitionStatusMapping
};

/**
 * A container for the preview card contents.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Preview Card](https://base-ui.com/react/components/preview-card)
 */
export const PreviewCardPopup = /*#__PURE__*/React.forwardRef(function PreviewCardPopup(componentProps, forwardedRef) {
  const {
    className,
    render,
    style,
    ...elementProps
  } = componentProps;
  const store = usePreviewCardRootContext();
  const {
    side,
    align
  } = usePreviewCardPositionerContext();
  const open = store.useState('open');
  const instantType = store.useState('instantType');
  const transitionStatus = store.useState('transitionStatus');
  const popupProps = store.useState('popupProps');
  const floatingContext = store.useState('floatingRootContext');
  useOpenChangeComplete({
    open,
    ref: store.context.popupRef,
    onComplete() {
      if (open) {
        store.context.onOpenChangeComplete?.(true);
      }
    }
  });
  const getCloseDelay = useStableCallback(() => store.context.closeDelayRef.current);
  useHoverFloatingInteraction(floatingContext, {
    closeDelay: getCloseDelay
  });
  const state = {
    open,
    side,
    align,
    instant: instantType,
    transitionStatus
  };
  const element = useRenderElement('div', componentProps, {
    state,
    ref: [forwardedRef, store.context.popupRef, store.useStateSetter('popupElement')],
    props: [popupProps, getDisabledMountTransitionStyles(transitionStatus), elementProps],
    stateAttributesMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") PreviewCardPopup.displayName = "PreviewCardPopup";