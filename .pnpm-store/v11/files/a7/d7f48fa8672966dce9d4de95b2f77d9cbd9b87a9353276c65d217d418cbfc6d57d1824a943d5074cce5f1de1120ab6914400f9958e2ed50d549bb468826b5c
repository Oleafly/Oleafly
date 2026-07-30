"use strict";
"use client";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _toConsumableArray2 = _interopRequireDefault(require("@babel/runtime/helpers/toConsumableArray"));
var React = _interopRequireWildcard(require("react"));
var _EditOutlined = _interopRequireDefault(require("@ant-design/icons/EditOutlined"));
var _resizeObserver = _interopRequireDefault(require("@rc-component/resize-observer"));
var _util = require("@rc-component/util");
var _clsx = require("clsx");
var _is = require("../../_util/is");
var _styleChecker = require("../../_util/styleChecker");
var _useLocale = _interopRequireDefault(require("../../locale/useLocale"));
var _tooltip = _interopRequireDefault(require("../../tooltip"));
var _Editable = _interopRequireDefault(require("../Editable"));
var _useCopyClick = _interopRequireDefault(require("../hooks/useCopyClick"));
var _useMergedConfig = _interopRequireDefault(require("../hooks/useMergedConfig"));
var _usePrevious = _interopRequireDefault(require("../hooks/usePrevious"));
var _useTooltipProps = _interopRequireDefault(require("../hooks/useTooltipProps"));
var _useTypographySemantic = require("../hooks/useTypographySemantic");
var _Typography = require("../Typography");
var _CopyBtn = _interopRequireDefault(require("./CopyBtn"));
var _Ellipsis = _interopRequireDefault(require("./Ellipsis"));
var _EllipsisTooltip = _interopRequireDefault(require("./EllipsisTooltip"));
var _util2 = require("./util");
function wrapperDecorations({
  mark,
  code,
  underline,
  delete: del,
  strong,
  keyboard,
  italic
}, content) {
  let currentContent = content;
  function wrap(tag, needed) {
    if (!needed) {
      return;
    }
    currentContent = /*#__PURE__*/React.createElement(tag, {}, currentContent);
  }
  wrap('strong', strong);
  wrap('u', underline);
  wrap('del', del);
  wrap('code', code);
  wrap('mark', mark);
  wrap('kbd', keyboard);
  wrap('i', italic);
  return currentContent;
}
const ELLIPSIS_STR = '...';
const DECORATION_PROPS = ['delete', 'mark', 'code', 'underline', 'strong', 'keyboard', 'italic'];
const Base = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    prefixCls: customizePrefixCls,
    className,
    style,
    classNames,
    styles,
    direction: typographyDirection,
    type,
    disabled,
    children,
    ellipsis,
    editable,
    copyable,
    actions,
    component,
    title,
    onMouseEnter,
    onMouseLeave,
    ...restProps
  } = props;
  const [textLocale] = (0, _useLocale.default)('Text');
  const typographyRef = React.useRef(null);
  const editIconRef = React.useRef(null);
  const [mergedClassNames, mergedStyles, prefixCls, direction] = (0, _useTypographySemantic.useTypographySemantic)(customizePrefixCls, classNames, styles, typographyDirection, props);
  const textProps = (0, _util.omit)(restProps, DECORATION_PROPS);
  // ========================== Editable ==========================
  const [enableEdit, editConfig] = (0, _useMergedConfig.default)(editable);
  const [editing, setEditing] = (0, _util.useControlledState)(false, editConfig.editing);
  const {
    triggerType = ['icon']
  } = editConfig;
  const triggerEdit = edit => {
    if (edit) {
      editConfig.onStart?.();
    }
    setEditing(edit);
  };
  // Focus edit icon when back
  const prevEditing = (0, _usePrevious.default)(editing);
  (0, _util.useLayoutEffect)(() => {
    if (!editing && prevEditing) {
      editIconRef.current?.focus();
    }
  }, [editing]);
  const onEditClick = e => {
    e?.preventDefault();
    triggerEdit(true);
  };
  const onEditChange = value => {
    editConfig.onChange?.(value);
    triggerEdit(false);
  };
  const onEditCancel = () => {
    editConfig.onCancel?.();
    triggerEdit(false);
  };
  // ========================== Copyable ==========================
  const [enableCopy, copyConfig] = (0, _useMergedConfig.default)(copyable);
  const {
    placement = 'end'
  } = actions ?? {};
  const {
    copied,
    copyLoading,
    onClick: onCopyClick
  } = (0, _useCopyClick.default)({
    copyConfig,
    children
  });
  // ========================== Ellipsis ==========================
  const [isLineClampSupport, setIsLineClampSupport] = React.useState(false);
  const [isTextOverflowSupport, setIsTextOverflowSupport] = React.useState(false);
  const [isJsEllipsis, setIsJsEllipsis] = React.useState(false);
  const [isNativeEllipsis, setIsNativeEllipsis] = React.useState(false);
  const [isNativeVisible, setIsNativeVisible] = React.useState(true);
  const [enableEllipsis, ellipsisConfig] = (0, _useMergedConfig.default)(ellipsis, {
    expandable: false,
    symbol: isExpanded => isExpanded ? textLocale?.collapse : textLocale?.expand
  });
  const [expanded, setExpanded] = (0, _util.useControlledState)(ellipsisConfig.defaultExpanded || false, ellipsisConfig.expanded);
  const mergedEnableEllipsis = enableEllipsis && (!expanded || ellipsisConfig.expandable === 'collapsible');
  // Shared prop to reduce bundle size
  const {
    rows = 1
  } = ellipsisConfig;
  const needMeasureEllipsis = React.useMemo(() =>
  // Disable ellipsis
  mergedEnableEllipsis && (
  // Provide suffix
  ellipsisConfig.suffix !== undefined || ellipsisConfig.onEllipsis ||
  // Can't use css ellipsis since we need to provide the place for button
  ellipsisConfig.expandable || enableEdit || enableCopy), [mergedEnableEllipsis, ellipsisConfig, enableEdit, enableCopy]);
  (0, _util.useLayoutEffect)(() => {
    if (enableEllipsis && !needMeasureEllipsis) {
      setIsLineClampSupport((0, _styleChecker.isStyleSupport)('webkitLineClamp'));
      setIsTextOverflowSupport((0, _styleChecker.isStyleSupport)('textOverflow'));
    }
  }, [needMeasureEllipsis, enableEllipsis]);
  const [cssEllipsis, setCssEllipsis] = React.useState(mergedEnableEllipsis);
  const canUseCssEllipsis = React.useMemo(() => {
    if (needMeasureEllipsis) {
      return false;
    }
    if (rows === 1) {
      return isTextOverflowSupport;
    }
    return isLineClampSupport;
  }, [needMeasureEllipsis, rows, isLineClampSupport, isTextOverflowSupport]);
  // We use effect to change from css ellipsis to js ellipsis.
  // To make SSR still can see the ellipsis.
  (0, _util.useLayoutEffect)(() => {
    setCssEllipsis(canUseCssEllipsis && mergedEnableEllipsis);
  }, [canUseCssEllipsis, mergedEnableEllipsis]);
  const tooltipProps = (0, _useTooltipProps.default)(ellipsisConfig.tooltip, editConfig.text, children);
  const needNativeEllipsisMeasure = cssEllipsis && !!tooltipProps.title;
  const isMergedEllipsis = mergedEnableEllipsis && (cssEllipsis ? needNativeEllipsisMeasure && isNativeEllipsis : isJsEllipsis);
  const cssTextOverflow = mergedEnableEllipsis && rows === 1 && cssEllipsis;
  const cssLineClamp = mergedEnableEllipsis && rows > 1 && cssEllipsis;
  // >>>>> Expand
  const onExpandClick = (e, info) => {
    setExpanded(info.expanded);
    ellipsisConfig.onExpand?.(e, info);
  };
  const [ellipsisWidth, setEllipsisWidth] = React.useState(0);
  const [isHoveringOperations, setIsHoveringOperations] = React.useState(false);
  const [isHoveringTypography, setIsHoveringTypography] = React.useState(false);
  const onResize = ({
    offsetWidth
  }) => {
    setEllipsisWidth(offsetWidth);
  };
  // >>>>> JS Ellipsis
  const onJsEllipsis = jsEllipsis => {
    setIsJsEllipsis(jsEllipsis);
    // Trigger if changed
    if (isJsEllipsis !== jsEllipsis) {
      ellipsisConfig.onEllipsis?.(jsEllipsis);
    }
  };
  // >>>>> Native ellipsis
  React.useEffect(() => {
    const textEle = typographyRef.current;
    if (enableEllipsis && needNativeEllipsisMeasure && textEle) {
      const currentEllipsis = (0, _util2.isEleEllipsis)(textEle);
      if (isNativeEllipsis !== currentEllipsis) {
        setIsNativeEllipsis(currentEllipsis);
      }
    }
  }, [enableEllipsis, needNativeEllipsisMeasure, children, cssLineClamp, isNativeVisible, ellipsisWidth]);
  // https://github.com/ant-design/ant-design/issues/36786
  // Use IntersectionObserver to check if element is invisible
  React.useEffect(() => {
    const textEle = typographyRef.current;
    if (typeof IntersectionObserver === 'undefined' || !textEle || !needNativeEllipsisMeasure || !mergedEnableEllipsis) {
      return;
    }
    const observer = new IntersectionObserver(() => {
      setIsNativeVisible(!!textEle.offsetParent);
    });
    observer.observe(textEle);
    return () => {
      observer.disconnect();
    };
  }, [needNativeEllipsisMeasure, mergedEnableEllipsis]);
  // ========================== Tooltip ===========================
  const topAriaLabel = React.useMemo(() => {
    if (!enableEllipsis || cssEllipsis) {
      return undefined;
    }
    return [editConfig.text, children, title, tooltipProps.title].find(_util2.isValidText);
  }, [enableEllipsis, cssEllipsis, title, tooltipProps.title, isMergedEllipsis, editConfig.text]);
  // =========================== Render ===========================
  // >>>>>>>>>>> Editing input
  if (editing) {
    return /*#__PURE__*/React.createElement(_Editable.default, {
      value: editConfig.text ?? (typeof children === 'string' ? children : ''),
      onSave: onEditChange,
      onCancel: onEditCancel,
      onEnd: editConfig.onEnd,
      prefixCls: prefixCls,
      className: className,
      style: style,
      direction: direction,
      component: component,
      maxLength: editConfig.maxLength,
      autoSize: editConfig.autoSize,
      enterIcon: editConfig.enterIcon,
      classNames: mergedClassNames,
      styles: mergedStyles
    });
  }
  // >>>>>>>>>>> Typography
  // Expand
  const renderExpand = () => {
    const {
      expandable,
      symbol
    } = ellipsisConfig;
    return expandable ? (/*#__PURE__*/React.createElement("button", {
      type: "button",
      key: "expand",
      className: (0, _clsx.clsx)(`${prefixCls}-${expanded ? 'collapse' : 'expand'}`, mergedClassNames.action),
      style: mergedStyles.action,
      onClick: e => onExpandClick(e, {
        expanded: !expanded
      }),
      "aria-label": expanded ? textLocale.collapse : textLocale?.expand
    }, (0, _is.isFunction)(symbol) ? symbol(expanded) : symbol)) : null;
  };
  // Edit
  const renderEdit = () => {
    if (!enableEdit) {
      return;
    }
    const {
      icon,
      tooltip,
      tabIndex
    } = editConfig;
    const editTitle = (0, _util.toArray)(tooltip)[0] || textLocale?.edit;
    const ariaLabel = typeof editTitle === 'string' ? editTitle : '';
    return triggerType.includes('icon') ? (/*#__PURE__*/React.createElement(_tooltip.default, {
      key: "edit",
      title: tooltip === false ? '' : editTitle
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      ref: editIconRef,
      className: (0, _clsx.clsx)(`${prefixCls}-edit`, mergedClassNames.action),
      style: mergedStyles.action,
      onClick: onEditClick,
      "aria-label": ariaLabel,
      tabIndex: tabIndex
    }, icon || /*#__PURE__*/React.createElement(_EditOutlined.default, {
      role: "button"
    })))) : null;
  };
  // Copy
  const renderCopy = () => {
    if (!enableCopy) {
      return null;
    }
    return /*#__PURE__*/React.createElement(_CopyBtn.default, {
      key: "copy",
      ...copyConfig,
      prefixCls: prefixCls,
      copied: copied,
      locale: textLocale,
      onCopy: onCopyClick,
      loading: copyLoading,
      iconOnly: !(0, _is.isReactRenderable)(children),
      className: mergedClassNames.action,
      style: mergedStyles.action
    });
  };
  const renderOperations = canEllipsis => {
    const expandNode = canEllipsis && renderExpand();
    const editNode = renderEdit();
    const copyNode = renderCopy();
    if (!expandNode && !editNode && !copyNode) {
      return null;
    }
    return /*#__PURE__*/React.createElement("span", {
      key: "operations",
      className: (0, _clsx.clsx)(`${prefixCls}-actions`, mergedClassNames.actions, {
        [`${prefixCls}-actions-start`]: placement === 'start'
      }),
      style: mergedStyles.actions,
      onMouseEnter: () => setIsHoveringOperations(true),
      onMouseLeave: () => setIsHoveringOperations(false)
    }, expandNode, editNode, copyNode);
  };
  const renderEllipsis = canEllipsis => [canEllipsis && !expanded && (/*#__PURE__*/React.createElement("span", {
    "aria-hidden": true,
    key: "ellipsis"
  }, ELLIPSIS_STR)), ellipsisConfig.suffix];
  return /*#__PURE__*/React.createElement(_resizeObserver.default, {
    onResize: onResize,
    disabled: !mergedEnableEllipsis
  }, resizeRef => (/*#__PURE__*/React.createElement(_EllipsisTooltip.default, {
    tooltipProps: tooltipProps,
    enableEllipsis: mergedEnableEllipsis,
    isEllipsis: isMergedEllipsis,
    open: isHoveringTypography && !isHoveringOperations
  }, /*#__PURE__*/React.createElement(_Typography.InternalTypography, {
    onMouseEnter: e => {
      setIsHoveringTypography(true);
      onMouseEnter?.(e);
    },
    onMouseLeave: e => {
      setIsHoveringTypography(false);
      onMouseLeave?.(e);
    },
    className: (0, _clsx.clsx)({
      [`${prefixCls}-${type}`]: type,
      [`${prefixCls}-disabled`]: disabled,
      [`${prefixCls}-ellipsis`]: enableEllipsis,
      [`${prefixCls}-ellipsis-single-line`]: cssTextOverflow,
      [`${prefixCls}-ellipsis-multiple-line`]: cssLineClamp,
      [`${prefixCls}-link`]: component === 'a'
    }, className),
    classNames: mergedClassNames,
    styles: mergedStyles,
    prefixCls: prefixCls,
    style: {
      ...style,
      WebkitLineClamp: cssLineClamp ? rows : undefined
    },
    component: component,
    ref: (0, _util.composeRef)(resizeRef, typographyRef, ref),
    direction: direction,
    onClick: triggerType.includes('text') ? onEditClick : undefined,
    "aria-label": topAriaLabel?.toString(),
    title: title,
    ...textProps
  }, /*#__PURE__*/React.createElement(_Ellipsis.default, {
    enableMeasure: mergedEnableEllipsis && !cssEllipsis,
    text: children,
    rows: rows,
    width: ellipsisWidth,
    onEllipsis: onJsEllipsis,
    expanded: expanded,
    measureDeps: [placement],
    miscDeps: [copied, expanded, copyLoading, enableEdit, enableCopy, placement, textLocale].concat((0, _toConsumableArray2.default)(DECORATION_PROPS.map(key => props[key])))
  }, (node, canEllipsis) => wrapperDecorations(props, /*#__PURE__*/React.createElement(React.Fragment, null, placement === 'start' ? renderOperations(canEllipsis) : null, node.length > 0 && canEllipsis && !expanded && topAriaLabel ? (/*#__PURE__*/React.createElement("span", {
    key: "show-content",
    "aria-hidden": true
  }, node)) : node, renderEllipsis(canEllipsis), placement === 'start' ? null : renderOperations(canEllipsis))))))));
});
var _default = exports.default = Base;