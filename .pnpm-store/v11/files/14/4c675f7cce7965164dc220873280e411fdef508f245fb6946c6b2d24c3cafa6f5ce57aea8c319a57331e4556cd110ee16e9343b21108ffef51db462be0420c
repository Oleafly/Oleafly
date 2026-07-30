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
var _util = require("@rc-component/util");
var _clsx = require("clsx");
var _scrollIntoViewIfNeeded = _interopRequireDefault(require("scroll-into-view-if-needed"));
var _getScroll = _interopRequireDefault(require("../_util/getScroll"));
var _useMergeSemantic = require("../_util/hooks/useMergeSemantic");
var _is = require("../_util/is");
var _scrollTo = _interopRequireDefault(require("../_util/scrollTo"));
var _warning = require("../_util/warning");
var _affix = _interopRequireDefault(require("../affix"));
var _context = require("../config-provider/context");
var _useCSSVarCls = _interopRequireDefault(require("../config-provider/hooks/useCSSVarCls"));
var _AnchorLink = _interopRequireDefault(require("./AnchorLink"));
var _context2 = _interopRequireDefault(require("./context"));
var _style = _interopRequireDefault(require("./style"));
function getDefaultContainer() {
  return window;
}
function getOffsetTop(element, container) {
  if (!element.getClientRects().length) {
    return 0;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width || rect.height) {
    if (container === window) {
      return rect.top - element.ownerDocument.documentElement.clientTop;
    }
    return rect.top - container.getBoundingClientRect().top;
  }
  return rect.top;
}
const sharpMatcherRegex = /#([^\t\r\n\f\v]+)$/;
const Anchor = props => {
  const {
    rootClassName,
    prefixCls: customPrefixCls,
    className,
    style,
    offsetTop,
    affix = true,
    showInkInFixed = false,
    children,
    items,
    direction: anchorDirection = 'vertical',
    bounds,
    targetOffset,
    onClick,
    onChange,
    getContainer,
    getCurrentAnchor,
    replace,
    classNames,
    styles
  } = props;
  // =================== Warning =====================
  if (process.env.NODE_ENV !== 'production') {
    const warning = (0, _warning.devUseWarning)('Anchor');
    warning.deprecated(!children, 'Anchor children', 'items');
    process.env.NODE_ENV !== "production" ? warning(!(anchorDirection === 'horizontal' && items?.some(n => 'children' in n)), 'usage', '`Anchor items#children` is not supported when `Anchor` direction is horizontal.') : void 0;
  }
  const [links, setLinks] = React.useState([]);
  const [activeLink, setActiveLink] = React.useState(null);
  const activeLinkRef = React.useRef(activeLink);
  const wrapperRef = React.useRef(null);
  const spanLinkNodeRef = React.useRef(null);
  const animatingRef = React.useRef(false);
  const scrollRequestIdRef = React.useRef(null);
  const linkTargetOffsetRef = React.useRef({});
  const {
    direction,
    getPrefixCls,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles
  } = (0, _context.useComponentConfig)('anchor');
  const {
    getTargetContainer
  } = React.useContext(_context.ConfigContext);
  const prefixCls = getPrefixCls('anchor', customPrefixCls);
  const rootCls = (0, _useCSSVarCls.default)(prefixCls);
  const [hashId, cssVarCls] = (0, _style.default)(prefixCls, rootCls);
  const getCurrentContainer = getContainer ?? getTargetContainer ?? getDefaultContainer;
  const dependencyListItem = JSON.stringify(links);
  const registerLink = (link, newTargetOffset) => {
    setLinks(prev => {
      if (!prev.includes(link)) {
        return [].concat((0, _toConsumableArray2.default)(prev), [link]);
      }
      return prev;
    });
    // Store link-level targetOffset for scroll detection
    if (newTargetOffset !== undefined) {
      linkTargetOffsetRef.current[link] = newTargetOffset;
    }
  };
  const unregisterLink = link => {
    setLinks(prev => prev.filter(i => i !== link));
    // Clean up targetOffset when unregistering
    delete linkTargetOffsetRef.current[link];
  };
  const updateInk = () => {
    const linkNode = wrapperRef.current?.querySelector(`.${prefixCls}-link-title-active`);
    if (linkNode && spanLinkNodeRef.current) {
      const {
        style: inkStyle
      } = spanLinkNodeRef.current;
      const horizontalAnchor = anchorDirection === 'horizontal';
      inkStyle.top = horizontalAnchor ? '' : `${linkNode.offsetTop + linkNode.clientHeight / 2}px`;
      inkStyle.height = horizontalAnchor ? '' : `${linkNode.clientHeight}px`;
      inkStyle.left = horizontalAnchor ? `${linkNode.offsetLeft}px` : '';
      inkStyle.width = horizontalAnchor ? `${linkNode.clientWidth}px` : '';
      if (horizontalAnchor) {
        (0, _scrollIntoViewIfNeeded.default)(linkNode, {
          scrollMode: 'if-needed',
          block: 'nearest'
        });
      }
    }
  };
  const getInternalCurrentAnchor = (_links, _offsetTop, _bounds = 5, _linkTargetOffset) => {
    const linkSections = [];
    const container = getCurrentContainer();
    _links.forEach(link => {
      const sharpLinkMatch = sharpMatcherRegex.exec(link?.toString());
      if (!sharpLinkMatch) {
        return;
      }
      const target = document.getElementById(sharpLinkMatch[1]);
      if (target) {
        // Use link-level targetOffset if provided, otherwise use global offsetTop
        const linkOffsetTop = _linkTargetOffset?.[link] ?? _offsetTop;
        const top = getOffsetTop(target, container);
        if (top <= linkOffsetTop + _bounds) {
          linkSections.push({
            link,
            top
          });
        }
      }
    });
    if (linkSections.length) {
      const maxSection = linkSections.reduce((prev, curr) => curr.top > prev.top ? curr : prev);
      return maxSection.link;
    }
    return '';
  };
  const setCurrentActiveLink = (0, _util.useEvent)(link => {
    // FIXME: Seems a bug since this compare is not equals
    // `activeLinkRef` is parsed value which will always trigger `onChange` event.
    if (activeLinkRef.current === link) {
      return;
    }
    // https://github.com/ant-design/ant-design/issues/30584
    const newLink = (0, _is.isFunction)(getCurrentAnchor) ? getCurrentAnchor(link) : link;
    setActiveLink(newLink);
    activeLinkRef.current = newLink;
    // onChange should respect the original link (which may caused by
    // window scroll or user click), not the new link
    onChange?.(link);
  });
  const handleScroll = React.useCallback(() => {
    if (animatingRef.current) {
      return;
    }
    const currentActiveLink = getInternalCurrentAnchor(links, (0, _is.isNumber)(targetOffset) ? targetOffset : offsetTop || 0, bounds, linkTargetOffsetRef.current);
    setCurrentActiveLink(currentActiveLink);
  }, [links, targetOffset, offsetTop, bounds]);
  const handleScrollTo = React.useCallback((link, targetOffsetParams) => {
    const previousActiveLink = activeLinkRef.current;
    setCurrentActiveLink(link);
    const sharpLinkMatch = sharpMatcherRegex.exec(link);
    if (!sharpLinkMatch) {
      return;
    }
    const targetElement = document.getElementById(sharpLinkMatch[1]);
    if (!targetElement) {
      return;
    }
    if (animatingRef.current) {
      if (previousActiveLink === link) {
        return;
      }
      scrollRequestIdRef.current?.();
    }
    const container = getCurrentContainer();
    const scrollTop = (0, _getScroll.default)(container);
    const eleOffsetTop = getOffsetTop(targetElement, container);
    let y = scrollTop + eleOffsetTop;
    const finalTargetOffset = targetOffsetParams ?? targetOffset ?? offsetTop ?? 0;
    y -= finalTargetOffset;
    animatingRef.current = true;
    scrollRequestIdRef.current = (0, _scrollTo.default)(y, {
      getContainer: getCurrentContainer,
      callback() {
        animatingRef.current = false;
      }
    });
  }, [targetOffset, offsetTop]);
  // =========== Merged Props for Semantic ==========
  const mergedProps = {
    ...props,
    direction: anchorDirection
  };
  const contextStyleRoot = (0, _useMergeSemantic.useSemanticRootStyle)(contextStyle);
  const styleRoot = (0, _useMergeSemantic.useSemanticRootStyle)(style);
  const [mergedClassNames, mergedStyles] = (0, _useMergeSemantic.useMergeSemantic)([contextClassNames, classNames], [contextStyles, contextStyleRoot, styles, styleRoot], {
    props: mergedProps
  });
  const wrapperClass = (0, _clsx.clsx)(hashId, cssVarCls, rootCls, rootClassName, `${prefixCls}-wrapper`, {
    [`${prefixCls}-wrapper-horizontal`]: anchorDirection === 'horizontal',
    [`${prefixCls}-rtl`]: direction === 'rtl'
  }, className, contextClassName, mergedClassNames.root);
  const anchorClass = (0, _clsx.clsx)(prefixCls, {
    [`${prefixCls}-fixed`]: !affix && !showInkInFixed
  });
  const inkClass = (0, _clsx.clsx)(`${prefixCls}-ink`, mergedClassNames.indicator, {
    [`${prefixCls}-ink-visible`]: activeLink
  });
  const wrapperStyle = {
    maxHeight: offsetTop ? `calc(100vh - ${offsetTop}px)` : '100vh',
    ...mergedStyles.root
  };
  const createNestedLink = options => Array.isArray(options) ? options.map(item => (/*#__PURE__*/React.createElement(_AnchorLink.default, {
    replace: replace,
    ...item,
    key: item.key
  }, anchorDirection === 'vertical' && createNestedLink(item.children)))) : null;
  const anchorContent = /*#__PURE__*/React.createElement("div", {
    ref: wrapperRef,
    className: wrapperClass,
    style: wrapperStyle
  }, /*#__PURE__*/React.createElement("div", {
    className: anchorClass
  }, /*#__PURE__*/React.createElement("span", {
    className: inkClass,
    ref: spanLinkNodeRef,
    style: mergedStyles.indicator
  }), 'items' in props ? createNestedLink(items) : children));
  React.useEffect(() => {
    const scrollContainer = getCurrentContainer();
    handleScroll();
    scrollContainer?.addEventListener('scroll', handleScroll);
    return () => {
      scrollContainer?.removeEventListener('scroll', handleScroll);
    };
  }, [dependencyListItem]);
  React.useEffect(() => {
    if ((0, _is.isFunction)(getCurrentAnchor)) {
      setCurrentActiveLink(getCurrentAnchor(activeLinkRef.current || ''));
    }
  }, [getCurrentAnchor]);
  React.useEffect(() => {
    updateInk();
  }, [anchorDirection, getCurrentAnchor, dependencyListItem, activeLink]);
  const memoizedContextValue = React.useMemo(() => ({
    registerLink,
    unregisterLink,
    scrollTo: handleScrollTo,
    activeLink,
    onClick,
    direction: anchorDirection,
    classNames: mergedClassNames,
    styles: mergedStyles
  }), [activeLink, onClick, handleScrollTo, anchorDirection, mergedStyles, mergedClassNames]);
  const affixProps = (0, _is.isPlainObject)(affix) ? affix : undefined;
  return /*#__PURE__*/React.createElement(_context2.default.Provider, {
    value: memoizedContextValue
  }, affix ? (/*#__PURE__*/React.createElement(_affix.default, {
    offsetTop: offsetTop,
    target: getCurrentContainer,
    ...affixProps
  }, anchorContent)) : anchorContent);
};
if (process.env.NODE_ENV !== 'production') {
  Anchor.displayName = 'Anchor';
}
var _default = exports.default = Anchor;