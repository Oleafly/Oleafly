function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var _excluded = ["className", "children"];
var _templateObject, _templateObject2, _templateObject3;
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : String(i); }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }
function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }
function _taggedTemplateLiteral(strings, raw) { if (!raw) { raw = strings.slice(0); } return Object.freeze(Object.defineProperties(strings, { raw: { value: Object.freeze(raw) } })); }
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useRef } from 'react';
import DownloadButton from "../DownloadButton";
import { jsx as _jsx } from "react/jsx-runtime";
import { jsxs as _jsxs } from "react/jsx-runtime";
var styles = createStaticStyles(function (_ref) {
  var css = _ref.css,
    cssVar = _ref.cssVar;
  return {
    btn: cx('copy-button', css(_templateObject || (_templateObject = _taggedTemplateLiteral(["\n        position: absolute;\n        inset-block-start: 4px;\n        inset-inline-end: 4px;\n        opacity: 0;\n      "])))),
    container: css(_templateObject2 || (_templateObject2 = _taggedTemplateLiteral(["\n      position: relative;\n\n      flex: none;\n\n      padding: 12px;\n      border: 1px solid ", ";\n      border-radius: ", ";\n\n      line-height: 1;\n\n      background: ", ";\n\n      &:hover {\n        .copy-button {\n          opacity: 1;\n        }\n      }\n    "])), cssVar.colorBorder, cssVar.borderRadius, cssVar.colorBgContainer),
    inner: css(_templateObject3 || (_templateObject3 = _taggedTemplateLiteral(["\n      display: flex;\n      flex: none;\n      align-items: center;\n      justify-content: center;\n\n      width: auto;\n      min-width: 72px;\n      height: 72px;\n\n      font-size: 72px;\n      line-height: 1;\n    "])))
  };
});
var IconPreview = /*#__PURE__*/memo(function (_ref2) {
  var className = _ref2.className,
    children = _ref2.children,
    rest = _objectWithoutProperties(_ref2, _excluded);
  var ref = useRef(null);
  var isString = typeof children === 'string';
  return /*#__PURE__*/_jsxs(Flexbox, _objectSpread(_objectSpread({
    align: 'center',
    className: cx(styles.container, className),
    flex: 'none',
    justify: 'center'
  }, rest), {}, {
    children: [isString ? /*#__PURE__*/_jsx("div", {
      className: styles.inner,
      dangerouslySetInnerHTML: {
        __html: children
      }
    }) : /*#__PURE__*/_jsx("div", {
      className: styles.inner,
      children: children
    }), /*#__PURE__*/_jsx(DownloadButton, {
      className: styles.btn,
      onClick: function onClick() {
        var _ref$current;
        var svgString = String(ref === null || ref === void 0 || (_ref$current = ref.current) === null || _ref$current === void 0 || (_ref$current = _ref$current.querySelector('svg')) === null || _ref$current === void 0 ? void 0 : _ref$current.outerHTML);
        var blob = new Blob([svgString], {
          type: 'image/svg+xml;charset=utf-8'
        });
        var url = URL.createObjectURL(blob);
        var downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = 'icon.svg';
        document.body.append(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        URL.revokeObjectURL(url);
      }
    })]
  }));
});
export default IconPreview;