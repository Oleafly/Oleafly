"use client";

import * as React from 'react';
import RightOutlined from "@ant-design/icons/es/icons/RightOutlined";
import RcCollapse from '@rc-component/collapse';
import { omit, toArray } from '@rc-component/util';
import { clsx } from 'clsx';
import { useMergeSemantic, useSemanticRootStyle } from '../_util/hooks/useMergeSemantic';
import { isFunction } from '../_util/is';
import initCollapseMotion from '../_util/motion';
import { cloneElement } from '../_util/reactNode';
import { devUseWarning } from '../_util/warning';
import { useComponentConfig } from '../config-provider/context';
import useSize from '../config-provider/hooks/useSize';
import CollapsePanel from './CollapsePanel';
import useStyle from './style';
const Collapse = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    getPrefixCls,
    direction,
    expandIcon: contextExpandIcon,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles
  } = useComponentConfig('collapse');
  const {
    prefixCls: customizePrefixCls,
    className,
    rootClassName,
    style,
    bordered = true,
    ghost,
    size: customizeSize,
    expandIconPlacement,
    expandIconPosition,
    children,
    destroyInactivePanel,
    destroyOnHidden,
    expandIcon,
    classNames,
    styles
  } = props;
  const mergedSize = useSize(ctx => customizeSize ?? ctx ?? 'middle');
  const prefixCls = getPrefixCls('collapse', customizePrefixCls);
  const rootPrefixCls = getPrefixCls();
  const [hashId, cssVarCls] = useStyle(prefixCls);
  const mergedPlacement = expandIconPlacement ?? expandIconPosition ?? 'start';
  // =========== Merged Props for Semantic ===========
  const mergedProps = {
    ...props,
    size: mergedSize,
    bordered,
    expandIconPlacement: mergedPlacement
  };
  const contextStyleRoot = useSemanticRootStyle(contextStyle);
  const styleRoot = useSemanticRootStyle(style);
  const [mergedClassNames, mergedStyles] = useMergeSemantic([contextClassNames, classNames], [contextStyles, contextStyleRoot, styles, styleRoot], {
    props: mergedProps
  });
  const mergedExpandIcon = expandIcon ?? contextExpandIcon;
  if (process.env.NODE_ENV !== 'production') {
    const warning = devUseWarning('Collapse');
    [['destroyInactivePanel', 'destroyOnHidden'], ['expandIconPosition', 'expandIconPlacement']].forEach(([deprecatedName, newName]) => {
      warning.deprecated(!(deprecatedName in props), deprecatedName, newName);
    });
  }
  const renderExpandIcon = React.useCallback((panelProps = {}) => {
    const icon = isFunction(mergedExpandIcon) ? mergedExpandIcon(panelProps) : (/*#__PURE__*/React.createElement(RightOutlined, {
      rotate: panelProps.isActive ? direction === 'rtl' ? -90 : 90 : undefined,
      "aria-label": panelProps.isActive ? 'expanded' : 'collapsed'
    }));
    return cloneElement(icon, oriProps => ({
      className: clsx(oriProps.className, `${prefixCls}-arrow`)
    }));
  }, [mergedExpandIcon, prefixCls, direction]);
  const collapseClassName = clsx(`${prefixCls}-icon-placement-${mergedPlacement}`, {
    [`${prefixCls}-borderless`]: !bordered,
    [`${prefixCls}-rtl`]: direction === 'rtl',
    [`${prefixCls}-ghost`]: !!ghost,
    [`${prefixCls}-large`]: mergedSize === 'large',
    [`${prefixCls}-small`]: mergedSize === 'small'
  }, contextClassName, className, rootClassName, hashId, cssVarCls, mergedClassNames.root);
  const openMotion = React.useMemo(() => ({
    ...initCollapseMotion(rootPrefixCls),
    motionAppear: false,
    leavedClassName: `${prefixCls}-panel-hidden`
  }), [rootPrefixCls, prefixCls]);
  const items = React.useMemo(() => {
    if (children) {
      return toArray(children).map(child => child);
    }
    return null;
  }, [children]);
  return /*#__PURE__*/React.createElement(RcCollapse, {
    ref: ref,
    openMotion: openMotion,
    ...omit(props, ['rootClassName']),
    expandIcon: renderExpandIcon,
    prefixCls: prefixCls,
    className: collapseClassName,
    style: mergedStyles.root,
    classNames: mergedClassNames,
    styles: mergedStyles,
    destroyOnHidden: destroyOnHidden ?? destroyInactivePanel
  }, items);
});
if (process.env.NODE_ENV !== 'production') {
  Collapse.displayName = 'Collapse';
}
export default Object.assign(Collapse, {
  Panel: CollapsePanel
});