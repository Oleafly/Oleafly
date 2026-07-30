"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _react = _interopRequireWildcard(require("react"));
var React = _react;
var _EyeInvisibleOutlined = _interopRequireDefault(require("@ant-design/icons/EyeInvisibleOutlined"));
var _EyeOutlined = _interopRequireDefault(require("@ant-design/icons/EyeOutlined"));
var _util = require("@rc-component/util");
var _clsx = require("clsx");
var _useMergeSemantic = require("../_util/hooks/useMergeSemantic");
var _is = require("../_util/is");
var _context = require("../config-provider/context");
var _DisabledContext = _interopRequireDefault(require("../config-provider/DisabledContext"));
var _locale = require("../locale");
var _useRemovePasswordTimeout = _interopRequireDefault(require("./hooks/useRemovePasswordTimeout"));
var _Input = _interopRequireDefault(require("./Input"));
const defaultIconRender = visible => visible ? /*#__PURE__*/React.createElement(_EyeOutlined.default, null) : /*#__PURE__*/React.createElement(_EyeInvisibleOutlined.default, null);
const actionMap = {
  click: 'onClick',
  hover: 'onMouseOver'
};
const Password = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    disabled: customDisabled,
    action = 'click',
    visibilityToggle = true,
    iconRender,
    prefixCls: customizePrefixCls,
    inputPrefixCls: customizeInputPrefixCls,
    suffix,
    className,
    style,
    classNames,
    styles,
    ...restProps
  } = props;
  const {
    getPrefixCls,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles,
    iconRender: contextIconRender
  } = (0, _context.useComponentConfig)('inputPassword');
  const [locale] = (0, _locale.useLocale)('global');
  // ===================== Disabled =====================
  const disabled = React.useContext(_DisabledContext.default);
  const mergedDisabled = customDisabled ?? disabled;
  // =========== Merged Props for Semantic ==========
  const mergedProps = {
    ...props,
    disabled: mergedDisabled
  };
  const [mergedClassNames, mergedStyles] = (0, _useMergeSemantic.useMergeSemantic)([contextClassNames, classNames], [contextStyles, styles], {
    props: mergedProps
  });
  const visibilityControlled = (0, _is.isPlainObject)(visibilityToggle) && visibilityToggle.visible !== undefined;
  const [visible, setVisible] = (0, _react.useState)(() => visibilityControlled ? visibilityToggle.visible : false);
  const inputRef = (0, _react.useRef)(null);
  React.useEffect(() => {
    if (visibilityControlled) {
      setVisible(visibilityToggle.visible);
    }
  }, [visibilityControlled, visibilityToggle]);
  // Remove Password value
  const removePasswordTimeout = (0, _useRemovePasswordTimeout.default)(inputRef);
  const onVisibleChange = () => {
    if (mergedDisabled) {
      return;
    }
    if (visible) {
      removePasswordTimeout();
    }
    const nextVisible = !visible;
    setVisible(nextVisible);
    if ((0, _is.isPlainObject)(visibilityToggle)) {
      visibilityToggle.onVisibleChange?.(nextVisible);
    }
  };
  const getIcon = prefixCls => {
    const iconTrigger = actionMap[action] || '';
    const iconRenderer = iconRender || contextIconRender || defaultIconRender;
    const icon = iconRenderer(visible);
    const iconTabIndex = (0, _is.isPlainObject)(visibilityToggle) ? visibilityToggle.tabIndex : undefined;
    return /*#__PURE__*/React.createElement("span", {
      key: "passwordIcon",
      role: "button",
      tabIndex: mergedDisabled ? -1 : iconTabIndex ?? 0,
      className: `${prefixCls}-icon`,
      "aria-disabled": mergedDisabled,
      "aria-pressed": visible,
      "aria-label": visible ? locale.hide : locale.show,
      onMouseDown: e => {
        // Prevent focused state lost
        // https://github.com/ant-design/ant-design/issues/15173
        e.preventDefault();
      },
      onMouseUp: e => {
        // Prevent caret position change
        // https://github.com/ant-design/ant-design/issues/23524
        e.preventDefault();
      },
      onKeyDown: e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onVisibleChange();
        }
      },
      [iconTrigger]: onVisibleChange
    }, icon);
  };
  const inputPrefixCls = getPrefixCls('input', customizeInputPrefixCls);
  const prefixCls = getPrefixCls('input-password', customizePrefixCls);
  const suffixIcon = visibilityToggle && getIcon(prefixCls);
  const inputClassName = (0, _clsx.clsx)(prefixCls, contextClassName, className, {
    [`${prefixCls}-${props.size}`]: !!props.size
  });
  const inputProps = {
    ...restProps,
    type: visible ? 'text' : 'password',
    prefixCls: inputPrefixCls,
    suffix: (/*#__PURE__*/React.createElement(React.Fragment, null, suffixIcon, suffix)),
    disabled: mergedDisabled,
    className: inputClassName,
    style: {
      ...contextStyle,
      ...style
    },
    classNames: mergedClassNames,
    styles: mergedStyles
  };
  return /*#__PURE__*/React.createElement(_Input.default, {
    ref: (0, _util.composeRef)(ref, inputRef),
    ...inputProps
  });
});
if (process.env.NODE_ENV !== 'production') {
  Password.displayName = 'Input.Password';
}
var _default = exports.default = Password;