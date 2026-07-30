'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.default = function (input) {
  if (!Array.isArray(input)) {
    throw 'Expected parameter Array, received ' + (typeof input === 'undefined' ? 'undefined' : _typeof(input));
  }

  var trie = (0, _create2.default)([].concat(_toConsumableArray(input)));

  return {
    /**
     * Get the generated raw trie object
    */
    tree: function tree() {
      return trie;
    },


    /**
     * Get a string representation of the trie
    */
    dump: function dump() {
      var spacer = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;

      return _utils2.default.stringify(trie, spacer);
    },


    /**
     * Add a new word to the trie
     */
    addWord: function addWord(word) {
      if (typeof word !== 'string' || word === '') {
        throw 'Expected parameter string, received ' + (typeof word === 'undefined' ? 'undefined' : _typeof(word));
      }

      var reducer = function reducer() {
        return _append2.default.apply(undefined, arguments);
      };

      var input = word.toLowerCase().split('');
      input.reduce(reducer, trie);

      return this;
    },


    /**
     * Remove an existing word from the trie
     */
    removeWord: function removeWord(word) {
      if (typeof word !== 'string' || word === '') {
        throw 'Expected parameter string, received ' + (typeof word === 'undefined' ? 'undefined' : _typeof(word));
      }

      var _checkPrefix = (0, _checkPrefix6.default)(trie, word),
          prefixFound = _checkPrefix.prefixFound,
          prefixNode = _checkPrefix.prefixNode;

      if (prefixFound) {
        delete prefixNode[_config2.default.END_WORD];
      }

      return this;
    },


    /**
     * Check a prefix is valid
     * @returns Boolean
    */
    isPrefix: function isPrefix(prefix) {
      if (typeof prefix !== 'string') {
        throw 'Expected string prefix, received ' + (typeof prefix === 'undefined' ? 'undefined' : _typeof(prefix));
      }

      var _checkPrefix2 = (0, _checkPrefix6.default)(trie, prefix),
          prefixFound = _checkPrefix2.prefixFound;

      return prefixFound;
    },


    /**
    * Get a list of all words in the trie with the given prefix
    * @returns Array
    */
    getPrefix: function getPrefix(strPrefix) {
      var sorted = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;

      if (typeof strPrefix !== 'string') {
        throw 'Expected string prefix, received ' + (typeof strPrefix === 'undefined' ? 'undefined' : _typeof(strPrefix));
      }

      if (typeof sorted !== 'boolean') {
        throw 'Expected sort parameter as boolean, received ' + (typeof sorted === 'undefined' ? 'undefined' : _typeof(sorted));
      }

      if (!this.isPrefix(strPrefix)) {
        return [];
      }

      var prefixNode = strPrefix.length ? (0, _checkPrefix6.default)(trie, strPrefix).prefixNode : trie;

      return (0, _recursePrefix2.default)(prefixNode, strPrefix, sorted);
    },


    /**
    * Get a random word in the trie with the given prefix
    * @returns Array
    */
    getRandomWordWithPrefix: function getRandomWordWithPrefix(strPrefix) {
      if (typeof strPrefix !== 'string') {
        throw 'Expected string prefix, received ' + (typeof strPrefix === 'undefined' ? 'undefined' : _typeof(strPrefix));
      }

      if (!this.isPrefix(strPrefix)) {
        return '';
      }

      var _checkPrefix3 = (0, _checkPrefix6.default)(trie, strPrefix),
          prefixNode = _checkPrefix3.prefixNode;

      return (0, _recurseRandomWord2.default)(prefixNode, strPrefix);
    },


    /**
    * Count the number of words with the given prefixSearch
    * @returns Number
    */
    countPrefix: function countPrefix(strPrefix) {
      var prefixes = this.getPrefix(strPrefix);

      return prefixes.length;
    },


    /**
    * Get all words in the trie
    * @returns Array
    */
    getWords: function getWords() {
      var sorted = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : true;

      return this.getPrefix('', sorted);
    },


    /**
    * Check the existence of a word in the trie
    * @returns Boolean
    */
    hasWord: function hasWord(word) {
      if (typeof word !== 'string') {
        throw 'Expected string word, received ' + (typeof word === 'undefined' ? 'undefined' : _typeof(word));
      }

      var _checkPrefix4 = (0, _checkPrefix6.default)(trie, word),
          prefixFound = _checkPrefix4.prefixFound,
          prefixNode = _checkPrefix4.prefixNode;

      if (prefixFound) {
        return prefixNode[_config2.default.END_WORD] === 1;
      }

      return false;
    },


    /**
    * Get a list of valid anagrams that can be made from the given letters
    * @returns Array
    */
    getAnagrams: function getAnagrams(letters) {
      if (typeof letters !== 'string') {
        throw 'Anagrams expected string letters, received ' + (typeof letters === 'undefined' ? 'undefined' : _typeof(letters));
      }

      if (letters.length < PERMS_MIN_LEN) {
        throw 'getAnagrams expects at least ' + PERMS_MIN_LEN + ' letters';
      }

      return (0, _permutations2.default)(letters, trie, {
        type: 'anagram'
      });
    },


    /**
    * Get a list of all sub-anagrams that can be made from the given letters
    * @returns Array
    */
    getSubAnagrams: function getSubAnagrams(letters) {
      if (typeof letters !== 'string') {
        throw 'Expected string letters, received ' + (typeof letters === 'undefined' ? 'undefined' : _typeof(letters));
      }

      if (letters.length < PERMS_MIN_LEN) {
        throw 'getSubAnagrams expects at least ' + PERMS_MIN_LEN + ' letters';
      }

      return (0, _permutations2.default)(letters, trie, {
        type: 'sub-anagram'
      });
    }
  };
};

var _create = require('./create');

var _create2 = _interopRequireDefault(_create);

var _append = require('./append');

var _append2 = _interopRequireDefault(_append);

var _checkPrefix5 = require('./checkPrefix');

var _checkPrefix6 = _interopRequireDefault(_checkPrefix5);

var _recursePrefix = require('./recursePrefix');

var _recursePrefix2 = _interopRequireDefault(_recursePrefix);

var _recurseRandomWord = require('./recurseRandomWord');

var _recurseRandomWord2 = _interopRequireDefault(_recurseRandomWord);

var _utils = require('./utils');

var _utils2 = _interopRequireDefault(_utils);

var _config = require('./config');

var _config2 = _interopRequireDefault(_config);

var _permutations = require('./permutations');

var _permutations2 = _interopRequireDefault(_permutations);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

var PERMS_MIN_LEN = _config2.default.PERMS_MIN_LEN;

;
module.exports = exports['default'];