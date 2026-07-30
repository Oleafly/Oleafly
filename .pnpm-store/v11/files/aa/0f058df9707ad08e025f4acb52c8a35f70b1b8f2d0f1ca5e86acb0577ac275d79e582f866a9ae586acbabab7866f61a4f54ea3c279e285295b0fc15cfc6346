"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useMergedValue;
var _util = require("@rc-component/util");
function useMergedValue(defaultValue, controlledValue) {
  const [value, setValue] = (0, _util.useControlledState)(defaultValue, controlledValue);
  const formatValue = value === undefined || value === null ? '' : String(value);
  return {
    value,
    setValue,
    formatValue
  };
}