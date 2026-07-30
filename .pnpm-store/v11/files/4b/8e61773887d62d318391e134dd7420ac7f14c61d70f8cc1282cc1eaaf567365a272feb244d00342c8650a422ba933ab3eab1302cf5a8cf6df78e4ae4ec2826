'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = recurseRandomWord;

var _config = require('./config');

var _config2 = _interopRequireDefault(_config);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function recurseRandomWord(node, prefix) {
  var word = prefix;
  var branches = Object.keys(node);
  var branch = branches[Math.floor(Math.random() * branches.length)];

  if (branch === _config2.default.END_WORD) {
    return word;
  }
  return recurseRandomWord(node[branch], prefix + branch);
};
module.exports = exports['default'];