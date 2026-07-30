"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _is = require("./is");
const toList = (val, config = {}) => {
  if (!(0, _is.isNonNullable)(val) && config?.skipEmpty) {
    return [];
  }
  return Array.isArray(val) ? val : [val];
};
var _default = exports.default = toList;