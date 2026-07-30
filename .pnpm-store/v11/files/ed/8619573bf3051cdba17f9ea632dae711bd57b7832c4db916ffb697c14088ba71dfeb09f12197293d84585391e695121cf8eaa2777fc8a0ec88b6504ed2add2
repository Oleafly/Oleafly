import { formatCSSVariablePrefix } from "../../utils/formatCSSVariablePrefix.js";
import { registerCustomTheme } from "./registerCustomTheme.js";
import { createCssVariablesTheme } from "shiki";
//#region src/highlighter/themes/registerCustomCSSVariableTheme.ts
function registerCustomCSSVariableTheme(name, variableDefaults, fontStyle = false) {
	const theme = createCssVariablesTheme({
		name,
		variablePrefix: formatCSSVariablePrefix("global"),
		variableDefaults,
		fontStyle
	});
	registerCustomTheme(name, () => Promise.resolve(theme));
}
//#endregion
export { registerCustomCSSVariableTheme };

//# sourceMappingURL=registerCustomCSSVariableTheme.js.map