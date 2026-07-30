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
    viewBox: "0 0 73 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M34.977 6.95c1.544 0 2.778.547 3.66 1.636.861 1.064 1.287 2.473 1.287 4.208 0 1.918-.476 3.479-1.437 4.663-.98 1.207-2.33 1.815-4.008 1.815-1.051 0-1.953-.308-2.69-.915l-.12-.104V24h-2.72V7.204h2.72v1.028l.054-.054c.804-.76 1.809-1.171 2.997-1.223l.257-.005zm22.557 0c1.75 0 3.147.549 4.154 1.65.999 1.093 1.493 2.59 1.493 4.469 0 1.847-.533 3.353-1.604 4.49-1.076 1.142-2.52 1.713-4.298 1.713-1.735 0-3.146-.557-4.201-1.67-1.05-1.109-1.573-2.572-1.573-4.364 0-1.94.543-3.486 1.636-4.607 1.095-1.122 2.57-1.681 4.393-1.681zm-36.031 0c1.75 0 3.147.549 4.154 1.65.999 1.093 1.493 2.59 1.493 4.469 0 1.847-.533 3.353-1.604 4.49-1.076 1.142-2.52 1.713-4.298 1.713-1.734 0-3.146-.557-4.2-1.67-1.05-1.109-1.574-2.572-1.574-4.364 0-1.94.543-3.486 1.636-4.607 1.095-1.122 2.57-1.681 4.393-1.681zM10.257 2.613c1.506 0 2.766.22 3.782.666l.294.129v3.05l-.728-.405c-1.015-.565-2.136-.847-3.37-.847-1.615 0-2.9.528-3.891 1.59-.996 1.066-1.496 2.5-1.496 4.327 0 1.73.466 3.08 1.391 4.08.92.993 2.12 1.488 3.636 1.488 1.442 0 2.677-.316 3.715-.945l.743-.45v2.893l-.263.139c-1.2.632-2.678.944-4.429.944-2.295 0-4.158-.746-5.556-2.238C2.695 15.549 2 13.604 2 11.228c0-2.55.779-4.634 2.337-6.225 1.558-1.591 3.542-2.39 5.92-2.39zm58.006 1.203l-.001 3.387H71V9.67l-2.738-.001v5.611c0 .556.08.946.212 1.17l.052.077c.143.18.412.281.848.281.336 0 .61-.087.842-.261l.784-.59v2.756l-.255.14c-.49.27-1.11.4-1.859.4-2.185 0-3.344-1.29-3.344-3.666V9.668h-1.867V7.205l1.866-.001.001-2.51.34-.11 1.74-.56.64-.207zm-23.82 3.388v11.814h-2.72V7.204h2.72zM49.707 2v17.018h-2.72V2h2.72zm-28.33 7.394c-.98 0-1.727.32-2.281.966-.568.66-.858 1.592-.858 2.815 0 1.17.291 2.064.863 2.707.561.632 1.308.946 2.276.946.986 0 1.711-.304 2.218-.913.523-.628.793-1.55.793-2.783 0-1.248-.27-2.181-.795-2.816-.506-.615-1.231-.922-2.216-.922zm13.166 0c-.873 0-1.552.293-2.072.885-.534.609-.8 1.372-.8 2.314v1.512c0 .772.245 1.41.742 1.942.49.524 1.1.781 1.865.781.902 0 1.581-.33 2.085-1.008.527-.71.799-1.725.799-3.058 0-1.1-.247-1.935-.727-2.522-.463-.567-1.08-.846-1.892-.846zm22.865 0c-.98 0-1.727.32-2.281.966-.568.66-.858 1.592-.858 2.815 0 1.17.291 2.064.863 2.707.561.632 1.308.946 2.276.946.986 0 1.711-.304 2.218-.913.523-.628.793-1.55.793-2.783 0-1.248-.27-2.181-.795-2.816-.507-.615-1.231-.922-2.216-.922zM43.105 2.2c.444 0 .836.156 1.151.46.32.309.485.707.485 1.164 0 .443-.165.834-.482 1.145a1.605 1.605 0 01-1.154.468c-.437 0-.825-.154-1.136-.454a1.561 1.561 0 01-.48-1.16c0-.454.162-.851.477-1.16.312-.306.7-.463 1.139-.463z"
    })]
  }));
});
export default Icon;