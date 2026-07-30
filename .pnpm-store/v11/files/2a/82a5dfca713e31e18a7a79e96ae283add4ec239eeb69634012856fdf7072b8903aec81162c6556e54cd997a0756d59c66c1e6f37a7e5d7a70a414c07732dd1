import * as React from 'react';
import { useRefWithInit } from "./useRefWithInit.mjs";
const hooks = [];
let currentInstance = undefined;
export function getInstance() {
  return currentInstance;
}
export function setInstance(instance) {
  currentInstance = instance;
}
export function register(hook) {
  hooks.push(hook);
}
export function fastComponent(fn) {
  const FastComponent = (props, forwardedRef) => {
    const instance = useRefWithInit(createInstance).current;
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
export function fastComponentRef(fn) {
  return /*#__PURE__*/React.forwardRef(fastComponent(fn));
}
function createInstance() {
  return {
    didInitialize: false
  };
}