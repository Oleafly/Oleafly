"use client";

import * as React from 'react';
import CheckCircleFilled from "@ant-design/icons/es/icons/CheckCircleFilled";
import CloseCircleFilled from "@ant-design/icons/es/icons/CloseCircleFilled";
import ExclamationCircleFilled from "@ant-design/icons/es/icons/ExclamationCircleFilled";
import InfoCircleFilled from "@ant-design/icons/es/icons/InfoCircleFilled";
import LoadingOutlined from "@ant-design/icons/es/icons/LoadingOutlined";
import { Notification as RcNotification } from '@rc-component/notification';
import { clsx } from 'clsx';
import { useMergeSemantic } from '../_util/hooks/useMergeSemantic';
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
export const getMessageIcon = (type, icon) => icon || type && TypeIcon[type] || null;
/** @private Internal Component. Do not use in your production. */
const PurePanel = props => {
  const {
    prefixCls: staticPrefixCls,
    className,
    style,
    type,
    icon,
    content,
    classNames: messageClassNames,
    styles,
    ...restProps
  } = props;
  const {
    getPrefixCls,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles
  } = useComponentConfig('message');
  const prefixCls = staticPrefixCls || getPrefixCls('message');
  const noticePrefixCls = `${prefixCls}-notice`;
  const rootCls = useCSSVarCls(prefixCls);
  const [hashId, cssVarCls] = useStyle(prefixCls, rootCls);
  const [mergedClassNames, mergedStyles] = useMergeSemantic([contextClassNames, messageClassNames], [contextStyles, styles], {
    props: props
  });
  const iconNode = getMessageIcon(type, icon);
  const typeIconCls = type ? `${noticePrefixCls}-icon-${type}` : undefined;
  const rcClassNames = {
    wrapper: clsx(type && `${prefixCls}-${type}`, mergedClassNames.wrapper),
    icon: clsx(typeIconCls, mergedClassNames.icon),
    title: mergedClassNames.title
  };
  const rcStyles = {
    wrapper: mergedStyles.wrapper,
    icon: mergedStyles.icon,
    title: mergedStyles.title
  };
  return /*#__PURE__*/React.createElement("div", {
    className: clsx(`${noticePrefixCls}-pure-panel`, hashId, className, cssVarCls, rootCls, mergedClassNames.root),
    style: mergedStyles.root
  }, /*#__PURE__*/React.createElement(PurePanelStyle, {
    prefixCls: prefixCls
  }), /*#__PURE__*/React.createElement(RcNotification, {
    ...restProps,
    prefixCls: prefixCls,
    className: contextClassName,
    style: {
      ...contextStyle,
      ...style
    },
    duration: null,
    icon: iconNode,
    title: content,
    classNames: rcClassNames,
    styles: rcStyles
  }));
};
export default PurePanel;