/* eslint-disable @typescript-eslint/no-unsafe-function-type */

import { getObjectType, isObjectOfType, isOfType, isPrimitiveType } from './helpers';
import type { Class, PlainObject, Primitive } from './types';

const DOM_PROPERTIES_TO_CHECK = [
  'innerHTML',
  'ownerDocument',
  'style',
  'attributes',
  'nodeValue',
] as const;

export const isArray = <T = unknown>(value: unknown): value is T[] => Array.isArray(value);

export const isAsyncGeneratorFunction = (value: unknown): value is AsyncGeneratorFunction =>
  getObjectType(value) === 'AsyncGeneratorFunction';

export const isAsyncFunction = /*#__PURE__*/ isObjectOfType<Function>('AsyncFunction');

export const isBigInt = /*#__PURE__*/ isOfType<bigint>('bigint');

export const isBoolean = (value: unknown): value is boolean => {
  return value === true || value === false;
};

export const isDate = /*#__PURE__*/ isObjectOfType<Date>('Date');

export const isError = /*#__PURE__*/ isObjectOfType<Error>('Error');

export const isFunction = /*#__PURE__*/ isOfType<Function>('function');

export const isGeneratorFunction =
  /*#__PURE__*/ isObjectOfType<GeneratorFunction>('GeneratorFunction');

export const isInteger = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isInteger(value);
};

export const isMap = /*#__PURE__*/ isObjectOfType<Map<unknown, unknown>>('Map');

export const isNan = (value: unknown): value is number => {
  return Number.isNaN(value as number);
};

export const isNull = (value: unknown): value is null => {
  return value === null;
};

export const isPlainFunction = /*#__PURE__*/ isObjectOfType<Function>('Function');

export const isPromise = /*#__PURE__*/ isObjectOfType<Promise<unknown>>('Promise');

export const isRegexp = /*#__PURE__*/ isObjectOfType<RegExp>('RegExp');

export const isSet = /*#__PURE__*/ isObjectOfType<Set<unknown>>('Set');

export const isString = /*#__PURE__*/ isOfType<string>('string');

export const isSymbol = /*#__PURE__*/ isOfType<symbol>('symbol');

export const isUndefined = /*#__PURE__*/ isOfType<undefined>('undefined');

export const isWeakMap = /*#__PURE__*/ isObjectOfType<WeakMap<PlainObject, unknown>>('WeakMap');

export const isWeakSet = /*#__PURE__*/ isObjectOfType<WeakSet<PlainObject>>('WeakSet');

// Functions with internal dependencies

export const isNullOrUndefined = (value: unknown): value is null | undefined => {
  return isNull(value) || isUndefined(value);
};

export const isDefined = <T>(value: T): value is Exclude<T, undefined> => !isUndefined(value);

export const isNumber = (value: unknown): value is number => {
  return isOfType<number>('number')(value) && !isNan(value);
};

export const isNonEmptyString = (value: unknown): value is string => {
  return isString(value) && value.trim().length > 0;
};

export const isNumericString = (value: unknown): value is string => {
  if (!isString(value) || value.length === 0) {
    return false;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 && Number.isFinite(Number(trimmed));
};

export const isObject = (value: unknown): value is object => {
  return !isNullOrUndefined(value) && (isFunction(value) || typeof value === 'object');
};

export const isPlainObject = (value: unknown): value is PlainObject => {
  if (getObjectType(value) !== 'Object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === null || prototype === Object.getPrototypeOf({});
};

export const isPrimitive = (value: unknown): value is Primitive =>
  isNull(value) || isPrimitiveType(typeof value);

export const isUrl = (value: unknown): value is URL => {
  return getObjectType(value) === 'URL';
};

export const isIterable = (value: unknown): value is IterableIterator<unknown> => {
  return (
    !isNullOrUndefined(value) && isFunction((value as IterableIterator<unknown>)[Symbol.iterator])
  );
};

export const isGenerator = (value: unknown): value is Generator => {
  return (
    isIterable(value) &&
    isFunction((value as IterableIterator<unknown>).next) &&
    isFunction((value as IterableIterator<unknown>).throw)
  );
};

export const isClass = (value: unknown): value is Class => {
  return isFunction(value) && /^class\s/.test(value.toString());
};

export const isArrayOf = (target: unknown[], predicate: (v: unknown) => boolean): boolean => {
  if (!isArray(target) || !isFunction(predicate)) {
    return false;
  }

  return target.every(d => predicate(d));
};

export const isDomElement = (value: unknown): value is HTMLElement => {
  return (
    isObject(value) &&
    !isPlainObject(value) &&
    (value as HTMLElement).nodeType === 1 &&
    isString((value as HTMLElement).nodeName) &&
    DOM_PROPERTIES_TO_CHECK.every(property => property in (value as HTMLElement))
  );
};

export const isEmpty = (value: unknown): boolean => {
  return (
    (isString(value) && value.length === 0) ||
    (isArray(value) && value.length === 0) ||
    (isObject(value) && !isMap(value) && !isSet(value) && Object.keys(value).length === 0) ||
    (isSet(value) && value.size === 0) ||
    (isMap(value) && value.size === 0)
  );
};

export const isInstanceOf = <T>(instance: unknown, class_: Class<T>): instance is T => {
  if (!instance || !(class_ as Class<T>)) {
    return false;
  }

  return Object.getPrototypeOf(instance) === class_.prototype;
};

export const isOneOf = (target: unknown[], value: any): boolean => {
  if (!isArray(target)) {
    return false;
  }

  // eslint-disable-next-line unicorn/prefer-includes
  return target.indexOf(value) > -1;
};

export const isPropertyOf = (
  target: PlainObject,
  key: string,
  predicate?: (v: unknown) => boolean,
): boolean => {
  if (!isObject(target) || !key) {
    return false;
  }

  const value = target[key];

  if (isFunction(predicate)) {
    return predicate(value);
  }

  return isDefined(value);
};
