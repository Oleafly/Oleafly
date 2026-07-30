'use client';

var _templateObject, _templateObject2;
function _taggedTemplateLiteral(strings, raw) { if (!raw) { raw = strings.slice(0); } return Object.freeze(Object.defineProperties(strings, { raw: { value: Object.freeze(raw) } })); }
import { CopyButton, Flexbox, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { jsx as _jsx } from "react/jsx-runtime";
var styles = createStaticStyles(function (_ref) {
  var css = _ref.css,
    cssVar = _ref.cssVar;
  return {
    btn: cx('copy-button', css(_templateObject || (_templateObject = _taggedTemplateLiteral(["\n        position: absolute;\n        opacity: 0;\n      "])))),
    container: css(_templateObject2 || (_templateObject2 = _taggedTemplateLiteral(["\n      position: relative;\n\n      flex: none;\n\n      width: 98px;\n      height: 98px;\n      border: 1px solid ", ";\n      border-radius: ", ";\n\n      background: ", ";\n\n      &:hover {\n        .copy-button {\n          opacity: 1;\n        }\n      }\n    "])), cssVar.colorBorder, cssVar.borderRadius, cssVar.colorBgContainer)
  };
});
var IconPreview = /*#__PURE__*/memo(function (_ref2) {
  var color = _ref2.color;
  return /*#__PURE__*/_jsx(Tooltip, {
    title: color,
    children: /*#__PURE__*/_jsx(Flexbox, {
      align: 'center',
      className: styles.container,
      justify: 'center',
      style: {
        background: color
      },
      children: /*#__PURE__*/_jsx(CopyButton, {
        className: styles.btn,
        content: color
      })
    })
  });
});
export default IconPreview;