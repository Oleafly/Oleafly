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
    viewBox: "0 0 46 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M30.244 7.754a245.01 245.01 0 01-1.611 9.454 48.69 48.69 0 002.685-2.12l-.492 2.877A40.804 40.804 0 0125.03 22c.872-4.035 1.679-8.316 2.259-12.263h-2.103l.36-1.983h4.697zm12.304-5.152c1.317 0 1.572.393 1.408 1.421l-.02.117c-.894 5.15-1.947 10.48-2.953 15.586h2.55l-.828 2.008h-4.788a392.322 392.322 0 001.813-9.7H36.35c-.537 3.233-1.163 6.467-1.789 9.7h-2.708c.65-3.211 1.275-6.489 1.79-9.7h-2.482l.334-1.985h2.529l.873-4.771 2.37 1.382-.58 3.39h3.4c.313-1.584.627-3.212.917-4.818.104-.544-.106-.637-.561-.646l-7.895-.001-.448-1.983h10.447zM5.914 2.58h4.229l.241.003c.882.028 1.256.238 1.122 1.105l-.02.117c-1.096 6-2.081 11.93-3.2 17.906h-2.26l.795-3.933c.197-.987.384-1.966.547-2.912h-1.61a678.345 678.345 0 01-1.499 6.845H2C3.901 15.668 4.84 9.447 5.914 2.58zm13.312-.56c-.044.96-.18 2.097-.402 2.989h.918c.357-.803.715-1.763 1.005-2.61h2.305c-.34.88-.706 1.75-1.096 2.61h1.612l-.426 1.763h-4.81c-.09.289-.27.713-.425 1.002h5.906l-.403 1.694h-3.443c.738 1.094 2.505 1.92 3.869 2.21l-.76 1.916c-.94-.2-1.968-.647-2.797-1.158l-.514 2.318h1.096c.739 0 1.275.157 1.141 1.071-.246 1.65-.694 3.945-1.051 5.886h-5.952l-.492-1.762h4.386l.18-.842c.152-.728.305-1.499.4-2.168.046-.311-.088-.423-.402-.423h-7.428l.672-3.59c-.683.298-1.395.522-2.125.668l.47-2.162c1.387-.335 2.796-1.004 3.668-1.962h-3.31l.38-1.694h4.093c.224-.313.404-.715.494-1.006h-4.433l.336-1.76h1.589l-.582-2.61h2.26l.537 2.61h.783c.265-.975.415-1.978.448-2.988l2.303-.001zm-1.073 15.343v.022l-.38 1.694h-7.586l-.312-1.716h8.278zm-.202-4.616h-4.9l1.479.67-.27 1.337h3.244l.447-2.007zm-9.574-3.21H6.832c-.224 1.158-.47 2.363-.716 3.567h1.611l.65-3.567zm9.373-.069h-.829c-.446.56-1.119 1.183-1.7 1.607h3.557c-.332-.37-.681-.947-.928-1.413l-.1-.194zM8.844 4.431h-1.12l-.217 1.305a90.08 90.08 0 01-.363 2.038h1.52l.56-2.92c.069-.335-.067-.423-.38-.423zM29.953 2c.359 1.515.783 3.144 1.119 4.704h-2.663c-.29-1.516-.65-3.166-.984-4.704h2.528z"
    })]
  }));
});
export default Icon;