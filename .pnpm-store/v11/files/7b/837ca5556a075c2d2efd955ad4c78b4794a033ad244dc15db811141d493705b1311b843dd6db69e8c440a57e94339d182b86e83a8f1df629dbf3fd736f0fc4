'use client';

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var _excluded = ["Icon", "style", "Text", "color", "size", "spaceMultiple", "textMultiple", "extra", "extraStyle", "showText", "showLogo", "extraClassName", "iconProps", "inverse"];
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : String(i); }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }
function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { jsx as _jsx } from "react/jsx-runtime";
import { Fragment as _Fragment } from "react/jsx-runtime";
import { jsxs as _jsxs } from "react/jsx-runtime";
var IconCombine = /*#__PURE__*/memo(function (_ref) {
  var Icon = _ref.Icon,
    style = _ref.style,
    Text = _ref.Text,
    color = _ref.color,
    _ref$size = _ref.size,
    size = _ref$size === void 0 ? 24 : _ref$size,
    _ref$spaceMultiple = _ref.spaceMultiple,
    spaceMultiple = _ref$spaceMultiple === void 0 ? 1 : _ref$spaceMultiple,
    _ref$textMultiple = _ref.textMultiple,
    textMultiple = _ref$textMultiple === void 0 ? 1 : _ref$textMultiple,
    extra = _ref.extra,
    extraStyle = _ref.extraStyle,
    _ref$showText = _ref.showText,
    showText = _ref$showText === void 0 ? true : _ref$showText,
    _ref$showLogo = _ref.showLogo,
    showLogo = _ref$showLogo === void 0 ? true : _ref$showLogo,
    extraClassName = _ref.extraClassName,
    iconProps = _ref.iconProps,
    inverse = _ref.inverse,
    rest = _objectWithoutProperties(_ref, _excluded);
  var logo = Icon && showLogo && /*#__PURE__*/_jsx(Icon, _objectSpread(_objectSpread({
    size: size
  }, iconProps), {}, {
    style: inverse ? _objectSpread({
      marginLeft: size * spaceMultiple
    }, iconProps === null || iconProps === void 0 ? void 0 : iconProps.style) : _objectSpread({
      marginRight: size * spaceMultiple
    }, iconProps === null || iconProps === void 0 ? void 0 : iconProps.style)
  }));
  var text = showText && Text && /*#__PURE__*/_jsx(Text, {
    size: size * textMultiple
  });
  return /*#__PURE__*/_jsxs(Flexbox, _objectSpread(_objectSpread({
    align: 'center',
    flex: 'none',
    horizontal: true,
    justify: 'flex-start',
    style: _objectSpread({
      color: color
    }, style)
  }, rest), {}, {
    children: [inverse ? /*#__PURE__*/_jsxs(_Fragment, {
      children: [text, logo]
    }) : /*#__PURE__*/_jsxs(_Fragment, {
      children: [logo, text]
    }), extra && /*#__PURE__*/_jsx("span", {
      className: extraClassName,
      style: _objectSpread({
        fontSize: size * textMultiple * 0.95,
        lineHeight: 1
      }, extraStyle),
      children: extra
    })]
  }));
});
export default IconCombine;