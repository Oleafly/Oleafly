function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var _templateObject;
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : String(i); }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }
function _taggedTemplateLiteral(strings, raw) { if (!raw) { raw = strings.slice(0); } return Object.freeze(Object.defineProperties(strings, { raw: { value: Object.freeze(raw) } })); }
import { Flexbox } from '@lobehub/ui';
import { StoryBook, useControls, useCreateStore } from '@lobehub/ui/storybook';
import { createStaticStyles } from 'antd-style';
import { useEffect, useRef, useState } from 'react';
import { useSvgo } from "./useSvgo";
import Color from "./Color";
import Mono from "./Mono";
import Preview from "./Preview";
import Text from "./Text";
import { svgIcon } from "./data";
import { defaultPlugins } from "./svgo";
import { jsx as _jsx } from "react/jsx-runtime";
import { jsxs as _jsxs } from "react/jsx-runtime";
var styles = createStaticStyles(function (_ref) {
  var css = _ref.css,
    cssVar = _ref.cssVar;
  return {
    container: css(_templateObject || (_templateObject = _taggedTemplateLiteral(["\n      border: 1px solid ", ";\n      border-radius: ", ";\n    "])), cssVar.colorBorder, cssVar.borderRadius)
  };
});
export default (function () {
  var colorRef = useRef(null);
  var monoRef = useRef(null);
  var _useState = useState('0 0 24 24'),
    _useState2 = _slicedToArray(_useState, 2),
    viewbox = _useState2[0],
    setViewbox = _useState2[1];
  var _useState3 = useState(''),
    _useState4 = _slicedToArray(_useState3, 2),
    colorSvg = _useState4[0],
    setColorSvg = _useState4[1];
  var _useState5 = useState(''),
    _useState6 = _slicedToArray(_useState5, 2),
    monoSvg = _useState6[0],
    setMonoSvg = _useState6[1];
  var levaStore = useCreateStore();
  var _useControls = useControls({
      svg: {
        rows: true,
        value: svgIcon
      },
      text: false
    }, {
      store: levaStore
    }),
    svg = _useControls.svg,
    text = _useControls.text;
  var config = useControls('Config', defaultPlugins, {
    collapsed: true
  }, {
    store: levaStore
  });
  var removeColor = {
    addAttributesToSVGElement: {
      attribute: {
        'fill': 'currentColor',
        'fill-rule': 'evenodd'
      }
    },
    collapseGroups: true,
    removeAttrs: {
      attrs: ['fill', 'color', 'stroke', 'stroke-width', 'fill-rule']
    }
  };
  var compression = useSvgo(svg, config);
  var mono = useSvgo(svg, _objectSpread(_objectSpread({}, config), removeColor));
  useEffect(function () {
    var _monoRef$current;
    if (mono.isLoading) return setMonoSvg('loading...');
    setMonoSvg((monoRef === null || monoRef === void 0 || (_monoRef$current = monoRef.current) === null || _monoRef$current === void 0 || (_monoRef$current = _monoRef$current.querySelector('svg')) === null || _monoRef$current === void 0 ? void 0 : _monoRef$current.innerHTML) || '');
  }, [mono]);
  useEffect(function () {
    var _colorRef$current, _colorRef$current2;
    if (compression.isLoading) return setColorSvg('loading...');
    setColorSvg((colorRef === null || colorRef === void 0 || (_colorRef$current = colorRef.current) === null || _colorRef$current === void 0 || (_colorRef$current = _colorRef$current.querySelector('svg')) === null || _colorRef$current === void 0 ? void 0 : _colorRef$current.innerHTML) || '');
    var viewBox = colorRef === null || colorRef === void 0 || (_colorRef$current2 = colorRef.current) === null || _colorRef$current2 === void 0 || (_colorRef$current2 = _colorRef$current2.querySelector('svg')) === null || _colorRef$current2 === void 0 ? void 0 : _colorRef$current2.viewBox.baseVal;
    if (viewBox) {
      setViewbox("".concat(viewBox.x, " ").concat(viewBox.y, " ").concat(viewBox.width, " ").concat(viewBox.height));
    }
  }, [compression]);
  return /*#__PURE__*/_jsx(StoryBook, {
    className: styles.container,
    levaStore: levaStore,
    style: {
      position: 'relative'
    },
    children: /*#__PURE__*/_jsxs(Flexbox, {
      gap: 32,
      style: {
        overflow: 'hidden',
        width: '100%'
      },
      children: [/*#__PURE__*/_jsx(Preview, {
        svg: svg,
        title: 'Original'
      }), /*#__PURE__*/_jsx(Preview, {
        precent: compression.precent,
        ref: colorRef,
        svg: compression.svg,
        title: 'Compression'
      }), /*#__PURE__*/_jsx(Preview, {
        precent: mono.precent,
        ref: monoRef,
        svg: mono.svg,
        title: 'Monochrome'
      }), text ? /*#__PURE__*/_jsx(Text, {
        svg: monoSvg,
        title: 'Text',
        viewbox: viewbox
      }) : /*#__PURE__*/_jsx(Mono, {
        svg: monoSvg,
        title: 'Mono',
        viewbox: viewbox
      }), /*#__PURE__*/_jsx(Color, {
        svg: colorSvg,
        textMode: text,
        title: 'Color',
        viewbox: viewbox
      })]
    })
  });
});