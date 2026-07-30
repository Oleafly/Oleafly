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
    viewBox: "0 0 65 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M46.938 21.563h-2.514V2h2.514l6.803 11.912h.11L60.654 2h2.513v19.563h-2.513V9.95l.11-3.279h-.11l-6.12 10.738h-1.476l-6.12-10.738h-.11l.11 3.279v11.612zM41.8 21.563H30.817V2h2.513v17.158h8.47v2.405zM18.282 17.465c0 .655.273 1.202.82 1.639.564.437 1.22.656 1.967.656 1.056 0 1.994-.392 2.814-1.175.838-.784 1.257-1.703 1.257-2.76-.783-.62-1.876-.929-3.279-.929-1.02 0-1.876.246-2.568.738-.674.492-1.011 1.102-1.011 1.83zm3.251-9.727c1.858 0 3.325.5 4.4 1.502 1.074.984 1.611 2.341 1.611 4.072v8.25H25.14v-1.857h-.11C23.993 21.235 22.609 22 20.879 22c-1.476 0-2.715-.437-3.716-1.311-.984-.875-1.476-1.968-1.476-3.28 0-1.383.52-2.485 1.558-3.305 1.056-.82 2.459-1.23 4.207-1.23 1.494 0 2.723.274 3.689.82v-.574c0-.874-.346-1.612-1.038-2.213a3.531 3.531 0 00-2.432-.929c-1.403 0-2.514.592-3.333 1.776l-2.213-1.393c1.22-1.749 3.023-2.623 5.41-2.623zM4.514 13.64v7.923H2V2h6.667c1.694 0 3.133.565 4.317 1.694 1.202 1.13 1.803 2.505 1.803 4.126 0 1.657-.601 3.041-1.803 4.153-1.166 1.11-2.605 1.666-4.317 1.666H4.514zm0-9.236v6.831H8.72c1.002 0 1.83-.337 2.487-1.011.674-.674 1.01-1.475 1.01-2.404 0-.911-.336-1.703-1.01-2.377-.656-.693-1.485-1.039-2.487-1.039H4.514z"
    })]
  }));
});
export default Icon;