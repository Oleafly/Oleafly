function _toConsumableArray(arr) { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _iterableToArray(iter) { if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter); }
function _arrayWithoutHoles(arr) { if (Array.isArray(arr)) return _arrayLikeToArray(arr); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
export function isFlagEmoji(emoji) {
  var flagRegex = /(?:\uD83C[\uDDE6-\uDDFF]){2}/;
  return flagRegex.test(emoji);
}
export function emojiToUnicode(emoji) {
  return _toConsumableArray(emoji).map(function (char) {
    var _char$codePointAt;
    return char === null || char === void 0 || (_char$codePointAt = char.codePointAt(0)) === null || _char$codePointAt === void 0 ? void 0 : _char$codePointAt.toString(16);
  }).join('-');
}
export function emojiAnimPkg(emoji) {
  var mainPart = emojiToUnicode(emoji).split('-')[0];
  if (mainPart < '1f469') {
    return '@lobehub/fluent-emoji-anim-1';
  } else if (mainPart >= '1f469' && mainPart < '1f620') {
    return '@lobehub/fluent-emoji-anim-2';
  } else if (mainPart >= '1f620' && mainPart < '1f9a0') {
    return '@lobehub/fluent-emoji-anim-3';
  } else {
    return '@lobehub/fluent-emoji-anim-4';
  }
}
export var genEmojiUrl = function genEmojiUrl(emoji, type) {
  var ext = ['anim', '3d'].includes(type) ? 'webp' : 'svg';
  switch (type) {
    case 'anim':
      {
        return {
          path: "assets/".concat(emojiToUnicode(emoji), ".").concat(ext),
          pkg: emojiAnimPkg(emoji)
        };
      }
    case '3d':
      {
        return {
          path: "assets/".concat(emojiToUnicode(emoji), ".").concat(ext),
          pkg: '@lobehub/fluent-emoji-3d'
        };
      }
    case 'flat':
      {
        return {
          path: "assets/".concat(emojiToUnicode(emoji), ".").concat(ext),
          pkg: '@lobehub/fluent-emoji-flat'
        };
      }
    case 'modern':
      {
        return {
          path: "assets/".concat(emojiToUnicode(emoji), ".").concat(ext),
          pkg: '@lobehub/fluent-emoji-modern'
        };
      }
    case 'mono':
      {
        return {
          path: "assets/".concat(emojiToUnicode(emoji), ".").concat(ext),
          pkg: '@lobehub/fluent-emoji-mono'
        };
      }
  }
};