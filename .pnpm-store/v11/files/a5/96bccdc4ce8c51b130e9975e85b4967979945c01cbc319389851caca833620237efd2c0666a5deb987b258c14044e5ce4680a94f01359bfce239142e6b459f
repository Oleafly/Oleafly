'use client';

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var _excluded = ["type"];
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : String(i); }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }
function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }
import { memo, useMemo } from 'react';
import IconAvatar from "../../features/IconAvatar";
import { AVATAR_BACKGROUND, AVATAR_COLOR, AVATAR_ICON_MULTIPLE, COLOR_GPT_3, COLOR_GPT_4, COLOR_GPT_5, COLOR_OSS, COLOR_O_1, COLOR_PLATFORM, TITLE } from "../style";
import Mono from "./Mono";
import { jsx as _jsx } from "react/jsx-runtime";
var Avatar = /*#__PURE__*/memo(function (_ref) {
  var _ref$type = _ref.type,
    type = _ref$type === void 0 ? 'normal' : _ref$type,
    rest = _objectWithoutProperties(_ref, _excluded);
  var background = useMemo(function () {
    switch (type) {
      case 'gpt3':
        {
          return COLOR_GPT_3;
        }
      case 'gpt4':
        {
          return COLOR_GPT_4;
        }
      case 'gpt5':
        {
          return COLOR_GPT_5;
        }
      case 'o3':
      case 'o1':
        {
          return COLOR_O_1;
        }
      case 'oss':
        {
          return COLOR_OSS;
        }
      case 'platform':
        {
          return COLOR_PLATFORM;
        }
      default:
        {
          return AVATAR_BACKGROUND;
        }
    }
  }, [type]);
  return /*#__PURE__*/_jsx(IconAvatar, _objectSpread({
    Icon: Mono,
    "aria-label": TITLE,
    background: background,
    color: AVATAR_COLOR,
    iconMultiple: AVATAR_ICON_MULTIPLE
  }, rest));
});
export default Avatar;