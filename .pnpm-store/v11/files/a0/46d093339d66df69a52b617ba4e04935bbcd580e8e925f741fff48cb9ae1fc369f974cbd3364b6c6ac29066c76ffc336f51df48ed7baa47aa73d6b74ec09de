'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = recursePrefix;

var _config = require('./config');

var _config2 = _interopRequireDefault(_config);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// sort items as they're being found
// to prevent slow .sort() in NodeJs
var pushInOrder = function pushInOrder(word, prefixes) {
  var i = 0;

  while (i < prefixes.length) {
    if (word < prefixes[i]) {
      break;
    }
    i += 1;
  }

  prefixes.splice(i, 0, word);

  return prefixes;
};

function recursePrefix(node, prefix, sorted) {
  var prefixes = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : [];

  var word = prefix;

  for (var branch in node) {
    var currentLetter = branch;
    if (branch === _config2.default.END_WORD && typeof node[branch] === 'number') {
      if (sorted) {
        pushInOrder(word, prefixes);
      } else {
        prefixes.push(word);
      }
      word = '';
    } else if (branch === _config2.default.END_WORD_REPLACER) {
      currentLetter = _config2.default.END_WORD;
    }
    recursePrefix(node[branch], prefix + currentLetter, sorted, prefixes);
  }

  return prefixes;
}
module.exports = exports['default'];