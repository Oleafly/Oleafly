"use strict";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _is = require("../../_util/is");
const useMergedConfig = (propConfig, templateConfig) => {
  const support = Boolean(propConfig);
  return React.useMemo(() => {
    const config = {
      ...templateConfig,
      ...(support && (0, _is.isPlainObject)(propConfig) ? propConfig : null)
    };
    return [support, config];
  }, [support, propConfig, templateConfig]);
};
var _default = exports.default = useMergedConfig;