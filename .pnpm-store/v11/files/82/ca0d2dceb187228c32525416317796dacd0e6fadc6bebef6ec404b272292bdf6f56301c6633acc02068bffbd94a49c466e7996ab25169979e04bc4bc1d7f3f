"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getAsSolidColor = void 0;
var _fastColor = require("@ant-design/fast-color");
const getAsSolidColor = (color, background) => {
  if (color?.startsWith('var(') || background?.startsWith('var(')) {
    return color;
  }
  return new _fastColor.FastColor(color).onBackground(background).toHexString();
};
exports.getAsSolidColor = getAsSolidColor;