import urlJoin from 'url-join';
import { genEmojiUrl } from "./utils";
var ALIYUN_ICON_CDN = function ALIYUN_ICON_CDN(_ref) {
  var pkg = _ref.pkg,
    path = _ref.path;
  return urlJoin('https://registry.npmmirror.com', pkg, 'latest/files', path);
};
var UNPKG_ICON_CDN = function UNPKG_ICON_CDN(_ref2) {
  var pkg = _ref2.pkg,
    path = _ref2.path;
  return urlJoin('https://unpkg.com', "".concat(pkg, "@latest"), path);
};
export var getFluentEmojiCDN = function getFluentEmojiCDN(id, config) {
  var _ref3 = config || {},
    _ref3$type = _ref3.type,
    type = _ref3$type === void 0 ? '3d' : _ref3$type,
    _ref3$cdn = _ref3.cdn,
    cdn = _ref3$cdn === void 0 ? 'aliyun' : _ref3$cdn;
  var emoji = genEmojiUrl(id, type);
  return cdn === 'unpkg' ? UNPKG_ICON_CDN(emoji) : ALIYUN_ICON_CDN(emoji);
};