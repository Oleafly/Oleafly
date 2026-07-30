"use client";

import * as React from 'react';
import { forwardRef } from 'react';
import { TextArea as RcTextArea } from '@rc-component/input';
import { clsx } from 'clsx';
import { useAllowClear } from '../_util/hooks';
import { useMergeSemantic, useSemanticRootStyle } from '../_util/hooks/useMergeSemantic';
import { isFunction } from '../_util/is';
import { getMergedStatus, getStatusClassNames } from '../_util/statusUtils';
import { devUseWarning } from '../_util/warning';
import { useComponentConfig } from '../config-provider/context';
import DisabledContext from '../config-provider/DisabledContext';
import useCSSVarCls from '../config-provider/hooks/useCSSVarCls';
import useSize from '../config-provider/hooks/useSize';
import { FormItemInputContext } from '../form/context';
import useVariant from '../form/hooks/useVariants';
import { useCompactItemContext } from '../space/Compact';
import { triggerFocus } from './Input';
import { useSharedStyle } from './style';
import useStyle from './style/textarea';
const TextArea = /*#__PURE__*/forwardRef((props, ref) => {
  const {
    prefixCls: customizePrefixCls,
    bordered = true,
    size: customizeSize,
    disabled: customDisabled,
    status: customStatus,
    allowClear,
    classNames,
    rootClassName,
    className,
    style,
    styles,
    variant: customVariant,
    showCount,
    onMouseDown,
    onResize,
    ...rest
  } = props;
  if (process.env.NODE_ENV !== 'production') {
    const {
      deprecated
    } = devUseWarning('TextArea');
    deprecated(!('bordered' in props), 'bordered', 'variant');
  }
  const {
    getPrefixCls,
    direction,
    allowClear: contextAllowClear,
    autoComplete: contextAutoComplete,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles
  } = useComponentConfig('textArea');
  // =================== Disabled ===================
  const disabled = React.useContext(DisabledContext);
  const mergedDisabled = customDisabled ?? disabled;
  // ==================== Status ====================
  const {
    status: contextStatus,
    hasFeedback,
    feedbackIcon
  } = React.useContext(FormItemInputContext);
  const mergedStatus = getMergedStatus(contextStatus, customStatus);
  const contextStyleRoot = useSemanticRootStyle(contextStyle);
  const styleRoot = useSemanticRootStyle(style);
  const [mergedClassNames, mergedStyles] = useMergeSemantic([contextClassNames, classNames], [contextStyles, contextStyleRoot, styles, styleRoot], {
    props
  });
  // ===================== Ref ======================
  const innerRef = React.useRef(null);
  React.useImperativeHandle(ref, () => ({
    resizableTextArea: innerRef.current?.resizableTextArea,
    focus: option => {
      triggerFocus(innerRef.current?.resizableTextArea?.textArea, option);
    },
    blur: () => innerRef.current?.blur(),
    nativeElement: innerRef.current?.nativeElement || null
  }));
  const prefixCls = getPrefixCls('input', customizePrefixCls);
  // ==================== Style =====================
  const rootCls = useCSSVarCls(prefixCls);
  const [hashId, cssVarCls] = useSharedStyle(prefixCls, rootClassName);
  useStyle(prefixCls, rootCls);
  // ================= Compact Item =================
  const {
    compactSize,
    compactItemClassnames
  } = useCompactItemContext(prefixCls, direction);
  // ===================== Size =====================
  const mergedSize = useSize(ctx => customizeSize ?? compactSize ?? ctx);
  const [variant, enableVariantCls] = useVariant('textArea', customVariant, bordered);
  const mergedAllowClear = useAllowClear({
    allowClear,
    contextAllowClear,
    componentName: 'TextArea'
  });
  // ==================== Resize ====================
  // https://github.com/ant-design/ant-design/issues/51594
  const [isMouseDown, setIsMouseDown] = React.useState(false);
  // When has wrapper, resize will make as dirty for `resize: both` style
  const [resizeDirty, setResizeDirty] = React.useState(false);
  const onInternalMouseDown = e => {
    setIsMouseDown(true);
    onMouseDown?.(e);
    const onMouseUp = () => {
      setIsMouseDown(false);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mouseup', onMouseUp);
  };
  const onInternalResize = size => {
    onResize?.(size);
    // Change to dirty since this maybe from the `resize: both` style
    if (isMouseDown && isFunction(getComputedStyle)) {
      const ele = innerRef.current?.nativeElement?.querySelector('textarea');
      if (ele && getComputedStyle(ele).resize === 'both') {
        setResizeDirty(true);
      }
    }
  };
  // ==================== Render ====================
  return /*#__PURE__*/React.createElement(RcTextArea, {
    autoComplete: contextAutoComplete,
    ...rest,
    style: mergedStyles.root,
    styles: mergedStyles,
    disabled: mergedDisabled,
    allowClear: mergedAllowClear,
    className: clsx(cssVarCls, rootCls, className, rootClassName, compactItemClassnames, contextClassName, mergedClassNames.root,
    // Only for wrapper
    {
      [`${prefixCls}-textarea-affix-wrapper-resize-dirty`]: resizeDirty
    }),
    classNames: {
      ...mergedClassNames,
      textarea: clsx({
        [`${prefixCls}-sm`]: mergedSize === 'small',
        [`${prefixCls}-lg`]: mergedSize === 'large'
      }, hashId, mergedClassNames.textarea, isMouseDown && `${prefixCls}-mouse-active`),
      variant: clsx({
        [`${prefixCls}-${variant}`]: enableVariantCls
      }, getStatusClassNames(prefixCls, mergedStatus)),
      affixWrapper: clsx(`${prefixCls}-textarea-affix-wrapper`, {
        [`${prefixCls}-affix-wrapper-rtl`]: direction === 'rtl',
        [`${prefixCls}-affix-wrapper-sm`]: mergedSize === 'small',
        [`${prefixCls}-affix-wrapper-lg`]: mergedSize === 'large',
        [`${prefixCls}-textarea-show-count`]: showCount || props.count?.show
      }, hashId)
    },
    prefixCls: prefixCls,
    suffix: hasFeedback && /*#__PURE__*/React.createElement("span", {
      className: `${prefixCls}-textarea-suffix`
    }, feedbackIcon),
    showCount: showCount,
    ref: innerRef,
    onResize: onInternalResize,
    onMouseDown: onInternalMouseDown
  });
});
export default TextArea;