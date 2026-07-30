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
    fill: "currentColor",
    fillRule: "evenodd",
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
      clipRule: "evenodd",
      d: "M24 12c0 6.627-5.373 12-12 12S0 18.627 0 12 5.373 0 12 0s12 5.373 12 12zM11.864 5.913c-.322 1.01-.53 1.836-.623 2.48-.072.472-.072 1.072 0 1.8.072.731.072 1.336 0 1.814a2.79 2.79 0 01-.961 1.744 2.795 2.795 0 01-1.89.708 2.78 2.78 0 01-2.034-.84 2.792 2.792 0 01-.848-2.024c-.003-.7-.075-1.472-.216-2.316-.068-.422-.139-.775-.21-1.06l-.094-.384-.17.356a7.862 7.862 0 00-.758 3.244v.16a7.84 7.84 0 00.623 3.089 7.952 7.952 0 004.228 4.228 7.84 7.84 0 003.09.623 7.841 7.841 0 003.088-.623 7.952 7.952 0 004.228-4.228 7.84 7.84 0 00.624-3.09v-.159a7.862 7.862 0 00-.76-3.244l-.168-.356-.094.385c-.072.284-.142.637-.211 1.059-.14.844-.212 1.616-.216 2.316a2.793 2.793 0 01-.848 2.024 2.78 2.78 0 01-2.034.84 2.795 2.795 0 01-1.89-.708 2.79 2.79 0 01-.96-1.744c-.072-.478-.072-1.083 0-1.814.071-.728.071-1.328 0-1.8-.094-.644-.302-1.47-.624-2.48L12 5.496l-.136.417zm3.22 11.396a6.387 6.387 0 01-3.084.778 6.387 6.387 0 01-3.084-.778 6.38 6.38 0 01-1.771-1.399c-.063-.07.01-.178.102-.153.369.1.75.15 1.144.15.781 0 1.508-.197 2.18-.59a4.253 4.253 0 001.349-1.233.099.099 0 01.16 0c.357.505.807.916 1.35 1.232.672.394 1.398.591 2.18.591.393 0 .775-.05 1.144-.15.09-.025.164.083.102.153a6.379 6.379 0 01-1.771 1.399z"
    })]
  }));
});
export default Icon;