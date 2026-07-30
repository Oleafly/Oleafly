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
    fillRule: "nonzero",
    height: size,
    style: _objectSpread({
      flex: 'none',
      lineHeight: 1
    }, style),
    viewBox: "0 0 70 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M61.486 19.526c-.905 0-1.718-.172-2.439-.515-.702-.344-1.266-.805-1.69-1.384-.408-.596-.61-1.283-.61-2.06 0-1.013.332-1.836.997-2.469.665-.633 1.617-1.067 2.855-1.301l3.244-.65c.646-.128 1.09-.326 1.33-.598.24-.27.36-.668.36-1.193l.332 3.173-4.656.977c-.628.126-1.118.351-1.469.677-.333.326-.499.778-.499 1.356 0 .597.231 1.076.693 1.438.48.36 1.127.541 1.94.542.666 0 1.276-.145 1.83-.434a3.248 3.248 0 001.83-2.983V9.356c0-.651-.241-1.157-.722-1.519-.462-.38-1.1-.57-1.912-.57-1.035 0-1.83.254-2.384.76-.554.507-.878 1.22-.97 2.142l-2.44-.325c.093-.958.389-1.78.888-2.467.499-.706 1.164-1.248 1.995-1.628.832-.38 1.82-.569 2.966-.569 1.626 0 2.873.407 3.742 1.22C67.566 7.213 68 8.262 68 9.546v9.572h-2.411v-1.762c-.24.596-.73 1.112-1.47 1.546-.72.416-1.598.624-2.633.624zm-24.392-.407V5.587h2.411v1.519c.185-.525.591-.977 1.22-1.357.628-.38 1.358-.569 2.189-.569.814 0 1.563.172 2.246.515.683.344 1.127.86 1.33 1.546.24-.633.684-1.13 1.331-1.492a4.39 4.39 0 012.217-.569c1.404 0 2.476.398 3.215 1.193.74.796 1.11 1.953 1.11 3.471v9.275h-2.468v-8.95c0-.903-.203-1.581-.61-2.033-.388-.47-.961-.705-1.718-.705-.832 0-1.479.289-1.94.867-.444.561-.666 1.384-.666 2.468v8.353h-2.466v-8.95c0-.903-.204-1.581-.61-2.033-.388-.47-.961-.705-1.719-.705-.832 0-1.478.289-1.94.867-.444.561-.666 1.384-.666 2.468v8.353h-2.466zM27.66 24c-1.719 0-3.114-.389-4.186-1.166-1.072-.777-1.755-1.862-2.051-3.254l2.412-.516c.203.886.637 1.573 1.303 2.062.665.506 1.505.759 2.522.759 1.219 0 2.134-.307 2.744-.922.628-.597.942-1.491.942-2.685v-2.142c-.277.668-.794 1.21-1.552 1.627-.74.416-1.57.624-2.494.624-1.22 0-2.292-.271-3.216-.814a5.802 5.802 0 01-2.162-2.332c-.517-.994-.776-2.143-.776-3.444 0-1.32.259-2.477.776-3.471.517-.995 1.229-1.763 2.134-2.305.924-.56 2.005-.841 3.244-.841.924 0 1.764.208 2.522.623.775.398 1.302.895 1.58 1.492V5.587h2.411v12.69c0 1.193-.24 2.215-.72 3.065-.48.868-1.183 1.528-2.107 1.98-.905.451-2.014.678-3.326.678zm-.056-7.756c1.183 0 2.125-.407 2.827-1.22.72-.814 1.081-1.89 1.082-3.228 0-1.355-.36-2.44-1.082-3.254-.72-.813-1.663-1.22-2.827-1.22-1.182 0-2.134.407-2.855 1.22-.702.814-1.053 1.899-1.053 3.254 0 1.338.36 2.414 1.08 3.228.722.813 1.665 1.22 2.828 1.22zM16.17 19.119V5.587h2.467v13.532h-2.467zM16.14 3.85V0h2.522v3.851h-2.522zM2 19.12V0h2.605v19.119H2zm.527-8.082V8.732h10.616v2.306H2.527zm0-8.705V0h11.641v2.332H2.527z"
    })]
  }));
});
export default Icon;