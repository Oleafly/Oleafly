function isPrimitive(val) {
  return !val || Object(val) !== val;
}
const urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
function randomStr(size = 16, dict = urlAlphabet) {
  let id = "";
  let i = size;
  const len = dict.length;
  while (i--)
    id += dict[Math.random() * len | 0];
  return id;
}
const _objectIdMap = /* @__PURE__ */ new WeakMap();
function objectId(obj) {
  if (isPrimitive(obj))
    return obj;
  if (!_objectIdMap.has(obj)) {
    _objectIdMap.set(obj, randomStr());
  }
  return _objectIdMap.get(obj);
}

export { objectId as o };
