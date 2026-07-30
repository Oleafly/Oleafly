"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useNotification;
exports.useInternalNotification = useInternalNotification;
var _react = _interopRequireWildcard(require("react"));
var _notification = require("@rc-component/notification");
var _clsx = require("clsx");
var _hooks = require("../_util/hooks");
var _useMergeSemantic = require("../_util/hooks/useMergeSemantic");
var _is = require("../_util/is");
var _warning = require("../_util/warning");
var _configProvider = require("../config-provider");
var _context = require("../config-provider/context");
var _useCSSVarCls = _interopRequireDefault(require("../config-provider/hooks/useCSSVarCls"));
var _useStackConfig = _interopRequireDefault(require("./hooks/useStackConfig"));
var _PurePanel = require("./PurePanel");
var _style = _interopRequireDefault(require("./style"));
var _util = require("./util");
const DEFAULT_DURATION = 4.5;
const DEFAULT_PLACEMENT = 'topRight';
const DEFAULT_STACK_CONFIG = {
  offset: 8
};
const Wrapper = ({
  children,
  prefixCls
}) => {
  const rootCls = (0, _useCSSVarCls.default)(prefixCls);
  const [hashId, cssVarCls] = (0, _style.default)(prefixCls, rootCls);
  return /*#__PURE__*/_react.default.createElement(_notification.NotificationProvider, {
    classNames: {
      list: (0, _clsx.clsx)(hashId, cssVarCls, rootCls)
    }
  }, children);
};
const renderNotifications = (node, {
  prefixCls,
  key
}) => (/*#__PURE__*/_react.default.createElement(Wrapper, {
  prefixCls: prefixCls,
  key: key
}, node));
const Holder = /*#__PURE__*/_react.default.forwardRef((props, ref) => {
  const {
    top,
    bottom,
    prefixCls: staticPrefixCls,
    getContainer: staticGetContainer,
    maxCount,
    rtl,
    onAllRemoved,
    stack,
    duration = DEFAULT_DURATION,
    pauseOnHover = true,
    showProgress
  } = props;
  const {
    getPrefixCls,
    getPopupContainer,
    direction
  } = (0, _context.useComponentConfig)('notification');
  const {
    notification
  } = (0, _react.useContext)(_configProvider.ConfigContext);
  const prefixCls = staticPrefixCls || getPrefixCls('notification');
  const mergedDuration = (0, _react.useMemo)(() => (0, _is.isNumber)(duration) && duration > 0 ? duration : false, [duration]);
  const [mergedClassNames, mergedStyles] = (0, _useMergeSemantic.useMergeSemantic)([notification?.classNames, props?.classNames], [notification?.styles, props?.styles], {
    props
  });
  // =============================== Style ===============================
  const getStyle = () => (0, _util.getPlacementOffsetStyle)(top, bottom);
  const getClassName = () => (0, _clsx.clsx)({
    [`${prefixCls}-rtl`]: rtl ?? direction === 'rtl'
  });
  // ============================== Motion ===============================
  const getNotificationMotion = () => (0, _util.getMotion)(prefixCls);
  // =============================== Stack ===============================
  const stackConfig = (0, _useStackConfig.default)(stack, DEFAULT_STACK_CONFIG);
  // ============================== Origin ===============================
  const [api, holder] = (0, _notification.useNotification)({
    prefixCls,
    style: getStyle,
    className: getClassName,
    motion: getNotificationMotion,
    closable: {
      closeIcon: (0, _PurePanel.getCloseIcon)(prefixCls)
    },
    duration: mergedDuration,
    getContainer: () => staticGetContainer?.() || getPopupContainer?.() || document.body,
    maxCount,
    pauseOnHover,
    showProgress,
    classNames: mergedClassNames,
    styles: mergedStyles,
    onAllRemoved,
    renderNotifications,
    stack: stackConfig
  });
  // ================================ Ref ================================
  _react.default.useImperativeHandle(ref, () => ({
    ...api,
    prefixCls,
    notification
  }));
  return holder;
});
// ==============================================================================
// ==                                   Hook                                   ==
// ==============================================================================
function useInternalNotification(notificationConfig) {
  const holderRef = _react.default.useRef(null);
  const warning = (0, _warning.devUseWarning)('Notification');
  const {
    notification: notificationContext
  } = _react.default.useContext(_configProvider.ConfigContext);
  // ================================ API ================================
  const wrapAPI = _react.default.useMemo(() => {
    // Wrap with notification content
    // >>> Open
    const open = config => {
      if (!holderRef.current) {
        process.env.NODE_ENV !== "production" ? warning(false, 'usage', 'You are calling notice in render which will break in React 18 concurrent mode. Please trigger in effect instead.') : void 0;
        return;
      }
      const {
        open: originOpen,
        prefixCls,
        notification
      } = holderRef.current;
      const contextClassName = notification?.className || {};
      const contextStyle = notification?.style || {};
      const noticePrefixCls = `${prefixCls}-notice`;
      const {
        title,
        message,
        description,
        icon,
        type,
        btn,
        actions,
        className,
        style,
        role = 'alert',
        closeIcon,
        closable,
        classNames: configClassNames = {},
        styles = {},
        ...restConfig
      } = config;
      if (process.env.NODE_ENV !== 'production') {
        [['btn', 'actions'], ['message', 'title']].forEach(([deprecatedName, newName]) => {
          warning.deprecated(!(deprecatedName in config), deprecatedName, newName);
        });
      }
      const mergedTitle = title ?? message;
      const hasTitle = (0, _is.isReactRenderable)(mergedTitle);
      const mergedActions = actions ?? btn;
      const realCloseIcon = (0, _PurePanel.getCloseIcon)(noticePrefixCls, (0, _util.getCloseIconConfig)(closeIcon, notificationConfig, notification));
      const [rawClosable, mergedCloseIcon,, ariaProps] = (0, _hooks.computeClosable)((0, _hooks.pickClosable)({
        ...(notificationConfig || {}),
        ...config
      }), (0, _hooks.pickClosable)(notificationContext), {
        closable: true,
        closeIcon: realCloseIcon
      });
      const mergedClosable = rawClosable ? {
        onClose: (0, _is.isPlainObject)(closable) ? closable.onClose : undefined,
        closeIcon: mergedCloseIcon,
        ...ariaProps
      } : false;
      const semanticClassNames = (0, _useMergeSemantic.resolveStyleOrClass)(configClassNames, {
        props: config
      });
      const semanticStyles = (0, _useMergeSemantic.resolveStyleOrClass)(styles, {
        props: config
      });
      const iconNode = icon || (type ? _PurePanel.TypeIcon[type] : null);
      const typeIconCls = !icon && type ? `${noticePrefixCls}-icon-${type}` : undefined;
      return originOpen({
        // use placement from props instead of hard-coding "topRight"
        placement: notificationConfig?.placement ?? DEFAULT_PLACEMENT,
        ...restConfig,
        title: hasTitle ? mergedTitle : null,
        description,
        icon: iconNode,
        actions: mergedActions,
        role,
        classNames: {
          ...semanticClassNames,
          icon: (0, _clsx.clsx)(typeIconCls, semanticClassNames?.icon)
        },
        styles: {
          ...semanticStyles,
          root: {
            ...contextStyle,
            ...semanticStyles?.root
          }
        },
        className: (0, _clsx.clsx)({
          [`${noticePrefixCls}-${type}`]: type
        }, className, contextClassName),
        style,
        closable: mergedClosable
      });
    };
    // >>> destroy
    const destroy = key => {
      if (key !== undefined) {
        holderRef.current?.close(key);
      } else {
        holderRef.current?.destroy();
      }
    };
    const clone = {
      open,
      destroy
    };
    const keys = ['success', 'info', 'warning', 'error'];
    keys.forEach(type => {
      clone[type] = config => open({
        ...config,
        type
      });
    });
    return clone;
  }, [notificationConfig, notificationContext]);
  // ============================== Return ===============================
  return [wrapAPI, /*#__PURE__*/_react.default.createElement(Holder, {
    key: "notification-holder",
    ...notificationConfig,
    ref: holderRef
  })];
}
function useNotification(notificationConfig) {
  return useInternalNotification(notificationConfig);
}