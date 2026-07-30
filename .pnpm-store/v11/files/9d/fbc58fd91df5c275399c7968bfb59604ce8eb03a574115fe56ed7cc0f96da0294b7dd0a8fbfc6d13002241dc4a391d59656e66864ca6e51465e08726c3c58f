"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = fallbackProp;
/**
 * Search for the first non-undefined value in the arguments and return it.
 *
 * ```js
 * const mergedIcon = fallbackProp(propIcon, contextIcon, defaultIcon);
 * ```
 *
 * Note: it is different from `??` operator which skips null
 */
function fallbackProp(...args) {
  return args.find(arg => arg !== undefined);
}