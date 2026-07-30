'use client';

var _templateObject;
function _taggedTemplateLiteral(strings, raw) { if (!raw) { raw = strings.slice(0); } return Object.freeze(Object.defineProperties(strings, { raw: { value: Object.freeze(raw) } })); }
import * as Icons from "../..";
import { Flexbox } from '@lobehub/ui';
import { StoryBook, useControls, useCreateStore } from '@lobehub/ui/storybook';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import IconPreview from "../IconPreview";
import { jsx as _jsx } from "react/jsx-runtime";
var data = Object.values(Icons).filter(function (icon) {
  return icon === null || icon === void 0 ? void 0 : icon.colorPrimary;
});
var styles = createStaticStyles(function (_ref) {
  var css = _ref.css,
    cssVar = _ref.cssVar;
  return {
    item: css(_templateObject || (_templateObject = _taggedTemplateLiteral(["\n    height: 96px;\n    padding: 16px;\n    border: none;\n    background: ", ";\n  "])), cssVar.colorBgContainer)
  };
});
var Dashboard = /*#__PURE__*/memo(function (_ref2) {
  var className = _ref2.className;
  var store = useCreateStore();
  var _useControls = useControls({
      color: {
        color: true,
        value: '#ffffff'
      },
      size: {
        max: 96,
        min: 16,
        step: 1,
        value: 24
      }
    }, {
      store: store
    }),
    size = _useControls.size,
    color = _useControls.color;
  return /*#__PURE__*/_jsx(StoryBook, {
    className: className,
    levaStore: store,
    children: /*#__PURE__*/_jsx(Flexbox, {
      align: 'center',
      gap: 4,
      horizontal: true,
      justify: 'center',
      style: {
        flexWrap: 'wrap'
      },
      children: data.map(function (Icon, index) {
        var IconRender = Icon.Text || Icon.Brand;
        if (!IconRender) return null;
        return /*#__PURE__*/_jsx(IconPreview, {
          className: styles.item,
          children: /*#__PURE__*/_jsx(IconRender, {
            color: color === '#ffffff' ? undefined : color,
            size: size
          })
        }, index);
      })
    })
  });
});
export default Dashboard;