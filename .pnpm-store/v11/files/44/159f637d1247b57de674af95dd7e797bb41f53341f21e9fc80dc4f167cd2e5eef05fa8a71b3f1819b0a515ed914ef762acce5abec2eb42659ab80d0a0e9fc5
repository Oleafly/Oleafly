import { clsx } from 'clsx';
import * as React from 'react';
export default function PrevNext(props) {
  const {
    prefixCls,
    onActive,
    current,
    count,
    icons: {
      left,
      right,
      prev,
      next
    }
  } = props;
  const switchCls = `${prefixCls}-switch`;
  const prevDisabled = current === 0;
  const nextDisabled = current === count - 1;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    className: clsx(switchCls, `${switchCls}-prev`, {
      [`${switchCls}-disabled`]: prevDisabled
    }),
    onClick: () => onActive(-1),
    disabled: prevDisabled
  }, prev ?? left), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: clsx(switchCls, `${switchCls}-next`, {
      [`${switchCls}-disabled`]: nextDisabled
    }),
    onClick: () => onActive(1),
    disabled: nextDisabled
  }, next ?? right));
}