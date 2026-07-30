import { match } from "@unified-latex/unified-latex-util-match";
import { EXIT, SKIP, visit } from "@unified-latex/unified-latex-util-visit";
//#region libs/find-region.ts
/**
* Find all contiguous segments in the array that are between start and end blocks.
* The `start` and `end` are functions that determine when a region starts and ends.
*/
function findRegionInArray(tree, start, end) {
	const ret = [];
	let currRegion = {
		start: void 0,
		end: tree.length
	};
	for (let i = 0; i < tree.length; i++) {
		const node = tree[i];
		if (start(node)) currRegion.start = i;
		if (end(node)) {
			currRegion.end = i + 1;
			ret.push(currRegion);
			currRegion = {
				start: void 0,
				end: tree.length
			};
		}
	}
	if (currRegion.start != null) ret.push(currRegion);
	return ret;
}
//#endregion
//#region libs/regions.ts
/**
* Given `regions`, a list of `Region`s (not necessarily ordered, possibly overlapping), return a list of in-order,
* non-overlapping regions and a corresponding list containing a set of the original `Region`s that the new region
* is a subset of.
*/
function refineRegions(regions) {
	const _regions = [...regions];
	_regions.sort((a, b) => a.start - b.start);
	const cutPointsSet = new Set(_regions.flatMap((r) => [r.start, r.end]));
	const cutPoints = Array.from(cutPointsSet);
	cutPoints.sort((a, b) => a - b);
	const retRegions = [];
	const retRegionsContainedIn = [];
	let seekIndex = 0;
	for (let i = 0; i < cutPoints.length - 1; i++) {
		const start = cutPoints[i];
		const end = cutPoints[i + 1];
		const region = {
			start,
			end
		};
		const regionContainedIn = /* @__PURE__ */ new Set();
		let encounteredEndPastStart = false;
		for (let j = seekIndex; j < _regions.length; j++) {
			const superRegion = _regions[j];
			if (superRegion.end >= region.start) encounteredEndPastStart = true;
			if (!encounteredEndPastStart && superRegion.end < region.start) {
				seekIndex = j + 1;
				continue;
			}
			if (superRegion.start > end) break;
			if (superRegion.start <= region.start && superRegion.end >= region.end) {
				encounteredEndPastStart = true;
				regionContainedIn.add(superRegion);
			}
		}
		if (regionContainedIn.size > 0) {
			retRegions.push(region);
			retRegionsContainedIn.push(regionContainedIn);
		}
	}
	return {
		regions: retRegions,
		regionsContainedIn: retRegionsContainedIn
	};
}
/**
* Split an array up into the disjoint regions specified by `regionRecord`.
* Returned is a list of tuples, the first item being the key of `regionRecord` if there
* was a corresponding region, or `null` if there was no corresponding region.
*
* This function assumes that the regions in `regionRecord` are disjoint and fully contained
* within the bounds of `array`.
*/
function splitByRegions(array, regionsRecord) {
	const ret = [];
	const indices = [0, array.length];
	const reverseMap = {};
	for (const [key, records] of Object.entries(regionsRecord)) indices.push(...records.flatMap((r) => {
		reverseMap["" + [r.start, r.end]] = key;
		return [r.start, r.end];
	}));
	indices.sort((a, b) => a - b);
	for (let i = 0; i < indices.length - 1; i++) {
		const start = indices[i];
		const end = indices[i + 1];
		if (start === end) continue;
		const regionKey = reverseMap["" + [start, end]];
		ret.push([regionKey || null, array.slice(start, end)]);
	}
	return ret;
}
//#endregion
//#region libs/reparse-macro-names.ts
/**
* Escape a string so that it can be used to build a regular expression.
*
* From: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
*/
function escapeRegExp(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
* Build a regular expression that matches everything up to the first non-allowed symbol.
*/
function buildWordRegex(allowedSet) {
	const regexpStr = `^(${["\\p{L}"].concat(Array.from(allowedSet).map(escapeRegExp)).join("|")})*`;
	return new RegExp(regexpStr, "u");
}
/**
* Checks whether the array has a macro that could be reparsed given the `allowedTokens` but
* do not do any reparsing. This function can be used in auto-detection schemes to determine if
* macro names should actually be reparsed.
*/
function hasReparsableMacroNamesInArray(tree, allowedTokens) {
	for (let i = 0; i < tree.length; i++) {
		const macro = tree[i];
		const string = tree[i + 1];
		if (match.anyMacro(macro) && match.anyString(string)) {
			if (allowedTokens.has(macro.content.charAt(macro.content.length - 1)) || allowedTokens.has(string.content.charAt(0))) return true;
		}
	}
	return false;
}
/**
* Checks whether `tree` has a macro that could be reparsed given the `allowedTokens` but
* do not do any reparsing. This function can be used in auto-detection schemes to determine if
* macro names should actually be reparsed.
*/
function hasReparsableMacroNames(tree, allowedTokens) {
	if (typeof allowedTokens === "string") allowedTokens = new Set(allowedTokens.split(""));
	const _allowedTokens = allowedTokens;
	for (const v of _allowedTokens) if (v.length > 1) throw new Error(`Only single characters are allowed as \`allowedTokens\` when reparsing macro names, not \`${v}\`.`);
	let ret = false;
	visit(tree, (nodes) => {
		if (hasReparsableMacroNamesInArray(nodes, _allowedTokens)) {
			ret = true;
			return EXIT;
		}
	}, {
		includeArrays: true,
		test: Array.isArray
	});
	return ret;
}
/**
* Reparses all macro names in the array so that they may optionally include characters listed in `allowedTokens`.
* This is used, for example, when parsing expl3 syntax which allows `_` to be used in a macro name (even though
* `_` is normally stops the parsing for a macro name).
*/
function reparseMacroNamesInArray(tree, allowedTokens) {
	const regex = buildWordRegex(allowedTokens);
	let i = 0;
	while (i < tree.length) {
		const macro = tree[i];
		const string = tree[i + 1];
		if (match.anyMacro(macro) && (macro.escapeToken == null || macro.escapeToken === "\\") && match.anyString(string) && (allowedTokens.has(macro.content.charAt(macro.content.length - 1)) || allowedTokens.has(string.content.charAt(0)))) {
			const match = string.content.match(regex);
			const takeable = match ? match[0] : "";
			if (takeable.length > 0) if (takeable.length === string.content.length) {
				macro.content += string.content;
				tree.splice(i + 1, 1);
				if (macro.position && string.position?.end) macro.position.end = string.position.end;
			} else {
				macro.content += takeable;
				string.content = string.content.slice(takeable.length);
				if (macro.position?.end) {
					macro.position.end.offset += takeable.length;
					macro.position.end.column += takeable.length;
				}
				if (string.position?.start) {
					string.position.start.offset += takeable.length;
					string.position.start.column += takeable.length;
				}
			}
			else i++;
		} else ++i;
	}
}
/**
* Reparses all macro names so that they may optionally include characters listed in `allowedTokens`.
* This is used, for example, when parsing expl3 syntax which allows `_` to be used in a macro name (even though
* `_` is normally stops the parsing for a macro name). Thus, a macro `\foo_bar:Nn` would be parsed as having
* the name `foo_bar:Nn` rather than as `foo` followed by the strings `_`, `bar`, `:`, `Nn`.
*/
function reparseMacroNames(tree, allowedTokens) {
	if (typeof allowedTokens === "string") allowedTokens = new Set(allowedTokens.split(""));
	const _allowedTokens = allowedTokens;
	for (const v of _allowedTokens) if (v.length > 1) throw new Error(`Only single characters are allowed as \`allowedTokens\` when reparsing macro names, not \`${v}\`.`);
	visit(tree, (nodes) => {
		reparseMacroNamesInArray(nodes, _allowedTokens);
	}, {
		includeArrays: true,
		test: Array.isArray
	});
}
//#endregion
//#region libs/special-regions.ts
var expl3Find = {
	start: match.createMacroMatcher(["ExplSyntaxOn"]),
	end: match.createMacroMatcher(["ExplSyntaxOff"])
};
var atLetterFind = {
	start: match.createMacroMatcher(["makeatletter"]),
	end: match.createMacroMatcher(["makeatother"])
};
/**
* Find regions between `\ExplSyntaxOn...\ExplSyntaxOff` and `\makeatletter...\makeatother`.
* Returns an object containing regions where one or both syntax's apply.
*/
function findExpl3AndAtLetterRegionsInArray(tree) {
	const expl3 = findRegionInArray(tree, expl3Find.start, expl3Find.end);
	const atLetter = findRegionInArray(tree, atLetterFind.start, atLetterFind.end);
	const regionMap = new Map([...expl3.map((x) => [x, "expl"]), ...atLetter.map((x) => [x, "atLetter"])]);
	const all = refineRegions([...expl3, ...atLetter]);
	const ret = {
		explOnly: [],
		atLetterOnly: [],
		both: []
	};
	for (let i = 0; i < all.regions.length; i++) {
		const region = all.regions[i];
		const containedIn = all.regionsContainedIn[i];
		if (containedIn.size === 2) {
			ret.both.push(region);
			continue;
		}
		for (const v of containedIn.values()) {
			if (regionMap.get(v) === "expl") ret.explOnly.push(region);
			if (regionMap.get(v) === "atLetter") ret.atLetterOnly.push(region);
		}
	}
	ret.explOnly = ret.explOnly.filter((r) => r.end - r.start > 1);
	ret.atLetterOnly = ret.atLetterOnly.filter((r) => r.end - r.start > 1);
	ret.both = ret.both.filter((r) => r.end - r.start > 1);
	return ret;
}
var atLetterSet = new Set(["@"]);
var explSet = new Set(["_", ":"]);
var bothSet = new Set([
	"_",
	":",
	"@"
]);
/**
* Find regions between `\ExplSyntaxOn...\ExplSyntaxOff` and `\makeatletter...\makeatother`
* and reparse their contents so that the relevant characters (e.g., `@`, `_`, and `:`) become
* part of the macro names.
*/
function reparseExpl3AndAtLetterRegions(tree) {
	visit(tree, { leave: (nodes) => {
		const regions = findExpl3AndAtLetterRegionsInArray(nodes);
		if (regions.both.length + regions.atLetterOnly.length + regions.explOnly.length === 0) return;
		const splits = splitByRegions(nodes, regions);
		const processed = [];
		for (const [key, slice] of splits) switch (key) {
			case null:
				processed.push(...slice);
				continue;
			case "atLetterOnly":
				reparseMacroNames(slice, atLetterSet);
				processed.push(...slice);
				continue;
			case "explOnly":
				reparseMacroNames(slice, explSet);
				processed.push(...slice);
				continue;
			case "both":
				reparseMacroNames(slice, bothSet);
				processed.push(...slice);
				continue;
			default: throw new Error(`Unexpected case when splitting ${key}`);
		}
		nodes.length = 0;
		nodes.push(...processed);
		return SKIP;
	} }, {
		includeArrays: true,
		test: Array.isArray
	});
}
//#endregion
//#region index.ts
/**
* ## What is this?
*
* Functions to identify regions of a `unified-latex` Abstract Syntax Tree (AST) that need to be reparsed because of different
* category codes. For example, regions between `\makeatletter` and `\makeatother`.
*
* ## When should I use this?
*
* If you need to identify regions of the AST that need to be reparsed.
*/
//#endregion
export { findExpl3AndAtLetterRegionsInArray, findRegionInArray, hasReparsableMacroNames, hasReparsableMacroNamesInArray, reparseExpl3AndAtLetterRegions, reparseMacroNames, reparseMacroNamesInArray };

//# sourceMappingURL=index.js.map