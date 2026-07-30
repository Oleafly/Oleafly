"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useInputProps;
var _util = require("@rc-component/util");
var React = _interopRequireWildcard(require("react"));
var _dateUtil = require("../../../utils/dateUtil");
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function useInputProps(props, /** Used for SinglePicker */
postProps) {
  const {
    format,
    maskFormat,
    generateConfig,
    locale,
    preserveInvalidOnBlur,
    inputReadOnly,
    required,
    'aria-required': ariaRequired,
    onSubmit,
    onFocus,
    onBlur,
    onInputChange,
    onInvalid,
    open,
    onOpenChange,
    onKeyDown,
    onChange,
    activeHelp,
    name,
    autoComplete,
    id,
    value,
    invalid,
    placeholder,
    disabled,
    activeIndex,
    allHelp,
    picker
  } = props;

  // ======================== Parser ========================
  const parseDate = (str, formatStr) => {
    const parsed = generateConfig.locale.parse(locale.locale, str, [formatStr]);
    return parsed && generateConfig.isValidate(parsed) ? parsed : null;
  };

  // ========================= Text =========================
  const firstFormat = format[0];
  const getText = React.useCallback(date => (0, _dateUtil.formatValue)(date, {
    locale,
    format: firstFormat,
    generateConfig
  }), [locale, generateConfig, firstFormat]);
  const valueTexts = React.useMemo(() => value.map(getText), [value, getText]);

  // ========================= Size =========================
  const size = React.useMemo(() => {
    const defaultSize = picker === 'time' ? 8 : 10;
    const length = typeof firstFormat === 'function' ? firstFormat(generateConfig.getNow()).length : firstFormat.length;
    return Math.max(defaultSize, length) + 2;
  }, [firstFormat, picker, generateConfig]);

  // ======================= Validate =======================
  const validateFormat = text => {
    for (let i = 0; i < format.length; i += 1) {
      const singleFormat = format[i];

      // Only support string type
      if (typeof singleFormat === 'string') {
        const parsed = parseDate(text, singleFormat);
        if (parsed) {
          return parsed;
        }
      }
    }
    return false;
  };

  // ======================== Input =========================
  const getInputProps = index => {
    function getProp(propValue) {
      return index !== undefined ? propValue[index] : propValue;
    }
    const pickedAttrs = (0, _util.pickAttrs)(props, {
      aria: true,
      data: true
    });
    const inputProps = {
      ...pickedAttrs,
      // ============== Shared ==============
      format: maskFormat,
      validateFormat: text => !!validateFormat(text),
      preserveInvalidOnBlur,
      readOnly: inputReadOnly,
      required,
      'aria-required': ariaRequired,
      name,
      autoComplete,
      size,
      // ============= By Index =============
      id: getProp(id),
      value: getProp(valueTexts) || '',
      invalid: getProp(invalid),
      placeholder: getProp(placeholder),
      active: activeIndex === index,
      helped: allHelp || activeHelp && activeIndex === index,
      disabled: getProp(disabled),
      onFocus: event => {
        onFocus(event, index);
      },
      onBlur: event => {
        // Blur do not trigger close
        // Since it may focus to the popup panel
        onBlur(event, index);
      },
      onSubmit,
      // Get validate text value
      onChange: text => {
        onInputChange();
        const parsed = validateFormat(text);
        if (parsed) {
          onInvalid(false, index);
          onChange(parsed, index);
          return;
        }

        // Tell outer that the value typed is invalid.
        // If text is empty, it means valid.
        onInvalid(!!text, index);
      },
      onHelp: () => {
        onOpenChange(true, {
          index
        });
      },
      onKeyDown: event => {
        let prevented = false;
        onKeyDown?.(event, () => {
          if (process.env.NODE_ENV !== 'production') {
            (0, _util.warning)(false, '`preventDefault` callback is deprecated. Please call `event.preventDefault` directly.');
          }
          prevented = true;
        });
        if (!event.defaultPrevented && !prevented) {
          switch (event.key) {
            case 'Escape':
              onOpenChange(false, {
                index
              });
              break;
            case 'Enter':
              if (!open) {
                onOpenChange(true);
              }
              break;
          }
        }
      },
      // ============ Post Props ============
      ...postProps?.({
        valueTexts
      })
    };

    // ============== Clean Up ==============
    Object.keys(inputProps).forEach(key => {
      if (inputProps[key] === undefined) {
        delete inputProps[key];
      }
    });
    return inputProps;
  };
  return [getInputProps, getText];
}