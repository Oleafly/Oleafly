"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.ConfirmContent = void 0;
var React = _interopRequireWildcard(require("react"));
var _CheckCircleFilled = _interopRequireDefault(require("@ant-design/icons/CheckCircleFilled"));
var _CloseCircleFilled = _interopRequireDefault(require("@ant-design/icons/CloseCircleFilled"));
var _ExclamationCircleFilled = _interopRequireDefault(require("@ant-design/icons/ExclamationCircleFilled"));
var _InfoCircleFilled = _interopRequireDefault(require("@ant-design/icons/InfoCircleFilled"));
var _util = require("@rc-component/util");
var _clsx = require("clsx");
var _fallbackProp = _interopRequireDefault(require("../_util/fallbackProp"));
var _hooks = require("../_util/hooks");
var _is = require("../_util/is");
var _motion = require("../_util/motion");
var _warning = require("../_util/warning");
var _configProvider = _interopRequireDefault(require("../config-provider"));
var _context = require("../config-provider/context");
var _locale = require("../locale");
var _useToken = _interopRequireDefault(require("../theme/useToken"));
var _ConfirmCancelBtn = _interopRequireDefault(require("./components/ConfirmCancelBtn"));
var _ConfirmOkBtn = _interopRequireDefault(require("./components/ConfirmOkBtn"));
var _context2 = require("./context");
var _Modal = _interopRequireDefault(require("./Modal"));
var _confirm = _interopRequireDefault(require("./style/confirm"));
const CONFIRM_OMIT_SEMANTIC_NAMES = ['body'];
const ConfirmContent = props => {
  const {
    prefixCls,
    icon,
    okText,
    cancelText,
    confirmPrefixCls,
    type,
    okCancel,
    footer,
    // Legacy for static function usage
    locale: staticLocale,
    autoFocusButton,
    focusable,
    contentClassName,
    contentStyle,
    ...restProps
  } = props;
  const {
    infoIcon,
    successIcon,
    errorIcon,
    warningIcon
  } = (0, _context.useComponentConfig)('modal');
  if (process.env.NODE_ENV !== 'production') {
    const warning = (0, _warning.devUseWarning)('Modal');
    process.env.NODE_ENV !== "production" ? warning(!(typeof icon === 'string' && icon.length > 2), 'breaking', `\`icon\` is using ReactNode instead of string naming in v4. Please check \`${icon}\` at https://ant.design/components/icon`) : void 0;
  }
  // Icon
  let mergedIcon = icon;
  // 支持传入 { icon: null } 或 { icon: false } 来隐藏`Modal.confirm`默认的Icon
  if (icon === undefined) {
    switch (type) {
      case 'info':
        mergedIcon = (0, _fallbackProp.default)(infoIcon, /*#__PURE__*/React.createElement(_InfoCircleFilled.default, null));
        break;
      case 'success':
        mergedIcon = (0, _fallbackProp.default)(successIcon, /*#__PURE__*/React.createElement(_CheckCircleFilled.default, null));
        break;
      case 'error':
        mergedIcon = (0, _fallbackProp.default)(errorIcon, /*#__PURE__*/React.createElement(_CloseCircleFilled.default, null));
        break;
      default:
        mergedIcon = (0, _fallbackProp.default)(warningIcon, /*#__PURE__*/React.createElement(_ExclamationCircleFilled.default, null));
    }
  }
  // 默认为 true，保持向下兼容
  const mergedOkCancel = okCancel ?? type === 'confirm';
  const mergedAutoFocusButton = React.useMemo(() => {
    const base = focusable?.autoFocusButton || autoFocusButton;
    return base || base === null ? base : 'ok';
  }, [autoFocusButton, focusable?.autoFocusButton]);
  const [locale] = (0, _locale.useLocale)('Modal');
  const mergedLocale = staticLocale || locale;
  // ================== Locale Text ==================
  const okTextLocale = okText || (mergedOkCancel ? mergedLocale?.okText : mergedLocale?.justOkText);
  const cancelTextLocale = cancelText || mergedLocale?.cancelText;
  // ================= Context Value =================
  const {
    closable
  } = restProps;
  const {
    onClose
  } = (0, _is.isPlainObject)(closable) ? closable : {};
  const memoizedValue = React.useMemo(() => {
    return {
      autoFocusButton: mergedAutoFocusButton,
      cancelTextLocale,
      okTextLocale,
      mergedOkCancel,
      onClose,
      ...restProps
    };
  }, [mergedAutoFocusButton, cancelTextLocale, okTextLocale, mergedOkCancel, onClose, restProps]);
  // ====================== Footer Origin Node ======================
  const footerOriginNode = /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(_ConfirmCancelBtn.default, null), /*#__PURE__*/React.createElement(_ConfirmOkBtn.default, null));
  const hasTitle = (0, _is.isReactRenderable)(props.title);
  const hasIcon = (0, _is.isReactRenderable)(mergedIcon);
  const bodyCls = `${confirmPrefixCls}-body`;
  return /*#__PURE__*/React.createElement("div", {
    className: `${confirmPrefixCls}-body-wrapper`
  }, /*#__PURE__*/React.createElement("div", {
    className: (0, _clsx.clsx)(bodyCls, {
      [`${bodyCls}-has-title`]: hasTitle,
      [`${bodyCls}-no-icon`]: !hasIcon
    })
  }, mergedIcon, /*#__PURE__*/React.createElement("div", {
    className: `${confirmPrefixCls}-paragraph`
  }, hasTitle && /*#__PURE__*/React.createElement("span", {
    className: `${confirmPrefixCls}-title`
  }, props.title), /*#__PURE__*/React.createElement("div", {
    className: (0, _clsx.clsx)(`${confirmPrefixCls}-content`, contentClassName),
    style: contentStyle
  }, props.content))), footer === undefined || (0, _is.isFunction)(footer) ? (/*#__PURE__*/React.createElement(_context2.ModalContextProvider, {
    value: memoizedValue
  }, /*#__PURE__*/React.createElement("div", {
    className: `${confirmPrefixCls}-btns`
  }, (0, _is.isFunction)(footer) ? footer(footerOriginNode, {
    OkBtn: _ConfirmOkBtn.default,
    CancelBtn: _ConfirmCancelBtn.default
  }) : footerOriginNode))) : footer, /*#__PURE__*/React.createElement(_confirm.default, {
    prefixCls: prefixCls
  }));
};
exports.ConfirmContent = ConfirmContent;
const ConfirmDialog = props => {
  const {
    close,
    zIndex,
    maskStyle,
    direction,
    prefixCls,
    wrapClassName,
    rootPrefixCls,
    bodyStyle,
    closable = false,
    onConfirm,
    styles,
    title,
    mask,
    maskClosable,
    okButtonProps,
    cancelButtonProps
  } = props;
  const {
    cancelButtonProps: contextCancelButtonProps,
    okButtonProps: contextOkButtonProps
  } = (0, _context.useComponentConfig)('modal');
  if (process.env.NODE_ENV !== 'production') {
    const warning = (0, _warning.devUseWarning)('Modal');
    [['bodyStyle', 'styles.body'], ['maskStyle', 'styles.mask']].forEach(([deprecatedName, newName]) => {
      warning.deprecated(!(deprecatedName in props), deprecatedName, newName);
    });
  }
  const confirmPrefixCls = `${prefixCls}-confirm`;
  const width = props.width || 416;
  const style = props.style || {};
  const semanticStyles = (0, _is.isFunction)(styles) ? info => ({
    body: bodyStyle,
    mask: maskStyle,
    ...styles(info)
  }) : {
    body: bodyStyle,
    mask: maskStyle,
    ...styles
  };
  const modalProps = (0, _util.omit)(props, ['bodyStyle', 'maskStyle']);
  const classString = (0, _clsx.clsx)(confirmPrefixCls, `${confirmPrefixCls}-${props.type}`, {
    [`${confirmPrefixCls}-rtl`]: direction === 'rtl'
  }, props.className);
  // ========================== Mask ==========================
  // 默认为 false，保持旧版默认行为
  const mergedMask = React.useMemo(() => {
    const nextMaskConfig = (0, _hooks.normalizeMaskConfig)(mask, maskClosable);
    nextMaskConfig.closable ?? (nextMaskConfig.closable = false);
    return nextMaskConfig;
  }, [mask, maskClosable]);
  // ========================= zIndex =========================
  const [, token] = (0, _useToken.default)();
  const mergedZIndex = React.useMemo(() => {
    if (zIndex !== undefined) {
      return zIndex;
    }
    // Static always use max zIndex
    return token.zIndexPopupBase + _hooks.CONTAINER_MAX_OFFSET;
  }, [zIndex, token]);
  // ========================= Render =========================
  return /*#__PURE__*/React.createElement(_Modal.default, {
    ...modalProps,
    className: classString,
    wrapClassName: (0, _clsx.clsx)({
      [`${confirmPrefixCls}-centered`]: !!props.centered
    }, wrapClassName),
    onCancel: () => {
      close?.({
        triggerCancel: true
      });
      onConfirm?.(false);
    },
    title: title,
    footer: null,
    transitionName: (0, _motion.getTransitionName)(rootPrefixCls || '', 'zoom', props.transitionName),
    maskTransitionName: (0, _motion.getTransitionName)(rootPrefixCls || '', 'fade', props.maskTransitionName),
    mask: mergedMask,
    style: style,
    styles: semanticStyles,
    width: width,
    zIndex: mergedZIndex,
    closable: closable,
    _semanticOmit: CONFIRM_OMIT_SEMANTIC_NAMES,
    _renderSemanticContent: ({
      classNames: mergedClassNames,
      styles: mergedStyles
    }) => (/*#__PURE__*/React.createElement(ConfirmContent, {
      ...props,
      confirmPrefixCls: confirmPrefixCls,
      okButtonProps: {
        ...contextOkButtonProps,
        ...okButtonProps
      },
      cancelButtonProps: {
        ...contextCancelButtonProps,
        ...cancelButtonProps
      },
      contentClassName: mergedClassNames.body,
      contentStyle: mergedStyles.body
    }))
  });
};
const ConfirmDialogWrapper = props => {
  const {
    rootPrefixCls,
    iconPrefixCls,
    direction,
    theme
  } = props;
  return /*#__PURE__*/React.createElement(_configProvider.default, {
    prefixCls: rootPrefixCls,
    iconPrefixCls: iconPrefixCls,
    direction: direction,
    theme: theme
  }, /*#__PURE__*/React.createElement(ConfirmDialog, {
    ...props
  }));
};
if (process.env.NODE_ENV !== 'production') {
  ConfirmDialog.displayName = 'ConfirmDialog';
  ConfirmDialogWrapper.displayName = 'ConfirmDialogWrapper';
}
var _default = exports.default = ConfirmDialogWrapper;