"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _image = _interopRequireDefault(require("@rc-component/image"));
var _clsx = require("clsx");
var _useMergeSemantic = require("../_util/hooks/useMergeSemantic");
var _warning = require("../_util/warning");
var _context = require("../config-provider/context");
var _useCSSVarCls = _interopRequireDefault(require("../config-provider/hooks/useCSSVarCls"));
var _useMergedPreviewConfig = _interopRequireDefault(require("./hooks/useMergedPreviewConfig"));
var _usePlaceholderConfig = _interopRequireWildcard(require("./hooks/usePlaceholderConfig"));
var _usePreviewConfig = _interopRequireDefault(require("./hooks/usePreviewConfig"));
var _PreviewGroup = _interopRequireWildcard(require("./PreviewGroup"));
var _Progress = _interopRequireDefault(require("./Progress"));
var _style = _interopRequireDefault(require("./style"));
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
  } = (0, _context.useComponentConfig)('image');
  const prefixCls = getPrefixCls('image', customizePrefixCls);
  // ============================= Warning ==============================
  if (process.env.NODE_ENV !== 'production') {
    const warning = (0, _warning.devUseWarning)('Image');
    warning.deprecated(!wrapperStyle, 'wrapperStyle', 'styles.root');
  }
  // ============================== Styles ==============================
  const rootCls = (0, _useCSSVarCls.default)(prefixCls);
  const [hashId, cssVarCls] = (0, _style.default)(prefixCls, rootCls);
  const mergedRootClassName = (0, _clsx.clsx)(rootClassName, hashId, cssVarCls, rootCls);
  const mergedClassName = (0, _clsx.clsx)(className, hashId, contextClassName);
  // ============================= Preview ==============================
  const [previewConfig, previewRootClassName, previewMaskClassName] = (0, _usePreviewConfig.default)(preview);
  const [contextPreviewConfig, contextPreviewRootClassName, contextPreviewMaskClassName] = (0, _usePreviewConfig.default)(contextPreview);
  const mergedPreviewConfig = (0, _useMergedPreviewConfig.default)(
  // Preview config
  previewConfig, contextPreviewConfig,
  // MISC
  prefixCls, mergedRootClassName, getContextPopupContainer, _PreviewGroup.icons, true);
  // =========== Merged Props for Semantic ===========
  const mergedProps = {
    ...props,
    preview: mergedPreviewConfig
  };
  // ============================= Semantic =============================
  const mergedLegacyClassNames = React.useMemo(() => ({
    cover: (0, _clsx.clsx)(contextPreviewMaskClassName, previewMaskClassName),
    popup: {
      root: (0, _clsx.clsx)(contextPreviewRootClassName, previewRootClassName)
    }
  }), [previewRootClassName, previewMaskClassName, contextPreviewRootClassName, contextPreviewMaskClassName]);
  const {
    mask: mergedMask,
    blurClassName
  } = mergedPreviewConfig ?? {};
  const mergedPopupClassNames = React.useMemo(() => ({
    mask: (0, _clsx.clsx)({
      [`${prefixCls}-preview-mask-hidden`]: !mergedMask
    }, blurClassName)
  }), [mergedMask, prefixCls, blurClassName]);
  const internalClassNames = React.useMemo(() => [contextClassNames, classNames, mergedLegacyClassNames, {
    popup: mergedPopupClassNames
  }], [contextClassNames, classNames, mergedLegacyClassNames, mergedPopupClassNames]);
  const [mergedClassNames, mergedStyles] = (0, _useMergeSemantic.useMergeSemantic)(internalClassNames, [contextStyles, {
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
  } = (0, _usePlaceholderConfig.default)(placeholder);
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
  const placeholderNode = (0, _usePlaceholderConfig.isPlaceholderConfig)(placeholder) ? undefined : placeholder;
  const shouldRenderPlaceholderOverlay = placeholderNode && !src;
  // Memoize the placeholder render function to avoid creating new function on each render
  const mergedProgressRender = shouldRenderPlaceholderOverlay ? _progress => placeholderNode : progressRender;
  // When progress is active, render only progress layer with dimensions
  if (showProgressOverlay || shouldRenderPlaceholderOverlay) {
    return /*#__PURE__*/React.createElement(_Progress.default, {
      prefixCls: prefixCls,
      percent: percent,
      render: mergedProgressRender,
      classNames: progressClassNames,
      styles: progressStyles,
      rootClassName: (0, _clsx.clsx)(mergedRootClassName, mergedClassName),
      rootStyle: {
        ...mergedStyle,
        ...mergedStyles?.root
      },
      width: width,
      height: height
    });
  }
  return /*#__PURE__*/React.createElement(_image.default, {
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
Image.PreviewGroup = _PreviewGroup.default;
if (process.env.NODE_ENV !== 'production') {
  Image.displayName = 'Image';
}
var _default = exports.default = Image;