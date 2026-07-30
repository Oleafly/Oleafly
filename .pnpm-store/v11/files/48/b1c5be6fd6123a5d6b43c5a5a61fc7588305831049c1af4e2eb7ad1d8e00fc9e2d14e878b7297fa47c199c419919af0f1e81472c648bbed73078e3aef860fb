'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.default = permutations;

var _config = require('./config');

var _config2 = _interopRequireDefault(_config);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function permutations(letters, trie) {
  var opts = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {
    type: 'anagram'
  };

  if (typeof letters !== 'string') {
    throw 'Permutations expects string letters, received ' + (typeof letters === 'undefined' ? 'undefined' : _typeof(letters));
  }

  var words = [];

  var permute = function permute(word, node) {
    var prefix = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : '';

    var wordIsEmpty = word.length === 0;
    var wordFound = words.indexOf(prefix) !== -1;
    var endWordFound = node[_config2.default.END_WORD] === 1;

    if (wordIsEmpty && endWordFound && !wordFound) {
      words.push(prefix);
    }

    for (var i = 0, len = word.length; i < len; i++) {
      var letter = word[i];

      if (opts.type === 'sub-anagram') {
        if (endWordFound && !(words.indexOf(prefix) !== -1)) {
          words.push(prefix);
        }
      }

      if (node[letter]) {
        var remaining = word.substring(0, i) + word.substring(i + 1, len);
        permute(remaining, node[letter], prefix + letter, words);
      }
    }

    return words.sort();
  };

  return permute(letters, trie);
};
module.exports = exports['default'];