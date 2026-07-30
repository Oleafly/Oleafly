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
    viewBox: "0 0 96 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M82.946 24c-.472 0-.916-.038-1.33-.114a4.842 4.842 0 01-1.016-.271l.84-2.785c.438.135.832.208 1.182.22.356.011.663-.07.92-.246.262-.175.475-.473.639-.893l.219-.57-4.825-13.833h3.923l2.784 9.876h.14l2.811-9.876h3.949L87.955 20.41a6.256 6.256 0 01-1.025 1.891 4.2 4.2 0 01-1.62 1.253c-.653.297-1.441.446-2.364.446zM70.657 19.21c-.858 0-1.623-.149-2.294-.446a3.692 3.692 0 01-1.593-1.34c-.386-.595-.578-1.337-.578-2.224 0-.747.137-1.374.411-1.882a3.332 3.332 0 011.121-1.226 5.437 5.437 0 011.611-.7 12.29 12.29 0 011.909-.333 48.364 48.364 0 001.891-.228c.479-.076.826-.187 1.042-.333.216-.146.324-.362.324-.648v-.052c0-.555-.175-.984-.525-1.287-.345-.304-.835-.456-1.471-.456-.671 0-1.206.15-1.602.447-.398.292-.66.66-.789 1.103l-3.45-.28a4.687 4.687 0 011.034-2.119c.514-.601 1.176-1.062 1.987-1.383.818-.327 1.763-.49 2.837-.49.747 0 1.462.087 2.145.262a5.612 5.612 0 011.83.814c.537.368.96.84 1.27 1.419.31.572.464 1.258.464 2.057v9.071h-3.537v-1.864h-.105c-.216.42-.505.79-.867 1.111a4.011 4.011 0 01-1.305.745c-.508.175-1.094.262-1.76.262zm1.069-2.574c.548 0 1.033-.108 1.453-.324.42-.222.75-.52.99-.893.239-.373.358-.797.358-1.27v-1.427a2 2 0 01-.481.21 8.793 8.793 0 01-.674.167c-.251.046-.502.09-.753.131l-.683.096c-.438.065-.82.167-1.147.307-.327.14-.581.33-.762.569-.181.233-.272.525-.272.876 0 .507.184.896.552 1.164.374.263.846.394 1.418.394zM48.503 18.957l-3.66-13.45h3.773l2.084 9.037h.123l2.171-9.036h3.704l2.207 8.983h.114l2.048-8.983h3.765l-3.65 13.449h-3.95l-2.311-8.459h-.167l-2.311 8.459h-3.94zM42.862 1.024v17.932h-3.73V1.024h3.73zM32.414 18.956V5.507h3.73v13.45h-3.73zm1.873-15.182c-.554 0-1.03-.184-1.427-.552-.39-.373-.586-.82-.586-1.34 0-.513.195-.954.586-1.322A2.01 2.01 0 0134.287 0c.555 0 1.028.187 1.419.56.397.368.595.809.595 1.323 0 .519-.198.966-.595 1.34a1.996 1.996 0 01-1.419.55zM21.946 19.21c-.858 0-1.623-.149-2.294-.446a3.692 3.692 0 01-1.594-1.34c-.385-.595-.578-1.337-.578-2.224 0-.747.138-1.374.412-1.882a3.331 3.331 0 011.12-1.226 5.437 5.437 0 011.612-.7 12.294 12.294 0 011.909-.333 48.364 48.364 0 001.89-.228c.48-.076.827-.187 1.043-.333.216-.146.324-.362.324-.648v-.052c0-.555-.175-.984-.525-1.287-.345-.304-.835-.456-1.471-.456-.672 0-1.206.15-1.603.447-.397.292-.66.66-.788 1.103l-3.45-.28a4.687 4.687 0 011.034-2.119c.513-.601 1.176-1.062 1.987-1.383.817-.327 1.763-.49 2.837-.49.747 0 1.462.087 2.145.262a5.612 5.612 0 011.83.814c.537.368.96.84 1.27 1.419.31.572.464 1.258.464 2.057v9.071h-3.537v-1.864h-.106c-.216.42-.505.79-.866 1.111a4.012 4.012 0 01-1.305.745c-.508.175-1.095.262-1.76.262zm1.068-2.574c.549 0 1.033-.108 1.454-.324.42-.222.75-.52.99-.893.238-.373.358-.797.358-1.27v-1.427a2 2 0 01-.482.21 8.793 8.793 0 01-.674.167c-.25.046-.502.09-.753.131l-.683.096c-.437.065-.82.167-1.147.307-.327.14-.58.33-.761.569-.181.233-.272.525-.272.876 0 .507.184.896.552 1.164.373.263.846.394 1.418.394zM2 18.956V1.024h7.075c1.354 0 2.51.242 3.467.727.963.479 1.696 1.159 2.198 2.04.508.876.762 1.906.762 3.09 0 1.192-.257 2.216-.77 3.074-.515.852-1.259 1.506-2.234 1.961-.969.456-2.142.684-3.52.684H4.242V9.552h4.124c.723 0 1.325-.099 1.803-.297.479-.199.835-.496 1.069-.893.239-.397.359-.89.359-1.48 0-.596-.12-1.098-.36-1.506-.233-.409-.592-.718-1.076-.928-.48-.216-1.083-.324-1.813-.324H5.791v14.832H2zm9.684-8.16l4.457 8.16h-4.185l-4.361-8.16h4.09z"
    })]
  }));
});
export default Icon;