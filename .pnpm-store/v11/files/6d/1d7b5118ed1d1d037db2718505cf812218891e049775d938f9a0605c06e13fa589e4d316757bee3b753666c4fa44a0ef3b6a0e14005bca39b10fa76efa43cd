import { cssVar } from "antd-style";
import { camelCase } from "es-toolkit/compat";
//#region src/Tag/utils.ts
const presetColors = [
	"red",
	"volcano",
	"orange",
	"gold",
	"yellow",
	"lime",
	"green",
	"cyan",
	"blue",
	"geekblue",
	"purple",
	"magenta",
	"gray"
];
const presetSystemColors = /* @__PURE__ */ new Set([
	"error",
	"warning",
	"success",
	"info",
	"processing"
]);
const toKebabCase = (value) => value.replaceAll(/([a-z])([A-Z])/g, "$1-$2").replaceAll(/([a-z])(\d)/g, "$1-$2").replaceAll(/(\d)([A-Z])/g, "$1-$2").replaceAll(/([A-Z]+)([A-Z][a-z])/g, "$1-$2").toLowerCase();
const getCssVar = (tokenKey) => {
	return cssVar[tokenKey] || `var(--ant-${toKebabCase(tokenKey)})`;
};
const colorsPreset = (type, ...keys) => getCssVar(camelCase([type, ...keys].join("-")));
const colorsPresetSystem = (type, ...keys) => {
	return getCssVar(camelCase([
		"color",
		type === "processing" ? "info" : type,
		...keys
	].join("-")));
};
//#endregion
export { colorsPreset, colorsPresetSystem, presetColors, presetSystemColors };

//# sourceMappingURL=utils.mjs.map