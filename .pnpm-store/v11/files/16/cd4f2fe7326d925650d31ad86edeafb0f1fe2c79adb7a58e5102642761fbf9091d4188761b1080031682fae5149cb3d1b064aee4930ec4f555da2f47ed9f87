//#region src/base-ui/Select/helpers.ts
const isGroupOption = (option) => Boolean(option.options);
const getOptionSearchText = (option) => {
	if (typeof option.label === "string" || typeof option.label === "number") return String(option.label);
	if (option.title) return option.title;
	if (typeof option.value === "string" || typeof option.value === "number") return String(option.value);
	return "";
};
const escapeRegExp = (value) => value.replaceAll(/[$()*+.?[\\\]^{|}]/g, "\\$&");
const splitBySeparators = (value, separators) => {
	if (!separators || separators.length === 0) return [value];
	const pattern = separators.map(escapeRegExp).join("|");
	return value.split(new RegExp(pattern, "g"));
};
const countVirtualItems = (items) => items.reduce((count, item) => {
	if (isGroupOption(item)) return count + item.options.length + 1;
	return count + 1;
}, 0);
const isValueEmpty = (value) => value === null || value === void 0 || value === "";
const normalizeValueFor = (isMultiple) => (nextValue) => {
	if (isMultiple) {
		if (Array.isArray(nextValue)) return nextValue;
		if (nextValue === null || nextValue === void 0) return [];
		return [nextValue];
	}
	if (Array.isArray(nextValue)) return nextValue[0] ?? null;
	return nextValue === void 0 ? null : nextValue;
};
//#endregion
export { countVirtualItems, getOptionSearchText, isGroupOption, isValueEmpty, normalizeValueFor, splitBySeparators };

//# sourceMappingURL=helpers.mjs.map