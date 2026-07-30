"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _util = require("@rc-component/util");
var _is = require("../../_util/is");
const useChildren = children => {
  if ((0, _is.isFunction)(children)) {
    return children;
  }
  const childList = (0, _util.toArray)(children);
  return childList.length <= 1 ? childList[0] : childList;
};
var _default = exports.default = useChildren;