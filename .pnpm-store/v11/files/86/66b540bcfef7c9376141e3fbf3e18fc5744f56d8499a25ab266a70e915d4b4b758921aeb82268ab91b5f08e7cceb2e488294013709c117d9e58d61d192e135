"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AvatarImage = void 0;
var React = _interopRequireWildcard(require("react"));
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _useRenderElement = require("../../internals/useRenderElement");
var _AvatarRootContext = require("../root/AvatarRootContext");
var _stateAttributesMapping = require("../root/stateAttributesMapping");
var _useOpenChangeComplete = require("../../internals/useOpenChangeComplete");
var _stateAttributesMapping2 = require("../../internals/stateAttributesMapping");
var _useTransitionStatus = require("../../internals/useTransitionStatus");
var _useImageLoadingStatus = require("./useImageLoadingStatus");
const stateAttributesMapping = {
  ..._stateAttributesMapping.avatarStateAttributesMapping,
  ..._stateAttributesMapping2.transitionStatusMapping
};

/**
 * The image to be displayed in the avatar.
 * Renders an `<img>` element.
 *
 * Documentation: [Base UI Avatar](https://base-ui.com/react/components/avatar)
 */
const AvatarImage = exports.AvatarImage = /*#__PURE__*/React.forwardRef(function AvatarImage(componentProps, forwardedRef) {
  const {
    className,
    render,
    onLoadingStatusChange: onLoadingStatusChangeProp,
    style,
    ...elementProps
  } = componentProps;
  const {
    setImageLoadingStatus
  } = (0, _AvatarRootContext.useAvatarRootContext)();
  const imageLoadingStatus = (0, _useImageLoadingStatus.useImageLoadingStatus)(elementProps.src, elementProps);
  const isVisible = imageLoadingStatus === 'loaded';
  const {
    mounted,
    transitionStatus,
    setMounted
  } = (0, _useTransitionStatus.useTransitionStatus)(isVisible);
  const imageRef = React.useRef(null);
  const handleLoadingStatusChange = (0, _useStableCallback.useStableCallback)(status => {
    onLoadingStatusChangeProp?.(status);
    setImageLoadingStatus(status);
  });
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (imageLoadingStatus !== 'idle') {
      handleLoadingStatusChange(imageLoadingStatus);
    }
  }, [imageLoadingStatus, handleLoadingStatusChange]);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    return () => setImageLoadingStatus('idle');
  }, [setImageLoadingStatus]);
  (0, _useOpenChangeComplete.useOpenChangeComplete)({
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
  const element = (0, _useRenderElement.useRenderElement)('img', componentProps, {
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