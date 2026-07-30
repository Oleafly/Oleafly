'use client';

import * as React from 'react';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { useAvatarRootContext } from "../root/AvatarRootContext.mjs";
import { avatarStateAttributesMapping } from "../root/stateAttributesMapping.mjs";
import { useOpenChangeComplete } from "../../internals/useOpenChangeComplete.mjs";
import { transitionStatusMapping } from "../../internals/stateAttributesMapping.mjs";
import { useTransitionStatus } from "../../internals/useTransitionStatus.mjs";
import { useImageLoadingStatus } from "./useImageLoadingStatus.mjs";
const stateAttributesMapping = {
  ...avatarStateAttributesMapping,
  ...transitionStatusMapping
};

/**
 * The image to be displayed in the avatar.
 * Renders an `<img>` element.
 *
 * Documentation: [Base UI Avatar](https://base-ui.com/react/components/avatar)
 */
export const AvatarImage = /*#__PURE__*/React.forwardRef(function AvatarImage(componentProps, forwardedRef) {
  const {
    className,
    render,
    onLoadingStatusChange: onLoadingStatusChangeProp,
    style,
    ...elementProps
  } = componentProps;
  const {
    setImageLoadingStatus
  } = useAvatarRootContext();
  const imageLoadingStatus = useImageLoadingStatus(elementProps.src, elementProps);
  const isVisible = imageLoadingStatus === 'loaded';
  const {
    mounted,
    transitionStatus,
    setMounted
  } = useTransitionStatus(isVisible);
  const imageRef = React.useRef(null);
  const handleLoadingStatusChange = useStableCallback(status => {
    onLoadingStatusChangeProp?.(status);
    setImageLoadingStatus(status);
  });
  useIsoLayoutEffect(() => {
    if (imageLoadingStatus !== 'idle') {
      handleLoadingStatusChange(imageLoadingStatus);
    }
  }, [imageLoadingStatus, handleLoadingStatusChange]);
  useIsoLayoutEffect(() => {
    return () => setImageLoadingStatus('idle');
  }, [setImageLoadingStatus]);
  useOpenChangeComplete({
    open: isVisible,
    ref: imageRef,
    onComplete() {
      if (!isVisible) {
        setMounted(false);
      }
    }
  });
  const state = {
    imageLoadingStatus,
    transitionStatus
  };
  const element = useRenderElement('img', componentProps, {
    state,
    ref: [forwardedRef, imageRef],
    props: elementProps,
    stateAttributesMapping,
    enabled: mounted
  });
  if (!mounted) {
    return null;
  }
  return element;
});
if (process.env.NODE_ENV !== "production") AvatarImage.displayName = "AvatarImage";