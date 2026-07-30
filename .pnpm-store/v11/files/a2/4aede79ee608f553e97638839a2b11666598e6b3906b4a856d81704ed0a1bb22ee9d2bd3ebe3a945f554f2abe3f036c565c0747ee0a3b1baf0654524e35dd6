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
    viewBox: "0 0 116 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M101.793 7.213c1.238 0 2.21.201 2.921.605.708.405 1.216 1.074 1.52 2.005.307.932.459 2.223.459 3.872 0 1.65-.158 2.948-.471 3.896-.314.948-.821 1.63-1.521 2.04-.701.412-1.67.619-2.908.619-1.285 0-2.275-.171-2.968-.518v4.269h-3.687V7.51h1.782l.741 1.136c.397-.51.925-.877 1.585-1.1.66-.223 1.508-.333 2.547-.333zM7.616 4.046c1.831 0 3.637.197 5.42.593l-.473 2.944a18.963 18.963 0 00-2.15-.334 23.845 23.845 0 00-2.13-.087c-.84 0-1.54.042-2.102.123v3.019l2.276.173c1.336.117 2.398.347 3.18.693.784.346 1.347.854 1.695 1.523.346.668.519 1.547.519 2.634 0 1.187-.207 2.14-.619 2.857-.413.717-1.064 1.242-1.954 1.572-.892.33-2.08.495-3.562.495-2.096 0-4.001-.247-5.716-.742l.519-3.043c1.568.462 3.218.692 4.949.692.84 0 1.64-.049 2.4-.148v-2.993l-2.277-.199c-1.401-.116-2.485-.33-3.254-.643-.765-.314-1.315-.78-1.645-1.398-.33-.62-.494-1.474-.494-2.561 0-1.287.177-2.3.532-3.044.354-.741.918-1.281 1.694-1.62.776-.337 1.84-.506 3.192-.506zm14.251 3.167c1.42 0 2.51.115 3.277.346.77.23 1.313.627 1.634 1.187.321.56.482 1.362.482 2.4 0 1.106-.202 1.938-.606 2.498-.404.563-1.265 1.508-3.135 1.508h-3.582v2.08c.51.133 1.245.198 2.202.198 1.254 0 2.697-.205 4.33-.619l.47 2.575c-1.5.527-3.258.79-5.27.79-1.403 0-2.51-.207-3.328-.618-.816-.412-1.41-1.088-1.78-2.029-.372-.94-.558-2.219-.558-3.834 0-1.584.193-2.846.581-3.787.388-.939 1.006-1.624 1.856-2.052.849-.43 1.993-.643 3.427-.643zm14.004 0c1.815 0 3.116.3 3.908.902.792.602 1.188 1.596 1.188 2.983v8.783h-1.78l-.966-1.238c-1.22 1.022-2.656 1.533-4.304 1.533-1.436 0-2.471-.308-3.106-.926-.634-.62-.953-1.621-.953-3.008 0-1.104.19-1.938.569-2.498.379-.56 1.048-.954 2.006-1.175.955-.223 2.39-.335 4.302-.335h.546v-2.078c-.413-.132-1.039-.197-1.882-.197-1.417 0-2.927.207-4.526.618l-.472-2.572a13.994 13.994 0 012.587-.595 20.83 20.83 0 012.883-.197zm22.094 0c.709 0 1.46.045 2.252.136.79.09 1.408.2 1.854.333l-.37 2.624c-1.008-.232-1.833-.347-2.788-.347-.708 0-1.533.14-2.086.476v6.797c.444.133 1.08.198 1.905.198 1.055 0 2.143-.205 3.265-.619l.322 2.573c-1.254.53-2.706.792-4.354.792-1.27 0-2.27-.207-2.994-.618-.725-.412-1.25-1.084-1.573-2.016-.32-.932-.482-2.215-.482-3.849 0-1.631.162-2.915.482-3.846.323-.932.848-1.604 1.573-2.016.725-.411 1.723-.618 2.994-.618zm55.507 12.668h-3.688V7.51h3.688v12.37zm-62.188-9.155c-.462.1-1 .275-1.608.53-.61.258-1.08.508-1.41.757v7.867H44.58V7.51h1.806l1.113 1.805c1.155-1.122 2.601-1.958 3.785-2.177v3.588zm17.27-2.573c1.754-.4 3.81-.941 4.879-.941 2.135 0 2.643 1.657 2.643 2.45V19.88H72.39v-9.65h-3.76v9.65H64.94V3.563h3.614v4.59zM92.913 19.88h-3.687l-.816-2.969h-5.222l-.815 2.969h-3.686l4.28-15.463h5.666l4.28 15.463zm-59.664-2.302h4.033v-3.263h-4.033v3.263zm65.577-.174h3.908v-7.347h-3.908v7.347zm-14.87-3.24h3.687l-1.73-6.26h-.225l-1.732 6.26zm-64.019-1.038h4.008V9.984h-4.008v3.142zm93.537-7.683h-3.685V2h3.685v3.443z"
    })]
  }));
});
export default Icon;