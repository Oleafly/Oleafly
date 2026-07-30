import { isFunction, isReactRenderable } from './is';
export const getRenderPropValue = propValue => {
  if (!isReactRenderable(propValue)) {
    return null;
  }
  return isFunction(propValue) ? propValue() : propValue;
};