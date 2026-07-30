"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useTypographySemantic = void 0;
var _react = require("react");
var _useMergeSemantic = require("../../_util/hooks/useMergeSemantic");
var _context = require("../../config-provider/context");
const useTypographySemantic = (customizePrefixCls, classNames, styles, typographyDirection, props) => {
  const {
    getPrefixCls,
    direction: contextDirection,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles
  } = (0, _context.useComponentConfig)('typography');
  const direction = typographyDirection ?? contextDirection;
  const prefixCls = getPrefixCls('typography', customizePrefixCls);
  const mergedProps = {
    ...props,
    prefixCls,
    direction
  };
  const contextClassNamesObject = (0, _react.useMemo)(() => ({
    root: contextClassName
  }), [contextClassName]);
  const contextStylesObject = (0, _react.useMemo)(() => ({
    root: contextStyle
  }), [contextStyle]);
  const [mergedClassNames, mergedStyles] = (0, _useMergeSemantic.useMergeSemantic)([contextClassNamesObject, contextClassNames, classNames], [contextStylesObject, contextStyles, styles], {
    props: mergedProps
  });
  return [mergedClassNames, mergedStyles, prefixCls, direction];
};
exports.useTypographySemantic = useTypographySemantic;