// src/jsx-runtime.ts
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
export {
  Fragment,
  h as createElement,
  h,
  h as jsx,
  h as jsxDEV,
  h as jsxs
};
//# sourceMappingURL=jsx-runtime.js.map