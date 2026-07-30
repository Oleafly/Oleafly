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
    viewBox: "0 0 144 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M14.694 1C7.322 1 2 5.638 2 12s5.322 11 12.694 11c7.344 0 12.665-4.638 12.665-11S22.038 1 14.694 1zm0 4.31c4.43 0 7.611 2.647 7.611 6.69 0 4.043-3.18 6.69-7.61 6.69-4.46 0-7.641-2.647-7.641-6.69 0-4.043 3.181-6.69 7.64-6.69zM34.183 20.89c1.07 1.159 3.062 2.11 5.678 2.11 5.352 0 8.473-3.686 8.473-8.146 0-4.49-3.121-8.176-8.473-8.176-2.616 0-4.608.982-5.678 2.111V1.327h-4.757v21.346h4.757v-1.784zm-.149-6.125c0-2.468 2.111-4.251 4.846-4.251 2.616 0 4.816 1.546 4.816 4.34 0 2.795-2.2 4.31-4.816 4.31-2.735 0-4.846-1.753-4.846-4.22v-.18zM48.841 20.086C50.655 21.93 54.133 23 57.761 23c4.905 0 8.591-1.784 8.591-5.44 0-3.568-3.508-4.252-7.521-4.728-3.39-.386-4.43-.475-4.43-1.338 0-.802 1.07-1.308 3.092-1.308 2.438 0 4.548.744 5.975 2.052l2.468-2.854c-1.576-1.517-4.519-2.706-8.205-2.706-4.965 0-8.027 2.14-8.027 5.352 0 3.359 3.121 4.102 6.867 4.578 3.508.416 4.995.416 4.995 1.457 0 .98-1.308 1.397-3.449 1.397-2.676 0-5.143-.832-7.016-2.557l-2.26 3.181zM68.068 5.4h4.846V1.327h-4.846V5.4zm4.787 1.605h-4.757v15.668h4.757V7.006zM89.11 20.89v1.783h4.757V1.327H89.11V8.79c-1.07-1.13-3.062-2.11-5.678-2.11-5.351 0-8.473 3.686-8.473 8.175 0 4.46 3.122 8.146 8.473 8.146 2.616 0 4.608-.951 5.678-2.11zm.149-6.125v.178c0 2.468-2.11 4.222-4.846 4.222-2.616 0-4.816-1.516-4.816-4.31 0-2.796 2.2-4.341 4.816-4.341 2.735 0 4.846 1.783 4.846 4.25zM96.753 5.4h4.846V1.327h-4.846V5.4zm4.786 1.605h-4.756v15.668h4.756V7.006zM110.214 23c2.765 0 5.024-.803 6.451-2.052.803 1.487 2.706 2.379 6.184 1.725v-3.508c-1.665.356-2.021-.03-2.021-.863v-5.708c0-3.924-2.944-5.916-7.938-5.916-4.311 0-7.76 1.873-8.741 4.698l4.281 1.159c.476-1.219 2.111-2.11 4.252-2.11 2.527 0 3.537.95 3.537 2.14v.089l-6.243.565c-3.686.357-6.392 1.873-6.392 4.935 0 3.092 2.765 4.846 6.63 4.846zm6.005-6.333c0 1.814-2.705 2.854-5.143 2.854-1.843 0-2.884-.535-2.884-1.546 0-1.04.833-1.427 2.468-1.575l5.559-.565v.832zM124.479 22.673h4.757V15.18c0-2.705 1.487-4.281 4.073-4.281 2.438 0 3.716 1.605 3.716 4.251v7.522h4.757v-8.92c0-4.34-2.765-7.075-6.838-7.075-2.527 0-4.489.952-5.708 2.23V7.005h-4.757v15.668z"
    })]
  }));
});
export default Icon;