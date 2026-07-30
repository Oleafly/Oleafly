"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useAllowClear = void 0;
var _react = _interopRequireWildcard(require("react"));
var _CloseCircleFilled = _interopRequireDefault(require("@ant-design/icons/CloseCircleFilled"));
var _fallbackProp = _interopRequireDefault(require("../fallbackProp"));
var _is = require("../is");
var _warning = require("../warning");
const useAllowClear = options => {
  const {
    allowClear,
    clearIcon,
    contextAllowClear,
    contextClearIcon,
    defaultAllowClear,
    componentName
  } = options;
  if (process.env.NODE_ENV !== 'production') {
    const warning = (0, _warning.devUseWarning)(componentName);
    warning.deprecated(!clearIcon, 'clearIcon', 'allowClear={{ clearIcon: React.ReactNode }}');
  }
  return (0, _react.useMemo)(() => {
    const mergedAllowClear = allowClear ?? contextAllowClear ?? defaultAllowClear;
    if (!mergedAllowClear) {
      return false;
    }
    return {
      clearIcon: (0, _fallbackProp.default)((0, _is.isPlainObject)(allowClear) ? allowClear?.clearIcon : clearIcon, (0, _is.isPlainObject)(contextAllowClear) ? contextAllowClear?.clearIcon : contextClearIcon, /*#__PURE__*/_react.default.createElement(_CloseCircleFilled.default, null)),
      disabled: ((0, _is.isPlainObject)(allowClear) ? allowClear?.disabled : undefined) ?? ((0, _is.isPlainObject)(contextAllowClear) ? contextAllowClear?.disabled : undefined)
    };
  }, [allowClear, clearIcon, contextAllowClear, contextClearIcon, defaultAllowClear]);
};
exports.useAllowClear = useAllowClear;