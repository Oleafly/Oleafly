"use client";

import * as React from 'react';
import LoadingOutlined from "@ant-design/icons/es/icons/LoadingOutlined";
import RcSwitch from '@rc-component/switch';
import { useControlledState } from '@rc-component/util';
import { clsx } from 'clsx';
import { useMergeSemantic, useSemanticRootStyle } from '../_util/hooks/useMergeSemantic';
import { devUseWarning } from '../_util/warning';
import Wave from '../_util/wave';
import { useComponentConfig } from '../config-provider/context';
import DisabledContext from '../config-provider/DisabledContext';
import useSize from '../config-provider/hooks/useSize';
import useStyle from './style';
const InternalSwitch = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    prefixCls: customizePrefixCls,
    size: customizeSize,
    disabled: customDisabled,
    loading,
    className,
    rootClassName,
    style,
    checked: checkedProp,
    value,
    defaultChecked: defaultCheckedProp,
    defaultValue,
    onChange,
    styles,
    classNames,
    ...restProps
  } = props;
  const [checked, setChecked] = useControlledState(defaultCheckedProp ?? defaultValue ?? false, checkedProp ?? value);
  const {
    getPrefixCls,
    direction,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles
  } = useComponentConfig('switch');
  // ===================== Disabled =====================
  const disabled = React.useContext(DisabledContext);
  const mergedDisabled = (customDisabled ?? disabled) || loading;
  const prefixCls = getPrefixCls('switch', customizePrefixCls);
  // Style
  const [hashId, cssVarCls] = useStyle(prefixCls);
  if (process.env.NODE_ENV !== 'production') {
    const warning = devUseWarning('Switch');
    warning.deprecated(customizeSize !== 'default', 'size="default"', 'size="medium"');
  }
  const mergedSize = useSize(customizeSize);
  const mergedProps = {
    ...props,
    size: mergedSize,
    disabled: mergedDisabled
  };
  const contextStyleRoot = useSemanticRootStyle(contextStyle);
  const styleRoot = useSemanticRootStyle(style);
  const [mergedClassNames, mergedStyles] = useMergeSemantic([contextClassNames, classNames], [contextStyles, contextStyleRoot, styles, styleRoot], {
    props: mergedProps
  });
  const loadingIcon = /*#__PURE__*/React.createElement("div", {
    className: clsx(`${prefixCls}-handle`, mergedClassNames.indicator),
    style: mergedStyles.indicator
  }, loading && /*#__PURE__*/React.createElement(LoadingOutlined, {
    className: `${prefixCls}-loading-icon`
  }));
  const classes = clsx(contextClassName, {
    [`${prefixCls}-small`]: mergedSize === 'small',
    [`${prefixCls}-loading`]: loading,
    [`${prefixCls}-rtl`]: direction === 'rtl'
  }, className, rootClassName, mergedClassNames.root, hashId, cssVarCls);
  const changeHandler = (...args) => {
    setChecked(args[0]);
    onChange?.(...args);
  };
  return /*#__PURE__*/React.createElement(Wave, {
    component: "Switch",
    disabled: mergedDisabled
  }, /*#__PURE__*/React.createElement(RcSwitch, {
    ...restProps,
    classNames: mergedClassNames,
    styles: mergedStyles,
    checked: checked,
    onChange: changeHandler,
    prefixCls: prefixCls,
    className: classes,
    style: mergedStyles.root,
    disabled: mergedDisabled,
    ref: ref,
    loadingIcon: loadingIcon
  }));
});
const Switch = InternalSwitch;
Switch.__ANT_SWITCH = true;
if (process.env.NODE_ENV !== 'production') {
  Switch.displayName = 'Switch';
}
export default Switch;