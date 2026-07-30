"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.TypeIcon = void 0;
exports.getCloseIcon = getCloseIcon;
var React = _interopRequireWildcard(require("react"));
var _CheckCircleFilled = _interopRequireDefault(require("@ant-design/icons/CheckCircleFilled"));
var _CloseCircleFilled = _interopRequireDefault(require("@ant-design/icons/CloseCircleFilled"));
var _CloseOutlined = _interopRequireDefault(require("@ant-design/icons/CloseOutlined"));
var _ExclamationCircleFilled = _interopRequireDefault(require("@ant-design/icons/ExclamationCircleFilled"));
var _InfoCircleFilled = _interopRequireDefault(require("@ant-design/icons/InfoCircleFilled"));
var _LoadingOutlined = _interopRequireDefault(require("@ant-design/icons/LoadingOutlined"));
var _notification = require("@rc-component/notification");
var _clsx = require("clsx");
var _hooks = require("../_util/hooks");
var _useMergeSemantic = require("../_util/hooks/useMergeSemantic");
var _is = require("../_util/is");
var _warning = require("../_util/warning");
var _configProvider = require("../config-provider");
var _context = require("../config-provider/context");
var _useCSSVarCls = _interopRequireDefault(require("../config-provider/hooks/useCSSVarCls"));
var _style = _interopRequireWildcard(require("./style"));
const TypeIcon = exports.TypeIcon = {
  info: /*#__PURE__*/React.createElement(_InfoCircleFilled.default, null),
  success: /*#__PURE__*/React.createElement(_CheckCircleFilled.default, null),
  error: /*#__PURE__*/React.createElement(_CloseCircleFilled.default, null),
  warning: /*#__PURE__*/React.createElement(_ExclamationCircleFilled.default, null),
  loading: /*#__PURE__*/React.createElement(_LoadingOutlined.default, null)
};
function getCloseIcon(prefixCls, closeIcon) {
  if (closeIcon === null || closeIcon === false) {
    return null;
  }
  return closeIcon || /*#__PURE__*/React.createElement(_CloseOutlined.default, {
    className: `${prefixCls}-close-icon`
  });
}
/** @private Internal Component. Do not use in your production. */
const PurePanel = props => {
  const {
    prefixCls: staticPrefixCls,
    icon,
    type,
    message,
    title,
    description,
    btn,
    actions,
    closeIcon: _closeIcon,
    className: notificationClassName,
    style,
    styles,
    classNames: notificationClassNames,
    closable,
    role,
    ...restProps
  } = props;
  const {
    getPrefixCls,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles
  } = (0, _context.useComponentConfig)('notification');
  const [mergedClassNames, mergedStyles] = (0, _useMergeSemantic.useMergeSemantic)([contextClassNames, notificationClassNames], [contextStyles, styles], {
    props
  });
  const {
    notification: notificationContext
  } = React.useContext(_configProvider.ConfigContext);
  const mergedActions = actions ?? btn;
  if (process.env.NODE_ENV !== 'production') {
    const warning = (0, _warning.devUseWarning)('Notification');
    [['btn', 'actions'], ['message', 'title']].forEach(([deprecatedName, newName]) => {
      warning.deprecated(!(deprecatedName in props), deprecatedName, newName);
    });
  }
  const mergedTitle = title ?? message;
  const hasTitle = (0, _is.isReactRenderable)(mergedTitle);
  const prefixCls = staticPrefixCls || getPrefixCls('notification');
  const noticePrefixCls = `${prefixCls}-notice`;
  const iconNode = icon || (type ? TypeIcon[type] : null);
  const typeIconCls = !icon && type ? `${noticePrefixCls}-icon-${type}` : undefined;
  const {
    root: rootClassName,
    ...contentClassNames
  } = mergedClassNames;
  const {
    root: rootStyle,
    ...contentStyles
  } = mergedStyles;
  const rootCls = (0, _useCSSVarCls.default)(prefixCls);
  const [hashId, cssVarCls] = (0, _style.default)(prefixCls, rootCls);
  const [rawClosable, mergedCloseIcon,, ariaProps] = (0, _hooks.useClosable)((0, _hooks.pickClosable)(props), (0, _hooks.pickClosable)(notificationContext), {
    closable: true,
    closeIcon: /*#__PURE__*/React.createElement(_CloseOutlined.default, {
      className: `${prefixCls}-close-icon`
    }),
    closeIconRender: icon => getCloseIcon(prefixCls, icon)
  });
  const mergedClosable = rawClosable ? {
    onClose: (0, _is.isPlainObject)(closable) ? closable?.onClose : undefined,
    closeIcon: mergedCloseIcon,
    ...ariaProps
  } : false;
  return /*#__PURE__*/React.createElement("div", {
    className: (0, _clsx.clsx)(`${noticePrefixCls}-pure-panel`, hashId, notificationClassName, cssVarCls, rootCls, rootClassName),
    style: rootStyle
  }, /*#__PURE__*/React.createElement(_style.PurePanelStyle, {
    prefixCls: prefixCls
  }), /*#__PURE__*/React.createElement(_notification.Notification, {
    style: {
      ...contextStyle,
      ...style
    },
    ...restProps,
    prefixCls: prefixCls,
    duration: null,
    closable: mergedClosable,
    className: contextClassName,
    title: hasTitle ? mergedTitle : null,
    description: description,
    icon: iconNode,
    actions: mergedActions,
    role: role,
    classNames: {
      ...contentClassNames,
      icon: (0, _clsx.clsx)(typeIconCls, contentClassNames.icon)
    },
    styles: contentStyles
  }));
};
var _default = exports.default = PurePanel;