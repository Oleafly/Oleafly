'use client';

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var _excluded = ["className", "initialMode", "labels", "mode", "onModeChange", "sections"];
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
function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }
function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }
import { Block, Flexbox, Icon, Segmented, Snippet, Text } from '@lobehub/ui';
import { BotIcon, UserRoundIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { jsx as _jsx } from "react/jsx-runtime";
import { jsxs as _jsxs } from "react/jsx-runtime";
var AgentGuideCard = /*#__PURE__*/memo(function (_ref) {
  var className = _ref.className,
    _ref$initialMode = _ref.initialMode,
    initialMode = _ref$initialMode === void 0 ? 'agent' : _ref$initialMode,
    labels = _ref.labels,
    mode = _ref.mode,
    onModeChange = _ref.onModeChange,
    sections = _ref.sections,
    rest = _objectWithoutProperties(_ref, _excluded);
  var _useState = useState(initialMode),
    _useState2 = _slicedToArray(_useState, 2),
    innerMode = _useState2[0],
    setInnerMode = _useState2[1];
  var currentMode = mode !== null && mode !== void 0 ? mode : innerMode;
  var handleModeChange = function handleModeChange(value) {
    if (!mode) setInnerMode(value);
    onModeChange === null || onModeChange === void 0 || onModeChange(value);
  };
  var content = useMemo(function () {
    return sections[currentMode];
  }, [currentMode, sections]);
  return /*#__PURE__*/_jsxs(Block, _objectSpread(_objectSpread({
    className: className,
    flex: 'none',
    shadow: true,
    style: {
      maxWidth: 960
    },
    variant: 'outlined',
    width: '100%'
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx(Flexbox, {
      flex: 1,
      padding: 8,
      children: /*#__PURE__*/_jsx(Segmented, {
        block: true,
        onChange: function onChange(value) {
          return handleModeChange(value);
        },
        options: [{
          icon: /*#__PURE__*/_jsx(Icon, {
            icon: BotIcon
          }),
          label: labels.agent,
          value: 'agent'
        }, {
          icon: /*#__PURE__*/_jsx(Icon, {
            icon: UserRoundIcon
          }),
          label: labels.human,
          value: 'human'
        }],
        value: currentMode,
        variant: 'filled'
      })
    }), /*#__PURE__*/_jsxs(Flexbox, {
      gap: 8,
      paddingBlock: '8px 16px',
      paddingInline: 16,
      children: [/*#__PURE__*/_jsx(Text, {
        align: 'center',
        weight: 500,
        children: content.description
      }), content.linkHref && content.linkLabel && /*#__PURE__*/_jsx(Flexbox, {
        align: 'center',
        children: /*#__PURE__*/_jsx("a", {
          href: content.linkHref,
          rel: 'noreferrer',
          style: {
            fontSize: 13
          },
          target: '_blank',
          children: content.linkLabel
        })
      }), /*#__PURE__*/_jsx(Snippet, {
        language: content.commandLanguage || 'shell',
        style: {
          fontSize: 12,
          width: '100%'
        },
        children: content.command
      })]
    })]
  }));
});
export default AgentGuideCard;