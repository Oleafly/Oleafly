"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _react = _interopRequireDefault(require("react"));
var _reactDom = require("react-dom");
var _clsx = require("clsx");
const supportPortalHost = hostDom => typeof HTMLElement !== 'undefined' && hostDom instanceof HTMLElement;
const BorderBeamEffectElement = props => {
  const {
    prefixCls,
    className,
    ...rest
  } = props;
  return /*#__PURE__*/_react.default.createElement("div", {
    "aria-hidden": "true",
    className: (0, _clsx.clsx)(prefixCls, className),
    ...rest
  });
};
const BorderBeamEffect = props => {
  const {
    prefixCls,
    hostDom,
    ...rest
  } = props;
  if (!hostDom || !supportPortalHost(hostDom)) {
    return null;
  }
  return /*#__PURE__*/(0, _reactDom.createPortal)(/*#__PURE__*/_react.default.createElement(BorderBeamEffectElement, {
    prefixCls: prefixCls,
    ...rest
  }), hostDom);
};
var _default = exports.default = BorderBeamEffect;