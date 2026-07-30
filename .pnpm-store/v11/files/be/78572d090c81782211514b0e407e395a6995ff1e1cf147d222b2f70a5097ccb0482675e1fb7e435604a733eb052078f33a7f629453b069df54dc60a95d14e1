"use client";

import * as React from 'react';
import CheckCircleFilled from "@ant-design/icons/es/icons/CheckCircleFilled";
import CloseCircleFilled from "@ant-design/icons/es/icons/CloseCircleFilled";
import CloseOutlined from "@ant-design/icons/es/icons/CloseOutlined";
import ExclamationCircleFilled from "@ant-design/icons/es/icons/ExclamationCircleFilled";
import InfoCircleFilled from "@ant-design/icons/es/icons/InfoCircleFilled";
import LoadingOutlined from "@ant-design/icons/es/icons/LoadingOutlined";
import { Notification as RcNotification } from '@rc-component/notification';
import { clsx } from 'clsx';
import { pickClosable, useClosable } from '../_util/hooks';
import { useMergeSemantic } from '../_util/hooks/useMergeSemantic';
import { isPlainObject, isReactRenderable } from '../_util/is';
import { devUseWarning } from '../_util/warning';
import { ConfigContext } from '../config-provider';
import { useComponentConfig } from '../config-provider/context';
import useCSSVarCls from '../config-provider/hooks/useCSSVarCls';
import useStyle, { PurePanelStyle } from './style';
export const TypeIcon = {
  info: /*#__PURE__*/React.createElement(InfoCircleFilled, null),
  success: /*#__PURE__*/React.createElement(CheckCircleFilled, null),
  error: /*#__PURE__*/React.createElement(CloseCircleFilled, null),
  warning: /*#__PURE__*/React.createElement(ExclamationCircleFilled, null),
  loading: /*#__PURE__*/React.createElement(LoadingOutlined, null)
};
export function getCloseIcon(prefixCls, closeIcon) {
  if (closeIcon === null || closeIcon === false) {
    return null;
  }
  return closeIcon || /*#__PURE__*/React.createElement(CloseOutlined, {
    className: `${prefixCls}-close-icon`
  });
}
/** @private Internal Component. Do not use in your production. */
const PurePanel = props => {
  const {
    prefixCls: staticPrefixCls,
    icon,
    type,
    message,
    title,
    description,
    btn,
    actions,
    closeIcon: _closeIcon,
    className: notificationClassName,
    style,
    styles,
    classNames: notificationClassNames,
    closable,
    role,
    ...restProps
  } = props;
  const {
    getPrefixCls,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles
  } = useComponentConfig('notification');
  const [mergedClassNames, mergedStyles] = useMergeSemantic([contextClassNames, notificationClassNames], [contextStyles, styles], {
    props
  });
  const {
    notification: notificationContext
  } = React.useContext(ConfigContext);
  const mergedActions = actions ?? btn;
  if (process.env.NODE_ENV !== 'production') {
    const warning = devUseWarning('Notification');
    [['btn', 'actions'], ['message', 'title']].forEach(([deprecatedName, newName]) => {
      warning.deprecated(!(deprecatedName in props), deprecatedName, newName);
    });
  }
  const mergedTitle = title ?? message;
  const hasTitle = isReactRenderable(mergedTitle);
  const prefixCls = staticPrefixCls || getPrefixCls('notification');
  const noticePrefixCls = `${prefixCls}-notice`;
  const iconNode = icon || (type ? TypeIcon[type] : null);
  const typeIconCls = !icon && type ? `${noticePrefixCls}-icon-${type}` : undefined;
  const {
    root: rootClassName,
    ...contentClassNames
  } = mergedClassNames;
  const {
    root: rootStyle,
    ...contentStyles
  } = mergedStyles;
  const rootCls = useCSSVarCls(prefixCls);
  const [hashId, cssVarCls] = useStyle(prefixCls, rootCls);
  const [rawClosable, mergedCloseIcon,, ariaProps] = useClosable(pickClosable(props), pickClosable(notificationContext), {
    closable: true,
    closeIcon: /*#__PURE__*/React.createElement(CloseOutlined, {
      className: `${prefixCls}-close-icon`
    }),
    closeIconRender: icon => getCloseIcon(prefixCls, icon)
  });
  const mergedClosable = rawClosable ? {
    onClose: isPlainObject(closable) ? closable?.onClose : undefined,
    closeIcon: mergedCloseIcon,
    ...ariaProps
  } : false;
  return /*#__PURE__*/React.createElement("div", {
    className: clsx(`${noticePrefixCls}-pure-panel`, hashId, notificationClassName, cssVarCls, rootCls, rootClassName),
    style: rootStyle
  }, /*#__PURE__*/React.createElement(PurePanelStyle, {
    prefixCls: prefixCls
  }), /*#__PURE__*/React.createElement(RcNotification, {
    style: {
      ...contextStyle,
      ...style
    },
    ...restProps,
    prefixCls: prefixCls,
    duration: null,
    closable: mergedClosable,
    className: contextClassName,
    title: hasTitle ? mergedTitle : null,
    description: description,
    icon: iconNode,
    actions: mergedActions,
    role: role,
    classNames: {
      ...contentClassNames,
      icon: clsx(typeIconCls, contentClassNames.icon)
    },
    styles: contentStyles
  }));
};
export default PurePanel;