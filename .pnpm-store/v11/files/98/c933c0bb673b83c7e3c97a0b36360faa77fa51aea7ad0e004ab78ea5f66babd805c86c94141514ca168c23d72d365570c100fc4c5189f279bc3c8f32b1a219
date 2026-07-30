"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.progressActive = exports.inkFlow3 = exports.inkFlow2 = exports.inkFlow1 = void 0;
var _cssinjs = require("@ant-design/cssinjs");
// Progress active animation - subtle shimmer effect (reverse direction)
const progressActive = exports.progressActive = new _cssinjs.Keyframes('antImageProgressActive', {
  '0%': {
    backgroundPosition: '200% 0'
  },
  '100%': {
    backgroundPosition: '-200% 0'
  }
});
// Create ink flow keyframes with custom transform and opacity values
const createInkFlow = (name, midTransform, midOpacity, startTransform = 'translate(0%, 0%)', startOpacity = 0.8) => new _cssinjs.Keyframes(name, {
  '0%': {
    transform: startTransform,
    opacity: startOpacity
  },
  '50%': {
    transform: midTransform,
    opacity: midOpacity
  },
  '100%': {
    transform: startTransform,
    opacity: startOpacity
  }
});
const inkFlow1 = exports.inkFlow1 = createInkFlow('antImageInkFlow1', 'translate(15%, -20%) scale(1.25)', 0.5);
const inkFlow2 = exports.inkFlow2 = createInkFlow('antImageInkFlow2', 'translate(-18%, 15%) scale(0.85)', 0.9, 'translate(0%, 0%) scale(1.1)', 0.7);
const inkFlow3 = exports.inkFlow3 = createInkFlow('antImageInkFlow3', 'translate(8%, 10%) scale(1.15)', 0.8, 'translate(0%, 0%) scale(0.85)', 0.65);