"use client";

import * as React from 'react';
import CheckOutlined from "@ant-design/icons/es/icons/CheckOutlined";
import CopyOutlined from "@ant-design/icons/es/icons/CopyOutlined";
import LoadingOutlined from "@ant-design/icons/es/icons/LoadingOutlined";
import { clsx } from 'clsx';
import Tooltip from '../../tooltip';
import { getNode, toCopyConfigList } from './util';
const CopyBtn = props => {
  const {
    prefixCls,
    copied,
    locale,
    iconOnly,
    tooltips,
    icon,
    tabIndex,
    onCopy,
    loading: btnLoading,
    className,
    style
  } = props;
  const tooltipNodes = toCopyConfigList(tooltips);
  const iconNodes = toCopyConfigList(icon);
  const {
    copied: copiedText,
    copy: copyText
  } = locale ?? {};
  const systemStr = copied ? copiedText : copyText;
  const copyTitle = getNode(tooltipNodes[copied ? 1 : 0], systemStr);
  const ariaLabel = typeof copyTitle === 'string' ? copyTitle : systemStr;
  return /*#__PURE__*/React.createElement(Tooltip, {
    title: copyTitle
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: clsx(`${prefixCls}-copy`, className, {
      [`${prefixCls}-copy-success`]: copied,
      [`${prefixCls}-copy-icon-only`]: iconOnly
    }),
    style: style,
    onClick: onCopy,
    "aria-label": ariaLabel,
    tabIndex: tabIndex
  }, copied ? getNode(iconNodes[1], /*#__PURE__*/React.createElement(CheckOutlined, null), true) : getNode(iconNodes[0], btnLoading ? /*#__PURE__*/React.createElement(LoadingOutlined, null) : /*#__PURE__*/React.createElement(CopyOutlined, null), true)));
};
export default CopyBtn;