"use client";

import React from 'react';
import { clsx } from 'clsx';
import { useMergeSemantic } from '../_util/hooks/useMergeSemantic';
import { isReactRenderable } from '../_util/is';
import DescriptionsContext from './DescriptionsContext';
const Cell = props => {
  const {
    itemPrefixCls,
    component,
    span,
    className,
    style,
    labelStyle,
    contentStyle,
    bordered,
    label,
    content,
    colon,
    type,
    styles,
    classNames
  } = props;
  const Component = component;
  const {
    classNames: contextClassNames,
    styles: contextStyles
  } = React.useContext(DescriptionsContext);
  const [mergedClassNames, mergedStyles] = useMergeSemantic([contextClassNames, classNames], [contextStyles, styles], {
    props
  });
  const mergedLabelStyle = {
    ...labelStyle,
    ...mergedStyles.label
  };
  const mergedContentStyle = {
    ...contentStyle,
    ...mergedStyles.content
  };
  if (bordered) {
    // The cell element (<th>/<td>) carries the `ant-descriptions-item-label`
    // or `ant-descriptions-item-content` class, so `labelStyle` /
    // `contentStyle` (and the semantic `styles.label` / `styles.content`)
    // must be applied to that cell rather than to the inner <span> wrapper.
    //
    // Both bordered paths in `Row.tsx` (horizontal and vertical) forward
    // the per-type merged style via `styles` and pass the raw item `style`
    // separately, so `Cell` can unconditionally merge `typeStyle` onto the
    // cell here without needing to know which branch produced it.
    let typeStyle;
    if (type === 'label') {
      typeStyle = mergedLabelStyle;
    }
    if (type === 'content') {
      typeStyle = mergedContentStyle;
    }
    const mergedCellStyle = typeStyle ? {
      ...style,
      ...typeStyle
    } : style;
    return /*#__PURE__*/React.createElement(Component, {
      colSpan: span,
      style: mergedCellStyle,
      className: clsx(className, {
        [`${itemPrefixCls}-item-${type}`]: type === 'label' || type === 'content',
        [mergedClassNames.label]: mergedClassNames.label && type === 'label',
        [mergedClassNames.content]: mergedClassNames.content && type === 'content'
      })
    }, isReactRenderable(label) && /*#__PURE__*/React.createElement("span", null, label), isReactRenderable(content) && /*#__PURE__*/React.createElement("span", null, content));
  }
  return /*#__PURE__*/React.createElement(Component, {
    className: clsx(`${itemPrefixCls}-item`, className),
    style: style,
    colSpan: span
  }, /*#__PURE__*/React.createElement("div", {
    className: `${itemPrefixCls}-item-container`
  }, isReactRenderable(label) && (/*#__PURE__*/React.createElement("span", {
    style: mergedLabelStyle,
    className: clsx(`${itemPrefixCls}-item-label`, mergedClassNames.label, {
      [`${itemPrefixCls}-item-no-colon`]: !colon
    })
  }, label)), isReactRenderable(content) && (/*#__PURE__*/React.createElement("span", {
    style: mergedContentStyle,
    className: clsx(`${itemPrefixCls}-item-content`, mergedClassNames.content)
  }, content))));
};
export default Cell;