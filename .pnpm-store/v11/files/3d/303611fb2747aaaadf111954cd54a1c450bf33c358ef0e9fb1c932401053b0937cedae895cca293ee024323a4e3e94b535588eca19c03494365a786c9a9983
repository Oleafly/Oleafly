"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _react = _interopRequireWildcard(require("react"));
var _util = require("@rc-component/util");
var _clsx = require("clsx");
var _configProvider = require("../../config-provider");
var _reactNode = require("../reactNode");
var _style = _interopRequireDefault(require("./style"));
var _useWave = _interopRequireDefault(require("./useWave"));
const TRIGGER_TYPE_TO_EVENT_MAP = {
  click: 'click',
  mousedown: 'mousedown',
  mouseup: 'mouseup',
  pointerdown: 'pointerdown',
  pointerup: 'pointerup'
};
const Wave = props => {
  const {
    children,
    disabled,
    component,
    colorSource
  } = props;
  const {
    getPrefixCls,
    wave
  } = (0, _react.useContext)(_configProvider.ConfigContext);
  const containerRef = (0, _react.useRef)(null);
  // ============================== Style ===============================
  const prefixCls = getPrefixCls('wave');
  const hashId = (0, _style.default)(prefixCls);
  // =============================== Wave ===============================
  const showWave = (0, _useWave.default)(containerRef, (0, _clsx.clsx)(prefixCls, hashId), component, colorSource);
  // ============================== Effect ==============================
  _react.default.useEffect(() => {
    const node = containerRef.current;
    if (!node || node.nodeType !== window.Node.ELEMENT_NODE || disabled) {
      return;
    }
    const onClick = e => {
      // Fix radio button click twice
      if (!(0, _util.isVisible)(e.target) || !node.getAttribute || node.getAttribute('disabled') || node.disabled || node.className.includes('disabled') && !node.className.includes('disabled:') || node.getAttribute('aria-disabled') === 'true' || node.className.includes('-leave')) {
        return;
      }
      showWave(e);
    };
    const triggerType = wave?.triggerType;
    const eventName = triggerType && triggerType in TRIGGER_TYPE_TO_EVENT_MAP ? TRIGGER_TYPE_TO_EVENT_MAP[triggerType] : 'click';
    node.addEventListener(eventName, onClick, true);
    return () => {
      node.removeEventListener(eventName, onClick, true);
    };
  }, [disabled, wave?.triggerType]);
  // ============================== Render ==============================
  if (! /*#__PURE__*/_react.default.isValidElement(children)) {
    return children ?? null;
  }
  const ref = (0, _util.supportRef)(children) ? (0, _util.composeRef)((0, _util.getNodeRef)(children), containerRef) : containerRef;
  return (0, _reactNode.cloneElement)(children, {
    ref
  });
};
if (process.env.NODE_ENV !== 'production') {
  Wave.displayName = 'Wave';
}
var _default = exports.default = Wave;