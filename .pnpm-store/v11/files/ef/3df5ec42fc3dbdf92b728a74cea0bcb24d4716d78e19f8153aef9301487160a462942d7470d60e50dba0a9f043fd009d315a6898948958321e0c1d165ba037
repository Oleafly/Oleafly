import { isObject, mergeWith, pickBy } from "es-toolkit/compat";
//#region src/Form/components/merge.ts
const removeUndefined = (obj) => {
	if (!isObject(obj)) return obj;
	if (Array.isArray(obj)) return obj.map((item) => removeUndefined(item)).filter((item) => item !== void 0);
	return pickBy(Object.entries(obj).reduce((acc, [key, value]) => {
		acc[key] = removeUndefined(value);
		return acc;
	}, {}), (value) => value !== void 0);
};
/**
* 用于合并对象，如果是数组则直接替换
* @param target
* @param source
*/
const merge$1 = (target, source) => mergeWith({}, target, source, (obj, src) => {
	if (Array.isArray(obj)) return src;
});
//#endregion
export { merge$1 as merge, removeUndefined };

//# sourceMappingURL=merge.mjs.map