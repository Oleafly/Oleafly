require("./xcolor-kzYzOAhs.cjs");
let _unified_latex_unified_latex_builder = require("@unified-latex/unified-latex-builder");
let _unified_latex_unified_latex_util_match = require("@unified-latex/unified-latex-util-match");
let _unified_latex_unified_latex_util_argspec = require("@unified-latex/unified-latex-util-argspec");
let _unified_latex_unified_latex_util_arguments = require("@unified-latex/unified-latex-util-arguments");
//#region package/minted/libs/argument-parser.ts
var argSpecM = (0, _unified_latex_unified_latex_util_argspec.parse)("m")[0];
var argSpecO = (0, _unified_latex_unified_latex_util_argspec.parse)("o")[0];
var argSpecRDelim = {};
/**
* This argument parser parses arguments in the form of
* - [⟨options⟩]{⟨language⟩}⟨delim⟩⟨code⟩⟨delim⟩
* - [⟨options⟩]{⟨language⟩}{⟨code⟩}
*/
var argumentParser = (nodes, startPos) => {
	const { argument: optionalArg, nodesRemoved: optionalArgNodesRemoved } = (0, _unified_latex_unified_latex_util_arguments.gobbleSingleArgument)(nodes, argSpecO, startPos);
	const { argument: languageArg, nodesRemoved: languageArgNodesRemoved } = (0, _unified_latex_unified_latex_util_arguments.gobbleSingleArgument)(nodes, argSpecM, startPos);
	let codeArg = null;
	let codeArgNodesRemoved = 0;
	const nextNode = nodes[startPos];
	if (_unified_latex_unified_latex_util_match.match.group(nextNode)) {
		const mandatoryArg = (0, _unified_latex_unified_latex_util_arguments.gobbleSingleArgument)(nodes, argSpecM, startPos);
		codeArg = mandatoryArg.argument;
		codeArgNodesRemoved = mandatoryArg.nodesRemoved;
	} else if (_unified_latex_unified_latex_util_match.match.string(nextNode) && nextNode.content.length === 1) {
		const delim = nextNode.content;
		argSpecRDelim[delim] = argSpecRDelim[delim] || (0, _unified_latex_unified_latex_util_argspec.parse)(`r${delim}${delim}`)[0];
		const delimArg = (0, _unified_latex_unified_latex_util_arguments.gobbleSingleArgument)(nodes, argSpecRDelim[delim], startPos);
		codeArg = delimArg.argument;
		codeArgNodesRemoved = delimArg.nodesRemoved;
	}
	return {
		args: [
			optionalArg || (0, _unified_latex_unified_latex_builder.arg)(null),
			languageArg || (0, _unified_latex_unified_latex_builder.arg)(null),
			codeArg || (0, _unified_latex_unified_latex_builder.arg)(null)
		],
		nodesRemoved: optionalArgNodesRemoved + languageArgNodesRemoved + codeArgNodesRemoved
	};
};
//#endregion
//#region package/minted/provides.ts
var macros = {
	mint: { argumentParser },
	mintinline: { argumentParser },
	inputminted: { argumentParser },
	usemintedstyle: { signature: "m" },
	setminted: { signature: "o m" },
	setmintedinline: { signature: "o m" },
	newmint: { signature: "o m m" },
	newminted: { signature: "o m m" },
	newmintinline: { signature: "o m m" },
	newmintedfile: { signature: "o m m" }
};
var environments = { minted: { signature: "o m" } };
//#endregion
Object.defineProperty(exports, "environments", {
	enumerable: true,
	get: function() {
		return environments;
	}
});
Object.defineProperty(exports, "macros", {
	enumerable: true,
	get: function() {
		return macros;
	}
});

//# sourceMappingURL=minted-DFbrXgk2.cjs.map