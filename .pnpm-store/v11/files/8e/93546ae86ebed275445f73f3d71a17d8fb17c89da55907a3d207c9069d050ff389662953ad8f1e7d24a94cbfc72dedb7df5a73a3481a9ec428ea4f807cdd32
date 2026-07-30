"use client";

import * as React from 'react';
import RcSegmented from '@rc-component/segmented';
import { useId } from '@rc-component/util';
import { clsx } from 'clsx';
import { useOrientation } from '../_util/hooks';
import { useMergeSemantic, useSemanticRootStyle } from '../_util/hooks/useMergeSemantic';
import { isPlainObject } from '../_util/is';
import { useComponentConfig } from '../config-provider/context';
import useSize from '../config-provider/hooks/useSize';
import Tooltip from '../tooltip';
import useStyle from './style';
function isSegmentedLabeledOptionWithIcon(option) {
  return isPlainObject(option) && !!option?.icon;
}
const InternalSegmented = /*#__PURE__*/React.forwardRef((props, ref) => {
  const defaultName = useId();
  const {
    prefixCls: customizePrefixCls,
    className,
    rootClassName,
    block,
    options = [],
    size: customSize,
    style,
    vertical,
    orientation,
    shape = 'default',
    name = defaultName,
    styles,
    classNames,
    ...restProps
  } = props;
  const {
    getPrefixCls,
    direction,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles
  } = useComponentConfig('segmented');
  const mergedProps = {
    ...props,
    options,
    size: customSize,
    shape
  };
  const contextStyleRoot = useSemanticRootStyle(contextStyle);
  const styleRoot = useSemanticRootStyle(style);
  const [mergedClassNames, mergedStyles] = useMergeSemantic([contextClassNames, classNames], [contextStyles, contextStyleRoot, styles, styleRoot], {
    props: mergedProps
  });
  const prefixCls = getPrefixCls('segmented', customizePrefixCls);
  // Style
  const [hashId, cssVarCls] = useStyle(prefixCls);
  // ===================== Size =====================
  const mergedSize = useSize(customSize);
  // syntactic sugar to support `icon` for Segmented Item
  const extendedOptions = React.useMemo(() => options.map(option => {
    if (isSegmentedLabeledOptionWithIcon(option)) {
      const {
        icon,
        label,
        ...restOption
      } = option;
      return {
        ...restOption,
        label: (/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
          className: clsx(`${prefixCls}-item-icon`, mergedClassNames.icon),
          style: mergedStyles.icon
        }, icon), label && /*#__PURE__*/React.createElement("span", null, label)))
      };
    }
    return option;
  }), [options, prefixCls, mergedClassNames.icon, mergedStyles.icon]);
  const [, mergedVertical] = useOrientation(orientation, vertical);
  const cls = clsx(className, rootClassName, contextClassName, mergedClassNames.root, {
    [`${prefixCls}-block`]: block,
    [`${prefixCls}-sm`]: mergedSize === 'small',
    [`${prefixCls}-lg`]: mergedSize === 'large',
    [`${prefixCls}-vertical`]: mergedVertical,
    [`${prefixCls}-shape-${shape}`]: shape === 'round'
  }, hashId, cssVarCls);
  const itemRender = (node, {
    item
  }) => {
    if (!item.tooltip) {
      return node;
    }
    const tooltipProps = isPlainObject(item.tooltip) ? item.tooltip : {
      title: item.tooltip
    };
    return /*#__PURE__*/React.createElement(Tooltip, {
      ...tooltipProps
    }, node);
  };
  return /*#__PURE__*/React.createElement(RcSegmented, {
    ...restProps,
    name: name,
    className: cls,
    style: mergedStyles.root,
    classNames: mergedClassNames,
    styles: mergedStyles,
    itemRender: itemRender,
    options: extendedOptions,
    ref: ref,
    prefixCls: prefixCls,
    direction: direction,
    vertical: mergedVertical
  });
});
const Segmented = InternalSegmented;
if (process.env.NODE_ENV !== 'production') {
  Segmented.displayName = 'Segmented';
}
export default Segmented;