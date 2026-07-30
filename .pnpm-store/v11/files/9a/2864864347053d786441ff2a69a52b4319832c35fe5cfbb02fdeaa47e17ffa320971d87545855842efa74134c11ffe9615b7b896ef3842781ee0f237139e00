"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getMessageIcon = exports.default = exports.TypeIcon = void 0;
var React = _interopRequireWildcard(require("react"));
var _CheckCircleFilled = _interopRequireDefault(require("@ant-design/icons/CheckCircleFilled"));
var _CloseCircleFilled = _interopRequireDefault(require("@ant-design/icons/CloseCircleFilled"));
var _ExclamationCircleFilled = _interopRequireDefault(require("@ant-design/icons/ExclamationCircleFilled"));
var _InfoCircleFilled = _interopRequireDefault(require("@ant-design/icons/InfoCircleFilled"));
var _LoadingOutlined = _interopRequireDefault(require("@ant-design/icons/LoadingOutlined"));
var _notification = require("@rc-component/notification");
var _clsx = require("clsx");
var _useMergeSemantic = require("../_util/hooks/useMergeSemantic");
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
const getMessageIcon = (type, icon) => icon || type && TypeIcon[type] || null;
/** @private Internal Component. Do not use in your production. */
exports.getMessageIcon = getMessageIcon;
const PurePanel = props => {
  const {
    prefixCls: staticPrefixCls,
    className,
    style,
    type,
    icon,
    content,
    classNames: messageClassNames,
    styles,
    ...restProps
  } = props;
  const {
    getPrefixCls,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles
  } = (0, _context.useComponentConfig)('message');
  const prefixCls = staticPrefixCls || getPrefixCls('message');
  const noticePrefixCls = `${prefixCls}-notice`;
  const rootCls = (0, _useCSSVarCls.default)(prefixCls);
  const [hashId, cssVarCls] = (0, _style.default)(prefixCls, rootCls);
  const [mergedClassNames, mergedStyles] = (0, _useMergeSemantic.useMergeSemantic)([contextClassNames, messageClassNames], [contextStyles, styles], {
    props: props
  });
  const iconNode = getMessageIcon(type, icon);
  const typeIconCls = type ? `${noticePrefixCls}-icon-${type}` : undefined;
  const rcClassNames = {
    wrapper: (0, _clsx.clsx)(type && `${prefixCls}-${type}`, mergedClassNames.wrapper),
    icon: (0, _clsx.clsx)(typeIconCls, mergedClassNames.icon),
    title: mergedClassNames.title
  };
  const rcStyles = {
    wrapper: mergedStyles.wrapper,
    icon: mergedStyles.icon,
    title: mergedStyles.title
  };
  return /*#__PURE__*/React.createElement("div", {
    className: (0, _clsx.clsx)(`${noticePrefixCls}-pure-panel`, hashId, className, cssVarCls, rootCls, mergedClassNames.root),
    style: mergedStyles.root
  }, /*#__PURE__*/React.createElement(_style.PurePanelStyle, {
    prefixCls: prefixCls
  }), /*#__PURE__*/React.createElement(_notification.Notification, {
    ...restProps,
    prefixCls: prefixCls,
    className: contextClassName,
    style: {
      ...contextStyle,
      ...style
    },
    duration: null,
    icon: iconNode,
    title: content,
    classNames: rcClassNames,
    styles: rcStyles
  }));
};
var _default = exports.default = PurePanel;