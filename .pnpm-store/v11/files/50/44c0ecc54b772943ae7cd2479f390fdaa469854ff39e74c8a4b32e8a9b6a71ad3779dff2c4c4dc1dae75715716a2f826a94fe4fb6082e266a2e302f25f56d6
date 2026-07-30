import { updateRenderInfo } from "@unified-latex/unified-latex-util-render-info";
import { gobbleArguments } from "@unified-latex/unified-latex-util-arguments";
import { match } from "@unified-latex/unified-latex-util-match";
import { visit } from "@unified-latex/unified-latex-util-visit";
import { printRaw } from "@unified-latex/unified-latex-util-print-raw";
//#region libs/process-environment.ts
/**
* Performs any needed processing on the environment (as specified by `envInfo`)
* including attaching arguments and possibly manipulating the environment's body.
*/
function processEnvironment(envNode, envInfo) {
	if (envInfo.signature && envNode.args == null) {
		const { args } = gobbleArguments(envNode.content, envInfo.signature);
		envNode.args = args;
	}
	updateRenderInfo(envNode, envInfo.renderInfo);
	if (typeof envInfo.processContent === "function") envNode.content = envInfo.processContent(envNode.content);
}
/**
* Recursively search for and process the specified environments. Arguments are
* consumed according to the `signature` specified. The body is processed
* with the specified `processContent` function (if given). Any specified `renderInfo`
* is attached to the environment node.
*/
function processEnvironments(tree, environments) {
	visit(tree, { leave: (node) => {
		const envName = printRaw(node.env);
		const envInfo = environments[envName];
		if (!envInfo) throw new Error(`Could not find environment info for environment "${envName}"`);
		processEnvironment(node, envInfo);
	} }, { test: match.createEnvironmentMatcher(environments) });
}
//#endregion
//#region libs/unified-latex-process-environment.ts
/**
* Unified plugin to process environment content and attach arguments.
*
* @param environments An object whose keys are environment names and values contains information about the environment and its argument signature.
*/
var unifiedLatexProcessEnvironments = function unifiedLatexAttachMacroArguments(options) {
	const { environments = {} } = options || {};
	const isRelevantEnvironment = match.createEnvironmentMatcher(environments);
	return (tree) => {
		if (Object.keys(environments).length === 0) console.warn("Attempting to attach macro arguments but no macros are specified.");
		visit(tree, { leave: (node) => {
			const envName = printRaw(node.env);
			const envInfo = environments[envName];
			if (!envInfo) throw new Error(`Could not find environment info for environment "${envName}"`);
			processEnvironment(node, envInfo);
		} }, { test: isRelevantEnvironment });
	};
};
//#endregion
//#region index.ts
/**
* ## What is this?
*
* Functions to report on/manipulate environments in a `unified-latex` Abstract Syntax Tree (AST).
*
* ## When should I use this?
*
* If you are working on the internals of `unified-latex-util-parse` or need to make a custom parser
* that treats environments differently.
*/
//#endregion
export { processEnvironment, processEnvironments, unifiedLatexProcessEnvironments };

//# sourceMappingURL=index.js.map