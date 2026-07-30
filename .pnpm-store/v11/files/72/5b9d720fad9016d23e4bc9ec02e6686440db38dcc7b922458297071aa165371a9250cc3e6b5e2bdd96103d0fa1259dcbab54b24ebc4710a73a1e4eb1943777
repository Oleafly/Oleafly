"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "List", {
  enumerable: true,
  get: function () {
    return _form.List;
  }
});
exports.default = void 0;
Object.defineProperty(exports, "useForm", {
  enumerable: true,
  get: function () {
    return _useForm.default;
  }
});
Object.defineProperty(exports, "useWatch", {
  enumerable: true,
  get: function () {
    return _form.useWatch;
  }
});
var React = _interopRequireWildcard(require("react"));
var _form = _interopRequireWildcard(require("@rc-component/form"));
var _clsx = require("clsx");
var _useMergeSemantic = require("../_util/hooks/useMergeSemantic");
var _is = require("../_util/is");
var _context = require("../config-provider/context");
var _DisabledContext = _interopRequireWildcard(require("../config-provider/DisabledContext"));
var _useCSSVarCls = _interopRequireDefault(require("../config-provider/hooks/useCSSVarCls"));
var _useSize = _interopRequireDefault(require("../config-provider/hooks/useSize"));
var _SizeContext = _interopRequireDefault(require("../config-provider/SizeContext"));
var _context2 = require("./context");
var _useForm = _interopRequireDefault(require("./hooks/useForm"));
var _useFormWarning = _interopRequireDefault(require("./hooks/useFormWarning"));
var _style = _interopRequireDefault(require("./style"));
var _validateMessagesContext = _interopRequireDefault(require("./validateMessagesContext"));
const InternalForm = (props, ref) => {
  const contextDisabled = React.useContext(_DisabledContext.default);
  const {
    getPrefixCls,
    direction,
    requiredMark: contextRequiredMark,
    colon: contextColon,
    scrollToFirstError: contextScrollToFirstError,
    className: contextClassName,
    style: contextStyle,
    styles: contextStyles,
    classNames: contextClassNames,
    tooltip: contextTooltip,
    labelAlign: contextLabelAlign,
    labelWrap: contextLabelWrap
  } = (0, _context.useComponentConfig)('form');
  const {
    prefixCls: customizePrefixCls,
    className,
    rootClassName,
    size,
    disabled = contextDisabled,
    form,
    colon,
    labelAlign,
    labelWrap,
    labelCol,
    wrapperCol,
    layout = 'horizontal',
    scrollToFirstError,
    requiredMark,
    onFinishFailed,
    name,
    style,
    feedbackIcons,
    variant,
    classNames,
    styles,
    tooltip,
    ...restFormProps
  } = props;
  const mergedSize = (0, _useSize.default)(size);
  const contextValidateMessages = React.useContext(_validateMessagesContext.default);
  if (process.env.NODE_ENV !== 'production') {
    (0, _useFormWarning.default)(props);
  }
  const mergedRequiredMark = React.useMemo(() => {
    if (requiredMark !== undefined) {
      return requiredMark;
    }
    if (contextRequiredMark !== undefined) {
      return contextRequiredMark;
    }
    return true;
  }, [requiredMark, contextRequiredMark]);
  const mergedColon = colon ?? contextColon;
  const mergedLabelAlign = labelAlign ?? contextLabelAlign;
  const mergedLabelWrap = labelWrap ?? contextLabelWrap;
  const mergedTooltip = {
    ...contextTooltip,
    ...tooltip
  };
  const prefixCls = getPrefixCls('form', customizePrefixCls);
  // Style
  const rootCls = (0, _useCSSVarCls.default)(prefixCls);
  const [hashId, cssVarCls] = (0, _style.default)(prefixCls, rootCls);
  // =========== Merged Props for Semantic ===========
  const mergedProps = {
    ...props,
    size: mergedSize,
    disabled,
    layout,
    colon: mergedColon,
    requiredMark: mergedRequiredMark,
    labelAlign: mergedLabelAlign,
    labelWrap: mergedLabelWrap
  };
  const contextStyleRoot = (0, _useMergeSemantic.useSemanticRootStyle)(contextStyle);
  const styleRoot = (0, _useMergeSemantic.useSemanticRootStyle)(style);
  const [mergedClassNames, mergedStyles] = (0, _useMergeSemantic.useMergeSemantic)([contextClassNames, classNames], [contextStyles, contextStyleRoot, styles, styleRoot], {
    props: mergedProps
  });
  const formClassName = (0, _clsx.clsx)(prefixCls, `${prefixCls}-${layout}`, {
    [`${prefixCls}-hide-required-mark`]: mergedRequiredMark === false,
    // todo: remove in next major version
    [`${prefixCls}-rtl`]: direction === 'rtl',
    [`${prefixCls}-large`]: mergedSize === 'large',
    [`${prefixCls}-small`]: mergedSize === 'small'
  }, cssVarCls, rootCls, hashId, contextClassName, className, rootClassName, mergedClassNames.root);
  const [wrapForm] = (0, _useForm.default)(form);
  const {
    __INTERNAL__
  } = wrapForm;
  __INTERNAL__.name = name;
  const formContextValue = React.useMemo(() => ({
    name,
    labelAlign: mergedLabelAlign,
    labelCol,
    labelWrap: mergedLabelWrap,
    wrapperCol,
    layout,
    colon: mergedColon,
    requiredMark: mergedRequiredMark,
    itemRef: __INTERNAL__.itemRef,
    form: wrapForm,
    feedbackIcons,
    tooltip: mergedTooltip,
    classNames: mergedClassNames,
    styles: mergedStyles
  }), [name, mergedLabelAlign, mergedLabelWrap, labelCol, wrapperCol, layout, mergedColon, mergedRequiredMark, wrapForm, feedbackIcons, mergedClassNames, mergedStyles, mergedTooltip]);
  const nativeElementRef = React.useRef(null);
  React.useImperativeHandle(ref, () => ({
    ...wrapForm,
    nativeElement: nativeElementRef.current?.nativeElement
  }));
  const scrollToField = (options, fieldName) => {
    if (options) {
      let defaultScrollToFirstError = {
        block: 'nearest'
      };
      if ((0, _is.isPlainObject)(options)) {
        defaultScrollToFirstError = {
          ...defaultScrollToFirstError,
          ...options
        };
      }
      wrapForm.scrollToField(fieldName, defaultScrollToFirstError);
    }
  };
  const onInternalFinishFailed = errorInfo => {
    onFinishFailed?.(errorInfo);
    if (errorInfo.errorFields.length) {
      const fieldName = errorInfo.errorFields[0].name;
      if (scrollToFirstError !== undefined) {
        scrollToField(scrollToFirstError, fieldName);
        return;
      }
      if (contextScrollToFirstError !== undefined) {
        scrollToField(contextScrollToFirstError, fieldName);
      }
    }
  };
  return /*#__PURE__*/React.createElement(_context2.VariantContext.Provider, {
    value: variant
  }, /*#__PURE__*/React.createElement(_DisabledContext.DisabledContextProvider, {
    disabled: disabled
  }, /*#__PURE__*/React.createElement(_SizeContext.default.Provider, {
    value: mergedSize
  }, /*#__PURE__*/React.createElement(_context2.FormProvider, {
    // This is not list in API, we pass with spread
    validateMessages: contextValidateMessages
  }, /*#__PURE__*/React.createElement(_context2.FormContext.Provider, {
    value: formContextValue
  }, /*#__PURE__*/React.createElement(_context2.NoFormStyle, {
    status: true
  }, /*#__PURE__*/React.createElement(_form.default, {
    id: name,
    ...restFormProps,
    name: name,
    onFinishFailed: onInternalFinishFailed,
    form: wrapForm,
    ref: nativeElementRef,
    style: mergedStyles?.root,
    className: formClassName
  })))))));
};
const Form = /*#__PURE__*/React.forwardRef(InternalForm);
if (process.env.NODE_ENV !== 'production') {
  Form.displayName = 'Form';
}
var _default = exports.default = Form;