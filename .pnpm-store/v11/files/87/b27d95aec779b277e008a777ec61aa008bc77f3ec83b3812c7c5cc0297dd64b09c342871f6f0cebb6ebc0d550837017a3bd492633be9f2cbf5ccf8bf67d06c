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
    viewBox: "0 0 99 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("g", {
      clipPath: "url(#a)",
      clipRule: "evenodd",
      children: /*#__PURE__*/_jsx("path", {
        d: "M2 7.158h1.43V2.213h1.968v4.945h2.25v1.734h-2.25v9.28H3.43v-9.28H2V7.158zM13.083 6.876c3.14 0 5.717 2.6 5.717 5.788s-2.577 5.788-5.717 5.788c-3.14 0-5.717-2.601-5.717-5.788 0-3.186 2.577-5.788 5.717-5.788zm0 9.748c2.132 0 3.796-1.687 3.796-3.96 0-2.273-1.664-3.96-3.796-3.96-2.132 0-3.797 1.687-3.797 3.96 0 2.273 1.665 3.96 3.797 3.96zM25.238 24c-2.718 0-5.365-1.898-5.365-4.991h1.921c.164 2.085 1.64 3.186 3.446 3.186 2.085 0 3.678-1.452 3.678-3.89v-2.033c-.75 1.359-2.39 2.18-3.866 2.18-3.14 0-5.53-2.578-5.53-5.789 0-3.21 2.39-5.788 5.53-5.788 1.476 0 3.117.82 3.866 2.18V7.156h1.969v11.148c0 3.304-2.53 5.694-5.647 5.694l-.002.001zm.024-7.375c2.133 0 3.797-1.688 3.797-3.96 0-2.274-1.664-3.961-3.797-3.961-2.132 0-3.796 1.687-3.796 3.96 0 2.273 1.664 3.96 3.796 3.96zM41.521 14.351l1.593.89c-1.1 2.063-2.975 3.211-5.132 3.211-3.092 0-5.623-2.601-5.623-5.788 0-3.186 2.53-5.788 5.623-5.788 3.093 0 5.366 2.25 5.366 6.186h-9.091c.187 2.11 1.805 3.562 3.725 3.562 1.92 0 2.766-.82 3.538-2.273h.001zm-7.148-2.858h6.89c-.235-1.57-1.406-2.835-3.28-2.835-1.735 0-3.141 1.148-3.61 2.835zM43.56 7.158h1.43V2.213h1.97v4.945h2.248v1.734H46.96v9.28H44.99v-9.28h-1.43V7.158zM54.827 8.634c-1.734 0-2.952 1.336-2.952 3.515v6.023h-1.968V2.213h1.968V8.87c.75-1.195 1.969-1.991 3.609-1.991 2.53 0 3.89 1.805 3.89 3.937v7.357h-1.968v-6.865c0-1.687-.96-2.671-2.578-2.671v-.002zM69.945 14.351l1.593.89c-1.101 2.063-2.976 3.211-5.132 3.211-3.093 0-5.624-2.601-5.624-5.788 0-3.186 2.531-5.788 5.624-5.788 3.092 0 5.365 2.25 5.365 6.186H62.68c.188 2.11 1.805 3.562 3.726 3.562 1.92 0 2.765-.82 3.537-2.273h.002zm-7.148-2.858h6.889c-.235-1.57-1.406-2.835-3.28-2.835-1.734 0-3.141 1.148-3.61 2.835zM79.239 9.312c-.376-.328-.938-.492-1.5-.492-1.64 0-2.577 1.43-2.577 3.351v6h-1.969V7.156h1.969v1.875c.539-1.195 1.617-2.11 3.047-2.11.702 0 1.335.235 1.734.54l-.703 1.85h-.001zM93.094 7.158V18.17h-1.969v-1.898c-.75 1.359-2.39 2.18-3.866 2.18-3.141 0-5.53-2.578-5.53-5.789 0-3.21 2.39-5.788 5.53-5.788 1.476 0 3.116.82 3.866 2.18V7.157h1.969zm-5.625 9.466c2.133 0 3.797-1.687 3.797-3.96 0-2.273-1.664-3.96-3.797-3.96-2.132 0-3.796 1.687-3.796 3.96 0 2.273 1.664 3.96 3.796 3.96zM97.289 7.157V18.17H95.32V7.157h1.969zM94.993 3.313c0-.703.609-1.313 1.311-1.313.703 0 1.312.61 1.312 1.313s-.586 1.312-1.312 1.312a1.31 1.31 0 01-1.311-1.312zM78.059 17c0-.703.609-1.313 1.311-1.313.703 0 1.312.61 1.312 1.312 0 .703-.586 1.312-1.312 1.312a1.31 1.31 0 01-1.311-1.312z"
      })
    }), /*#__PURE__*/_jsx("defs", {
      children: /*#__PURE__*/_jsx("clipPath", {
        id: "a",
        children: /*#__PURE__*/_jsx("path", {
          d: "M0 0h99v24H0z"
        })
      })
    })]
  }));
});
export default Icon;