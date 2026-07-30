"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.valueArrayToPercentages = valueArrayToPercentages;
var _clamp = require("../../internals/clamp");
var _valueToPercent = require("../../utils/valueToPercent");
function valueArrayToPercentages(values, min, max) {
  const output = [];
  for (let i = 0; i < values.length; i += 1) {
    output.push((0, _clamp.clamp)((0, _valueToPercent.valueToPercent)(values[i], min, max), 0, 100));
  }
  return output;
}