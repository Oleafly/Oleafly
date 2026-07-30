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
    viewBox: "0 0 74 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M63.235 18.933V11.6c0-1.711-.088-2.8-.955-4.045h4.69v3.09C67.723 8.51 69.057 7.4 70.545 7.4c.223 0 .511.022.711.089l.467 4.11h-.133c-.466-.266-1.133-.444-1.845-.444-1.755 0-2.866 1.178-2.866 3.778 0 1.467.334 2.978 1.067 4h-4.712zM61.446 16.823c-.845 1.244-2.622 2.31-4.978 2.31-3.533 0-5.822-2.088-5.822-5.733 0-3.6 2.556-6.044 5.822-6.044 3.11 0 5.022 1.933 5.022 4.711 0 .533.044.911.2 1.289h-7.177c.178 2.044 1.266 3.378 3.488 3.378 1.311 0 2.334-.4 3.445-1.223v1.312zm-5.044-7.667c-.956 0-1.756.822-1.912 2.8h3.778c-.022-1.867-.578-2.8-1.866-2.8zM36.641 7.556h4.69v1.933c.666-1.2 1.91-2.133 3.71-2.133 2.534 0 4.444 2.044 4.444 5.378 0 3.555-2.444 6.4-6.31 6.4a7.41 7.41 0 01-1.845-.245v1.422c0 1.534.2 2.667 1.022 3.689h-4.71V11.267c0-1.578-.2-2.689-1-3.711zm4.556 6.289c0 2.11.622 3.755 2.177 3.755 1.356 0 2.178-1.578 2.178-3.91 0-2.623-.689-4.045-2.133-4.045-1 0-2.222 1.044-2.222 4.2zM33.124 5.889c-.977 0-2.222-.956-2.222-1.911C30.902 3 32.147 2 33.124 2c.956 0 2.244 1 2.244 1.978 0 .955-1.31 1.91-2.244 1.91zm-2.822 1.666h4.69v7.711c0 1.423.199 2.69 1.021 3.667h-4.71v-7.666c0-1.578-.2-2.69-1-3.712zM19.32 11.378V9.823c.844-1.334 2.622-2.467 4.755-2.467 3.289 0 4.8 1.778 4.8 4.6v3.31c0 1.557.244 2.69 1.022 3.667h-4.689V17.2c-.622.956-1.8 1.911-3.644 1.911-1.956 0-3.155-1.066-3.155-2.8 0-1.666 1.11-2.666 3.644-3.288 2.422-.623 3.155-.778 3.155-1.845 0-.911-.822-1.289-2.066-1.289-1.445 0-2.845.645-3.756 1.49h-.066zm2.71 4.489c0 .689.4 1.311 1.267 1.311.978 0 1.911-.867 1.911-2.622V13.51l-1.733.623c-.844.377-1.444.844-1.444 1.733zM1 2.822h5.244v7.067h6.178v-3.49c0-1.51-.222-2.577-1.022-3.577h5.222v12.533c0 1.511.222 2.622 1.022 3.578h-5.222v-6.845H6.244v3.267c0 1.511.223 2.622 1.023 3.578H2.044V6.4c0-1.511-.222-2.578-1.044-3.578z"
    })]
  }));
});
export default Icon;