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
    viewBox: "0 0 55 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      clipRule: "evenodd",
      d: "M52.809 17.07a.292.292 0 00-.184-.06.448.448 0 00-.31.136l-.014.015-.01.017c-1.153 1.82-2.12 3.036-2.965 3.794-.843.757-1.551 1.046-2.192 1.046-.362 0-.57-.105-.694-.257-.13-.16-.195-.406-.195-.747 0-.535.157-1.169.404-1.83.239-.637.556-1.289.885-1.888 1.237-.369 2.685-1.034 3.63-1.872l.002-.001v-.001c.338-.312.626-.636.83-.962.204-.326.331-.664.331-1.002 0-.254-.07-.52-.264-.723-.195-.205-.49-.32-.883-.32-.78 0-1.772.373-2.727 1.006a8.694 8.694 0 00-2.577 2.652c-.238.387-.436.78-.592 1.176-1.112 1.67-2.061 2.866-2.916 3.645-.858.78-1.602 1.124-2.304 1.124-.327 0-.53-.107-.658-.266-.132-.166-.203-.416-.203-.738 0-.628.209-1.383.556-2.2.346-.815.822-1.678 1.343-2.518.589-.95 1.173-1.77 1.703-2.349.264-.29.51-.515.732-.666.225-.153.407-.218.546-.218.147 0 .278.085.417.283.14.2.258.475.39.782l.192.443.863-1.578-.126-.097c-.395-.305-.931-.481-1.543-.481-2.096 0-4.156 1.578-5.304 3.436a9.722 9.722 0 00-.706 1.354l-.89 1.383c-.65 1.015-1.212 1.886-1.768 2.506-.557.62-1.075.952-1.628.952-.23 0-.388-.061-.485-.15-.095-.086-.156-.218-.156-.412 0-.258.051-.501.414-1.163.364-.664 1.028-1.724 2.227-3.608l2.241-3.55-.099-.499h-3.295l-.05.037a.54.54 0 00-.164.19.458.458 0 00-.047.208v.185h1.166l-1.33 2.124c-.387.62-.73 1.19-1.016 1.739l-.762 1.134c-.773 1.152-1.432 2.121-2.06 2.804-.631.685-1.197 1.044-1.778 1.044-.203 0-.338-.054-.422-.131-.081-.075-.136-.194-.136-.376 0-.213.083-.483.33-.91.244-.425.637-.984 1.229-1.773l.853-1.134c1.114-1.484 1.44-2.353 1.44-3.461 0-.537-.075-1.013-.28-1.36-.213-.363-.556-.569-1.032-.569-.633 0-1.321.325-2.042.881-.725.56-1.504 1.371-2.322 2.384l-.02.024h-.248v-1.443c0-.528-.098-.938-.347-1.214-.254-.28-.626-.383-1.076-.383h-1.01l-.055.054a.722.722 0 00-.186.336l-.057.23h1.198c.345 0 .515.062.6.137.079.07.124.183.124.397 0 .208-.076.468-.237.806-.16.334-.395.727-.697 1.197l-4.171 6.624h2.361l2.395-3.712.137-.22c1.152-1.71 2.23-3.073 3.187-4.008.48-.468.923-.824 1.327-1.062.405-.24.757-.353 1.056-.353.182 0 .263.043.3.08.038.038.067.105.067.233 0 .188-.078.438-.273.788-.193.348-.489.775-.9 1.313l-.909 1.19c-1.165 1.535-1.717 2.765-1.717 3.988 0 .443.07.943.292 1.34.23.409.618.7 1.214.7.832 0 1.596-.557 2.306-1.328.506-.55 1.004-1.231 1.498-1.952a6.13 6.13 0 00-.089 1.046c0 .423.049.95.257 1.375.105.216.254.412.464.553.21.143.47.222.785.222.783 0 1.468-.5 2.092-1.193.589-.654 1.153-1.516 1.718-2.393-.02.198-.03.4-.03.606 0 .787.185 1.532.559 2.086.377.56.948.922 1.69.922.819 0 1.625-.361 2.485-1.091.724-.614 1.496-1.497 2.358-2.671-.033.263-.05.524-.05.781 0 .776.193 1.514.57 2.064.38.554.95.917 1.68.917.83 0 1.683-.367 2.626-1.206.941-.836 1.984-2.154 3.199-4.083l.028-.046v-.053a.262.262 0 00-.096-.207zm-2.993-3.11c.304-.317.59-.558.852-.719.263-.16.489-.234.677-.234.158 0 .24.045.285.093.047.051.081.138.081.275 0 .2-.084.442-.256.714a4.254 4.254 0 01-.729.837c-.71.645-1.765 1.218-2.77 1.61.64-1.09 1.277-1.966 1.86-2.575z"
    }), /*#__PURE__*/_jsx("path", {
      clipRule: "evenodd",
      d: "M22.04 17.331v-.053a.262.262 0 00-.096-.207.292.292 0 00-.184-.062.449.449 0 00-.31.137l-.014.015-.011.017c-1.152 1.82-2.119 3.036-2.964 3.794-.843.757-1.552 1.046-2.192 1.046-.363 0-.57-.105-.694-.257-.13-.16-.195-.406-.195-.747 0-.535.156-1.169.404-1.83.238-.637.556-1.289.884-1.888 1.238-.369 2.686-1.034 3.63-1.872l.002-.001.002-.001c.337-.312.625-.636.83-.962.203-.326.33-.664.33-1.002 0-.254-.071-.52-.264-.723-.195-.205-.49-.32-.884-.32-.78 0-1.771.373-2.726 1.006a8.701 8.701 0 00-2.578 2.652c-.732 1.19-1.073 2.441-1.073 3.612 0 .776.193 1.514.57 2.064.38.554.95.917 1.679.917.83 0 1.684-.367 2.627-1.206.94-.836 1.984-2.154 3.199-4.083l.028-.046zm-3.09-3.37c.305-.318.591-.56.853-.72.262-.16.489-.234.677-.234.157 0 .24.045.284.093.047.051.082.138.082.275 0 .2-.084.442-.257.714-.171.269-.42.554-.729.837-.71.645-1.764 1.218-2.77 1.61.642-1.09 1.277-1.966 1.86-2.575zM16.01 11.334c.266-.385.53-.768.793-1.146 1.735-2.495 3.38-4.86 5.164-6.602 1.781-1.74 3.68-2.839 5.922-2.839.778 0 1.584.135 2.28.377l.17.06.24-.661-.188-.056A8.915 8.915 0 0027.889.1c-2.41 0-4.446 1.174-6.294 2.96H8.655l-.386.648h5.33c-1.394.67-2.42 1.793-3.188 3.005-.932 1.47-1.495 3.087-1.88 4.222a99.088 99.088 0 00-1.068 3.299v.001c-.67 2.157-1.208 3.893-2.072 5.305-.856 1.4-2.035 2.486-3.997 3.323l-.201.086.461.722.153-.09a8.699 8.699 0 011.992-.862c2.986-.893 5.371-2.784 7.44-5.068 1.753-1.935 3.288-4.163 4.772-6.317zM5.355 21.065c1.083-.967 1.96-2.047 2.745-3.392.87-1.489 1.628-3.303 2.431-5.649.213-.617.41-1.234.602-1.835.567-1.777 1.088-3.402 1.852-4.587.755-1.171 1.736-1.894 3.235-1.894h4.74c-1.618 1.716-3.13 3.885-4.688 6.12l-.006.009c-3.058 4.386-6.299 9.026-10.911 11.228z"
    })]
  }));
});
export default Icon;