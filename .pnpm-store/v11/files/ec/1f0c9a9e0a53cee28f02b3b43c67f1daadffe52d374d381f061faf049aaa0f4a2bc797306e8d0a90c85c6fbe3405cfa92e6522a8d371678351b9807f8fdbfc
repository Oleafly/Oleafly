"use strict";
"use client";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useItemRender;
exports.renderItem = renderItem;
var React = _interopRequireWildcard(require("react"));
var _util = require("@rc-component/util");
var _clsx = require("clsx");
var _is = require("../_util/is");
function getBreadcrumbName(route, params) {
  if (!(0, _is.isReactRenderable)(route.title)) {
    return null;
  }
  const paramsKeys = Object.keys(params).join('|');
  return (0, _is.isPlainObject)(route.title) ? route.title : String(route.title).replace(new RegExp(`:(${paramsKeys})`, 'g'), (replacement, key) => params[key] || replacement);
}
function renderItem(prefixCls, item, children, href) {
  if (!(0, _is.isReactRenderable)(children)) {
    return null;
  }
  const {
    className,
    onClick,
    ...restItem
  } = item;
  const passedProps = {
    ...(0, _util.pickAttrs)(restItem, {
      data: true,
      aria: true
    }),
    onClick
  };
  if (href !== undefined) {
    return /*#__PURE__*/React.createElement("a", {
      ...passedProps,
      className: (0, _clsx.clsx)(`${prefixCls}-link`, className),
      href: href
    }, children);
  }
  return /*#__PURE__*/React.createElement("span", {
    ...passedProps,
    className: (0, _clsx.clsx)(`${prefixCls}-link`, className)
  }, children);
}
function useItemRender(prefixCls, itemRender) {
  const mergedItemRender = (item, params, routes, path, href) => {
    if (itemRender) {
      return itemRender(item, params, routes, path);
    }
    const name = getBreadcrumbName(item, params);
    return renderItem(prefixCls, item, name, href);
  };
  return mergedItemRender;
}