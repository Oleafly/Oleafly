function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import * as React from 'react';
import { clsx } from 'clsx';
import useNoticeTimer from "./hooks/useNoticeTimer";
import { useEvent } from '@rc-component/util';
import useClosable from "./hooks/useClosable";
import DefaultProgress from "./Progress";
const Notification = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    // Style
    prefixCls,
    className,
    style,
    classNames,
    styles,
    components,
    // UI
    title,
    description,
    icon,
    actions,
    role,
    closable,
    offset,
    notificationIndex,
    stackInThreshold,
    props: rootProps,
    // Behavior
    duration = 4.5,
    showProgress,
    hovering: forcedHovering,
    pauseOnHover = true,
    // Function
    onClick,
    onMouseEnter,
    onMouseLeave,
    onClose
  } = props;
  const [percent, setPercent] = React.useState(0);
  const noticePrefixCls = `${prefixCls}-notice`;

  // ========================= Close ==========================
  const [mergedClosable, closableConfig, closeBtnAriaProps] = useClosable(closable);
  const onInternalClose = useEvent(() => {
    closableConfig.onClose?.();
    onClose?.();
  });

  // ======================== Duration ========================
  const [hovering, setHovering] = React.useState(false);
  const [onResume, onPause] = useNoticeTimer(duration, onInternalClose, setPercent);
  const validPercent = 100 - Math.min(Math.max(percent * 100, 0), 100);
  const Progress = components?.progress || DefaultProgress;
  React.useEffect(() => {
    if (!pauseOnHover) {
      return;
    }
    if (forcedHovering) {
      onPause();
    } else if (!hovering) {
      onResume();
    }
  }, [forcedHovering, hovering, onPause, onResume, pauseOnHover]);

  // ========================= Hover ==========================
  function onInternalMouseEnter(event) {
    setHovering(true);
    if (pauseOnHover) {
      onPause();
    }
    onMouseEnter?.(event);
  }
  function onInternalMouseLeave(event) {
    setHovering(false);
    if (pauseOnHover && !forcedHovering) {
      onResume();
    }
    onMouseLeave?.(event);
  }
  function onInternalCloseClick(event) {
    event.preventDefault();
    event.stopPropagation();
    onInternalClose();
  }

  // ======================== Position ========================
  const offsetRef = React.useRef(offset);
  if (offset !== undefined) {
    offsetRef.current = offset;
  }
  const notificationIndexRef = React.useRef(notificationIndex);
  if (notificationIndex !== undefined) {
    notificationIndexRef.current = notificationIndex;
  }
  const mergedOffset = offset ?? offsetRef.current;
  const mergedNotificationIndex = notificationIndex ?? notificationIndexRef.current ?? 0;

  // ======================== Content =========================
  const titleNode = title !== undefined && title !== null ? /*#__PURE__*/React.createElement("div", {
    className: clsx(`${noticePrefixCls}-title`, classNames?.title),
    style: styles?.title
  }, title) : null;
  const descNode = description !== undefined && description !== null ? /*#__PURE__*/React.createElement("div", {
    className: clsx(`${noticePrefixCls}-description`, classNames?.description),
    style: styles?.description
  }, description) : null;
  const hasTitle = titleNode !== null;
  const hasDescription = descNode !== null;
  let contentNode = null;
  if (hasTitle && hasDescription) {
    contentNode = /*#__PURE__*/React.createElement("div", {
      className: clsx(`${noticePrefixCls}-section`, classNames?.section),
      style: styles?.section
    }, titleNode, descNode);
  } else {
    contentNode = titleNode || descNode;
  }
  if (icon !== undefined && icon !== null) {
    contentNode = /*#__PURE__*/React.createElement("div", {
      className: clsx(`${noticePrefixCls}-wrapper`, classNames?.wrapper),
      style: styles?.wrapper
    }, /*#__PURE__*/React.createElement("div", {
      className: clsx(`${noticePrefixCls}-icon`, classNames?.icon),
      style: styles?.icon
    }, icon), contentNode);
  }
  const actionsNode = actions ? /*#__PURE__*/React.createElement("div", {
    className: clsx(`${noticePrefixCls}-actions`, classNames?.actions),
    style: styles?.actions
  }, actions) : null;

  // ========================= Render =========================
  const mergedStyle = {
    '--notification-index': mergedNotificationIndex,
    ...styles?.root,
    ...style
  };
  if (mergedOffset !== undefined) {
    mergedStyle['--notification-y'] = `${mergedOffset}px`;
  }
  const mergedRole = role ?? rootProps?.role ?? 'alert';
  return /*#__PURE__*/React.createElement("div", _extends({}, rootProps, {
    ref: ref,
    role: mergedRole,
    "data-notification-index": mergedNotificationIndex
    // Styles
    ,
    className: clsx(noticePrefixCls, className, classNames?.root, {
      [`${noticePrefixCls}-closable`]: mergedClosable,
      [`${noticePrefixCls}-stack-in-threshold`]: stackInThreshold
    }),
    style: mergedStyle
    // Events
    ,
    onClick: onClick,
    onMouseEnter: onInternalMouseEnter,
    onMouseLeave: onInternalMouseLeave
  }), contentNode, actionsNode, mergedClosable && /*#__PURE__*/React.createElement("button", _extends({
    className: clsx(`${noticePrefixCls}-close`, classNames?.close),
    "aria-label": "Close"
  }, closeBtnAriaProps, {
    style: styles?.close,
    onClick: onInternalCloseClick
  }), closableConfig.closeIcon), showProgress && typeof duration === 'number' && duration > 0 && /*#__PURE__*/React.createElement(Progress, {
    className: clsx(`${noticePrefixCls}-progress`, classNames?.progress),
    percent: validPercent,
    style: styles?.progress
  }));
});
if (process.env.NODE_ENV !== 'production') {
  Notification.displayName = 'Notification';
}
export default Notification;