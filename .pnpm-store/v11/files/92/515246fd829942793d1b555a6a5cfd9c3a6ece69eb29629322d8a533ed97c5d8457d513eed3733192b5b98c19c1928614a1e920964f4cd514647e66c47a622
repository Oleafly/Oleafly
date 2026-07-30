"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useMessage;
exports.useInternalMessage = useInternalMessage;
var React = _interopRequireWildcard(require("react"));
var _notification = require("@rc-component/notification");
var _clsx = require("clsx");
var _useMergeSemantic = require("../_util/hooks/useMergeSemantic");
var _is = require("../_util/is");
var _warning = require("../_util/warning");
var _configProvider = require("../config-provider");
var _context = require("../config-provider/context");
var _useCSSVarCls = _interopRequireDefault(require("../config-provider/hooks/useCSSVarCls"));
var _useStackConfig = _interopRequireDefault(require("../notification/hooks/useStackConfig"));
var _util = require("../notification/util");
var _PurePanel = require("./PurePanel");
var _style = _interopRequireDefault(require("./style"));
var _util2 = require("./util");
const DEFAULT_OFFSET = 8;
const DEFAULT_DURATION = 3;
const DEFAULT_STACK_CONFIG = false;
const Wrapper = ({
  children,
  prefixCls
}) => {
  const rootCls = (0, _useCSSVarCls.default)(prefixCls);
  const [hashId, cssVarCls] = (0, _style.default)(prefixCls, rootCls);
  return /*#__PURE__*/React.createElement(_notification.NotificationProvider, {
    classNames: {
      list: (0, _clsx.clsx)(hashId, cssVarCls, rootCls)
    }
  }, children);
};
const renderNotifications = (node, {
  prefixCls,
  key
}) => (/*#__PURE__*/React.createElement(Wrapper, {
  prefixCls: prefixCls,
  key: key
}, node));
const Holder = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    // Placement
    top,
    // Config
    prefixCls: staticPrefixCls,
    getContainer: staticGetContainer,
    maxCount,
    duration = DEFAULT_DURATION,
    // Style
    rtl,
    classNames,
    styles,
    // Motion
    transitionName,
    // UI
    pauseOnHover = true,
    stack,
    // Life Cycle
    onAllRemoved
  } = props;
  const {
    getPrefixCls,
    direction,
    getPopupContainer
  } = (0, _context.useComponentConfig)('message');
  const {
    message
  } = React.useContext(_configProvider.ConfigContext);
  const prefixCls = staticPrefixCls || getPrefixCls('message');
  // Use useMergeSemantic to merge classNames and styles
  const [mergedClassNames, mergedStyles] = (0, _useMergeSemantic.useMergeSemantic)([message?.classNames, classNames], [message?.styles, styles], {
    props: props
  });
  // =============================== Style ===============================
  const getStyle = () => (0, _util.getPlacementOffsetStyle)(top ?? DEFAULT_OFFSET);
  const getClassName = () => (0, _clsx.clsx)({
    [`${prefixCls}-rtl`]: rtl ?? direction === 'rtl'
  });
  // ============================== Motion ===============================
  const getNotificationMotion = () => (0, _util2.getMotion)(prefixCls, transitionName);
  // =============================== Stack ===============================
  const stackConfig = (0, _useStackConfig.default)(stack, DEFAULT_STACK_CONFIG);
  // ============================== Origin ===============================
  const [api, holder] = (0, _notification.useNotification)({
    prefixCls,
    style: getStyle,
    className: getClassName,
    motion: getNotificationMotion,
    // closable=false requires-no closeIcon
    closable: false,
    duration,
    getContainer: () => staticGetContainer?.() || getPopupContainer?.() || document.body,
    maxCount,
    onAllRemoved,
    classNames: mergedClassNames,
    styles: mergedStyles,
    renderNotifications,
    pauseOnHover,
    stack: stackConfig
  });
  // ================================ Ref ================================
  React.useImperativeHandle(ref, () => ({
    ...api,
    prefixCls,
    message
  }));
  return holder;
});
// ==============================================================================
// ==                                   Hook                                   ==
// ==============================================================================
let keyIndex = 0;
function useInternalMessage(messageConfig) {
  const holderRef = React.useRef(null);
  const warning = (0, _warning.devUseWarning)('Message');
  // ================================ API ================================
  const wrapAPI = React.useMemo(() => {
    // Wrap with notification content
    // >>> close
    const close = key => {
      holderRef.current?.close(key);
    };
    // >>> Open
    const open = config => {
      if (!holderRef.current) {
        process.env.NODE_ENV !== "production" ? warning(false, 'usage', 'You are calling notice in render which will break in React 18 concurrent mode. Please trigger in effect instead.') : void 0;
        const fakeResult = () => {};
        fakeResult.then = () => {};
        return fakeResult;
      }
      const {
        open: originOpen,
        prefixCls,
        message
      } = holderRef.current;
      const contextClassName = message?.className || {};
      const contextStyle = message?.style || {};
      const noticePrefixCls = `${prefixCls}-notice`;
      const {
        content,
        icon,
        type,
        key,
        className,
        style,
        onClose,
        classNames: configClassNames = {},
        styles = {},
        ...restConfig
      } = config;
      let mergedKey = key;
      if (!(0, _is.isNonNullable)(mergedKey)) {
        keyIndex += 1;
        mergedKey = `antd-message-${keyIndex}`;
      }
      const contextConfig = {
        ...messageConfig,
        ...config
      };
      const semanticClassNames = (0, _useMergeSemantic.resolveStyleOrClass)(configClassNames, {
        props: contextConfig
      });
      const semanticStyles = (0, _useMergeSemantic.resolveStyleOrClass)(styles, {
        props: contextConfig
      });
      const iconNode = (0, _PurePanel.getMessageIcon)(type, icon);
      const typeIconCls = type ? `${noticePrefixCls}-icon-${type}` : undefined;
      return (0, _util2.wrapPromiseFn)(resolve => {
        originOpen({
          ...restConfig,
          key: mergedKey,
          icon: iconNode,
          title: content,
          classNames: {
            ...semanticClassNames,
            wrapper: (0, _clsx.clsx)(type && `${prefixCls}-${type}`, semanticClassNames?.wrapper),
            icon: (0, _clsx.clsx)(typeIconCls, semanticClassNames?.icon)
          },
          styles: semanticStyles,
          placement: 'top',
          className: (0, _clsx.clsx)({
            [`${noticePrefixCls}-${type}`]: type
          }, className, contextClassName),
          style: {
            ...contextStyle,
            ...style
          },
          onClose: () => {
            onClose?.();
            resolve();
          }
        });
        // Return close function
        return () => {
          close(mergedKey);
        };
      });
    };
    // >>> destroy
    const destroy = key => {
      if (key !== undefined) {
        close(key);
      } else {
        holderRef.current?.destroy();
      }
    };
    const clone = {
      open,
      destroy
    };
    const keys = ['info', 'success', 'warning', 'error', 'loading'];
    keys.forEach(type => {
      const typeOpen = (jointContent, duration, onClose) => {
        let config;
        if ((0, _is.isPlainObject)(jointContent) && 'content' in jointContent) {
          config = jointContent;
        } else {
          config = {
            content: jointContent
          };
        }
        // Params
        let mergedDuration;
        let mergedOnClose;
        if ((0, _is.isFunction)(duration)) {
          mergedOnClose = duration;
        } else {
          mergedDuration = duration;
          mergedOnClose = onClose;
        }
        const mergedConfig = {
          onClose: mergedOnClose,
          duration: mergedDuration,
          ...config,
          type
        };
        return open(mergedConfig);
      };
      clone[type] = typeOpen;
    });
    return clone;
  }, []);
  // ============================== Return ===============================
  return [wrapAPI, /*#__PURE__*/React.createElement(Holder, {
    key: "message-holder",
    ...messageConfig,
    ref: holderRef
  })];
}
function useMessage(messageConfig) {
  return useInternalMessage(messageConfig);
}