"use strict";
"use client";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _toConsumableArray2 = _interopRequireDefault(require("@babel/runtime/helpers/toConsumableArray"));
var _react = _interopRequireWildcard(require("react"));
var _util = require("@rc-component/util");
var _clsx = require("clsx");
var _useMergeSemantic = require("../_util/hooks/useMergeSemantic");
var _is = require("../_util/is");
var _context = require("../config-provider/context");
var _useCSSVarCls = _interopRequireDefault(require("../config-provider/hooks/useCSSVarCls"));
var _CheckableTag = _interopRequireDefault(require("./CheckableTag"));
var _style = _interopRequireDefault(require("./style"));
const CheckableTagGroup = /*#__PURE__*/_react.default.forwardRef((props, ref) => {
  const {
    id,
    prefixCls: customizePrefixCls,
    rootClassName,
    className,
    style,
    classNames,
    styles,
    disabled,
    options,
    value,
    defaultValue,
    onChange,
    multiple,
    ...restProps
  } = props;
  const {
    getPrefixCls,
    direction,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles
  } = (0, _context.useComponentConfig)('tag');
  const prefixCls = getPrefixCls('tag', customizePrefixCls);
  const groupPrefixCls = `${prefixCls}-checkable-group`;
  const rootCls = (0, _useCSSVarCls.default)(prefixCls);
  const [hashId, cssVarCls] = (0, _style.default)(prefixCls, rootCls);
  // ====================== Styles ======================
  const contextStyleRoot = (0, _useMergeSemantic.useSemanticRootStyle)(contextStyle);
  const styleRoot = (0, _useMergeSemantic.useSemanticRootStyle)(style);
  const [mergedClassNames, mergedStyles] = (0, _useMergeSemantic.useMergeSemantic)([contextClassNames, classNames], [contextStyles, contextStyleRoot, styles, styleRoot], {
    props
  });
  // =============================== Option ===============================
  const parsedOptions = (0, _react.useMemo)(() => {
    if (!Array.isArray(options)) {
      return [];
    }
    return options.map(option => {
      if ((0, _is.isPlainObject)(option)) {
        return option;
      }
      return {
        value: option,
        label: option
      };
    });
  }, [options]);
  // =============================== Values ===============================
  const [mergedValue, setMergedValue] = (0, _util.useControlledState)(defaultValue, value);
  const handleChange = (checked, option) => {
    let newValue = null;
    if (multiple) {
      const valueList = mergedValue || [];
      newValue = checked ? [].concat((0, _toConsumableArray2.default)(valueList), [option.value]) : valueList.filter(item => item !== option.value);
    } else {
      newValue = checked ? option.value : null;
    }
    setMergedValue(newValue);
    onChange?.(newValue); // TS not support generic type in function call
  };
  // ================================ Refs ================================
  const divRef = _react.default.useRef(null);
  (0, _react.useImperativeHandle)(ref, () => ({
    nativeElement: divRef.current
  }));
  // ================================ ARIA ================================
  const ariaProps = (0, _util.pickAttrs)(restProps, {
    aria: true,
    data: true
  });
  // =============================== Render ===============================
  return /*#__PURE__*/_react.default.createElement("div", {
    ...ariaProps,
    className: (0, _clsx.clsx)(groupPrefixCls, contextClassName, rootClassName, {
      [`${groupPrefixCls}-disabled`]: disabled,
      [`${groupPrefixCls}-rtl`]: direction === 'rtl'
    }, hashId, cssVarCls, className, mergedClassNames.root),
    style: mergedStyles.root,
    id: id,
    ref: divRef
  }, parsedOptions.map(option => (/*#__PURE__*/_react.default.createElement(_CheckableTag.default, {
    key: option.value,
    className: (0, _clsx.clsx)(`${groupPrefixCls}-item`, mergedClassNames.item, option.className),
    style: {
      ...mergedStyles.item,
      ...option.style
    },
    checked: multiple ? (mergedValue || []).includes(option.value) : mergedValue === option.value,
    onChange: checked => handleChange(checked, option),
    disabled: disabled
  }, option.label))));
});
if (process.env.NODE_ENV !== 'production') {
  CheckableTagGroup.displayName = 'CheckableTagGroup';
}
var _default = exports.default = CheckableTagGroup;