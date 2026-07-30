"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useAntdTheme = void 0;
var _objectSpread2 = _interopRequireDefault(require("@babel/runtime/helpers/objectSpread2"));
var _react = require("react");
var _antd = require("antd");
var _useAntdStylish = require("./useAntdStylish");
var useAntdTheme = exports.useAntdTheme = function useAntdTheme() {
  var _theme$useToken = _antd.theme.useToken(),
    token = _theme$useToken.token,
    cssVar = _theme$useToken.cssVar;
  var stylish = (0, _useAntdStylish.useAntdStylish)();
  return (0, _react.useMemo)(function () {
    return (0, _objectSpread2.default)((0, _objectSpread2.default)({}, token), {}, {
      stylish: stylish,
      cssVar: cssVar
    });
  }, [token, stylish, cssVar]);
};