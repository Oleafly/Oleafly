import { DEFAULT_THEMES } from "../constants.js";
import { formatCSSVariablePrefix } from "./formatCSSVariablePrefix.js";
import { normalizeThemeColors } from "@pierre/theming/color";
//#region src/utils/getHighlighterThemeStyles.ts
function getHighlighterThemeStyles({ theme = DEFAULT_THEMES, highlighter, prefix }) {
	let styles = "";
	if (typeof theme === "string") {
		const themeData = highlighter.getTheme(theme);
		const normalized = normalizeThemeColors(themeData);
		styles += `color:${normalized.fg};`;
		styles += `background-color:${normalized.bg};`;
		styles += `${formatCSSVariablePrefix("global")}fg:${normalized.fg};`;
		styles += `${formatCSSVariablePrefix("global")}bg:${normalized.bg};`;
		styles += getGitVariables(themeData, prefix);
	} else {
		let themeData = highlighter.getTheme(theme.dark);
		let normalized = normalizeThemeColors(themeData);
		styles += `${formatCSSVariablePrefix("global")}dark:${normalized.fg};`;
		styles += `${formatCSSVariablePrefix("global")}dark-bg:${normalized.bg};`;
		styles += getGitVariables(themeData, "dark");
		themeData = highlighter.getTheme(theme.light);
		normalized = normalizeThemeColors(themeData);
		styles += `${formatCSSVariablePrefix("global")}light:${normalized.fg};`;
		styles += `${formatCSSVariablePrefix("global")}light-bg:${normalized.bg};`;
		styles += getGitVariables(themeData, "light");
	}
	return styles;
}
function getGitVariables(themeData, modePrefix) {
	modePrefix = modePrefix != null ? `${modePrefix}-` : "";
	let styles = "";
	const additionGreen = themeData.colors?.["gitDecoration.addedResourceForeground"] ?? themeData.colors?.["terminal.ansiGreen"];
	if (additionGreen != null) styles += `${formatCSSVariablePrefix("global")}${modePrefix}addition-color:${additionGreen};`;
	const deletionRed = themeData.colors?.["gitDecoration.deletedResourceForeground"] ?? themeData.colors?.["terminal.ansiRed"];
	if (deletionRed != null) styles += `${formatCSSVariablePrefix("global")}${modePrefix}deletion-color:${deletionRed};`;
	const modifiedBlue = themeData.colors?.["gitDecoration.modifiedResourceForeground"] ?? themeData.colors?.["terminal.ansiBlue"];
	if (modifiedBlue != null) styles += `${formatCSSVariablePrefix("global")}${modePrefix}modified-color:${modifiedBlue};`;
	return styles;
}
//#endregion
export { getHighlighterThemeStyles };

//# sourceMappingURL=getHighlighterThemeStyles.js.map