"use client";

import * as React from 'react';
import { NotificationList } from '@rc-component/notification';
import { clsx } from 'clsx';
import { useComponentConfig } from '../config-provider/context';
import useCSSVarCls from '../config-provider/hooks/useCSSVarCls';
import { getCloseIcon, TypeIcon } from './PurePanel';
import useStyle from './style';
/** @private Internal Component. Do not use in your production. */
const PureList = props => {
  const {
    items,
    classNames,
    placement = 'topRight',
    style
  } = props;
  const {
    getPrefixCls
  } = useComponentConfig('notification');
  const prefixCls = getPrefixCls('notification');
  const rootCls = useCSSVarCls(prefixCls);
  const [hashId, cssVarCls] = useStyle(prefixCls, rootCls);
  const noticePrefixCls = `${prefixCls}-notice`;
  const configList = items.map(item => {
    const {
      actions,
      description,
      duration,
      key,
      showProgress,
      title,
      type
    } = item;
    const typeIconCls = `${noticePrefixCls}-icon-${type}`;
    return {
      key,
      actions,
      closable: {
        closeIcon: getCloseIcon(noticePrefixCls)
      },
      description,
      duration,
      icon: TypeIcon[type],
      showProgress,
      title,
      className: `${noticePrefixCls}-${type}`,
      classNames: {
        icon: typeIconCls
      }
    };
  });
  return /*#__PURE__*/React.createElement(NotificationList, {
    prefixCls: prefixCls,
    placement: placement,
    configList: configList,
    className: clsx(hashId, cssVarCls, rootCls),
    classNames: classNames,
    style: style,
    stack: false
  });
};
export default PureList;