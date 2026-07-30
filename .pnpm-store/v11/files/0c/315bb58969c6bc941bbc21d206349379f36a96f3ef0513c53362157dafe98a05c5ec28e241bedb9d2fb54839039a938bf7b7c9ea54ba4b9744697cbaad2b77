"use client";

import * as React from 'react';
import { clsx } from 'clsx';
import { isReactRenderable } from '../_util/is';
import { SpaceContext } from './context';
const Item = props => {
  const {
    className,
    prefix,
    index,
    children,
    separator,
    style,
    classNames,
    styles
  } = props;
  const {
    latestIndex
  } = React.useContext(SpaceContext);
  if (!isReactRenderable(children)) {
    return null;
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: className,
    style: style
  }, children), index < latestIndex && separator && (/*#__PURE__*/React.createElement("span", {
    className: clsx(`${prefix}-item-separator`, classNames?.separator),
    style: styles?.separator
  }, separator)));
};
export default Item;