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
import { useFillId } from "../../hooks/useFillId";
import { TITLE } from "../style";
import { jsx as _jsx } from "react/jsx-runtime";
import { jsxs as _jsxs } from "react/jsx-runtime";
var Icon = /*#__PURE__*/memo(function (_ref) {
  var _ref$size = _ref.size,
    size = _ref$size === void 0 ? '1em' : _ref$size,
    style = _ref.style,
    rest = _objectWithoutProperties(_ref, _excluded);
  var _useFillId = useFillId("".concat(TITLE, "-brand")),
    id = _useFillId.id,
    fill = _useFillId.fill;
  return /*#__PURE__*/_jsxs("svg", _objectSpread(_objectSpread({
    height: size,
    style: _objectSpread({
      flex: 'none',
      lineHeight: 1
    }, style),
    viewBox: "0 0 128 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M6.96 19.315c3.195 0 5.247-1.607 5.247-4.148 0-1.9-1.183-3.244-3.294-3.803l-1.615-.396-.2-.046c-1.138-.272-1.696-.573-1.696-1.431 0-.752.598-1.167 1.61-1.167 3.22 0 4.388 1.167 4.388 1.167V6.964l-.042-.041c-.233-.216-1.47-1.217-4.371-1.217C3.922 5.706 2 7.261 2 9.698c0 1.935 1.253 3.27 3.512 3.832l1.423.341c1.194.286 1.792.597 1.792 1.504 0 .83-.65 1.296-1.792 1.296C3.643 16.67 2 14.915 2 14.915v3.031l.042.045c.238.235 1.52 1.324 4.919 1.324zm15.723-.155v-2.818l-.822.011c-.217 0-.475 0-.774-.005l-.345-.006c-1.41-.024-1.9-.688-1.9-2.244V8.804h3.534v-2.84h-3.534v-2.83h-3.316v2.83h-1.872v2.84h1.872v5.516c0 3.26 1.584 4.84 4.825 4.84h2.332zm62.67 0v-2.818l-.821.011c-.217 0-.476 0-.775-.005l-.344-.006c-1.41-.024-1.9-.688-1.9-2.244V8.804h3.534v-2.84h-3.535v-2.83h-3.315v2.83h-1.872v2.84h1.872v5.516c0 3.26 1.583 4.84 4.824 4.84h2.332zM34.445 5.988V7.91c-.873-1.41-2.494-2.204-4.342-2.204-3.672 0-6.214 2.768-6.214 6.74 0 3.972 2.516 6.714 6.137 6.714 1.874 0 3.52-.794 4.419-2.204v1.922h3.104V5.988h-3.104zm-3.793 10.435c-2.087 0-3.478-1.61-3.478-3.858 0-2.22 1.418-3.857 3.478-3.857 2.087 0 3.612 1.637 3.612 3.857 0 2.248-1.552 3.858-3.612 3.858zm17.67-10.717c-2.078 0-3.321 1.256-4.187 2.564V.074H40.82V18.89h3.216v-1.877c.841 1.358 2.48 2.073 4.286 2.073 3.464 0 5.988-2.717 5.988-6.52 0-3.778-2.202-6.859-5.988-6.859zM47.605 16.2c-2.122 0-3.599-1.609-3.599-3.78 0-2.144 1.612-3.672 3.68-3.672 2.095 0 3.438 1.5 3.438 3.672 0 2.171-1.478 3.78-3.519 3.78zM58.85 3.709c1.031 0 1.799-.745 1.799-1.752 0-1.03-.746-1.752-1.799-1.752-1.03 0-1.777.723-1.777 1.752s.746 1.751 1.777 1.751zM57.203 19.09h3.316V6.093h-3.316v12.998zM72.41 3.708c1.03 0 1.798-.744 1.798-1.751 0-1.03-.745-1.752-1.798-1.752-1.031 0-1.777.723-1.777 1.752s.746 1.751 1.777 1.751zm-1.647 15.383h3.315V6.093h-3.315v12.998zm-6.818-.156h3.417V0h-3.417v18.935zM88.811 24h3.669l7.047-17.98H96.09l-3.08 8.765-3.09-8.765h-3.81L91.22 18.57 88.811 24zm27.214-18.012V7.91c-.873-1.41-2.493-2.204-4.342-2.204-3.672 0-6.214 2.768-6.214 6.74 0 3.972 2.517 6.714 6.137 6.714 1.874 0 3.52-.794 4.419-2.204v1.922h3.104V5.988h-3.104zm-3.793 10.435c-2.087 0-3.478-1.61-3.478-3.858 0-2.22 1.418-3.857 3.478-3.857 2.087 0 3.612 1.637 3.612 3.857 0 2.248-1.551 3.858-3.612 3.858zm11.97-12.715c1.03 0 1.798-.744 1.798-1.751 0-1.03-.746-1.752-1.799-1.752-1.03 0-1.776.723-1.776 1.752s.745 1.751 1.776 1.751zm-1.647 15.383h3.315V6.093h-3.315v12.998z",
      fill: fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M101.485 19.258c1.136 0 1.982-.82 1.982-1.93 0-1.134-.822-1.93-1.982-1.93-1.137 0-1.958.796-1.958 1.93s.821 1.93 1.958 1.93z",
      fill: "#E80000"
    }), /*#__PURE__*/_jsx("defs", {
      children: /*#__PURE__*/_jsxs("linearGradient", {
        id: id,
        x1: "50%",
        x2: "50%",
        y1: "0%",
        y2: "100%",
        children: [/*#__PURE__*/_jsx("stop", {
          offset: "0%",
          stopColor: "#9D39FF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "100%",
          stopColor: "#A380FF"
        })]
      })
    })]
  }));
});
export default Icon;