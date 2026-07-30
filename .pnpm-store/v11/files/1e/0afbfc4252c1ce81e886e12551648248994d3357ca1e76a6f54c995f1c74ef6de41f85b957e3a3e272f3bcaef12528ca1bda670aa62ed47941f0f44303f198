"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createSelectorMemoized = void 0;
var _formatErrorMessage2 = _interopRequireDefault(require("../formatErrorMessage.js"));
var _reselect = require("reselect");
/* eslint-disable no-underscore-dangle */ // __cacheKey__

const reselectCreateSelector = (0, _reselect.createSelectorCreator)({
  memoize: _reselect.lruMemoize,
  memoizeOptions: {
    maxSize: 1,
    equalityCheck: Object.is
  }
});
const createSelectorMemoized = (...selectors) => {
  const cache = new WeakMap();
  let nextCacheId = 1;
  const combiner = selectors[selectors.length - 1];
  const nSelectors = selectors.length - 1 || 1;
  // (s1, s2, ..., sN, a1, a2, a3) => { ... }
  const argsLength = combiner.length - nSelectors;
  if (argsLength > 3) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Unsupported number of arguments' : (0, _formatErrorMessage2.default)(2));
  }
  const selector = (state, a1, a2, a3) => {
    let cacheKey = state.__cacheKey__;
    if (!cacheKey) {
      cacheKey = {
        id: nextCacheId
      };
      state.__cacheKey__ = cacheKey;
      nextCacheId += 1;
    }
    let fn = cache.get(cacheKey);
    if (!fn) {
      let reselectArgs = selectors;
      const selectorArgs = [undefined, undefined, undefined];
      switch (argsLength) {
        case 0:
          break;
        case 1:
          {
            reselectArgs = [...selectors.slice(0, -1), () => selectorArgs[0], combiner];
            break;
          }
        case 2:
          {
            reselectArgs = [...selectors.slice(0, -1), () => selectorArgs[0], () => selectorArgs[1], combiner];
            break;
          }
        case 3:
          {
            reselectArgs = [...selectors.slice(0, -1), () => selectorArgs[0], () => selectorArgs[1], () => selectorArgs[2], combiner];
            break;
          }
        default:
          throw new Error(process.env.NODE_ENV !== "production" ? 'Unsupported number of arguments' : (0, _formatErrorMessage2.default)(2));
      }
      fn = reselectCreateSelector(...reselectArgs);
      fn.selectorArgs = selectorArgs;
      cache.set(cacheKey, fn);
    }
    fn.selectorArgs[0] = a1;
    fn.selectorArgs[1] = a2;
    fn.selectorArgs[2] = a3;
    switch (argsLength) {
      case 0:
        return fn(state);
      case 1:
        return fn(state, a1);
      case 2:
        return fn(state, a1, a2);
      case 3:
        return fn(state, a1, a2, a3);
      default:
        throw /* minify-error-disabled */new Error('unreachable');
    }
  };
  return selector;
};
exports.createSelectorMemoized = createSelectorMemoized;