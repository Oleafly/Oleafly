"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getSliderValue = getSliderValue;
var _clamp = require("../../internals/clamp");
var _replaceArrayItemAtIndex = require("./replaceArrayItemAtIndex");
function getSliderValue(valueInput, index, min, max, range, values) {
  let newValue = valueInput;
  newValue = (0, _clamp.clamp)(newValue, min, max);
  if (range) {
    newValue = (0, _replaceArrayItemAtIndex.replaceArrayItemAtIndex)(values, index,
    // Bound the new value to the thumb's neighbours.
    (0, _clamp.clamp)(newValue, values[index - 1] ?? -Infinity, values[index + 1] ?? Infinity));
  }
  return newValue;
}