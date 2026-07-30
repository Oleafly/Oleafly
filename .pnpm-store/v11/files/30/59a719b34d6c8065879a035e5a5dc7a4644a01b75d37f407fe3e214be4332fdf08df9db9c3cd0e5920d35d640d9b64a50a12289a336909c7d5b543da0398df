"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _trigger = _interopRequireDefault(require("@rc-component/trigger"));
var _clsx = require("clsx");
var React = _interopRequireWildcard(require("react"));
var _uiUtil = require("../utils/uiUtil");
var _context = _interopRequireDefault(require("../PickerInput/context"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
const BUILT_IN_PLACEMENTS = {
  bottomLeft: {
    points: ['tl', 'bl'],
    offset: [0, 4],
    overflow: {
      adjustX: 1,
      adjustY: 1
    }
  },
  bottomRight: {
    points: ['tr', 'br'],
    offset: [0, 4],
    overflow: {
      adjustX: 1,
      adjustY: 1
    }
  },
  topLeft: {
    points: ['bl', 'tl'],
    offset: [0, -4],
    overflow: {
      adjustX: 0,
      adjustY: 1
    }
  },
  topRight: {
    points: ['br', 'tr'],
    offset: [0, -4],
    overflow: {
      adjustX: 0,
      adjustY: 1
    }
  }
};
function PickerTrigger({
  popupElement,
  popupStyle,
  popupClassName,
  popupAlign,
  transitionName,
  getPopupContainer,
  children,
  range,
  placement,
  builtinPlacements = BUILT_IN_PLACEMENTS,
  direction,
  // Visible
  visible,
  onClose
}) {
  const {
    prefixCls
  } = React.useContext(_context.default);
  const dropdownPrefixCls = `${prefixCls}-dropdown`;
  const realPlacement = (0, _uiUtil.getRealPlacement)(placement, direction === 'rtl');
  return /*#__PURE__*/React.createElement(_trigger.default, {
    showAction: [],
    hideAction: ['click'],
    popupPlacement: realPlacement,
    builtinPlacements: builtinPlacements,
    prefixCls: dropdownPrefixCls,
    popupMotion: {
      motionName: transitionName
    },
    popup: popupElement,
    popupAlign: popupAlign,
    popupVisible: visible,
    popupClassName: (0, _clsx.clsx)(popupClassName, {
      [`${dropdownPrefixCls}-range`]: range,
      [`${dropdownPrefixCls}-rtl`]: direction === 'rtl'
    }),
    popupStyle: popupStyle,
    stretch: "minWidth",
    getPopupContainer: getPopupContainer,
    onPopupVisibleChange: nextVisible => {
      if (!nextVisible) {
        onClose();
      }
    }
  }, children);
}
var _default = exports.default = PickerTrigger;