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
    viewBox: "0 0 114 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M3.004 22V2.782h6.807v1.825c-.115 2.203-.612 4.028-1.483 5.477 1.047 1.277 1.569 2.784 1.569 4.523.057 2.956-1.253 4.405-3.927 4.348v-2.088c1.282 0 1.918-.84 1.918-2.522.058-1.563-.493-2.926-1.66-4.085C7.1 8.578 7.54 6.695 7.54 4.607H5.358V22H3h.004zM10.6 4.955V3.13h12.044v1.825h-1.396v14.261c.057 1.683-.871 2.522-2.794 2.522h-2.008v-1.826h1.133c.814.058 1.192-.262 1.134-.957v-14h-8.117.004zm.35 12.784V6.867h6.284v8.174c.058 1.855-.842 2.755-2.707 2.698H10.95zm2.09-1.74h.962c.756 0 1.133-.376 1.133-1.13V8.607H13.04v7.392zm13.178-2.87V2.783h16.928v7.216c0 2.145-.99 3.19-2.966 3.132h-4.013v2.001h7.419v1.912h-7.419v2.35h8.553v1.653H24.648v-1.653H33.2v-2.35h-7.418v-1.912H33.2V13.13h-6.983zm2.621-1.825H33.2V8.87h-4.362v2.435zm10.384 0c.871 0 1.31-.434 1.31-1.306v-1.13H36.17v2.436h3.056-.004zM28.838 4.607v2.436H33.2V4.607h-4.362zm11.69 0h-4.362v2.436h4.363V4.607zm6.458 6.525V9.221h20.07v1.911h-10.56c-1.282 2.841-2.995 5.22-5.147 7.13 4.362 0 8.026-.171 10.996-.52a31.512 31.512 0 00-1.483-3.216h2.444c1.22 1.973 2.182 4.203 2.88 6.696h-2.707c0-.114-.029-.262-.086-.434a9.095 9.095 0 01-.35-1.13c-4.596.463-8.901.697-12.914.697h-1.66v-2.088c2.095-2.26 3.607-4.638 4.54-7.13h-6.023v-.005zm1.836-6.09V3.04H65.23V5.04H48.822zm20.593-.087V3.044h19.898v1.911h-8.639c-.058.868-.234 1.654-.522 2.35h7.419v10.958c.058 2.03-1.019 3.012-3.229 2.955H71.251V7.305h5.845c.115-.348.263-.9.436-1.654 0-.29.028-.52.086-.696h-8.203zm4.453 14.524h9.772c.87.057 1.31-.406 1.31-1.392v-2.87H73.868v4.261zm0-10.262v4.085H84.95V9.217H73.868zm25.217-3.914v-1.74h3.143c.057-.175.115-.433.172-.781.115-.348.173-.61.173-.782h2.707c-.115.52-.263 1.044-.436 1.564h6.634v1.74h-7.155a11.442 11.442 0 01-.699 2h3.315v3.914h4.363v1.826h-4.363v5.915c.058 1.911-.903 2.84-2.879 2.783h-2.009v-1.826h1.047c.871.058 1.282-.29 1.22-1.043v-5.825h-4.974v-1.826c.115-.233.263-.552.435-.958.292-.52.493-.929.612-1.215h-1.396V7.833c-.699.172-1.397.29-2.095.348.057 3.885.813 6.84 2.267 8.87v1.478c.933-1.101 1.541-2.636 1.832-4.61h2.268c-.292 3.304-1.832 5.596-4.626 6.87v-1.654l.087-.172c-1.282-1.044-2.239-2.288-2.88-3.742-.756 2.665-2.21 4.872-4.362 6.611v-2.087c1.162-1.797 1.947-3.537 2.358-5.22.406-1.74.612-4.117.612-7.13V2.09H96.9v4.175c.583-.057 1.281-.233 2.095-.52V7.31h2.095c.115-.233.234-.581.349-1.044.172-.405.292-.724.349-.958h-2.707l.004-.004zM112 20.784c-2.617-1.334-4.071-3.622-4.362-6.868h2.181c.234 2.145.961 3.884 2.181 5.219v1.653-.004zm-19.808-9.566c-.349-1.797-.583-3.77-.698-5.915h1.746c.057 2.145.349 4.118.87 5.915h-1.918zm10.648-2.173a3.826 3.826 0 00-.35.695c-.172.291-.464.782-.87 1.478h2.707V9.045h-1.487z"
    })]
  }));
});
export default Icon;