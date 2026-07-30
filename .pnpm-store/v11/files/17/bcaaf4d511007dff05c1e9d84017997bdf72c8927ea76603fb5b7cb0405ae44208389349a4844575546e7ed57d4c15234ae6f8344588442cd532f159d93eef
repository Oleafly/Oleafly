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

// src/jsx-runtime.ts
var jsx_runtime_exports = {};
__export(jsx_runtime_exports, {
  Fragment: () => Fragment,
  createElement: () => h,
  h: () => h,
  jsx: () => h,
  jsxDEV: () => h,
  jsxs: () => h
});
module.exports = __toCommonJS(jsx_runtime_exports);
function Fragment(props) {
  return props.children;
}
var h = (tag, attributes) => {
  if (tag === "slot") {
    return 0;
  }
  if (tag instanceof Function) {
    return tag(attributes);
  }
  const { children, ...rest } = attributes != null ? attributes : {};
  if (tag === "svg") {
    throw new Error(
      "SVG elements are not supported in the JSX syntax, use the array syntax instead"
    );
  }
  return [tag, rest, children];
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Fragment,
  createElement,
  h,
  jsx,
  jsxDEV,
  jsxs
});
//# sourceMappingURL=jsx-runtime.cjs.map