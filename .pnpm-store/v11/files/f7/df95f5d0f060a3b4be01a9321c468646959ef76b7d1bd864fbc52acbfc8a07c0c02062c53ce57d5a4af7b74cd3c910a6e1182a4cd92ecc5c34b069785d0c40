"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getTwoToneColor = getTwoToneColor;
exports.setTwoToneColor = setTwoToneColor;
var _IconBaseTwoTone = _interopRequireDefault(require("./IconBaseTwoTone"));
var _utils = require("../utils");
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function setTwoToneColor(twoToneColor) {
  const [primaryColor, secondaryColor] = (0, _utils.normalizeTwoToneColors)(twoToneColor);
  return _IconBaseTwoTone.default.setTwoToneColors({
    primaryColor,
    secondaryColor
  });
}
function getTwoToneColor() {
  const colors = _IconBaseTwoTone.default.getTwoToneColors();
  if (!colors.calculated) {
    return colors.primaryColor;
  }
  return [colors.primaryColor, colors.secondaryColor];
}