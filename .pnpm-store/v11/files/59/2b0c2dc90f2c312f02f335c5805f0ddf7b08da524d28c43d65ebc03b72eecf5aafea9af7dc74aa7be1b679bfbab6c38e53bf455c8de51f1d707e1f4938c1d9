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

// src/index.ts
function is(value) {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "bigint":
      return "bigint";
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    case "symbol":
      return "symbol";
    case "undefined":
      return "undefined";
    default:
  }
  if (isArray(value)) {
    return "Array";
  }
  if (isPlainFunction(value)) {
    return "Function";
  }
  const tagType = getObjectType(value);
  if (tagType) {
    return tagType;
  }
  return "Object";
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
var index_default = is;
export {
  index_default as default
};
/* v8 ignore next -- @preserve */
//# sourceMappingURL=index.mjs.map