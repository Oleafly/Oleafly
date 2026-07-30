'use client';

function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }
import * as Icons from "../..";
import { Flexbox, Grid, SearchBar, TooltipGroup } from '@lobehub/ui';
import { Empty, Segmented } from 'antd';
import { cssVar } from 'antd-style';
import { memo, useMemo, useState } from 'react';
import IconItem from "./IconItem";
import { jsx as _jsx } from "react/jsx-runtime";
import { jsxs as _jsxs } from "react/jsx-runtime";
var ColorType = /*#__PURE__*/function (ColorType) {
  ColorType["Color"] = "color";
  ColorType["Mono"] = "mono";
  return ColorType;
}(ColorType || {});
var Dashboard = /*#__PURE__*/memo(function () {
  var _useState = useState(ColorType.Color),
    _useState2 = _slicedToArray(_useState, 2),
    type = _useState2[0],
    setType = _useState2[1];
  var _useState3 = useState(),
    _useState4 = _slicedToArray(_useState3, 2),
    keyword = _useState4[0],
    setKeyword = _useState4[1];
  var iconsGroup = useMemo(function () {
    return Object.entries(Icons).filter(function (_ref) {
      var _ref2 = _slicedToArray(_ref, 2),
        key = _ref2[0],
        Icon = _ref2[1];
      if (!Icon.title) return false;
      if (keyword && !key.toLowerCase().includes(keyword.toLowerCase()) && !Icon.title.toLowerCase().includes(keyword.toLowerCase())) return false;
      return true;
    });
  }, [keyword]);
  var isMono = type === ColorType.Mono;
  return /*#__PURE__*/_jsxs(Flexbox, {
    gap: 16,
    style: {
      maxWidth: 960
    },
    width: '100%',
    children: [/*#__PURE__*/_jsxs(Flexbox, {
      align: 'center',
      gap: 12,
      horizontal: true,
      children: [/*#__PURE__*/_jsx(SearchBar, {
        allowClear: true,
        defaultValue: keyword,
        onSearch: function onSearch(v) {
          return setKeyword(v);
        },
        placeholder: 'Search by brand or model keywords...',
        style: {
          width: '100%'
        },
        type: 'block'
      }), /*#__PURE__*/_jsx(Segmented, {
        defaultValue: type,
        onChange: function onChange(v) {
          return setType(v);
        },
        options: [{
          label: 'Color',
          value: ColorType.Color
        }, {
          label: 'Mono',
          value: ColorType.Mono
        }],
        style: {
          border: "1px solid ".concat(cssVar.colorBorder)
        }
      })]
    }), /*#__PURE__*/_jsx(TooltipGroup, {
      children: iconsGroup.length > 0 ? /*#__PURE__*/_jsx(Grid, {
        maxItemWidth: 160,
        rows: 5,
        children: iconsGroup.map(function (_ref3) {
          var _ref4 = _slicedToArray(_ref3, 2),
            key = _ref4[0],
            Icon = _ref4[1];
          var IconRender = isMono ? Icon : Icon.Color || Icon;
          return /*#__PURE__*/_jsx(IconItem, {
            color: Icon.colorPrimary,
            id: key,
            title: Icon.title,
            children: /*#__PURE__*/_jsx(IconRender, {
              size: 56
            })
          }, key);
        })
      }) : /*#__PURE__*/_jsx(Empty, {
        image: Empty.PRESENTED_IMAGE_SIMPLE
      })
    })]
  });
});
export default Dashboard;