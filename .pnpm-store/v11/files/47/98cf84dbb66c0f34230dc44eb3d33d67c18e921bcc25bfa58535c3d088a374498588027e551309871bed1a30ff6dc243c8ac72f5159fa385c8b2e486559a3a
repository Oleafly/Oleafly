"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.responsive = void 0;
var _objectSpread2 = _interopRequireDefault(require("@babel/runtime/helpers/objectSpread2"));
/**
 * 固定的响应式断点映射（基于 antd 默认值）
 * 这些值是静态的，不依赖运行时 token
 */
var breakpoints = {
  xs: '@media (max-width: 479.98px)',
  sm: '@media (max-width: 575.98px)',
  md: '@media (max-width: 767.98px)',
  lg: '@media (max-width: 991.98px)',
  xl: '@media (max-width: 1199.98px)',
  xxl: '@media (min-width: 1200px)'
};

/**
 * 响应式断点映射，包含标准断点和设备别名
 */
var responsive = exports.responsive = (0, _objectSpread2.default)((0, _objectSpread2.default)({}, breakpoints), {}, {
  // 设备别名
  mobile: breakpoints.xs,
  tablet: breakpoints.md,
  laptop: breakpoints.lg,
  desktop: breakpoints.xxl
});