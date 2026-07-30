"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = delayFrame;
var _useNotifyWatch = require("../hooks/useNotifyWatch");
var _util = require("@rc-component/util");
async function delayFrame() {
  return new Promise(resolve => {
    (0, _useNotifyWatch.macroTask)(() => {
      (0, _util.raf)(() => {
        resolve();
      });
    });
  });
}