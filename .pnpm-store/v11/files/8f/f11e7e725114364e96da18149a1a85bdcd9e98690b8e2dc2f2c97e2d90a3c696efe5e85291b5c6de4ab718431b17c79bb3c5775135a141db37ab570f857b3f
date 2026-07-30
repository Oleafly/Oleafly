"use client";

import * as React from 'react';
import { NotificationList } from '@rc-component/notification';
import { clsx } from 'clsx';
import { useComponentConfig } from '../config-provider/context';
import useCSSVarCls from '../config-provider/hooks/useCSSVarCls';
import { getMessageIcon } from './PurePanel';
import useStyle from './style';
/** @private Internal Component. Do not use in your production. */
const PureList = props => {
  const {
    items,
    classNames,
    style
  } = props;
  const {
    getPrefixCls
  } = useComponentConfig('message');
  const prefixCls = getPrefixCls('message');
  const rootCls = useCSSVarCls(prefixCls);
  const [hashId, cssVarCls] = useStyle(prefixCls, rootCls);
  const noticePrefixCls = `${prefixCls}-notice`;
  const configList = items.map(item => {
    const {
      content,
      duration,
      key,
      type
    } = item;
    const typeIconCls = type ? `${noticePrefixCls}-icon-${type}` : undefined;
    return {
      key,
      duration,
      icon: getMessageIcon(type),
      title: content,
      className: `${noticePrefixCls}-${type}`,
      classNames: {
        wrapper: `${prefixCls}-${type}`,
        icon: typeIconCls
      }
    };
  });
  return /*#__PURE__*/React.createElement(NotificationList, {
    prefixCls: prefixCls,
    placement: "top",
    configList: configList,
    className: clsx(hashId, cssVarCls, rootCls),
    classNames: {
      ...classNames,
      wrapper: classNames?.wrapper,
      title: classNames?.title
    },
    style: style,
    stack: false
  });
};
export default PureList;