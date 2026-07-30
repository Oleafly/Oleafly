"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _react = _interopRequireDefault(require("react"));
var _util = require("@rc-component/util");
var _reactNode = require("../../_util/reactNode");
/**
 * Merge the child ref with an internal ref and expose the resolved DOM node.
 *
 * @returns A tuple containing the renderable child node and the DOM node resolved from its ref.
 */
const useChildDom = children => {
  const [domNode, setDomNode] = _react.default.useState(null);
  const childNode = /*#__PURE__*/_react.default.isValidElement(children) ? children : null;
  const internalRef = _react.default.useCallback(node => {
    const nextDom = (0, _util.getDOM)(node);
    setDomNode(prevDom => prevDom === nextDom ? prevDom : nextDom);
  }, []);
  const mergedRef = (0, _util.useComposeRef)(childNode ? (0, _util.getNodeRef)(childNode) : null, internalRef);
  if (!childNode || !(0, _util.supportRef)(childNode)) {
    return [children, domNode];
  }
  return [(0, _reactNode.cloneElement)(childNode, {
    ref: mergedRef
  }), domNode];
};
var _default = exports.default = useChildDom;