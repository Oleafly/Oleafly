"use client";

import React, { useMemo } from 'react';
import { unit } from '@ant-design/cssinjs';
import { clsx } from 'clsx';
import { isNonNullable, isNumber, isString } from '../_util/is';
import { useComponentConfig } from '../config-provider/context';
import { genCssVar } from '../theme/util/genStyleUtils';
import BorderBeamEffect from './BorderBeamEffect';
import useBorderSize from './hooks/useBorderSize';
import useChildDom from './hooks/useChildDom';
import useStyle from './style';
import { getBorderBeamGradient } from './util';
const getInset = width => {
  return isString(width) ? `calc(-1 * ${width})` : `-${width}px`;
};
const BorderBeam = props => {
  const {
    prefixCls: customizePrefixCls,
    className,
    style,
    children,
    color,
    duration,
    lineWidth,
    outset,
    size
  } = props;
  const {
    className: contextClassName,
    style: contextStyle,
    getPrefixCls
  } = useComponentConfig('borderBeam');
  // ============================ Prefix ============================
  const prefixCls = getPrefixCls('border-beam', customizePrefixCls);
  const [hashId, cssVarCls] = useStyle(prefixCls);
  const [varName] = genCssVar(getPrefixCls(), 'border-beam');
  // ============================= Host =============================
  const [childNode, childDomNode] = useChildDom(children);
  const {
    borderWidth,
    borderRadius
  } = useBorderSize(childDomNode);
  const beamGradient = useMemo(() => getBorderBeamGradient(color), [color]);
  // ============================ Border ============================
  const insetOffset = useMemo(() => {
    return isNonNullable(outset) ? getInset(outset) : borderWidth.map(getInset).join(' ');
  }, [borderWidth, outset]);
  // ============================ Render ============================
  return /*#__PURE__*/React.createElement(React.Fragment, null, childNode, /*#__PURE__*/React.createElement(BorderBeamEffect, {
    prefixCls: prefixCls,
    hostDom: childDomNode,
    className: clsx(contextClassName, className, hashId, cssVarCls),
    style: {
      ...contextStyle,
      ...style,
      ...(beamGradient && {
        [varName('beam-gradient')]: beamGradient
      }),
      ...(isNumber(duration) && duration > 0 && {
        [varName('duration')]: `${duration}s`
      }),
      ...(isNonNullable(lineWidth) && {
        [varName('line-width')]: unit(lineWidth)
      }),
      ...(isNonNullable(size) && {
        [varName('size')]: unit(size)
      }),
      [varName('inset-offset')]: insetOffset,
      [varName('border-radius')]: borderRadius
    }
  }));
};
if (process.env.NODE_ENV !== 'production') {
  BorderBeam.displayName = 'BorderBeam';
}
export default BorderBeam;