function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import { clsx } from 'clsx';
import * as React from 'react';
import { isSame } from "../../../utils/dateUtil";
import PickerContext from "../../context";
import Icon from "../Icon";
import ClearIcon from "../ClearIcon";
import Input from "../Input";
import useInputProps from "../hooks/useInputProps";
import useRootProps from "../hooks/useRootProps";
import MultipleDates from "./MultipleDates";
function SingleSelector(props, ref) {
  const {
    id,
    open,
    prefix,
    clearIcon,
    suffixIcon,
    activeHelp,
    allHelp,
    focused,
    onFocus,
    onBlur,
    onKeyDown,
    locale,
    generateConfig,
    // Placeholder
    placeholder,
    // Style
    className,
    style,
    // Click
    onClick,
    onClear,
    // Change
    internalPicker,
    value,
    onChange,
    onSubmit,
    onInputChange,
    multiple,
    maxTagCount,
    tagRender,
    // Valid
    format,
    maskFormat,
    preserveInvalidOnBlur,
    onInvalid,
    // Disabled
    disabled,
    invalid,
    inputReadOnly,
    // Direction
    direction,
    // Open
    onOpenChange,
    // Native
    onMouseDown,
    // Input
    required,
    'aria-required': ariaRequired,
    autoFocus,
    tabIndex,
    removeIcon,
    ...restProps
  } = props;
  const rtl = direction === 'rtl';

  // ======================== Prefix ========================
  const {
    prefixCls,
    classNames,
    styles
  } = React.useContext(PickerContext);

  // ========================= Refs =========================
  const rootRef = React.useRef();
  const inputRef = React.useRef();
  React.useImperativeHandle(ref, () => ({
    nativeElement: rootRef.current,
    focus: options => {
      inputRef.current?.focus(options);
    },
    blur: () => {
      inputRef.current?.blur();
    }
  }));

  // ======================== Props =========================
  const rootProps = useRootProps(restProps);

  // ======================== Change ========================
  const onSingleChange = date => {
    onChange([date]);
  };
  const onMultipleRemove = date => {
    const nextValues = value.filter(oriDate => oriDate && !isSame(generateConfig, locale, oriDate, date, internalPicker));
    onChange(nextValues);

    // When `open`, it means user is operating the
    if (!open) {
      onSubmit();
    }
  };

  // ======================== Inputs ========================
  const [getInputProps, getText] = useInputProps({
    ...props,
    onChange: onSingleChange
  }, ({
    valueTexts
  }) => ({
    value: valueTexts[0] || '',
    active: focused
  }));

  // ======================== Clear =========================
  const showClear = !!(clearIcon && value.length && !disabled);

  // ======================= Multiple =======================
  const selectorNode = multiple ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(MultipleDates, {
    prefixCls: prefixCls,
    value: value,
    onRemove: onMultipleRemove,
    formatDate: getText,
    maxTagCount: maxTagCount,
    tagRender: tagRender,
    disabled: disabled,
    removeIcon: removeIcon,
    placeholder: placeholder
  }), /*#__PURE__*/React.createElement("input", {
    className: `${prefixCls}-multiple-input`,
    value: value.map(getText).join(','),
    ref: inputRef,
    readOnly: true,
    autoFocus: autoFocus,
    tabIndex: tabIndex
  }), /*#__PURE__*/React.createElement(Icon, {
    icon: suffixIcon
  }), showClear && /*#__PURE__*/React.createElement(ClearIcon, {
    icon: clearIcon,
    onClear: onClear
  })) : /*#__PURE__*/React.createElement(Input, _extends({
    ref: inputRef
  }, getInputProps(), {
    autoFocus: autoFocus,
    tabIndex: tabIndex,
    suffixIcon: suffixIcon,
    clearIcon: showClear && /*#__PURE__*/React.createElement(ClearIcon, {
      icon: clearIcon,
      onClear: onClear
    }),
    showActiveCls: false
  }));

  // ======================== Render ========================
  return /*#__PURE__*/React.createElement("div", _extends({}, rootProps, {
    className: clsx(prefixCls, {
      [`${prefixCls}-multiple`]: multiple,
      [`${prefixCls}-focused`]: focused,
      [`${prefixCls}-disabled`]: disabled,
      [`${prefixCls}-invalid`]: invalid,
      [`${prefixCls}-rtl`]: rtl
    }, className),
    style: style,
    ref: rootRef,
    onClick: onClick
    // Not lose current input focus
    ,
    onMouseDown: e => {
      const {
        target
      } = e;
      if (target !== inputRef.current?.inputElement) {
        e.preventDefault();
      }
      onMouseDown?.(e);
    }
  }), prefix && /*#__PURE__*/React.createElement("div", {
    className: clsx(`${prefixCls}-prefix`, classNames.prefix),
    style: styles.prefix
  }, prefix), selectorNode);
}
const RefSingleSelector = /*#__PURE__*/React.forwardRef(SingleSelector);
if (process.env.NODE_ENV !== 'production') {
  RefSingleSelector.displayName = 'SingleSelector';
}
export default RefSingleSelector;