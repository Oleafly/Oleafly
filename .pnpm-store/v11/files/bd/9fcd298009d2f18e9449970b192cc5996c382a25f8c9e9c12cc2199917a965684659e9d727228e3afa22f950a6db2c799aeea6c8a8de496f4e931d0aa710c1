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

// src/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => equal
});
module.exports = __toCommonJS(index_exports);

// src/helpers.ts
function isOfType(type) {
  return (value) => typeof value === type;
}
var isFunction = isOfType("function");
var isNull = (value) => {
  return value === null;
};
var isRegex = (value) => {
  return Object.prototype.toString.call(value).slice(8, -1) === "RegExp";
};
var isObject = (value) => {
  return !isUndefined(value) && !isNull(value) && (isFunction(value) || typeof value === "object");
};
var isUndefined = isOfType("undefined");

// src/index.ts
function compareObjects(left, right, seen) {
  if (hasSeen(seen, left, right)) {
    return true;
  }
  markSeen(seen, left, right);
  if (left.constructor !== right.constructor) {
    return false;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return equalArray(left, right, seen);
  }
  if (left instanceof Map && right instanceof Map) {
    return equalMap(left, right, seen);
  }
  if (left instanceof Set && right instanceof Set) {
    return equalSet(left, right);
  }
  if (left instanceof WeakMap || left instanceof WeakSet) {
    return false;
  }
  if (ArrayBuffer.isView(left) && ArrayBuffer.isView(right)) {
    return equalArrayBuffer(left, right);
  }
  if (isRegex(left) && isRegex(right)) {
    return left.source === right.source && left.flags === right.flags;
  }
  if (left instanceof Error && right instanceof Error) {
    return equalError(left, right, seen);
  }
  if (left.valueOf !== Object.prototype.valueOf) {
    return left.valueOf() === right.valueOf();
  }
  if (left.toString !== Object.prototype.toString) {
    return left.toString() === right.toString();
  }
  return equalPlainObject(left, right, seen);
}
function compareValues(left, right, seen) {
  if (left === right) {
    return true;
  }
  if (Number.isNaN(left) && Number.isNaN(right)) {
    return true;
  }
  if (!left || !isObject(left) || !right || !isObject(right)) {
    return false;
  }
  return compareObjects(left, right, seen);
}
function equalArray(left, right, seen) {
  const { length } = left;
  if (length !== right.length) {
    return false;
  }
  for (let index = length; index-- !== 0; ) {
    if (!compareValues(left[index], right[index], seen)) {
      return false;
    }
  }
  return true;
}
function equalArrayBuffer(left, right) {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  const view1 = new DataView(left.buffer);
  const view2 = new DataView(right.buffer);
  let index = left.byteLength;
  while (index--) {
    if (view1.getUint8(index) !== view2.getUint8(index)) {
      return false;
    }
  }
  return true;
}
function equalError(left, right, seen) {
  return left.message === right.message && left.name === right.name && compareValues(left.cause, right.cause, seen);
}
function equalMap(left, right, seen) {
  if (left.size !== right.size) {
    return false;
  }
  for (const entry of left.entries()) {
    if (!right.has(entry[0])) {
      return false;
    }
  }
  for (const entry of left.entries()) {
    if (!compareValues(entry[1], right.get(entry[0]), seen)) {
      return false;
    }
  }
  return true;
}
function equalPlainObject(left, right, seen) {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) {
    return false;
  }
  for (let index = leftKeys.length; index-- !== 0; ) {
    if (!Object.prototype.hasOwnProperty.call(right, leftKeys[index])) {
      return false;
    }
  }
  for (let index = leftKeys.length; index-- !== 0; ) {
    const key = leftKeys[index];
    if (key === "_owner" && left.$$typeof) {
      continue;
    }
    if (!compareValues(left[key], right[key], seen)) {
      return false;
    }
  }
  return true;
}
function equalSet(left, right) {
  if (left.size !== right.size) {
    return false;
  }
  for (const entry of left.entries()) {
    if (!right.has(entry[0])) {
      return false;
    }
  }
  return true;
}
function hasSeen(seen, left, right) {
  return seen.get(left)?.has(right) ?? false;
}
function markSeen(seen, left, right) {
  let set = seen.get(left);
  if (!set) {
    set = /* @__PURE__ */ new WeakSet();
    seen.set(left, set);
  }
  set.add(right);
}
function equal(left, right) {
  return compareValues(left, right, /* @__PURE__ */ new WeakMap());
}
//# sourceMappingURL=index.js.map