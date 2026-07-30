"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _SearchOutlined = _interopRequireDefault(require("@ant-design/icons/SearchOutlined"));
var _util = require("@rc-component/util");
var _clsx = require("clsx");
var _fallbackProp = _interopRequireDefault(require("../_util/fallbackProp"));
var _useMergeSemantic = require("../_util/hooks/useMergeSemantic");
var _reactNode = require("../_util/reactNode");
var _Button = _interopRequireDefault(require("../button/Button"));
var _DisabledContext = _interopRequireDefault(require("../config-provider/DisabledContext"));
var _context = require("../config-provider/context");
var _useSize = _interopRequireDefault(require("../config-provider/hooks/useSize"));
var _Compact = _interopRequireWildcard(require("../space/Compact"));
var _Input = _interopRequireDefault(require("./Input"));
var _search = _interopRequireDefault(require("./style/search"));
const Search = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    prefixCls: customizePrefixCls,
    inputPrefixCls: customizeInputPrefixCls,
    className,
    size: customizeSize,
    style,
    enterButton = false,
    searchIcon: customizeSearchIcon,
    addonAfter,
    loading,
    disabled,
    onSearch: customOnSearch,
    onChange: customOnChange,
    onCompositionStart,
    onCompositionEnd,
    variant,
    onPressEnter: customOnPressEnter,
    classNames,
    styles,
    hidden,
    ...restProps
  } = props;
  const {
    direction,
    getPrefixCls,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles,
    searchIcon: contextSearchIcon
  } = (0, _context.useComponentConfig)('inputSearch');
  const contextDisabled = React.useContext(_DisabledContext.default);
  const mergedDisabled = disabled ?? contextDisabled;
  const mergedProps = {
    ...props,
    enterButton
  };
  const [mergedClassNames, mergedStyles] = (0, _useMergeSemantic.useMergeSemantic)([contextClassNames, classNames], [contextStyles, styles], {
    props: mergedProps
  }, {
    button: {
      _default: 'root'
    }
  });
  const composedRef = React.useRef(false);
  const prefixCls = getPrefixCls('input-search', customizePrefixCls);
  const inputPrefixCls = getPrefixCls('input', customizeInputPrefixCls);
  const [hashId, cssVarCls] = (0, _search.default)(prefixCls);
  const {
    compactSize
  } = (0, _Compact.useCompactItemContext)(prefixCls, direction);
  const size = (0, _useSize.default)(ctx => customizeSize ?? compactSize ?? ctx);
  const inputRef = React.useRef(null);
  const onChange = e => {
    if (e?.target && e.type === 'click' && customOnSearch) {
      customOnSearch(e.target.value, e, {
        source: 'clear'
      });
    }
    customOnChange?.(e);
  };
  const onMouseDown = e => {
    if (document.activeElement === inputRef.current?.input) {
      e.preventDefault();
    }
  };
  const onSearch = e => {
    if (customOnSearch) {
      customOnSearch(inputRef.current?.input?.value, e, {
        source: 'input'
      });
    }
  };
  const onPressEnter = e => {
    if (composedRef.current || loading) {
      return;
    }
    customOnPressEnter?.(e);
    onSearch(e);
  };
  const searchIcon = typeof enterButton === 'boolean' ? (0, _fallbackProp.default)(customizeSearchIcon, contextSearchIcon, /*#__PURE__*/React.createElement(_SearchOutlined.default, null)) : null;
  const btnPrefixCls = `${prefixCls}-btn`;
  const btnClassName = (0, _clsx.clsx)(btnPrefixCls, {
    [`${btnPrefixCls}-${variant}`]: variant
  });
  let button;
  const enterButtonAsElement = enterButton || {};
  const isAntdButton = enterButtonAsElement.type && enterButtonAsElement.type.__ANT_BUTTON === true;
  if (isAntdButton || enterButtonAsElement.type === 'button') {
    const enterButtonProps = enterButtonAsElement.props;
    button = (0, _reactNode.cloneElement)(enterButtonAsElement, {
      disabled: mergedDisabled || enterButtonProps.disabled || !isAntdButton && loading,
      onMouseDown,
      onClick: e => {
        enterButtonAsElement?.props?.onClick?.(e);
        onSearch(e);
      },
      key: 'enterButton',
      ...(isAntdButton ? {
        className: (0, _clsx.clsx)(btnClassName, enterButtonProps.className),
        loading: loading || enterButtonProps.loading,
        size
      } : {})
    });
  } else {
    button = /*#__PURE__*/React.createElement(_Button.default, {
      classNames: mergedClassNames.button,
      styles: mergedStyles.button,
      className: btnClassName,
      color: enterButton ? 'primary' : 'default',
      size: size,
      disabled: disabled,
      key: "enterButton",
      onMouseDown: onMouseDown,
      onClick: onSearch,
      loading: loading,
      icon: searchIcon,
      variant: variant === 'borderless' || variant === 'filled' || variant === 'underlined' ? 'text' : enterButton ? 'solid' : undefined
    }, enterButton);
  }
  if (addonAfter) {
    button = [button, (0, _reactNode.cloneElement)(addonAfter, {
      key: 'addonAfter'
    })];
  }
  const mergedClassName = (0, _clsx.clsx)(prefixCls, cssVarCls, {
    [`${prefixCls}-rtl`]: direction === 'rtl',
    [`${prefixCls}-${size}`]: !!size,
    [`${prefixCls}-with-button`]: !!enterButton
  }, className, contextClassName, hashId, mergedClassNames.root);
  const handleOnCompositionStart = e => {
    composedRef.current = true;
    onCompositionStart?.(e);
  };
  const handleOnCompositionEnd = e => {
    composedRef.current = false;
    onCompositionEnd?.(e);
  };
  // ========================== Render ==========================
  // >>> Root Props
  const rootProps = (0, _util.pickAttrs)(restProps, {
    data: true
  });
  const inputProps = (0, _util.omit)({
    ...restProps,
    classNames: (0, _util.omit)(mergedClassNames, ['button', 'root']),
    styles: (0, _util.omit)(mergedStyles, ['button', 'root']),
    prefixCls: inputPrefixCls,
    type: 'search',
    size,
    variant,
    onPressEnter,
    onCompositionStart: handleOnCompositionStart,
    onCompositionEnd: handleOnCompositionEnd,
    onChange,
    disabled
  }, Object.keys(rootProps));
  return /*#__PURE__*/React.createElement(_Compact.default, {
    className: mergedClassName,
    style: {
      ...mergedStyles.root,
      ...contextStyle,
      ...style
    },
    ...rootProps,
    hidden: hidden
  }, /*#__PURE__*/React.createElement(_Input.default, {
    ref: (0, _util.composeRef)(inputRef, ref),
    ...inputProps
  }), button);
});
if (process.env.NODE_ENV !== 'production') {
  Search.displayName = 'Search';
}
var _default = exports.default = Search;