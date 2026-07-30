"use client";

import * as React from 'react';
import { useRef, useState } from 'react';
import EyeInvisibleOutlined from "@ant-design/icons/es/icons/EyeInvisibleOutlined";
import EyeOutlined from "@ant-design/icons/es/icons/EyeOutlined";
import { composeRef } from '@rc-component/util';
import { clsx } from 'clsx';
import { useMergeSemantic } from '../_util/hooks/useMergeSemantic';
import { isPlainObject } from '../_util/is';
import { useComponentConfig } from '../config-provider/context';
import DisabledContext from '../config-provider/DisabledContext';
import { useLocale } from '../locale';
import useRemovePasswordTimeout from './hooks/useRemovePasswordTimeout';
import Input from './Input';
const defaultIconRender = visible => visible ? /*#__PURE__*/React.createElement(EyeOutlined, null) : /*#__PURE__*/React.createElement(EyeInvisibleOutlined, null);
const actionMap = {
  click: 'onClick',
  hover: 'onMouseOver'
};
const Password = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    disabled: customDisabled,
    action = 'click',
    visibilityToggle = true,
    iconRender,
    prefixCls: customizePrefixCls,
    inputPrefixCls: customizeInputPrefixCls,
    suffix,
    className,
    style,
    classNames,
    styles,
    ...restProps
  } = props;
  const {
    getPrefixCls,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles,
    iconRender: contextIconRender
  } = useComponentConfig('inputPassword');
  const [locale] = useLocale('global');
  // ===================== Disabled =====================
  const disabled = React.useContext(DisabledContext);
  const mergedDisabled = customDisabled ?? disabled;
  // =========== Merged Props for Semantic ==========
  const mergedProps = {
    ...props,
    disabled: mergedDisabled
  };
  const [mergedClassNames, mergedStyles] = useMergeSemantic([contextClassNames, classNames], [contextStyles, styles], {
    props: mergedProps
  });
  const visibilityControlled = isPlainObject(visibilityToggle) && visibilityToggle.visible !== undefined;
  const [visible, setVisible] = useState(() => visibilityControlled ? visibilityToggle.visible : false);
  const inputRef = useRef(null);
  React.useEffect(() => {
    if (visibilityControlled) {
      setVisible(visibilityToggle.visible);
    }
  }, [visibilityControlled, visibilityToggle]);
  // Remove Password value
  const removePasswordTimeout = useRemovePasswordTimeout(inputRef);
  const onVisibleChange = () => {
    if (mergedDisabled) {
      return;
    }
    if (visible) {
      removePasswordTimeout();
    }
    const nextVisible = !visible;
    setVisible(nextVisible);
    if (isPlainObject(visibilityToggle)) {
      visibilityToggle.onVisibleChange?.(nextVisible);
    }
  };
  const getIcon = prefixCls => {
    const iconTrigger = actionMap[action] || '';
    const iconRenderer = iconRender || contextIconRender || defaultIconRender;
    const icon = iconRenderer(visible);
    const iconTabIndex = isPlainObject(visibilityToggle) ? visibilityToggle.tabIndex : undefined;
    return /*#__PURE__*/React.createElement("span", {
      key: "passwordIcon",
      role: "button",
      tabIndex: mergedDisabled ? -1 : iconTabIndex ?? 0,
      className: `${prefixCls}-icon`,
      "aria-disabled": mergedDisabled,
      "aria-pressed": visible,
      "aria-label": visible ? locale.hide : locale.show,
      onMouseDown: e => {
        // Prevent focused state lost
        // https://github.com/ant-design/ant-design/issues/15173
        e.preventDefault();
      },
      onMouseUp: e => {
        // Prevent caret position change
        // https://github.com/ant-design/ant-design/issues/23524
        e.preventDefault();
      },
      onKeyDown: e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onVisibleChange();
        }
      },
      [iconTrigger]: onVisibleChange
    }, icon);
  };
  const inputPrefixCls = getPrefixCls('input', customizeInputPrefixCls);
  const prefixCls = getPrefixCls('input-password', customizePrefixCls);
  const suffixIcon = visibilityToggle && getIcon(prefixCls);
  const inputClassName = clsx(prefixCls, contextClassName, className, {
    [`${prefixCls}-${props.size}`]: !!props.size
  });
  const inputProps = {
    ...restProps,
    type: visible ? 'text' : 'password',
    prefixCls: inputPrefixCls,
    suffix: (/*#__PURE__*/React.createElement(React.Fragment, null, suffixIcon, suffix)),
    disabled: mergedDisabled,
    className: inputClassName,
    style: {
      ...contextStyle,
      ...style
    },
    classNames: mergedClassNames,
    styles: mergedStyles
  };
  return /*#__PURE__*/React.createElement(Input, {
    ref: composeRef(ref, inputRef),
    ...inputProps
  });
});
if (process.env.NODE_ENV !== 'production') {
  Password.displayName = 'Input.Password';
}
export default Password;