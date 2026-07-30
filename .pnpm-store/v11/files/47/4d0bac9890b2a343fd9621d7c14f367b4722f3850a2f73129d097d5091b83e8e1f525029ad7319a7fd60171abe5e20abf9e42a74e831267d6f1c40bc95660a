"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _react = _interopRequireDefault(require("react"));
var _clsx = require("clsx");
var _useMergeSemantic = require("../_util/hooks/useMergeSemantic");
var _is = require("../_util/is");
var _DescriptionsContext = _interopRequireDefault(require("./DescriptionsContext"));
const Cell = props => {
  const {
    itemPrefixCls,
    component,
    span,
    className,
    style,
    labelStyle,
    contentStyle,
    bordered,
    label,
    content,
    colon,
    type,
    styles,
    classNames
  } = props;
  const Component = component;
  const {
    classNames: contextClassNames,
    styles: contextStyles
  } = _react.default.useContext(_DescriptionsContext.default);
  const [mergedClassNames, mergedStyles] = (0, _useMergeSemantic.useMergeSemantic)([contextClassNames, classNames], [contextStyles, styles], {
    props
  });
  const mergedLabelStyle = {
    ...labelStyle,
    ...mergedStyles.label
  };
  const mergedContentStyle = {
    ...contentStyle,
    ...mergedStyles.content
  };
  if (bordered) {
    // The cell element (<th>/<td>) carries the `ant-descriptions-item-label`
    // or `ant-descriptions-item-content` class, so `labelStyle` /
    // `contentStyle` (and the semantic `styles.label` / `styles.content`)
    // must be applied to that cell rather than to the inner <span> wrapper.
    //
    // Both bordered paths in `Row.tsx` (horizontal and vertical) forward
    // the per-type merged style via `styles` and pass the raw item `style`
    // separately, so `Cell` can unconditionally merge `typeStyle` onto the
    // cell here without needing to know which branch produced it.
    let typeStyle;
    if (type === 'label') {
      typeStyle = mergedLabelStyle;
    }
    if (type === 'content') {
      typeStyle = mergedContentStyle;
    }
    const mergedCellStyle = typeStyle ? {
      ...style,
      ...typeStyle
    } : style;
    return /*#__PURE__*/_react.default.createElement(Component, {
      colSpan: span,
      style: mergedCellStyle,
      className: (0, _clsx.clsx)(className, {
        [`${itemPrefixCls}-item-${type}`]: type === 'label' || type === 'content',
        [mergedClassNames.label]: mergedClassNames.label && type === 'label',
        [mergedClassNames.content]: mergedClassNames.content && type === 'content'
      })
    }, (0, _is.isReactRenderable)(label) && /*#__PURE__*/_react.default.createElement("span", null, label), (0, _is.isReactRenderable)(content) && /*#__PURE__*/_react.default.createElement("span", null, content));
  }
  return /*#__PURE__*/_react.default.createElement(Component, {
    className: (0, _clsx.clsx)(`${itemPrefixCls}-item`, className),
    style: style,
    colSpan: span
  }, /*#__PURE__*/_react.default.createElement("div", {
    className: `${itemPrefixCls}-item-container`
  }, (0, _is.isReactRenderable)(label) && (/*#__PURE__*/_react.default.createElement("span", {
    style: mergedLabelStyle,
    className: (0, _clsx.clsx)(`${itemPrefixCls}-item-label`, mergedClassNames.label, {
      [`${itemPrefixCls}-item-no-colon`]: !colon
    })
  }, label)), (0, _is.isReactRenderable)(content) && (/*#__PURE__*/_react.default.createElement("span", {
    style: mergedContentStyle,
    className: (0, _clsx.clsx)(`${itemPrefixCls}-item-content`, mergedClassNames.content)
  }, content))));
};
var _default = exports.default = Cell;