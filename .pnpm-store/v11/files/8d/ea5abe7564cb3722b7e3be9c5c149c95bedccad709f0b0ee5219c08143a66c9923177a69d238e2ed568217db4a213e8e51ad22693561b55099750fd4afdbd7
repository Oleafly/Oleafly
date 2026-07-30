"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/standalone.ts
var standalone_exports = {};
__export(standalone_exports, {
  isArray: () => isArray,
  isArrayOf: () => isArrayOf,
  isAsyncFunction: () => isAsyncFunction,
  isAsyncGeneratorFunction: () => isAsyncGeneratorFunction,
  isBigInt: () => isBigInt,
  isBoolean: () => isBoolean,
  isClass: () => isClass,
  isDate: () => isDate,
  isDefined: () => isDefined,
  isDomElement: () => isDomElement,
  isEmpty: () => isEmpty,
  isError: () => isError,
  isFunction: () => isFunction,
  isGenerator: () => isGenerator,
  isGeneratorFunction: () => isGeneratorFunction,
  isInstanceOf: () => isInstanceOf,
  isInteger: () => isInteger,
  isIterable: () => isIterable,
  isMap: () => isMap,
  isNan: () => isNan,
  isNonEmptyString: () => isNonEmptyString,
  isNull: () => isNull,
  isNullOrUndefined: () => isNullOrUndefined,
  isNumber: () => isNumber,
  isNumericString: () => isNumericString,
  isObject: () => isObject,
  isOneOf: () => isOneOf,
  isPlainFunction: () => isPlainFunction,
  isPlainObject: () => isPlainObject,
  isPrimitive: () => isPrimitive,
  isPromise: () => isPromise,
  isPropertyOf: () => isPropertyOf,
  isRegexp: () => isRegexp,
  isSet: () => isSet,
  isString: () => isString,
  isSymbol: () => isSymbol,
  isUndefined: () => isUndefined,
  isUrl: () => isUrl,
  isWeakMap: () => isWeakMap,
  isWeakSet: () => isWeakSet
});
module.exports = __toCommonJS(standalone_exports);

// src/helpers.ts
var objectTypes = [
  "Array",
  "ArrayBuffer",
  "AsyncFunction",
  "AsyncGenerator",
  "AsyncGeneratorFunction",
  "Date",
  "Error",
  "Function",
  "Generator",
  "GeneratorFunction",
  "HTMLElement",
  "Map",
  "Object",
  "Promise",
  "RegExp",
  "Set",
  "URL",
  "WeakMap",
  "WeakSet"
];
var primitiveTypes = [
  "bigint",
  "boolean",
  "null",
  "number",
  "string",
  "symbol",
  "undefined"
];
function getObjectType(value) {
  const objectTypeName = Object.prototype.toString.call(value).slice(8, -1);
  if (/HTML\w+Element/.test(objectTypeName)) {
    return "HTMLElement";
  }
  if (isObjectType(objectTypeName)) {
    return objectTypeName;
  }
  return void 0;
}
function isObjectOfType(type) {
  return (value) => getObjectType(value) === type;
}
function isObjectType(name) {
  return objectTypes.includes(name);
}
function isOfType(type) {
  return (value) => typeof value === type;
}
function isPrimitiveType(name) {
  return primitiveTypes.includes(name);
}

// src/standalone.ts
var DOM_PROPERTIES_TO_CHECK = [
  "innerHTML",
  "ownerDocument",
  "style",
  "attributes",
  "nodeValue"
];
var isArray = (value) => Array.isArray(value);
var isAsyncGeneratorFunction = (value) => getObjectType(value) === "AsyncGeneratorFunction";
var isAsyncFunction = /* @__PURE__ */ isObjectOfType("AsyncFunction");
var isBigInt = /* @__PURE__ */ isOfType("bigint");
var isBoolean = (value) => {
  return value === true || value === false;
};
var isDate = /* @__PURE__ */ isObjectOfType("Date");
var isError = /* @__PURE__ */ isObjectOfType("Error");
var isFunction = /* @__PURE__ */ isOfType("function");
var isGeneratorFunction = /* @__PURE__ */ isObjectOfType("GeneratorFunction");
var isInteger = (value) => {
  return typeof value === "number" && Number.isInteger(value);
};
var isMap = /* @__PURE__ */ isObjectOfType("Map");
var isNan = (value) => {
  return Number.isNaN(value);
};
var isNull = (value) => {
  return value === null;
};
var isPlainFunction = /* @__PURE__ */ isObjectOfType("Function");
var isPromise = /* @__PURE__ */ isObjectOfType("Promise");
var isRegexp = /* @__PURE__ */ isObjectOfType("RegExp");
var isSet = /* @__PURE__ */ isObjectOfType("Set");
var isString = /* @__PURE__ */ isOfType("string");
var isSymbol = /* @__PURE__ */ isOfType("symbol");
var isUndefined = /* @__PURE__ */ isOfType("undefined");
var isWeakMap = /* @__PURE__ */ isObjectOfType("WeakMap");
var isWeakSet = /* @__PURE__ */ isObjectOfType("WeakSet");
var isNullOrUndefined = (value) => {
  return isNull(value) || isUndefined(value);
};
var isDefined = (value) => !isUndefined(value);
var isNumber = (value) => {
  return isOfType("number")(value) && !isNan(value);
};
var isNonEmptyString = (value) => {
  return isString(value) && value.trim().length > 0;
};
var isNumericString = (value) => {
  if (!isString(value) || value.length === 0) {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && Number.isFinite(Number(trimmed));
};
var isObject = (value) => {
  return !isNullOrUndefined(value) && (isFunction(value) || typeof value === "object");
};
var isPlainObject = (value) => {
  if (getObjectType(value) !== "Object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.getPrototypeOf({});
};
var isPrimitive = (value) => isNull(value) || isPrimitiveType(typeof value);
var isUrl = (value) => {
  return getObjectType(value) === "URL";
};
var isIterable = (value) => {
  return !isNullOrUndefined(value) && isFunction(value[Symbol.iterator]);
};
var isGenerator = (value) => {
  return isIterable(value) && isFunction(value.next) && isFunction(value.throw);
};
var isClass = (value) => {
  return isFunction(value) && /^class\s/.test(value.toString());
};
var isArrayOf = (target, predicate) => {
  if (!isArray(target) || !isFunction(predicate)) {
    return false;
  }
  return target.every((d) => predicate(d));
};
var isDomElement = (value) => {
  return isObject(value) && !isPlainObject(value) && value.nodeType === 1 && isString(value.nodeName) && DOM_PROPERTIES_TO_CHECK.every((property) => property in value);
};
var isEmpty = (value) => {
  return isString(value) && value.length === 0 || isArray(value) && value.length === 0 || isObject(value) && !isMap(value) && !isSet(value) && Object.keys(value).length === 0 || isSet(value) && value.size === 0 || isMap(value) && value.size === 0;
};
var isInstanceOf = (instance, class_) => {
  if (!instance || !class_) {
    return false;
  }
  return Object.getPrototypeOf(instance) === class_.prototype;
};
var isOneOf = (target, value) => {
  if (!isArray(target)) {
    return false;
  }
  return target.indexOf(value) > -1;
};
var isPropertyOf = (target, key, predicate) => {
  if (!isObject(target) || !key) {
    return false;
  }
  const value = target[key];
  if (isFunction(predicate)) {
    return predicate(value);
  }
  return isDefined(value);
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
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
  isWeakSet
});
//# sourceMappingURL=standalone.js.map