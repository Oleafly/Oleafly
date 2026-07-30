"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _util = require("@rc-component/util");
var _is = require("../_util/is");
var _warning = require("../_util/warning");
var _Base = _interopRequireDefault(require("./Base"));
const Text = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    ellipsis,
    children,
    ...restProps
  } = props;
  const mergedEllipsis = React.useMemo(() => {
    if ((0, _is.isPlainObject)(ellipsis)) {
      return (0, _util.omit)(ellipsis, ['expandable', 'rows']);
    }
    return ellipsis;
  }, [ellipsis]);
  if (process.env.NODE_ENV !== 'production') {
    const warning = (0, _warning.devUseWarning)('Typography.Text');
    process.env.NODE_ENV !== "production" ? warning(!(0, _is.isPlainObject)(ellipsis) || !('expandable' in ellipsis) && !('rows' in ellipsis), 'usage', '`ellipsis` do not support `expandable` or `rows` props.') : void 0;
  }
  return /*#__PURE__*/React.createElement(_Base.default, {
    ref: ref,
    ...restProps,
    ellipsis: mergedEllipsis,
    component: "span"
  }, children);
});
var _default = exports.default = Text;