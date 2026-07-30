"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _util = require("@rc-component/util");
var _clsx = require("clsx");
var _useMergeSemantic = require("../_util/hooks/useMergeSemantic");
var _is = require("../_util/is");
var _warning = require("../_util/warning");
var _context = require("../config-provider/context");
var _skeleton = _interopRequireDefault(require("../skeleton"));
var _Number = _interopRequireDefault(require("./Number"));
var _style = _interopRequireDefault(require("./style"));
const Statistic = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    prefixCls: customizePrefixCls,
    className,
    rootClassName,
    style,
    valueStyle,
    value = 0,
    title,
    valueRender,
    prefix,
    suffix,
    loading = false,
    /* --- FormatConfig starts --- */
    formatter,
    precision,
    decimalSeparator = '.',
    groupSeparator = ',',
    /* --- FormatConfig starts --- */
    onMouseEnter,
    onMouseLeave,
    styles,
    classNames,
    ...rest
  } = props;
  const {
    getPrefixCls,
    direction,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles
  } = (0, _context.useComponentConfig)('statistic');
  const prefixCls = getPrefixCls('statistic', customizePrefixCls);
  const [hashId, cssVarCls] = (0, _style.default)(prefixCls);
  const mergedProps = {
    ...props,
    decimalSeparator,
    groupSeparator,
    loading,
    value
  };
  const contextStyleRoot = (0, _useMergeSemantic.useSemanticRootStyle)(contextStyle);
  const styleRoot = (0, _useMergeSemantic.useSemanticRootStyle)(style);
  const [mergedClassNames, mergedStyles] = (0, _useMergeSemantic.useMergeSemantic)([contextClassNames, classNames], [contextStyles, contextStyleRoot, styles, styleRoot], {
    props: mergedProps
  });
  // ============================= Warning ==============================
  if (process.env.NODE_ENV !== 'production') {
    const warning = (0, _warning.devUseWarning)('Statistic');
    [['valueStyle', 'styles.content']].forEach(([deprecatedName, newName]) => {
      warning.deprecated(!(deprecatedName in props), deprecatedName, newName);
    });
  }
  const rootClassNames = (0, _clsx.clsx)(prefixCls, {
    [`${prefixCls}-rtl`]: direction === 'rtl'
  }, contextClassName, className, rootClassName, mergedClassNames.root, hashId, cssVarCls);
  const headerClassNames = (0, _clsx.clsx)(`${prefixCls}-header`, mergedClassNames.header);
  const titleClassNames = (0, _clsx.clsx)(`${prefixCls}-title`, mergedClassNames.title);
  const contentClassNames = (0, _clsx.clsx)(`${prefixCls}-content`, mergedClassNames.content);
  const valueClassNames = (0, _clsx.clsx)(`${prefixCls}-content-value`, mergedClassNames.value);
  const prefixClassNames = (0, _clsx.clsx)(`${prefixCls}-content-prefix`, mergedClassNames.prefix);
  const suffixClassNames = (0, _clsx.clsx)(`${prefixCls}-content-suffix`, mergedClassNames.suffix);
  const valueNode = /*#__PURE__*/React.createElement(_Number.default, {
    decimalSeparator: decimalSeparator,
    groupSeparator: groupSeparator,
    prefixCls: prefixCls,
    formatter: formatter,
    precision: precision,
    value: value,
    className: valueClassNames,
    style: mergedStyles.value
  });
  const internalRef = React.useRef(null);
  React.useImperativeHandle(ref, () => ({
    nativeElement: internalRef.current
  }));
  const restProps = (0, _util.pickAttrs)(rest, {
    aria: true,
    data: true
  });
  return /*#__PURE__*/React.createElement("div", {
    ...restProps,
    className: rootClassNames,
    style: mergedStyles.root,
    ref: internalRef,
    onMouseEnter: onMouseEnter,
    onMouseLeave: onMouseLeave
  }, title && (/*#__PURE__*/React.createElement("div", {
    className: headerClassNames,
    style: mergedStyles.header
  }, /*#__PURE__*/React.createElement("div", {
    className: titleClassNames,
    style: mergedStyles.title
  }, title))), /*#__PURE__*/React.createElement(_skeleton.default, {
    paragraph: false,
    loading: loading,
    className: `${prefixCls}-skeleton`,
    active: true
  }, /*#__PURE__*/React.createElement("div", {
    className: contentClassNames,
    style: {
      ...valueStyle,
      ...mergedStyles.content
    }
  }, prefix && (/*#__PURE__*/React.createElement("span", {
    className: prefixClassNames,
    style: mergedStyles.prefix
  }, prefix)), (0, _is.isFunction)(valueRender) ? valueRender(valueNode) : valueNode, suffix && (/*#__PURE__*/React.createElement("span", {
    className: suffixClassNames,
    style: mergedStyles.suffix
  }, suffix)))));
});
if (process.env.NODE_ENV !== 'production') {
  Statistic.displayName = 'Statistic';
}
var _default = exports.default = Statistic;