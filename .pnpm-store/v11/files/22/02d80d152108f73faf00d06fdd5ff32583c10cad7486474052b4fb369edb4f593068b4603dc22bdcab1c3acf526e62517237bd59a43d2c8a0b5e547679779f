"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _rule = _interopRequireDefault(require("../rule"));
const required = (rule, value, callback, source, options) => {
  const errors = [];
  const type = Array.isArray(value) ? 'array' : typeof value;
  _rule.default.required(rule, value, source, errors, options, type);
  callback(errors);
};
var _default = exports.default = required;