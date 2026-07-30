export const isNonNullable = val => {
  return val !== undefined && val !== null;
};
export const isReactRenderable = val => {
  return isNonNullable(val) && val !== false && val !== '';
};
export const isNumber = val => {
  return typeof val === 'number' && !Number.isNaN(val);
};
export const isString = val => {
  return typeof val === 'string';
};
export const isPlainObject = val => {
  return val !== null && typeof val === 'object';
};
export const isFunction = val => {
  return typeof val === 'function';
};
export const isThenable = val => {
  return isNonNullable(val) && isFunction(val.then);
};
export const isPrimitive = val => {
  return typeof val !== 'object' && !isFunction(val) || val === null;
};
export const isTransitionEvent = event => {
  return isPlainObject(event) && 'propertyName' in event && isString(event.propertyName);
};