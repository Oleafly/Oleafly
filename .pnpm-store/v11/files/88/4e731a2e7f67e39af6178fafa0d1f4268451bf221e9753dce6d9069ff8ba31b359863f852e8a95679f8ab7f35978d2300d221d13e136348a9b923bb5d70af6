"use client";

/* eslint-disable react/no-array-index-key */
import * as React from 'react';
import { clsx } from 'clsx';
import { useMergeSemantic, useSemanticRootStyle } from '../_util/hooks/useMergeSemantic';
import { isNumber } from '../_util/is';
import { matchScreen } from '../_util/responsiveObserver';
import { devUseWarning } from '../_util/warning';
import { useComponentConfig } from '../config-provider/context';
import useSize from '../config-provider/hooks/useSize';
import useBreakpoint from '../grid/hooks/useBreakpoint';
import DEFAULT_COLUMN_MAP from './constant';
import DescriptionsContext from './DescriptionsContext';
import useItems from './hooks/useItems';
import useRow from './hooks/useRow';
import DescriptionsItem from './Item';
import Row from './Row';
import useStyle from './style';
const Descriptions = props => {
  const {
    prefixCls: customizePrefixCls,
    title,
    extra,
    column,
    colon = true,
    bordered,
    layout,
    children,
    className,
    rootClassName,
    style,
    size: customizeSize,
    labelStyle,
    contentStyle,
    styles,
    items,
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
  } = useComponentConfig('descriptions');
  const prefixCls = getPrefixCls('descriptions', customizePrefixCls);
  const screens = useBreakpoint();
  // ============================== Warn ==============================
  if (process.env.NODE_ENV !== 'production') {
    const warning = devUseWarning('Descriptions');
    warning.deprecated(customizeSize !== 'default', 'size="default"', 'size="large"');
    [['labelStyle', 'styles.label'], ['contentStyle', 'styles.content']].forEach(([deprecatedName, newName]) => {
      warning.deprecated(!(deprecatedName in props), deprecatedName, newName);
    });
  }
  // Column count
  // Mobile-first cascade: try the user-supplied map first (scanning large→small
  // over cumulative min-width screens, so a lower breakpoint like `md` is still
  // "active" on an `lg` viewport).  Only fall back to DEFAULT_COLUMN_MAP when
  // no user-supplied breakpoint is active at all.
  const mergedColumn = React.useMemo(() => {
    if (isNumber(column)) {
      return column;
    }
    return matchScreen(screens, column) ?? matchScreen(screens, DEFAULT_COLUMN_MAP) ?? 3;
  }, [screens, column]);
  // Items with responsive
  const mergedItems = useItems(screens, items, children);
  const mergedSize = useSize(customizeSize);
  const rows = useRow(mergedColumn, mergedItems);
  const [hashId, cssVarCls] = useStyle(prefixCls);
  // =========== Merged Props for Semantic ==========
  const mergedProps = {
    ...props,
    column: mergedColumn,
    items: mergedItems,
    size: mergedSize
  };
  const contextStyleRoot = useSemanticRootStyle(contextStyle);
  const styleRoot = useSemanticRootStyle(style);
  const [mergedClassNames, mergedStyles] = useMergeSemantic([contextClassNames, classNames], [contextStyles, contextStyleRoot, styles, styleRoot], {
    props: mergedProps
  });
  // ======================== Render ========================
  const memoizedValue = React.useMemo(() => ({
    labelStyle,
    contentStyle,
    styles: {
      label: mergedStyles.label,
      content: mergedStyles.content
    },
    classNames: {
      label: mergedClassNames.label,
      content: mergedClassNames.content
    }
  }), [labelStyle, contentStyle, mergedStyles.label, mergedStyles.content, mergedClassNames.label, mergedClassNames.content]);
  return /*#__PURE__*/React.createElement(DescriptionsContext.Provider, {
    value: memoizedValue
  }, /*#__PURE__*/React.createElement("div", {
    className: clsx(prefixCls, contextClassName, mergedClassNames.root, {
      [`${prefixCls}-medium`]: mergedSize === 'medium' || mergedSize === 'middle',
      [`${prefixCls}-small`]: mergedSize === 'small',
      [`${prefixCls}-bordered`]: !!bordered,
      [`${prefixCls}-rtl`]: direction === 'rtl'
    }, className, rootClassName, hashId, cssVarCls),
    style: mergedStyles.root,
    ...restProps
  }, (title || extra) && (/*#__PURE__*/React.createElement("div", {
    className: clsx(`${prefixCls}-header`, mergedClassNames.header),
    style: mergedStyles.header
  }, title && (/*#__PURE__*/React.createElement("div", {
    className: clsx(`${prefixCls}-title`, mergedClassNames.title),
    style: mergedStyles.title
  }, title)), extra && (/*#__PURE__*/React.createElement("div", {
    className: clsx(`${prefixCls}-extra`, mergedClassNames.extra),
    style: mergedStyles.extra
  }, extra)))), /*#__PURE__*/React.createElement("div", {
    className: `${prefixCls}-view`
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("tbody", null, rows.map((row, index) => (/*#__PURE__*/React.createElement(Row, {
    key: index,
    index: index,
    colon: colon,
    prefixCls: prefixCls,
    vertical: layout === 'vertical',
    bordered: bordered,
    row: row
  }))))))));
};
if (process.env.NODE_ENV !== 'production') {
  Descriptions.displayName = 'Descriptions';
}
export { DescriptionsContext };
Descriptions.Item = DescriptionsItem;
export default Descriptions;