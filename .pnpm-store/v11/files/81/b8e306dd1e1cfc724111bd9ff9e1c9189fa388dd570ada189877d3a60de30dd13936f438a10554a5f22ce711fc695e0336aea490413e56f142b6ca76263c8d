"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
/**
 * Merges multiple props objects into one. Unlike `Object.assign()` or `{ ...a, ...b }`, it skips
 * properties whose value is explicitly set to `undefined`.
 */

function mergeProps(...items) {
  const ret = {};
  for (const item of items) {
    if (item) {
      for (const key of Object.keys(item)) {
        if (item[key] !== undefined) {
          ret[key] = item[key];
        }
      }
    }
  }
  return ret;
}
var _default = exports.default = mergeProps;