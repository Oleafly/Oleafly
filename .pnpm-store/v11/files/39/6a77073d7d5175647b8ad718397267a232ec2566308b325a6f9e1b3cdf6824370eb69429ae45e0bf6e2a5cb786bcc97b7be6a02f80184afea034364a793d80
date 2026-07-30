'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = {
  objectCopy: function objectCopy(obj) {
    if (typeof obj === 'undefined') {
      return {};
    }
    return JSON.parse(JSON.stringify(obj));
  },
  stringify: function stringify(obj) {
    var spacer = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 2;

    if (typeof obj === 'undefined') {
      return '';
    }
    return JSON.stringify(obj, null, spacer);
  }
};
module.exports = exports['default'];