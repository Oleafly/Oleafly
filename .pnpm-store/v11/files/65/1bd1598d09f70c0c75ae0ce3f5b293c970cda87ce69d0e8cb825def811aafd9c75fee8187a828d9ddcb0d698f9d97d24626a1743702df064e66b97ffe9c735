import { arg } from "@unified-latex/unified-latex-builder";
import { match } from "@unified-latex/unified-latex-util-match";
import { parse } from "@unified-latex/unified-latex-util-argspec";
import { gobbleSingleArgument } from "@unified-latex/unified-latex-util-arguments";
//#region package/listings/libs/argument-parser.ts
var argSpecM = parse("m")[0];
var argSpecO = parse("o")[0];
var argSpecRDelim = {};
/**
* This argument parser parses arguments in the form of
* - [⟨key=value list⟩]⟨character⟩⟨source code⟩⟨same character⟩
* - [⟨key=value list⟩]{⟨source code⟩}
*/
var argumentParser = (nodes, startPos) => {
	const { argument: optionalArg, nodesRemoved: optionalArgNodesRemoved } = gobbleSingleArgument(nodes, argSpecO, startPos);
	let codeArg = null;
	let codeArgNodesRemoved = 0;
	const nextNode = nodes[startPos];
	if (match.group(nextNode)) {
		const mandatoryArg = gobbleSingleArgument(nodes, argSpecM, startPos);
		codeArg = mandatoryArg.argument;
		codeArgNodesRemoved = mandatoryArg.nodesRemoved;
	} else if (match.string(nextNode) && nextNode.content.length === 1) {
		const delim = nextNode.content;
		argSpecRDelim[delim] = argSpecRDelim[delim] || parse(`r${delim}${delim}`)[0];
		const delimArg = gobbleSingleArgument(nodes, argSpecRDelim[delim], startPos);
		codeArg = delimArg.argument;
		codeArgNodesRemoved = delimArg.nodesRemoved;
	}
	return {
		args: [optionalArg || arg(null), codeArg || arg(null)],
		nodesRemoved: optionalArgNodesRemoved + codeArgNodesRemoved
	};
};
//#endregion
//#region package/listings/provides.ts
var macros = {
	lstset: { signature: "m" },
	lstinline: { argumentParser },
	lstinputlisting: { signature: "o m" },
	lstdefinestyle: { signature: "m m" },
	lstnewenvironment: { signature: "m o o m m" },
	lstMakeShortInline: { signature: "o m" },
	lstDeleteShortInline: { signature: "m" },
	lstdefineformat: { signature: "m m" },
	lstdefinelanguage: { signature: "o m o m o" },
	lstalias: { signature: "o m o m" },
	lstloadlanguages: { signature: "m" }
};
var environments = { lstlisting: {
	signature: "o",
	renderInfo: { pgfkeysArgs: true }
} };
//#endregion
export { macros as n, environments as t };

//# sourceMappingURL=listings-DNTZBTCe.js.map