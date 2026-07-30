"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useClosable = exports.pickClosable = exports.computeClosable = void 0;
var _react = _interopRequireDefault(require("react"));
var _CloseOutlined = _interopRequireDefault(require("@ant-design/icons/CloseOutlined"));
var _util = require("@rc-component/util");
var _locale = require("../../locale");
var _en_US = _interopRequireDefault(require("../../locale/en_US"));
var _is = require("../is");
const pickClosable = context => {
  if (!context) {
    return undefined;
  }
  const {
    closable,
    closeIcon
  } = context;
  return {
    closable,
    closeIcon
  };
};
exports.pickClosable = pickClosable;
const EmptyFallbackCloseCollection = {};
const computeClosableConfig = (closable, closeIcon) => {
  if (!closable && (closable === false || closeIcon === false || closeIcon === null)) {
    return false;
  }
  if (!(0, _is.isNonNullable)(closable) && !(0, _is.isNonNullable)(closeIcon)) {
    return null;
  }
  let closableConfig = {
    closeIcon: typeof closeIcon !== 'boolean' && (0, _is.isNonNullable)(closeIcon) ? closeIcon : undefined
  };
  if ((0, _is.isPlainObject)(closable)) {
    closableConfig = {
      ...closableConfig,
      ...closable
    };
  }
  return closableConfig;
};
const mergeClosableConfigs = (propConfig, contextConfig, fallbackConfig) => {
  if (propConfig === false) {
    return false;
  }
  if (propConfig) {
    return (0, _util.mergeProps)(fallbackConfig, contextConfig, propConfig);
  }
  if (contextConfig === false) {
    return false;
  }
  if (contextConfig) {
    return (0, _util.mergeProps)(fallbackConfig, contextConfig);
  }
  return fallbackConfig.closable ? fallbackConfig : false;
};
const computeCloseIcon = (mergedConfig, fallbackCloseCollection, closeLabel) => {
  const {
    closeIconRender
  } = fallbackCloseCollection;
  const {
    closeIcon,
    ...restConfig
  } = mergedConfig;
  let finalCloseIcon = closeIcon;
  const ariaOrDataProps = (0, _util.pickAttrs)(restConfig, true);
  if ((0, _is.isNonNullable)(finalCloseIcon)) {
    if (closeIconRender) {
      finalCloseIcon = closeIconRender(finalCloseIcon);
    }
    finalCloseIcon = /*#__PURE__*/_react.default.isValidElement(finalCloseIcon) ? (/*#__PURE__*/_react.default.cloneElement(finalCloseIcon, {
      'aria-label': closeLabel,
      ...finalCloseIcon.props,
      ...ariaOrDataProps
    })) : (/*#__PURE__*/_react.default.createElement("span", {
      "aria-label": closeLabel,
      ...ariaOrDataProps
    }, finalCloseIcon));
  }
  return [finalCloseIcon, ariaOrDataProps];
};
const computeClosable = (propCloseCollection, contextCloseCollection, fallbackCloseCollection = EmptyFallbackCloseCollection, closeLabel = 'Close') => {
  const propConfig = computeClosableConfig(propCloseCollection?.closable, propCloseCollection?.closeIcon);
  const contextConfig = computeClosableConfig(contextCloseCollection?.closable, contextCloseCollection?.closeIcon);
  const mergedFallback = {
    closeIcon: /*#__PURE__*/_react.default.createElement(_CloseOutlined.default, null),
    ...fallbackCloseCollection
  };
  const mergedConfig = mergeClosableConfigs(propConfig, contextConfig, mergedFallback);
  const closeBtnIsDisabled = typeof mergedConfig !== 'boolean' ? !!mergedConfig?.disabled : false;
  if (mergedConfig === false) {
    return [false, null, closeBtnIsDisabled, {}];
  }
  const [closeIcon, ariaProps] = computeCloseIcon(mergedConfig, mergedFallback, closeLabel);
  return [true, closeIcon, closeBtnIsDisabled, ariaProps];
};
exports.computeClosable = computeClosable;
const useClosable = (propCloseCollection, contextCloseCollection, fallbackCloseCollection = EmptyFallbackCloseCollection) => {
  const [contextLocale] = (0, _locale.useLocale)('global', _en_US.default.global);
  return _react.default.useMemo(() => {
    return computeClosable(propCloseCollection, contextCloseCollection, {
      closeIcon: /*#__PURE__*/_react.default.createElement(_CloseOutlined.default, null),
      ...fallbackCloseCollection
    }, contextLocale.close);
  }, [propCloseCollection, contextCloseCollection, fallbackCloseCollection, contextLocale.close]);
};
exports.useClosable = useClosable;