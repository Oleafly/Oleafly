import { getObjectType } from './helpers';
import {
  isArray,
  isArrayOf,
  isAsyncFunction,
  isAsyncGeneratorFunction,
  isBigInt,
  isBoolean,
  isClass,
  isDate,
  isDefined,
  isDomElement,
  isEmpty,
  isError,
  isFunction,
  isGenerator,
  isGeneratorFunction,
  isInstanceOf,
  isInteger,
  isIterable,
  isMap,
  isNan,
  isNonEmptyString,
  isNull,
  isNullOrUndefined,
  isNumber,
  isNumericString,
  isObject,
  isOneOf,
  isPlainFunction,
  isPlainObject,
  isPrimitive,
  isPromise,
  isPropertyOf,
  isRegexp,
  isSet,
  isString,
  isSymbol,
  isUndefined,
  isUrl,
  isWeakMap,
  isWeakSet,
} from './standalone';
import type { TypeName } from './types';

function is(value: unknown): TypeName {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'bigint':
      return 'bigint';
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'string':
      return 'string';
    case 'symbol':
      return 'symbol';
    case 'undefined':
      return 'undefined';
    default:
  }

  if (isArray(value)) {
    return 'Array';
  }

  if (isPlainFunction(value)) {
    return 'Function';
  }

  const tagType = getObjectType(value);

  /* v8 ignore next -- @preserve */
  if (tagType) {
    return tagType;
  }

  /* v8 ignore next -- @preserve */
  return 'Object';
}

is.array = isArray;
is.arrayOf = isArrayOf;
is.asyncGeneratorFunction = isAsyncGeneratorFunction;
is.asyncFunction = isAsyncFunction;
is.bigint = isBigInt;
is.boolean = isBoolean;
is.class = isClass;
is.date = isDate;
is.defined = isDefined;
is.domElement = isDomElement;
is.empty = isEmpty;
is.error = isError;
is.function = isFunction;
is.generator = isGenerator;
is.generatorFunction = isGeneratorFunction;
is.instanceOf = isInstanceOf;
is.integer = isInteger;
is.iterable = isIterable;
is.map = isMap;
is.nan = isNan;
is.null = isNull;
is.nullOrUndefined = isNullOrUndefined;
is.nonEmptyString = isNonEmptyString;
is.number = isNumber;
is.numericString = isNumericString;
is.object = isObject;
is.oneOf = isOneOf;
is.plainFunction = isPlainFunction;
is.plainObject = isPlainObject;
is.primitive = isPrimitive;
is.promise = isPromise;
is.propertyOf = isPropertyOf;
is.regexp = isRegexp;
is.set = isSet;
is.string = isString;
is.symbol = isSymbol;
is.undefined = isUndefined;
is.url = isUrl;
is.weakMap = isWeakMap;
is.weakSet = isWeakSet;

export default is;
