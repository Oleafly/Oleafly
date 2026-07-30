import { arg } from "@unified-latex/unified-latex-builder";
import { match } from "@unified-latex/unified-latex-util-match";
import { trim } from "@unified-latex/unified-latex-util-trim";
import { parse } from "@unified-latex/unified-latex-util-argspec";
import { attachMacroArgsInArray, gobbleSingleArgument } from "@unified-latex/unified-latex-util-arguments";
import { TikzPegParser, decorateArrayForPegjs } from "@unified-latex/unified-latex-util-pegjs";
import { printRaw } from "@unified-latex/unified-latex-util-print-raw";
import { scan } from "@unified-latex/unified-latex-util-scan";
//#region package/tikz/libs/tikz-command-argument-parser.ts
var OPTIONAL_ARGUMENT_ARG_SPEC = parse("o")[0];
function blankArg() {
	return arg([], {
		openMark: "",
		closeMark: ""
	});
}
/**
* Find the arguments of a tikz command. Many tikz commands accept either
* the a group as their only argument, or they scan their arguments until the first
* `;` is found.
*
* This behavior cannot be achieved via a standard xparse spec.
*/
var tikzCommandArgumentParser = (nodes, startPos) => {
	const origStartPos = startPos;
	let pos = startPos;
	let nodesRemoved = 0;
	const cursorPosAfterAnimations = eatAllAnimationSpecs(nodes, pos);
	let animationArg = blankArg();
	if (cursorPosAfterAnimations !== pos) {
		const argContent = nodes.splice(pos, cursorPosAfterAnimations - pos);
		trim(argContent);
		animationArg = arg(argContent, {
			openMark: " ",
			closeMark: " "
		});
	}
	nodesRemoved += cursorPosAfterAnimations - pos;
	const { argument: _optionalArgument, nodesRemoved: optionalArgumentNodesRemoved } = gobbleSingleArgument(nodes, OPTIONAL_ARGUMENT_ARG_SPEC, pos);
	nodesRemoved += optionalArgumentNodesRemoved;
	const optionalArg = _optionalArgument || blankArg();
	while (match.whitespace(nodes[pos])) pos++;
	const firstNode = nodes[pos];
	if (!firstNode) return {
		args: [
			animationArg,
			optionalArg,
			blankArg()
		],
		nodesRemoved: 0
	};
	if (match.group(firstNode)) {
		const args = [
			animationArg,
			optionalArg,
			arg(firstNode.content)
		];
		nodes.splice(origStartPos, pos - origStartPos + 1);
		return {
			args,
			nodesRemoved: pos - origStartPos + 1 + nodesRemoved
		};
	}
	const semicolonPosition = scan(nodes, ";", { startIndex: pos });
	if (semicolonPosition != null) {
		const argNodes = nodes.splice(origStartPos, semicolonPosition - origStartPos + 1);
		trim(argNodes);
		return {
			args: [
				animationArg,
				optionalArg,
				arg(argNodes)
			],
			nodesRemoved: origStartPos - semicolonPosition + 1 + nodesRemoved
		};
	}
	return {
		args: [
			animationArg,
			optionalArg,
			blankArg()
		],
		nodesRemoved: 0
	};
};
/**
* Find the next index after all animation specs. If no animation specs are present,
* return `startPos`.
*
* An animation spec looks like
* ```
* :rotate = { 0s="0", 2s="90", begin on=click }
* ```
* Any number can be listed. They start with a colon and have an equals sign followed by a group.
*/
function eatAllAnimationSpecs(nodes, startPos) {
	const colonPos = scan(nodes, ":", {
		startIndex: startPos,
		allowSubstringMatches: true,
		onlySkipWhitespaceAndComments: true
	});
	if (!colonPos) return startPos;
	let lastMatchPos = startPos;
	let i = colonPos + 1;
	for (; i < nodes.length; i++) {
		const node = nodes[i];
		if (match.string(node, "[")) break;
		if (match.string(node, "=")) {
			i++;
			while (match.whitespace(nodes[i]) || match.comment(nodes[i])) i++;
			if (!match.group(nodes[i])) break;
			lastMatchPos = i + 1;
			const colonPos = scan(nodes, ":", {
				startIndex: lastMatchPos,
				allowSubstringMatches: true,
				onlySkipWhitespaceAndComments: true
			});
			if (colonPos == null) break;
			i = colonPos + 1;
		}
	}
	return lastMatchPos;
}
//#endregion
//#region package/tikz/provides.ts
var macros = {
	pgfkeys: {
		signature: "m",
		renderInfo: {
			breakAround: true,
			pgfkeysArgs: true
		}
	},
	tikzoption: {
		signature: "m",
		renderInfo: {
			breakAround: true,
			pgfkeysArgs: true
		}
	},
	tikzstyle: {
		signature: "m",
		renderInfo: {
			breakAround: true,
			pgfkeysArgs: true
		}
	},
	usetikzlibrary: {
		signature: "m",
		renderInfo: {
			breakAround: true,
			pgfkeysArgs: true
		}
	},
	usepgfmodule: {
		signature: "m",
		renderInfo: { pgfkeysArgs: true }
	},
	usepgflibrary: {
		signature: "m",
		renderInfo: { pgfkeysArgs: true }
	},
	pgfplotsset: {
		signature: "m",
		renderInfo: {
			breakAround: true,
			pgfkeysArgs: true
		}
	},
	pgfplotstabletypeset: {
		signature: "o m",
		renderInfo: {
			breakAround: true,
			pgfkeysArgs: true
		}
	},
	tikz: {
		signature: "o o m",
		argumentParser: tikzCommandArgumentParser,
		renderInfo: { namedArguments: [
			"animation",
			"options",
			"command"
		] }
	}
};
var environments = {
	tikzpicture: {
		signature: "o",
		renderInfo: {
			pgfkeysArgs: true,
			tikzEnvironment: true
		},
		processContent: processTikzEnvironmentContent
	},
	axis: {
		signature: "o",
		renderInfo: {
			pgfkeysArgs: true,
			tikzEnvironment: true
		},
		processContent: processTikzEnvironmentContent
	},
	scope: {
		signature: "o",
		renderInfo: {
			pgfkeysArgs: true,
			tikzEnvironment: true
		},
		processContent: processTikzEnvironmentContent
	},
	pgfonlayer: {
		signature: "m",
		renderInfo: { tikzEnvironment: true },
		processContent: processTikzEnvironmentContent
	},
	pgflowlevelscope: {
		signature: "m",
		renderInfo: { tikzEnvironment: true },
		processContent: processTikzEnvironmentContent
	},
	pgfviewboxscope: {
		signature: "m m m m m",
		renderInfo: { tikzEnvironment: true },
		processContent: processTikzEnvironmentContent
	},
	pgftransparencygroup: {
		signature: "o",
		renderInfo: {
			pgfkeysArgs: true,
			tikzEnvironment: true
		},
		processContent: processTikzEnvironmentContent
	},
	behindforegroundpath: {
		signature: "m",
		processContent: processTikzEnvironmentContent
	},
	pgfmetadecoration: {
		signature: "m",
		processContent: processTikzEnvironmentContent
	},
	colormixin: {
		signature: "m",
		renderInfo: { pgfkeysArgs: true }
	}
};
/**
* Attach macro arguments for all macros that are only available within a tikz environment.
*/
function processTikzEnvironmentContent(nodes) {
	attachMacroArgsInArray(nodes, conditionalMacros);
	return nodes;
}
/**
* Macros that are only parsed inside a tikz environment.
*/
var conditionalMacros = {
	pgfextra: { signature: "m" },
	beginpgfgraphicnamed: { signature: "m" },
	pgfrealjobname: { signature: "m" },
	pgfplotstreampoint: { signature: "m" },
	pgfplotstreampointoutlier: { signature: "m" },
	pgfplotstreamspecial: { signature: "m" },
	pgfplotxyfile: { signature: "m" },
	pgfplotxyzfile: { signature: "m" },
	pgfplotfunction: { signature: "mmm" },
	pgfplotgnuplot: { signature: "o m" },
	pgfplothandlerrecord: { signature: "m" },
	pgfdeclareplothandler: { signature: "m m m" },
	pgfdeclarelayer: { signature: "m" },
	pgfsetlayers: {
		signature: "m",
		renderInfo: { pgfkeysArgs: true }
	},
	pgfonlayer: { signature: "m" },
	startpgfonlayer: { signature: "m" },
	pgfdeclarehorizontalshading: { signature: "o m m m " },
	pgfdeclareradialshading: { signature: "o m m m" },
	pgfdeclarefunctionalshading: { signature: "o m m m m m" },
	pgfshadecolortorgb: { signature: "m m" },
	pgfshadecolortocmyk: { signature: "m m" },
	pgfshadecolortogray: { signature: "m m" },
	pgfuseshading: { signature: "m" },
	pgfshadepath: { signature: "m m" },
	pgfsetadditionalshadetransform: { signature: "m" },
	pgfsetstrokeopacity: { signature: "m" },
	pgfsetfillopacity: { signature: "m" },
	pgfsetblendmode: { signature: "m" },
	pgfdeclarefading: { signature: "m m" },
	pgfsetfading: { signature: "m m" },
	pgfsetfadingforcurrentpath: { signature: "m m" },
	pgfsetfadingforcurrentpathstroked: { signature: "m m" },
	pgfanimateattribute: { signature: "m m" },
	pgfsnapshot: { signature: "m" },
	pgfqpoint: { signature: "m m" },
	pgfqpointxy: { signature: "m m" },
	pgfqpointxyz: { signature: "m m m" },
	pgfqpointscale: { signature: "m m" },
	pgfpathqmoveto: { signature: "m m" },
	pgfpathqlineto: { signature: "m m" },
	pgfpathqcurveto: { signature: "m m m m m m" },
	pgfpathqcircle: { signature: "m" },
	pgfqbox: { signature: "m" },
	pgfqboxsynced: { signature: "m" },
	pgfaliasimage: { signature: "m m" },
	pgfuseimage: { signature: "m" },
	pgfimage: {
		signature: "o m",
		renderInfo: { pgfkeysArgs: true }
	},
	pgfdeclaremask: {
		signature: "o m m",
		renderInfo: { pgfkeysArgs: true }
	},
	pgfdeclarepatternformonly: { signature: "o m m m m m" },
	pgfdeclarepatterninherentlycolored: { signature: "o m m m m m" },
	pgfsetfillpattern: { signature: "m m" },
	pgftransformshift: { signature: "m" },
	pgftransformxshift: { signature: "m" },
	pgftransformyshift: { signature: "m" },
	pgftransformscale: { signature: "m" },
	pgftransformxscale: { signature: "m" },
	pgftransformyscale: { signature: "m" },
	pgftransformxslant: { signature: "m" },
	pgftransformyslant: { signature: "m" },
	pgftransformrotate: { signature: "m" },
	pgftransformtriangle: { signature: "m m m" },
	pgftransformcm: { signature: "m m m m m" },
	pgftransformarrow: { signature: "m m" },
	pgftransformlineattime: { signature: "m m m" },
	pgftransformcurveattime: { signature: "m m m m m" },
	pgftransformarcaxesattime: { signature: "m m m m m m" },
	pgfgettransform: { signature: "m" },
	pgfsettransform: { signature: "m" },
	pgfgettransformentries: { signature: "m m m m m m" },
	pgfsettransformentries: { signature: "m m m m m m" },
	pgfpointtransformed: { signature: "m" },
	pgflowlevel: { signature: "m" },
	pgflowlevelobj: { signature: "m m" },
	pgflowlevelscope: { signature: "m" },
	startpgflowlevelscope: { signature: "m" },
	pgfviewboxscope: { signature: "m m m m m" },
	startpgfviewboxscope: { signature: "m m m m m" },
	pgftransformnonlinear: { signature: "m" },
	pgfpointtransformednonlinear: { signature: "m" },
	pgfsetcurvilinearbeziercurve: { signature: "m m m m" },
	pgfcurvilineardistancetotime: { signature: "m" },
	pgfpointcurvilinearbezierorthogonal: { signature: "m m" },
	pgfpointcurvilinearbezierpolar: { signature: "m m" },
	pgfmatrix: { signature: "m m m m m m m" },
	pgfsetmatrixcolumnsep: { signature: "m" },
	pgfmatrixnextcell: { signature: "o" },
	pgfsetmatrixrowsep: { signature: "m" },
	pgfmatrixendrow: { signature: "o" },
	pgfnode: { signature: "m m m m m" },
	pgfmultipartnode: { signature: "m m m m" },
	pgfcoordinate: { signature: "m m" },
	pgfnodealias: { signature: "m m" },
	pgfnoderename: { signature: "m m" },
	pgfpositionnodelater: { signature: "m" },
	pgfpositionnodenow: { signature: "m" },
	pgfnodepostsetupcode: { signature: "m m" },
	pgfpointanchor: { signature: "m m" },
	pgfpointshapeborder: { signature: "m m" },
	pgfdeclareshape: { signature: "m m" },
	saveddimen: { signature: "m m" },
	savedmacro: { signature: " m" },
	anchor: { signature: "m m" },
	deferredanchor: { signature: "m m" },
	anchorborder: { signature: "m" },
	backgroundpath: { signature: "m" },
	foregroundpath: { signature: "m" },
	behindbackgroundpath: { signature: "m" },
	beforebackgroundpath: { signature: "m" },
	beforeforegroundpath: { signature: "m" },
	behindforegroundpath: { signature: "m" },
	pgfdeclarearrow: { signature: "m" },
	pgfarrowssettipend: { signature: "m" },
	pgfarrowssetbackend: { signature: "m" },
	pgfarrowssetlineend: { signature: "m" },
	pgfarrowssetvisualbackend: { signature: "m" },
	pgfarrowssetvisualtipend: { signature: "m" },
	pgfarrowshullpoint: { signature: "m m" },
	pgfarrowsupperhullpoint: { signature: "m m" },
	pgfarrowssave: { signature: "m" },
	pgfarrowssavethe: { signature: "m" },
	pgfarrowsaddtooptions: { signature: "m" },
	pgfarrowsaddtolateoptions: { signature: "m" },
	pgfarrowsaddtolengthscalelist: { signature: "m" },
	pgfarrowsaddtowidthscalelist: { signature: "m" },
	pgfarrowsthreeparameters: { signature: "m" },
	pgfarrowslinewidthdependent: { signature: "m m m" },
	pgfarrowslengthdependent: { signature: "m" },
	pgfusepath: { signature: "m" },
	pgfsetlinewidth: { signature: "m" },
	pgfsetmiterlimit: { signature: "m" },
	pgfsetdash: { signature: "m m" },
	pgfsetstrokecolor: { signature: "m" },
	pgfsetcolor: { signature: "m" },
	pgfsetinnerlinewidth: { signature: "m" },
	pgfsetinnerstrokecolor: { signature: "m" },
	pgfsetarrowsstart: { signature: "m" },
	pgfsetarrowsend: { signature: "m" },
	pgfsetarrows: { signature: "m" },
	pgfsetshortenstart: { signature: "m" },
	pgfsetshortenend: { signature: "m" },
	pgfsetfillcolor: { signature: "m" },
	pgfdeclaredecoration: { signature: "m m m" },
	state: { signature: "m o m" },
	pgfdecoratepath: { signature: "m m" },
	startpgfdecoration: { signature: "m" },
	pgfdecoration: { signature: "m" },
	pgfdecoratecurrentpath: { signature: "m" },
	pgfsetdecorationsegmenttransformation: { signature: "m" },
	pgfdeclaremetadecorate: { signature: "m m m" },
	pgfmetadecoration: { signature: "m" },
	startpgfmetadecoration: { signature: "m" },
	pgfpathmoveto: { signature: "m" },
	pgfpathlineto: { signature: "m" },
	pgfpathcurveto: { signature: "m m m" },
	pgfpathquadraticcurveto: { signature: "m m" },
	pgfpathcurvebetweentime: { signature: "m m m m m m" },
	pgfpathcurvebetweentimecontinue: { signature: "m m m m m m" },
	pgfpatharc: { signature: "m m m" },
	pgfpatharcaxes: { signature: "m m m m" },
	pgfpatharcto: { signature: "m m m m m m" },
	pgfpatharctoprecomputed: { signature: "m m m m m m m m" },
	pgfpathellipse: { signature: "m m m" },
	pgfpathcircle: { signature: "m m" },
	pgfpathrectangle: { signature: "m m" },
	pgfpathrectanglecorners: { signature: "m m" },
	pgfpathgrid: { signature: " o m m" },
	pgfpathparabola: { signature: "m m" },
	pgfpathsine: { signature: "m" },
	pgfpathcosine: { signature: "m" },
	pgfsetcornersarced: { signature: "m" },
	"pgf@protocolsizes": { signature: "m m" },
	pgfpoint: { signature: "m m" },
	pgfpointpolar: { signature: "m m m" },
	pgfpointxy: { signature: "m m" },
	pgfsetxvec: { signature: "m" },
	pgfsetyvec: { signature: "m" },
	pgfpointpolarxy: { signature: "m m" },
	pgfpointxyz: { signature: "m m m" },
	pgfsetzvec: { signature: "m" },
	pgfpointcylindrical: { signature: "m m m" },
	pgfpointspherical: { signature: "m m m" },
	pgfpointadd: { signature: "m m" },
	pgfpointscale: { signature: "m m" },
	pgfpointdiff: { signature: "m m" },
	pgfpointnormalised: { signature: "m" },
	pgfpointlineattime: { signature: "m m m" },
	pgfpointlineatdistance: { signature: "m m m" },
	pgfpointarcaxesattime: { signature: "m m m m m m" },
	pgfpointcurveattime: { signature: "m m m m m" },
	pgfpointborderrectangle: { signature: "m m" },
	pgfpointborderellipse: { signature: "m m" },
	pgfpointintersectionoflines: { signature: "m m m m" },
	pgfpointintersectionofcircles: { signature: "m m m m m" },
	pgfintersectionofpaths: { signature: "m m" },
	pgfpointintersectionsolution: { signature: "m" },
	pgfextractx: { signature: "m m" },
	pgfextracty: { signature: "m m" },
	pgfgetlastxy: { signature: "m m" },
	"pgf@process": { signature: "m" },
	pgfsetbaseline: { signature: "m" },
	pgfsetbaselinepointnow: { signature: "m" },
	pgfsetbaselinepointlater: { signature: "m" },
	pgftext: {
		signature: "o m",
		renderInfo: { pgfkeysArgs: true }
	},
	pgfuseid: { signature: "m" },
	pgfusetype: { signature: "m" },
	pgfidrefnextuse: { signature: "m m" },
	pgfidrefprevuse: { signature: "m m" },
	pgfaliasid: { signature: "m m" },
	pgfgaliasid: { signature: "m m" },
	pgfifidreferenced: { signature: "m m m" },
	pgfrdfabout: { signature: "m" },
	pgfrdfcontent: { signature: "m" },
	pgfrdfdatatype: { signature: "m" },
	pgfrdfhref: { signature: "m" },
	pgfrdfprefix: { signature: "m" },
	pgfrdfproperty: { signature: "m" },
	pgfrdfrel: { signature: "m" },
	pgfrdfresource: { signature: "m" },
	pgfrdfrev: { signature: "m" },
	pgfrdfsrc: { signature: "m" },
	pgfrdftypeof: { signature: "m" },
	pgfrdfvocab: { signature: "m" },
	pgferror: { signature: "m" },
	pgfwarning: { signature: "m" },
	path: {
		signature: "u;",
		renderInfo: {
			breakAround: true,
			tikzPathCommand: true
		}
	},
	draw: {
		signature: "u;",
		renderInfo: {
			breakAround: true,
			tikzPathCommand: true
		}
	},
	fill: {
		signature: "u;",
		renderInfo: {
			breakAround: true,
			tikzPathCommand: true
		}
	},
	filldraw: {
		signature: "u;",
		renderInfo: {
			breakAround: true,
			tikzPathCommand: true
		}
	},
	pattern: {
		signature: "u;",
		renderInfo: {
			breakAround: true,
			tikzPathCommand: true
		}
	},
	shade: {
		signature: "u;",
		renderInfo: {
			breakAround: true,
			tikzPathCommand: true
		}
	},
	clip: {
		signature: "u;",
		renderInfo: {
			breakAround: true,
			tikzPathCommand: true
		}
	},
	useasboundingbox: {
		signature: "u;",
		renderInfo: {
			breakAround: true,
			tikzPathCommand: true
		}
	},
	node: {
		signature: "u;",
		renderInfo: {
			breakAround: true,
			tikzPathCommand: true
		}
	},
	coordinate: {
		signature: "u;",
		renderInfo: {
			breakAround: true,
			tikzPathCommand: true
		}
	},
	graph: {
		signature: "u;",
		renderInfo: {
			breakAround: true,
			tikzPathCommand: true
		}
	},
	scoped: {
		signature: "o o m",
		argumentParser: tikzCommandArgumentParser,
		renderInfo: {
			namedArguments: [
				"animation",
				"options",
				"command"
			],
			breakAround: true
		}
	}
};
//#endregion
//#region package/tikz/libs/print-raw.ts
/**
* Print an `systeme` argument specification AST to a string.
*/
function printRaw$1(node, root = false) {
	if (typeof node === "string") return node;
	if (Array.isArray(node)) {
		const sepToken = root ? " " : "";
		const printed = [];
		for (let i = 0; i < node.length; i++) {
			const tok = node[i];
			const prevTok = node[i - 1];
			if (!prevTok) {
				printed.push(printRaw$1(tok));
				continue;
			}
			if (prevTok.type === "comment") {
				printed.push(printRaw$1(tok));
				continue;
			}
			if (tok.type !== "comment") printed.push(sepToken);
			printed.push(printRaw$1(tok));
		}
		return printed.join("");
	}
	const type = node.type;
	switch (type) {
		case "path_spec": return printRaw$1(node.content, root = true);
		case "coordinate": return `${printRaw(node.prefix)}(${printRaw(node.content)})`;
		case "operation": return printRaw(node.content);
		case "comment": return printRaw(node);
		case "line_to": return node.command;
		case "curve_to": {
			const comments = node.comments.map((c) => printRaw({
				...c,
				leadingWhitespace: false
			})).join("");
			if (node.controls.length === 1) return `${comments}.. controls ${printRaw$1(node.controls[0])} ..`;
			else return `${comments}.. controls ${printRaw$1(node.controls[0])} and ${printRaw$1(node.controls[1])} ..`;
		}
		case "unknown": return printRaw(node.content);
		case "square_brace_group": return `[${printRaw(node.content)}]`;
		case "foreach": {
			const comments = node.comments.map((c) => printRaw({
				...c,
				leadingWhitespace: false
			})).join("");
			let options = "";
			if (node.options) options = ` [${printRaw(node.options)}]`;
			const start = printRaw(node.start);
			const variables = [...node.variables];
			trim(variables);
			let printedVariables = printRaw(variables);
			if (printedVariables.length > 0) printedVariables = " " + printedVariables;
			const command = node.command.type === "foreach" ? printRaw$1(node.command) : printRaw(node.command);
			return `${comments}${start}${printedVariables}${options} in ${printRaw(node.list)} ${command}`;
		}
		case "svg_operation": {
			const comments = node.comments.map((c) => printRaw({
				...c,
				leadingWhitespace: false
			})).join("");
			let options = "";
			if (node.options) options = `[${printRaw(node.options)}]`;
			return `${comments}svg${options} ${printRaw(node.content)}`;
		}
		case "animation": return `${node.comments.map((c) => printRaw({
			...c,
			leadingWhitespace: false
		})).join("")}:${node.attribute} = {${printRaw(node.content)}}`;
		default:
			console.warn(`Unknown node type "${type}" for node`, node);
			return "";
	}
}
//#endregion
//#region package/tikz/libs/parser.ts
function createMatchers() {
	return {
		isChar: match.string,
		isTerminal: (node) => match.string(node, ";"),
		isOperation: (node) => match.anyString(node) && node.content.match(/[a-zA-Z]/),
		isWhitespace: (node) => match.whitespace(node) || match.parbreak(node),
		isComment: match.comment,
		isGroup: match.group,
		isMacro: match.macro,
		isAnyMacro: match.anyMacro
	};
}
var matchers = createMatchers();
/**
* Parse the contents of the `\systeme{...}` macro
*/
function parse$1(ast, options) {
	const { startRule = "path_spec" } = options || {};
	if (!Array.isArray(ast)) throw new Error("You must pass an array of nodes");
	ast = decorateArrayForPegjs([...ast]);
	return TikzPegParser.parse(ast, {
		...matchers,
		startRule
	});
}
//#endregion
export { macros as a, environments as i, printRaw$1 as n, conditionalMacros as r, parse$1 as t };

//# sourceMappingURL=tikz-CGsknaZh.js.map