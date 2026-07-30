'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.default = create;

var _append = require('./append');

var _append2 = _interopRequireDefault(_append);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function create(input) {
  if (!Array.isArray(input)) {
    throw 'Expected parameter Array, received ' + (typeof input === 'undefined' ? 'undefined' : _typeof(input));
  }

  var trie = input.reduce(function (accumulator, item) {
    item.toLowerCase().split('').reduce(_append2.default, accumulator);

    return accumulator;
  }, {});

  return trie;
};
module.exports = exports['default'];