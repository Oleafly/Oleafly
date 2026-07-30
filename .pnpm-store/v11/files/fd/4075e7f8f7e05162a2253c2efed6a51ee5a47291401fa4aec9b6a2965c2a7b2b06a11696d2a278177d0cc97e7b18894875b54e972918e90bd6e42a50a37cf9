"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.legacyPropsWarning = legacyPropsWarning;
var _util = require("@rc-component/util");
function legacyPropsWarning(props) {
  const {
    picker,
    disabledHours,
    disabledMinutes,
    disabledSeconds
  } = props;
  if (picker === 'time' && (disabledHours || disabledMinutes || disabledSeconds)) {
    (0, _util.warning)(false, `'disabledHours', 'disabledMinutes', 'disabledSeconds' will be removed in the next major version, please use 'disabledTime' instead.`);
  }
}