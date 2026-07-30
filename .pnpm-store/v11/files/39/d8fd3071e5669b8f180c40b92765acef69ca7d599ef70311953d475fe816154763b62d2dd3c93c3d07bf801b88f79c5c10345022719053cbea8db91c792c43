'use client';

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var _excluded = ["size", "style"];
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : String(i); }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }
function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }
import { memo } from 'react';
import { TITLE } from "../style";
import { jsx as _jsx } from "react/jsx-runtime";
import { jsxs as _jsxs } from "react/jsx-runtime";
var Icon = /*#__PURE__*/memo(function (_ref) {
  var _ref$size = _ref.size,
    size = _ref$size === void 0 ? '1em' : _ref$size,
    style = _ref.style,
    rest = _objectWithoutProperties(_ref, _excluded);
  return /*#__PURE__*/_jsxs("svg", _objectSpread(_objectSpread({
    height: size,
    style: _objectSpread({
      flex: 'none',
      lineHeight: 1
    }, style),
    viewBox: "0 0 24 24",
    width: size,
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M15.763 1.02c.212-.021.44.002.654.004l1.21.001c1.68.001 3.373.043 5.052-.025l-.001 8.93v2.652c0 .744.013 1.486-.065 2.227a9.643 9.643 0 01-.585 2.453 8.895 8.895 0 01-3.215 4.14c-.289.201-.602.422-.925.564a10.01 10.01 0 01-2.582.976c-.361.083-.728.131-1.088.216-.381-.311-.725-.694-1.072-1.043l-1.893-1.893c-.722-.716-1.455-1.417-2.171-2.14-.303-.304-.639-.604-.907-.938.106.694.047 1.75.047 2.486.007 1.457.003 2.913-.013 4.37a.906.906 0 01-.046-.035c-.236-.185-.447-.428-.66-.642-.41-.415-.823-.827-1.239-1.237l-2.991-2.979c-.54-.54-1.098-1.07-1.624-1.623-.07-.074-.215-.21-.228-.311a.348.348 0 01.129.001l-.005-.012c.869-.05 1.76-.013 2.63-.013 1.332 0 2.665-.018 3.996.001a597.835 597.835 0 01-6.839-6.807c-.047-.357-.02-.74-.02-1.101l.001-1.915L1.3 1.178c0-.04.01-.075.028-.112.059-.04.104-.038.175-.042.52-.03 1.06 0 1.582.001 1.512 0 3.036.042 4.546-.006.197-.014.397-.011.594-.015l-.003 10.581c.009 1.859.003 3.717-.018 5.575.426-.044.89-.01 1.32-.01h2.772c.964-.007 1.857-.19 2.558-.904.538-.548.764-1.256.88-2 .08-.51.042-1.08.041-1.597l-.002-2.645c-.001-2.994.026-5.99-.01-8.984z",
      fill: "#E30A5D"
    })]
  }));
});
export default Icon;