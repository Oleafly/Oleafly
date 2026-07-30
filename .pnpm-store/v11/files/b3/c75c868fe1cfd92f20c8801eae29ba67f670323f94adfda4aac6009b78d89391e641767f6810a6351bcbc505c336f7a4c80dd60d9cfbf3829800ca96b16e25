'use client';

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var _excluded = ["model", "size", "type", "shape"];
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : String(i); }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _createForOfIteratorHelper(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function e(_e) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion = true, didErr = false, err; return { s: function s() { it = it.call(o); }, n: function n() { var step = it.next(); normalCompletion = step.done; return step; }, e: function e(_e2) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && it.return != null) it.return(); } finally { if (didErr) throw err; } } }; }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }
function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }
import { memo, useMemo } from 'react';
import { modelMappings } from "../modelConfig";
import DefaultAvatar from "./DefaultAvatar";
import DefaultIcon from "./DefaultIcon";
import { jsx as _jsx } from "react/jsx-runtime";
var ModelIcon = /*#__PURE__*/memo(function (_ref) {
  var originModel = _ref.model,
    _ref$size = _ref.size,
    size = _ref$size === void 0 ? 12 : _ref$size,
    _ref$type = _ref.type,
    type = _ref$type === void 0 ? 'avatar' : _ref$type,
    shape = _ref.shape,
    rest = _objectWithoutProperties(_ref, _excluded);
  var Render = useMemo(function () {
    if (!originModel) return;
    var model = originModel.toLowerCase();
    var _iterator = _createForOfIteratorHelper(modelMappings),
      _step;
    try {
      for (_iterator.s(); !(_step = _iterator.n()).done;) {
        var item = _step.value;
        if (item.keywords.some(function (keyword) {
          return new RegExp(keyword, 'i').test(model);
        })) {
          return item;
        }
      }
    } catch (err) {
      _iterator.e(err);
    } finally {
      _iterator.f();
    }
  }, [originModel]);
  var props = _objectSpread(_objectSpread({
    size: size
  }, Render === null || Render === void 0 ? void 0 : Render.props), rest);
  switch (type) {
    case 'avatar':
      {
        if (!(Render !== null && Render !== void 0 && Render.Icon)) return /*#__PURE__*/_jsx(DefaultAvatar, _objectSpread({
          shape: shape
        }, props));
        return /*#__PURE__*/_jsx(Render.Icon.Avatar, _objectSpread({
          shape: shape
        }, props));
      }
    case 'mono':
      {
        if (!(Render !== null && Render !== void 0 && Render.Icon)) return /*#__PURE__*/_jsx(DefaultIcon, _objectSpread({}, props));
        return /*#__PURE__*/_jsx(Render.Icon, _objectSpread({}, props));
      }
    case 'color':
      {
        var _Render$Icon;
        if (!(Render !== null && Render !== void 0 && Render.Icon)) return /*#__PURE__*/_jsx(DefaultIcon, _objectSpread({}, props));
        return (_Render$Icon = Render.Icon) !== null && _Render$Icon !== void 0 && _Render$Icon.Color ? /*#__PURE__*/_jsx(Render.Icon.Color, _objectSpread({}, props)) : /*#__PURE__*/_jsx(Render.Icon, _objectSpread({}, props));
      }
    case 'combine':
      {
        var _Render$Icon2, _Render$Icon3, _Render$Icon4;
        if (!(Render !== null && Render !== void 0 && Render.Icon)) return /*#__PURE__*/_jsx(DefaultIcon, _objectSpread({}, props));
        return (_Render$Icon2 = Render.Icon) !== null && _Render$Icon2 !== void 0 && _Render$Icon2.Combine ? /*#__PURE__*/_jsx(Render.Icon.Combine, _objectSpread({
          type: 'mono'
        }, props)) : (_Render$Icon3 = Render.Icon) !== null && _Render$Icon3 !== void 0 && _Render$Icon3.Brand ? /*#__PURE__*/_jsx(Render.Icon.Brand, _objectSpread({}, props)) : (_Render$Icon4 = Render.Icon) !== null && _Render$Icon4 !== void 0 && _Render$Icon4.Text ? /*#__PURE__*/_jsx(Render.Icon.Text, _objectSpread({}, props)) : /*#__PURE__*/_jsx(Render.Icon, _objectSpread({}, props));
      }
    case 'combine-color':
      {
        var _Render$Icon5, _Render$Icon6, _Render$Icon7;
        if (!(Render !== null && Render !== void 0 && Render.Icon)) return /*#__PURE__*/_jsx(DefaultIcon, _objectSpread({}, props));
        return (_Render$Icon5 = Render.Icon) !== null && _Render$Icon5 !== void 0 && _Render$Icon5.Combine ? /*#__PURE__*/_jsx(Render.Icon.Combine, _objectSpread({
          type: 'color'
        }, props)) : (_Render$Icon6 = Render.Icon) !== null && _Render$Icon6 !== void 0 && _Render$Icon6.BrandColor ? /*#__PURE__*/_jsx(Render.Icon.BrandColor, _objectSpread({}, props)) : (_Render$Icon7 = Render.Icon) !== null && _Render$Icon7 !== void 0 && _Render$Icon7.Text ? /*#__PURE__*/_jsx(Render.Icon.Text, _objectSpread({}, props)) : /*#__PURE__*/_jsx(Render.Icon, _objectSpread({}, props));
      }
    default:
      {
        return /*#__PURE__*/_jsx(DefaultIcon, _objectSpread({}, props));
      }
  }
});
ModelIcon.displayName = 'ModelIcon';
export default ModelIcon;