function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import { clsx } from 'clsx';
import * as React from 'react';
const Content = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    listPrefixCls,
    height,
    topNoticeHeight = 0,
    topNoticeWidth = 0,
    className,
    style,
    ...restProps
  } = props;
  const contentPrefixCls = `${listPrefixCls}-content`;

  // ========================= Height =========================
  const prevHeightRef = React.useRef(height);
  const prevHeight = prevHeightRef.current;
  const heightStatus = height < prevHeight ? 'decrease' : 'increase';
  prevHeightRef.current = height;

  // ========================= Style ==========================
  const contentStyle = {
    ...style,
    height,
    '--top-notificiation-height': `${topNoticeHeight}px`,
    '--top-notificiation-width': `${topNoticeWidth}px`
  };

  // ========================= Render =========================
  return /*#__PURE__*/React.createElement("div", _extends({}, restProps, {
    className: clsx(contentPrefixCls, `${contentPrefixCls}-${heightStatus}`, className),
    style: contentStyle,
    ref: ref
  }));
});
if (process.env.NODE_ENV !== 'production') {
  Content.displayName = 'NotificationListContent';
}
export default Content;