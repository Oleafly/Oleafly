"use strict";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _util = require("@rc-component/util");
var _is = require("../../_util/is");
var _context = require("../context");
const useItemRef = () => {
  const {
    itemRef
  } = React.useContext(_context.FormContext);
  const cacheRef = React.useRef({});
  const getRef = (name, children) => {
    // Outer caller already check the `supportRef`
    const childrenRef = children && (0, _is.isPlainObject)(children) && (0, _util.getNodeRef)(children);
    const nameStr = name.join('_');
    if (cacheRef.current.name !== nameStr || cacheRef.current.originRef !== childrenRef) {
      cacheRef.current.name = nameStr;
      cacheRef.current.originRef = childrenRef;
      cacheRef.current.ref = (0, _util.composeRef)(itemRef(name), childrenRef);
    }
    return cacheRef.current.ref;
  };
  return getRef;
};
var _default = exports.default = useItemRef;