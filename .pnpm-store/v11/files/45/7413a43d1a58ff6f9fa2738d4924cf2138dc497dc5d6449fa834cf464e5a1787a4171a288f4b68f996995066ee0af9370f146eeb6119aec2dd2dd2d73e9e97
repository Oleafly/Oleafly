"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _clsx = require("clsx");
var _throttleDebounce = require("throttle-debounce");
var _useMergeSemantic = require("../_util/hooks/useMergeSemantic");
var _warning = require("../_util/warning");
var _context = require("../config-provider/context");
var _useSize = _interopRequireDefault(require("../config-provider/hooks/useSize"));
var _Indicator = _interopRequireDefault(require("./Indicator"));
var _index = _interopRequireDefault(require("./style/index"));
var _usePercent = _interopRequireDefault(require("./usePercent"));
// Render indicator
let defaultIndicator;
function shouldDelay(spinning, delay) {
  return !!spinning && !!delay && !Number.isNaN(Number(delay));
}
const Spin = props => {
  const {
    prefixCls: customizePrefixCls,
    spinning: customSpinning = true,
    delay = 0,
    className,
    rootClassName,
    size,
    tip,
    description,
    wrapperClassName,
    style,
    children,
    fullscreen = false,
    indicator,
    percent,
    classNames,
    styles,
    ...restProps
  } = props;
  const {
    getPrefixCls,
    direction,
    indicator: contextIndicator,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles
  } = (0, _context.useComponentConfig)('spin');
  const prefixCls = getPrefixCls('spin', customizePrefixCls);
  const [hashId, cssVarCls] = (0, _index.default)(prefixCls);
  const [spinning, setSpinning] = React.useState(() => customSpinning && !shouldDelay(customSpinning, delay));
  const mergedPercent = (0, _usePercent.default)(spinning, percent);
  React.useEffect(() => {
    if (customSpinning) {
      const showSpinning = (0, _throttleDebounce.debounce)(delay, () => {
        setSpinning(true);
      });
      showSpinning();
      return () => {
        showSpinning?.cancel?.();
      };
    }
    setSpinning(false);
  }, [delay, customSpinning]);
  // ======================= Size ======================
  const mergedSize = (0, _useSize.default)(ctx => size ?? ctx);
  // ======================= Description ======================
  const mergedDescription = description ?? tip;
  // =============== Merged Props for Semantic ================
  const mergedProps = {
    ...props,
    size: mergedSize,
    spinning,
    tip: mergedDescription,
    description: mergedDescription,
    fullscreen,
    children,
    percent: mergedPercent
  };
  // ========================= Style ==========================
  const [mergedClassNames, mergedStyles] = (0, _useMergeSemantic.useMergeSemantic)([contextClassNames, classNames], [contextStyles, styles], {
    props: mergedProps
  });
  // ======================== Warning =========================
  if (process.env.NODE_ENV !== 'production') {
    const warning = (0, _warning.devUseWarning)('Spin');
    warning.deprecated(size !== 'default', 'size="default"', 'size="medium"');
    warning.deprecated(!tip, 'tip', 'description');
    warning.deprecated(!wrapperClassName, 'wrapperClassName', 'classNames.root');
    warning.deprecated(!(mergedClassNames?.tip || mergedStyles?.tip), 'classNames.tip and styles.tip', 'classNames.description and styles.description');
    warning.deprecated(!(mergedClassNames?.mask || mergedStyles?.mask), 'classNames.mask and styles.mask', 'classNames.root and styles.root');
  }
  // ======================= Indicator ========================
  const mergedIndicator = indicator ?? contextIndicator ?? defaultIndicator;
  // ========================= Render =========================
  const hasChildren = typeof children !== 'undefined';
  const isNested = hasChildren || fullscreen;
  const indicatorNode = /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(_Indicator.default, {
    className: (0, _clsx.clsx)(mergedClassNames.indicator),
    style: mergedStyles.indicator,
    prefixCls: prefixCls,
    indicator: mergedIndicator,
    percent: mergedPercent
  }), mergedDescription && (/*#__PURE__*/React.createElement("div", {
    className: (0, _clsx.clsx)(`${prefixCls}-description`, mergedClassNames.tip, mergedClassNames.description),
    style: {
      ...mergedStyles.tip,
      ...mergedStyles.description
    }
  }, mergedDescription)));
  return /*#__PURE__*/React.createElement("div", {
    className: (0, _clsx.clsx)(prefixCls, {
      [`${prefixCls}-sm`]: mergedSize === 'small',
      [`${prefixCls}-lg`]: mergedSize === 'large',
      [`${prefixCls}-spinning`]: spinning,
      [`${prefixCls}-rtl`]: direction === 'rtl',
      [`${prefixCls}-fullscreen`]: fullscreen
    }, rootClassName, mergedClassNames.root, fullscreen && mergedClassNames.mask, isNested ? wrapperClassName : [`${prefixCls}-section`, mergedClassNames.section], contextClassName, className, hashId, cssVarCls),
    style: {
      ...mergedStyles.root,
      ...(!isNested ? mergedStyles.section : {}),
      ...(fullscreen ? mergedStyles.mask : {}),
      ...contextStyle,
      ...style
    },
    "aria-live": "polite",
    "aria-busy": spinning,
    ...restProps
  }, spinning && (isNested ? (/*#__PURE__*/React.createElement("div", {
    className: (0, _clsx.clsx)(`${prefixCls}-section`, mergedClassNames.section),
    style: mergedStyles.section
  }, indicatorNode)) : indicatorNode), hasChildren && (/*#__PURE__*/React.createElement("div", {
    className: (0, _clsx.clsx)(`${prefixCls}-container`, mergedClassNames.container),
    style: mergedStyles.container
  }, children)));
};
Spin.setDefaultIndicator = indicator => {
  defaultIndicator = indicator;
};
if (process.env.NODE_ENV !== 'production') {
  Spin.displayName = 'Spin';
}
var _default = exports.default = Spin;