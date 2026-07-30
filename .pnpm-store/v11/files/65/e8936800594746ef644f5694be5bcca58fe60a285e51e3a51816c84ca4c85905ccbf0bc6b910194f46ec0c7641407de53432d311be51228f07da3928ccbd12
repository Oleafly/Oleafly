"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _notification = require("@rc-component/notification");
var _clsx = require("clsx");
var _context = require("../config-provider/context");
var _useCSSVarCls = _interopRequireDefault(require("../config-provider/hooks/useCSSVarCls"));
var _PurePanel = require("./PurePanel");
var _style = _interopRequireDefault(require("./style"));
/** @private Internal Component. Do not use in your production. */
const PureList = props => {
  const {
    items,
    classNames,
    placement = 'topRight',
    style
  } = props;
  const {
    getPrefixCls
  } = (0, _context.useComponentConfig)('notification');
  const prefixCls = getPrefixCls('notification');
  const rootCls = (0, _useCSSVarCls.default)(prefixCls);
  const [hashId, cssVarCls] = (0, _style.default)(prefixCls, rootCls);
  const noticePrefixCls = `${prefixCls}-notice`;
  const configList = items.map(item => {
    const {
      actions,
      description,
      duration,
      key,
      showProgress,
      title,
      type
    } = item;
    const typeIconCls = `${noticePrefixCls}-icon-${type}`;
    return {
      key,
      actions,
      closable: {
        closeIcon: (0, _PurePanel.getCloseIcon)(noticePrefixCls)
      },
      description,
      duration,
      icon: _PurePanel.TypeIcon[type],
      showProgress,
      title,
      className: `${noticePrefixCls}-${type}`,
      classNames: {
        icon: typeIconCls
      }
    };
  });
  return /*#__PURE__*/React.createElement(_notification.NotificationList, {
    prefixCls: prefixCls,
    placement: placement,
    configList: configList,
    className: (0, _clsx.clsx)(hashId, cssVarCls, rootCls),
    classNames: classNames,
    style: style,
    stack: false
  });
};
var _default = exports.default = PureList;