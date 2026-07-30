function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import { CSSMotionList } from '@rc-component/motion';
import { useComposeRef } from '@rc-component/util';
import { clsx } from 'clsx';
import * as React from 'react';
import useListPosition from "../hooks/useListPosition";
import useStack from "../hooks/useStack";
import Notification from "../Notification";
import { NotificationContext } from "../NotificationProvider";
import Content from "./Content";
const noticeSlotKeys = ['wrapper', 'root', 'icon', 'section', 'title', 'description', 'actions', 'close', 'progress'];
function fillClassNames(classNamesList) {
  return noticeSlotKeys.reduce((mergedClassNames, key) => {
    mergedClassNames[key] = clsx(...classNamesList.map(classNames => classNames?.[key]));
    return mergedClassNames;
  }, {});
}
function fillStyles(stylesList) {
  return noticeSlotKeys.reduce((mergedStyles, key) => {
    mergedStyles[key] = Object.assign({}, ...stylesList.map(styles => styles?.[key]));
    return mergedStyles;
  }, {});
}
function getIndex(keys, key) {
  const strKey = String(key);
  const index = keys.findIndex(item => item.key === strKey);
  if (index === -1) {
    return undefined;
  }
  return keys.length - index - 1;
}
const NotificationListItem = props => {
  const {
    config,
    components,
    contextClassNames,
    classNames,
    styles,
    className,
    style,
    nodeRef,
    listHovering,
    stackEnabled,
    pauseOnHover,
    setNodeSize,
    onNoticeClose,
    ...restProps
  } = props;
  const {
    key,
    placement: itemPlacement,
    ...notificationConfig
  } = config;
  const strKey = String(key);
  const setItemRef = React.useCallback(node => {
    setNodeSize(strKey, node);
  }, [setNodeSize, strKey]);
  const ref = useComposeRef(nodeRef, setItemRef);
  return /*#__PURE__*/React.createElement(Notification, _extends({}, notificationConfig, restProps, {
    ref: ref,
    className: clsx(contextClassNames?.notice, config.className, className),
    style: {
      ...style,
      ...config.style
    },
    classNames: fillClassNames([classNames, config.classNames]),
    styles: fillStyles([styles, config.styles]),
    components: {
      ...components,
      ...config.components
    },
    hovering: stackEnabled && listHovering,
    pauseOnHover: config.pauseOnHover ?? pauseOnHover,
    onClose: () => {
      config.onClose?.();
      onNoticeClose?.(key);
    }
  }));
};
const NotificationList = props => {
  const {
    configList = [],
    prefixCls = 'rc-notification',
    pauseOnHover,
    classNames,
    styles,
    components,
    stack: stackConfig,
    motion,
    placement,
    className,
    style,
    onNoticeClose,
    onAllRemoved
  } = props;
  const {
    classNames: contextClassNames
  } = React.useContext(NotificationContext);

  // ========================== Data ==========================
  const keys = React.useMemo(() => configList.map(config => ({
    config,
    key: String(config.key)
  })), [configList]);

  // ===================== Motion Config ======================
  const placementMotion = typeof motion === 'function' ? motion(placement) : motion;

  // ====================== Stack State =======================
  const [stackEnabled, {
    offset,
    threshold
  }] = useStack(stackConfig);
  const [listHovering, setListHovering] = React.useState(false);
  const expanded = stackEnabled && (listHovering || keys.length <= threshold);

  // ====================== Stack Layout ======================
  const stackPosition = React.useMemo(() => {
    if (!stackEnabled || expanded) {
      return undefined;
    }
    return {
      offset,
      threshold
    };
  }, [expanded, offset, stackEnabled, threshold]);

  // ====================== List Measure ======================
  const [gap, setGap] = React.useState(0);
  const contentRef = React.useRef(null);
  const [notificationPosition, setNodeSize, totalHeight, topNoticeHeight, topNoticeWidth] = useListPosition(configList, stackPosition, gap);
  const hasConfigList = !!configList.length;
  React.useEffect(() => {
    const listNode = contentRef.current;
    if (!listNode) {
      return;
    }

    // CSS gap impacts stack offset and total list height calculation.
    const {
      gap: cssGap,
      rowGap
    } = window.getComputedStyle(listNode);
    const nextGap = parseFloat(rowGap || cssGap) || 0;
    setGap(prevGap => prevGap === nextGap ? prevGap : nextGap);
  }, [hasConfigList]);

  // ========================= Render =========================
  const listPrefixCls = `${prefixCls}-list`;
  return /*#__PURE__*/React.createElement("div", {
    className: clsx(prefixCls, listPrefixCls, `${prefixCls}-${placement}`, contextClassNames?.list, className, classNames?.list, {
      [`${prefixCls}-stack`]: stackEnabled,
      [`${prefixCls}-stack-expanded`]: expanded,
      [`${listPrefixCls}-hovered`]: listHovering
    }),
    onMouseEnter: () => {
      setListHovering(true);
    },
    onMouseLeave: () => {
      setListHovering(false);
    },
    style: {
      ...styles?.list,
      ...style
    }
  }, /*#__PURE__*/React.createElement(Content, {
    listPrefixCls: listPrefixCls,
    height: totalHeight,
    topNoticeHeight: topNoticeHeight,
    topNoticeWidth: topNoticeWidth,
    className: classNames?.listContent,
    style: styles?.listContent,
    ref: contentRef
  }, /*#__PURE__*/React.createElement(CSSMotionList, _extends({
    component: false,
    keys: keys,
    motionAppear: true
  }, placementMotion, {
    onAllRemoved: () => {
      if (placement) {
        onAllRemoved?.(placement);
      }
    }
  }), ({
    config,
    className: motionClassName,
    style: motionStyle
  }, nodeRef) => {
    const {
      key
    } = config;
    const strKey = String(key);
    const notificationIndex = getIndex(keys, key);
    const stackInThreshold = stackEnabled && notificationIndex !== undefined && notificationIndex < threshold;
    return /*#__PURE__*/React.createElement(NotificationListItem, {
      key: key,
      config: config,
      components: components,
      contextClassNames: contextClassNames,
      classNames: classNames,
      styles: styles,
      className: motionClassName,
      style: motionStyle,
      nodeRef: nodeRef,
      prefixCls: prefixCls,
      offset: notificationPosition.get(strKey),
      notificationIndex: notificationIndex,
      stackInThreshold: stackInThreshold,
      listHovering: listHovering,
      stackEnabled: stackEnabled,
      pauseOnHover: pauseOnHover,
      setNodeSize: setNodeSize,
      onNoticeClose: onNoticeClose
    });
  })));
};
export default NotificationList;