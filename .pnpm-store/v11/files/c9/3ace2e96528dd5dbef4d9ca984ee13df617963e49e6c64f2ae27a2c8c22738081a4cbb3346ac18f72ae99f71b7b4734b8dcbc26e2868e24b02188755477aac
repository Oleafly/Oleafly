'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = append;

var _config = require('./config');

var _config2 = _interopRequireDefault(_config);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function append(trie, letter, index, array) {
  var isEndWordLetter = letter === _config2.default.END_WORD;
  var isLastLetter = index === array.length - 1;

  if (isEndWordLetter && !isLastLetter) {
    trie[_config2.default.END_WORD] = 1;
    trie[_config2.default.END_WORD_REPLACER] = {};
    trie = trie[_config2.default.END_WORD_REPLACER];
  } else {
    trie[letter] = trie[letter] || {};
    trie = trie[letter];
  }

  if (isLastLetter) {
    trie[_config2.default.END_WORD] = 1;
  }

  return trie;
}
module.exports = exports['default'];