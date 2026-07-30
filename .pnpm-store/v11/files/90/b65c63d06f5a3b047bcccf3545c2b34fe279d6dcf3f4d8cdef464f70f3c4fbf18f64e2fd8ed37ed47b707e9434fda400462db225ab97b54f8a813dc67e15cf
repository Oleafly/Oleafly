"use strict";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.fastComponent = fastComponent;
exports.fastComponentRef = fastComponentRef;
exports.getInstance = getInstance;
exports.register = register;
exports.setInstance = setInstance;
var React = _interopRequireWildcard(require("react"));
var _useRefWithInit = require("./useRefWithInit");
const hooks = [];
let currentInstance = undefined;
function getInstance() {
  return currentInstance;
}
function setInstance(instance) {
  currentInstance = instance;
}
function register(hook) {
  hooks.push(hook);
}
function fastComponent(fn) {
  const FastComponent = (props, forwardedRef) => {
    const instance = (0, _useRefWithInit.useRefWithInit)(createInstance).current;
    let result;
    try {
      currentInstance = instance;
      for (const hook of hooks) {
        hook.before(instance);
      }
      result = fn(props, forwardedRef);
      for (const hook of hooks) {
        hook.after(instance);
      }
      instance.didInitialize = true;
    } finally {
      currentInstance = undefined;
    }
    return result;
  };
  FastComponent.displayName = fn.displayName || fn.name;
  return FastComponent;
}
function fastComponentRef(fn) {
  return /*#__PURE__*/React.forwardRef(fastComponent(fn));
}
function createInstance() {
  return {
    didInitialize: false
  };
}