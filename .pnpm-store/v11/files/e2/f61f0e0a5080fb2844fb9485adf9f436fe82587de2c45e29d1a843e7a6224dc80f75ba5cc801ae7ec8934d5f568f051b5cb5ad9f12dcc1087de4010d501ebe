'use client';

var _templateObject, _templateObject2, _templateObject3, _templateObject4, _templateObject5, _templateObject6, _templateObject7;
function _taggedTemplateLiteral(strings, raw) { if (!raw) { raw = strings.slice(0); } return Object.freeze(Object.defineProperties(strings, { raw: { value: Object.freeze(raw) } })); }
import { ActionIcon, Block, Center, CopyButton, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { DownloadIcon, SearchIcon } from 'lucide-react';
import { readableColor } from 'polished';
import { memo, useCallback, useRef } from 'react';
import { Link } from 'react-router';
import { customKebabCase, docsKebabCase } from "./utils";
import { jsx as _jsx } from "react/jsx-runtime";
import { jsxs as _jsxs } from "react/jsx-runtime";
var styles = createStaticStyles(function (_ref) {
  var css = _ref.css,
    cssVar = _ref.cssVar;
  var colorText = cx('color-text', css(_templateObject || (_templateObject = _taggedTemplateLiteral(["\n      display: block;\n    "]))));
  var copy = cx('copy', css(_templateObject2 || (_templateObject2 = _taggedTemplateLiteral(["\n      z-index: 1;\n      display: none !important;\n    "]))));
  return {
    card: css(_templateObject3 || (_templateObject3 = _taggedTemplateLiteral(["\n      position: relative;\n      overflow: hidden;\n    "]))),
    color: css(_templateObject4 || (_templateObject4 = _taggedTemplateLiteral(["\n      border-inline-end: 1px solid ", ";\n      font-family: ", ";\n\n      &:hover {\n        .color-text {\n          display: none;\n        }\n\n        .copy {\n          display: flex !important;\n        }\n      }\n    "])), cssVar.colorBorderSecondary, cssVar.fontFamilyCode),
    colorText: colorText,
    copy: copy,
    row: css(_templateObject5 || (_templateObject5 = _taggedTemplateLiteral(["\n      border-block-start: 1px solid ", ";\n    "])), cssVar.colorFillSecondary),
    title: css(_templateObject6 || (_templateObject6 = _taggedTemplateLiteral(["\n      margin: 0;\n      font-size: 16px;\n      font-weight: bold;\n    "]))),
    titleRow: css(_templateObject7 || (_templateObject7 = _taggedTemplateLiteral(["\n      margin-block-start: -8px;\n\n      &:hover {\n        .copy {\n          display: flex;\n        }\n      }\n    "])))
  };
});
var IconItem = /*#__PURE__*/memo(function (_ref2) {
  var children = _ref2.children,
    title = _ref2.title,
    color = _ref2.color,
    id = _ref2.id;
  var ref = useRef(null);
  var handleDownload = useCallback(function (iconId) {
    var _ref$current;
    var svgString = String(ref === null || ref === void 0 || (_ref$current = ref.current) === null || _ref$current === void 0 || (_ref$current = _ref$current.querySelector('svg')) === null || _ref$current === void 0 ? void 0 : _ref$current.outerHTML);
    var blob = new Blob([svgString], {
      type: 'image/svg+xml;charset=utf-8'
    });
    var url = URL.createObjectURL(blob);
    var downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = "".concat(iconId.toLowerCase(), ".svg");
    document.body.append(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    URL.revokeObjectURL(url);
  }, []);
  return /*#__PURE__*/_jsxs(Block, {
    className: styles.card,
    variant: 'outlined',
    children: [/*#__PURE__*/_jsx(Link, {
      style: {
        color: 'inherit'
      },
      to: "/components/".concat(docsKebabCase(id)),
      children: /*#__PURE__*/_jsx(Center, {
        height: 96,
        ref: ref,
        style: {
          position: 'relative'
        },
        width: '100%',
        children: children
      })
    }), /*#__PURE__*/_jsxs(Flexbox, {
      align: 'center',
      className: styles.titleRow,
      horizontal: true,
      justify: 'space-between',
      paddingBlock: 8,
      paddingInline: 12,
      width: '100%',
      children: [/*#__PURE__*/_jsx(Text, {
        as: 'h2',
        className: styles.title,
        ellipsis: true,
        children: title
      }), /*#__PURE__*/_jsx(CopyButton, {
        content: title,
        size: 'small'
      })]
    }), /*#__PURE__*/_jsxs(Flexbox, {
      align: 'center',
      className: styles.row,
      horizontal: true,
      children: [/*#__PURE__*/_jsxs(Center, {
        className: styles.color,
        flex: 1,
        height: 32,
        horizontal: true,
        paddingInline: 12,
        style: {
          background: color,
          color: readableColor(color)
        },
        children: [/*#__PURE__*/_jsx("span", {
          className: styles.colorText,
          children: color.toUpperCase()
        }), /*#__PURE__*/_jsx(CopyButton, {
          className: styles.copy,
          color: readableColor(color),
          content: color.toUpperCase(),
          size: 'small'
        })]
      }), /*#__PURE__*/_jsxs(Flexbox, {
        flex: 1,
        horizontal: true,
        paddingInline: 12,
        children: [/*#__PURE__*/_jsx(Center, {
          flex: 1,
          height: 32,
          children: /*#__PURE__*/_jsx("a", {
            href: "https://lobehub.com/icons/".concat(customKebabCase(id)),
            rel: "noreferrer",
            style: {
              color: 'inherit'
            },
            target: '_blank',
            children: /*#__PURE__*/_jsx(ActionIcon, {
              icon: SearchIcon,
              size: 'small'
            })
          })
        }), /*#__PURE__*/_jsx(Center, {
          flex: 1,
          height: 32,
          onClick: function onClick() {
            return handleDownload(id);
          },
          children: /*#__PURE__*/_jsx(ActionIcon, {
            icon: DownloadIcon,
            size: 'small'
          })
        })]
      })]
    })]
  });
});
export default IconItem;