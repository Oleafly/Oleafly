"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.genNoMotionStyle = exports.genNoMotionRawStyle = void 0;
const genNoMotionStyle = () => {
  return {
    '@media (prefers-reduced-motion: reduce)': {
      '&, &::before, &::after': {
        transition: 'none',
        animation: 'none'
      }
    }
  };
};
/**
 * For call sites already nested inside a pseudo-element selector.
 */
exports.genNoMotionStyle = genNoMotionStyle;
const genNoMotionRawStyle = () => {
  return {
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
      animation: 'none'
    }
  };
};
exports.genNoMotionRawStyle = genNoMotionRawStyle;