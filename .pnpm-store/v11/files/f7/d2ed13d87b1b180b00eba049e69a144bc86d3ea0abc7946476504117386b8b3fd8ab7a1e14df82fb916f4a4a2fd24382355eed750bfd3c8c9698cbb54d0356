"use client";

import * as React from 'react';
import RcImage from '@rc-component/image';
import { clsx } from 'clsx';
import { useMergeSemantic } from '../_util/hooks/useMergeSemantic';
import { devUseWarning } from '../_util/warning';
import { useComponentConfig } from '../config-provider/context';
import useCSSVarCls from '../config-provider/hooks/useCSSVarCls';
import useMergedPreviewConfig from './hooks/useMergedPreviewConfig';
import usePlaceholderConfig, { isPlaceholderConfig } from './hooks/usePlaceholderConfig';
import usePreviewConfig from './hooks/usePreviewConfig';
import PreviewGroup, { icons } from './PreviewGroup';
import Progress from './Progress';
import useStyle from './style';
const Image = props => {
  const {
    prefixCls: customizePrefixCls,
    preview,
    className,
    rootClassName,
    style,
    styles,
    classNames,
    wrapperStyle,
    fallback,
    placeholder,
    ...otherProps
  } = props;
  // =============================== MISC ===============================
  // Context
  const {
    getPrefixCls,
    getPopupContainer: getContextPopupContainer,
    className: contextClassName,
    style: contextStyle,
    preview: contextPreview,
    styles: contextStyles,
    classNames: contextClassNames,
    fallback: contextFallback
  } = useComponentConfig('image');
  const prefixCls = getPrefixCls('image', customizePrefixCls);
  // ============================= Warning ==============================
  if (process.env.NODE_ENV !== 'production') {
    const warning = devUseWarning('Image');
    warning.deprecated(!wrapperStyle, 'wrapperStyle', 'styles.root');
  }
  // ============================== Styles ==============================
  const rootCls = useCSSVarCls(prefixCls);
  const [hashId, cssVarCls] = useStyle(prefixCls, rootCls);
  const mergedRootClassName = clsx(rootClassName, hashId, cssVarCls, rootCls);
  const mergedClassName = clsx(className, hashId, contextClassName);
  // ============================= Preview ==============================
  const [previewConfig, previewRootClassName, previewMaskClassName] = usePreviewConfig(preview);
  const [contextPreviewConfig, contextPreviewRootClassName, contextPreviewMaskClassName] = usePreviewConfig(contextPreview);
  const mergedPreviewConfig = useMergedPreviewConfig(
  // Preview config
  previewConfig, contextPreviewConfig,
  // MISC
  prefixCls, mergedRootClassName, getContextPopupContainer, icons, true);
  // =========== Merged Props for Semantic ===========
  const mergedProps = {
    ...props,
    preview: mergedPreviewConfig
  };
  // ============================= Semantic =============================
  const mergedLegacyClassNames = React.useMemo(() => ({
    cover: clsx(contextPreviewMaskClassName, previewMaskClassName),
    popup: {
      root: clsx(contextPreviewRootClassName, previewRootClassName)
    }
  }), [previewRootClassName, previewMaskClassName, contextPreviewRootClassName, contextPreviewMaskClassName]);
  const {
    mask: mergedMask,
    blurClassName
  } = mergedPreviewConfig ?? {};
  const mergedPopupClassNames = React.useMemo(() => ({
    mask: clsx({
      [`${prefixCls}-preview-mask-hidden`]: !mergedMask
    }, blurClassName)
  }), [mergedMask, prefixCls, blurClassName]);
  const internalClassNames = React.useMemo(() => [contextClassNames, classNames, mergedLegacyClassNames, {
    popup: mergedPopupClassNames
  }], [contextClassNames, classNames, mergedLegacyClassNames, mergedPopupClassNames]);
  const [mergedClassNames, mergedStyles] = useMergeSemantic(internalClassNames, [contextStyles, {
    root: wrapperStyle
  }, styles], {
    props: mergedProps
  }, {
    popup: {
      _default: 'root'
    },
    placeholder: {}
  });
  const mergedStyle = {
    ...contextStyle,
    ...style
  };
  const mergedFallback = fallback ?? contextFallback;
  // ============================= Progress ==============================
  const {
    progressConfig
  } = usePlaceholderConfig(placeholder);
  const showProgressOverlay = progressConfig !== undefined;
  const {
    percent,
    render: progressRender
  } = progressConfig || {};
  // Get progress classNames and styles
  const progressClassNames = mergedClassNames?.placeholder?.progress;
  const progressStyles = mergedStyles?.placeholder?.progress;
  // ============================== Render ==============================
  const {
    width,
    height,
    src,
    ...restOtherProps
  } = otherProps;
  // When placeholder is ReactNode (not progress config) and src is not provided,
  // render it as an overlay since rc-image would set status to 'error' when src is empty
  const placeholderNode = isPlaceholderConfig(placeholder) ? undefined : placeholder;
  const shouldRenderPlaceholderOverlay = placeholderNode && !src;
  // Memoize the placeholder render function to avoid creating new function on each render
  const mergedProgressRender = shouldRenderPlaceholderOverlay ? _progress => placeholderNode : progressRender;
  // When progress is active, render only progress layer with dimensions
  if (showProgressOverlay || shouldRenderPlaceholderOverlay) {
    return /*#__PURE__*/React.createElement(Progress, {
      prefixCls: prefixCls,
      percent: percent,
      render: mergedProgressRender,
      classNames: progressClassNames,
      styles: progressStyles,
      rootClassName: clsx(mergedRootClassName, mergedClassName),
      rootStyle: {
        ...mergedStyle,
        ...mergedStyles?.root
      },
      width: width,
      height: height
    });
  }
  return /*#__PURE__*/React.createElement(RcImage, {
    prefixCls: prefixCls,
    preview: mergedPreviewConfig || false,
    rootClassName: mergedRootClassName,
    className: mergedClassName,
    style: mergedStyle,
    fallback: mergedFallback,
    placeholder: placeholderNode,
    width: width,
    height: height,
    src: src,
    ...restOtherProps,
    classNames: mergedClassNames,
    styles: mergedStyles
  });
};
Image.PreviewGroup = PreviewGroup;
if (process.env.NODE_ENV !== 'production') {
  Image.displayName = 'Image';
}
export default Image;