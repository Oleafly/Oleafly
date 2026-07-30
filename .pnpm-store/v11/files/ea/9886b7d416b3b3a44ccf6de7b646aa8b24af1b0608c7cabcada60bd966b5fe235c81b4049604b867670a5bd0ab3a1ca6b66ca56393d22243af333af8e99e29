"use client";

import * as React from 'react';
import StarFilled from "@ant-design/icons/es/icons/StarFilled";
import RcRate from '@rc-component/rate';
import { clsx } from 'clsx';
import { isPlainObject } from '../_util/is';
import { useComponentConfig } from '../config-provider/context';
import DisabledContext from '../config-provider/DisabledContext';
import useSize from '../config-provider/hooks/useSize';
import Tooltip from '../tooltip';
import useStyle from './style';
const Rate = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    prefixCls,
    className,
    rootClassName,
    style,
    tooltips,
    character = /*#__PURE__*/React.createElement(StarFilled, null),
    disabled: customDisabled,
    size,
    ...rest
  } = props;
  const characterRender = (node, {
    index = 0
  }) => {
    if (!tooltips) {
      return node;
    }
    const tooltipsItem = tooltips[index];
    if (isPlainObject(tooltipsItem)) {
      return /*#__PURE__*/React.createElement(Tooltip, {
        ...tooltipsItem
      }, node);
    }
    return /*#__PURE__*/React.createElement(Tooltip, {
      title: tooltipsItem
    }, node);
  };
  const {
    getPrefixCls,
    direction,
    className: contextClassName,
    style: contextStyle
  } = useComponentConfig('rate');
  const ratePrefixCls = getPrefixCls('rate', prefixCls);
  // Style
  const [hashId, cssVarCls] = useStyle(ratePrefixCls);
  const mergedStyle = {
    ...contextStyle,
    ...style
  };
  // ===================== Disabled =====================
  const disabled = React.useContext(DisabledContext);
  const mergedDisabled = customDisabled ?? disabled;
  // ===================== Size =====================
  const mergedSize = useSize(ctx => size ?? ctx);
  return /*#__PURE__*/React.createElement(RcRate, {
    ref: ref,
    character: character,
    characterRender: characterRender,
    disabled: mergedDisabled,
    ...rest,
    className: clsx({
      [`${ratePrefixCls}-large`]: mergedSize === 'large',
      [`${ratePrefixCls}-small`]: mergedSize === 'small'
    }, className, rootClassName, hashId, cssVarCls, contextClassName),
    style: mergedStyle,
    prefixCls: ratePrefixCls,
    direction: direction
  });
});
if (process.env.NODE_ENV !== 'production') {
  Rate.displayName = 'Rate';
}
export default Rate;