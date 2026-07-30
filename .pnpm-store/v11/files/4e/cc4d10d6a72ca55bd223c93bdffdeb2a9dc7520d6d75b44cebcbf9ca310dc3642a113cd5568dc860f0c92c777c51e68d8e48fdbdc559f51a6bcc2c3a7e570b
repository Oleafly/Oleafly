'use client';

var _templateObject, _templateObject2;
function _taggedTemplateLiteral(strings, raw) { if (!raw) { raw = strings.slice(0); } return Object.freeze(Object.defineProperties(strings, { raw: { value: Object.freeze(raw) } })); }
import { CopyButton, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { jsx as _jsx } from "react/jsx-runtime";
import { jsxs as _jsxs } from "react/jsx-runtime";
var styles = createStaticStyles(function (_ref) {
  var css = _ref.css,
    cssVar = _ref.cssVar;
  return {
    btn: cx('copy-button', css(_templateObject || (_templateObject = _taggedTemplateLiteral(["\n        position: absolute;\n        inset-block-start: 4px;\n        inset-inline-end: 4px;\n        opacity: 0;\n      "])))),
    container: css(_templateObject2 || (_templateObject2 = _taggedTemplateLiteral(["\n      position: relative;\n\n      flex: none;\n\n      width: 98px;\n      height: 98px;\n      border: 1px solid ", ";\n      border-radius: ", ";\n\n      font-family: ", ";\n      line-height: 1;\n\n      background: ", ";\n\n      &:hover {\n        .copy-button {\n          opacity: 1;\n        }\n      }\n    "])), cssVar.colorBorder, cssVar.borderRadius, cssVar.fontFamilyCode, cssVar.colorBgContainer)
  };
});
var IconPreview = /*#__PURE__*/memo(function (_ref2) {
  var color = _ref2.color;
  return /*#__PURE__*/_jsxs(Flexbox, {
    align: 'center',
    className: styles.container,
    justify: 'center',
    style: {
      background: color
    },
    children: [/*#__PURE__*/_jsx("div", {
      style: {
        color: '#fff'
      },
      children: color
    }), /*#__PURE__*/_jsx(CopyButton, {
      className: styles.btn,
      content: color
    })]
  });
});
export default IconPreview;