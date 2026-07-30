'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = checkPrefix;

var _utils = require('./utils');

var _utils2 = _interopRequireDefault(_utils);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function checkPrefix(prefixNode, prefix) {
  var input = prefix.toLowerCase().split('');
  var prefixFound = input.every(function (letter, index) {
    if (!prefixNode[letter]) {
      return false;
    }
    return prefixNode = prefixNode[letter];
  });

  return {
    prefixFound: prefixFound,
    prefixNode: prefixNode
  };
};
module.exports = exports['default'];