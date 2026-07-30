"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.progressStateAttributesMapping = void 0;
var _ProgressRootDataAttributes = require("./ProgressRootDataAttributes");
const progressStateAttributesMapping = exports.progressStateAttributesMapping = {
  status(value) {
    if (value === 'progressing') {
      return {
        [_ProgressRootDataAttributes.ProgressRootDataAttributes.progressing]: ''
      };
    }
    if (value === 'complete') {
      return {
        [_ProgressRootDataAttributes.ProgressRootDataAttributes.complete]: ''
      };
    }
    if (value === 'indeterminate') {
      return {
        [_ProgressRootDataAttributes.ProgressRootDataAttributes.indeterminate]: ''
      };
    }
    return null;
  }
};