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
    viewBox: "0 0 84 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M5.396 22c-.317 0-.574-.1-.771-.298-.188-.199-.282-.472-.282-.82V7.97H2.89c-.267 0-.485-.075-.653-.224C2.08 7.596 2 7.383 2 7.105c0-.268.08-.482.237-.64.168-.16.386-.239.653-.239h1.453V4.305c0-1.4.331-2.433.993-3.098C6.01.53 6.938.194 8.124.194c.633 0 1.102.089 1.409.268.316.169.474.412.474.73 0 .387-.192.63-.578.73-.099.02-.217.034-.356.044h-.46c-.721 0-1.265.194-1.63.581-.366.377-.55.998-.55 1.862v1.817h2.625c.267 0 .48.08.638.238.168.16.252.373.252.64 0 .279-.084.492-.252.641-.158.15-.37.224-.638.224h-2.61v12.914c0 .347-.093.62-.281.82-.188.198-.445.297-.771.297zm7.963 0c-.307 0-.559-.1-.757-.298-.197-.208-.296-.482-.296-.82V1.118c0-.337.099-.606.296-.804A.997.997 0 0113.36 0c.306 0 .558.104.756.313.198.198.296.467.296.804v19.766c0 .338-.098.61-.296.82-.198.198-.45.297-.756.297zm10.75 0c-1.413 0-2.654-.323-3.722-.968-1.057-.655-1.883-1.584-2.476-2.786-.583-1.201-.875-2.621-.875-4.26 0-1.638.292-3.058.875-4.26.593-1.201 1.419-2.125 2.476-2.77 1.068-.655 2.309-.983 3.722-.983 1.424 0 2.665.328 3.722.983 1.058.645 1.884 1.569 2.477 2.77.593 1.202.89 2.622.89 4.26 0 1.629-.297 3.049-.89 4.26-.593 1.202-1.419 2.13-2.477 2.786-1.057.645-2.298.968-3.722.968zm0-1.832c.999 0 1.869-.243 2.61-.73.742-.496 1.315-1.206 1.72-2.13.416-.933.623-2.04.623-3.322 0-1.29-.207-2.398-.623-3.321-.405-.924-.978-1.629-1.72-2.115-.741-.497-1.611-.745-2.61-.745-.988 0-1.853.248-2.595.745-.741.486-1.32 1.191-1.735 2.115-.405.923-.607 2.03-.607 3.322 0 1.29.202 2.398.607 3.321.416.924.989 1.634 1.72 2.13.742.487 1.612.73 2.61.73zM37.722 22c-.336 0-.613-.084-.83-.253-.208-.169-.366-.442-.475-.82l-3.915-13.45a6.664 6.664 0 01-.074-.298c-.01-.099-.015-.193-.015-.283 0-.288.094-.511.282-.67.188-.169.435-.253.742-.253.267 0 .474.07.622.208.158.14.277.363.356.67l3.366 12.587h.045L41.4 6.956c.177-.655.602-.983 1.275-.983.642 0 1.053.323 1.23.968l3.589 12.497h.06l3.35-12.586c.08-.308.193-.532.342-.67.158-.14.37-.21.637-.21.317 0 .564.085.742.254.188.159.281.382.281.67 0 .09-.005.18-.014.269-.01.089-.035.188-.075.297l-3.914 13.48c-.11.358-.272.626-.49.805-.207.169-.484.253-.83.253-.366 0-.657-.084-.875-.253-.207-.169-.366-.442-.474-.82l-3.56-11.96h-.044l-3.544 11.975c-.099.348-.262.611-.49.79-.227.179-.518.268-.874.268zM56.065 3.158a1.37 1.37 0 01-.964-.388c-.267-.268-.4-.59-.4-.968 0-.377.133-.695.4-.953.277-.268.598-.402.964-.402.376 0 .697.134.964.402.277.258.415.576.415.953 0 .378-.138.7-.415.968a1.336 1.336 0 01-.964.388zm0 18.842a.997.997 0 01-.756-.313c-.198-.208-.297-.476-.297-.804V7.09c0-.338.099-.606.297-.804a.997.997 0 01.756-.313c.306 0 .558.104.756.313.198.198.297.466.297.804v13.793c0 .328-.1.596-.297.804a.997.997 0 01-.756.313zm5.264-3.783V7.969h-1.498c-.296 0-.529-.08-.697-.238-.168-.16-.252-.373-.252-.641 0-.278.084-.491.252-.64.168-.15.4-.224.697-.224h1.498V3.232c0-.337.099-.61.297-.819a.997.997 0 01.756-.313c.316 0 .568.104.756.313.198.209.297.482.297.82v2.993h2.254c.296 0 .524.075.682.224.168.149.252.362.252.64 0 .268-.084.482-.252.64-.158.16-.386.239-.682.239h-2.254v9.816c0 .754.143 1.305.43 1.653.296.348.79.536 1.482.566l.416.015c.336.02.583.1.741.238.168.14.252.338.252.596 0 .209-.05.387-.148.536-.099.15-.257.263-.475.343-.217.07-.509.104-.874.104h-.386c-1.186 0-2.076-.293-2.67-.879-.582-.595-.874-1.509-.874-2.74zM70.3 22c-.306 0-.558-.1-.756-.298-.198-.208-.296-.482-.296-.82V1.103c0-.337.093-.605.281-.804.198-.199.455-.298.771-.298.326 0 .584.1.771.298.188.199.282.467.282.804v7.984h.06a4.792 4.792 0 011.912-2.264c.89-.566 1.943-.85 3.159-.85 1.7 0 3.044.527 4.033 1.58C81.506 8.594 82 9.985 82 11.722v9.16c0 .338-.099.612-.297.82-.197.199-.45.298-.756.298s-.558-.1-.756-.298c-.198-.208-.297-.482-.297-.82V12.08c0-1.32-.356-2.358-1.067-3.113-.702-.755-1.696-1.132-2.98-1.132-.9 0-1.691.203-2.373.61a4.096 4.096 0 00-1.572 1.684c-.366.715-.549 1.549-.549 2.502v8.252c0 .338-.099.61-.296.82-.198.198-.45.297-.757.297z"
    })]
  }));
});
export default Icon;