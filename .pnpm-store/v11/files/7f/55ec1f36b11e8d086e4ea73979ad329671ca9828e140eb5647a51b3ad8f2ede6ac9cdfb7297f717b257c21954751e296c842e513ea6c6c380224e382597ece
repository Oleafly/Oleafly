"use strict";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useRefs;
var React = _interopRequireWildcard(require("react"));
function useRefs() {
  const ref = React.useRef(null);
  if (ref.current === null) {
    ref.current = new Map();
  }
  const setRef = (key, element) => {
    ref.current.set(key, element);
  };
  const getRef = key => ref.current.get(key);
  return [setRef, getRef];
}