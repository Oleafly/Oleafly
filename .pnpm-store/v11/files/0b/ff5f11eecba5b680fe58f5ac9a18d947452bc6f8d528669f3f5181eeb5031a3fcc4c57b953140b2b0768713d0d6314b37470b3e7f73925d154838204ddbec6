"use strict";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _is = require("../../_util/is");
const useStackConfig = (stackConfig, defaultStackConfig) => React.useMemo(() => {
  const mergedStackConfig = stackConfig ?? defaultStackConfig;
  if (!mergedStackConfig) {
    return false;
  }
  return {
    ...((0, _is.isPlainObject)(defaultStackConfig) ? defaultStackConfig : {}),
    ...((0, _is.isPlainObject)(mergedStackConfig) ? mergedStackConfig : {})
  };
}, [stackConfig, defaultStackConfig]);
var _default = exports.default = useStackConfig;