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
    viewBox: "0 0 75 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M2.061 22.215l1.942-2.4c1.073.985 2.27 1.477 3.588 1.477.885 0 1.614-.131 2.187-.394.574-.262.86-.623.86-1.083 0-.78-.634-1.169-1.904-1.169-.344 0-.856.041-1.536.123-.68.082-1.192.123-1.536.123-2.114 0-3.17-.759-3.17-2.277 0-.434.176-.861.528-1.28a3.246 3.246 0 011.229-.923C2.749 13.436 2 12.053 2 10.265c0-1.412.516-2.577 1.548-3.496 1.032-.927 2.302-1.39 3.81-1.39 1.18 0 2.166.221 2.96.664l1.205-1.403 2.126 1.932-1.462 1.071c.508.771.762 1.682.762 2.732 0 1.502-.46 2.704-1.377 3.607-.909.894-2.06 1.341-3.453 1.341a8.41 8.41 0 01-.884-.061l-.504-.074c-.058 0-.279.09-.664.27-.377.173-.565.353-.565.542 0 .328.283.492.848.492.254 0 .68-.061 1.278-.184s1.11-.185 1.536-.185c2.99 0 4.485 1.202 4.485 3.606 0 1.33-.598 2.372-1.794 3.126C10.659 23.618 9.217 24 7.53 24a9.054 9.054 0 01-5.469-1.785zm3.072-11.938c0 .78.213 1.407.64 1.883.434.468 1.015.701 1.744.701.73 0 1.29-.23 1.684-.689.393-.46.59-1.091.59-1.895 0-.665-.213-1.227-.64-1.686-.417-.46-.962-.69-1.634-.69-.704 0-1.278.222-1.72.665-.442.443-.664 1.013-.664 1.71zm18.15-1.76a3.217 3.217 0 00-1.806-.542c-.713 0-1.348.325-1.905.973-.55.648-.824 1.44-.824 2.375v7.508h-3.072V5.649h3.072v1.206c.86-.968 2.003-1.452 3.429-1.452 1.049 0 1.851.16 2.408.48l-1.303 2.634zm9.695 8.997c-.279.46-.766.837-1.462 1.132a5.56 5.56 0 01-2.163.43c-1.417 0-2.531-.352-3.342-1.058-.811-.713-1.217-1.723-1.217-3.027 0-1.526.57-2.72 1.709-3.582 1.146-.861 2.772-1.292 4.878-1.292.36 0 .786.061 1.277.184 0-1.55-.979-2.326-2.936-2.326-1.155 0-2.122.193-2.9.579l-.664-2.388c1.057-.509 2.314-.763 3.773-.763 2.007 0 3.477.46 4.41 1.379.935.91 1.402 2.642 1.402 5.193v2.819c0 1.756.352 2.86 1.056 3.31-.253.444-.536.715-.847.813a3.29 3.29 0 01-1.07.16c-.441 0-.839-.164-1.191-.492-.353-.329-.59-.686-.713-1.071zm-.295-4.886c-.524-.107-.917-.16-1.18-.16-2.425 0-3.637.796-3.637 2.387 0 1.182.684 1.773 2.052 1.773 1.844 0 2.765-.923 2.765-2.77v-1.23zm14.856 6.203v-.8c-.254.279-.684.525-1.29.738a5.825 5.825 0 01-1.88.308c-1.835 0-3.28-.583-4.338-1.748-1.048-1.165-1.573-2.79-1.573-4.874 0-2.084.602-3.778 1.807-5.083 1.212-1.313 2.727-1.969 4.546-1.969 1 0 1.91.205 2.728.615V.738L50.611 0v18.83H47.54zm0-10.031c-.655-.525-1.34-.788-2.052-.788-1.229 0-2.175.378-2.838 1.133-.664.746-.996 1.821-.996 3.224 0 2.74 1.319 4.111 3.957 4.111.295 0 .655-.086 1.081-.259.435-.18.717-.36.848-.541V8.8zM56.104.542c.491 0 .91.176 1.253.529.352.344.528.763.528 1.255 0 .492-.176.915-.528 1.268a1.706 1.706 0 01-1.253.517c-.492 0-.913-.173-1.266-.517a1.752 1.752 0 01-.516-1.268c0-.492.172-.91.516-1.255.353-.353.774-.53 1.266-.53zM54.519 18.83V8.172h-1.684V5.65h4.793v13.182h-3.109zm5.837-6.622c0-2.01.577-3.647 1.733-4.91 1.163-1.264 2.694-1.896 4.595-1.896 1.999 0 3.55.607 4.657 1.822C72.447 8.439 73 10.1 73 12.209c0 2.1-.566 3.77-1.696 5.01-1.122 1.238-2.662 1.858-4.62 1.858-2 0-3.555-.624-4.67-1.87-1.106-1.256-1.658-2.922-1.658-4.998zm3.194 0c0 2.905 1.045 4.357 3.134 4.357.959 0 1.716-.377 2.273-1.132.565-.755.848-1.83.848-3.225 0-2.863-1.04-4.295-3.121-4.295-.959 0-1.72.377-2.286 1.132-.565.755-.848 1.81-.848 3.163z"
    })]
  }));
});
export default Icon;