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
      d: "M.193 19.503a2.413 2.413 0 00-.186.925c0 1.317 1.112 2.518 2.95 3.437a1.337 1.337 0 001.838-.738l2.049-4.93c.359-.857.642-1.745.846-2.652-3.795.637-6.656 2.092-7.448 3.872l-.032.076-.017.01zm7.49-11.047a15.981 15.981 0 00-.846-2.653L4.79.873a1.34 1.34 0 00-1.84-.738C1.112 1.054 0 2.256 0 3.573c0 .317.064.631.186.924v.01l.032.077c.81 1.78 3.67 3.234 7.466 3.872zM21.049.136c1.838.918 2.95 2.12 2.95 3.436a2.454 2.454 0 01-.196.925l-.027.063c-.785 1.792-3.653 3.254-7.46 3.896.204-.907.487-1.795.846-2.653L19.21.873a1.337 1.337 0 011.839-.738zm-4.722 15.409c.201.906.48 1.793.837 2.65l2.048 4.932a1.338 1.338 0 001.838.738c1.839-.92 2.951-2.12 2.951-3.437a2.446 2.446 0 00-.186-.925l-.027-.062c-.782-1.792-3.66-3.256-7.46-3.896zm-.129-6.04c2.695-.415 4.935-1.223 6.48-2.278L22.24 8.28a9.755 9.755 0 000 7.437l.435 1.048c-1.547-1.055-3.787-1.855-6.479-2.275l-.07-.01A27.196 27.196 0 0012 14.172c-1.377-.002-2.752.1-4.114.307l-.071.01c-2.693.413-4.933 1.222-6.48 2.277l.437-1.05a9.755 9.755 0 000-7.437l-.437-1.052c1.54 1.06 3.78 1.863 6.473 2.278l.071.01c2.734.407 5.513.407 8.246 0l.071-.01z"
    })]
  }));
});
export default Icon;