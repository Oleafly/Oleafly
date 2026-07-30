Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let _unified_latex_unified_latex_util_match = require("@unified-latex/unified-latex-util-match");
//#region libs/decorate-array-for-pegjs.ts
/**
* Pegjs operates on strings. However, strings and arrays are very similar!
* This function adds `charAt`, `charCodeAt`, and `substring` methods to
* `array` so that `array` can then be fed to a Pegjs generated parser.
*
* @param {[object]} array
* @returns {[object]}
*/
function decorateArrayForPegjs(array) {
	array.charAt = function(i) {
		return this[i];
	};
	array.charCodeAt = () => 0;
	array.substring = function(i, j) {
		return this.slice(i, j);
	};
	array.replace = function(a, b) {
		return JSON.stringify(this).replace(a, b);
	};
	return array;
}
//#endregion
//#region libs/split-strings.ts
/**
* Splits all multi-character strings into strings that are all single characters.
*/
function splitStringsIntoSingleChars(nodes) {
	return nodes.flatMap((node) => _unified_latex_unified_latex_util_match.match.anyString(node) ? Array.from(node.content).map((c) => ({
		type: "string",
		content: c
	})) : node);
}
//#endregion
//#region grammars/latex.pegjs
var latex_default = (function() {
	"use strict";
	class peg$SyntaxError extends SyntaxError {
		constructor(message, expected, found, location) {
			super(message);
			this.expected = expected;
			this.found = found;
			this.location = location;
			this.name = "SyntaxError";
		}
		format(sources) {
			let str = "Error: " + this.message;
			if (this.location) {
				let src = null;
				const st = sources.find((s2) => s2.source === this.location.source);
				if (st) src = st.text.split(/\r\n|\n|\r/g);
				const s = this.location.start;
				const offset_s = this.location.source && typeof this.location.source.offset === "function" ? this.location.source.offset(s) : s;
				const loc = this.location.source + ":" + offset_s.line + ":" + offset_s.column;
				if (src) {
					const e = this.location.end;
					const filler = "".padEnd(offset_s.line.toString().length, " ");
					const line = src[s.line - 1];
					const hatLen = (s.line === e.line ? e.column : line.length + 1) - s.column || 1;
					str += "\n --> " + loc + "\n" + filler + " |\n" + offset_s.line + " | " + line + "\n" + filler + " | " + "".padEnd(s.column - 1, " ") + "".padEnd(hatLen, "^");
				} else str += "\n at " + loc;
			}
			return str;
		}
		static buildMessage(expected, found) {
			function hex(ch) {
				return ch.codePointAt(0).toString(16).toUpperCase();
			}
			const nonPrintable = Object.prototype.hasOwnProperty.call(RegExp.prototype, "unicode") ? /* @__PURE__ */ new RegExp("[\\p{C}\\p{Mn}\\p{Mc}]", "gu") : null;
			function unicodeEscape(s) {
				if (nonPrintable) return s.replace(nonPrintable, (ch) => "\\u{" + hex(ch) + "}");
				return s;
			}
			function literalEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			function classEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^").replace(/-/g, "\\-").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			const DESCRIBE_EXPECTATION_FNS = {
				literal(expectation) {
					return "\"" + literalEscape(expectation.text) + "\"";
				},
				class(expectation) {
					const escapedParts = expectation.parts.map((part) => Array.isArray(part) ? classEscape(part[0]) + "-" + classEscape(part[1]) : classEscape(part));
					return "[" + (expectation.inverted ? "^" : "") + escapedParts.join("") + "]" + (expectation.unicode ? "u" : "");
				},
				any() {
					return "any character";
				},
				end() {
					return "end of input";
				},
				other(expectation) {
					return expectation.description;
				}
			};
			function describeExpectation(expectation) {
				return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
			}
			function describeExpected(expected2) {
				const descriptions = expected2.map(describeExpectation);
				descriptions.sort();
				if (descriptions.length > 0) {
					let j = 1;
					for (let i = 1; i < descriptions.length; i++) if (descriptions[i - 1] !== descriptions[i]) {
						descriptions[j] = descriptions[i];
						j++;
					}
					descriptions.length = j;
				}
				switch (descriptions.length) {
					case 1: return descriptions[0];
					case 2: return descriptions[0] + " or " + descriptions[1];
					default: return descriptions.slice(0, -1).join(", ") + ", or " + descriptions[descriptions.length - 1];
				}
			}
			function describeFound(found2) {
				return found2 ? "\"" + literalEscape(found2) + "\"" : "end of input";
			}
			return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
		}
	}
	function peg$parse(input, options) {
		options = options !== void 0 ? options : {};
		const peg$FAILED = {};
		const peg$source = options.grammarSource;
		const peg$startRuleFunctions = {
			document: peg$parsedocument,
			math: peg$parsemath
		};
		let peg$startRuleFunction = peg$parsedocument;
		const peg$c0 = "%";
		const peg$c1 = ".";
		const peg$c2 = "verb*";
		const peg$c3 = "verb";
		const peg$c4 = "[";
		const peg$c5 = "]";
		const peg$c6 = "lstinline";
		const peg$c7 = "mintinline";
		const peg$c8 = "mint";
		const peg$c9 = "minted";
		const peg$c10 = "verbatim*";
		const peg$c11 = "verbatim";
		const peg$c12 = "filecontents*";
		const peg$c13 = "filecontents";
		const peg$c14 = "comment";
		const peg$c15 = "lstlisting";
		const peg$c16 = "(";
		const peg$c17 = ")";
		const peg$c18 = "begin";
		const peg$c19 = "end";
		const peg$c20 = "equation*";
		const peg$c21 = "equation";
		const peg$c22 = "align*";
		const peg$c23 = "align";
		const peg$c24 = "alignat*";
		const peg$c25 = "alignat";
		const peg$c26 = "gather*";
		const peg$c27 = "gather";
		const peg$c28 = "multline*";
		const peg$c29 = "multline";
		const peg$c30 = "flalign*";
		const peg$c31 = "flalign";
		const peg$c32 = "split";
		const peg$c33 = "math";
		const peg$c34 = "displaymath";
		const peg$c35 = "\\";
		const peg$c36 = "{";
		const peg$c37 = "}";
		const peg$c38 = "$";
		const peg$c39 = "&";
		const peg$c40 = "\r";
		const peg$c41 = "\n";
		const peg$c42 = "\r\n";
		const peg$c43 = "#";
		const peg$c44 = "^";
		const peg$c45 = "_";
		const peg$c46 = "\0";
		const peg$r0 = /^[^ \t\n\r]/;
		const peg$r1 = /^[ \t]/;
		const peg$r2 = /^[a-zA-Z]/;
		const peg$r3 = /^[0-9]/;
		const peg$r4 = /^[.,;:\-*\/()!?=+<>[\]`'"~]/;
		const peg$e0 = peg$otherExpectation("token");
		const peg$e1 = peg$anyExpectation();
		const peg$e2 = peg$otherExpectation("parbreak");
		const peg$e3 = peg$otherExpectation("math token");
		const peg$e4 = peg$otherExpectation("nonchar token");
		const peg$e5 = peg$literalExpectation("%", false);
		const peg$e6 = peg$otherExpectation("whitespace");
		const peg$e7 = peg$otherExpectation("number");
		const peg$e8 = peg$literalExpectation(".", false);
		const peg$e9 = peg$otherExpectation("special macro");
		const peg$e10 = peg$literalExpectation("verb*", false);
		const peg$e11 = peg$literalExpectation("verb", false);
		const peg$e12 = peg$literalExpectation("[", false);
		const peg$e13 = peg$literalExpectation("]", false);
		const peg$e14 = peg$classExpectation([
			" ",
			"	",
			"\n",
			"\r"
		], true, false, false);
		const peg$e15 = peg$otherExpectation("verbatim listings");
		const peg$e16 = peg$literalExpectation("lstinline", false);
		const peg$e17 = peg$otherExpectation("verbatim minted");
		const peg$e18 = peg$literalExpectation("mintinline", false);
		const peg$e19 = peg$literalExpectation("mint", false);
		const peg$e20 = peg$otherExpectation("verbatim minted environment");
		const peg$e21 = peg$literalExpectation("minted", false);
		const peg$e22 = peg$otherExpectation("verbatim environment with optional arg");
		const peg$e23 = peg$otherExpectation("verbatim environment");
		const peg$e24 = peg$literalExpectation("verbatim*", false);
		const peg$e25 = peg$literalExpectation("verbatim", false);
		const peg$e26 = peg$literalExpectation("filecontents*", false);
		const peg$e27 = peg$literalExpectation("filecontents", false);
		const peg$e28 = peg$literalExpectation("comment", false);
		const peg$e29 = peg$literalExpectation("lstlisting", false);
		const peg$e30 = peg$otherExpectation("macro");
		const peg$e31 = peg$otherExpectation("group");
		const peg$e32 = peg$otherExpectation("environment");
		const peg$e33 = peg$otherExpectation("math environment");
		const peg$e34 = peg$literalExpectation("(", false);
		const peg$e35 = peg$literalExpectation(")", false);
		const peg$e36 = peg$literalExpectation("begin", false);
		const peg$e37 = peg$literalExpectation("end", false);
		const peg$e38 = peg$literalExpectation("equation*", false);
		const peg$e39 = peg$literalExpectation("equation", false);
		const peg$e40 = peg$literalExpectation("align*", false);
		const peg$e41 = peg$literalExpectation("align", false);
		const peg$e42 = peg$literalExpectation("alignat*", false);
		const peg$e43 = peg$literalExpectation("alignat", false);
		const peg$e44 = peg$literalExpectation("gather*", false);
		const peg$e45 = peg$literalExpectation("gather", false);
		const peg$e46 = peg$literalExpectation("multline*", false);
		const peg$e47 = peg$literalExpectation("multline", false);
		const peg$e48 = peg$literalExpectation("flalign*", false);
		const peg$e49 = peg$literalExpectation("flalign", false);
		const peg$e50 = peg$literalExpectation("split", false);
		const peg$e51 = peg$literalExpectation("math", false);
		const peg$e52 = peg$literalExpectation("displaymath", false);
		const peg$e53 = peg$otherExpectation("escape");
		const peg$e54 = peg$literalExpectation("\\", false);
		const peg$e55 = peg$literalExpectation("{", false);
		const peg$e56 = peg$literalExpectation("}", false);
		const peg$e57 = peg$literalExpectation("$", false);
		const peg$e58 = peg$literalExpectation("&", false);
		const peg$e59 = peg$otherExpectation("newline");
		const peg$e60 = peg$literalExpectation("\r", false);
		const peg$e61 = peg$literalExpectation("\n", false);
		const peg$e62 = peg$literalExpectation("\r\n", false);
		const peg$e63 = peg$literalExpectation("#", false);
		const peg$e64 = peg$literalExpectation("^", false);
		const peg$e65 = peg$literalExpectation("_", false);
		const peg$e66 = peg$literalExpectation("\0", false);
		const peg$e67 = peg$classExpectation([" ", "	"], false, false, false);
		const peg$e68 = peg$otherExpectation("letter");
		const peg$e69 = peg$classExpectation([["a", "z"], ["A", "Z"]], false, false, false);
		const peg$e70 = peg$otherExpectation("digit");
		const peg$e71 = peg$classExpectation([["0", "9"]], false, false, false);
		const peg$e72 = peg$otherExpectation("punctuation");
		const peg$e73 = peg$classExpectation([
			".",
			",",
			";",
			":",
			"-",
			"*",
			"/",
			"(",
			")",
			"!",
			"?",
			"=",
			"+",
			"<",
			">",
			"[",
			"]",
			"`",
			"'",
			"\"",
			"~"
		], false, false, false);
		const peg$e74 = peg$otherExpectation("full comment");
		const peg$e75 = peg$otherExpectation("comment");
		function peg$f0(content) {
			return createNode("root", { content: content.flatMap((x) => x) });
		}
		function peg$f1(t) {
			return t;
		}
		function peg$f2(eq) {
			return createNode("inlinemath", { content: eq.flatMap((x) => x) });
		}
		function peg$f3(s) {
			return createNode("string", { content: s });
		}
		function peg$f4(s) {
			return createNode("string", { content: s });
		}
		function peg$f5() {
			return createNode("parbreak");
		}
		function peg$f6(x) {
			return x;
		}
		function peg$f7(x) {
			return x;
		}
		function peg$f8() {
			return createNode("macro", {
				content: "^",
				escapeToken: ""
			});
		}
		function peg$f9() {
			return createNode("macro", {
				content: "_",
				escapeToken: ""
			});
		}
		function peg$f10(s) {
			return createNode("string", { content: s });
		}
		function peg$f11() {
			return createNode("whitespace");
		}
		function peg$f12(a, b) {
			return a.join("") + "." + b.join("");
		}
		function peg$f13(b) {
			return "." + b.join("");
		}
		function peg$f14(a) {
			return a.join("") + ".";
		}
		function peg$f15(s) {
			return createNode("string", { content: s });
		}
		function peg$f16(env, e, end) {
			return end == e;
		}
		function peg$f17(env, e, x) {
			return x;
		}
		function peg$f18(env, e, x, end) {
			return end == e;
		}
		function peg$f19(env, e, x) {
			return createNode("verb", {
				env,
				escape: e,
				content: x.join("")
			});
		}
		function peg$f20(x) {
			return x;
		}
		function peg$f21(x) {
			return createNode("displaymath", { content: x.flatMap((x2) => x2) });
		}
		function peg$f22(x) {
			return x;
		}
		function peg$f23(x) {
			return createNode("inlinemath", { content: x.flatMap((x2) => x2) });
		}
		function peg$f24(x) {
			return x;
		}
		function peg$f25(x) {
			return createNode("displaymath", { content: x.flatMap((x2) => x2) });
		}
		function peg$f26(end) {
			return end.type === "string" && end.content === "]";
		}
		function peg$f27(x) {
			return x;
		}
		function peg$f28(o) {
			return [
				createNode("string", { content: "[" }),
				...o,
				createNode("string", { content: "]" })
			];
		}
		function peg$f29(x) {
			return x;
		}
		function peg$f30(v) {
			return createNode("group", { content: createNode("string", { content: v.join("") }) });
		}
		function peg$f31(d, end) {
			return end == d;
		}
		function peg$f32(d, x) {
			return x;
		}
		function peg$f33(d, v, end) {
			return end == d;
		}
		function peg$f34(d, v) {
			return [
				createNode("string", { content: d }),
				createNode("string", { content: v.join("") }),
				createNode("string", { content: d })
			];
		}
		function peg$f35(macro, option, verbatim) {
			return [
				createNode("macro", { content: macro }),
				...option || [],
				...[].concat(verbatim)
			];
		}
		function peg$f36(macro, option, language, verbatim) {
			return [
				createNode("macro", { content: macro }),
				...option || [],
				language,
				...[].concat(verbatim)
			];
		}
		function peg$f37(env, option, language, end_env) {
			return compare_env({ content: [env] }, end_env);
		}
		function peg$f38(env, option, language, body) {
			return createNode("environment", {
				env,
				content: [
					...option || [],
					language,
					{
						type: "string",
						content: body
					}
				]
			});
		}
		function peg$f39(env, option, end_env) {
			return compare_env({ content: [env] }, end_env);
		}
		function peg$f40(env, option, x) {
			return x;
		}
		function peg$f41(env, option, body) {
			return createNode("environment", {
				env,
				content: option ? [...option, {
					type: "string",
					content: body
				}] : [{
					type: "string",
					content: body
				}]
			});
		}
		function peg$f42(env, end_env) {
			return compare_env({ content: [env] }, end_env);
		}
		function peg$f43(env, x) {
			return x;
		}
		function peg$f44(env, body) {
			return createNode("verbatim", {
				env,
				content: body
			});
		}
		function peg$f45(n) {
			return n.join("");
		}
		function peg$f46(n) {
			return n;
		}
		function peg$f47(m) {
			return createNode("macro", { content: m });
		}
		function peg$f48(c) {
			return c;
		}
		function peg$f49(x) {
			return createNode("group", { content: x.flatMap((x2) => x2) });
		}
		function peg$f50(g) {
			return text().slice(1, -1);
		}
		function peg$f51(env, env_comment, end_env) {
			return compare_env(env, end_env);
		}
		function peg$f52(env, env_comment, x) {
			return x;
		}
		function peg$f53(env, env_comment, body) {
			body = body.flatMap((x) => x);
			return createNode("environment", {
				env,
				content: env_comment ? [env_comment, ...body] : body
			});
		}
		function peg$f54(env, env_comment, end_env) {
			return compare_env({ content: [env] }, end_env);
		}
		function peg$f55(env, env_comment, x) {
			return x;
		}
		function peg$f56(env, env_comment, body) {
			body = body.flatMap((x) => x);
			return createNode("mathenv", {
				env,
				content: env_comment ? [env_comment, ...body] : body
			});
		}
		function peg$f57(e) {
			return createNode("string", { content: e });
		}
		function peg$f58() {
			return createNode("string", { content: "\\" });
		}
		function peg$f59(s) {
			return createNode("string", { content: s });
		}
		function peg$f60(s) {
			return createNode("string", { content: s });
		}
		function peg$f61(s) {
			return createNode("string", { content: s });
		}
		function peg$f62(s) {
			return createNode("string", { content: s });
		}
		function peg$f63(s) {
			return createNode("string", { content: s });
		}
		function peg$f64(s) {
			return createNode("string", { content: s });
		}
		function peg$f65(s) {
			return createNode("string", { content: s });
		}
		function peg$f66() {
			return " ";
		}
		function peg$f67(p) {
			return createNode("string", { content: p });
		}
		function peg$f68(leading_sp, comment) {
			return createNode("comment", {
				...comment,
				sameline: false,
				leadingWhitespace: leading_sp.length > 0
			});
		}
		function peg$f69(spaces, x) {
			return createNode("comment", {
				...x,
				sameline: true,
				leadingWhitespace: spaces.length > 0
			});
		}
		function peg$f70(c) {
			return c;
		}
		function peg$f71(c) {
			return {
				content: c.join(""),
				suffixParbreak: true
			};
		}
		function peg$f72(c) {
			return c;
		}
		function peg$f73(c) {
			return { content: c.join("") };
		}
		function peg$f74() {
			return location().start.column === 1;
		}
		let peg$currPos = options.peg$currPos | 0;
		let peg$savedPos = peg$currPos;
		const peg$posDetailsCache = [{
			line: 1,
			column: 1
		}];
		let peg$maxFailPos = peg$currPos;
		let peg$maxFailExpected = options.peg$maxFailExpected || [];
		let peg$silentFails = options.peg$silentFails | 0;
		let peg$resultsCache = {};
		let peg$result;
		if (options.startRule) {
			if (!(options.startRule in peg$startRuleFunctions)) throw new Error(`Can't start parsing from rule "` + options.startRule + "\".");
			peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
		}
		function text() {
			return input.substring(peg$savedPos, peg$currPos);
		}
		function location() {
			return peg$computeLocation(peg$savedPos, peg$currPos);
		}
		function peg$getUnicode(pos = peg$currPos) {
			const cp = input.codePointAt(pos);
			if (cp === void 0) return "";
			return String.fromCodePoint(cp);
		}
		function peg$literalExpectation(text2, ignoreCase) {
			return {
				type: "literal",
				text: text2,
				ignoreCase
			};
		}
		function peg$classExpectation(parts, inverted, ignoreCase, unicode) {
			return {
				type: "class",
				parts,
				inverted,
				ignoreCase,
				unicode
			};
		}
		function peg$anyExpectation() {
			return { type: "any" };
		}
		function peg$endExpectation() {
			return { type: "end" };
		}
		function peg$otherExpectation(description) {
			return {
				type: "other",
				description
			};
		}
		function peg$computePosDetails(pos) {
			let details = peg$posDetailsCache[pos];
			let p;
			if (details) return details;
			else {
				if (pos >= peg$posDetailsCache.length) p = peg$posDetailsCache.length - 1;
				else {
					p = pos;
					while (!peg$posDetailsCache[--p]);
				}
				details = peg$posDetailsCache[p];
				details = {
					line: details.line,
					column: details.column
				};
				while (p < pos) {
					if (input.charCodeAt(p) === 10) {
						details.line++;
						details.column = 1;
					} else details.column++;
					p++;
				}
				peg$posDetailsCache[pos] = details;
				return details;
			}
		}
		function peg$computeLocation(startPos, endPos, offset2) {
			const startPosDetails = peg$computePosDetails(startPos);
			const endPosDetails = peg$computePosDetails(endPos);
			const res = {
				source: peg$source,
				start: {
					offset: startPos,
					line: startPosDetails.line,
					column: startPosDetails.column
				},
				end: {
					offset: endPos,
					line: endPosDetails.line,
					column: endPosDetails.column
				}
			};
			if (offset2 && peg$source && typeof peg$source.offset === "function") {
				res.start = peg$source.offset(res.start);
				res.end = peg$source.offset(res.end);
			}
			return res;
		}
		function peg$fail(expected2) {
			if (peg$currPos < peg$maxFailPos) return;
			if (peg$currPos > peg$maxFailPos) {
				peg$maxFailPos = peg$currPos;
				peg$maxFailExpected = [];
			}
			peg$maxFailExpected.push(expected2);
		}
		function peg$buildStructuredError(expected2, found, location2) {
			return new peg$SyntaxError(peg$SyntaxError.buildMessage(expected2, found), expected2, found, location2);
		}
		function peg$parsedocument() {
			let s0, s1, s2;
			const key = peg$currPos * 53 + 0;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parsetoken();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parsetoken();
			}
			peg$savedPos = s0;
			s1 = peg$f0(s1);
			s0 = s1;
			peg$silentFails--;
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsemath() {
			let s0, s1;
			const key = peg$currPos * 53 + 1;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = [];
			s1 = peg$parsemath_token();
			while (s1 !== peg$FAILED) {
				s0.push(s1);
				s1 = peg$parsemath_token();
			}
			peg$silentFails--;
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsetoken() {
			let s0, s1, s2, s3, s4, s5;
			const key = peg$currPos * 53 + 2;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$parsespecial_macro();
			if (s0 === peg$FAILED) {
				s0 = peg$parsemacro();
				if (s0 === peg$FAILED) {
					s0 = peg$parsefull_comment();
					if (s0 === peg$FAILED) {
						s0 = peg$parsegroup();
						if (s0 === peg$FAILED) {
							s0 = peg$currPos;
							s1 = peg$parsemath_shift();
							if (s1 !== peg$FAILED) {
								s2 = [];
								s3 = peg$currPos;
								s4 = peg$currPos;
								peg$silentFails++;
								s5 = peg$parsemath_shift();
								peg$silentFails--;
								if (s5 === peg$FAILED) s4 = void 0;
								else {
									peg$currPos = s4;
									s4 = peg$FAILED;
								}
								if (s4 !== peg$FAILED) {
									s5 = peg$parsemath_token();
									if (s5 !== peg$FAILED) {
										peg$savedPos = s3;
										s3 = peg$f1(s5);
									} else {
										peg$currPos = s3;
										s3 = peg$FAILED;
									}
								} else {
									peg$currPos = s3;
									s3 = peg$FAILED;
								}
								if (s3 !== peg$FAILED) while (s3 !== peg$FAILED) {
									s2.push(s3);
									s3 = peg$currPos;
									s4 = peg$currPos;
									peg$silentFails++;
									s5 = peg$parsemath_shift();
									peg$silentFails--;
									if (s5 === peg$FAILED) s4 = void 0;
									else {
										peg$currPos = s4;
										s4 = peg$FAILED;
									}
									if (s4 !== peg$FAILED) {
										s5 = peg$parsemath_token();
										if (s5 !== peg$FAILED) {
											peg$savedPos = s3;
											s3 = peg$f1(s5);
										} else {
											peg$currPos = s3;
											s3 = peg$FAILED;
										}
									} else {
										peg$currPos = s3;
										s3 = peg$FAILED;
									}
								}
								else s2 = peg$FAILED;
								if (s2 !== peg$FAILED) {
									s3 = peg$parsemath_shift();
									if (s3 !== peg$FAILED) {
										peg$savedPos = s0;
										s0 = peg$f2(s2);
									} else {
										peg$currPos = s0;
										s0 = peg$FAILED;
									}
								} else {
									peg$currPos = s0;
									s0 = peg$FAILED;
								}
							} else {
								peg$currPos = s0;
								s0 = peg$FAILED;
							}
							if (s0 === peg$FAILED) {
								s0 = peg$parsealignment_tab();
								if (s0 === peg$FAILED) {
									s0 = peg$parseparbreak();
									if (s0 === peg$FAILED) {
										s0 = peg$parsemacro_parameter();
										if (s0 === peg$FAILED) {
											s0 = peg$parseignore();
											if (s0 === peg$FAILED) {
												s0 = peg$parsenumber();
												if (s0 === peg$FAILED) {
													s0 = peg$parsewhitespace();
													if (s0 === peg$FAILED) {
														s0 = peg$parsepunctuation();
														if (s0 === peg$FAILED) {
															s0 = peg$currPos;
															s1 = peg$currPos;
															s2 = [];
															s3 = peg$currPos;
															s4 = peg$currPos;
															peg$silentFails++;
															s5 = peg$parsenonchar_token();
															peg$silentFails--;
															if (s5 === peg$FAILED) s4 = void 0;
															else {
																peg$currPos = s4;
																s4 = peg$FAILED;
															}
															if (s4 !== peg$FAILED) {
																if (input.length > peg$currPos) {
																	s5 = input.charAt(peg$currPos);
																	peg$currPos++;
																} else {
																	s5 = peg$FAILED;
																	if (peg$silentFails === 0) peg$fail(peg$e1);
																}
																if (s5 !== peg$FAILED) {
																	s4 = [s4, s5];
																	s3 = s4;
																} else {
																	peg$currPos = s3;
																	s3 = peg$FAILED;
																}
															} else {
																peg$currPos = s3;
																s3 = peg$FAILED;
															}
															if (s3 !== peg$FAILED) while (s3 !== peg$FAILED) {
																s2.push(s3);
																s3 = peg$currPos;
																s4 = peg$currPos;
																peg$silentFails++;
																s5 = peg$parsenonchar_token();
																peg$silentFails--;
																if (s5 === peg$FAILED) s4 = void 0;
																else {
																	peg$currPos = s4;
																	s4 = peg$FAILED;
																}
																if (s4 !== peg$FAILED) {
																	if (input.length > peg$currPos) {
																		s5 = input.charAt(peg$currPos);
																		peg$currPos++;
																	} else {
																		s5 = peg$FAILED;
																		if (peg$silentFails === 0) peg$fail(peg$e1);
																	}
																	if (s5 !== peg$FAILED) {
																		s4 = [s4, s5];
																		s3 = s4;
																	} else {
																		peg$currPos = s3;
																		s3 = peg$FAILED;
																	}
																} else {
																	peg$currPos = s3;
																	s3 = peg$FAILED;
																}
															}
															else s2 = peg$FAILED;
															if (s2 !== peg$FAILED) s1 = input.substring(s1, peg$currPos);
															else s1 = s2;
															if (s1 !== peg$FAILED) {
																peg$savedPos = s0;
																s1 = peg$f3(s1);
															}
															s0 = s1;
															if (s0 === peg$FAILED) {
																s0 = peg$parsebegin_group();
																if (s0 === peg$FAILED) {
																	s0 = peg$parseend_group();
																	if (s0 === peg$FAILED) {
																		s0 = peg$parsemath_shift();
																		if (s0 === peg$FAILED) {
																			s0 = peg$currPos;
																			if (input.length > peg$currPos) {
																				s1 = input.charAt(peg$currPos);
																				peg$currPos++;
																			} else {
																				s1 = peg$FAILED;
																				if (peg$silentFails === 0) peg$fail(peg$e1);
																			}
																			if (s1 !== peg$FAILED) {
																				peg$savedPos = s0;
																				s1 = peg$f4(s1);
																			}
																			s0 = s1;
																		}
																	}
																}
															}
														}
													}
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseparbreak() {
			let s0, s1, s2, s3, s4, s5, s6, s7;
			const key = peg$currPos * 53 + 3;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$currPos;
			s2 = [];
			s3 = peg$parsesp();
			while (s3 !== peg$FAILED) {
				s2.push(s3);
				s3 = peg$parsesp();
			}
			s3 = peg$parsenl();
			if (s3 !== peg$FAILED) {
				s4 = [];
				s5 = peg$currPos;
				s6 = [];
				s7 = peg$parsesp();
				while (s7 !== peg$FAILED) {
					s6.push(s7);
					s7 = peg$parsesp();
				}
				s7 = peg$parsenl();
				if (s7 !== peg$FAILED) {
					s6 = [s6, s7];
					s5 = s6;
				} else {
					peg$currPos = s5;
					s5 = peg$FAILED;
				}
				if (s5 !== peg$FAILED) while (s5 !== peg$FAILED) {
					s4.push(s5);
					s5 = peg$currPos;
					s6 = [];
					s7 = peg$parsesp();
					while (s7 !== peg$FAILED) {
						s6.push(s7);
						s7 = peg$parsesp();
					}
					s7 = peg$parsenl();
					if (s7 !== peg$FAILED) {
						s6 = [s6, s7];
						s5 = s6;
					} else {
						peg$currPos = s5;
						s5 = peg$FAILED;
					}
				}
				else s4 = peg$FAILED;
				if (s4 !== peg$FAILED) {
					s5 = [];
					s6 = peg$parsesp();
					while (s6 !== peg$FAILED) {
						s5.push(s6);
						s6 = peg$parsesp();
					}
					s6 = peg$currPos;
					peg$silentFails++;
					s7 = peg$parsecomment_start();
					peg$silentFails--;
					if (s7 === peg$FAILED) s6 = void 0;
					else {
						peg$currPos = s6;
						s6 = peg$FAILED;
					}
					if (s6 !== peg$FAILED) {
						s2 = [
							s2,
							s3,
							s4,
							s5,
							s6
						];
						s1 = s2;
					} else {
						peg$currPos = s1;
						s1 = peg$FAILED;
					}
				} else {
					peg$currPos = s1;
					s1 = peg$FAILED;
				}
			} else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 === peg$FAILED) {
				s1 = peg$currPos;
				s2 = [];
				s3 = peg$parsesp();
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$parsesp();
				}
				s3 = peg$parsenl();
				if (s3 !== peg$FAILED) {
					s4 = [];
					s5 = peg$currPos;
					s6 = [];
					s7 = peg$parsesp();
					while (s7 !== peg$FAILED) {
						s6.push(s7);
						s7 = peg$parsesp();
					}
					s7 = peg$parsenl();
					if (s7 !== peg$FAILED) {
						s6 = [s6, s7];
						s5 = s6;
					} else {
						peg$currPos = s5;
						s5 = peg$FAILED;
					}
					if (s5 !== peg$FAILED) while (s5 !== peg$FAILED) {
						s4.push(s5);
						s5 = peg$currPos;
						s6 = [];
						s7 = peg$parsesp();
						while (s7 !== peg$FAILED) {
							s6.push(s7);
							s7 = peg$parsesp();
						}
						s7 = peg$parsenl();
						if (s7 !== peg$FAILED) {
							s6 = [s6, s7];
							s5 = s6;
						} else {
							peg$currPos = s5;
							s5 = peg$FAILED;
						}
					}
					else s4 = peg$FAILED;
					if (s4 !== peg$FAILED) {
						s2 = [
							s2,
							s3,
							s4
						];
						s1 = s2;
					} else {
						peg$currPos = s1;
						s1 = peg$FAILED;
					}
				} else {
					peg$currPos = s1;
					s1 = peg$FAILED;
				}
			}
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f5();
			}
			s0 = s1;
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e2);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsemath_token() {
			let s0, s1, s2, s3, s4;
			const key = peg$currPos * 53 + 4;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$parsespecial_macro();
			if (s0 === peg$FAILED) {
				s0 = peg$parsemacro();
				if (s0 === peg$FAILED) {
					s0 = peg$parsefull_comment();
					if (s0 === peg$FAILED) {
						s0 = peg$currPos;
						s1 = [];
						s2 = peg$parsewhitespace();
						while (s2 !== peg$FAILED) {
							s1.push(s2);
							s2 = peg$parsewhitespace();
						}
						s2 = peg$parsegroup();
						if (s2 !== peg$FAILED) {
							s3 = [];
							s4 = peg$parsewhitespace();
							while (s4 !== peg$FAILED) {
								s3.push(s4);
								s4 = peg$parsewhitespace();
							}
							peg$savedPos = s0;
							s0 = peg$f6(s2);
						} else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
						if (s0 === peg$FAILED) {
							s0 = peg$currPos;
							s1 = [];
							s2 = peg$parsewhitespace();
							while (s2 !== peg$FAILED) {
								s1.push(s2);
								s2 = peg$parsewhitespace();
							}
							s2 = peg$parsealignment_tab();
							if (s2 !== peg$FAILED) {
								s3 = [];
								s4 = peg$parsewhitespace();
								while (s4 !== peg$FAILED) {
									s3.push(s4);
									s4 = peg$parsewhitespace();
								}
								peg$savedPos = s0;
								s0 = peg$f7(s2);
							} else {
								peg$currPos = s0;
								s0 = peg$FAILED;
							}
							if (s0 === peg$FAILED) {
								s0 = peg$parsemacro_parameter();
								if (s0 === peg$FAILED) {
									s0 = peg$currPos;
									s1 = [];
									s2 = peg$parsewhitespace();
									while (s2 !== peg$FAILED) {
										s1.push(s2);
										s2 = peg$parsewhitespace();
									}
									s2 = peg$parsesuperscript();
									if (s2 !== peg$FAILED) {
										s3 = [];
										s4 = peg$parsewhitespace();
										while (s4 !== peg$FAILED) {
											s3.push(s4);
											s4 = peg$parsewhitespace();
										}
										peg$savedPos = s0;
										s0 = peg$f8();
									} else {
										peg$currPos = s0;
										s0 = peg$FAILED;
									}
									if (s0 === peg$FAILED) {
										s0 = peg$currPos;
										s1 = [];
										s2 = peg$parsewhitespace();
										while (s2 !== peg$FAILED) {
											s1.push(s2);
											s2 = peg$parsewhitespace();
										}
										s2 = peg$parsesubscript();
										if (s2 !== peg$FAILED) {
											s3 = [];
											s4 = peg$parsewhitespace();
											while (s4 !== peg$FAILED) {
												s3.push(s4);
												s4 = peg$parsewhitespace();
											}
											peg$savedPos = s0;
											s0 = peg$f9();
										} else {
											peg$currPos = s0;
											s0 = peg$FAILED;
										}
										if (s0 === peg$FAILED) {
											s0 = peg$parseignore();
											if (s0 === peg$FAILED) {
												s0 = peg$parsewhitespace();
												if (s0 === peg$FAILED) {
													s0 = peg$currPos;
													if (input.length > peg$currPos) {
														s1 = input.charAt(peg$currPos);
														peg$currPos++;
													} else {
														s1 = peg$FAILED;
														if (peg$silentFails === 0) peg$fail(peg$e1);
													}
													if (s1 !== peg$FAILED) {
														peg$savedPos = s0;
														s1 = peg$f10(s1);
													}
													s0 = s1;
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsenonchar_token() {
			let s0;
			const key = peg$currPos * 53 + 5;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$parseescape();
			if (s0 === peg$FAILED) {
				if (input.charCodeAt(peg$currPos) === 37) {
					s0 = peg$c0;
					peg$currPos++;
				} else {
					s0 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e5);
				}
				if (s0 === peg$FAILED) {
					s0 = peg$parsebegin_group();
					if (s0 === peg$FAILED) {
						s0 = peg$parseend_group();
						if (s0 === peg$FAILED) {
							s0 = peg$parsemath_shift();
							if (s0 === peg$FAILED) {
								s0 = peg$parsealignment_tab();
								if (s0 === peg$FAILED) {
									s0 = peg$parsenl();
									if (s0 === peg$FAILED) {
										s0 = peg$parsemacro_parameter();
										if (s0 === peg$FAILED) {
											s0 = peg$parseignore();
											if (s0 === peg$FAILED) {
												s0 = peg$parsesp();
												if (s0 === peg$FAILED) {
													s0 = peg$parsepunctuation();
													if (s0 === peg$FAILED) s0 = peg$parseEOF();
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				if (peg$silentFails === 0) peg$fail(peg$e4);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsewhitespace() {
			let s0, s1, s2, s3, s4, s5, s6, s7;
			const key = peg$currPos * 53 + 6;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$currPos;
			s2 = peg$parsenl();
			if (s2 !== peg$FAILED) {
				s3 = [];
				s4 = peg$parsesp();
				while (s4 !== peg$FAILED) {
					s3.push(s4);
					s4 = peg$parsesp();
				}
				s2 = [s2, s3];
				s1 = s2;
			} else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 === peg$FAILED) {
				s1 = peg$currPos;
				s2 = [];
				s3 = peg$parsesp();
				if (s3 !== peg$FAILED) while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$parsesp();
				}
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s3 = peg$parsenl();
					if (s3 !== peg$FAILED) {
						s4 = peg$currPos;
						peg$silentFails++;
						s5 = peg$parsecomment_start();
						peg$silentFails--;
						if (s5 === peg$FAILED) s4 = void 0;
						else {
							peg$currPos = s4;
							s4 = peg$FAILED;
						}
						if (s4 !== peg$FAILED) {
							s5 = [];
							s6 = peg$parsesp();
							while (s6 !== peg$FAILED) {
								s5.push(s6);
								s6 = peg$parsesp();
							}
							s6 = peg$currPos;
							peg$silentFails++;
							s7 = peg$parsenl();
							peg$silentFails--;
							if (s7 === peg$FAILED) s6 = void 0;
							else {
								peg$currPos = s6;
								s6 = peg$FAILED;
							}
							if (s6 !== peg$FAILED) {
								s2 = [
									s2,
									s3,
									s4,
									s5,
									s6
								];
								s1 = s2;
							} else {
								peg$currPos = s1;
								s1 = peg$FAILED;
							}
						} else {
							peg$currPos = s1;
							s1 = peg$FAILED;
						}
					} else {
						peg$currPos = s1;
						s1 = peg$FAILED;
					}
				} else {
					peg$currPos = s1;
					s1 = peg$FAILED;
				}
				if (s1 === peg$FAILED) {
					s1 = [];
					s2 = peg$parsesp();
					if (s2 !== peg$FAILED) while (s2 !== peg$FAILED) {
						s1.push(s2);
						s2 = peg$parsesp();
					}
					else s1 = peg$FAILED;
				}
			}
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f11();
			}
			s0 = s1;
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e6);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsenumber() {
			let s0, s1, s2, s3, s4, s5;
			const key = peg$currPos * 53 + 7;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$currPos;
			s2 = [];
			s3 = peg$parsenum();
			if (s3 !== peg$FAILED) while (s3 !== peg$FAILED) {
				s2.push(s3);
				s3 = peg$parsenum();
			}
			else s2 = peg$FAILED;
			if (s2 !== peg$FAILED) {
				if (input.charCodeAt(peg$currPos) === 46) {
					s3 = peg$c1;
					peg$currPos++;
				} else {
					s3 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e8);
				}
				if (s3 !== peg$FAILED) {
					s4 = [];
					s5 = peg$parsenum();
					if (s5 !== peg$FAILED) while (s5 !== peg$FAILED) {
						s4.push(s5);
						s5 = peg$parsenum();
					}
					else s4 = peg$FAILED;
					if (s4 !== peg$FAILED) {
						peg$savedPos = s1;
						s1 = peg$f12(s2, s4);
					} else {
						peg$currPos = s1;
						s1 = peg$FAILED;
					}
				} else {
					peg$currPos = s1;
					s1 = peg$FAILED;
				}
			} else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 === peg$FAILED) {
				s1 = peg$currPos;
				if (input.charCodeAt(peg$currPos) === 46) {
					s2 = peg$c1;
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e8);
				}
				if (s2 !== peg$FAILED) {
					s3 = [];
					s4 = peg$parsenum();
					if (s4 !== peg$FAILED) while (s4 !== peg$FAILED) {
						s3.push(s4);
						s4 = peg$parsenum();
					}
					else s3 = peg$FAILED;
					if (s3 !== peg$FAILED) {
						peg$savedPos = s1;
						s1 = peg$f13(s3);
					} else {
						peg$currPos = s1;
						s1 = peg$FAILED;
					}
				} else {
					peg$currPos = s1;
					s1 = peg$FAILED;
				}
				if (s1 === peg$FAILED) {
					s1 = peg$currPos;
					s2 = [];
					s3 = peg$parsenum();
					if (s3 !== peg$FAILED) while (s3 !== peg$FAILED) {
						s2.push(s3);
						s3 = peg$parsenum();
					}
					else s2 = peg$FAILED;
					if (s2 !== peg$FAILED) {
						if (input.charCodeAt(peg$currPos) === 46) {
							s3 = peg$c1;
							peg$currPos++;
						} else {
							s3 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e8);
						}
						if (s3 !== peg$FAILED) {
							peg$savedPos = s1;
							s1 = peg$f14(s2);
						} else {
							peg$currPos = s1;
							s1 = peg$FAILED;
						}
					} else {
						peg$currPos = s1;
						s1 = peg$FAILED;
					}
				}
			}
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f15(s1);
			}
			s0 = s1;
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e7);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsespecial_macro() {
			let s0, s1, s2, s3, s4, s5, s6, s7, s8, s9;
			const key = peg$currPos * 53 + 8;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parseescape();
			if (s1 !== peg$FAILED) {
				if (input.substr(peg$currPos, 5) === peg$c2) {
					s2 = peg$c2;
					peg$currPos += 5;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e10);
				}
				if (s2 === peg$FAILED) if (input.substr(peg$currPos, 4) === peg$c3) {
					s2 = peg$c3;
					peg$currPos += 4;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e11);
				}
				if (s2 !== peg$FAILED) {
					if (input.length > peg$currPos) {
						s3 = input.charAt(peg$currPos);
						peg$currPos++;
					} else {
						s3 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e1);
					}
					if (s3 !== peg$FAILED) {
						s4 = [];
						s5 = peg$currPos;
						s6 = peg$currPos;
						peg$silentFails++;
						s7 = peg$currPos;
						if (input.length > peg$currPos) {
							s8 = input.charAt(peg$currPos);
							peg$currPos++;
						} else {
							s8 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e1);
						}
						if (s8 !== peg$FAILED) {
							peg$savedPos = peg$currPos;
							s9 = peg$f16(s2, s3, s8);
							if (s9) s9 = void 0;
							else s9 = peg$FAILED;
							if (s9 !== peg$FAILED) {
								s8 = [s8, s9];
								s7 = s8;
							} else {
								peg$currPos = s7;
								s7 = peg$FAILED;
							}
						} else {
							peg$currPos = s7;
							s7 = peg$FAILED;
						}
						peg$silentFails--;
						if (s7 === peg$FAILED) s6 = void 0;
						else {
							peg$currPos = s6;
							s6 = peg$FAILED;
						}
						if (s6 !== peg$FAILED) {
							if (input.length > peg$currPos) {
								s7 = input.charAt(peg$currPos);
								peg$currPos++;
							} else {
								s7 = peg$FAILED;
								if (peg$silentFails === 0) peg$fail(peg$e1);
							}
							if (s7 !== peg$FAILED) {
								peg$savedPos = s5;
								s5 = peg$f17(s2, s3, s7);
							} else {
								peg$currPos = s5;
								s5 = peg$FAILED;
							}
						} else {
							peg$currPos = s5;
							s5 = peg$FAILED;
						}
						while (s5 !== peg$FAILED) {
							s4.push(s5);
							s5 = peg$currPos;
							s6 = peg$currPos;
							peg$silentFails++;
							s7 = peg$currPos;
							if (input.length > peg$currPos) {
								s8 = input.charAt(peg$currPos);
								peg$currPos++;
							} else {
								s8 = peg$FAILED;
								if (peg$silentFails === 0) peg$fail(peg$e1);
							}
							if (s8 !== peg$FAILED) {
								peg$savedPos = peg$currPos;
								s9 = peg$f16(s2, s3, s8);
								if (s9) s9 = void 0;
								else s9 = peg$FAILED;
								if (s9 !== peg$FAILED) {
									s8 = [s8, s9];
									s7 = s8;
								} else {
									peg$currPos = s7;
									s7 = peg$FAILED;
								}
							} else {
								peg$currPos = s7;
								s7 = peg$FAILED;
							}
							peg$silentFails--;
							if (s7 === peg$FAILED) s6 = void 0;
							else {
								peg$currPos = s6;
								s6 = peg$FAILED;
							}
							if (s6 !== peg$FAILED) {
								if (input.length > peg$currPos) {
									s7 = input.charAt(peg$currPos);
									peg$currPos++;
								} else {
									s7 = peg$FAILED;
									if (peg$silentFails === 0) peg$fail(peg$e1);
								}
								if (s7 !== peg$FAILED) {
									peg$savedPos = s5;
									s5 = peg$f17(s2, s3, s7);
								} else {
									peg$currPos = s5;
									s5 = peg$FAILED;
								}
							} else {
								peg$currPos = s5;
								s5 = peg$FAILED;
							}
						}
						s5 = peg$currPos;
						if (input.length > peg$currPos) {
							s6 = input.charAt(peg$currPos);
							peg$currPos++;
						} else {
							s6 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e1);
						}
						if (s6 !== peg$FAILED) {
							peg$savedPos = peg$currPos;
							s7 = peg$f18(s2, s3, s4, s6);
							if (s7) s7 = void 0;
							else s7 = peg$FAILED;
							if (s7 !== peg$FAILED) {
								s6 = [s6, s7];
								s5 = s6;
							} else {
								peg$currPos = s5;
								s5 = peg$FAILED;
							}
						} else {
							peg$currPos = s5;
							s5 = peg$FAILED;
						}
						if (s5 !== peg$FAILED) {
							peg$savedPos = s0;
							s0 = peg$f19(s2, s3, s4);
						} else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$parseverbatim_listings();
				if (s0 === peg$FAILED) {
					s0 = peg$parseverbatim_minted();
					if (s0 === peg$FAILED) {
						s0 = peg$parseverbatim_minted_environment();
						if (s0 === peg$FAILED) {
							s0 = peg$parseverbatim_environment_with_optional_arg();
							if (s0 === peg$FAILED) {
								s0 = peg$parseverbatim_environment();
								if (s0 === peg$FAILED) {
									s0 = peg$currPos;
									s1 = peg$parsebegin_display_math();
									if (s1 !== peg$FAILED) {
										s2 = [];
										s3 = peg$currPos;
										s4 = peg$currPos;
										peg$silentFails++;
										s5 = peg$parseend_display_math();
										peg$silentFails--;
										if (s5 === peg$FAILED) s4 = void 0;
										else {
											peg$currPos = s4;
											s4 = peg$FAILED;
										}
										if (s4 !== peg$FAILED) {
											s5 = peg$parsemath_token();
											if (s5 !== peg$FAILED) {
												peg$savedPos = s3;
												s3 = peg$f20(s5);
											} else {
												peg$currPos = s3;
												s3 = peg$FAILED;
											}
										} else {
											peg$currPos = s3;
											s3 = peg$FAILED;
										}
										while (s3 !== peg$FAILED) {
											s2.push(s3);
											s3 = peg$currPos;
											s4 = peg$currPos;
											peg$silentFails++;
											s5 = peg$parseend_display_math();
											peg$silentFails--;
											if (s5 === peg$FAILED) s4 = void 0;
											else {
												peg$currPos = s4;
												s4 = peg$FAILED;
											}
											if (s4 !== peg$FAILED) {
												s5 = peg$parsemath_token();
												if (s5 !== peg$FAILED) {
													peg$savedPos = s3;
													s3 = peg$f20(s5);
												} else {
													peg$currPos = s3;
													s3 = peg$FAILED;
												}
											} else {
												peg$currPos = s3;
												s3 = peg$FAILED;
											}
										}
										s3 = peg$parseend_display_math();
										if (s3 !== peg$FAILED) {
											peg$savedPos = s0;
											s0 = peg$f21(s2);
										} else {
											peg$currPos = s0;
											s0 = peg$FAILED;
										}
									} else {
										peg$currPos = s0;
										s0 = peg$FAILED;
									}
									if (s0 === peg$FAILED) {
										s0 = peg$currPos;
										s1 = peg$parsebegin_inline_math();
										if (s1 !== peg$FAILED) {
											s2 = [];
											s3 = peg$currPos;
											s4 = peg$currPos;
											peg$silentFails++;
											s5 = peg$parseend_inline_math();
											peg$silentFails--;
											if (s5 === peg$FAILED) s4 = void 0;
											else {
												peg$currPos = s4;
												s4 = peg$FAILED;
											}
											if (s4 !== peg$FAILED) {
												s5 = peg$parsemath_token();
												if (s5 !== peg$FAILED) {
													peg$savedPos = s3;
													s3 = peg$f22(s5);
												} else {
													peg$currPos = s3;
													s3 = peg$FAILED;
												}
											} else {
												peg$currPos = s3;
												s3 = peg$FAILED;
											}
											while (s3 !== peg$FAILED) {
												s2.push(s3);
												s3 = peg$currPos;
												s4 = peg$currPos;
												peg$silentFails++;
												s5 = peg$parseend_inline_math();
												peg$silentFails--;
												if (s5 === peg$FAILED) s4 = void 0;
												else {
													peg$currPos = s4;
													s4 = peg$FAILED;
												}
												if (s4 !== peg$FAILED) {
													s5 = peg$parsemath_token();
													if (s5 !== peg$FAILED) {
														peg$savedPos = s3;
														s3 = peg$f22(s5);
													} else {
														peg$currPos = s3;
														s3 = peg$FAILED;
													}
												} else {
													peg$currPos = s3;
													s3 = peg$FAILED;
												}
											}
											s3 = peg$parseend_inline_math();
											if (s3 !== peg$FAILED) {
												peg$savedPos = s0;
												s0 = peg$f23(s2);
											} else {
												peg$currPos = s0;
												s0 = peg$FAILED;
											}
										} else {
											peg$currPos = s0;
											s0 = peg$FAILED;
										}
										if (s0 === peg$FAILED) {
											s0 = peg$currPos;
											s1 = peg$parsemath_shift();
											if (s1 !== peg$FAILED) {
												s2 = peg$parsemath_shift();
												if (s2 !== peg$FAILED) {
													s3 = [];
													s4 = peg$currPos;
													s5 = peg$currPos;
													peg$silentFails++;
													s6 = peg$currPos;
													s7 = peg$parsemath_shift();
													if (s7 !== peg$FAILED) {
														s8 = peg$parsemath_shift();
														if (s8 !== peg$FAILED) {
															s7 = [s7, s8];
															s6 = s7;
														} else {
															peg$currPos = s6;
															s6 = peg$FAILED;
														}
													} else {
														peg$currPos = s6;
														s6 = peg$FAILED;
													}
													peg$silentFails--;
													if (s6 === peg$FAILED) s5 = void 0;
													else {
														peg$currPos = s5;
														s5 = peg$FAILED;
													}
													if (s5 !== peg$FAILED) {
														s6 = peg$parsemath_token();
														if (s6 !== peg$FAILED) {
															peg$savedPos = s4;
															s4 = peg$f24(s6);
														} else {
															peg$currPos = s4;
															s4 = peg$FAILED;
														}
													} else {
														peg$currPos = s4;
														s4 = peg$FAILED;
													}
													while (s4 !== peg$FAILED) {
														s3.push(s4);
														s4 = peg$currPos;
														s5 = peg$currPos;
														peg$silentFails++;
														s6 = peg$currPos;
														s7 = peg$parsemath_shift();
														if (s7 !== peg$FAILED) {
															s8 = peg$parsemath_shift();
															if (s8 !== peg$FAILED) {
																s7 = [s7, s8];
																s6 = s7;
															} else {
																peg$currPos = s6;
																s6 = peg$FAILED;
															}
														} else {
															peg$currPos = s6;
															s6 = peg$FAILED;
														}
														peg$silentFails--;
														if (s6 === peg$FAILED) s5 = void 0;
														else {
															peg$currPos = s5;
															s5 = peg$FAILED;
														}
														if (s5 !== peg$FAILED) {
															s6 = peg$parsemath_token();
															if (s6 !== peg$FAILED) {
																peg$savedPos = s4;
																s4 = peg$f24(s6);
															} else {
																peg$currPos = s4;
																s4 = peg$FAILED;
															}
														} else {
															peg$currPos = s4;
															s4 = peg$FAILED;
														}
													}
													s4 = peg$parsemath_shift();
													if (s4 !== peg$FAILED) {
														s5 = peg$parsemath_shift();
														if (s5 !== peg$FAILED) {
															peg$savedPos = s0;
															s0 = peg$f25(s3);
														} else {
															peg$currPos = s0;
															s0 = peg$FAILED;
														}
													} else {
														peg$currPos = s0;
														s0 = peg$FAILED;
													}
												} else {
													peg$currPos = s0;
													s0 = peg$FAILED;
												}
											} else {
												peg$currPos = s0;
												s0 = peg$FAILED;
											}
											if (s0 === peg$FAILED) {
												s0 = peg$parsemath_environment();
												if (s0 === peg$FAILED) s0 = peg$parseenvironment();
											}
										}
									}
								}
							}
						}
					}
				}
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e9);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsesquare_bracket_argument() {
			let s0, s1, s2, s3, s4, s5, s6, s7;
			const key = peg$currPos * 53 + 9;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 91) {
				s1 = peg$c4;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e12);
			}
			if (s1 !== peg$FAILED) {
				s2 = [];
				s3 = peg$currPos;
				s4 = peg$currPos;
				peg$silentFails++;
				s5 = peg$currPos;
				s6 = peg$parsetoken();
				if (s6 !== peg$FAILED) {
					peg$savedPos = peg$currPos;
					s7 = peg$f26(s6);
					if (s7) s7 = void 0;
					else s7 = peg$FAILED;
					if (s7 !== peg$FAILED) {
						s6 = [s6, s7];
						s5 = s6;
					} else {
						peg$currPos = s5;
						s5 = peg$FAILED;
					}
				} else {
					peg$currPos = s5;
					s5 = peg$FAILED;
				}
				peg$silentFails--;
				if (s5 === peg$FAILED) s4 = void 0;
				else {
					peg$currPos = s4;
					s4 = peg$FAILED;
				}
				if (s4 !== peg$FAILED) {
					s5 = peg$parsetoken();
					if (s5 !== peg$FAILED) {
						peg$savedPos = s3;
						s3 = peg$f27(s5);
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				} else {
					peg$currPos = s3;
					s3 = peg$FAILED;
				}
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$currPos;
					s4 = peg$currPos;
					peg$silentFails++;
					s5 = peg$currPos;
					s6 = peg$parsetoken();
					if (s6 !== peg$FAILED) {
						peg$savedPos = peg$currPos;
						s7 = peg$f26(s6);
						if (s7) s7 = void 0;
						else s7 = peg$FAILED;
						if (s7 !== peg$FAILED) {
							s6 = [s6, s7];
							s5 = s6;
						} else {
							peg$currPos = s5;
							s5 = peg$FAILED;
						}
					} else {
						peg$currPos = s5;
						s5 = peg$FAILED;
					}
					peg$silentFails--;
					if (s5 === peg$FAILED) s4 = void 0;
					else {
						peg$currPos = s4;
						s4 = peg$FAILED;
					}
					if (s4 !== peg$FAILED) {
						s5 = peg$parsetoken();
						if (s5 !== peg$FAILED) {
							peg$savedPos = s3;
							s3 = peg$f27(s5);
						} else {
							peg$currPos = s3;
							s3 = peg$FAILED;
						}
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				}
				if (input.charCodeAt(peg$currPos) === 93) {
					s3 = peg$c5;
					peg$currPos++;
				} else {
					s3 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e13);
				}
				if (s3 !== peg$FAILED) {
					peg$savedPos = s0;
					s0 = peg$f28(s2);
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseverbatim_group() {
			let s0, s1, s2, s3, s4, s5;
			const key = peg$currPos * 53 + 10;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			s1 = peg$parsebegin_group();
			if (s1 !== peg$FAILED) {
				s2 = [];
				s3 = peg$currPos;
				s4 = peg$currPos;
				peg$silentFails++;
				s5 = peg$parseend_group();
				peg$silentFails--;
				if (s5 === peg$FAILED) s4 = void 0;
				else {
					peg$currPos = s4;
					s4 = peg$FAILED;
				}
				if (s4 !== peg$FAILED) {
					if (input.length > peg$currPos) {
						s5 = input.charAt(peg$currPos);
						peg$currPos++;
					} else {
						s5 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e1);
					}
					if (s5 !== peg$FAILED) {
						peg$savedPos = s3;
						s3 = peg$f29(s5);
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				} else {
					peg$currPos = s3;
					s3 = peg$FAILED;
				}
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$currPos;
					s4 = peg$currPos;
					peg$silentFails++;
					s5 = peg$parseend_group();
					peg$silentFails--;
					if (s5 === peg$FAILED) s4 = void 0;
					else {
						peg$currPos = s4;
						s4 = peg$FAILED;
					}
					if (s4 !== peg$FAILED) {
						if (input.length > peg$currPos) {
							s5 = input.charAt(peg$currPos);
							peg$currPos++;
						} else {
							s5 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e1);
						}
						if (s5 !== peg$FAILED) {
							peg$savedPos = s3;
							s3 = peg$f29(s5);
						} else {
							peg$currPos = s3;
							s3 = peg$FAILED;
						}
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				}
				s3 = peg$parseend_group();
				if (s3 !== peg$FAILED) {
					peg$savedPos = s0;
					s0 = peg$f30(s2);
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseverbatim_delimited_by_char() {
			let s0, s1, s2, s3, s4, s5, s6, s7;
			const key = peg$currPos * 53 + 11;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			s1 = input.charAt(peg$currPos);
			if (peg$r0.test(s1)) peg$currPos++;
			else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e14);
			}
			if (s1 !== peg$FAILED) {
				s2 = [];
				s3 = peg$currPos;
				s4 = peg$currPos;
				peg$silentFails++;
				s5 = peg$currPos;
				if (input.length > peg$currPos) {
					s6 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s6 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e1);
				}
				if (s6 !== peg$FAILED) {
					peg$savedPos = peg$currPos;
					s7 = peg$f31(s1, s6);
					if (s7) s7 = void 0;
					else s7 = peg$FAILED;
					if (s7 !== peg$FAILED) {
						s6 = [s6, s7];
						s5 = s6;
					} else {
						peg$currPos = s5;
						s5 = peg$FAILED;
					}
				} else {
					peg$currPos = s5;
					s5 = peg$FAILED;
				}
				peg$silentFails--;
				if (s5 === peg$FAILED) s4 = void 0;
				else {
					peg$currPos = s4;
					s4 = peg$FAILED;
				}
				if (s4 !== peg$FAILED) {
					if (input.length > peg$currPos) {
						s5 = input.charAt(peg$currPos);
						peg$currPos++;
					} else {
						s5 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e1);
					}
					if (s5 !== peg$FAILED) {
						peg$savedPos = s3;
						s3 = peg$f32(s1, s5);
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				} else {
					peg$currPos = s3;
					s3 = peg$FAILED;
				}
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$currPos;
					s4 = peg$currPos;
					peg$silentFails++;
					s5 = peg$currPos;
					if (input.length > peg$currPos) {
						s6 = input.charAt(peg$currPos);
						peg$currPos++;
					} else {
						s6 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e1);
					}
					if (s6 !== peg$FAILED) {
						peg$savedPos = peg$currPos;
						s7 = peg$f31(s1, s6);
						if (s7) s7 = void 0;
						else s7 = peg$FAILED;
						if (s7 !== peg$FAILED) {
							s6 = [s6, s7];
							s5 = s6;
						} else {
							peg$currPos = s5;
							s5 = peg$FAILED;
						}
					} else {
						peg$currPos = s5;
						s5 = peg$FAILED;
					}
					peg$silentFails--;
					if (s5 === peg$FAILED) s4 = void 0;
					else {
						peg$currPos = s4;
						s4 = peg$FAILED;
					}
					if (s4 !== peg$FAILED) {
						if (input.length > peg$currPos) {
							s5 = input.charAt(peg$currPos);
							peg$currPos++;
						} else {
							s5 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e1);
						}
						if (s5 !== peg$FAILED) {
							peg$savedPos = s3;
							s3 = peg$f32(s1, s5);
						} else {
							peg$currPos = s3;
							s3 = peg$FAILED;
						}
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				}
				s3 = peg$currPos;
				if (input.length > peg$currPos) {
					s4 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s4 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e1);
				}
				if (s4 !== peg$FAILED) {
					peg$savedPos = peg$currPos;
					s5 = peg$f33(s1, s2, s4);
					if (s5) s5 = void 0;
					else s5 = peg$FAILED;
					if (s5 !== peg$FAILED) {
						s4 = [s4, s5];
						s3 = s4;
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				} else {
					peg$currPos = s3;
					s3 = peg$FAILED;
				}
				if (s3 !== peg$FAILED) {
					peg$savedPos = s0;
					s0 = peg$f34(s1, s2);
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseverbatim_listings() {
			let s0, s1, s2, s3, s4;
			const key = peg$currPos * 53 + 12;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parseescape();
			if (s1 !== peg$FAILED) {
				if (input.substr(peg$currPos, 9) === peg$c6) {
					s2 = peg$c6;
					peg$currPos += 9;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e16);
				}
				if (s2 !== peg$FAILED) {
					s3 = peg$parsesquare_bracket_argument();
					if (s3 === peg$FAILED) s3 = null;
					s4 = peg$parseverbatim_group();
					if (s4 === peg$FAILED) s4 = peg$parseverbatim_delimited_by_char();
					if (s4 !== peg$FAILED) {
						peg$savedPos = s0;
						s0 = peg$f35(s2, s3, s4);
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e15);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseverbatim_minted() {
			let s0, s1, s2, s3, s4, s5;
			const key = peg$currPos * 53 + 13;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parseescape();
			if (s1 !== peg$FAILED) {
				if (input.substr(peg$currPos, 10) === peg$c7) {
					s2 = peg$c7;
					peg$currPos += 10;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e18);
				}
				if (s2 === peg$FAILED) if (input.substr(peg$currPos, 4) === peg$c8) {
					s2 = peg$c8;
					peg$currPos += 4;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e19);
				}
				if (s2 !== peg$FAILED) {
					s3 = peg$parsesquare_bracket_argument();
					if (s3 === peg$FAILED) s3 = null;
					s4 = peg$parsegroup();
					if (s4 !== peg$FAILED) {
						s5 = peg$parseverbatim_group();
						if (s5 === peg$FAILED) s5 = peg$parseverbatim_delimited_by_char();
						if (s5 !== peg$FAILED) {
							peg$savedPos = s0;
							s0 = peg$f36(s2, s3, s4, s5);
						} else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e17);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseverbatim_minted_environment() {
			let s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14;
			const key = peg$currPos * 53 + 14;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parsebegin_env();
			if (s1 !== peg$FAILED) {
				s2 = peg$parsebegin_group();
				if (s2 !== peg$FAILED) {
					if (input.substr(peg$currPos, 6) === peg$c9) {
						s3 = peg$c9;
						peg$currPos += 6;
					} else {
						s3 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e21);
					}
					if (s3 !== peg$FAILED) {
						s4 = peg$parseend_group();
						if (s4 !== peg$FAILED) {
							s5 = peg$parsesquare_bracket_argument();
							if (s5 === peg$FAILED) s5 = null;
							s6 = peg$parsegroup();
							if (s6 !== peg$FAILED) {
								s7 = peg$currPos;
								s8 = [];
								s9 = peg$currPos;
								s10 = peg$currPos;
								peg$silentFails++;
								s11 = peg$currPos;
								s12 = peg$parseend_env();
								if (s12 !== peg$FAILED) {
									s13 = peg$parsegroup();
									if (s13 !== peg$FAILED) {
										peg$savedPos = peg$currPos;
										s14 = peg$f37(s3, s5, s6, s13);
										if (s14) s14 = void 0;
										else s14 = peg$FAILED;
										if (s14 !== peg$FAILED) {
											s12 = [
												s12,
												s13,
												s14
											];
											s11 = s12;
										} else {
											peg$currPos = s11;
											s11 = peg$FAILED;
										}
									} else {
										peg$currPos = s11;
										s11 = peg$FAILED;
									}
								} else {
									peg$currPos = s11;
									s11 = peg$FAILED;
								}
								peg$silentFails--;
								if (s11 === peg$FAILED) s10 = void 0;
								else {
									peg$currPos = s10;
									s10 = peg$FAILED;
								}
								if (s10 !== peg$FAILED) {
									if (input.length > peg$currPos) {
										s11 = input.charAt(peg$currPos);
										peg$currPos++;
									} else {
										s11 = peg$FAILED;
										if (peg$silentFails === 0) peg$fail(peg$e1);
									}
									if (s11 !== peg$FAILED) {
										s10 = [s10, s11];
										s9 = s10;
									} else {
										peg$currPos = s9;
										s9 = peg$FAILED;
									}
								} else {
									peg$currPos = s9;
									s9 = peg$FAILED;
								}
								while (s9 !== peg$FAILED) {
									s8.push(s9);
									s9 = peg$currPos;
									s10 = peg$currPos;
									peg$silentFails++;
									s11 = peg$currPos;
									s12 = peg$parseend_env();
									if (s12 !== peg$FAILED) {
										s13 = peg$parsegroup();
										if (s13 !== peg$FAILED) {
											peg$savedPos = peg$currPos;
											s14 = peg$f37(s3, s5, s6, s13);
											if (s14) s14 = void 0;
											else s14 = peg$FAILED;
											if (s14 !== peg$FAILED) {
												s12 = [
													s12,
													s13,
													s14
												];
												s11 = s12;
											} else {
												peg$currPos = s11;
												s11 = peg$FAILED;
											}
										} else {
											peg$currPos = s11;
											s11 = peg$FAILED;
										}
									} else {
										peg$currPos = s11;
										s11 = peg$FAILED;
									}
									peg$silentFails--;
									if (s11 === peg$FAILED) s10 = void 0;
									else {
										peg$currPos = s10;
										s10 = peg$FAILED;
									}
									if (s10 !== peg$FAILED) {
										if (input.length > peg$currPos) {
											s11 = input.charAt(peg$currPos);
											peg$currPos++;
										} else {
											s11 = peg$FAILED;
											if (peg$silentFails === 0) peg$fail(peg$e1);
										}
										if (s11 !== peg$FAILED) {
											s10 = [s10, s11];
											s9 = s10;
										} else {
											peg$currPos = s9;
											s9 = peg$FAILED;
										}
									} else {
										peg$currPos = s9;
										s9 = peg$FAILED;
									}
								}
								s7 = input.substring(s7, peg$currPos);
								s8 = peg$parseend_env();
								if (s8 !== peg$FAILED) {
									s9 = peg$parsebegin_group();
									if (s9 !== peg$FAILED) {
										if (input.substr(peg$currPos, 6) === peg$c9) {
											s10 = peg$c9;
											peg$currPos += 6;
										} else {
											s10 = peg$FAILED;
											if (peg$silentFails === 0) peg$fail(peg$e21);
										}
										if (s10 !== peg$FAILED) {
											s11 = peg$parseend_group();
											if (s11 !== peg$FAILED) {
												peg$savedPos = s0;
												s0 = peg$f38(s3, s5, s6, s7);
											} else {
												peg$currPos = s0;
												s0 = peg$FAILED;
											}
										} else {
											peg$currPos = s0;
											s0 = peg$FAILED;
										}
									} else {
										peg$currPos = s0;
										s0 = peg$FAILED;
									}
								} else {
									peg$currPos = s0;
									s0 = peg$FAILED;
								}
							} else {
								peg$currPos = s0;
								s0 = peg$FAILED;
							}
						} else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e20);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseverbatim_environment_with_optional_arg() {
			let s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13;
			const key = peg$currPos * 53 + 15;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parsebegin_env();
			if (s1 !== peg$FAILED) {
				s2 = peg$parsebegin_group();
				if (s2 !== peg$FAILED) {
					s3 = peg$parseverbatim_env_name_allows_optional_arg();
					if (s3 !== peg$FAILED) {
						s4 = peg$parseend_group();
						if (s4 !== peg$FAILED) {
							s5 = peg$parsesquare_bracket_argument();
							if (s5 === peg$FAILED) s5 = null;
							s6 = peg$currPos;
							s7 = [];
							s8 = peg$currPos;
							s9 = peg$currPos;
							peg$silentFails++;
							s10 = peg$currPos;
							s11 = peg$parseend_env();
							if (s11 !== peg$FAILED) {
								s12 = peg$parsegroup();
								if (s12 !== peg$FAILED) {
									peg$savedPos = peg$currPos;
									s13 = peg$f39(s3, s5, s12);
									if (s13) s13 = void 0;
									else s13 = peg$FAILED;
									if (s13 !== peg$FAILED) {
										s11 = [
											s11,
											s12,
											s13
										];
										s10 = s11;
									} else {
										peg$currPos = s10;
										s10 = peg$FAILED;
									}
								} else {
									peg$currPos = s10;
									s10 = peg$FAILED;
								}
							} else {
								peg$currPos = s10;
								s10 = peg$FAILED;
							}
							peg$silentFails--;
							if (s10 === peg$FAILED) s9 = void 0;
							else {
								peg$currPos = s9;
								s9 = peg$FAILED;
							}
							if (s9 !== peg$FAILED) {
								if (input.length > peg$currPos) {
									s10 = input.charAt(peg$currPos);
									peg$currPos++;
								} else {
									s10 = peg$FAILED;
									if (peg$silentFails === 0) peg$fail(peg$e1);
								}
								if (s10 !== peg$FAILED) {
									peg$savedPos = s8;
									s8 = peg$f40(s3, s5, s10);
								} else {
									peg$currPos = s8;
									s8 = peg$FAILED;
								}
							} else {
								peg$currPos = s8;
								s8 = peg$FAILED;
							}
							while (s8 !== peg$FAILED) {
								s7.push(s8);
								s8 = peg$currPos;
								s9 = peg$currPos;
								peg$silentFails++;
								s10 = peg$currPos;
								s11 = peg$parseend_env();
								if (s11 !== peg$FAILED) {
									s12 = peg$parsegroup();
									if (s12 !== peg$FAILED) {
										peg$savedPos = peg$currPos;
										s13 = peg$f39(s3, s5, s12);
										if (s13) s13 = void 0;
										else s13 = peg$FAILED;
										if (s13 !== peg$FAILED) {
											s11 = [
												s11,
												s12,
												s13
											];
											s10 = s11;
										} else {
											peg$currPos = s10;
											s10 = peg$FAILED;
										}
									} else {
										peg$currPos = s10;
										s10 = peg$FAILED;
									}
								} else {
									peg$currPos = s10;
									s10 = peg$FAILED;
								}
								peg$silentFails--;
								if (s10 === peg$FAILED) s9 = void 0;
								else {
									peg$currPos = s9;
									s9 = peg$FAILED;
								}
								if (s9 !== peg$FAILED) {
									if (input.length > peg$currPos) {
										s10 = input.charAt(peg$currPos);
										peg$currPos++;
									} else {
										s10 = peg$FAILED;
										if (peg$silentFails === 0) peg$fail(peg$e1);
									}
									if (s10 !== peg$FAILED) {
										peg$savedPos = s8;
										s8 = peg$f40(s3, s5, s10);
									} else {
										peg$currPos = s8;
										s8 = peg$FAILED;
									}
								} else {
									peg$currPos = s8;
									s8 = peg$FAILED;
								}
							}
							s6 = input.substring(s6, peg$currPos);
							s7 = peg$parseend_env();
							if (s7 !== peg$FAILED) {
								s8 = peg$parsebegin_group();
								if (s8 !== peg$FAILED) {
									s9 = peg$parseverbatim_env_name_allows_optional_arg();
									if (s9 !== peg$FAILED) {
										s10 = peg$parseend_group();
										if (s10 !== peg$FAILED) {
											peg$savedPos = s0;
											s0 = peg$f41(s3, s5, s6);
										} else {
											peg$currPos = s0;
											s0 = peg$FAILED;
										}
									} else {
										peg$currPos = s0;
										s0 = peg$FAILED;
									}
								} else {
									peg$currPos = s0;
									s0 = peg$FAILED;
								}
							} else {
								peg$currPos = s0;
								s0 = peg$FAILED;
							}
						} else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e22);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseverbatim_environment() {
			let s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12;
			const key = peg$currPos * 53 + 16;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parsebegin_env();
			if (s1 !== peg$FAILED) {
				s2 = peg$parsebegin_group();
				if (s2 !== peg$FAILED) {
					s3 = peg$parseverbatim_env_name();
					if (s3 !== peg$FAILED) {
						s4 = peg$parseend_group();
						if (s4 !== peg$FAILED) {
							s5 = peg$currPos;
							s6 = [];
							s7 = peg$currPos;
							s8 = peg$currPos;
							peg$silentFails++;
							s9 = peg$currPos;
							s10 = peg$parseend_env();
							if (s10 !== peg$FAILED) {
								s11 = peg$parsegroup();
								if (s11 !== peg$FAILED) {
									peg$savedPos = peg$currPos;
									s12 = peg$f42(s3, s11);
									if (s12) s12 = void 0;
									else s12 = peg$FAILED;
									if (s12 !== peg$FAILED) {
										s10 = [
											s10,
											s11,
											s12
										];
										s9 = s10;
									} else {
										peg$currPos = s9;
										s9 = peg$FAILED;
									}
								} else {
									peg$currPos = s9;
									s9 = peg$FAILED;
								}
							} else {
								peg$currPos = s9;
								s9 = peg$FAILED;
							}
							peg$silentFails--;
							if (s9 === peg$FAILED) s8 = void 0;
							else {
								peg$currPos = s8;
								s8 = peg$FAILED;
							}
							if (s8 !== peg$FAILED) {
								if (input.length > peg$currPos) {
									s9 = input.charAt(peg$currPos);
									peg$currPos++;
								} else {
									s9 = peg$FAILED;
									if (peg$silentFails === 0) peg$fail(peg$e1);
								}
								if (s9 !== peg$FAILED) {
									peg$savedPos = s7;
									s7 = peg$f43(s3, s9);
								} else {
									peg$currPos = s7;
									s7 = peg$FAILED;
								}
							} else {
								peg$currPos = s7;
								s7 = peg$FAILED;
							}
							while (s7 !== peg$FAILED) {
								s6.push(s7);
								s7 = peg$currPos;
								s8 = peg$currPos;
								peg$silentFails++;
								s9 = peg$currPos;
								s10 = peg$parseend_env();
								if (s10 !== peg$FAILED) {
									s11 = peg$parsegroup();
									if (s11 !== peg$FAILED) {
										peg$savedPos = peg$currPos;
										s12 = peg$f42(s3, s11);
										if (s12) s12 = void 0;
										else s12 = peg$FAILED;
										if (s12 !== peg$FAILED) {
											s10 = [
												s10,
												s11,
												s12
											];
											s9 = s10;
										} else {
											peg$currPos = s9;
											s9 = peg$FAILED;
										}
									} else {
										peg$currPos = s9;
										s9 = peg$FAILED;
									}
								} else {
									peg$currPos = s9;
									s9 = peg$FAILED;
								}
								peg$silentFails--;
								if (s9 === peg$FAILED) s8 = void 0;
								else {
									peg$currPos = s8;
									s8 = peg$FAILED;
								}
								if (s8 !== peg$FAILED) {
									if (input.length > peg$currPos) {
										s9 = input.charAt(peg$currPos);
										peg$currPos++;
									} else {
										s9 = peg$FAILED;
										if (peg$silentFails === 0) peg$fail(peg$e1);
									}
									if (s9 !== peg$FAILED) {
										peg$savedPos = s7;
										s7 = peg$f43(s3, s9);
									} else {
										peg$currPos = s7;
										s7 = peg$FAILED;
									}
								} else {
									peg$currPos = s7;
									s7 = peg$FAILED;
								}
							}
							s5 = input.substring(s5, peg$currPos);
							s6 = peg$parseend_env();
							if (s6 !== peg$FAILED) {
								s7 = peg$parsebegin_group();
								if (s7 !== peg$FAILED) {
									s8 = peg$parseverbatim_env_name();
									if (s8 !== peg$FAILED) {
										s9 = peg$parseend_group();
										if (s9 !== peg$FAILED) {
											peg$savedPos = s0;
											s0 = peg$f44(s3, s5);
										} else {
											peg$currPos = s0;
											s0 = peg$FAILED;
										}
									} else {
										peg$currPos = s0;
										s0 = peg$FAILED;
									}
								} else {
									peg$currPos = s0;
									s0 = peg$FAILED;
								}
							} else {
								peg$currPos = s0;
								s0 = peg$FAILED;
							}
						} else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e23);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseverbatim_env_name() {
			let s0;
			const key = peg$currPos * 53 + 17;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			if (input.substr(peg$currPos, 9) === peg$c10) {
				s0 = peg$c10;
				peg$currPos += 9;
			} else {
				s0 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e24);
			}
			if (s0 === peg$FAILED) {
				if (input.substr(peg$currPos, 8) === peg$c11) {
					s0 = peg$c11;
					peg$currPos += 8;
				} else {
					s0 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e25);
				}
				if (s0 === peg$FAILED) {
					if (input.substr(peg$currPos, 13) === peg$c12) {
						s0 = peg$c12;
						peg$currPos += 13;
					} else {
						s0 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e26);
					}
					if (s0 === peg$FAILED) {
						if (input.substr(peg$currPos, 12) === peg$c13) {
							s0 = peg$c13;
							peg$currPos += 12;
						} else {
							s0 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e27);
						}
						if (s0 === peg$FAILED) if (input.substr(peg$currPos, 7) === peg$c14) {
							s0 = peg$c14;
							peg$currPos += 7;
						} else {
							s0 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e28);
						}
					}
				}
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseverbatim_env_name_allows_optional_arg() {
			let s0;
			const key = peg$currPos * 53 + 18;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			if (input.substr(peg$currPos, 10) === peg$c15) {
				s0 = peg$c15;
				peg$currPos += 10;
			} else {
				s0 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e29);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsemacro() {
			let s0, s1, s2, s3, s4;
			const key = peg$currPos * 53 + 19;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$currPos;
			s2 = peg$parseescape();
			if (s2 !== peg$FAILED) {
				s3 = [];
				s4 = peg$parsechar();
				if (s4 !== peg$FAILED) while (s4 !== peg$FAILED) {
					s3.push(s4);
					s4 = peg$parsechar();
				}
				else s3 = peg$FAILED;
				if (s3 !== peg$FAILED) {
					peg$savedPos = s1;
					s1 = peg$f45(s3);
				} else {
					peg$currPos = s1;
					s1 = peg$FAILED;
				}
			} else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 === peg$FAILED) {
				s1 = peg$currPos;
				s2 = peg$parseescape();
				if (s2 !== peg$FAILED) {
					if (input.length > peg$currPos) {
						s3 = input.charAt(peg$currPos);
						peg$currPos++;
					} else {
						s3 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e1);
					}
					if (s3 !== peg$FAILED) {
						peg$savedPos = s1;
						s1 = peg$f46(s3);
					} else {
						peg$currPos = s1;
						s1 = peg$FAILED;
					}
				} else {
					peg$currPos = s1;
					s1 = peg$FAILED;
				}
			}
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f47(s1);
			}
			s0 = s1;
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e30);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsegroup() {
			let s0, s1, s2, s3, s4, s5;
			const key = peg$currPos * 53 + 20;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parsebegin_group();
			if (s1 !== peg$FAILED) {
				s2 = [];
				s3 = peg$currPos;
				s4 = peg$currPos;
				peg$silentFails++;
				s5 = peg$parseend_group();
				peg$silentFails--;
				if (s5 === peg$FAILED) s4 = void 0;
				else {
					peg$currPos = s4;
					s4 = peg$FAILED;
				}
				if (s4 !== peg$FAILED) {
					s5 = peg$parsetoken();
					if (s5 !== peg$FAILED) {
						peg$savedPos = s3;
						s3 = peg$f48(s5);
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				} else {
					peg$currPos = s3;
					s3 = peg$FAILED;
				}
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$currPos;
					s4 = peg$currPos;
					peg$silentFails++;
					s5 = peg$parseend_group();
					peg$silentFails--;
					if (s5 === peg$FAILED) s4 = void 0;
					else {
						peg$currPos = s4;
						s4 = peg$FAILED;
					}
					if (s4 !== peg$FAILED) {
						s5 = peg$parsetoken();
						if (s5 !== peg$FAILED) {
							peg$savedPos = s3;
							s3 = peg$f48(s5);
						} else {
							peg$currPos = s3;
							s3 = peg$FAILED;
						}
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				}
				s3 = peg$parseend_group();
				if (s3 !== peg$FAILED) {
					peg$savedPos = s0;
					s0 = peg$f49(s2);
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e31);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsegroup_contents_as_string() {
			let s0, s1;
			const key = peg$currPos * 53 + 21;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			s1 = peg$parsegroup();
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f50(s1);
			}
			s0 = s1;
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseenvironment() {
			let s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10;
			const key = peg$currPos * 53 + 22;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parsebegin_env();
			if (s1 !== peg$FAILED) {
				s2 = peg$parsegroup_contents_as_string();
				if (s2 !== peg$FAILED) {
					s3 = peg$parsesameline_comment();
					if (s3 === peg$FAILED) s3 = null;
					s4 = [];
					s5 = peg$currPos;
					s6 = peg$currPos;
					peg$silentFails++;
					s7 = peg$currPos;
					s8 = peg$parseend_env();
					if (s8 !== peg$FAILED) {
						s9 = peg$parsegroup_contents_as_string();
						if (s9 !== peg$FAILED) {
							peg$savedPos = peg$currPos;
							s10 = peg$f51(s2, s3, s9);
							if (s10) s10 = void 0;
							else s10 = peg$FAILED;
							if (s10 !== peg$FAILED) {
								s8 = [
									s8,
									s9,
									s10
								];
								s7 = s8;
							} else {
								peg$currPos = s7;
								s7 = peg$FAILED;
							}
						} else {
							peg$currPos = s7;
							s7 = peg$FAILED;
						}
					} else {
						peg$currPos = s7;
						s7 = peg$FAILED;
					}
					peg$silentFails--;
					if (s7 === peg$FAILED) s6 = void 0;
					else {
						peg$currPos = s6;
						s6 = peg$FAILED;
					}
					if (s6 !== peg$FAILED) {
						s7 = peg$parsetoken();
						if (s7 !== peg$FAILED) {
							peg$savedPos = s5;
							s5 = peg$f52(s2, s3, s7);
						} else {
							peg$currPos = s5;
							s5 = peg$FAILED;
						}
					} else {
						peg$currPos = s5;
						s5 = peg$FAILED;
					}
					while (s5 !== peg$FAILED) {
						s4.push(s5);
						s5 = peg$currPos;
						s6 = peg$currPos;
						peg$silentFails++;
						s7 = peg$currPos;
						s8 = peg$parseend_env();
						if (s8 !== peg$FAILED) {
							s9 = peg$parsegroup_contents_as_string();
							if (s9 !== peg$FAILED) {
								peg$savedPos = peg$currPos;
								s10 = peg$f51(s2, s3, s9);
								if (s10) s10 = void 0;
								else s10 = peg$FAILED;
								if (s10 !== peg$FAILED) {
									s8 = [
										s8,
										s9,
										s10
									];
									s7 = s8;
								} else {
									peg$currPos = s7;
									s7 = peg$FAILED;
								}
							} else {
								peg$currPos = s7;
								s7 = peg$FAILED;
							}
						} else {
							peg$currPos = s7;
							s7 = peg$FAILED;
						}
						peg$silentFails--;
						if (s7 === peg$FAILED) s6 = void 0;
						else {
							peg$currPos = s6;
							s6 = peg$FAILED;
						}
						if (s6 !== peg$FAILED) {
							s7 = peg$parsetoken();
							if (s7 !== peg$FAILED) {
								peg$savedPos = s5;
								s5 = peg$f52(s2, s3, s7);
							} else {
								peg$currPos = s5;
								s5 = peg$FAILED;
							}
						} else {
							peg$currPos = s5;
							s5 = peg$FAILED;
						}
					}
					s5 = peg$parseend_env();
					if (s5 !== peg$FAILED) {
						s6 = peg$parsegroup_contents_as_string();
						if (s6 !== peg$FAILED) {
							peg$savedPos = s0;
							s0 = peg$f53(s2, s3, s4);
						} else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e32);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsemath_environment() {
			let s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12;
			const key = peg$currPos * 53 + 23;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parsebegin_env();
			if (s1 !== peg$FAILED) {
				s2 = peg$parsebegin_group();
				if (s2 !== peg$FAILED) {
					s3 = peg$parsemath_env_name();
					if (s3 !== peg$FAILED) {
						s4 = peg$parseend_group();
						if (s4 !== peg$FAILED) {
							s5 = peg$parsesameline_comment();
							if (s5 === peg$FAILED) s5 = null;
							s6 = [];
							s7 = peg$currPos;
							s8 = peg$currPos;
							peg$silentFails++;
							s9 = peg$currPos;
							s10 = peg$parseend_env();
							if (s10 !== peg$FAILED) {
								s11 = peg$parsegroup();
								if (s11 !== peg$FAILED) {
									peg$savedPos = peg$currPos;
									s12 = peg$f54(s3, s5, s11);
									if (s12) s12 = void 0;
									else s12 = peg$FAILED;
									if (s12 !== peg$FAILED) {
										s10 = [
											s10,
											s11,
											s12
										];
										s9 = s10;
									} else {
										peg$currPos = s9;
										s9 = peg$FAILED;
									}
								} else {
									peg$currPos = s9;
									s9 = peg$FAILED;
								}
							} else {
								peg$currPos = s9;
								s9 = peg$FAILED;
							}
							peg$silentFails--;
							if (s9 === peg$FAILED) s8 = void 0;
							else {
								peg$currPos = s8;
								s8 = peg$FAILED;
							}
							if (s8 !== peg$FAILED) {
								s9 = peg$parsemath_token();
								if (s9 !== peg$FAILED) {
									peg$savedPos = s7;
									s7 = peg$f55(s3, s5, s9);
								} else {
									peg$currPos = s7;
									s7 = peg$FAILED;
								}
							} else {
								peg$currPos = s7;
								s7 = peg$FAILED;
							}
							while (s7 !== peg$FAILED) {
								s6.push(s7);
								s7 = peg$currPos;
								s8 = peg$currPos;
								peg$silentFails++;
								s9 = peg$currPos;
								s10 = peg$parseend_env();
								if (s10 !== peg$FAILED) {
									s11 = peg$parsegroup();
									if (s11 !== peg$FAILED) {
										peg$savedPos = peg$currPos;
										s12 = peg$f54(s3, s5, s11);
										if (s12) s12 = void 0;
										else s12 = peg$FAILED;
										if (s12 !== peg$FAILED) {
											s10 = [
												s10,
												s11,
												s12
											];
											s9 = s10;
										} else {
											peg$currPos = s9;
											s9 = peg$FAILED;
										}
									} else {
										peg$currPos = s9;
										s9 = peg$FAILED;
									}
								} else {
									peg$currPos = s9;
									s9 = peg$FAILED;
								}
								peg$silentFails--;
								if (s9 === peg$FAILED) s8 = void 0;
								else {
									peg$currPos = s8;
									s8 = peg$FAILED;
								}
								if (s8 !== peg$FAILED) {
									s9 = peg$parsemath_token();
									if (s9 !== peg$FAILED) {
										peg$savedPos = s7;
										s7 = peg$f55(s3, s5, s9);
									} else {
										peg$currPos = s7;
										s7 = peg$FAILED;
									}
								} else {
									peg$currPos = s7;
									s7 = peg$FAILED;
								}
							}
							s7 = peg$parseend_env();
							if (s7 !== peg$FAILED) {
								s8 = peg$parsebegin_group();
								if (s8 !== peg$FAILED) {
									s9 = peg$parsemath_env_name();
									if (s9 !== peg$FAILED) {
										s10 = peg$parseend_group();
										if (s10 !== peg$FAILED) {
											peg$savedPos = s0;
											s0 = peg$f56(s3, s5, s6);
										} else {
											peg$currPos = s0;
											s0 = peg$FAILED;
										}
									} else {
										peg$currPos = s0;
										s0 = peg$FAILED;
									}
								} else {
									peg$currPos = s0;
									s0 = peg$FAILED;
								}
							} else {
								peg$currPos = s0;
								s0 = peg$FAILED;
							}
						} else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e33);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsebegin_display_math() {
			let s0, s1, s2;
			const key = peg$currPos * 53 + 24;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			s1 = peg$parseescape();
			if (s1 !== peg$FAILED) {
				if (input.charCodeAt(peg$currPos) === 91) {
					s2 = peg$c4;
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e12);
				}
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseend_display_math() {
			let s0, s1, s2;
			const key = peg$currPos * 53 + 25;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			s1 = peg$parseescape();
			if (s1 !== peg$FAILED) {
				if (input.charCodeAt(peg$currPos) === 93) {
					s2 = peg$c5;
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e13);
				}
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsebegin_inline_math() {
			let s0, s1, s2;
			const key = peg$currPos * 53 + 26;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			s1 = peg$parseescape();
			if (s1 !== peg$FAILED) {
				if (input.charCodeAt(peg$currPos) === 40) {
					s2 = peg$c16;
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e34);
				}
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseend_inline_math() {
			let s0, s1, s2;
			const key = peg$currPos * 53 + 27;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			s1 = peg$parseescape();
			if (s1 !== peg$FAILED) {
				if (input.charCodeAt(peg$currPos) === 41) {
					s2 = peg$c17;
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e35);
				}
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsebegin_env() {
			let s0, s1, s2;
			const key = peg$currPos * 53 + 28;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			s1 = peg$parseescape();
			if (s1 !== peg$FAILED) {
				if (input.substr(peg$currPos, 5) === peg$c18) {
					s2 = peg$c18;
					peg$currPos += 5;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e36);
				}
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseend_env() {
			let s0, s1, s2;
			const key = peg$currPos * 53 + 29;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			s1 = peg$parseescape();
			if (s1 !== peg$FAILED) {
				if (input.substr(peg$currPos, 3) === peg$c19) {
					s2 = peg$c19;
					peg$currPos += 3;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e37);
				}
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsemath_env_name() {
			let s0, s1;
			const key = peg$currPos * 53 + 30;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			if (input.substr(peg$currPos, 9) === peg$c20) {
				s1 = peg$c20;
				peg$currPos += 9;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e38);
			}
			if (s1 === peg$FAILED) {
				if (input.substr(peg$currPos, 8) === peg$c21) {
					s1 = peg$c21;
					peg$currPos += 8;
				} else {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e39);
				}
				if (s1 === peg$FAILED) {
					if (input.substr(peg$currPos, 6) === peg$c22) {
						s1 = peg$c22;
						peg$currPos += 6;
					} else {
						s1 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e40);
					}
					if (s1 === peg$FAILED) {
						if (input.substr(peg$currPos, 5) === peg$c23) {
							s1 = peg$c23;
							peg$currPos += 5;
						} else {
							s1 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e41);
						}
						if (s1 === peg$FAILED) {
							if (input.substr(peg$currPos, 8) === peg$c24) {
								s1 = peg$c24;
								peg$currPos += 8;
							} else {
								s1 = peg$FAILED;
								if (peg$silentFails === 0) peg$fail(peg$e42);
							}
							if (s1 === peg$FAILED) {
								if (input.substr(peg$currPos, 7) === peg$c25) {
									s1 = peg$c25;
									peg$currPos += 7;
								} else {
									s1 = peg$FAILED;
									if (peg$silentFails === 0) peg$fail(peg$e43);
								}
								if (s1 === peg$FAILED) {
									if (input.substr(peg$currPos, 7) === peg$c26) {
										s1 = peg$c26;
										peg$currPos += 7;
									} else {
										s1 = peg$FAILED;
										if (peg$silentFails === 0) peg$fail(peg$e44);
									}
									if (s1 === peg$FAILED) {
										if (input.substr(peg$currPos, 6) === peg$c27) {
											s1 = peg$c27;
											peg$currPos += 6;
										} else {
											s1 = peg$FAILED;
											if (peg$silentFails === 0) peg$fail(peg$e45);
										}
										if (s1 === peg$FAILED) {
											if (input.substr(peg$currPos, 9) === peg$c28) {
												s1 = peg$c28;
												peg$currPos += 9;
											} else {
												s1 = peg$FAILED;
												if (peg$silentFails === 0) peg$fail(peg$e46);
											}
											if (s1 === peg$FAILED) {
												if (input.substr(peg$currPos, 8) === peg$c29) {
													s1 = peg$c29;
													peg$currPos += 8;
												} else {
													s1 = peg$FAILED;
													if (peg$silentFails === 0) peg$fail(peg$e47);
												}
												if (s1 === peg$FAILED) {
													if (input.substr(peg$currPos, 8) === peg$c30) {
														s1 = peg$c30;
														peg$currPos += 8;
													} else {
														s1 = peg$FAILED;
														if (peg$silentFails === 0) peg$fail(peg$e48);
													}
													if (s1 === peg$FAILED) {
														if (input.substr(peg$currPos, 7) === peg$c31) {
															s1 = peg$c31;
															peg$currPos += 7;
														} else {
															s1 = peg$FAILED;
															if (peg$silentFails === 0) peg$fail(peg$e49);
														}
														if (s1 === peg$FAILED) {
															if (input.substr(peg$currPos, 5) === peg$c32) {
																s1 = peg$c32;
																peg$currPos += 5;
															} else {
																s1 = peg$FAILED;
																if (peg$silentFails === 0) peg$fail(peg$e50);
															}
															if (s1 === peg$FAILED) {
																if (input.substr(peg$currPos, 4) === peg$c33) {
																	s1 = peg$c33;
																	peg$currPos += 4;
																} else {
																	s1 = peg$FAILED;
																	if (peg$silentFails === 0) peg$fail(peg$e51);
																}
																if (s1 === peg$FAILED) if (input.substr(peg$currPos, 11) === peg$c34) {
																	s1 = peg$c34;
																	peg$currPos += 11;
																} else {
																	s1 = peg$FAILED;
																	if (peg$silentFails === 0) peg$fail(peg$e52);
																}
															}
														}
													}
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f57(s1);
			}
			s0 = s1;
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseescape() {
			let s0, s1;
			const key = peg$currPos * 53 + 31;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 92) {
				s1 = peg$c35;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e54);
			}
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f58();
			}
			s0 = s1;
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e53);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsebegin_group() {
			let s0, s1;
			const key = peg$currPos * 53 + 32;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 123) {
				s1 = peg$c36;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e55);
			}
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f59(s1);
			}
			s0 = s1;
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseend_group() {
			let s0, s1;
			const key = peg$currPos * 53 + 33;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 125) {
				s1 = peg$c37;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e56);
			}
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f60(s1);
			}
			s0 = s1;
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsemath_shift() {
			let s0, s1;
			const key = peg$currPos * 53 + 34;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 36) {
				s1 = peg$c38;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e57);
			}
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f61(s1);
			}
			s0 = s1;
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsealignment_tab() {
			let s0, s1;
			const key = peg$currPos * 53 + 35;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 38) {
				s1 = peg$c39;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e58);
			}
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f62(s1);
			}
			s0 = s1;
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsenl() {
			let s0, s1, s2;
			const key = peg$currPos * 53 + 36;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$currPos;
			peg$silentFails++;
			if (input.charCodeAt(peg$currPos) === 13) {
				s2 = peg$c40;
				peg$currPos++;
			} else {
				s2 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e60);
			}
			peg$silentFails--;
			if (s2 === peg$FAILED) s1 = void 0;
			else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 !== peg$FAILED) {
				if (input.charCodeAt(peg$currPos) === 10) {
					s2 = peg$c41;
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e61);
				}
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				if (input.charCodeAt(peg$currPos) === 13) {
					s0 = peg$c40;
					peg$currPos++;
				} else {
					s0 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e60);
				}
				if (s0 === peg$FAILED) if (input.substr(peg$currPos, 2) === peg$c42) {
					s0 = peg$c42;
					peg$currPos += 2;
				} else {
					s0 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e62);
				}
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e59);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsemacro_parameter() {
			let s0, s1;
			const key = peg$currPos * 53 + 37;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 35) {
				s1 = peg$c43;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e63);
			}
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f63(s1);
			}
			s0 = s1;
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsesuperscript() {
			let s0, s1;
			const key = peg$currPos * 53 + 38;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 94) {
				s1 = peg$c44;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e64);
			}
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f64(s1);
			}
			s0 = s1;
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsesubscript() {
			let s0, s1;
			const key = peg$currPos * 53 + 39;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 95) {
				s1 = peg$c45;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e65);
			}
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f65(s1);
			}
			s0 = s1;
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseignore() {
			let s0;
			const key = peg$currPos * 53 + 40;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			if (input.charCodeAt(peg$currPos) === 0) {
				s0 = peg$c46;
				peg$currPos++;
			} else {
				s0 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e66);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsesp() {
			let s0, s1, s2;
			const key = peg$currPos * 53 + 41;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = [];
			s2 = input.charAt(peg$currPos);
			if (peg$r1.test(s2)) peg$currPos++;
			else {
				s2 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e67);
			}
			if (s2 !== peg$FAILED) while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = input.charAt(peg$currPos);
				if (peg$r1.test(s2)) peg$currPos++;
				else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e67);
				}
			}
			else s1 = peg$FAILED;
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f66();
			}
			s0 = s1;
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e6);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsechar() {
			let s0;
			const key = peg$currPos * 53 + 42;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = input.charAt(peg$currPos);
			if (peg$r2.test(s0)) peg$currPos++;
			else {
				s0 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e69);
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				if (peg$silentFails === 0) peg$fail(peg$e68);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsenum() {
			let s0;
			const key = peg$currPos * 53 + 43;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = input.charAt(peg$currPos);
			if (peg$r3.test(s0)) peg$currPos++;
			else {
				s0 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e71);
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				if (peg$silentFails === 0) peg$fail(peg$e70);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsepunctuation() {
			let s0, s1;
			const key = peg$currPos * 53 + 44;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = input.charAt(peg$currPos);
			if (peg$r4.test(s1)) peg$currPos++;
			else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e73);
			}
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f67(s1);
			}
			s0 = s1;
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e72);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsecomment_start() {
			let s0;
			const key = peg$currPos * 53 + 45;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			if (input.charCodeAt(peg$currPos) === 37) {
				s0 = peg$c0;
				peg$currPos++;
			} else {
				s0 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e5);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsefull_comment() {
			let s0;
			const key = peg$currPos * 53 + 46;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$parseownline_comment();
			if (s0 === peg$FAILED) s0 = peg$parsesameline_comment();
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				if (peg$silentFails === 0) peg$fail(peg$e74);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseownline_comment() {
			let s0, s1, s2, s3;
			const key = peg$currPos * 53 + 47;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			s1 = peg$currPos;
			s2 = [];
			s3 = peg$parsesp();
			while (s3 !== peg$FAILED) {
				s2.push(s3);
				s3 = peg$parsesp();
			}
			s3 = peg$parsenl();
			if (s3 !== peg$FAILED) {
				s2 = [s2, s3];
				s1 = s2;
			} else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 === peg$FAILED) s1 = null;
			s2 = peg$parseleading_sp();
			if (s2 !== peg$FAILED) {
				s3 = peg$parsecomment();
				if (s3 !== peg$FAILED) {
					peg$savedPos = s0;
					s0 = peg$f68(s2, s3);
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsesameline_comment() {
			let s0, s1, s2;
			const key = peg$currPos * 53 + 48;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parsesp();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parsesp();
			}
			s2 = peg$parsecomment();
			if (s2 !== peg$FAILED) {
				peg$savedPos = s0;
				s0 = peg$f69(s1, s2);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsecomment() {
			let s0, s1, s2, s3, s4, s5, s6, s7;
			const key = peg$currPos * 53 + 49;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parsecomment_start();
			if (s1 !== peg$FAILED) {
				s2 = [];
				s3 = peg$currPos;
				s4 = peg$currPos;
				peg$silentFails++;
				s5 = peg$parsenl();
				peg$silentFails--;
				if (s5 === peg$FAILED) s4 = void 0;
				else {
					peg$currPos = s4;
					s4 = peg$FAILED;
				}
				if (s4 !== peg$FAILED) {
					if (input.length > peg$currPos) {
						s5 = input.charAt(peg$currPos);
						peg$currPos++;
					} else {
						s5 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e1);
					}
					if (s5 !== peg$FAILED) {
						peg$savedPos = s3;
						s3 = peg$f70(s5);
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				} else {
					peg$currPos = s3;
					s3 = peg$FAILED;
				}
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$currPos;
					s4 = peg$currPos;
					peg$silentFails++;
					s5 = peg$parsenl();
					peg$silentFails--;
					if (s5 === peg$FAILED) s4 = void 0;
					else {
						peg$currPos = s4;
						s4 = peg$FAILED;
					}
					if (s4 !== peg$FAILED) {
						if (input.length > peg$currPos) {
							s5 = input.charAt(peg$currPos);
							peg$currPos++;
						} else {
							s5 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e1);
						}
						if (s5 !== peg$FAILED) {
							peg$savedPos = s3;
							s3 = peg$f70(s5);
						} else {
							peg$currPos = s3;
							s3 = peg$FAILED;
						}
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				}
				s3 = peg$currPos;
				peg$silentFails++;
				s4 = peg$parseparbreak();
				peg$silentFails--;
				if (s4 !== peg$FAILED) {
					peg$currPos = s3;
					s3 = void 0;
				} else s3 = peg$FAILED;
				if (s3 !== peg$FAILED) {
					peg$savedPos = s0;
					s0 = peg$f71(s2);
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$parsecomment_start();
				if (s1 !== peg$FAILED) {
					s2 = [];
					s3 = peg$currPos;
					s4 = peg$currPos;
					peg$silentFails++;
					s5 = peg$parsenl();
					peg$silentFails--;
					if (s5 === peg$FAILED) s4 = void 0;
					else {
						peg$currPos = s4;
						s4 = peg$FAILED;
					}
					if (s4 !== peg$FAILED) {
						if (input.length > peg$currPos) {
							s5 = input.charAt(peg$currPos);
							peg$currPos++;
						} else {
							s5 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e1);
						}
						if (s5 !== peg$FAILED) {
							peg$savedPos = s3;
							s3 = peg$f72(s5);
						} else {
							peg$currPos = s3;
							s3 = peg$FAILED;
						}
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
					while (s3 !== peg$FAILED) {
						s2.push(s3);
						s3 = peg$currPos;
						s4 = peg$currPos;
						peg$silentFails++;
						s5 = peg$parsenl();
						peg$silentFails--;
						if (s5 === peg$FAILED) s4 = void 0;
						else {
							peg$currPos = s4;
							s4 = peg$FAILED;
						}
						if (s4 !== peg$FAILED) {
							if (input.length > peg$currPos) {
								s5 = input.charAt(peg$currPos);
								peg$currPos++;
							} else {
								s5 = peg$FAILED;
								if (peg$silentFails === 0) peg$fail(peg$e1);
							}
							if (s5 !== peg$FAILED) {
								peg$savedPos = s3;
								s3 = peg$f72(s5);
							} else {
								peg$currPos = s3;
								s3 = peg$FAILED;
							}
						} else {
							peg$currPos = s3;
							s3 = peg$FAILED;
						}
					}
					s3 = peg$currPos;
					s4 = peg$parsenl();
					if (s4 !== peg$FAILED) {
						s5 = [];
						s6 = peg$parsesp();
						while (s6 !== peg$FAILED) {
							s5.push(s6);
							s6 = peg$parsesp();
						}
						s6 = peg$currPos;
						peg$silentFails++;
						s7 = peg$parsecomment_start();
						peg$silentFails--;
						if (s7 === peg$FAILED) s6 = void 0;
						else {
							peg$currPos = s6;
							s6 = peg$FAILED;
						}
						if (s6 !== peg$FAILED) {
							s4 = [
								s4,
								s5,
								s6
							];
							s3 = s4;
						} else {
							peg$currPos = s3;
							s3 = peg$FAILED;
						}
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
					if (s3 === peg$FAILED) {
						s3 = peg$parsenl();
						if (s3 === peg$FAILED) s3 = peg$parseEOF();
					}
					if (s3 !== peg$FAILED) {
						peg$savedPos = s0;
						s0 = peg$f73(s2);
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e75);
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseleading_sp() {
			let s0, s1, s2, s3, s4;
			const key = peg$currPos * 53 + 50;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			s1 = peg$currPos;
			s2 = peg$parsestart_of_line();
			if (s2 !== peg$FAILED) {
				s3 = [];
				s4 = peg$parsesp();
				while (s4 !== peg$FAILED) {
					s3.push(s4);
					s4 = peg$parsesp();
				}
				s2 = [s2, s3];
				s1 = s2;
			} else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 !== peg$FAILED) s0 = input.substring(s0, peg$currPos);
			else s0 = s1;
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parsestart_of_line() {
			let s0;
			const key = peg$currPos * 53 + 51;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			peg$savedPos = peg$currPos;
			s0 = peg$f74();
			if (s0) s0 = void 0;
			else s0 = peg$FAILED;
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function peg$parseEOF() {
			let s0, s1;
			const key = peg$currPos * 53 + 52;
			const cached = peg$resultsCache[key];
			if (cached) {
				peg$currPos = cached.nextPos;
				return cached.result;
			}
			s0 = peg$currPos;
			peg$silentFails++;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			peg$silentFails--;
			if (s1 === peg$FAILED) s0 = void 0;
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$resultsCache[key] = {
				nextPos: peg$currPos,
				result: s0
			};
			return s0;
		}
		function toString(e) {
			if (typeof e === "string") return e;
			if (typeof e.content === "string") return e.content;
			if (e && e.type === "whitespace") return " ";
			return e;
		}
		function compare_env(g1, g2) {
			return (typeof g1 === "string" ? g1 : g1.content.map(toString).join("")) === (typeof g2 === "string" ? g2 : g2.content.map(toString).join(""));
		}
		function createNode(type, extra = {}) {
			return {
				type,
				...extra,
				position: location()
			};
		}
		peg$result = peg$startRuleFunction();
		const peg$success = peg$result !== peg$FAILED && peg$currPos === input.length;
		function peg$throw() {
			if (peg$result !== peg$FAILED && peg$currPos < input.length) peg$fail(peg$endExpectation());
			throw peg$buildStructuredError(peg$maxFailExpected, peg$maxFailPos < input.length ? peg$getUnicode(peg$maxFailPos) : null, peg$maxFailPos < input.length ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1) : peg$computeLocation(peg$maxFailPos, peg$maxFailPos));
		}
		if (options.peg$library) return (
		/** @type {any} */
		{
			peg$result,
			peg$currPos,
			peg$FAILED,
			peg$maxFailExpected,
			peg$maxFailPos,
			peg$success,
			peg$throw: peg$success ? void 0 : peg$throw
		});
		if (peg$success) return peg$result;
		else peg$throw();
	}
	return {
		StartRules: ["document", "math"],
		SyntaxError: peg$SyntaxError,
		parse: peg$parse
	};
})();
//#endregion
//#region grammars/align-environment.pegjs
var align_environment_default = (function() {
	"use strict";
	class peg$SyntaxError extends SyntaxError {
		constructor(message, expected, found, location) {
			super(message);
			this.expected = expected;
			this.found = found;
			this.location = location;
			this.name = "SyntaxError";
		}
		format(sources) {
			let str = "Error: " + this.message;
			if (this.location) {
				let src = null;
				const st = sources.find((s2) => s2.source === this.location.source);
				if (st) src = st.text.split(/\r\n|\n|\r/g);
				const s = this.location.start;
				const offset_s = this.location.source && typeof this.location.source.offset === "function" ? this.location.source.offset(s) : s;
				const loc = this.location.source + ":" + offset_s.line + ":" + offset_s.column;
				if (src) {
					const e = this.location.end;
					const filler = "".padEnd(offset_s.line.toString().length, " ");
					const line = src[s.line - 1];
					const hatLen = (s.line === e.line ? e.column : line.length + 1) - s.column || 1;
					str += "\n --> " + loc + "\n" + filler + " |\n" + offset_s.line + " | " + line + "\n" + filler + " | " + "".padEnd(s.column - 1, " ") + "".padEnd(hatLen, "^");
				} else str += "\n at " + loc;
			}
			return str;
		}
		static buildMessage(expected, found) {
			function hex(ch) {
				return ch.codePointAt(0).toString(16).toUpperCase();
			}
			const nonPrintable = Object.prototype.hasOwnProperty.call(RegExp.prototype, "unicode") ? /* @__PURE__ */ new RegExp("[\\p{C}\\p{Mn}\\p{Mc}]", "gu") : null;
			function unicodeEscape(s) {
				if (nonPrintable) return s.replace(nonPrintable, (ch) => "\\u{" + hex(ch) + "}");
				return s;
			}
			function literalEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			function classEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^").replace(/-/g, "\\-").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			const DESCRIBE_EXPECTATION_FNS = {
				literal(expectation) {
					return "\"" + literalEscape(expectation.text) + "\"";
				},
				class(expectation) {
					const escapedParts = expectation.parts.map((part) => Array.isArray(part) ? classEscape(part[0]) + "-" + classEscape(part[1]) : classEscape(part));
					return "[" + (expectation.inverted ? "^" : "") + escapedParts.join("") + "]" + (expectation.unicode ? "u" : "");
				},
				any() {
					return "any character";
				},
				end() {
					return "end of input";
				},
				other(expectation) {
					return expectation.description;
				}
			};
			function describeExpectation(expectation) {
				return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
			}
			function describeExpected(expected2) {
				const descriptions = expected2.map(describeExpectation);
				descriptions.sort();
				if (descriptions.length > 0) {
					let j = 1;
					for (let i = 1; i < descriptions.length; i++) if (descriptions[i - 1] !== descriptions[i]) {
						descriptions[j] = descriptions[i];
						j++;
					}
					descriptions.length = j;
				}
				switch (descriptions.length) {
					case 1: return descriptions[0];
					case 2: return descriptions[0] + " or " + descriptions[1];
					default: return descriptions.slice(0, -1).join(", ") + ", or " + descriptions[descriptions.length - 1];
				}
			}
			function describeFound(found2) {
				return found2 ? "\"" + literalEscape(found2) + "\"" : "end of input";
			}
			return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
		}
	}
	function peg$parse(input, options) {
		options = options !== void 0 ? options : {};
		const peg$FAILED = {};
		const peg$source = options.grammarSource;
		const peg$startRuleFunctions = { body: peg$parsebody };
		let peg$startRuleFunction = peg$parsebody;
		const peg$e0 = peg$anyExpectation();
		function peg$f0() {
			return [];
		}
		function peg$f1(x) {
			return {
				cells: [],
				colSeps: [],
				...x
			};
		}
		function peg$f2(rowItems, rowSep, trailingComment) {
			return {
				...rowItems,
				rowSep,
				trailingComment
			};
		}
		function peg$f3(rowItems, trailingComment) {
			return {
				...rowItems,
				rowSep: null,
				trailingComment
			};
		}
		function peg$f4(x) {
			return x;
		}
		function peg$f5(x) {
			return {
				cells: [],
				colSeps: [],
				rowSep: null,
				trailingComment: x
			};
		}
		function peg$f6(x) {
			return x;
		}
		function peg$f7(colSep, cell) {
			return {
				colSep,
				cell
			};
		}
		function peg$f8(colSep) {
			return { colSep };
		}
		function peg$f9(a, b) {
			return processRow(a, b);
		}
		function peg$f10(b) {
			return processRow(null, b);
		}
		function peg$f11(tok) {
			return options.isSameLineComment(tok);
		}
		function peg$f12(tok) {
			return tok;
		}
		function peg$f13(tok) {
			return options.isOwnLineComment(tok);
		}
		function peg$f14(tok) {
			return tok;
		}
		function peg$f15(tok) {
			return options.isWhitespace(tok);
		}
		function peg$f16(tok) {
			return tok;
		}
		function peg$f17(tok) {
			return options.isRowSep(tok);
		}
		function peg$f18(tok) {
			return tok;
		}
		function peg$f19(tok) {
			return options.isColSep(tok);
		}
		function peg$f20(tok) {
			return tok;
		}
		let peg$currPos = options.peg$currPos | 0;
		const peg$posDetailsCache = [{
			line: 1,
			column: 1
		}];
		let peg$maxFailPos = peg$currPos;
		let peg$maxFailExpected = options.peg$maxFailExpected || [];
		let peg$silentFails = options.peg$silentFails | 0;
		let peg$result;
		if (options.startRule) {
			if (!(options.startRule in peg$startRuleFunctions)) throw new Error(`Can't start parsing from rule "` + options.startRule + "\".");
			peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
		}
		function peg$getUnicode(pos = peg$currPos) {
			const cp = input.codePointAt(pos);
			if (cp === void 0) return "";
			return String.fromCodePoint(cp);
		}
		function peg$anyExpectation() {
			return { type: "any" };
		}
		function peg$endExpectation() {
			return { type: "end" };
		}
		function peg$computePosDetails(pos) {
			let details = peg$posDetailsCache[pos];
			let p;
			if (details) return details;
			else {
				if (pos >= peg$posDetailsCache.length) p = peg$posDetailsCache.length - 1;
				else {
					p = pos;
					while (!peg$posDetailsCache[--p]);
				}
				details = peg$posDetailsCache[p];
				details = {
					line: details.line,
					column: details.column
				};
				while (p < pos) {
					if (input.charCodeAt(p) === 10) {
						details.line++;
						details.column = 1;
					} else details.column++;
					p++;
				}
				peg$posDetailsCache[pos] = details;
				return details;
			}
		}
		function peg$computeLocation(startPos, endPos, offset2) {
			const startPosDetails = peg$computePosDetails(startPos);
			const endPosDetails = peg$computePosDetails(endPos);
			const res = {
				source: peg$source,
				start: {
					offset: startPos,
					line: startPosDetails.line,
					column: startPosDetails.column
				},
				end: {
					offset: endPos,
					line: endPosDetails.line,
					column: endPosDetails.column
				}
			};
			if (offset2 && peg$source && typeof peg$source.offset === "function") {
				res.start = peg$source.offset(res.start);
				res.end = peg$source.offset(res.end);
			}
			return res;
		}
		function peg$fail(expected2) {
			if (peg$currPos < peg$maxFailPos) return;
			if (peg$currPos > peg$maxFailPos) {
				peg$maxFailPos = peg$currPos;
				peg$maxFailExpected = [];
			}
			peg$maxFailExpected.push(expected2);
		}
		function peg$buildStructuredError(expected2, found, location2) {
			return new peg$SyntaxError(peg$SyntaxError.buildMessage(expected2, found), expected2, found, location2);
		}
		function peg$parsebody() {
			let s0, s1;
			s0 = [];
			s1 = peg$parsecomment_only_line();
			if (s1 === peg$FAILED) {
				s1 = peg$parserow_with_end();
				if (s1 === peg$FAILED) s1 = peg$parserow_without_end();
			}
			if (s1 !== peg$FAILED) while (s1 !== peg$FAILED) {
				s0.push(s1);
				s1 = peg$parsecomment_only_line();
				if (s1 === peg$FAILED) {
					s1 = peg$parserow_with_end();
					if (s1 === peg$FAILED) s1 = peg$parserow_without_end();
				}
			}
			else s0 = peg$FAILED;
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$parseEOL();
				if (s1 !== peg$FAILED) s1 = peg$f0();
				s0 = s1;
			}
			return s0;
		}
		function peg$parserow_with_end() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			s1 = peg$currPos;
			s2 = peg$parserow_items();
			if (s2 === peg$FAILED) s2 = null;
			s2 = peg$f1(s2);
			s1 = s2;
			s2 = peg$parserow_sep();
			if (s2 !== peg$FAILED) {
				s3 = peg$parsetrailing_comment();
				if (s3 === peg$FAILED) s3 = null;
				s0 = peg$f2(s1, s2, s3);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parserow_without_end() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = peg$parserow_items();
			if (s1 !== peg$FAILED) {
				s2 = peg$parsetrailing_comment();
				if (s2 === peg$FAILED) s2 = null;
				s0 = peg$f3(s1, s2);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsetrailing_comment() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parsewhitespace();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parsewhitespace();
			}
			s2 = peg$parsesame_line_comment();
			if (s2 !== peg$FAILED) s0 = peg$f4(s2);
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsecomment_only_line() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parsewhitespace();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parsewhitespace();
			}
			s2 = peg$parseown_line_comment();
			if (s2 !== peg$FAILED) s0 = peg$f5(s2);
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsetoken() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = peg$currPos;
			peg$silentFails++;
			s2 = peg$parserow_sep();
			if (s2 === peg$FAILED) {
				s2 = peg$parsecol_sep();
				if (s2 === peg$FAILED) {
					s2 = peg$parsetrailing_comment();
					if (s2 === peg$FAILED) s2 = peg$parseown_line_comment();
				}
			}
			peg$silentFails--;
			if (s2 === peg$FAILED) s1 = void 0;
			else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 !== peg$FAILED) {
				if (input.length > peg$currPos) {
					s2 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e0);
				}
				if (s2 !== peg$FAILED) s0 = peg$f6(s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsecell() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parsetoken();
			if (s2 !== peg$FAILED) while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parsetoken();
			}
			else s1 = peg$FAILED;
			if (s1 !== peg$FAILED) s0 = input.substring(s0, peg$currPos);
			else s0 = s1;
			return s0;
		}
		function peg$parseseparated_cell() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = peg$parsecol_sep();
			if (s1 !== peg$FAILED) {
				s2 = peg$parsecell();
				if (s2 !== peg$FAILED) s0 = peg$f7(s1, s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$parsecol_sep();
				if (s1 !== peg$FAILED) s1 = peg$f8(s1);
				s0 = s1;
			}
			return s0;
		}
		function peg$parserow_items() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			s1 = peg$parsecell();
			if (s1 !== peg$FAILED) {
				s2 = [];
				s3 = peg$parseseparated_cell();
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$parseseparated_cell();
				}
				s0 = peg$f9(s1, s2);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = [];
				s2 = peg$parseseparated_cell();
				if (s2 !== peg$FAILED) while (s2 !== peg$FAILED) {
					s1.push(s2);
					s2 = peg$parseseparated_cell();
				}
				else s1 = peg$FAILED;
				if (s1 !== peg$FAILED) s1 = peg$f10(s1);
				s0 = s1;
			}
			return s0;
		}
		function peg$parsesame_line_comment() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f11(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f12(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseown_line_comment() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f13(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f14(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsewhitespace() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f15(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f16(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parserow_sep() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f17(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f18(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsecol_sep() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f19(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f20(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseEOL() {
			let s0, s1;
			s0 = peg$currPos;
			peg$silentFails++;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			peg$silentFails--;
			if (s1 === peg$FAILED) s0 = void 0;
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function processRow(leadCell, otherCells) {
			const cells = [leadCell || []];
			const seps = [];
			for (const x of otherCells) {
				cells.push(x.cell || []);
				seps.push(x.colSep);
			}
			return {
				cells,
				colSeps: seps
			};
		}
		if (!options.isWhitespace) try {
			Object.assign(options, createMatchers([
				"\\",
				"hline",
				"cr"
			], ["&"]));
		} catch (e) {
			console.warn("Error when initializing parser", e);
		}
		peg$result = peg$startRuleFunction();
		const peg$success = peg$result !== peg$FAILED && peg$currPos === input.length;
		function peg$throw() {
			if (peg$result !== peg$FAILED && peg$currPos < input.length) peg$fail(peg$endExpectation());
			throw peg$buildStructuredError(peg$maxFailExpected, peg$maxFailPos < input.length ? peg$getUnicode(peg$maxFailPos) : null, peg$maxFailPos < input.length ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1) : peg$computeLocation(peg$maxFailPos, peg$maxFailPos));
		}
		if (options.peg$library) return (
		/** @type {any} */
		{
			peg$result,
			peg$currPos,
			peg$FAILED,
			peg$maxFailExpected,
			peg$maxFailPos,
			peg$success,
			peg$throw: peg$success ? void 0 : peg$throw
		});
		if (peg$success) return peg$result;
		else peg$throw();
	}
	return {
		StartRules: ["body"],
		SyntaxError: peg$SyntaxError,
		parse: peg$parse
	};
})();
//#endregion
//#region grammars/xparse-argspec.pegjs
var xparse_argspec_default = (function() {
	"use strict";
	class peg$SyntaxError extends SyntaxError {
		constructor(message, expected, found, location) {
			super(message);
			this.expected = expected;
			this.found = found;
			this.location = location;
			this.name = "SyntaxError";
		}
		format(sources) {
			let str = "Error: " + this.message;
			if (this.location) {
				let src = null;
				const st = sources.find((s2) => s2.source === this.location.source);
				if (st) src = st.text.split(/\r\n|\n|\r/g);
				const s = this.location.start;
				const offset_s = this.location.source && typeof this.location.source.offset === "function" ? this.location.source.offset(s) : s;
				const loc = this.location.source + ":" + offset_s.line + ":" + offset_s.column;
				if (src) {
					const e = this.location.end;
					const filler = "".padEnd(offset_s.line.toString().length, " ");
					const line = src[s.line - 1];
					const hatLen = (s.line === e.line ? e.column : line.length + 1) - s.column || 1;
					str += "\n --> " + loc + "\n" + filler + " |\n" + offset_s.line + " | " + line + "\n" + filler + " | " + "".padEnd(s.column - 1, " ") + "".padEnd(hatLen, "^");
				} else str += "\n at " + loc;
			}
			return str;
		}
		static buildMessage(expected, found) {
			function hex(ch) {
				return ch.codePointAt(0).toString(16).toUpperCase();
			}
			const nonPrintable = Object.prototype.hasOwnProperty.call(RegExp.prototype, "unicode") ? /* @__PURE__ */ new RegExp("[\\p{C}\\p{Mn}\\p{Mc}]", "gu") : null;
			function unicodeEscape(s) {
				if (nonPrintable) return s.replace(nonPrintable, (ch) => "\\u{" + hex(ch) + "}");
				return s;
			}
			function literalEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			function classEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^").replace(/-/g, "\\-").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			const DESCRIBE_EXPECTATION_FNS = {
				literal(expectation) {
					return "\"" + literalEscape(expectation.text) + "\"";
				},
				class(expectation) {
					const escapedParts = expectation.parts.map((part) => Array.isArray(part) ? classEscape(part[0]) + "-" + classEscape(part[1]) : classEscape(part));
					return "[" + (expectation.inverted ? "^" : "") + escapedParts.join("") + "]" + (expectation.unicode ? "u" : "");
				},
				any() {
					return "any character";
				},
				end() {
					return "end of input";
				},
				other(expectation) {
					return expectation.description;
				}
			};
			function describeExpectation(expectation) {
				return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
			}
			function describeExpected(expected2) {
				const descriptions = expected2.map(describeExpectation);
				descriptions.sort();
				if (descriptions.length > 0) {
					let j = 1;
					for (let i = 1; i < descriptions.length; i++) if (descriptions[i - 1] !== descriptions[i]) {
						descriptions[j] = descriptions[i];
						j++;
					}
					descriptions.length = j;
				}
				switch (descriptions.length) {
					case 1: return descriptions[0];
					case 2: return descriptions[0] + " or " + descriptions[1];
					default: return descriptions.slice(0, -1).join(", ") + ", or " + descriptions[descriptions.length - 1];
				}
			}
			function describeFound(found2) {
				return found2 ? "\"" + literalEscape(found2) + "\"" : "end of input";
			}
			return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
		}
	}
	function peg$parse(input, options) {
		options = options !== void 0 ? options : {};
		const peg$FAILED = {};
		const peg$source = options.grammarSource;
		const peg$startRuleFunctions = { args_spec_list: peg$parseargs_spec_list };
		let peg$startRuleFunction = peg$parseargs_spec_list;
		const peg$c0 = "+";
		const peg$c1 = "v";
		const peg$c2 = "b";
		const peg$c3 = "!";
		const peg$c4 = "D";
		const peg$c5 = "d";
		const peg$c6 = "s";
		const peg$c7 = "O";
		const peg$c8 = "o";
		const peg$c9 = "e";
		const peg$c10 = "E";
		const peg$c11 = "t";
		const peg$c12 = "R";
		const peg$c13 = "r";
		const peg$c14 = "u";
		const peg$c15 = "m";
		const peg$c16 = "{";
		const peg$c17 = "}";
		const peg$c18 = "\\";
		const peg$r0 = /^[{ ]/;
		const peg$r1 = /^[\n\r ]/;
		const peg$r2 = /^[a-zA-Z]/;
		const peg$r3 = /^[{}]/;
		const peg$e0 = peg$literalExpectation("+", false);
		const peg$e1 = peg$literalExpectation("v", false);
		const peg$e2 = peg$anyExpectation();
		const peg$e3 = peg$literalExpectation("b", false);
		const peg$e4 = peg$literalExpectation("!", false);
		const peg$e5 = peg$literalExpectation("D", false);
		const peg$e6 = peg$literalExpectation("d", false);
		const peg$e7 = peg$literalExpectation("s", false);
		const peg$e8 = peg$literalExpectation("O", false);
		const peg$e9 = peg$literalExpectation("o", false);
		const peg$e10 = peg$literalExpectation("e", false);
		const peg$e11 = peg$literalExpectation("E", false);
		const peg$e12 = peg$literalExpectation("t", false);
		const peg$e13 = peg$literalExpectation("R", false);
		const peg$e14 = peg$literalExpectation("r", false);
		const peg$e15 = peg$literalExpectation("u", false);
		const peg$e16 = peg$classExpectation(["{", " "], false, false, false);
		const peg$e17 = peg$literalExpectation("m", false);
		const peg$e18 = peg$literalExpectation("{", false);
		const peg$e19 = peg$literalExpectation("}", false);
		const peg$e20 = peg$classExpectation([
			"\n",
			"\r",
			" "
		], false, false, false);
		const peg$e21 = peg$literalExpectation("\\", false);
		const peg$e22 = peg$classExpectation([["a", "z"], ["A", "Z"]], false, false, false);
		const peg$e23 = peg$classExpectation(["{", "}"], false, false, false);
		function peg$f0(x) {
			return x;
		}
		function peg$f1(spec) {
			return spec;
		}
		function peg$f2(spec) {
			return spec;
		}
		function peg$f3(openBrace) {
			return createNode("verbatim", {
				openBrace,
				closeBrace: openBrace
			});
		}
		function peg$f4() {
			return createNode("body");
		}
		function peg$f5(leading_bang, spec) {
			return leading_bang ? {
				...spec,
				noLeadingWhitespace: true
			} : spec;
		}
		function peg$f6(braceSpec, defaultArg) {
			return createNode("optional", {
				...braceSpec,
				defaultArg
			});
		}
		function peg$f7(braceSpec) {
			return createNode("optional", braceSpec);
		}
		function peg$f8() {
			return createNode("optionalStar");
		}
		function peg$f9(g) {
			return createNode("optional", { defaultArg: g });
		}
		function peg$f10() {
			return createNode("optional");
		}
		function peg$f11(args) {
			return createNode("embellishment", { embellishmentTokens: args });
		}
		function peg$f12(args, g) {
			return createNode("embellishment", {
				embellishmentTokens: args,
				defaultArg: g
			});
		}
		function peg$f13(tok) {
			return createNode("optionalToken", { token: tok });
		}
		function peg$f14(braceSpec, defaultArg) {
			return createNode("mandatory", {
				...braceSpec,
				defaultArg
			});
		}
		function peg$f15(braceSpec) {
			return createNode("mandatory", braceSpec);
		}
		function peg$f16(stopTokens) {
			return createNode("until", { stopTokens });
		}
		function peg$f17(x) {
			return [x];
		}
		function peg$f18(g) {
			return g.content;
		}
		function peg$f19() {
			return createNode("mandatory");
		}
		function peg$f20(openBrace, closeBrace) {
			return {
				openBrace,
				closeBrace
			};
		}
		function peg$f21(g) {
			return g.content.map(groupToStr).join("");
		}
		function peg$f22(t) {
			return [t];
		}
		function peg$f23(args) {
			return args.filter((a) => !a.match(/^\s*$/));
		}
		function peg$f24(content) {
			return {
				type: "group",
				content
			};
		}
		function peg$f25() {
			return "";
		}
		let peg$currPos = options.peg$currPos | 0;
		const peg$posDetailsCache = [{
			line: 1,
			column: 1
		}];
		let peg$maxFailPos = peg$currPos;
		let peg$maxFailExpected = options.peg$maxFailExpected || [];
		let peg$silentFails = options.peg$silentFails | 0;
		let peg$result;
		if (options.startRule) {
			if (!(options.startRule in peg$startRuleFunctions)) throw new Error(`Can't start parsing from rule "` + options.startRule + "\".");
			peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
		}
		function peg$getUnicode(pos = peg$currPos) {
			const cp = input.codePointAt(pos);
			if (cp === void 0) return "";
			return String.fromCodePoint(cp);
		}
		function peg$literalExpectation(text2, ignoreCase) {
			return {
				type: "literal",
				text: text2,
				ignoreCase
			};
		}
		function peg$classExpectation(parts, inverted, ignoreCase, unicode) {
			return {
				type: "class",
				parts,
				inverted,
				ignoreCase,
				unicode
			};
		}
		function peg$anyExpectation() {
			return { type: "any" };
		}
		function peg$endExpectation() {
			return { type: "end" };
		}
		function peg$computePosDetails(pos) {
			let details = peg$posDetailsCache[pos];
			let p;
			if (details) return details;
			else {
				if (pos >= peg$posDetailsCache.length) p = peg$posDetailsCache.length - 1;
				else {
					p = pos;
					while (!peg$posDetailsCache[--p]);
				}
				details = peg$posDetailsCache[p];
				details = {
					line: details.line,
					column: details.column
				};
				while (p < pos) {
					if (input.charCodeAt(p) === 10) {
						details.line++;
						details.column = 1;
					} else details.column++;
					p++;
				}
				peg$posDetailsCache[pos] = details;
				return details;
			}
		}
		function peg$computeLocation(startPos, endPos, offset2) {
			const startPosDetails = peg$computePosDetails(startPos);
			const endPosDetails = peg$computePosDetails(endPos);
			const res = {
				source: peg$source,
				start: {
					offset: startPos,
					line: startPosDetails.line,
					column: startPosDetails.column
				},
				end: {
					offset: endPos,
					line: endPosDetails.line,
					column: endPosDetails.column
				}
			};
			if (offset2 && peg$source && typeof peg$source.offset === "function") {
				res.start = peg$source.offset(res.start);
				res.end = peg$source.offset(res.end);
			}
			return res;
		}
		function peg$fail(expected2) {
			if (peg$currPos < peg$maxFailPos) return;
			if (peg$currPos > peg$maxFailPos) {
				peg$maxFailPos = peg$currPos;
				peg$maxFailExpected = [];
			}
			peg$maxFailExpected.push(expected2);
		}
		function peg$buildStructuredError(expected2, found, location2) {
			return new peg$SyntaxError(peg$SyntaxError.buildMessage(expected2, found), expected2, found, location2);
		}
		function peg$parseargs_spec_list() {
			let s0, s1, s2, s4;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$currPos;
			peg$parsewhitespace();
			s4 = peg$parsearg_spec();
			if (s4 !== peg$FAILED) s2 = peg$f0(s4);
			else {
				peg$currPos = s2;
				s2 = peg$FAILED;
			}
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$currPos;
				peg$parsewhitespace();
				s4 = peg$parsearg_spec();
				if (s4 !== peg$FAILED) s2 = peg$f0(s4);
				else {
					peg$currPos = s2;
					s2 = peg$FAILED;
				}
			}
			s2 = peg$parsewhitespace();
			s0 = peg$f1(s1);
			return s0;
		}
		function peg$parsearg_spec() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 43) {
				s1 = peg$c0;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 === peg$FAILED) s1 = null;
			s2 = peg$parseoptional();
			if (s2 === peg$FAILED) {
				s2 = peg$parsemandatory();
				if (s2 === peg$FAILED) {
					s2 = peg$parseverbatim();
					if (s2 === peg$FAILED) {
						s2 = peg$parserequired();
						if (s2 === peg$FAILED) {
							s2 = peg$parsebody();
							if (s2 === peg$FAILED) s2 = peg$parseuntil();
						}
					}
				}
			}
			if (s2 !== peg$FAILED) s0 = peg$f2(s2);
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseverbatim() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 118) {
				s1 = peg$c1;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			if (s1 !== peg$FAILED) {
				if (input.length > peg$currPos) {
					s2 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e2);
				}
				if (s2 !== peg$FAILED) s0 = peg$f3(s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsebody() {
			let s0, s1;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 98) {
				s1 = peg$c2;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) s1 = peg$f4();
			s0 = s1;
			return s0;
		}
		function peg$parseoptional() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 33) {
				s1 = peg$c3;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e4);
			}
			if (s1 === peg$FAILED) s1 = null;
			s2 = peg$parseoptional_star();
			if (s2 === peg$FAILED) {
				s2 = peg$parseoptional_standard();
				if (s2 === peg$FAILED) {
					s2 = peg$parseoptional_delimited();
					if (s2 === peg$FAILED) {
						s2 = peg$parseoptional_embellishment();
						if (s2 === peg$FAILED) s2 = peg$parseoptional_token();
					}
				}
			}
			if (s2 !== peg$FAILED) s0 = peg$f5(s1, s2);
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseoptional_delimited() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 68) {
				s1 = peg$c4;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e5);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$parsebrace_spec();
				s3 = peg$parsearg();
				if (s3 !== peg$FAILED) s0 = peg$f6(s2, s3);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				if (input.charCodeAt(peg$currPos) === 100) {
					s1 = peg$c5;
					peg$currPos++;
				} else {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e6);
				}
				if (s1 !== peg$FAILED) {
					s2 = peg$parsebrace_spec();
					s0 = peg$f7(s2);
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			}
			return s0;
		}
		function peg$parseoptional_star() {
			let s0, s1;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 115) {
				s1 = peg$c6;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e7);
			}
			if (s1 !== peg$FAILED) s1 = peg$f8();
			s0 = s1;
			return s0;
		}
		function peg$parseoptional_standard() {
			let s0, s1, s3;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 79) {
				s1 = peg$c7;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e8);
			}
			if (s1 !== peg$FAILED) {
				peg$parsewhitespace();
				s3 = peg$parsearg();
				if (s3 !== peg$FAILED) s0 = peg$f9(s3);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				if (input.charCodeAt(peg$currPos) === 111) {
					s1 = peg$c8;
					peg$currPos++;
				} else {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e9);
				}
				if (s1 !== peg$FAILED) s1 = peg$f10();
				s0 = s1;
			}
			return s0;
		}
		function peg$parseoptional_embellishment() {
			let s0, s1, s3, s5;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 101) {
				s1 = peg$c9;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e10);
			}
			if (s1 !== peg$FAILED) {
				peg$parsewhitespace();
				s3 = peg$parseargs();
				if (s3 !== peg$FAILED) s0 = peg$f11(s3);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				if (input.charCodeAt(peg$currPos) === 69) {
					s1 = peg$c10;
					peg$currPos++;
				} else {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e11);
				}
				if (s1 !== peg$FAILED) {
					peg$parsewhitespace();
					s3 = peg$parseargs();
					if (s3 !== peg$FAILED) {
						peg$parsewhitespace();
						s5 = peg$parseargs();
						if (s5 !== peg$FAILED) s0 = peg$f12(s3, s5);
						else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			}
			return s0;
		}
		function peg$parseoptional_token() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 116) {
				s1 = peg$c11;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e12);
			}
			if (s1 !== peg$FAILED) {
				if (input.length > peg$currPos) {
					s2 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e2);
				}
				if (s2 !== peg$FAILED) s0 = peg$f13(s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parserequired() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 82) {
				s1 = peg$c12;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e13);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$parsebrace_spec();
				s3 = peg$parsearg();
				if (s3 !== peg$FAILED) s0 = peg$f14(s2, s3);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				if (input.charCodeAt(peg$currPos) === 114) {
					s1 = peg$c13;
					peg$currPos++;
				} else {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e14);
				}
				if (s1 !== peg$FAILED) {
					s2 = peg$parsebrace_spec();
					s0 = peg$f15(s2);
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			}
			return s0;
		}
		function peg$parseuntil() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 117) {
				s1 = peg$c14;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e15);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$parseuntil_stop_token();
				if (s2 !== peg$FAILED) s0 = peg$f16(s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseuntil_stop_token() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = peg$currPos;
			peg$silentFails++;
			s2 = input.charAt(peg$currPos);
			if (peg$r0.test(s2)) peg$currPos++;
			else {
				s2 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e16);
			}
			peg$silentFails--;
			if (s2 === peg$FAILED) s1 = void 0;
			else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 !== peg$FAILED) {
				if (input.length > peg$currPos) {
					s2 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e2);
				}
				if (s2 !== peg$FAILED) s0 = peg$f17(s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$parsebraced_group();
				if (s1 !== peg$FAILED) s1 = peg$f18(s1);
				s0 = s1;
			}
			return s0;
		}
		function peg$parsemandatory() {
			let s0, s1;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 109) {
				s1 = peg$c15;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e17);
			}
			if (s1 !== peg$FAILED) s1 = peg$f19();
			s0 = s1;
			return s0;
		}
		function peg$parsebrace_spec() {
			let s0, s1, s2, s3, s4, s5;
			s0 = peg$currPos;
			s1 = peg$currPos;
			s2 = peg$currPos;
			s3 = peg$currPos;
			peg$silentFails++;
			s4 = peg$parsewhitespace_token();
			peg$silentFails--;
			if (s4 === peg$FAILED) s3 = void 0;
			else {
				peg$currPos = s3;
				s3 = peg$FAILED;
			}
			if (s3 !== peg$FAILED) {
				s4 = peg$parsemacro();
				if (s4 === peg$FAILED) if (input.length > peg$currPos) {
					s4 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s4 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e2);
				}
				if (s4 !== peg$FAILED) {
					s3 = [s3, s4];
					s2 = s3;
				} else {
					peg$currPos = s2;
					s2 = peg$FAILED;
				}
			} else {
				peg$currPos = s2;
				s2 = peg$FAILED;
			}
			if (s2 === peg$FAILED) s2 = null;
			s1 = input.substring(s1, peg$currPos);
			s2 = peg$currPos;
			s3 = peg$currPos;
			s4 = peg$currPos;
			peg$silentFails++;
			s5 = peg$parsewhitespace_token();
			peg$silentFails--;
			if (s5 === peg$FAILED) s4 = void 0;
			else {
				peg$currPos = s4;
				s4 = peg$FAILED;
			}
			if (s4 !== peg$FAILED) {
				s5 = peg$parsemacro();
				if (s5 === peg$FAILED) if (input.length > peg$currPos) {
					s5 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s5 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e2);
				}
				if (s5 !== peg$FAILED) {
					s4 = [s4, s5];
					s3 = s4;
				} else {
					peg$currPos = s3;
					s3 = peg$FAILED;
				}
			} else {
				peg$currPos = s3;
				s3 = peg$FAILED;
			}
			if (s3 === peg$FAILED) s3 = null;
			s2 = input.substring(s2, peg$currPos);
			s0 = peg$f20(s1, s2);
			return s0;
		}
		function peg$parsearg() {
			let s0, s1;
			s0 = peg$parsetoken();
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$parsebraced_group();
				if (s1 !== peg$FAILED) s1 = peg$f21(s1);
				s0 = s1;
			}
			return s0;
		}
		function peg$parseargs() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			s1 = peg$parsetoken();
			if (s1 !== peg$FAILED) s1 = peg$f22(s1);
			s0 = s1;
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				if (input.charCodeAt(peg$currPos) === 123) {
					s1 = peg$c16;
					peg$currPos++;
				} else {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e18);
				}
				if (s1 !== peg$FAILED) {
					s2 = [];
					s3 = peg$parsearg();
					if (s3 === peg$FAILED) s3 = peg$parsewhitespace_token();
					while (s3 !== peg$FAILED) {
						s2.push(s3);
						s3 = peg$parsearg();
						if (s3 === peg$FAILED) s3 = peg$parsewhitespace_token();
					}
					if (input.charCodeAt(peg$currPos) === 125) {
						s3 = peg$c17;
						peg$currPos++;
					} else {
						s3 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e19);
					}
					if (s3 !== peg$FAILED) s0 = peg$f23(s2);
					else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			}
			return s0;
		}
		function peg$parsebraced_group() {
			let s0, s1, s2, s3, s4, s5, s6, s7;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 123) {
				s1 = peg$c16;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e18);
			}
			if (s1 !== peg$FAILED) {
				s2 = [];
				s3 = peg$currPos;
				s4 = peg$currPos;
				s5 = peg$currPos;
				peg$silentFails++;
				if (input.charCodeAt(peg$currPos) === 125) {
					s6 = peg$c17;
					peg$currPos++;
				} else {
					s6 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e19);
				}
				peg$silentFails--;
				if (s6 === peg$FAILED) s5 = void 0;
				else {
					peg$currPos = s5;
					s5 = peg$FAILED;
				}
				if (s5 !== peg$FAILED) {
					s6 = peg$currPos;
					peg$silentFails++;
					s7 = peg$parsebraced_group();
					peg$silentFails--;
					if (s7 === peg$FAILED) s6 = void 0;
					else {
						peg$currPos = s6;
						s6 = peg$FAILED;
					}
					if (s6 !== peg$FAILED) {
						s7 = peg$parsetoken();
						if (s7 === peg$FAILED) s7 = peg$parsewhitespace_token();
						if (s7 !== peg$FAILED) {
							s5 = [
								s5,
								s6,
								s7
							];
							s4 = s5;
						} else {
							peg$currPos = s4;
							s4 = peg$FAILED;
						}
					} else {
						peg$currPos = s4;
						s4 = peg$FAILED;
					}
				} else {
					peg$currPos = s4;
					s4 = peg$FAILED;
				}
				if (s4 !== peg$FAILED) s3 = input.substring(s3, peg$currPos);
				else s3 = s4;
				if (s3 === peg$FAILED) s3 = peg$parsebraced_group();
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$currPos;
					s4 = peg$currPos;
					s5 = peg$currPos;
					peg$silentFails++;
					if (input.charCodeAt(peg$currPos) === 125) {
						s6 = peg$c17;
						peg$currPos++;
					} else {
						s6 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e19);
					}
					peg$silentFails--;
					if (s6 === peg$FAILED) s5 = void 0;
					else {
						peg$currPos = s5;
						s5 = peg$FAILED;
					}
					if (s5 !== peg$FAILED) {
						s6 = peg$currPos;
						peg$silentFails++;
						s7 = peg$parsebraced_group();
						peg$silentFails--;
						if (s7 === peg$FAILED) s6 = void 0;
						else {
							peg$currPos = s6;
							s6 = peg$FAILED;
						}
						if (s6 !== peg$FAILED) {
							s7 = peg$parsetoken();
							if (s7 === peg$FAILED) s7 = peg$parsewhitespace_token();
							if (s7 !== peg$FAILED) {
								s5 = [
									s5,
									s6,
									s7
								];
								s4 = s5;
							} else {
								peg$currPos = s4;
								s4 = peg$FAILED;
							}
						} else {
							peg$currPos = s4;
							s4 = peg$FAILED;
						}
					} else {
						peg$currPos = s4;
						s4 = peg$FAILED;
					}
					if (s4 !== peg$FAILED) s3 = input.substring(s3, peg$currPos);
					else s3 = s4;
					if (s3 === peg$FAILED) s3 = peg$parsebraced_group();
				}
				if (input.charCodeAt(peg$currPos) === 125) {
					s3 = peg$c17;
					peg$currPos++;
				} else {
					s3 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e19);
				}
				if (s3 !== peg$FAILED) s0 = peg$f24(s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsewhitespace() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parsewhitespace_token();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parsewhitespace_token();
			}
			s1 = peg$f25();
			s0 = s1;
			return s0;
		}
		function peg$parsewhitespace_token() {
			let s0;
			s0 = input.charAt(peg$currPos);
			if (peg$r1.test(s0)) peg$currPos++;
			else {
				s0 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e20);
			}
			return s0;
		}
		function peg$parsemacro() {
			let s0, s1, s2, s3, s4;
			s0 = peg$currPos;
			s1 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 92) {
				s2 = peg$c18;
				peg$currPos++;
			} else {
				s2 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e21);
			}
			if (s2 !== peg$FAILED) {
				s3 = [];
				s4 = input.charAt(peg$currPos);
				if (peg$r2.test(s4)) peg$currPos++;
				else {
					s4 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e22);
				}
				if (s4 !== peg$FAILED) while (s4 !== peg$FAILED) {
					s3.push(s4);
					s4 = input.charAt(peg$currPos);
					if (peg$r2.test(s4)) peg$currPos++;
					else {
						s4 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e22);
					}
				}
				else s3 = peg$FAILED;
				if (s3 !== peg$FAILED) {
					s2 = [s2, s3];
					s1 = s2;
				} else {
					peg$currPos = s1;
					s1 = peg$FAILED;
				}
			} else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 !== peg$FAILED) s0 = input.substring(s0, peg$currPos);
			else s0 = s1;
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$currPos;
				if (input.charCodeAt(peg$currPos) === 92) {
					s2 = peg$c18;
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e21);
				}
				if (s2 !== peg$FAILED) {
					s3 = peg$currPos;
					peg$silentFails++;
					s4 = input.charAt(peg$currPos);
					if (peg$r2.test(s4)) peg$currPos++;
					else {
						s4 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e22);
					}
					peg$silentFails--;
					if (s4 === peg$FAILED) s3 = void 0;
					else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
					if (s3 !== peg$FAILED) {
						if (input.length > peg$currPos) {
							s4 = input.charAt(peg$currPos);
							peg$currPos++;
						} else {
							s4 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e2);
						}
						if (s4 !== peg$FAILED) {
							s2 = [
								s2,
								s3,
								s4
							];
							s1 = s2;
						} else {
							peg$currPos = s1;
							s1 = peg$FAILED;
						}
					} else {
						peg$currPos = s1;
						s1 = peg$FAILED;
					}
				} else {
					peg$currPos = s1;
					s1 = peg$FAILED;
				}
				if (s1 !== peg$FAILED) s0 = input.substring(s0, peg$currPos);
				else s0 = s1;
			}
			return s0;
		}
		function peg$parsetoken() {
			let s0, s1, s2, s3;
			s0 = peg$parsemacro();
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$currPos;
				peg$silentFails++;
				s2 = input.charAt(peg$currPos);
				if (peg$r3.test(s2)) peg$currPos++;
				else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e23);
				}
				peg$silentFails--;
				if (s2 === peg$FAILED) s1 = void 0;
				else {
					peg$currPos = s1;
					s1 = peg$FAILED;
				}
				if (s1 !== peg$FAILED) {
					s2 = peg$currPos;
					peg$silentFails++;
					s3 = peg$parsewhitespace_token();
					peg$silentFails--;
					if (s3 === peg$FAILED) s2 = void 0;
					else {
						peg$currPos = s2;
						s2 = peg$FAILED;
					}
					if (s2 !== peg$FAILED) {
						if (input.length > peg$currPos) {
							s3 = input.charAt(peg$currPos);
							peg$currPos++;
						} else {
							s3 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e2);
						}
						if (s3 !== peg$FAILED) s0 = s3;
						else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			}
			return s0;
		}
		const DEFAULT_OPTIONS = {
			optional: {
				openBrace: "[",
				closeBrace: "]"
			},
			mandatory: {
				openBrace: "{",
				closeBrace: "}"
			}
		};
		function createNode(type, options2) {
			return {
				type,
				...DEFAULT_OPTIONS[type] || {},
				...options2
			};
		}
		function groupToStr(node) {
			if (typeof node !== "object" || !node) return node;
			if (node.type === "group") return `{${node.content.map(groupToStr).join("")}}`;
			return node;
		}
		peg$result = peg$startRuleFunction();
		const peg$success = peg$result !== peg$FAILED && peg$currPos === input.length;
		function peg$throw() {
			if (peg$result !== peg$FAILED && peg$currPos < input.length) peg$fail(peg$endExpectation());
			throw peg$buildStructuredError(peg$maxFailExpected, peg$maxFailPos < input.length ? peg$getUnicode(peg$maxFailPos) : null, peg$maxFailPos < input.length ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1) : peg$computeLocation(peg$maxFailPos, peg$maxFailPos));
		}
		if (options.peg$library) return (
		/** @type {any} */
		{
			peg$result,
			peg$currPos,
			peg$FAILED,
			peg$maxFailExpected,
			peg$maxFailPos,
			peg$success,
			peg$throw: peg$success ? void 0 : peg$throw
		});
		if (peg$success) return peg$result;
		else peg$throw();
	}
	return {
		StartRules: ["args_spec_list"],
		SyntaxError: peg$SyntaxError,
		parse: peg$parse
	};
})();
//#endregion
//#region grammars/pgfkeys.pegjs
var pgfkeys_default = (function() {
	"use strict";
	class peg$SyntaxError extends SyntaxError {
		constructor(message, expected, found, location) {
			super(message);
			this.expected = expected;
			this.found = found;
			this.location = location;
			this.name = "SyntaxError";
		}
		format(sources) {
			let str = "Error: " + this.message;
			if (this.location) {
				let src = null;
				const st = sources.find((s2) => s2.source === this.location.source);
				if (st) src = st.text.split(/\r\n|\n|\r/g);
				const s = this.location.start;
				const offset_s = this.location.source && typeof this.location.source.offset === "function" ? this.location.source.offset(s) : s;
				const loc = this.location.source + ":" + offset_s.line + ":" + offset_s.column;
				if (src) {
					const e = this.location.end;
					const filler = "".padEnd(offset_s.line.toString().length, " ");
					const line = src[s.line - 1];
					const hatLen = (s.line === e.line ? e.column : line.length + 1) - s.column || 1;
					str += "\n --> " + loc + "\n" + filler + " |\n" + offset_s.line + " | " + line + "\n" + filler + " | " + "".padEnd(s.column - 1, " ") + "".padEnd(hatLen, "^");
				} else str += "\n at " + loc;
			}
			return str;
		}
		static buildMessage(expected, found) {
			function hex(ch) {
				return ch.codePointAt(0).toString(16).toUpperCase();
			}
			const nonPrintable = Object.prototype.hasOwnProperty.call(RegExp.prototype, "unicode") ? /* @__PURE__ */ new RegExp("[\\p{C}\\p{Mn}\\p{Mc}]", "gu") : null;
			function unicodeEscape(s) {
				if (nonPrintable) return s.replace(nonPrintable, (ch) => "\\u{" + hex(ch) + "}");
				return s;
			}
			function literalEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			function classEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^").replace(/-/g, "\\-").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			const DESCRIBE_EXPECTATION_FNS = {
				literal(expectation) {
					return "\"" + literalEscape(expectation.text) + "\"";
				},
				class(expectation) {
					const escapedParts = expectation.parts.map((part) => Array.isArray(part) ? classEscape(part[0]) + "-" + classEscape(part[1]) : classEscape(part));
					return "[" + (expectation.inverted ? "^" : "") + escapedParts.join("") + "]" + (expectation.unicode ? "u" : "");
				},
				any() {
					return "any character";
				},
				end() {
					return "end of input";
				},
				other(expectation) {
					return expectation.description;
				}
			};
			function describeExpectation(expectation) {
				return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
			}
			function describeExpected(expected2) {
				const descriptions = expected2.map(describeExpectation);
				descriptions.sort();
				if (descriptions.length > 0) {
					let j = 1;
					for (let i = 1; i < descriptions.length; i++) if (descriptions[i - 1] !== descriptions[i]) {
						descriptions[j] = descriptions[i];
						j++;
					}
					descriptions.length = j;
				}
				switch (descriptions.length) {
					case 1: return descriptions[0];
					case 2: return descriptions[0] + " or " + descriptions[1];
					default: return descriptions.slice(0, -1).join(", ") + ", or " + descriptions[descriptions.length - 1];
				}
			}
			function describeFound(found2) {
				return found2 ? "\"" + literalEscape(found2) + "\"" : "end of input";
			}
			return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
		}
	}
	function peg$parse(input, options) {
		options = options !== void 0 ? options : {};
		const peg$FAILED = {};
		const peg$source = options.grammarSource;
		const peg$startRuleFunctions = { body: peg$parsebody };
		let peg$startRuleFunction = peg$parsebody;
		const peg$e0 = peg$anyExpectation();
		function peg$f0() {
			return [];
		}
		function peg$f1(rowItems, trailingComment) {
			return {
				itemParts: [],
				...rowItems,
				trailingComment,
				trailingComma: true
			};
		}
		function peg$f2(rowItems, trailingComment) {
			return {
				...rowItems,
				trailingComment
			};
		}
		function peg$f3(a, b) {
			return processItem(a, b);
		}
		function peg$f4(b) {
			return processItem(null, b);
		}
		function peg$f5(cell) {
			return { cell };
		}
		function peg$f6() {
			return {};
		}
		function peg$f7(part) {
			return part;
		}
		function peg$f8(x) {
			return x;
		}
		function peg$f9(space, x) {
			return {
				trailingComment: x,
				leadingParbreak: space.parbreak > 0
			};
		}
		function peg$f10(list) {
			return {
				whitespace: list.filter((x) => options.isWhitespace(x)).length,
				parbreak: list.filter((x) => options.isParbreak(x)).length
			};
		}
		function peg$f11() {
			return !options.allowParenGroups;
		}
		function peg$f12(tok) {
			return options.isSameLineComment(tok);
		}
		function peg$f13(tok) {
			return tok;
		}
		function peg$f14(tok) {
			return options.isOwnLineComment(tok);
		}
		function peg$f15(tok) {
			return tok;
		}
		function peg$f16(tok) {
			return options.isWhitespace(tok);
		}
		function peg$f17(tok) {
			return tok;
		}
		function peg$f18(tok) {
			return options.isParbreak(tok);
		}
		function peg$f19(tok) {
			return tok;
		}
		function peg$f20(tok) {
			return options.isComma(tok);
		}
		function peg$f21(tok) {
			return tok;
		}
		function peg$f22(tok) {
			return options.isEquals(tok);
		}
		function peg$f23(tok) {
			return tok;
		}
		function peg$f24(tok) {
			return options.isChar(tok, "(");
		}
		function peg$f25(tok) {
			return tok;
		}
		function peg$f26(tok) {
			return options.isChar(tok, ")");
		}
		function peg$f27(tok) {
			return tok;
		}
		let peg$currPos = options.peg$currPos | 0;
		const peg$posDetailsCache = [{
			line: 1,
			column: 1
		}];
		let peg$maxFailPos = peg$currPos;
		let peg$maxFailExpected = options.peg$maxFailExpected || [];
		let peg$silentFails = options.peg$silentFails | 0;
		let peg$result;
		if (options.startRule) {
			if (!(options.startRule in peg$startRuleFunctions)) throw new Error(`Can't start parsing from rule "` + options.startRule + "\".");
			peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
		}
		function peg$getUnicode(pos = peg$currPos) {
			const cp = input.codePointAt(pos);
			if (cp === void 0) return "";
			return String.fromCodePoint(cp);
		}
		function peg$anyExpectation() {
			return { type: "any" };
		}
		function peg$endExpectation() {
			return { type: "end" };
		}
		function peg$computePosDetails(pos) {
			let details = peg$posDetailsCache[pos];
			let p;
			if (details) return details;
			else {
				if (pos >= peg$posDetailsCache.length) p = peg$posDetailsCache.length - 1;
				else {
					p = pos;
					while (!peg$posDetailsCache[--p]);
				}
				details = peg$posDetailsCache[p];
				details = {
					line: details.line,
					column: details.column
				};
				while (p < pos) {
					if (input.charCodeAt(p) === 10) {
						details.line++;
						details.column = 1;
					} else details.column++;
					p++;
				}
				peg$posDetailsCache[pos] = details;
				return details;
			}
		}
		function peg$computeLocation(startPos, endPos, offset2) {
			const startPosDetails = peg$computePosDetails(startPos);
			const endPosDetails = peg$computePosDetails(endPos);
			const res = {
				source: peg$source,
				start: {
					offset: startPos,
					line: startPosDetails.line,
					column: startPosDetails.column
				},
				end: {
					offset: endPos,
					line: endPosDetails.line,
					column: endPosDetails.column
				}
			};
			if (offset2 && peg$source && typeof peg$source.offset === "function") {
				res.start = peg$source.offset(res.start);
				res.end = peg$source.offset(res.end);
			}
			return res;
		}
		function peg$fail(expected2) {
			if (peg$currPos < peg$maxFailPos) return;
			if (peg$currPos > peg$maxFailPos) {
				peg$maxFailPos = peg$currPos;
				peg$maxFailExpected = [];
			}
			peg$maxFailExpected.push(expected2);
		}
		function peg$buildStructuredError(expected2, found, location2) {
			return new peg$SyntaxError(peg$SyntaxError.buildMessage(expected2, found), expected2, found, location2);
		}
		function peg$parsebody() {
			let s0, s1, s2;
			s0 = [];
			s1 = peg$parsecomment_only_line();
			if (s1 === peg$FAILED) {
				s1 = peg$parseitem_with_end();
				if (s1 === peg$FAILED) s1 = peg$parseitem_without_end();
			}
			if (s1 !== peg$FAILED) while (s1 !== peg$FAILED) {
				s0.push(s1);
				s1 = peg$parsecomment_only_line();
				if (s1 === peg$FAILED) {
					s1 = peg$parseitem_with_end();
					if (s1 === peg$FAILED) s1 = peg$parseitem_without_end();
				}
			}
			else s0 = peg$FAILED;
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = [];
				s2 = peg$parsewhitespace();
				while (s2 !== peg$FAILED) {
					s1.push(s2);
					s2 = peg$parsewhitespace();
				}
				s2 = peg$parseEOL();
				if (s2 !== peg$FAILED) s0 = peg$f0();
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			}
			return s0;
		}
		function peg$parseitem_with_end() {
			let s0, s2, s4, s5, s6, s7, s8;
			s0 = peg$currPos;
			peg$parsewhitespace_or_parbreaks();
			s2 = peg$parserow_items();
			if (s2 === peg$FAILED) s2 = null;
			peg$parsewhitespace_or_parbreaks();
			s4 = peg$parseitem_sep();
			if (s4 !== peg$FAILED) {
				s5 = [];
				s6 = peg$parsewhitespace();
				while (s6 !== peg$FAILED) {
					s5.push(s6);
					s6 = peg$parsewhitespace();
				}
				s6 = peg$parsetrailing_comment();
				if (s6 === peg$FAILED) s6 = null;
				s7 = [];
				s8 = peg$parsewhitespace();
				while (s8 !== peg$FAILED) {
					s7.push(s8);
					s8 = peg$parsewhitespace();
				}
				s0 = peg$f1(s2, s6);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseitem_without_end() {
			let s0, s2, s3;
			s0 = peg$currPos;
			peg$parsewhitespace_or_parbreaks();
			s2 = peg$parserow_items();
			if (s2 !== peg$FAILED) {
				s3 = peg$parsetrailing_comment();
				if (s3 === peg$FAILED) s3 = null;
				s0 = peg$f2(s2, s3);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parserow_items() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			s1 = peg$parseitem_part();
			if (s1 !== peg$FAILED) {
				s2 = [];
				s3 = peg$parseseparated_part();
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$parseseparated_part();
				}
				s0 = peg$f3(s1, s2);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = [];
				s2 = peg$parseseparated_part();
				if (s2 !== peg$FAILED) while (s2 !== peg$FAILED) {
					s1.push(s2);
					s2 = peg$parseseparated_part();
				}
				else s1 = peg$FAILED;
				if (s1 !== peg$FAILED) s1 = peg$f4(s1);
				s0 = s1;
			}
			return s0;
		}
		function peg$parseseparated_part() {
			let s0, s1, s2, s3, s4;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parseparbreak();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parseparbreak();
			}
			s2 = peg$parseequals();
			if (s2 !== peg$FAILED) {
				s3 = [];
				s4 = peg$parseparbreak();
				while (s4 !== peg$FAILED) {
					s3.push(s4);
					s4 = peg$parseparbreak();
				}
				s4 = peg$parseitem_part();
				if (s4 !== peg$FAILED) s0 = peg$f5(s4);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = [];
				s2 = peg$parseparbreak();
				while (s2 !== peg$FAILED) {
					s1.push(s2);
					s2 = peg$parseparbreak();
				}
				s2 = peg$parseequals();
				if (s2 !== peg$FAILED) s0 = peg$f6();
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			}
			return s0;
		}
		function peg$parseitem_part() {
			let s0, s1, s2, s3, s4, s5, s6, s7, s8, s9;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parsewhitespace();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parsewhitespace();
			}
			s2 = peg$currPos;
			s3 = [];
			s4 = peg$parsenon_whitespace_non_parbreak_token();
			if (s4 === peg$FAILED) {
				s4 = peg$currPos;
				s5 = peg$parsewhitespace();
				if (s5 === peg$FAILED) s5 = peg$parseparbreak();
				if (s5 !== peg$FAILED) {
					s6 = peg$currPos;
					peg$silentFails++;
					s7 = peg$currPos;
					s8 = [];
					s9 = peg$parsewhitespace();
					if (s9 === peg$FAILED) s9 = peg$parseparbreak();
					while (s9 !== peg$FAILED) {
						s8.push(s9);
						s9 = peg$parsewhitespace();
						if (s9 === peg$FAILED) s9 = peg$parseparbreak();
					}
					s9 = peg$parsenon_whitespace_non_parbreak_token();
					if (s9 !== peg$FAILED) {
						s8 = [s8, s9];
						s7 = s8;
					} else {
						peg$currPos = s7;
						s7 = peg$FAILED;
					}
					peg$silentFails--;
					if (s7 !== peg$FAILED) {
						peg$currPos = s6;
						s6 = void 0;
					} else s6 = peg$FAILED;
					if (s6 !== peg$FAILED) {
						s5 = [s5, s6];
						s4 = s5;
					} else {
						peg$currPos = s4;
						s4 = peg$FAILED;
					}
				} else {
					peg$currPos = s4;
					s4 = peg$FAILED;
				}
			}
			if (s4 !== peg$FAILED) while (s4 !== peg$FAILED) {
				s3.push(s4);
				s4 = peg$parsenon_whitespace_non_parbreak_token();
				if (s4 === peg$FAILED) {
					s4 = peg$currPos;
					s5 = peg$parsewhitespace();
					if (s5 === peg$FAILED) s5 = peg$parseparbreak();
					if (s5 !== peg$FAILED) {
						s6 = peg$currPos;
						peg$silentFails++;
						s7 = peg$currPos;
						s8 = [];
						s9 = peg$parsewhitespace();
						if (s9 === peg$FAILED) s9 = peg$parseparbreak();
						while (s9 !== peg$FAILED) {
							s8.push(s9);
							s9 = peg$parsewhitespace();
							if (s9 === peg$FAILED) s9 = peg$parseparbreak();
						}
						s9 = peg$parsenon_whitespace_non_parbreak_token();
						if (s9 !== peg$FAILED) {
							s8 = [s8, s9];
							s7 = s8;
						} else {
							peg$currPos = s7;
							s7 = peg$FAILED;
						}
						peg$silentFails--;
						if (s7 !== peg$FAILED) {
							peg$currPos = s6;
							s6 = void 0;
						} else s6 = peg$FAILED;
						if (s6 !== peg$FAILED) {
							s5 = [s5, s6];
							s4 = s5;
						} else {
							peg$currPos = s4;
							s4 = peg$FAILED;
						}
					} else {
						peg$currPos = s4;
						s4 = peg$FAILED;
					}
				}
			}
			else s3 = peg$FAILED;
			if (s3 !== peg$FAILED) s2 = input.substring(s2, peg$currPos);
			else s2 = s3;
			if (s2 !== peg$FAILED) {
				s3 = [];
				s4 = peg$parsewhitespace();
				while (s4 !== peg$FAILED) {
					s3.push(s4);
					s4 = peg$parsewhitespace();
				}
				s0 = peg$f7(s2);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsetrailing_comment() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parsewhitespace();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parsewhitespace();
			}
			s2 = peg$parsesame_line_comment();
			if (s2 !== peg$FAILED) s0 = peg$f8(s2);
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsecomment_only_line() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = peg$parsewhitespace_or_parbreaks();
			s2 = peg$parseown_line_comment();
			if (s2 !== peg$FAILED) s0 = peg$f9(s1, s2);
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsetoken() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			s1 = peg$currPos;
			s2 = peg$currPos;
			peg$silentFails++;
			s3 = peg$parsenon_token();
			peg$silentFails--;
			if (s3 === peg$FAILED) s2 = void 0;
			else {
				peg$currPos = s2;
				s2 = peg$FAILED;
			}
			if (s2 !== peg$FAILED) {
				if (input.length > peg$currPos) {
					s3 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s3 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e0);
				}
				if (s3 !== peg$FAILED) {
					s2 = [s2, s3];
					s1 = s2;
				} else {
					peg$currPos = s1;
					s1 = peg$FAILED;
				}
			} else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 !== peg$FAILED) s0 = input.substring(s0, peg$currPos);
			else s0 = s1;
			return s0;
		}
		function peg$parsenon_whitespace_non_parbreak_token() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			s1 = peg$currPos;
			s2 = peg$currPos;
			peg$silentFails++;
			s3 = peg$parsewhitespace();
			if (s3 === peg$FAILED) s3 = peg$parseparbreak();
			peg$silentFails--;
			if (s3 === peg$FAILED) s2 = void 0;
			else {
				peg$currPos = s2;
				s2 = peg$FAILED;
			}
			if (s2 !== peg$FAILED) {
				s3 = peg$parseparen_block();
				if (s3 === peg$FAILED) s3 = peg$parsetoken();
				if (s3 !== peg$FAILED) {
					s2 = [s2, s3];
					s1 = s2;
				} else {
					peg$currPos = s1;
					s1 = peg$FAILED;
				}
			} else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 !== peg$FAILED) s0 = input.substring(s0, peg$currPos);
			else s0 = s1;
			return s0;
		}
		function peg$parsenon_token() {
			let s0;
			s0 = peg$parseitem_sep();
			if (s0 === peg$FAILED) {
				s0 = peg$parseequals();
				if (s0 === peg$FAILED) {
					s0 = peg$parsetrailing_comment();
					if (s0 === peg$FAILED) s0 = peg$parseown_line_comment();
				}
			}
			return s0;
		}
		function peg$parsewhitespace_or_parbreaks() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parsewhitespace();
			if (s2 === peg$FAILED) s2 = peg$parseparbreak();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parsewhitespace();
				if (s2 === peg$FAILED) s2 = peg$parseparbreak();
			}
			s1 = peg$f10(s1);
			s0 = s1;
			return s0;
		}
		function peg$parseparen_block() {
			let s0, s1, s2, s3, s4, s5, s6, s7, s8;
			s0 = peg$currPos;
			s1 = peg$f11();
			if (s1) s1 = peg$FAILED;
			else s1 = void 0;
			if (s1 !== peg$FAILED) {
				s2 = peg$currPos;
				s3 = peg$currPos;
				s4 = peg$parseopen_paren();
				if (s4 !== peg$FAILED) {
					s5 = [];
					s6 = peg$currPos;
					s7 = peg$currPos;
					peg$silentFails++;
					s8 = peg$parseclose_paren();
					peg$silentFails--;
					if (s8 === peg$FAILED) s7 = void 0;
					else {
						peg$currPos = s7;
						s7 = peg$FAILED;
					}
					if (s7 !== peg$FAILED) {
						if (input.length > peg$currPos) {
							s8 = input.charAt(peg$currPos);
							peg$currPos++;
						} else {
							s8 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e0);
						}
						if (s8 !== peg$FAILED) {
							s7 = [s7, s8];
							s6 = s7;
						} else {
							peg$currPos = s6;
							s6 = peg$FAILED;
						}
					} else {
						peg$currPos = s6;
						s6 = peg$FAILED;
					}
					while (s6 !== peg$FAILED) {
						s5.push(s6);
						s6 = peg$currPos;
						s7 = peg$currPos;
						peg$silentFails++;
						s8 = peg$parseclose_paren();
						peg$silentFails--;
						if (s8 === peg$FAILED) s7 = void 0;
						else {
							peg$currPos = s7;
							s7 = peg$FAILED;
						}
						if (s7 !== peg$FAILED) {
							if (input.length > peg$currPos) {
								s8 = input.charAt(peg$currPos);
								peg$currPos++;
							} else {
								s8 = peg$FAILED;
								if (peg$silentFails === 0) peg$fail(peg$e0);
							}
							if (s8 !== peg$FAILED) {
								s7 = [s7, s8];
								s6 = s7;
							} else {
								peg$currPos = s6;
								s6 = peg$FAILED;
							}
						} else {
							peg$currPos = s6;
							s6 = peg$FAILED;
						}
					}
					s6 = peg$parseclose_paren();
					if (s6 !== peg$FAILED) {
						s4 = [
							s4,
							s5,
							s6
						];
						s3 = s4;
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				} else {
					peg$currPos = s3;
					s3 = peg$FAILED;
				}
				if (s3 !== peg$FAILED) s2 = input.substring(s2, peg$currPos);
				else s2 = s3;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsesame_line_comment() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f12(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f13(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseown_line_comment() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f14(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f15(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsewhitespace() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f16(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f17(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseparbreak() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f18(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f19(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseitem_sep() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f20(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f21(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseequals() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f22(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f23(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseopen_paren() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f24(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f25(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseclose_paren() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f26(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f27(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseEOL() {
			let s0, s1;
			s0 = peg$currPos;
			peg$silentFails++;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			peg$silentFails--;
			if (s1 === peg$FAILED) s0 = void 0;
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function processItem(leadCell, otherCells) {
			const cells = [leadCell || []];
			for (const x of otherCells) cells.push(x.cell || []);
			return { itemParts: cells };
		}
		if (!options.isWhitespace) try {
			Object.assign(options, {
				isChar: (node, char) => node.type === "string" && node.content === char,
				isComma(node) {
					return node.type === "string" && node.content === ",";
				},
				isEquals(node) {
					return node.type === "string" && node.content === "=";
				},
				isParbreak(node) {
					return node.type === "parbreak";
				},
				isWhitespace(node) {
					return node.type === "whitespace";
				},
				isSameLineComment: (node) => node.type === "comment" && node.sameline,
				isOwnLineComment: (node) => node.type === "comment" && !node.sameline,
				isComment: (node) => node.type === "comment",
				allowParenGroups: true
			});
		} catch (e) {
			console.warn("Error when initializing parser", e);
		}
		peg$result = peg$startRuleFunction();
		const peg$success = peg$result !== peg$FAILED && peg$currPos === input.length;
		function peg$throw() {
			if (peg$result !== peg$FAILED && peg$currPos < input.length) peg$fail(peg$endExpectation());
			throw peg$buildStructuredError(peg$maxFailExpected, peg$maxFailPos < input.length ? peg$getUnicode(peg$maxFailPos) : null, peg$maxFailPos < input.length ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1) : peg$computeLocation(peg$maxFailPos, peg$maxFailPos));
		}
		if (options.peg$library) return (
		/** @type {any} */
		{
			peg$result,
			peg$currPos,
			peg$FAILED,
			peg$maxFailExpected,
			peg$maxFailPos,
			peg$success,
			peg$throw: peg$success ? void 0 : peg$throw
		});
		if (peg$success) return peg$result;
		else peg$throw();
	}
	return {
		StartRules: ["body"],
		SyntaxError: peg$SyntaxError,
		parse: peg$parse
	};
})();
//#endregion
//#region grammars/macro-substitutions.pegjs
var macro_substitutions_default = (function() {
	"use strict";
	class peg$SyntaxError extends SyntaxError {
		constructor(message, expected, found, location) {
			super(message);
			this.expected = expected;
			this.found = found;
			this.location = location;
			this.name = "SyntaxError";
		}
		format(sources) {
			let str = "Error: " + this.message;
			if (this.location) {
				let src = null;
				const st = sources.find((s2) => s2.source === this.location.source);
				if (st) src = st.text.split(/\r\n|\n|\r/g);
				const s = this.location.start;
				const offset_s = this.location.source && typeof this.location.source.offset === "function" ? this.location.source.offset(s) : s;
				const loc = this.location.source + ":" + offset_s.line + ":" + offset_s.column;
				if (src) {
					const e = this.location.end;
					const filler = "".padEnd(offset_s.line.toString().length, " ");
					const line = src[s.line - 1];
					const hatLen = (s.line === e.line ? e.column : line.length + 1) - s.column || 1;
					str += "\n --> " + loc + "\n" + filler + " |\n" + offset_s.line + " | " + line + "\n" + filler + " | " + "".padEnd(s.column - 1, " ") + "".padEnd(hatLen, "^");
				} else str += "\n at " + loc;
			}
			return str;
		}
		static buildMessage(expected, found) {
			function hex(ch) {
				return ch.codePointAt(0).toString(16).toUpperCase();
			}
			const nonPrintable = Object.prototype.hasOwnProperty.call(RegExp.prototype, "unicode") ? /* @__PURE__ */ new RegExp("[\\p{C}\\p{Mn}\\p{Mc}]", "gu") : null;
			function unicodeEscape(s) {
				if (nonPrintable) return s.replace(nonPrintable, (ch) => "\\u{" + hex(ch) + "}");
				return s;
			}
			function literalEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			function classEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^").replace(/-/g, "\\-").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			const DESCRIBE_EXPECTATION_FNS = {
				literal(expectation) {
					return "\"" + literalEscape(expectation.text) + "\"";
				},
				class(expectation) {
					const escapedParts = expectation.parts.map((part) => Array.isArray(part) ? classEscape(part[0]) + "-" + classEscape(part[1]) : classEscape(part));
					return "[" + (expectation.inverted ? "^" : "") + escapedParts.join("") + "]" + (expectation.unicode ? "u" : "");
				},
				any() {
					return "any character";
				},
				end() {
					return "end of input";
				},
				other(expectation) {
					return expectation.description;
				}
			};
			function describeExpectation(expectation) {
				return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
			}
			function describeExpected(expected2) {
				const descriptions = expected2.map(describeExpectation);
				descriptions.sort();
				if (descriptions.length > 0) {
					let j = 1;
					for (let i = 1; i < descriptions.length; i++) if (descriptions[i - 1] !== descriptions[i]) {
						descriptions[j] = descriptions[i];
						j++;
					}
					descriptions.length = j;
				}
				switch (descriptions.length) {
					case 1: return descriptions[0];
					case 2: return descriptions[0] + " or " + descriptions[1];
					default: return descriptions.slice(0, -1).join(", ") + ", or " + descriptions[descriptions.length - 1];
				}
			}
			function describeFound(found2) {
				return found2 ? "\"" + literalEscape(found2) + "\"" : "end of input";
			}
			return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
		}
	}
	function peg$parse(input, options) {
		options = options !== void 0 ? options : {};
		const peg$FAILED = {};
		const peg$source = options.grammarSource;
		const peg$startRuleFunctions = { body: peg$parsebody };
		let peg$startRuleFunction = peg$parsebody;
		const peg$e0 = peg$anyExpectation();
		function peg$f0(e) {
			return [].concat(...e).filter((n) => !!n);
		}
		function peg$f1() {
			return [];
		}
		function peg$f2(tok) {
			return options.isHash(tok);
		}
		function peg$f3(tok) {
			return tok;
		}
		function peg$f4(tok) {
			return options.isNumber(tok);
		}
		function peg$f5(tok) {
			return tok;
		}
		function peg$f6() {
			return {
				type: "string",
				content: "#"
			};
		}
		function peg$f7(num) {
			const split = options.splitNumber(num);
			return [{
				type: "hash_number",
				number: split.number
			}, split.rest];
		}
		let peg$currPos = options.peg$currPos | 0;
		const peg$posDetailsCache = [{
			line: 1,
			column: 1
		}];
		let peg$maxFailPos = peg$currPos;
		let peg$maxFailExpected = options.peg$maxFailExpected || [];
		let peg$silentFails = options.peg$silentFails | 0;
		let peg$result;
		if (options.startRule) {
			if (!(options.startRule in peg$startRuleFunctions)) throw new Error(`Can't start parsing from rule "` + options.startRule + "\".");
			peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
		}
		function peg$getUnicode(pos = peg$currPos) {
			const cp = input.codePointAt(pos);
			if (cp === void 0) return "";
			return String.fromCodePoint(cp);
		}
		function peg$anyExpectation() {
			return { type: "any" };
		}
		function peg$endExpectation() {
			return { type: "end" };
		}
		function peg$computePosDetails(pos) {
			let details = peg$posDetailsCache[pos];
			let p;
			if (details) return details;
			else {
				if (pos >= peg$posDetailsCache.length) p = peg$posDetailsCache.length - 1;
				else {
					p = pos;
					while (!peg$posDetailsCache[--p]);
				}
				details = peg$posDetailsCache[p];
				details = {
					line: details.line,
					column: details.column
				};
				while (p < pos) {
					if (input.charCodeAt(p) === 10) {
						details.line++;
						details.column = 1;
					} else details.column++;
					p++;
				}
				peg$posDetailsCache[pos] = details;
				return details;
			}
		}
		function peg$computeLocation(startPos, endPos, offset2) {
			const startPosDetails = peg$computePosDetails(startPos);
			const endPosDetails = peg$computePosDetails(endPos);
			const res = {
				source: peg$source,
				start: {
					offset: startPos,
					line: startPosDetails.line,
					column: startPosDetails.column
				},
				end: {
					offset: endPos,
					line: endPosDetails.line,
					column: endPosDetails.column
				}
			};
			if (offset2 && peg$source && typeof peg$source.offset === "function") {
				res.start = peg$source.offset(res.start);
				res.end = peg$source.offset(res.end);
			}
			return res;
		}
		function peg$fail(expected2) {
			if (peg$currPos < peg$maxFailPos) return;
			if (peg$currPos > peg$maxFailPos) {
				peg$maxFailPos = peg$currPos;
				peg$maxFailExpected = [];
			}
			peg$maxFailExpected.push(expected2);
		}
		function peg$buildStructuredError(expected2, found, location2) {
			return new peg$SyntaxError(peg$SyntaxError.buildMessage(expected2, found), expected2, found, location2);
		}
		function peg$parsebody() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parsedouble_hash();
			if (s2 === peg$FAILED) {
				s2 = peg$parsehash_number();
				if (s2 === peg$FAILED) if (input.length > peg$currPos) {
					s2 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e0);
				}
			}
			if (s2 !== peg$FAILED) while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parsedouble_hash();
				if (s2 === peg$FAILED) {
					s2 = peg$parsehash_number();
					if (s2 === peg$FAILED) if (input.length > peg$currPos) {
						s2 = input.charAt(peg$currPos);
						peg$currPos++;
					} else {
						s2 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e0);
					}
				}
			}
			else s1 = peg$FAILED;
			if (s1 !== peg$FAILED) s1 = peg$f0(s1);
			s0 = s1;
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$parseEOL();
				if (s1 !== peg$FAILED) s1 = peg$f1();
				s0 = s1;
			}
			return s0;
		}
		function peg$parsehash() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f2(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f3(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsenumber() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f4(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f5(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsedouble_hash() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = peg$parsehash();
			if (s1 !== peg$FAILED) {
				s2 = peg$parsehash();
				if (s2 !== peg$FAILED) s0 = peg$f6();
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsehash_number() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = peg$parsehash();
			if (s1 !== peg$FAILED) {
				s2 = peg$parsenumber();
				if (s2 !== peg$FAILED) s0 = peg$f7(s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseEOL() {
			let s0, s1;
			s0 = peg$currPos;
			peg$silentFails++;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			peg$silentFails--;
			if (s1 === peg$FAILED) s0 = void 0;
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		if (!options.isHash) try {
			Object.assign(options, {
				isHash: (node) => node.type === "string" && node.content === "#",
				isNumber: (node) => node.type === "string" && 0 < +node.content.charAt(0),
				splitNumber: (node) => {
					const number = +node.content.charAt(0);
					if (node.content.length > 1) return {
						number,
						rest: {
							type: "string",
							content: node.content.slice(1)
						}
					};
					return { number };
				}
			});
		} catch (e) {
			console.warn("Error when initializing parser", e);
		}
		peg$result = peg$startRuleFunction();
		const peg$success = peg$result !== peg$FAILED && peg$currPos === input.length;
		function peg$throw() {
			if (peg$result !== peg$FAILED && peg$currPos < input.length) peg$fail(peg$endExpectation());
			throw peg$buildStructuredError(peg$maxFailExpected, peg$maxFailPos < input.length ? peg$getUnicode(peg$maxFailPos) : null, peg$maxFailPos < input.length ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1) : peg$computeLocation(peg$maxFailPos, peg$maxFailPos));
		}
		if (options.peg$library) return (
		/** @type {any} */
		{
			peg$result,
			peg$currPos,
			peg$FAILED,
			peg$maxFailExpected,
			peg$maxFailPos,
			peg$success,
			peg$throw: peg$success ? void 0 : peg$throw
		});
		if (peg$success) return peg$result;
		else peg$throw();
	}
	return {
		StartRules: ["body"],
		SyntaxError: peg$SyntaxError,
		parse: peg$parse
	};
})();
//#endregion
//#region grammars/ligatures.pegjs
var ligatures_default = (function() {
	"use strict";
	class peg$SyntaxError extends SyntaxError {
		constructor(message, expected, found, location) {
			super(message);
			this.expected = expected;
			this.found = found;
			this.location = location;
			this.name = "SyntaxError";
		}
		format(sources) {
			let str = "Error: " + this.message;
			if (this.location) {
				let src = null;
				const st = sources.find((s2) => s2.source === this.location.source);
				if (st) src = st.text.split(/\r\n|\n|\r/g);
				const s = this.location.start;
				const offset_s = this.location.source && typeof this.location.source.offset === "function" ? this.location.source.offset(s) : s;
				const loc = this.location.source + ":" + offset_s.line + ":" + offset_s.column;
				if (src) {
					const e = this.location.end;
					const filler = "".padEnd(offset_s.line.toString().length, " ");
					const line = src[s.line - 1];
					const hatLen = (s.line === e.line ? e.column : line.length + 1) - s.column || 1;
					str += "\n --> " + loc + "\n" + filler + " |\n" + offset_s.line + " | " + line + "\n" + filler + " | " + "".padEnd(s.column - 1, " ") + "".padEnd(hatLen, "^");
				} else str += "\n at " + loc;
			}
			return str;
		}
		static buildMessage(expected, found) {
			function hex(ch) {
				return ch.codePointAt(0).toString(16).toUpperCase();
			}
			const nonPrintable = Object.prototype.hasOwnProperty.call(RegExp.prototype, "unicode") ? /* @__PURE__ */ new RegExp("[\\p{C}\\p{Mn}\\p{Mc}]", "gu") : null;
			function unicodeEscape(s) {
				if (nonPrintable) return s.replace(nonPrintable, (ch) => "\\u{" + hex(ch) + "}");
				return s;
			}
			function literalEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			function classEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^").replace(/-/g, "\\-").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			const DESCRIBE_EXPECTATION_FNS = {
				literal(expectation) {
					return "\"" + literalEscape(expectation.text) + "\"";
				},
				class(expectation) {
					const escapedParts = expectation.parts.map((part) => Array.isArray(part) ? classEscape(part[0]) + "-" + classEscape(part[1]) : classEscape(part));
					return "[" + (expectation.inverted ? "^" : "") + escapedParts.join("") + "]" + (expectation.unicode ? "u" : "");
				},
				any() {
					return "any character";
				},
				end() {
					return "end of input";
				},
				other(expectation) {
					return expectation.description;
				}
			};
			function describeExpectation(expectation) {
				return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
			}
			function describeExpected(expected2) {
				const descriptions = expected2.map(describeExpectation);
				descriptions.sort();
				if (descriptions.length > 0) {
					let j = 1;
					for (let i = 1; i < descriptions.length; i++) if (descriptions[i - 1] !== descriptions[i]) {
						descriptions[j] = descriptions[i];
						j++;
					}
					descriptions.length = j;
				}
				switch (descriptions.length) {
					case 1: return descriptions[0];
					case 2: return descriptions[0] + " or " + descriptions[1];
					default: return descriptions.slice(0, -1).join(", ") + ", or " + descriptions[descriptions.length - 1];
				}
			}
			function describeFound(found2) {
				return found2 ? "\"" + literalEscape(found2) + "\"" : "end of input";
			}
			return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
		}
	}
	function peg$parse(input, options) {
		options = options !== void 0 ? options : {};
		const peg$FAILED = {};
		const peg$source = options.grammarSource;
		const peg$startRuleFunctions = { body: peg$parsebody };
		let peg$startRuleFunction = peg$parsebody;
		const peg$e0 = peg$anyExpectation();
		function peg$f0(e) {
			return [].concat(...e).filter((n) => !!n);
		}
		function peg$f1() {
			return [];
		}
		function peg$f2(toks) {
			return options.isRecognized(toks);
		}
		function peg$f3(toks) {
			return options.isRecognized(toks);
		}
		function peg$f4(tok1, tok2) {
			const split = options.split(tok2);
			return options.isRecognized([tok1, split[0]]);
		}
		function peg$f5(tok1, tok2) {
			const split = options.split(tok2);
			return [options.isRecognized([tok1, split[0]]), split[1]];
		}
		function peg$f6(tok1, tok2) {
			return options.isRecognized([tok1, tok2]);
		}
		function peg$f7(tok1, tok2) {
			return options.isRecognized([tok1, tok2]);
		}
		function peg$f8(toks) {
			return options.isRecognized(toks);
		}
		function peg$f9(toks) {
			return options.isRecognized(toks);
		}
		function peg$f10(tok) {
			return options.isRecognized([tok]);
		}
		function peg$f11(tok) {
			return options.isRecognized([tok]);
		}
		function peg$f12(tok) {
			return options.isMacro(tok);
		}
		function peg$f13(tok) {
			return tok;
		}
		function peg$f14(tok) {
			return options.isWhitespace(tok);
		}
		function peg$f15(tok) {
			return tok;
		}
		function peg$f16(tok) {
			return options.isSplitable(tok);
		}
		function peg$f17(tok) {
			return tok;
		}
		let peg$currPos = options.peg$currPos | 0;
		const peg$posDetailsCache = [{
			line: 1,
			column: 1
		}];
		let peg$maxFailPos = peg$currPos;
		let peg$maxFailExpected = options.peg$maxFailExpected || [];
		let peg$silentFails = options.peg$silentFails | 0;
		let peg$result;
		if (options.startRule) {
			if (!(options.startRule in peg$startRuleFunctions)) throw new Error(`Can't start parsing from rule "` + options.startRule + "\".");
			peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
		}
		function peg$getUnicode(pos = peg$currPos) {
			const cp = input.codePointAt(pos);
			if (cp === void 0) return "";
			return String.fromCodePoint(cp);
		}
		function peg$anyExpectation() {
			return { type: "any" };
		}
		function peg$endExpectation() {
			return { type: "end" };
		}
		function peg$computePosDetails(pos) {
			let details = peg$posDetailsCache[pos];
			let p;
			if (details) return details;
			else {
				if (pos >= peg$posDetailsCache.length) p = peg$posDetailsCache.length - 1;
				else {
					p = pos;
					while (!peg$posDetailsCache[--p]);
				}
				details = peg$posDetailsCache[p];
				details = {
					line: details.line,
					column: details.column
				};
				while (p < pos) {
					if (input.charCodeAt(p) === 10) {
						details.line++;
						details.column = 1;
					} else details.column++;
					p++;
				}
				peg$posDetailsCache[pos] = details;
				return details;
			}
		}
		function peg$computeLocation(startPos, endPos, offset2) {
			const startPosDetails = peg$computePosDetails(startPos);
			const endPosDetails = peg$computePosDetails(endPos);
			const res = {
				source: peg$source,
				start: {
					offset: startPos,
					line: startPosDetails.line,
					column: startPosDetails.column
				},
				end: {
					offset: endPos,
					line: endPosDetails.line,
					column: endPosDetails.column
				}
			};
			if (offset2 && peg$source && typeof peg$source.offset === "function") {
				res.start = peg$source.offset(res.start);
				res.end = peg$source.offset(res.end);
			}
			return res;
		}
		function peg$fail(expected2) {
			if (peg$currPos < peg$maxFailPos) return;
			if (peg$currPos > peg$maxFailPos) {
				peg$maxFailPos = peg$currPos;
				peg$maxFailExpected = [];
			}
			peg$maxFailExpected.push(expected2);
		}
		function peg$buildStructuredError(expected2, found, location2) {
			return new peg$SyntaxError(peg$SyntaxError.buildMessage(expected2, found), expected2, found, location2);
		}
		function peg$parsebody() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parsetriple_ligature();
			if (s2 === peg$FAILED) {
				s2 = peg$parsedouble_ligature();
				if (s2 === peg$FAILED) {
					s2 = peg$parsemono_ligature();
					if (s2 === peg$FAILED) if (input.length > peg$currPos) {
						s2 = input.charAt(peg$currPos);
						peg$currPos++;
					} else {
						s2 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e0);
					}
				}
			}
			if (s2 !== peg$FAILED) while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parsetriple_ligature();
				if (s2 === peg$FAILED) {
					s2 = peg$parsedouble_ligature();
					if (s2 === peg$FAILED) {
						s2 = peg$parsemono_ligature();
						if (s2 === peg$FAILED) if (input.length > peg$currPos) {
							s2 = input.charAt(peg$currPos);
							peg$currPos++;
						} else {
							s2 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e0);
						}
					}
				}
			}
			else s1 = peg$FAILED;
			if (s1 !== peg$FAILED) s1 = peg$f0(s1);
			s0 = s1;
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$parseEOL();
				if (s1 !== peg$FAILED) s1 = peg$f1();
				s0 = s1;
			}
			return s0;
		}
		function peg$parsetriple_ligature() {
			let s0, s1, s2, s3, s4;
			s0 = peg$currPos;
			s1 = peg$currPos;
			if (input.length > peg$currPos) {
				s2 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s2 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s2 !== peg$FAILED) {
				if (input.length > peg$currPos) {
					s3 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s3 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e0);
				}
				if (s3 !== peg$FAILED) {
					if (input.length > peg$currPos) {
						s4 = input.charAt(peg$currPos);
						peg$currPos++;
					} else {
						s4 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e0);
					}
					if (s4 !== peg$FAILED) {
						s2 = [
							s2,
							s3,
							s4
						];
						s1 = s2;
					} else {
						peg$currPos = s1;
						s1 = peg$FAILED;
					}
				} else {
					peg$currPos = s1;
					s1 = peg$FAILED;
				}
			} else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f2(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f3(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsedouble_ligature() {
			let s0;
			s0 = peg$parsedouble_macro_ligature();
			if (s0 === peg$FAILED) {
				s0 = peg$parsedouble_macro_ligature_extracted();
				if (s0 === peg$FAILED) s0 = peg$parsedouble_char_ligature();
			}
			return s0;
		}
		function peg$parsedouble_macro_ligature_extracted() {
			let s0, s1, s2, s3, s4;
			s0 = peg$currPos;
			s1 = peg$parsemacro();
			if (s1 !== peg$FAILED) {
				s2 = [];
				s3 = peg$parsewhitespace();
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$parsewhitespace();
				}
				s3 = peg$parsesplitable();
				if (s3 !== peg$FAILED) {
					s4 = peg$f4(s1, s3);
					if (s4) s4 = void 0;
					else s4 = peg$FAILED;
					if (s4 !== peg$FAILED) s0 = peg$f5(s1, s3);
					else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsedouble_macro_ligature() {
			let s0, s1, s2, s3, s4;
			s0 = peg$currPos;
			s1 = peg$parsemacro();
			if (s1 !== peg$FAILED) {
				s2 = [];
				s3 = peg$parsewhitespace();
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$parsewhitespace();
				}
				if (input.length > peg$currPos) {
					s3 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s3 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e0);
				}
				if (s3 !== peg$FAILED) {
					s4 = peg$f6(s1, s3);
					if (s4) s4 = void 0;
					else s4 = peg$FAILED;
					if (s4 !== peg$FAILED) s0 = peg$f7(s1, s3);
					else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsedouble_char_ligature() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			s1 = peg$currPos;
			if (input.length > peg$currPos) {
				s2 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s2 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s2 !== peg$FAILED) {
				if (input.length > peg$currPos) {
					s3 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s3 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e0);
				}
				if (s3 !== peg$FAILED) {
					s2 = [s2, s3];
					s1 = s2;
				} else {
					peg$currPos = s1;
					s1 = peg$FAILED;
				}
			} else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f8(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f9(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsemono_ligature() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f10(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f11(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsemacro() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f12(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f13(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsewhitespace() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f14(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f15(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsesplitable() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f16(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f17(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseEOL() {
			let s0, s1;
			s0 = peg$currPos;
			peg$silentFails++;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			peg$silentFails--;
			if (s1 === peg$FAILED) s0 = void 0;
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		if (!options.isWhitespace) try {
			Object.assign(options, {
				isMacro: (node) => node.type === "macro",
				isWhitespace: (node) => node.type === "whitespace",
				isRecognized: (nodes) => {
					if (nodes.length == 2 && nodes[0].content === "^" && nodes[1].content === "o") return {
						type: "string",
						content: "ô"
					};
					return null;
				},
				isSplitable: (node) => node.type === "string" && node.content.length > 1,
				split: (node) => [{
					type: "string",
					content: node.content.charAt(0)
				}, {
					type: "string",
					content: node.content.slice(1)
				}]
			});
		} catch (e) {
			console.warn("Error when initializing parser", e);
		}
		peg$result = peg$startRuleFunction();
		const peg$success = peg$result !== peg$FAILED && peg$currPos === input.length;
		function peg$throw() {
			if (peg$result !== peg$FAILED && peg$currPos < input.length) peg$fail(peg$endExpectation());
			throw peg$buildStructuredError(peg$maxFailExpected, peg$maxFailPos < input.length ? peg$getUnicode(peg$maxFailPos) : null, peg$maxFailPos < input.length ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1) : peg$computeLocation(peg$maxFailPos, peg$maxFailPos));
		}
		if (options.peg$library) return (
		/** @type {any} */
		{
			peg$result,
			peg$currPos,
			peg$FAILED,
			peg$maxFailExpected,
			peg$maxFailPos,
			peg$success,
			peg$throw: peg$success ? void 0 : peg$throw
		});
		if (peg$success) return peg$result;
		else peg$throw();
	}
	return {
		StartRules: ["body"],
		SyntaxError: peg$SyntaxError,
		parse: peg$parse
	};
})();
//#endregion
//#region grammars/xcolor-expressions.pegjs
var xcolor_expressions_default = (function() {
	"use strict";
	class peg$SyntaxError extends SyntaxError {
		constructor(message, expected, found, location) {
			super(message);
			this.expected = expected;
			this.found = found;
			this.location = location;
			this.name = "SyntaxError";
		}
		format(sources) {
			let str = "Error: " + this.message;
			if (this.location) {
				let src = null;
				const st = sources.find((s2) => s2.source === this.location.source);
				if (st) src = st.text.split(/\r\n|\n|\r/g);
				const s = this.location.start;
				const offset_s = this.location.source && typeof this.location.source.offset === "function" ? this.location.source.offset(s) : s;
				const loc = this.location.source + ":" + offset_s.line + ":" + offset_s.column;
				if (src) {
					const e = this.location.end;
					const filler = "".padEnd(offset_s.line.toString().length, " ");
					const line = src[s.line - 1];
					const hatLen = (s.line === e.line ? e.column : line.length + 1) - s.column || 1;
					str += "\n --> " + loc + "\n" + filler + " |\n" + offset_s.line + " | " + line + "\n" + filler + " | " + "".padEnd(s.column - 1, " ") + "".padEnd(hatLen, "^");
				} else str += "\n at " + loc;
			}
			return str;
		}
		static buildMessage(expected, found) {
			function hex(ch) {
				return ch.codePointAt(0).toString(16).toUpperCase();
			}
			const nonPrintable = Object.prototype.hasOwnProperty.call(RegExp.prototype, "unicode") ? /* @__PURE__ */ new RegExp("[\\p{C}\\p{Mn}\\p{Mc}]", "gu") : null;
			function unicodeEscape(s) {
				if (nonPrintable) return s.replace(nonPrintable, (ch) => "\\u{" + hex(ch) + "}");
				return s;
			}
			function literalEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			function classEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^").replace(/-/g, "\\-").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			const DESCRIBE_EXPECTATION_FNS = {
				literal(expectation) {
					return "\"" + literalEscape(expectation.text) + "\"";
				},
				class(expectation) {
					const escapedParts = expectation.parts.map((part) => Array.isArray(part) ? classEscape(part[0]) + "-" + classEscape(part[1]) : classEscape(part));
					return "[" + (expectation.inverted ? "^" : "") + escapedParts.join("") + "]" + (expectation.unicode ? "u" : "");
				},
				any() {
					return "any character";
				},
				end() {
					return "end of input";
				},
				other(expectation) {
					return expectation.description;
				}
			};
			function describeExpectation(expectation) {
				return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
			}
			function describeExpected(expected2) {
				const descriptions = expected2.map(describeExpectation);
				descriptions.sort();
				if (descriptions.length > 0) {
					let j = 1;
					for (let i = 1; i < descriptions.length; i++) if (descriptions[i - 1] !== descriptions[i]) {
						descriptions[j] = descriptions[i];
						j++;
					}
					descriptions.length = j;
				}
				switch (descriptions.length) {
					case 1: return descriptions[0];
					case 2: return descriptions[0] + " or " + descriptions[1];
					default: return descriptions.slice(0, -1).join(", ") + ", or " + descriptions[descriptions.length - 1];
				}
			}
			function describeFound(found2) {
				return found2 ? "\"" + literalEscape(found2) + "\"" : "end of input";
			}
			return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
		}
	}
	function peg$parse(input, options) {
		options = options !== void 0 ? options : {};
		const peg$FAILED = {};
		const peg$source = options.grammarSource;
		const peg$startRuleFunctions = { start: peg$parsestart };
		let peg$startRuleFunction = peg$parsestart;
		const peg$c0 = ";";
		const peg$c1 = ",";
		const peg$c2 = ":";
		const peg$c3 = "/";
		const peg$c4 = ">";
		const peg$c5 = "!";
		const peg$c6 = ".";
		const peg$c7 = "!![";
		const peg$c8 = "]";
		const peg$c9 = "!!";
		const peg$c10 = "+";
		const peg$c11 = "-";
		const peg$r0 = /^[a-zA-Z0-9]/;
		const peg$r1 = /^[0-9]/;
		const peg$r2 = /^[ \t\n\r]/;
		const peg$r3 = /^[0-9a-fA-F]/;
		const peg$e0 = peg$anyExpectation();
		const peg$e1 = peg$literalExpectation(";", false);
		const peg$e2 = peg$literalExpectation(",", false);
		const peg$e3 = peg$otherExpectation("model list");
		const peg$e4 = peg$literalExpectation(":", false);
		const peg$e5 = peg$literalExpectation("/", false);
		const peg$e6 = peg$otherExpectation("model");
		const peg$e7 = peg$otherExpectation("color spec list");
		const peg$e8 = peg$otherExpectation("color spec");
		const peg$e9 = peg$otherExpectation("color");
		const peg$e10 = peg$otherExpectation("function expression");
		const peg$e11 = peg$literalExpectation(">", false);
		const peg$e12 = peg$otherExpectation("function");
		const peg$e13 = peg$otherExpectation("extended expression");
		const peg$e14 = peg$otherExpectation("core model");
		const peg$e15 = peg$otherExpectation("expr");
		const peg$e16 = peg$literalExpectation("!", false);
		const peg$e17 = peg$otherExpectation("name");
		const peg$e18 = peg$literalExpectation(".", false);
		const peg$e19 = peg$classExpectation([
			["a", "z"],
			["A", "Z"],
			["0", "9"]
		], false, false, false);
		const peg$e20 = peg$otherExpectation("postfix");
		const peg$e21 = peg$literalExpectation("!![", false);
		const peg$e22 = peg$literalExpectation("]", false);
		const peg$e23 = peg$literalExpectation("!!", false);
		const peg$e24 = peg$otherExpectation("plus");
		const peg$e25 = peg$literalExpectation("+", false);
		const peg$e26 = peg$otherExpectation("minus");
		const peg$e27 = peg$literalExpectation("-", false);
		const peg$e28 = peg$otherExpectation("num");
		const peg$e29 = peg$classExpectation([["0", "9"]], false, false, false);
		const peg$e30 = peg$otherExpectation("positive float");
		const peg$e31 = peg$otherExpectation("divisor");
		const peg$e32 = peg$otherExpectation("int");
		const peg$e33 = peg$classExpectation([
			" ",
			"	",
			"\n",
			"\r"
		], false, false, false);
		const peg$e34 = peg$classExpectation([
			["0", "9"],
			["a", "f"],
			["A", "F"]
		], false, false, false);
		function peg$f0(m) {
			return m;
		}
		function peg$f1(m) {
			return m;
		}
		function peg$f2(m) {
			return m;
		}
		function peg$f3(m) {
			return m;
		}
		function peg$f4(m) {
			return m;
		}
		function peg$f5(a) {
			return {
				type: "invalid_spec",
				content: a
			};
		}
		function peg$f6(f, c) {
			return c;
		}
		function peg$f7(f, r) {
			return {
				type: "color_set",
				content: [f].concat(r)
			};
		}
		function peg$f8(n, s) {
			return {
				type: "color_set_item",
				name: n,
				spec_list: s
			};
		}
		function peg$f9(c, m) {
			return {
				type: "model_list",
				contents: m,
				core_model: c
			};
		}
		function peg$f10(m) {
			return {
				type: "model_list",
				contents: m,
				core_model: null
			};
		}
		function peg$f11(m, a) {
			return a;
		}
		function peg$f12(m, r) {
			return [m].concat(r);
		}
		function peg$f13(s, a) {
			return a;
		}
		function peg$f14(s, r) {
			return {
				type: "spec_list",
				content: [s].concat(r)
			};
		}
		function peg$f15(c) {
			return {
				type: "hex_spec",
				content: [c]
			};
		}
		function peg$f16(c, d) {
			return d;
		}
		function peg$f17(c, d) {
			return d;
		}
		function peg$f18(c, r) {
			return {
				type: "num_spec",
				content: r ? [c].concat(r) : [c]
			};
		}
		function peg$f19(c, fs) {
			return {
				type: "color",
				color: c,
				functions: fs
			};
		}
		function peg$f20(f, n) {
			return n;
		}
		function peg$f21(f, args) {
			return {
				type: "function",
				name: f,
				args
			};
		}
		function peg$f22(core, d, e, es) {
			return {
				type: "extended_expr",
				core_model: core,
				div: d,
				expressions: [e].concat(es)
			};
		}
		function peg$f23(core, e, es) {
			return {
				type: "extended_expr",
				core_model: core,
				div: null,
				expressions: [e].concat(es)
			};
		}
		function peg$f24(e, d) {
			return {
				type: "weighted_expr",
				color: e,
				weight: d
			};
		}
		function peg$f25(e) {
			return e;
		}
		function peg$f26(p, n, e, po) {
			return {
				type: "expr",
				prefix: p,
				name: n,
				mix_expr: e,
				postfix: po
			};
		}
		function peg$f27(p, n) {
			return {
				type: "complete_mix",
				mix_percent: p,
				name: n
			};
		}
		function peg$f28(p) {
			return {
				type: "partial_mix",
				mix_percent: p
			};
		}
		function peg$f29(c, p) {
			return c.concat(p || []);
		}
		function peg$f30(n) {
			return {
				type: "postfix",
				num: n
			};
		}
		function peg$f31(p) {
			return {
				type: "postfix",
				plusses: p
			};
		}
		function peg$f32(n) {
			return parseInt(n, 10);
		}
		function peg$f33(n) {
			return parseFloat(n);
		}
		function peg$f34(n) {
			return n;
		}
		function peg$f35(n) {
			return -n;
		}
		function peg$f36(m, n) {
			return m ? -n : n;
		}
		function peg$f37(h) {
			return h.toUpperCase();
		}
		let peg$currPos = options.peg$currPos | 0;
		const peg$posDetailsCache = [{
			line: 1,
			column: 1
		}];
		let peg$maxFailPos = peg$currPos;
		let peg$maxFailExpected = options.peg$maxFailExpected || [];
		let peg$silentFails = options.peg$silentFails | 0;
		let peg$result;
		if (options.startRule) {
			if (!(options.startRule in peg$startRuleFunctions)) throw new Error(`Can't start parsing from rule "` + options.startRule + "\".");
			peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
		}
		function peg$getUnicode(pos = peg$currPos) {
			const cp = input.codePointAt(pos);
			if (cp === void 0) return "";
			return String.fromCodePoint(cp);
		}
		function peg$literalExpectation(text2, ignoreCase) {
			return {
				type: "literal",
				text: text2,
				ignoreCase
			};
		}
		function peg$classExpectation(parts, inverted, ignoreCase, unicode) {
			return {
				type: "class",
				parts,
				inverted,
				ignoreCase,
				unicode
			};
		}
		function peg$anyExpectation() {
			return { type: "any" };
		}
		function peg$endExpectation() {
			return { type: "end" };
		}
		function peg$otherExpectation(description) {
			return {
				type: "other",
				description
			};
		}
		function peg$computePosDetails(pos) {
			let details = peg$posDetailsCache[pos];
			let p;
			if (details) return details;
			else {
				if (pos >= peg$posDetailsCache.length) p = peg$posDetailsCache.length - 1;
				else {
					p = pos;
					while (!peg$posDetailsCache[--p]);
				}
				details = peg$posDetailsCache[p];
				details = {
					line: details.line,
					column: details.column
				};
				while (p < pos) {
					if (input.charCodeAt(p) === 10) {
						details.line++;
						details.column = 1;
					} else details.column++;
					p++;
				}
				peg$posDetailsCache[pos] = details;
				return details;
			}
		}
		function peg$computeLocation(startPos, endPos, offset2) {
			const startPosDetails = peg$computePosDetails(startPos);
			const endPosDetails = peg$computePosDetails(endPos);
			const res = {
				source: peg$source,
				start: {
					offset: startPos,
					line: startPosDetails.line,
					column: startPosDetails.column
				},
				end: {
					offset: endPos,
					line: endPosDetails.line,
					column: endPosDetails.column
				}
			};
			if (offset2 && peg$source && typeof peg$source.offset === "function") {
				res.start = peg$source.offset(res.start);
				res.end = peg$source.offset(res.end);
			}
			return res;
		}
		function peg$fail(expected2) {
			if (peg$currPos < peg$maxFailPos) return;
			if (peg$currPos > peg$maxFailPos) {
				peg$maxFailPos = peg$currPos;
				peg$maxFailExpected = [];
			}
			peg$maxFailExpected.push(expected2);
		}
		function peg$buildStructuredError(expected2, found, location2) {
			return new peg$SyntaxError(peg$SyntaxError.buildMessage(expected2, found), expected2, found, location2);
		}
		function peg$parsestart() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			s1 = peg$parsespec();
			if (s1 !== peg$FAILED) {
				s2 = peg$parseEOL();
				if (s2 !== peg$FAILED) s0 = peg$f0(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$parsespec_list();
				if (s1 !== peg$FAILED) {
					s2 = peg$parseEOL();
					if (s2 !== peg$FAILED) s0 = peg$f1(s1);
					else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
				if (s0 === peg$FAILED) {
					s0 = peg$currPos;
					s1 = peg$parsecolor();
					if (s1 !== peg$FAILED) {
						s2 = peg$parseEOL();
						if (s2 !== peg$FAILED) s0 = peg$f2(s1);
						else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
					if (s0 === peg$FAILED) {
						s0 = peg$currPos;
						s1 = peg$parsemodel_list();
						if (s1 !== peg$FAILED) {
							s2 = peg$parseEOL();
							if (s2 !== peg$FAILED) s0 = peg$f3(s1);
							else {
								peg$currPos = s0;
								s0 = peg$FAILED;
							}
						} else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
						if (s0 === peg$FAILED) {
							s0 = peg$currPos;
							s1 = peg$parsecolor_set_spec();
							if (s1 !== peg$FAILED) {
								s2 = peg$parseEOL();
								if (s2 !== peg$FAILED) s0 = peg$f4(s1);
								else {
									peg$currPos = s0;
									s0 = peg$FAILED;
								}
							} else {
								peg$currPos = s0;
								s0 = peg$FAILED;
							}
							if (s0 === peg$FAILED) {
								s0 = peg$currPos;
								s1 = peg$currPos;
								s2 = [];
								if (input.length > peg$currPos) {
									s3 = input.charAt(peg$currPos);
									peg$currPos++;
								} else {
									s3 = peg$FAILED;
									if (peg$silentFails === 0) peg$fail(peg$e0);
								}
								while (s3 !== peg$FAILED) {
									s2.push(s3);
									if (input.length > peg$currPos) {
										s3 = input.charAt(peg$currPos);
										peg$currPos++;
									} else {
										s3 = peg$FAILED;
										if (peg$silentFails === 0) peg$fail(peg$e0);
									}
								}
								s1 = input.substring(s1, peg$currPos);
								s1 = peg$f5(s1);
								s0 = s1;
							}
						}
					}
				}
			}
			return s0;
		}
		function peg$parsecolor_set_spec() {
			let s0, s1, s2, s3, s4, s5;
			s0 = peg$currPos;
			s1 = peg$parsecolor_set_item();
			if (s1 !== peg$FAILED) {
				s2 = [];
				s3 = peg$currPos;
				if (input.charCodeAt(peg$currPos) === 59) {
					s4 = peg$c0;
					peg$currPos++;
				} else {
					s4 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e1);
				}
				if (s4 !== peg$FAILED) {
					s5 = peg$parsecolor_set_item();
					if (s5 !== peg$FAILED) s3 = peg$f6(s1, s5);
					else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				} else {
					peg$currPos = s3;
					s3 = peg$FAILED;
				}
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$currPos;
					if (input.charCodeAt(peg$currPos) === 59) {
						s4 = peg$c0;
						peg$currPos++;
					} else {
						s4 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e1);
					}
					if (s4 !== peg$FAILED) {
						s5 = peg$parsecolor_set_item();
						if (s5 !== peg$FAILED) s3 = peg$f6(s1, s5);
						else {
							peg$currPos = s3;
							s3 = peg$FAILED;
						}
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				}
				s0 = peg$f7(s1, s2);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsecolor_set_item() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			s1 = peg$parsename();
			if (s1 !== peg$FAILED) {
				if (input.charCodeAt(peg$currPos) === 44) {
					s2 = peg$c1;
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e2);
				}
				if (s2 !== peg$FAILED) {
					s3 = peg$parsespec_list();
					if (s3 !== peg$FAILED) s0 = peg$f8(s1, s3);
					else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsemodel_list() {
			let s0, s1, s2, s3;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parsecore_model();
			if (s1 !== peg$FAILED) {
				if (input.charCodeAt(peg$currPos) === 58) {
					s2 = peg$c2;
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e4);
				}
				if (s2 !== peg$FAILED) {
					s3 = peg$parsemodel_list_tail();
					if (s3 !== peg$FAILED) s0 = peg$f9(s1, s3);
					else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$parsemodel_list_tail();
				if (s1 !== peg$FAILED) s1 = peg$f10(s1);
				s0 = s1;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			return s0;
		}
		function peg$parsemodel_list_tail() {
			let s0, s1, s2, s3, s4, s5;
			s0 = peg$currPos;
			s1 = peg$parsemodel();
			if (s1 !== peg$FAILED) {
				s2 = [];
				s3 = peg$currPos;
				if (input.charCodeAt(peg$currPos) === 47) {
					s4 = peg$c3;
					peg$currPos++;
				} else {
					s4 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e5);
				}
				if (s4 !== peg$FAILED) {
					s5 = peg$parsemodel();
					if (s5 !== peg$FAILED) s3 = peg$f11(s1, s5);
					else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				} else {
					peg$currPos = s3;
					s3 = peg$FAILED;
				}
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$currPos;
					if (input.charCodeAt(peg$currPos) === 47) {
						s4 = peg$c3;
						peg$currPos++;
					} else {
						s4 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e5);
					}
					if (s4 !== peg$FAILED) {
						s5 = peg$parsemodel();
						if (s5 !== peg$FAILED) s3 = peg$f11(s1, s5);
						else {
							peg$currPos = s3;
							s3 = peg$FAILED;
						}
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				}
				s0 = peg$f12(s1, s2);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsemodel() {
			let s0;
			peg$silentFails++;
			s0 = peg$parsecore_model();
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				if (peg$silentFails === 0) peg$fail(peg$e6);
			}
			return s0;
		}
		function peg$parsespec_list() {
			let s0, s1, s2, s3, s4, s5;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parsespec();
			if (s1 !== peg$FAILED) {
				s2 = [];
				s3 = peg$currPos;
				if (input.charCodeAt(peg$currPos) === 47) {
					s4 = peg$c3;
					peg$currPos++;
				} else {
					s4 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e5);
				}
				if (s4 !== peg$FAILED) {
					s5 = peg$parsespec();
					if (s5 !== peg$FAILED) s3 = peg$f13(s1, s5);
					else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				} else {
					peg$currPos = s3;
					s3 = peg$FAILED;
				}
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$currPos;
					if (input.charCodeAt(peg$currPos) === 47) {
						s4 = peg$c3;
						peg$currPos++;
					} else {
						s4 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e5);
					}
					if (s4 !== peg$FAILED) {
						s5 = peg$parsespec();
						if (s5 !== peg$FAILED) s3 = peg$f13(s1, s5);
						else {
							peg$currPos = s3;
							s3 = peg$FAILED;
						}
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
				}
				s0 = peg$f14(s1, s2);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e7);
			}
			return s0;
		}
		function peg$parsespec() {
			let s0, s1, s2, s3, s4, s5, s6, s7, s8;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$currPos;
			s2 = peg$currPos;
			s3 = peg$parsehex();
			if (s3 !== peg$FAILED) {
				s4 = peg$parsehex();
				if (s4 !== peg$FAILED) {
					s5 = peg$parsehex();
					if (s5 !== peg$FAILED) {
						s6 = peg$parsehex();
						if (s6 !== peg$FAILED) {
							s7 = peg$parsehex();
							if (s7 !== peg$FAILED) {
								s8 = peg$parsehex();
								if (s8 !== peg$FAILED) {
									s3 = [
										s3,
										s4,
										s5,
										s6,
										s7,
										s8
									];
									s2 = s3;
								} else {
									peg$currPos = s2;
									s2 = peg$FAILED;
								}
							} else {
								peg$currPos = s2;
								s2 = peg$FAILED;
							}
						} else {
							peg$currPos = s2;
							s2 = peg$FAILED;
						}
					} else {
						peg$currPos = s2;
						s2 = peg$FAILED;
					}
				} else {
					peg$currPos = s2;
					s2 = peg$FAILED;
				}
			} else {
				peg$currPos = s2;
				s2 = peg$FAILED;
			}
			if (s2 !== peg$FAILED) s1 = input.substring(s1, peg$currPos);
			else s1 = s2;
			if (s1 !== peg$FAILED) s1 = peg$f15(s1);
			s0 = s1;
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$parsedec();
				if (s1 !== peg$FAILED) {
					s2 = [];
					s3 = peg$currPos;
					if (input.charCodeAt(peg$currPos) === 44) {
						s4 = peg$c1;
						peg$currPos++;
					} else {
						s4 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e2);
					}
					if (s4 !== peg$FAILED) {
						s5 = peg$parsedec();
						if (s5 !== peg$FAILED) s3 = peg$f16(s1, s5);
						else {
							peg$currPos = s3;
							s3 = peg$FAILED;
						}
					} else {
						peg$currPos = s3;
						s3 = peg$FAILED;
					}
					if (s3 !== peg$FAILED) while (s3 !== peg$FAILED) {
						s2.push(s3);
						s3 = peg$currPos;
						if (input.charCodeAt(peg$currPos) === 44) {
							s4 = peg$c1;
							peg$currPos++;
						} else {
							s4 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e2);
						}
						if (s4 !== peg$FAILED) {
							s5 = peg$parsedec();
							if (s5 !== peg$FAILED) s3 = peg$f16(s1, s5);
							else {
								peg$currPos = s3;
								s3 = peg$FAILED;
							}
						} else {
							peg$currPos = s3;
							s3 = peg$FAILED;
						}
					}
					else s2 = peg$FAILED;
					if (s2 === peg$FAILED) {
						s2 = [];
						s3 = peg$currPos;
						s4 = peg$parsesp();
						if (s4 !== peg$FAILED) {
							s5 = peg$parsedec();
							if (s5 !== peg$FAILED) s3 = peg$f17(s1, s5);
							else {
								peg$currPos = s3;
								s3 = peg$FAILED;
							}
						} else {
							peg$currPos = s3;
							s3 = peg$FAILED;
						}
						if (s3 !== peg$FAILED) while (s3 !== peg$FAILED) {
							s2.push(s3);
							s3 = peg$currPos;
							s4 = peg$parsesp();
							if (s4 !== peg$FAILED) {
								s5 = peg$parsedec();
								if (s5 !== peg$FAILED) s3 = peg$f17(s1, s5);
								else {
									peg$currPos = s3;
									s3 = peg$FAILED;
								}
							} else {
								peg$currPos = s3;
								s3 = peg$FAILED;
							}
						}
						else s2 = peg$FAILED;
					}
					if (s2 === peg$FAILED) s2 = null;
					s0 = peg$f18(s1, s2);
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e8);
			}
			return s0;
		}
		function peg$parsecolor() {
			let s0, s1, s2, s3;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parsecolor_expr();
			if (s1 !== peg$FAILED) {
				s2 = [];
				s3 = peg$parsefunc_expr();
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$parsefunc_expr();
				}
				s0 = peg$f19(s1, s2);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e9);
			}
			return s0;
		}
		function peg$parsecolor_expr() {
			let s0;
			s0 = peg$parseext_expr();
			if (s0 === peg$FAILED) {
				s0 = peg$parseexpr();
				if (s0 === peg$FAILED) s0 = peg$parsename();
			}
			return s0;
		}
		function peg$parsefunc_expr() {
			let s0, s1, s2, s3, s4, s5, s6;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 62) {
				s1 = peg$c4;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e11);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$parsefunction();
				if (s2 !== peg$FAILED) {
					s3 = [];
					s4 = peg$currPos;
					if (input.charCodeAt(peg$currPos) === 44) {
						s5 = peg$c1;
						peg$currPos++;
					} else {
						s5 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e2);
					}
					if (s5 !== peg$FAILED) {
						s6 = peg$parseint();
						if (s6 !== peg$FAILED) s4 = peg$f20(s2, s6);
						else {
							peg$currPos = s4;
							s4 = peg$FAILED;
						}
					} else {
						peg$currPos = s4;
						s4 = peg$FAILED;
					}
					while (s4 !== peg$FAILED) {
						s3.push(s4);
						s4 = peg$currPos;
						if (input.charCodeAt(peg$currPos) === 44) {
							s5 = peg$c1;
							peg$currPos++;
						} else {
							s5 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e2);
						}
						if (s5 !== peg$FAILED) {
							s6 = peg$parseint();
							if (s6 !== peg$FAILED) s4 = peg$f20(s2, s6);
							else {
								peg$currPos = s4;
								s4 = peg$FAILED;
							}
						} else {
							peg$currPos = s4;
							s4 = peg$FAILED;
						}
					}
					s0 = peg$f21(s2, s3);
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e10);
			}
			return s0;
		}
		function peg$parsefunction() {
			let s0;
			peg$silentFails++;
			s0 = peg$parsename();
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				if (peg$silentFails === 0) peg$fail(peg$e12);
			}
			return s0;
		}
		function peg$parseext_expr() {
			let s0, s1, s2, s3, s4, s5, s6, s7;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parsecore_model();
			if (s1 !== peg$FAILED) {
				if (input.charCodeAt(peg$currPos) === 44) {
					s2 = peg$c1;
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e2);
				}
				if (s2 !== peg$FAILED) {
					s3 = peg$parsediv();
					if (s3 !== peg$FAILED) {
						if (input.charCodeAt(peg$currPos) === 58) {
							s4 = peg$c2;
							peg$currPos++;
						} else {
							s4 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e4);
						}
						if (s4 !== peg$FAILED) {
							s5 = peg$parseweighted_expr();
							if (s5 !== peg$FAILED) {
								s6 = [];
								s7 = peg$parseadditional_weighted_expr();
								while (s7 !== peg$FAILED) {
									s6.push(s7);
									s7 = peg$parseadditional_weighted_expr();
								}
								s0 = peg$f22(s1, s3, s5, s6);
							} else {
								peg$currPos = s0;
								s0 = peg$FAILED;
							}
						} else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$parsecore_model();
				if (s1 !== peg$FAILED) {
					if (input.charCodeAt(peg$currPos) === 58) {
						s2 = peg$c2;
						peg$currPos++;
					} else {
						s2 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e4);
					}
					if (s2 !== peg$FAILED) {
						s3 = peg$parseweighted_expr();
						if (s3 !== peg$FAILED) {
							s4 = [];
							s5 = peg$parseadditional_weighted_expr();
							while (s5 !== peg$FAILED) {
								s4.push(s5);
								s5 = peg$parseadditional_weighted_expr();
							}
							s0 = peg$f23(s1, s3, s4);
						} else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e13);
			}
			return s0;
		}
		function peg$parseweighted_expr() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			s1 = peg$parseexpr();
			if (s1 !== peg$FAILED) {
				if (input.charCodeAt(peg$currPos) === 44) {
					s2 = peg$c1;
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e2);
				}
				if (s2 !== peg$FAILED) {
					s3 = peg$parsedec();
					if (s3 !== peg$FAILED) s0 = peg$f24(s1, s3);
					else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseadditional_weighted_expr() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 59) {
				s1 = peg$c0;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$parseweighted_expr();
				if (s2 !== peg$FAILED) s0 = peg$f25(s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsecore_model() {
			let s0;
			peg$silentFails++;
			s0 = peg$parsename();
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				if (peg$silentFails === 0) peg$fail(peg$e14);
			}
			return s0;
		}
		function peg$parseexpr() {
			let s0, s1, s2, s3, s4;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parseprefix();
			s2 = peg$parsename();
			if (s2 !== peg$FAILED) {
				s3 = peg$parsemix_expr();
				s4 = peg$parsepostfix();
				if (s4 === peg$FAILED) s4 = null;
				s0 = peg$f26(s1, s2, s3, s4);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e15);
			}
			return s0;
		}
		function peg$parsecomplete_mix() {
			let s0, s1, s2, s3, s4;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 33) {
				s1 = peg$c5;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e16);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$parsepct();
				if (s2 !== peg$FAILED) {
					if (input.charCodeAt(peg$currPos) === 33) {
						s3 = peg$c5;
						peg$currPos++;
					} else {
						s3 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e16);
					}
					if (s3 !== peg$FAILED) {
						s4 = peg$parsename();
						if (s4 !== peg$FAILED) s0 = peg$f27(s2, s4);
						else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsepartial_mix() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.charCodeAt(peg$currPos) === 33) {
				s1 = peg$c5;
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e16);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$parsepct();
				if (s2 !== peg$FAILED) s0 = peg$f28(s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsemix_expr() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parsecomplete_mix();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parsecomplete_mix();
			}
			s2 = peg$parsepartial_mix();
			if (s2 === peg$FAILED) s2 = null;
			s0 = peg$f29(s1, s2);
			peg$silentFails--;
			return s0;
		}
		function peg$parsename() {
			let s0, s1, s2;
			peg$silentFails++;
			if (input.charCodeAt(peg$currPos) === 46) {
				s0 = peg$c6;
				peg$currPos++;
			} else {
				s0 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e18);
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = [];
				s2 = input.charAt(peg$currPos);
				if (peg$r0.test(s2)) peg$currPos++;
				else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e19);
				}
				if (s2 !== peg$FAILED) while (s2 !== peg$FAILED) {
					s1.push(s2);
					s2 = input.charAt(peg$currPos);
					if (peg$r0.test(s2)) peg$currPos++;
					else {
						s2 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e19);
					}
				}
				else s1 = peg$FAILED;
				if (s1 !== peg$FAILED) s0 = input.substring(s0, peg$currPos);
				else s0 = s1;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e17);
			}
			return s0;
		}
		function peg$parsepostfix() {
			let s0, s1, s2, s3, s4;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.substr(peg$currPos, 3) === peg$c7) {
				s1 = peg$c7;
				peg$currPos += 3;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e21);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$parsenum();
				if (s2 !== peg$FAILED) {
					if (input.charCodeAt(peg$currPos) === 93) {
						s3 = peg$c8;
						peg$currPos++;
					} else {
						s3 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e22);
					}
					if (s3 !== peg$FAILED) s0 = peg$f30(s2);
					else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				if (input.substr(peg$currPos, 2) === peg$c9) {
					s1 = peg$c9;
					peg$currPos += 2;
				} else {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e23);
				}
				if (s1 !== peg$FAILED) {
					s2 = peg$currPos;
					s3 = [];
					s4 = peg$parseplus();
					if (s4 !== peg$FAILED) while (s4 !== peg$FAILED) {
						s3.push(s4);
						s4 = peg$parseplus();
					}
					else s3 = peg$FAILED;
					if (s3 !== peg$FAILED) s2 = input.substring(s2, peg$currPos);
					else s2 = s3;
					if (s2 !== peg$FAILED) s0 = peg$f31(s2);
					else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e20);
			}
			return s0;
		}
		function peg$parseprefix() {
			let s0;
			peg$silentFails++;
			s0 = peg$parseminus();
			if (s0 === peg$FAILED) s0 = null;
			peg$silentFails--;
			return s0;
		}
		function peg$parseplus() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = [];
			if (input.charCodeAt(peg$currPos) === 43) {
				s2 = peg$c10;
				peg$currPos++;
			} else {
				s2 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e25);
			}
			if (s2 !== peg$FAILED) while (s2 !== peg$FAILED) {
				s1.push(s2);
				if (input.charCodeAt(peg$currPos) === 43) {
					s2 = peg$c10;
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e25);
				}
			}
			else s1 = peg$FAILED;
			if (s1 !== peg$FAILED) s0 = input.substring(s0, peg$currPos);
			else s0 = s1;
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e24);
			}
			return s0;
		}
		function peg$parseminus() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = [];
			if (input.charCodeAt(peg$currPos) === 45) {
				s2 = peg$c11;
				peg$currPos++;
			} else {
				s2 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e27);
			}
			if (s2 !== peg$FAILED) while (s2 !== peg$FAILED) {
				s1.push(s2);
				if (input.charCodeAt(peg$currPos) === 45) {
					s2 = peg$c11;
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e27);
				}
			}
			else s1 = peg$FAILED;
			if (s1 !== peg$FAILED) s0 = input.substring(s0, peg$currPos);
			else s0 = s1;
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e26);
			}
			return s0;
		}
		function peg$parsenum() {
			let s0, s1, s2, s3;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$currPos;
			s2 = [];
			s3 = input.charAt(peg$currPos);
			if (peg$r1.test(s3)) peg$currPos++;
			else {
				s3 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e29);
			}
			if (s3 !== peg$FAILED) while (s3 !== peg$FAILED) {
				s2.push(s3);
				s3 = input.charAt(peg$currPos);
				if (peg$r1.test(s3)) peg$currPos++;
				else {
					s3 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e29);
				}
			}
			else s2 = peg$FAILED;
			if (s2 !== peg$FAILED) s1 = input.substring(s1, peg$currPos);
			else s1 = s2;
			if (s1 !== peg$FAILED) s1 = peg$f32(s1);
			s0 = s1;
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e28);
			}
			return s0;
		}
		function peg$parsepct() {
			let s0, s1, s2, s3, s4, s5, s6, s7, s8, s9;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$currPos;
			s2 = peg$currPos;
			s3 = peg$currPos;
			s4 = [];
			s5 = input.charAt(peg$currPos);
			if (peg$r1.test(s5)) peg$currPos++;
			else {
				s5 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e29);
			}
			if (s5 !== peg$FAILED) while (s5 !== peg$FAILED) {
				s4.push(s5);
				s5 = input.charAt(peg$currPos);
				if (peg$r1.test(s5)) peg$currPos++;
				else {
					s5 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e29);
				}
			}
			else s4 = peg$FAILED;
			if (s4 !== peg$FAILED) s3 = input.substring(s3, peg$currPos);
			else s3 = s4;
			if (s3 !== peg$FAILED) {
				s4 = peg$currPos;
				s5 = peg$currPos;
				if (input.charCodeAt(peg$currPos) === 46) {
					s6 = peg$c6;
					peg$currPos++;
				} else {
					s6 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e18);
				}
				if (s6 !== peg$FAILED) {
					s7 = peg$currPos;
					s8 = [];
					s9 = input.charAt(peg$currPos);
					if (peg$r1.test(s9)) peg$currPos++;
					else {
						s9 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e29);
					}
					while (s9 !== peg$FAILED) {
						s8.push(s9);
						s9 = input.charAt(peg$currPos);
						if (peg$r1.test(s9)) peg$currPos++;
						else {
							s9 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e29);
						}
					}
					s7 = input.substring(s7, peg$currPos);
					s6 = [s6, s7];
					s5 = s6;
				} else {
					peg$currPos = s5;
					s5 = peg$FAILED;
				}
				if (s5 === peg$FAILED) s5 = null;
				s4 = input.substring(s4, peg$currPos);
				s3 = [s3, s4];
				s2 = s3;
			} else {
				peg$currPos = s2;
				s2 = peg$FAILED;
			}
			if (s2 !== peg$FAILED) s1 = input.substring(s1, peg$currPos);
			else s1 = s2;
			if (s1 === peg$FAILED) {
				s1 = peg$currPos;
				s2 = peg$currPos;
				if (input.charCodeAt(peg$currPos) === 46) {
					s3 = peg$c6;
					peg$currPos++;
				} else {
					s3 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e18);
				}
				if (s3 !== peg$FAILED) {
					s4 = peg$currPos;
					s5 = [];
					s6 = input.charAt(peg$currPos);
					if (peg$r1.test(s6)) peg$currPos++;
					else {
						s6 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e29);
					}
					if (s6 !== peg$FAILED) while (s6 !== peg$FAILED) {
						s5.push(s6);
						s6 = input.charAt(peg$currPos);
						if (peg$r1.test(s6)) peg$currPos++;
						else {
							s6 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e29);
						}
					}
					else s5 = peg$FAILED;
					if (s5 !== peg$FAILED) s4 = input.substring(s4, peg$currPos);
					else s4 = s5;
					if (s4 !== peg$FAILED) {
						s3 = [s3, s4];
						s2 = s3;
					} else {
						peg$currPos = s2;
						s2 = peg$FAILED;
					}
				} else {
					peg$currPos = s2;
					s2 = peg$FAILED;
				}
				if (s2 !== peg$FAILED) s1 = input.substring(s1, peg$currPos);
				else s1 = s2;
			}
			if (s1 !== peg$FAILED) s1 = peg$f33(s1);
			s0 = s1;
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e30);
			}
			return s0;
		}
		function peg$parsediv() {
			let s0;
			peg$silentFails++;
			s0 = peg$parsepct();
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				if (peg$silentFails === 0) peg$fail(peg$e31);
			}
			return s0;
		}
		function peg$parsedec() {
			let s0, s1, s2;
			s0 = peg$parsepct();
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				if (input.charCodeAt(peg$currPos) === 43) {
					s1 = peg$c10;
					peg$currPos++;
				} else {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e25);
				}
				if (s1 !== peg$FAILED) {
					s2 = peg$parsepct();
					if (s2 !== peg$FAILED) s0 = peg$f34(s2);
					else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
				if (s0 === peg$FAILED) {
					s0 = peg$currPos;
					if (input.charCodeAt(peg$currPos) === 45) {
						s1 = peg$c11;
						peg$currPos++;
					} else {
						s1 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e27);
					}
					if (s1 !== peg$FAILED) {
						s2 = peg$parsepct();
						if (s2 !== peg$FAILED) s0 = peg$f35(s2);
						else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				}
			}
			return s0;
		}
		function peg$parseint() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parseminus();
			if (s1 === peg$FAILED) s1 = null;
			s2 = peg$parsenum();
			if (s2 !== peg$FAILED) s0 = peg$f36(s1, s2);
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e32);
			}
			return s0;
		}
		function peg$parsesp() {
			let s0, s1;
			s0 = [];
			s1 = input.charAt(peg$currPos);
			if (peg$r2.test(s1)) peg$currPos++;
			else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e33);
			}
			if (s1 !== peg$FAILED) while (s1 !== peg$FAILED) {
				s0.push(s1);
				s1 = input.charAt(peg$currPos);
				if (peg$r2.test(s1)) peg$currPos++;
				else {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e33);
				}
			}
			else s0 = peg$FAILED;
			return s0;
		}
		function peg$parsehex() {
			let s0, s1;
			s0 = peg$currPos;
			s1 = input.charAt(peg$currPos);
			if (peg$r3.test(s1)) peg$currPos++;
			else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e34);
			}
			if (s1 !== peg$FAILED) s1 = peg$f37(s1);
			s0 = s1;
			return s0;
		}
		function peg$parseEOL() {
			let s0, s1;
			s0 = peg$currPos;
			peg$silentFails++;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			peg$silentFails--;
			if (s1 === peg$FAILED) s0 = void 0;
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		peg$result = peg$startRuleFunction();
		const peg$success = peg$result !== peg$FAILED && peg$currPos === input.length;
		function peg$throw() {
			if (peg$result !== peg$FAILED && peg$currPos < input.length) peg$fail(peg$endExpectation());
			throw peg$buildStructuredError(peg$maxFailExpected, peg$maxFailPos < input.length ? peg$getUnicode(peg$maxFailPos) : null, peg$maxFailPos < input.length ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1) : peg$computeLocation(peg$maxFailPos, peg$maxFailPos));
		}
		if (options.peg$library) return (
		/** @type {any} */
		{
			peg$result,
			peg$currPos,
			peg$FAILED,
			peg$maxFailExpected,
			peg$maxFailPos,
			peg$success,
			peg$throw: peg$success ? void 0 : peg$throw
		});
		if (peg$success) return peg$result;
		else peg$throw();
	}
	return {
		StartRules: ["start"],
		SyntaxError: peg$SyntaxError,
		parse: peg$parse
	};
})();
//#endregion
//#region grammars/tabular-spec.pegjs
var tabular_spec_default = (function() {
	"use strict";
	class peg$SyntaxError extends SyntaxError {
		constructor(message, expected, found, location) {
			super(message);
			this.expected = expected;
			this.found = found;
			this.location = location;
			this.name = "SyntaxError";
		}
		format(sources) {
			let str = "Error: " + this.message;
			if (this.location) {
				let src = null;
				const st = sources.find((s2) => s2.source === this.location.source);
				if (st) src = st.text.split(/\r\n|\n|\r/g);
				const s = this.location.start;
				const offset_s = this.location.source && typeof this.location.source.offset === "function" ? this.location.source.offset(s) : s;
				const loc = this.location.source + ":" + offset_s.line + ":" + offset_s.column;
				if (src) {
					const e = this.location.end;
					const filler = "".padEnd(offset_s.line.toString().length, " ");
					const line = src[s.line - 1];
					const hatLen = (s.line === e.line ? e.column : line.length + 1) - s.column || 1;
					str += "\n --> " + loc + "\n" + filler + " |\n" + offset_s.line + " | " + line + "\n" + filler + " | " + "".padEnd(s.column - 1, " ") + "".padEnd(hatLen, "^");
				} else str += "\n at " + loc;
			}
			return str;
		}
		static buildMessage(expected, found) {
			function hex(ch) {
				return ch.codePointAt(0).toString(16).toUpperCase();
			}
			const nonPrintable = Object.prototype.hasOwnProperty.call(RegExp.prototype, "unicode") ? /* @__PURE__ */ new RegExp("[\\p{C}\\p{Mn}\\p{Mc}]", "gu") : null;
			function unicodeEscape(s) {
				if (nonPrintable) return s.replace(nonPrintable, (ch) => "\\u{" + hex(ch) + "}");
				return s;
			}
			function literalEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			function classEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^").replace(/-/g, "\\-").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			const DESCRIBE_EXPECTATION_FNS = {
				literal(expectation) {
					return "\"" + literalEscape(expectation.text) + "\"";
				},
				class(expectation) {
					const escapedParts = expectation.parts.map((part) => Array.isArray(part) ? classEscape(part[0]) + "-" + classEscape(part[1]) : classEscape(part));
					return "[" + (expectation.inverted ? "^" : "") + escapedParts.join("") + "]" + (expectation.unicode ? "u" : "");
				},
				any() {
					return "any character";
				},
				end() {
					return "end of input";
				},
				other(expectation) {
					return expectation.description;
				}
			};
			function describeExpectation(expectation) {
				return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
			}
			function describeExpected(expected2) {
				const descriptions = expected2.map(describeExpectation);
				descriptions.sort();
				if (descriptions.length > 0) {
					let j = 1;
					for (let i = 1; i < descriptions.length; i++) if (descriptions[i - 1] !== descriptions[i]) {
						descriptions[j] = descriptions[i];
						j++;
					}
					descriptions.length = j;
				}
				switch (descriptions.length) {
					case 1: return descriptions[0];
					case 2: return descriptions[0] + " or " + descriptions[1];
					default: return descriptions.slice(0, -1).join(", ") + ", or " + descriptions[descriptions.length - 1];
				}
			}
			function describeFound(found2) {
				return found2 ? "\"" + literalEscape(found2) + "\"" : "end of input";
			}
			return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
		}
	}
	function peg$parse(input, options) {
		options = options !== void 0 ? options : {};
		const peg$FAILED = {};
		const peg$source = options.grammarSource;
		const peg$startRuleFunctions = { body: peg$parsebody };
		let peg$startRuleFunction = peg$parsebody;
		const peg$e0 = peg$otherExpectation("decl_start");
		const peg$e1 = peg$otherExpectation("decl_end");
		const peg$e2 = peg$otherExpectation("vert");
		const peg$e3 = peg$anyExpectation();
		const peg$e4 = peg$otherExpectation("l");
		const peg$e5 = peg$otherExpectation("r");
		const peg$e6 = peg$otherExpectation("c");
		const peg$e7 = peg$otherExpectation("p");
		const peg$e8 = peg$otherExpectation("m");
		const peg$e9 = peg$otherExpectation("b");
		const peg$e10 = peg$otherExpectation("w");
		const peg$e11 = peg$otherExpectation("W");
		const peg$e12 = peg$otherExpectation("X");
		const peg$e13 = peg$otherExpectation("!");
		const peg$e14 = peg$otherExpectation("@");
		const peg$e15 = peg$otherExpectation("<");
		const peg$e16 = peg$otherExpectation(">");
		const peg$e17 = peg$otherExpectation("group");
		const peg$e18 = peg$otherExpectation("whitespace");
		function peg$f0(c) {
			return c;
		}
		function peg$f1(cols) {
			return cols;
		}
		function peg$f2() {
			return [];
		}
		function peg$f3(divs1, start, a, end, divs2) {
			return {
				type: "column",
				pre_dividers: divs1,
				post_dividers: divs2,
				before_start_code: start,
				before_end_code: end,
				alignment: a
			};
		}
		function peg$f4() {
			return { type: "vert_divider" };
		}
		function peg$f5(b, g) {
			return {
				type: "bang_divider",
				content: g[0].content
			};
		}
		function peg$f6(g) {
			return {
				type: "at_divider",
				content: g[0].content
			};
		}
		function peg$f7(div) {
			return div;
		}
		function peg$f8(g) {
			return {
				type: "decl_code",
				code: g[0].content
			};
		}
		function peg$f9(g) {
			return {
				type: "decl_code",
				code: g[0].content
			};
		}
		function peg$f10() {
			return {
				type: "alignment",
				alignment: "left"
			};
		}
		function peg$f11() {
			return {
				type: "alignment",
				alignment: "center"
			};
		}
		function peg$f12() {
			return {
				type: "alignment",
				alignment: "right"
			};
		}
		function peg$f13() {
			return {
				type: "alignment",
				alignment: "X"
			};
		}
		function peg$f14() {
			return "top";
		}
		function peg$f15() {
			return "default";
		}
		function peg$f16() {
			return "bottom";
		}
		function peg$f17(a, g) {
			return {
				type: "alignment",
				alignment: "parbox",
				baseline: a,
				size: g[0].content
			};
		}
		function peg$f18(g1, g2) {
			return {
				type: "alignment",
				alignment: "parbox",
				baseline: g1[0].content,
				size: g2[0].content
			};
		}
		function peg$f19(tok) {
			return options.matchChar(tok, "|");
		}
		function peg$f20(tok) {
			return options.matchChar(tok, "l");
		}
		function peg$f21(tok) {
			return options.matchChar(tok, "r");
		}
		function peg$f22(tok) {
			return options.matchChar(tok, "c");
		}
		function peg$f23(tok) {
			return options.matchChar(tok, "p");
		}
		function peg$f24(tok) {
			return options.matchChar(tok, "m");
		}
		function peg$f25(tok) {
			return options.matchChar(tok, "b");
		}
		function peg$f26(tok) {
			return options.matchChar(tok, "w");
		}
		function peg$f27(tok) {
			return options.matchChar(tok, "W");
		}
		function peg$f28(tok) {
			return options.matchChar(tok, "X");
		}
		function peg$f29(tok) {
			return options.matchChar(tok, "!");
		}
		function peg$f30(tok) {
			return options.matchChar(tok, "@");
		}
		function peg$f31(tok) {
			return options.matchChar(tok, "<");
		}
		function peg$f32(tok) {
			return options.matchChar(tok, ">");
		}
		function peg$f33(tok) {
			return options.isGroup(tok);
		}
		function peg$f34(tok) {
			return options.isWhitespace(tok);
		}
		let peg$currPos = options.peg$currPos | 0;
		const peg$posDetailsCache = [{
			line: 1,
			column: 1
		}];
		let peg$maxFailPos = peg$currPos;
		let peg$maxFailExpected = options.peg$maxFailExpected || [];
		let peg$silentFails = options.peg$silentFails | 0;
		let peg$result;
		if (options.startRule) {
			if (!(options.startRule in peg$startRuleFunctions)) throw new Error(`Can't start parsing from rule "` + options.startRule + "\".");
			peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
		}
		function peg$getUnicode(pos = peg$currPos) {
			const cp = input.codePointAt(pos);
			if (cp === void 0) return "";
			return String.fromCodePoint(cp);
		}
		function peg$anyExpectation() {
			return { type: "any" };
		}
		function peg$endExpectation() {
			return { type: "end" };
		}
		function peg$otherExpectation(description) {
			return {
				type: "other",
				description
			};
		}
		function peg$computePosDetails(pos) {
			let details = peg$posDetailsCache[pos];
			let p;
			if (details) return details;
			else {
				if (pos >= peg$posDetailsCache.length) p = peg$posDetailsCache.length - 1;
				else {
					p = pos;
					while (!peg$posDetailsCache[--p]);
				}
				details = peg$posDetailsCache[p];
				details = {
					line: details.line,
					column: details.column
				};
				while (p < pos) {
					if (input.charCodeAt(p) === 10) {
						details.line++;
						details.column = 1;
					} else details.column++;
					p++;
				}
				peg$posDetailsCache[pos] = details;
				return details;
			}
		}
		function peg$computeLocation(startPos, endPos, offset2) {
			const startPosDetails = peg$computePosDetails(startPos);
			const endPosDetails = peg$computePosDetails(endPos);
			const res = {
				source: peg$source,
				start: {
					offset: startPos,
					line: startPosDetails.line,
					column: startPosDetails.column
				},
				end: {
					offset: endPos,
					line: endPosDetails.line,
					column: endPosDetails.column
				}
			};
			if (offset2 && peg$source && typeof peg$source.offset === "function") {
				res.start = peg$source.offset(res.start);
				res.end = peg$source.offset(res.end);
			}
			return res;
		}
		function peg$fail(expected2) {
			if (peg$currPos < peg$maxFailPos) return;
			if (peg$currPos > peg$maxFailPos) {
				peg$maxFailPos = peg$currPos;
				peg$maxFailExpected = [];
			}
			peg$maxFailExpected.push(expected2);
		}
		function peg$buildStructuredError(expected2, found, location2) {
			return new peg$SyntaxError(peg$SyntaxError.buildMessage(expected2, found), expected2, found, location2);
		}
		function peg$parsebody() {
			let s0, s1, s2, s3, s4, s5;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$currPos;
			s3 = peg$parsecolumn();
			if (s3 !== peg$FAILED) {
				s4 = [];
				s5 = peg$parse_();
				while (s5 !== peg$FAILED) {
					s4.push(s5);
					s5 = peg$parse_();
				}
				s2 = peg$f0(s3);
			} else {
				peg$currPos = s2;
				s2 = peg$FAILED;
			}
			if (s2 !== peg$FAILED) while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$currPos;
				s3 = peg$parsecolumn();
				if (s3 !== peg$FAILED) {
					s4 = [];
					s5 = peg$parse_();
					while (s5 !== peg$FAILED) {
						s4.push(s5);
						s5 = peg$parse_();
					}
					s2 = peg$f0(s3);
				} else {
					peg$currPos = s2;
					s2 = peg$FAILED;
				}
			}
			else s1 = peg$FAILED;
			if (s1 !== peg$FAILED) s1 = peg$f1(s1);
			s0 = s1;
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$parseEOL();
				if (s1 !== peg$FAILED) s1 = peg$f2();
				s0 = s1;
			}
			return s0;
		}
		function peg$parsecolumn() {
			let s0, s1, s2, s3, s4, s5, s6;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parsecolumn_divider();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parsecolumn_divider();
			}
			s2 = peg$parsedecl_start();
			if (s2 === peg$FAILED) s2 = null;
			s3 = peg$parsealignment();
			if (s3 !== peg$FAILED) {
				s4 = peg$parsedecl_end();
				if (s4 === peg$FAILED) s4 = null;
				s5 = [];
				s6 = peg$parsecolumn_divider();
				while (s6 !== peg$FAILED) {
					s5.push(s6);
					s6 = peg$parsecolumn_divider();
				}
				s0 = peg$f3(s1, s2, s3, s4, s5);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsecolumn_divider() {
			let s0, s1, s2, s3, s4;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parse_();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parse_();
			}
			s2 = peg$currPos;
			s3 = peg$parsevert();
			if (s3 !== peg$FAILED) s3 = peg$f4();
			s2 = s3;
			if (s2 === peg$FAILED) {
				s2 = peg$currPos;
				s3 = peg$parsebang();
				if (s3 !== peg$FAILED) {
					s4 = peg$parsegroup();
					if (s4 !== peg$FAILED) s2 = peg$f5(s3, s4);
					else {
						peg$currPos = s2;
						s2 = peg$FAILED;
					}
				} else {
					peg$currPos = s2;
					s2 = peg$FAILED;
				}
				if (s2 === peg$FAILED) {
					s2 = peg$currPos;
					s3 = peg$parseat();
					if (s3 !== peg$FAILED) {
						s4 = peg$parsegroup();
						if (s4 !== peg$FAILED) s2 = peg$f6(s4);
						else {
							peg$currPos = s2;
							s2 = peg$FAILED;
						}
					} else {
						peg$currPos = s2;
						s2 = peg$FAILED;
					}
				}
			}
			if (s2 !== peg$FAILED) {
				s3 = [];
				s4 = peg$parse_();
				while (s4 !== peg$FAILED) {
					s3.push(s4);
					s4 = peg$parse_();
				}
				s0 = peg$f7(s2);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsedecl_start() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parsegreater();
			if (s1 !== peg$FAILED) {
				s2 = peg$parsegroup();
				if (s2 !== peg$FAILED) s0 = peg$f8(s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			return s0;
		}
		function peg$parsedecl_end() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parseless();
			if (s1 !== peg$FAILED) {
				s2 = peg$parsegroup();
				if (s2 !== peg$FAILED) s0 = peg$f9(s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			return s0;
		}
		function peg$parsealignment() {
			let s0, s1, s2, s3, s4, s5;
			s0 = peg$currPos;
			s1 = peg$parsel();
			if (s1 !== peg$FAILED) s1 = peg$f10();
			s0 = s1;
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$parsec();
				if (s1 !== peg$FAILED) s1 = peg$f11();
				s0 = s1;
				if (s0 === peg$FAILED) {
					s0 = peg$currPos;
					s1 = peg$parser();
					if (s1 !== peg$FAILED) s1 = peg$f12();
					s0 = s1;
					if (s0 === peg$FAILED) {
						s0 = peg$currPos;
						s1 = peg$parseX();
						if (s1 !== peg$FAILED) s1 = peg$f13();
						s0 = s1;
						if (s0 === peg$FAILED) {
							s0 = peg$currPos;
							s1 = peg$currPos;
							s2 = peg$parsep();
							if (s2 !== peg$FAILED) s2 = peg$f14();
							s1 = s2;
							if (s1 === peg$FAILED) {
								s1 = peg$currPos;
								s2 = peg$parsem();
								if (s2 !== peg$FAILED) s2 = peg$f15();
								s1 = s2;
								if (s1 === peg$FAILED) {
									s1 = peg$currPos;
									s2 = peg$parseb();
									if (s2 !== peg$FAILED) s2 = peg$f16();
									s1 = s2;
								}
							}
							if (s1 !== peg$FAILED) {
								s2 = [];
								s3 = peg$parse_();
								while (s3 !== peg$FAILED) {
									s2.push(s3);
									s3 = peg$parse_();
								}
								s3 = peg$parsegroup();
								if (s3 !== peg$FAILED) s0 = peg$f17(s1, s3);
								else {
									peg$currPos = s0;
									s0 = peg$FAILED;
								}
							} else {
								peg$currPos = s0;
								s0 = peg$FAILED;
							}
							if (s0 === peg$FAILED) {
								s0 = peg$currPos;
								s1 = peg$parsew();
								if (s1 === peg$FAILED) s1 = peg$parseW();
								if (s1 !== peg$FAILED) {
									s2 = [];
									s3 = peg$parse_();
									while (s3 !== peg$FAILED) {
										s2.push(s3);
										s3 = peg$parse_();
									}
									s3 = peg$parsegroup();
									if (s3 !== peg$FAILED) {
										s4 = [];
										s5 = peg$parse_();
										while (s5 !== peg$FAILED) {
											s4.push(s5);
											s5 = peg$parse_();
										}
										s5 = peg$parsegroup();
										if (s5 !== peg$FAILED) s0 = peg$f18(s3, s5);
										else {
											peg$currPos = s0;
											s0 = peg$FAILED;
										}
									} else {
										peg$currPos = s0;
										s0 = peg$FAILED;
									}
								} else {
									peg$currPos = s0;
									s0 = peg$FAILED;
								}
							}
						}
					}
				}
			}
			return s0;
		}
		function peg$parsevert() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f19(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e2);
			}
			return s0;
		}
		function peg$parsel() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f20(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e4);
			}
			return s0;
		}
		function peg$parser() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f21(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e5);
			}
			return s0;
		}
		function peg$parsec() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f22(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e6);
			}
			return s0;
		}
		function peg$parsep() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f23(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e7);
			}
			return s0;
		}
		function peg$parsem() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f24(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e8);
			}
			return s0;
		}
		function peg$parseb() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f25(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e9);
			}
			return s0;
		}
		function peg$parsew() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f26(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e10);
			}
			return s0;
		}
		function peg$parseW() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f27(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e11);
			}
			return s0;
		}
		function peg$parseX() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f28(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e12);
			}
			return s0;
		}
		function peg$parsebang() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f29(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e13);
			}
			return s0;
		}
		function peg$parseat() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f30(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e14);
			}
			return s0;
		}
		function peg$parseless() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f31(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e15);
			}
			return s0;
		}
		function peg$parsegreater() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f32(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e16);
			}
			return s0;
		}
		function peg$parsegroup() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f33(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e17);
			}
			return s0;
		}
		function peg$parse_() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f34(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e18);
			}
			return s0;
		}
		function peg$parseEOL() {
			let s0, s1;
			s0 = peg$currPos;
			peg$silentFails++;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			peg$silentFails--;
			if (s1 === peg$FAILED) s0 = void 0;
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		if (!options.isHash) try {
			Object.assign(options, {
				matchChar: (node, char) => node.type === "string" && node.content === char,
				isGroup: (node) => node.type === "group",
				isWhitespace: (node) => node.type === "whitespace"
			});
		} catch (e) {
			console.warn("Error when initializing parser", e);
		}
		peg$result = peg$startRuleFunction();
		const peg$success = peg$result !== peg$FAILED && peg$currPos === input.length;
		function peg$throw() {
			if (peg$result !== peg$FAILED && peg$currPos < input.length) peg$fail(peg$endExpectation());
			throw peg$buildStructuredError(peg$maxFailExpected, peg$maxFailPos < input.length ? peg$getUnicode(peg$maxFailPos) : null, peg$maxFailPos < input.length ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1) : peg$computeLocation(peg$maxFailPos, peg$maxFailPos));
		}
		if (options.peg$library) return (
		/** @type {any} */
		{
			peg$result,
			peg$currPos,
			peg$FAILED,
			peg$maxFailExpected,
			peg$maxFailPos,
			peg$success,
			peg$throw: peg$success ? void 0 : peg$throw
		});
		if (peg$success) return peg$result;
		else peg$throw();
	}
	return {
		StartRules: ["body"],
		SyntaxError: peg$SyntaxError,
		parse: peg$parse
	};
})();
//#endregion
//#region grammars/systeme-environment.pegjs
var systeme_environment_default = (function() {
	"use strict";
	class peg$SyntaxError extends SyntaxError {
		constructor(message, expected, found, location) {
			super(message);
			this.expected = expected;
			this.found = found;
			this.location = location;
			this.name = "SyntaxError";
		}
		format(sources) {
			let str = "Error: " + this.message;
			if (this.location) {
				let src = null;
				const st = sources.find((s2) => s2.source === this.location.source);
				if (st) src = st.text.split(/\r\n|\n|\r/g);
				const s = this.location.start;
				const offset_s = this.location.source && typeof this.location.source.offset === "function" ? this.location.source.offset(s) : s;
				const loc = this.location.source + ":" + offset_s.line + ":" + offset_s.column;
				if (src) {
					const e = this.location.end;
					const filler = "".padEnd(offset_s.line.toString().length, " ");
					const line = src[s.line - 1];
					const hatLen = (s.line === e.line ? e.column : line.length + 1) - s.column || 1;
					str += "\n --> " + loc + "\n" + filler + " |\n" + offset_s.line + " | " + line + "\n" + filler + " | " + "".padEnd(s.column - 1, " ") + "".padEnd(hatLen, "^");
				} else str += "\n at " + loc;
			}
			return str;
		}
		static buildMessage(expected, found) {
			function hex(ch) {
				return ch.codePointAt(0).toString(16).toUpperCase();
			}
			const nonPrintable = Object.prototype.hasOwnProperty.call(RegExp.prototype, "unicode") ? /* @__PURE__ */ new RegExp("[\\p{C}\\p{Mn}\\p{Mc}]", "gu") : null;
			function unicodeEscape(s) {
				if (nonPrintable) return s.replace(nonPrintable, (ch) => "\\u{" + hex(ch) + "}");
				return s;
			}
			function literalEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			function classEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^").replace(/-/g, "\\-").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			const DESCRIBE_EXPECTATION_FNS = {
				literal(expectation) {
					return "\"" + literalEscape(expectation.text) + "\"";
				},
				class(expectation) {
					const escapedParts = expectation.parts.map((part) => Array.isArray(part) ? classEscape(part[0]) + "-" + classEscape(part[1]) : classEscape(part));
					return "[" + (expectation.inverted ? "^" : "") + escapedParts.join("") + "]" + (expectation.unicode ? "u" : "");
				},
				any() {
					return "any character";
				},
				end() {
					return "end of input";
				},
				other(expectation) {
					return expectation.description;
				}
			};
			function describeExpectation(expectation) {
				return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
			}
			function describeExpected(expected2) {
				const descriptions = expected2.map(describeExpectation);
				descriptions.sort();
				if (descriptions.length > 0) {
					let j = 1;
					for (let i = 1; i < descriptions.length; i++) if (descriptions[i - 1] !== descriptions[i]) {
						descriptions[j] = descriptions[i];
						j++;
					}
					descriptions.length = j;
				}
				switch (descriptions.length) {
					case 1: return descriptions[0];
					case 2: return descriptions[0] + " or " + descriptions[1];
					default: return descriptions.slice(0, -1).join(", ") + ", or " + descriptions[descriptions.length - 1];
				}
			}
			function describeFound(found2) {
				return found2 ? "\"" + literalEscape(found2) + "\"" : "end of input";
			}
			return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
		}
	}
	function peg$parse(input, options) {
		options = options !== void 0 ? options : {};
		const peg$FAILED = {};
		const peg$source = options.grammarSource;
		const peg$startRuleFunctions = { body: peg$parsebody };
		let peg$startRuleFunction = peg$parsebody;
		const peg$e0 = peg$otherExpectation("item");
		const peg$e1 = peg$anyExpectation();
		const peg$e2 = peg$otherExpectation("trailing comment");
		const peg$e3 = peg$otherExpectation("comment only line");
		const peg$e4 = peg$otherExpectation("non-var token");
		const peg$e5 = peg$otherExpectation("token");
		const peg$e6 = peg$otherExpectation("same line comment");
		const peg$e7 = peg$otherExpectation("own line comment");
		const peg$e8 = peg$otherExpectation(",");
		const peg$e9 = peg$otherExpectation("@");
		const peg$e10 = peg$otherExpectation("variable token");
		const peg$e11 = peg$otherExpectation("+/-");
		const peg$e12 = peg$otherExpectation("=");
		function peg$f0(a, b) {
			return a.concat(b ? b : []);
		}
		function peg$f1() {
			return [];
		}
		function peg$f2(op, a, b, c) {
			return {
				type: "item",
				op,
				variable: b,
				content: a.concat(b, c)
			};
		}
		function peg$f3(op, a) {
			return {
				type: "item",
				op,
				variable: null,
				content: a
			};
		}
		function peg$f4(line, sep, comment) {
			return {
				...line,
				sep: [].concat(sep),
				trailingComment: comment
			};
		}
		function peg$f5(line, comment) {
			return {
				...line,
				trailingComment: comment
			};
		}
		function peg$f6(eq, ann) {
			return {
				type: "line",
				equation: eq,
				annotation: ann,
				sep: null
			};
		}
		function peg$f7(at, ann) {
			return at ? {
				type: "annotation",
				marker: at,
				content: ann
			} : null;
		}
		function peg$f8(left, eq, right) {
			return {
				type: "equation",
				left,
				right,
				equals: eq
			};
		}
		function peg$f9(x) {
			return x;
		}
		function peg$f10(x) {
			return {
				type: "line",
				trailingComment: x
			};
		}
		function peg$f11(v, s) {
			return [v].concat(s ? s : []);
		}
		function peg$f12(t) {
			return t;
		}
		function peg$f13(x) {
			return x;
		}
		function peg$f14(x) {
			return x;
		}
		function peg$f15(tok) {
			return options.isSameLineComment(tok);
		}
		function peg$f16(tok) {
			return tok;
		}
		function peg$f17(tok) {
			return options.isOwnLineComment(tok);
		}
		function peg$f18(tok) {
			return tok;
		}
		function peg$f19(tok) {
			return options.isWhitespace(tok);
		}
		function peg$f20(tok) {
			return tok;
		}
		function peg$f21(tok) {
			return options.isSep(tok);
		}
		function peg$f22(tok) {
			return tok;
		}
		function peg$f23(tok) {
			return options.isAt(tok);
		}
		function peg$f24(tok) {
			return tok;
		}
		function peg$f25(tok) {
			return options.isVar(tok);
		}
		function peg$f26(tok) {
			return tok;
		}
		function peg$f27(tok) {
			return options.isOperation(tok);
		}
		function peg$f28(tok) {
			return tok;
		}
		function peg$f29(tok) {
			return options.isEquals(tok);
		}
		function peg$f30(tok) {
			return tok;
		}
		function peg$f31(tok) {
			return options.isSubscript(tok);
		}
		function peg$f32(tok) {
			return tok;
		}
		let peg$currPos = options.peg$currPos | 0;
		const peg$posDetailsCache = [{
			line: 1,
			column: 1
		}];
		let peg$maxFailPos = peg$currPos;
		let peg$maxFailExpected = options.peg$maxFailExpected || [];
		let peg$silentFails = options.peg$silentFails | 0;
		let peg$result;
		if (options.startRule) {
			if (!(options.startRule in peg$startRuleFunctions)) throw new Error(`Can't start parsing from rule "` + options.startRule + "\".");
			peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
		}
		function peg$getUnicode(pos = peg$currPos) {
			const cp = input.codePointAt(pos);
			if (cp === void 0) return "";
			return String.fromCodePoint(cp);
		}
		function peg$anyExpectation() {
			return { type: "any" };
		}
		function peg$endExpectation() {
			return { type: "end" };
		}
		function peg$otherExpectation(description) {
			return {
				type: "other",
				description
			};
		}
		function peg$computePosDetails(pos) {
			let details = peg$posDetailsCache[pos];
			let p;
			if (details) return details;
			else {
				if (pos >= peg$posDetailsCache.length) p = peg$posDetailsCache.length - 1;
				else {
					p = pos;
					while (!peg$posDetailsCache[--p]);
				}
				details = peg$posDetailsCache[p];
				details = {
					line: details.line,
					column: details.column
				};
				while (p < pos) {
					if (input.charCodeAt(p) === 10) {
						details.line++;
						details.column = 1;
					} else details.column++;
					p++;
				}
				peg$posDetailsCache[pos] = details;
				return details;
			}
		}
		function peg$computeLocation(startPos, endPos, offset2) {
			const startPosDetails = peg$computePosDetails(startPos);
			const endPosDetails = peg$computePosDetails(endPos);
			const res = {
				source: peg$source,
				start: {
					offset: startPos,
					line: startPosDetails.line,
					column: startPosDetails.column
				},
				end: {
					offset: endPos,
					line: endPosDetails.line,
					column: endPosDetails.column
				}
			};
			if (offset2 && peg$source && typeof peg$source.offset === "function") {
				res.start = peg$source.offset(res.start);
				res.end = peg$source.offset(res.end);
			}
			return res;
		}
		function peg$fail(expected2) {
			if (peg$currPos < peg$maxFailPos) return;
			if (peg$currPos > peg$maxFailPos) {
				peg$maxFailPos = peg$currPos;
				peg$maxFailExpected = [];
			}
			peg$maxFailExpected.push(expected2);
		}
		function peg$buildStructuredError(expected2, found, location2) {
			return new peg$SyntaxError(peg$SyntaxError.buildMessage(expected2, found), expected2, found, location2);
		}
		function peg$parsebody() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parsecomment_only_line();
			if (s2 === peg$FAILED) {
				s2 = peg$parseline_with_sep();
				if (s2 === peg$FAILED) s2 = peg$parsepartial_line_with_comment();
			}
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parsecomment_only_line();
				if (s2 === peg$FAILED) {
					s2 = peg$parseline_with_sep();
					if (s2 === peg$FAILED) s2 = peg$parsepartial_line_with_comment();
				}
			}
			s2 = peg$parseline_without_sep();
			if (s2 === peg$FAILED) s2 = peg$parseEOL();
			if (s2 !== peg$FAILED) s0 = peg$f0(s1, s2);
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$parseEOL();
				if (s1 !== peg$FAILED) s1 = peg$f1();
				s0 = s1;
			}
			return s0;
		}
		function peg$parseitem() {
			let s0, s1, s2, s3, s4, s5, s6, s7, s8, s9;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$parseoperation();
			if (s1 === peg$FAILED) s1 = null;
			s2 = [];
			s3 = peg$parse_();
			while (s3 !== peg$FAILED) {
				s2.push(s3);
				s3 = peg$parse_();
			}
			s3 = [];
			s4 = peg$parsenon_var_token();
			while (s4 !== peg$FAILED) {
				s3.push(s4);
				s4 = peg$parsenon_var_token();
			}
			s4 = [];
			s5 = peg$parse_();
			while (s5 !== peg$FAILED) {
				s4.push(s5);
				s5 = peg$parse_();
			}
			s5 = peg$parsevar();
			if (s5 !== peg$FAILED) {
				s6 = [];
				s7 = peg$parse_();
				while (s7 !== peg$FAILED) {
					s6.push(s7);
					s7 = peg$parse_();
				}
				s7 = [];
				s8 = peg$parsetoken();
				while (s8 !== peg$FAILED) {
					s7.push(s8);
					s8 = peg$parsetoken();
				}
				s8 = [];
				s9 = peg$parse_();
				while (s9 !== peg$FAILED) {
					s8.push(s9);
					s9 = peg$parse_();
				}
				s0 = peg$f2(s1, s3, s5, s7);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$parseoperation();
				if (s1 === peg$FAILED) s1 = null;
				s2 = [];
				s3 = peg$parse_();
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$parse_();
				}
				s3 = [];
				s4 = peg$parsenon_var_token();
				if (s4 !== peg$FAILED) while (s4 !== peg$FAILED) {
					s3.push(s4);
					s4 = peg$parsenon_var_token();
				}
				else s3 = peg$FAILED;
				if (s3 !== peg$FAILED) {
					s4 = [];
					s5 = peg$parse_();
					while (s5 !== peg$FAILED) {
						s4.push(s5);
						s5 = peg$parse_();
					}
					s0 = peg$f3(s1, s3);
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			return s0;
		}
		function peg$parseline_with_sep() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			s1 = peg$parseline_without_sep();
			if (s1 !== peg$FAILED) {
				s2 = peg$parsesep();
				if (s2 !== peg$FAILED) {
					s3 = peg$parsetrailing_comment();
					if (s3 === peg$FAILED) s3 = null;
					s0 = peg$f4(s1, s2, s3);
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsepartial_line_with_comment() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = peg$parseline_without_sep();
			if (s1 !== peg$FAILED) {
				s2 = peg$parsetrailing_comment();
				if (s2 !== peg$FAILED) s0 = peg$f5(s1, s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseline_without_sep() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			s1 = peg$currPos;
			peg$silentFails++;
			if (input.length > peg$currPos) {
				s2 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s2 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			peg$silentFails--;
			if (s2 !== peg$FAILED) {
				peg$currPos = s1;
				s1 = void 0;
			} else s1 = peg$FAILED;
			if (s1 !== peg$FAILED) {
				s2 = peg$parseequation();
				s3 = peg$parseannotation();
				if (s3 === peg$FAILED) s3 = null;
				s0 = peg$f6(s2, s3);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseannotation() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			s1 = peg$parseat();
			if (s1 !== peg$FAILED) {
				s2 = [];
				s3 = peg$parsenon_sep_token();
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$parsenon_sep_token();
				}
				s0 = peg$f7(s1, s2);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseequation() {
			let s0, s1, s2, s3, s4;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parseitem();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parseitem();
			}
			s2 = peg$parseequals();
			if (s2 === peg$FAILED) s2 = null;
			s3 = [];
			s4 = peg$parsetoken();
			if (s4 === peg$FAILED) s4 = peg$parseoperation();
			while (s4 !== peg$FAILED) {
				s3.push(s4);
				s4 = peg$parsetoken();
				if (s4 === peg$FAILED) s4 = peg$parseoperation();
			}
			s0 = peg$f8(s1, s2, s3);
			peg$silentFails--;
			return s0;
		}
		function peg$parsetrailing_comment() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parse_();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parse_();
			}
			s2 = peg$parsesame_line_comment();
			if (s2 !== peg$FAILED) s0 = peg$f9(s2);
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e2);
			}
			return s0;
		}
		function peg$parsecomment_only_line() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parse_();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parse_();
			}
			s2 = peg$parseown_line_comment();
			if (s2 !== peg$FAILED) s0 = peg$f10(s2);
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			return s0;
		}
		function peg$parsevar() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			s1 = peg$parsevar_token();
			if (s1 !== peg$FAILED) {
				s2 = [];
				s3 = peg$parse_();
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					s3 = peg$parse_();
				}
				s3 = peg$parsesubscript();
				if (s3 === peg$FAILED) s3 = null;
				s0 = peg$f11(s1, s3);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsenon_var_token() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$currPos;
			peg$silentFails++;
			s2 = peg$parsevar();
			peg$silentFails--;
			if (s2 === peg$FAILED) s1 = void 0;
			else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$parsetoken();
				if (s2 !== peg$FAILED) s0 = peg$f12(s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e4);
			}
			return s0;
		}
		function peg$parsenon_sep_token() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = peg$currPos;
			peg$silentFails++;
			s2 = peg$parsesep();
			if (s2 === peg$FAILED) {
				s2 = peg$parsetrailing_comment();
				if (s2 === peg$FAILED) s2 = peg$parseown_line_comment();
			}
			peg$silentFails--;
			if (s2 === peg$FAILED) s1 = void 0;
			else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 !== peg$FAILED) {
				if (input.length > peg$currPos) {
					s2 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e1);
				}
				if (s2 !== peg$FAILED) s0 = peg$f13(s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsetoken() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$currPos;
			peg$silentFails++;
			s2 = peg$parsesep();
			if (s2 === peg$FAILED) {
				s2 = peg$parseat();
				if (s2 === peg$FAILED) {
					s2 = peg$parseoperation();
					if (s2 === peg$FAILED) {
						s2 = peg$parseequals();
						if (s2 === peg$FAILED) {
							s2 = peg$parsetrailing_comment();
							if (s2 === peg$FAILED) s2 = peg$parseown_line_comment();
						}
					}
				}
			}
			peg$silentFails--;
			if (s2 === peg$FAILED) s1 = void 0;
			else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 !== peg$FAILED) {
				if (input.length > peg$currPos) {
					s2 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e1);
				}
				if (s2 !== peg$FAILED) s0 = peg$f14(s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e5);
			}
			return s0;
		}
		function peg$parsesame_line_comment() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f15(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f16(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e6);
			}
			return s0;
		}
		function peg$parseown_line_comment() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f17(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f18(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e7);
			}
			return s0;
		}
		function peg$parse_() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f19(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f20(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsesep() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f21(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f22(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e8);
			}
			return s0;
		}
		function peg$parseat() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f23(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f24(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e9);
			}
			return s0;
		}
		function peg$parsevar_token() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f25(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f26(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e10);
			}
			return s0;
		}
		function peg$parseoperation() {
			let s0, s1, s2, s3, s4;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parse_();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parse_();
			}
			if (input.length > peg$currPos) {
				s2 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s2 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			if (s2 !== peg$FAILED) {
				s3 = [];
				s4 = peg$parse_();
				while (s4 !== peg$FAILED) {
					s3.push(s4);
					s4 = peg$parse_();
				}
				s4 = peg$f27(s2);
				if (s4) s4 = void 0;
				else s4 = peg$FAILED;
				if (s4 !== peg$FAILED) s0 = peg$f28(s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e11);
			}
			return s0;
		}
		function peg$parseequals() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f29(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f30(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e12);
			}
			return s0;
		}
		function peg$parsesubscript() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f31(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f32(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseEOL() {
			let s0, s1;
			s0 = peg$currPos;
			peg$silentFails++;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			peg$silentFails--;
			if (s1 === peg$FAILED) s0 = void 0;
			else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		if (!options.isWhitespace) try {
			Object.assign(options, {
				isSep: (node) => node.type === "string" && node.content === ",",
				isVar: (node) => node.type === "string" && node.content.match(/[a-zA-Z]/),
				isOperation: (node) => node.type === "string" && node.content.match(/[+-]/),
				isEquals: (node) => node.type === "string" && node.content === "=",
				isAt: (node) => node.type === "string" && node.content === "@",
				isSubscript: (node) => node.content === "_",
				isWhitespace: (node) => node.type === "whitespace",
				isSameLineComment: (node) => node.type === "comment" && node.sameline,
				isOwnLineComment: (node) => node.type === "comment" && !node.sameline
			});
		} catch (e) {
			console.warn("Error when initializing parser", e);
		}
		peg$result = peg$startRuleFunction();
		const peg$success = peg$result !== peg$FAILED && peg$currPos === input.length;
		function peg$throw() {
			if (peg$result !== peg$FAILED && peg$currPos < input.length) peg$fail(peg$endExpectation());
			throw peg$buildStructuredError(peg$maxFailExpected, peg$maxFailPos < input.length ? peg$getUnicode(peg$maxFailPos) : null, peg$maxFailPos < input.length ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1) : peg$computeLocation(peg$maxFailPos, peg$maxFailPos));
		}
		if (options.peg$library) return (
		/** @type {any} */
		{
			peg$result,
			peg$currPos,
			peg$FAILED,
			peg$maxFailExpected,
			peg$maxFailPos,
			peg$success,
			peg$throw: peg$success ? void 0 : peg$throw
		});
		if (peg$success) return peg$result;
		else peg$throw();
	}
	return {
		StartRules: ["body"],
		SyntaxError: peg$SyntaxError,
		parse: peg$parse
	};
})();
//#endregion
//#region grammars/tex-glue.pegjs
var tex_glue_default = (function() {
	"use strict";
	class peg$SyntaxError extends SyntaxError {
		constructor(message, expected, found, location) {
			super(message);
			this.expected = expected;
			this.found = found;
			this.location = location;
			this.name = "SyntaxError";
		}
		format(sources) {
			let str = "Error: " + this.message;
			if (this.location) {
				let src = null;
				const st = sources.find((s2) => s2.source === this.location.source);
				if (st) src = st.text.split(/\r\n|\n|\r/g);
				const s = this.location.start;
				const offset_s = this.location.source && typeof this.location.source.offset === "function" ? this.location.source.offset(s) : s;
				const loc = this.location.source + ":" + offset_s.line + ":" + offset_s.column;
				if (src) {
					const e = this.location.end;
					const filler = "".padEnd(offset_s.line.toString().length, " ");
					const line = src[s.line - 1];
					const hatLen = (s.line === e.line ? e.column : line.length + 1) - s.column || 1;
					str += "\n --> " + loc + "\n" + filler + " |\n" + offset_s.line + " | " + line + "\n" + filler + " | " + "".padEnd(s.column - 1, " ") + "".padEnd(hatLen, "^");
				} else str += "\n at " + loc;
			}
			return str;
		}
		static buildMessage(expected, found) {
			function hex(ch) {
				return ch.codePointAt(0).toString(16).toUpperCase();
			}
			const nonPrintable = Object.prototype.hasOwnProperty.call(RegExp.prototype, "unicode") ? /* @__PURE__ */ new RegExp("[\\p{C}\\p{Mn}\\p{Mc}]", "gu") : null;
			function unicodeEscape(s) {
				if (nonPrintable) return s.replace(nonPrintable, (ch) => "\\u{" + hex(ch) + "}");
				return s;
			}
			function literalEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			function classEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^").replace(/-/g, "\\-").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			const DESCRIBE_EXPECTATION_FNS = {
				literal(expectation) {
					return "\"" + literalEscape(expectation.text) + "\"";
				},
				class(expectation) {
					const escapedParts = expectation.parts.map((part) => Array.isArray(part) ? classEscape(part[0]) + "-" + classEscape(part[1]) : classEscape(part));
					return "[" + (expectation.inverted ? "^" : "") + escapedParts.join("") + "]" + (expectation.unicode ? "u" : "");
				},
				any() {
					return "any character";
				},
				end() {
					return "end of input";
				},
				other(expectation) {
					return expectation.description;
				}
			};
			function describeExpectation(expectation) {
				return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
			}
			function describeExpected(expected2) {
				const descriptions = expected2.map(describeExpectation);
				descriptions.sort();
				if (descriptions.length > 0) {
					let j = 1;
					for (let i = 1; i < descriptions.length; i++) if (descriptions[i - 1] !== descriptions[i]) {
						descriptions[j] = descriptions[i];
						j++;
					}
					descriptions.length = j;
				}
				switch (descriptions.length) {
					case 1: return descriptions[0];
					case 2: return descriptions[0] + " or " + descriptions[1];
					default: return descriptions.slice(0, -1).join(", ") + ", or " + descriptions[descriptions.length - 1];
				}
			}
			function describeFound(found2) {
				return found2 ? "\"" + literalEscape(found2) + "\"" : "end of input";
			}
			return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
		}
	}
	function peg$parse(input, options) {
		options = options !== void 0 ? options : {};
		const peg$FAILED = {};
		const peg$source = options.grammarSource;
		const peg$startRuleFunctions = { root: peg$parseroot };
		let peg$startRuleFunction = peg$parseroot;
		const peg$c0 = "plus";
		const peg$c1 = "minus";
		const peg$c2 = "pt";
		const peg$c3 = "mm";
		const peg$c4 = "cm";
		const peg$c5 = "in";
		const peg$c6 = "ex";
		const peg$c7 = "em";
		const peg$c8 = "bp";
		const peg$c9 = "pc";
		const peg$c10 = "dd";
		const peg$c11 = "cc";
		const peg$c12 = "nd";
		const peg$c13 = "nc";
		const peg$c14 = "sp";
		const peg$c15 = "filll";
		const peg$c16 = "fill";
		const peg$c17 = "fil";
		const peg$c18 = ".";
		const peg$r0 = /^[0-9]/;
		const peg$r1 = /^[+\-]/;
		const peg$e0 = peg$anyExpectation();
		const peg$e1 = peg$literalExpectation("plus", false);
		const peg$e2 = peg$literalExpectation("minus", false);
		const peg$e3 = peg$literalExpectation("pt", false);
		const peg$e4 = peg$literalExpectation("mm", false);
		const peg$e5 = peg$literalExpectation("cm", false);
		const peg$e6 = peg$literalExpectation("in", false);
		const peg$e7 = peg$literalExpectation("ex", false);
		const peg$e8 = peg$literalExpectation("em", false);
		const peg$e9 = peg$literalExpectation("bp", false);
		const peg$e10 = peg$literalExpectation("pc", false);
		const peg$e11 = peg$literalExpectation("dd", false);
		const peg$e12 = peg$literalExpectation("cc", false);
		const peg$e13 = peg$literalExpectation("nd", false);
		const peg$e14 = peg$literalExpectation("nc", false);
		const peg$e15 = peg$literalExpectation("sp", false);
		const peg$e16 = peg$literalExpectation("filll", false);
		const peg$e17 = peg$literalExpectation("fill", false);
		const peg$e18 = peg$literalExpectation("fil", false);
		const peg$e19 = peg$otherExpectation("number");
		const peg$e20 = peg$classExpectation([["0", "9"]], false, false, false);
		const peg$e21 = peg$literalExpectation(".", false);
		const peg$e22 = peg$classExpectation(["+", "-"], false, false, false);
		function peg$f0(b, st, sh) {
			return {
				type: "glue",
				fixed: b,
				stretchable: st,
				shrinkable: sh,
				position: location()
			};
		}
		function peg$f1(glue) {
			return glue;
		}
		function peg$f2(n, u) {
			return {
				type: "dim",
				value: n,
				unit: u
			};
		}
		function peg$f3(n, u) {
			return {
				type: "dim",
				value: n,
				unit: u
			};
		}
		function peg$f4(n, u) {
			return {
				type: "dim",
				value: n,
				unit: u
			};
		}
		function peg$f5(n) {
			return parseFloat(n);
		}
		let peg$currPos = options.peg$currPos | 0;
		let peg$savedPos = peg$currPos;
		const peg$posDetailsCache = [{
			line: 1,
			column: 1
		}];
		let peg$maxFailPos = peg$currPos;
		let peg$maxFailExpected = options.peg$maxFailExpected || [];
		let peg$silentFails = options.peg$silentFails | 0;
		let peg$result;
		if (options.startRule) {
			if (!(options.startRule in peg$startRuleFunctions)) throw new Error(`Can't start parsing from rule "` + options.startRule + "\".");
			peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
		}
		function location() {
			return peg$computeLocation(peg$savedPos, peg$currPos);
		}
		function peg$getUnicode(pos = peg$currPos) {
			const cp = input.codePointAt(pos);
			if (cp === void 0) return "";
			return String.fromCodePoint(cp);
		}
		function peg$literalExpectation(text2, ignoreCase) {
			return {
				type: "literal",
				text: text2,
				ignoreCase
			};
		}
		function peg$classExpectation(parts, inverted, ignoreCase, unicode) {
			return {
				type: "class",
				parts,
				inverted,
				ignoreCase,
				unicode
			};
		}
		function peg$anyExpectation() {
			return { type: "any" };
		}
		function peg$endExpectation() {
			return { type: "end" };
		}
		function peg$otherExpectation(description) {
			return {
				type: "other",
				description
			};
		}
		function peg$computePosDetails(pos) {
			let details = peg$posDetailsCache[pos];
			let p;
			if (details) return details;
			else {
				if (pos >= peg$posDetailsCache.length) p = peg$posDetailsCache.length - 1;
				else {
					p = pos;
					while (!peg$posDetailsCache[--p]);
				}
				details = peg$posDetailsCache[p];
				details = {
					line: details.line,
					column: details.column
				};
				while (p < pos) {
					if (input.charCodeAt(p) === 10) {
						details.line++;
						details.column = 1;
					} else details.column++;
					p++;
				}
				peg$posDetailsCache[pos] = details;
				return details;
			}
		}
		function peg$computeLocation(startPos, endPos, offset2) {
			const startPosDetails = peg$computePosDetails(startPos);
			const endPosDetails = peg$computePosDetails(endPos);
			const res = {
				source: peg$source,
				start: {
					offset: startPos,
					line: startPosDetails.line,
					column: startPosDetails.column
				},
				end: {
					offset: endPos,
					line: endPosDetails.line,
					column: endPosDetails.column
				}
			};
			if (offset2 && peg$source && typeof peg$source.offset === "function") {
				res.start = peg$source.offset(res.start);
				res.end = peg$source.offset(res.end);
			}
			return res;
		}
		function peg$fail(expected2) {
			if (peg$currPos < peg$maxFailPos) return;
			if (peg$currPos > peg$maxFailPos) {
				peg$maxFailPos = peg$currPos;
				peg$maxFailExpected = [];
			}
			peg$maxFailExpected.push(expected2);
		}
		function peg$buildStructuredError(expected2, found, location2) {
			return new peg$SyntaxError(peg$SyntaxError.buildMessage(expected2, found), expected2, found, location2);
		}
		function peg$parseroot() {
			let s0, s1, s2, s3, s4;
			s0 = peg$currPos;
			s1 = peg$currPos;
			s2 = peg$parsebase();
			if (s2 !== peg$FAILED) {
				s3 = peg$parsestretchable();
				if (s3 === peg$FAILED) s3 = null;
				s4 = peg$parseshrinkable();
				if (s4 === peg$FAILED) s4 = null;
				peg$savedPos = s1;
				s1 = peg$f0(s2, s3, s4);
			} else {
				peg$currPos = s1;
				s1 = peg$FAILED;
			}
			if (s1 !== peg$FAILED) {
				s2 = [];
				if (input.length > peg$currPos) {
					s3 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s3 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e0);
				}
				while (s3 !== peg$FAILED) {
					s2.push(s3);
					if (input.length > peg$currPos) {
						s3 = input.charAt(peg$currPos);
						peg$currPos++;
					} else {
						s3 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e0);
					}
				}
				peg$savedPos = s0;
				s0 = peg$f1(s1);
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsebase() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = peg$parsenumber();
			if (s1 !== peg$FAILED) {
				s2 = peg$parseunit();
				if (s2 !== peg$FAILED) {
					peg$savedPos = s0;
					s0 = peg$f2(s1, s2);
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsestretchable() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			if (input.substr(peg$currPos, 4) === peg$c0) {
				s1 = peg$c0;
				peg$currPos += 4;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$parsenumber();
				if (s2 !== peg$FAILED) {
					s3 = peg$parserubber_unit();
					if (s3 !== peg$FAILED) {
						peg$savedPos = s0;
						s0 = peg$f3(s2, s3);
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseshrinkable() {
			let s0, s1, s2, s3;
			s0 = peg$currPos;
			if (input.substr(peg$currPos, 5) === peg$c1) {
				s1 = peg$c1;
				peg$currPos += 5;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e2);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$parsenumber();
				if (s2 !== peg$FAILED) {
					s3 = peg$parserubber_unit();
					if (s3 !== peg$FAILED) {
						peg$savedPos = s0;
						s0 = peg$f4(s2, s3);
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseunit() {
			let s0;
			if (input.substr(peg$currPos, 2) === peg$c2) {
				s0 = peg$c2;
				peg$currPos += 2;
			} else {
				s0 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			if (s0 === peg$FAILED) {
				if (input.substr(peg$currPos, 2) === peg$c3) {
					s0 = peg$c3;
					peg$currPos += 2;
				} else {
					s0 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e4);
				}
				if (s0 === peg$FAILED) {
					if (input.substr(peg$currPos, 2) === peg$c4) {
						s0 = peg$c4;
						peg$currPos += 2;
					} else {
						s0 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e5);
					}
					if (s0 === peg$FAILED) {
						if (input.substr(peg$currPos, 2) === peg$c5) {
							s0 = peg$c5;
							peg$currPos += 2;
						} else {
							s0 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e6);
						}
						if (s0 === peg$FAILED) {
							if (input.substr(peg$currPos, 2) === peg$c6) {
								s0 = peg$c6;
								peg$currPos += 2;
							} else {
								s0 = peg$FAILED;
								if (peg$silentFails === 0) peg$fail(peg$e7);
							}
							if (s0 === peg$FAILED) {
								if (input.substr(peg$currPos, 2) === peg$c7) {
									s0 = peg$c7;
									peg$currPos += 2;
								} else {
									s0 = peg$FAILED;
									if (peg$silentFails === 0) peg$fail(peg$e8);
								}
								if (s0 === peg$FAILED) {
									if (input.substr(peg$currPos, 2) === peg$c8) {
										s0 = peg$c8;
										peg$currPos += 2;
									} else {
										s0 = peg$FAILED;
										if (peg$silentFails === 0) peg$fail(peg$e9);
									}
									if (s0 === peg$FAILED) {
										if (input.substr(peg$currPos, 2) === peg$c9) {
											s0 = peg$c9;
											peg$currPos += 2;
										} else {
											s0 = peg$FAILED;
											if (peg$silentFails === 0) peg$fail(peg$e10);
										}
										if (s0 === peg$FAILED) {
											if (input.substr(peg$currPos, 2) === peg$c10) {
												s0 = peg$c10;
												peg$currPos += 2;
											} else {
												s0 = peg$FAILED;
												if (peg$silentFails === 0) peg$fail(peg$e11);
											}
											if (s0 === peg$FAILED) {
												if (input.substr(peg$currPos, 2) === peg$c11) {
													s0 = peg$c11;
													peg$currPos += 2;
												} else {
													s0 = peg$FAILED;
													if (peg$silentFails === 0) peg$fail(peg$e12);
												}
												if (s0 === peg$FAILED) {
													if (input.substr(peg$currPos, 2) === peg$c12) {
														s0 = peg$c12;
														peg$currPos += 2;
													} else {
														s0 = peg$FAILED;
														if (peg$silentFails === 0) peg$fail(peg$e13);
													}
													if (s0 === peg$FAILED) {
														if (input.substr(peg$currPos, 2) === peg$c13) {
															s0 = peg$c13;
															peg$currPos += 2;
														} else {
															s0 = peg$FAILED;
															if (peg$silentFails === 0) peg$fail(peg$e14);
														}
														if (s0 === peg$FAILED) if (input.substr(peg$currPos, 2) === peg$c14) {
															s0 = peg$c14;
															peg$currPos += 2;
														} else {
															s0 = peg$FAILED;
															if (peg$silentFails === 0) peg$fail(peg$e15);
														}
													}
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
			return s0;
		}
		function peg$parserubber_unit() {
			let s0;
			s0 = peg$parseunit();
			if (s0 === peg$FAILED) {
				if (input.substr(peg$currPos, 5) === peg$c15) {
					s0 = peg$c15;
					peg$currPos += 5;
				} else {
					s0 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e16);
				}
				if (s0 === peg$FAILED) {
					if (input.substr(peg$currPos, 4) === peg$c16) {
						s0 = peg$c16;
						peg$currPos += 4;
					} else {
						s0 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e17);
					}
					if (s0 === peg$FAILED) if (input.substr(peg$currPos, 3) === peg$c17) {
						s0 = peg$c17;
						peg$currPos += 3;
					} else {
						s0 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e18);
					}
				}
			}
			return s0;
		}
		function peg$parsenumber() {
			let s0, s1, s2, s3, s4, s5, s6, s7, s8;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = peg$currPos;
			s2 = peg$currPos;
			s3 = peg$parsesign();
			if (s3 === peg$FAILED) s3 = null;
			s4 = peg$currPos;
			s5 = [];
			s6 = input.charAt(peg$currPos);
			if (peg$r0.test(s6)) peg$currPos++;
			else {
				s6 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e20);
			}
			while (s6 !== peg$FAILED) {
				s5.push(s6);
				s6 = input.charAt(peg$currPos);
				if (peg$r0.test(s6)) peg$currPos++;
				else {
					s6 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e20);
				}
			}
			if (input.charCodeAt(peg$currPos) === 46) {
				s6 = peg$c18;
				peg$currPos++;
			} else {
				s6 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e21);
			}
			if (s6 !== peg$FAILED) {
				s7 = [];
				s8 = input.charAt(peg$currPos);
				if (peg$r0.test(s8)) peg$currPos++;
				else {
					s8 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e20);
				}
				if (s8 !== peg$FAILED) while (s8 !== peg$FAILED) {
					s7.push(s8);
					s8 = input.charAt(peg$currPos);
					if (peg$r0.test(s8)) peg$currPos++;
					else {
						s8 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e20);
					}
				}
				else s7 = peg$FAILED;
				if (s7 !== peg$FAILED) {
					s5 = [
						s5,
						s6,
						s7
					];
					s4 = s5;
				} else {
					peg$currPos = s4;
					s4 = peg$FAILED;
				}
			} else {
				peg$currPos = s4;
				s4 = peg$FAILED;
			}
			if (s4 === peg$FAILED) {
				s4 = [];
				s5 = input.charAt(peg$currPos);
				if (peg$r0.test(s5)) peg$currPos++;
				else {
					s5 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e20);
				}
				if (s5 !== peg$FAILED) while (s5 !== peg$FAILED) {
					s4.push(s5);
					s5 = input.charAt(peg$currPos);
					if (peg$r0.test(s5)) peg$currPos++;
					else {
						s5 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e20);
					}
				}
				else s4 = peg$FAILED;
			}
			if (s4 !== peg$FAILED) {
				s3 = [s3, s4];
				s2 = s3;
			} else {
				peg$currPos = s2;
				s2 = peg$FAILED;
			}
			if (s2 !== peg$FAILED) s1 = input.substring(s1, peg$currPos);
			else s1 = s2;
			if (s1 !== peg$FAILED) {
				peg$savedPos = s0;
				s1 = peg$f5(s1);
			}
			s0 = s1;
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e19);
			}
			return s0;
		}
		function peg$parsesign() {
			let s0;
			s0 = input.charAt(peg$currPos);
			if (peg$r1.test(s0)) peg$currPos++;
			else {
				s0 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e22);
			}
			return s0;
		}
		peg$result = peg$startRuleFunction();
		const peg$success = peg$result !== peg$FAILED && peg$currPos === input.length;
		function peg$throw() {
			if (peg$result !== peg$FAILED && peg$currPos < input.length) peg$fail(peg$endExpectation());
			throw peg$buildStructuredError(peg$maxFailExpected, peg$maxFailPos < input.length ? peg$getUnicode(peg$maxFailPos) : null, peg$maxFailPos < input.length ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1) : peg$computeLocation(peg$maxFailPos, peg$maxFailPos));
		}
		if (options.peg$library) return (
		/** @type {any} */
		{
			peg$result,
			peg$currPos,
			peg$FAILED,
			peg$maxFailExpected,
			peg$maxFailPos,
			peg$success,
			peg$throw: peg$success ? void 0 : peg$throw
		});
		if (peg$success) return peg$result;
		else peg$throw();
	}
	return {
		StartRules: ["root"],
		SyntaxError: peg$SyntaxError,
		parse: peg$parse
	};
})();
//#endregion
//#region grammars/tikz.pegjs
var tikz_default = (function() {
	"use strict";
	class peg$SyntaxError extends SyntaxError {
		constructor(message, expected, found, location) {
			super(message);
			this.expected = expected;
			this.found = found;
			this.location = location;
			this.name = "SyntaxError";
		}
		format(sources) {
			let str = "Error: " + this.message;
			if (this.location) {
				let src = null;
				const st = sources.find((s2) => s2.source === this.location.source);
				if (st) src = st.text.split(/\r\n|\n|\r/g);
				const s = this.location.start;
				const offset_s = this.location.source && typeof this.location.source.offset === "function" ? this.location.source.offset(s) : s;
				const loc = this.location.source + ":" + offset_s.line + ":" + offset_s.column;
				if (src) {
					const e = this.location.end;
					const filler = "".padEnd(offset_s.line.toString().length, " ");
					const line = src[s.line - 1];
					const hatLen = (s.line === e.line ? e.column : line.length + 1) - s.column || 1;
					str += "\n --> " + loc + "\n" + filler + " |\n" + offset_s.line + " | " + line + "\n" + filler + " | " + "".padEnd(s.column - 1, " ") + "".padEnd(hatLen, "^");
				} else str += "\n at " + loc;
			}
			return str;
		}
		static buildMessage(expected, found) {
			function hex(ch) {
				return ch.codePointAt(0).toString(16).toUpperCase();
			}
			const nonPrintable = Object.prototype.hasOwnProperty.call(RegExp.prototype, "unicode") ? /* @__PURE__ */ new RegExp("[\\p{C}\\p{Mn}\\p{Mc}]", "gu") : null;
			function unicodeEscape(s) {
				if (nonPrintable) return s.replace(nonPrintable, (ch) => "\\u{" + hex(ch) + "}");
				return s;
			}
			function literalEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			function classEscape(s) {
				return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^").replace(/-/g, "\\-").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
			}
			const DESCRIBE_EXPECTATION_FNS = {
				literal(expectation) {
					return "\"" + literalEscape(expectation.text) + "\"";
				},
				class(expectation) {
					const escapedParts = expectation.parts.map((part) => Array.isArray(part) ? classEscape(part[0]) + "-" + classEscape(part[1]) : classEscape(part));
					return "[" + (expectation.inverted ? "^" : "") + escapedParts.join("") + "]" + (expectation.unicode ? "u" : "");
				},
				any() {
					return "any character";
				},
				end() {
					return "end of input";
				},
				other(expectation) {
					return expectation.description;
				}
			};
			function describeExpectation(expectation) {
				return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
			}
			function describeExpected(expected2) {
				const descriptions = expected2.map(describeExpectation);
				descriptions.sort();
				if (descriptions.length > 0) {
					let j = 1;
					for (let i = 1; i < descriptions.length; i++) if (descriptions[i - 1] !== descriptions[i]) {
						descriptions[j] = descriptions[i];
						j++;
					}
					descriptions.length = j;
				}
				switch (descriptions.length) {
					case 1: return descriptions[0];
					case 2: return descriptions[0] + " or " + descriptions[1];
					default: return descriptions.slice(0, -1).join(", ") + ", or " + descriptions[descriptions.length - 1];
				}
			}
			function describeFound(found2) {
				return found2 ? "\"" + literalEscape(found2) + "\"" : "end of input";
			}
			return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
		}
	}
	function peg$parse(input, options) {
		options = options !== void 0 ? options : {};
		const peg$FAILED = {};
		const peg$source = options.grammarSource;
		const peg$startRuleFunctions = {
			path_spec: peg$parsepath_spec,
			foreach_body: peg$parseforeach_body
		};
		let peg$startRuleFunction = peg$parsepath_spec;
		const peg$e0 = peg$anyExpectation();
		const peg$e1 = peg$otherExpectation("comment");
		const peg$e2 = peg$otherExpectation("operation");
		const peg$e3 = peg$otherExpectation("=");
		function peg$f0(v) {
			return v;
		}
		function peg$f1(ops) {
			return {
				type: "path_spec",
				content: ops
			};
		}
		function peg$f2(c1, op, comment) {
			return {
				op,
				comment
			};
		}
		function peg$f3(c1, ops, c2, body) {
			return {
				type: "animation",
				comments: [
					c1,
					...ops.map((x) => x.comment),
					c2
				].filter((x) => x),
				attribute: ops.map((x) => x.op.content.content).join(" "),
				content: body.content
			};
		}
		function peg$f4(start, b) {
			return {
				...b,
				start,
				type: "foreach"
			};
		}
		function peg$f5(c1, variables, options2, c2, c3, list, c4, command) {
			const comments = [
				c1,
				c2,
				c3,
				c4
			].filter((x) => x);
			return {
				type: "foreach_body",
				variables,
				options: options2 && options2.content,
				list,
				command,
				comments
			};
		}
		function peg$f6(c1, options2, c2, body) {
			const comments = [c1, c2].filter((x) => x);
			return {
				type: "svg_operation",
				options: options2 && options2.content,
				content: body,
				comments
			};
		}
		function peg$f7(c1, c2, coord, c3, c4, x) {
			return {
				coord: x,
				comment: c4
			};
		}
		function peg$f8(c1, c2, coord, c3, a, c5) {
			const comments = [
				c1,
				c2,
				c3,
				a && a.comment,
				c5
			].filter((x) => x);
			return {
				type: "curve_to",
				controls: a ? [coord, a.coord] : [coord],
				comments
			};
		}
		function peg$f9() {
			return {
				type: "line_to",
				command: "|-"
			};
		}
		function peg$f10() {
			return {
				type: "line_to",
				command: "-|"
			};
		}
		function peg$f11() {
			return {
				type: "line_to",
				command: "--"
			};
		}
		function peg$f12(prefix, content) {
			return {
				type: "coordinate",
				content,
				prefix
			};
		}
		function peg$f13(content) {
			return {
				type: "square_brace_group",
				content
			};
		}
		function peg$f14(v) {
			return {
				type: "unknown",
				content: v
			};
		}
		function peg$f15(tok) {
			return options.isComment(tok);
		}
		function peg$f16(tok) {
			return tok;
		}
		function peg$f17(tok) {
			return options.isWhitespace(tok);
		}
		function peg$f18(tok) {
			return tok;
		}
		function peg$f19(c) {
			return c;
		}
		function peg$f20(tok) {
			return options.isOperation(tok);
		}
		function peg$f21(tok) {
			return {
				type: "operation",
				content: tok
			};
		}
		function peg$f22(tok) {
			return options.isChar(tok, "=");
		}
		function peg$f23(tok) {
			return tok;
		}
		function peg$f24(tok) {
			return options.isChar(tok, "[");
		}
		function peg$f25(tok) {
			return tok;
		}
		function peg$f26(tok) {
			return options.isChar(tok, "]");
		}
		function peg$f27(tok) {
			return tok;
		}
		function peg$f28(tok) {
			return options.isChar(tok, "(");
		}
		function peg$f29(tok) {
			return tok;
		}
		function peg$f30(tok) {
			return options.isChar(tok, ")");
		}
		function peg$f31(tok) {
			return tok;
		}
		function peg$f32(tok) {
			return options.isChar(tok, "+");
		}
		function peg$f33(tok) {
			return tok;
		}
		function peg$f34(tok) {
			return options.isChar(tok, "-");
		}
		function peg$f35(tok) {
			return tok;
		}
		function peg$f36(tok) {
			return options.isChar(tok, "|");
		}
		function peg$f37(tok) {
			return tok;
		}
		function peg$f38(tok) {
			return options.isChar(tok, ".");
		}
		function peg$f39(tok) {
			return tok;
		}
		function peg$f40(tok) {
			return options.isChar(tok, "controls");
		}
		function peg$f41(tok) {
			return tok;
		}
		function peg$f42(tok) {
			return options.isChar(tok, "and");
		}
		function peg$f43(tok) {
			return tok;
		}
		function peg$f44(tok) {
			return options.isChar(tok, "svg");
		}
		function peg$f45(tok) {
			return tok;
		}
		function peg$f46(tok) {
			return options.isGroup(tok);
		}
		function peg$f47(tok) {
			return tok;
		}
		function peg$f48(tok) {
			return options.isAnyMacro(tok);
		}
		function peg$f49(tok) {
			return tok;
		}
		function peg$f50(tok) {
			return options.isChar(tok, "foreach");
		}
		function peg$f51(tok) {
			return tok;
		}
		function peg$f52(tok) {
			return options.isMacro(tok, "foreach");
		}
		function peg$f53(tok) {
			return tok;
		}
		function peg$f54(tok) {
			return options.isChar(tok, "in");
		}
		function peg$f55(tok) {
			return tok;
		}
		function peg$f56(tok) {
			return options.isChar(tok, ":");
		}
		function peg$f57(tok) {
			return tok;
		}
		let peg$currPos = options.peg$currPos | 0;
		const peg$posDetailsCache = [{
			line: 1,
			column: 1
		}];
		let peg$maxFailPos = peg$currPos;
		let peg$maxFailExpected = options.peg$maxFailExpected || [];
		let peg$silentFails = options.peg$silentFails | 0;
		let peg$result;
		if (options.startRule) {
			if (!(options.startRule in peg$startRuleFunctions)) throw new Error(`Can't start parsing from rule "` + options.startRule + "\".");
			peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
		}
		function peg$getUnicode(pos = peg$currPos) {
			const cp = input.codePointAt(pos);
			if (cp === void 0) return "";
			return String.fromCodePoint(cp);
		}
		function peg$anyExpectation() {
			return { type: "any" };
		}
		function peg$endExpectation() {
			return { type: "end" };
		}
		function peg$otherExpectation(description) {
			return {
				type: "other",
				description
			};
		}
		function peg$computePosDetails(pos) {
			let details = peg$posDetailsCache[pos];
			let p;
			if (details) return details;
			else {
				if (pos >= peg$posDetailsCache.length) p = peg$posDetailsCache.length - 1;
				else {
					p = pos;
					while (!peg$posDetailsCache[--p]);
				}
				details = peg$posDetailsCache[p];
				details = {
					line: details.line,
					column: details.column
				};
				while (p < pos) {
					if (input.charCodeAt(p) === 10) {
						details.line++;
						details.column = 1;
					} else details.column++;
					p++;
				}
				peg$posDetailsCache[pos] = details;
				return details;
			}
		}
		function peg$computeLocation(startPos, endPos, offset2) {
			const startPosDetails = peg$computePosDetails(startPos);
			const endPosDetails = peg$computePosDetails(endPos);
			const res = {
				source: peg$source,
				start: {
					offset: startPos,
					line: startPosDetails.line,
					column: startPosDetails.column
				},
				end: {
					offset: endPos,
					line: endPosDetails.line,
					column: endPosDetails.column
				}
			};
			if (offset2 && peg$source && typeof peg$source.offset === "function") {
				res.start = peg$source.offset(res.start);
				res.end = peg$source.offset(res.end);
			}
			return res;
		}
		function peg$fail(expected2) {
			if (peg$currPos < peg$maxFailPos) return;
			if (peg$currPos > peg$maxFailPos) {
				peg$maxFailPos = peg$currPos;
				peg$maxFailExpected = [];
			}
			peg$maxFailExpected.push(expected2);
		}
		function peg$buildStructuredError(expected2, found, location2) {
			return new peg$SyntaxError(peg$SyntaxError.buildMessage(expected2, found), expected2, found, location2);
		}
		function peg$parsepath_spec() {
			let s0, s1, s2, s3, s4, s5;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$currPos;
			s3 = peg$parsesquare_brace_group();
			if (s3 === peg$FAILED) {
				s3 = peg$parsecoordinate();
				if (s3 === peg$FAILED) {
					s3 = peg$parsecurve_to();
					if (s3 === peg$FAILED) {
						s3 = peg$parseline_to();
						if (s3 === peg$FAILED) {
							s3 = peg$parsesvg();
							if (s3 === peg$FAILED) {
								s3 = peg$parseforeach();
								if (s3 === peg$FAILED) {
									s3 = peg$parseoperation();
									if (s3 === peg$FAILED) {
										s3 = peg$parsecomment();
										if (s3 === peg$FAILED) {
											s3 = peg$parseanimation();
											if (s3 === peg$FAILED) s3 = peg$parseunknown();
										}
									}
								}
							}
						}
					}
				}
			}
			if (s3 !== peg$FAILED) {
				s4 = [];
				s5 = peg$parse_();
				while (s5 !== peg$FAILED) {
					s4.push(s5);
					s5 = peg$parse_();
				}
				s2 = peg$f0(s3);
			} else {
				peg$currPos = s2;
				s2 = peg$FAILED;
			}
			if (s2 !== peg$FAILED) while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$currPos;
				s3 = peg$parsesquare_brace_group();
				if (s3 === peg$FAILED) {
					s3 = peg$parsecoordinate();
					if (s3 === peg$FAILED) {
						s3 = peg$parsecurve_to();
						if (s3 === peg$FAILED) {
							s3 = peg$parseline_to();
							if (s3 === peg$FAILED) {
								s3 = peg$parsesvg();
								if (s3 === peg$FAILED) {
									s3 = peg$parseforeach();
									if (s3 === peg$FAILED) {
										s3 = peg$parseoperation();
										if (s3 === peg$FAILED) {
											s3 = peg$parsecomment();
											if (s3 === peg$FAILED) {
												s3 = peg$parseanimation();
												if (s3 === peg$FAILED) s3 = peg$parseunknown();
											}
										}
									}
								}
							}
						}
					}
				}
				if (s3 !== peg$FAILED) {
					s4 = [];
					s5 = peg$parse_();
					while (s5 !== peg$FAILED) {
						s4.push(s5);
						s5 = peg$parse_();
					}
					s2 = peg$f0(s3);
				} else {
					peg$currPos = s2;
					s2 = peg$FAILED;
				}
			}
			else s1 = peg$FAILED;
			if (s1 !== peg$FAILED) s1 = peg$f1(s1);
			s0 = s1;
			return s0;
		}
		function peg$parseanimation() {
			let s0, s1, s2, s3, s4, s5, s6;
			s0 = peg$currPos;
			s1 = peg$parsecolon();
			if (s1 !== peg$FAILED) {
				s2 = peg$parse_comment_();
				s3 = [];
				s4 = peg$currPos;
				s5 = peg$parseoperation();
				if (s5 !== peg$FAILED) {
					s6 = peg$parse_comment_();
					s4 = peg$f2(s2, s5, s6);
				} else {
					peg$currPos = s4;
					s4 = peg$FAILED;
				}
				if (s4 !== peg$FAILED) while (s4 !== peg$FAILED) {
					s3.push(s4);
					s4 = peg$currPos;
					s5 = peg$parseoperation();
					if (s5 !== peg$FAILED) {
						s6 = peg$parse_comment_();
						s4 = peg$f2(s2, s5, s6);
					} else {
						peg$currPos = s4;
						s4 = peg$FAILED;
					}
				}
				else s3 = peg$FAILED;
				if (s3 !== peg$FAILED) {
					s4 = peg$parseequals();
					if (s4 !== peg$FAILED) {
						s5 = peg$parse_comment_();
						s6 = peg$parsegroup();
						if (s6 !== peg$FAILED) s0 = peg$f3(s2, s3, s5, s6);
						else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseforeach() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = peg$parseforeach_keyword();
			if (s1 === peg$FAILED) s1 = peg$parseforeach_macro();
			if (s1 !== peg$FAILED) {
				s2 = peg$parseforeach_body();
				if (s2 !== peg$FAILED) s0 = peg$f4(s1, s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseforeach_body() {
			let s0, s1, s2, s3, s4, s5, s6, s7, s8, s9;
			s0 = peg$currPos;
			s1 = peg$parse_comment_();
			s2 = peg$currPos;
			s3 = [];
			s4 = peg$currPos;
			s5 = peg$currPos;
			peg$silentFails++;
			s6 = peg$parsein_keyword();
			if (s6 === peg$FAILED) s6 = peg$parsesquare_brace_group();
			peg$silentFails--;
			if (s6 === peg$FAILED) s5 = void 0;
			else {
				peg$currPos = s5;
				s5 = peg$FAILED;
			}
			if (s5 !== peg$FAILED) {
				if (input.length > peg$currPos) {
					s6 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s6 = peg$FAILED;
					if (peg$silentFails === 0) peg$fail(peg$e0);
				}
				if (s6 !== peg$FAILED) {
					s5 = [s5, s6];
					s4 = s5;
				} else {
					peg$currPos = s4;
					s4 = peg$FAILED;
				}
			} else {
				peg$currPos = s4;
				s4 = peg$FAILED;
			}
			while (s4 !== peg$FAILED) {
				s3.push(s4);
				s4 = peg$currPos;
				s5 = peg$currPos;
				peg$silentFails++;
				s6 = peg$parsein_keyword();
				if (s6 === peg$FAILED) s6 = peg$parsesquare_brace_group();
				peg$silentFails--;
				if (s6 === peg$FAILED) s5 = void 0;
				else {
					peg$currPos = s5;
					s5 = peg$FAILED;
				}
				if (s5 !== peg$FAILED) {
					if (input.length > peg$currPos) {
						s6 = input.charAt(peg$currPos);
						peg$currPos++;
					} else {
						s6 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e0);
					}
					if (s6 !== peg$FAILED) {
						s5 = [s5, s6];
						s4 = s5;
					} else {
						peg$currPos = s4;
						s4 = peg$FAILED;
					}
				} else {
					peg$currPos = s4;
					s4 = peg$FAILED;
				}
			}
			s2 = input.substring(s2, peg$currPos);
			s3 = peg$parsesquare_brace_group();
			if (s3 === peg$FAILED) s3 = null;
			s4 = peg$parse_comment_();
			s5 = peg$parsein_keyword();
			if (s5 !== peg$FAILED) {
				s6 = peg$parse_comment_();
				s7 = peg$parsegroup();
				if (s7 === peg$FAILED) s7 = peg$parsemacro();
				if (s7 !== peg$FAILED) {
					s8 = peg$parse_comment_();
					s9 = peg$parseforeach();
					if (s9 === peg$FAILED) {
						s9 = peg$parsegroup();
						if (s9 === peg$FAILED) s9 = peg$parsemacro();
					}
					if (s9 !== peg$FAILED) s0 = peg$f5(s1, s2, s3, s4, s6, s7, s8, s9);
					else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsesvg() {
			let s0, s1, s2, s3, s4, s5;
			s0 = peg$currPos;
			s1 = peg$parsesvg_keyword();
			if (s1 !== peg$FAILED) {
				s2 = peg$parse_comment_();
				s3 = peg$parsesquare_brace_group();
				if (s3 === peg$FAILED) s3 = null;
				s4 = peg$parse_comment_();
				s5 = peg$parsegroup();
				if (s5 !== peg$FAILED) s0 = peg$f6(s2, s3, s4, s5);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsecurve_to() {
			let s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10;
			s0 = peg$currPos;
			s1 = peg$parsedotdot();
			if (s1 !== peg$FAILED) {
				s2 = peg$parse_comment_();
				s3 = peg$parsecontrols_keyword();
				if (s3 !== peg$FAILED) {
					s4 = peg$parse_comment_();
					s5 = peg$parsecoordinate();
					if (s5 !== peg$FAILED) {
						s6 = peg$parse_comment_();
						s7 = peg$currPos;
						s8 = peg$parseand_keyword();
						if (s8 !== peg$FAILED) {
							s9 = peg$parse_comment_();
							s10 = peg$parsecoordinate();
							if (s10 !== peg$FAILED) s7 = peg$f7(s2, s4, s5, s6, s9, s10);
							else {
								peg$currPos = s7;
								s7 = peg$FAILED;
							}
						} else {
							peg$currPos = s7;
							s7 = peg$FAILED;
						}
						if (s7 === peg$FAILED) s7 = null;
						s8 = peg$parse_comment_();
						s9 = peg$parsedotdot();
						if (s9 !== peg$FAILED) s0 = peg$f8(s2, s4, s5, s6, s7, s8);
						else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseline_to() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = peg$parsepipe();
			if (s1 !== peg$FAILED) {
				s2 = peg$parseminus();
				if (s2 !== peg$FAILED) s0 = peg$f9();
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			if (s0 === peg$FAILED) {
				s0 = peg$currPos;
				s1 = peg$parseminus();
				if (s1 !== peg$FAILED) {
					s2 = peg$parsepipe();
					if (s2 !== peg$FAILED) s0 = peg$f10();
					else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
				if (s0 === peg$FAILED) {
					s0 = peg$currPos;
					s1 = peg$parseminus();
					if (s1 !== peg$FAILED) {
						s2 = peg$parseminus();
						if (s2 !== peg$FAILED) s0 = peg$f11();
						else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				}
			}
			return s0;
		}
		function peg$parsecoordinate() {
			let s0, s1, s2, s3, s4, s5, s6, s7;
			s0 = peg$currPos;
			s1 = peg$currPos;
			s2 = peg$currPos;
			s3 = peg$parseplus();
			if (s3 !== peg$FAILED) {
				s4 = peg$parseplus();
				if (s4 === peg$FAILED) s4 = null;
				s3 = [s3, s4];
				s2 = s3;
			} else {
				peg$currPos = s2;
				s2 = peg$FAILED;
			}
			if (s2 === peg$FAILED) s2 = null;
			s1 = input.substring(s1, peg$currPos);
			s2 = peg$parseopen_paren();
			if (s2 !== peg$FAILED) {
				s3 = peg$currPos;
				s4 = [];
				s5 = peg$currPos;
				s6 = peg$currPos;
				peg$silentFails++;
				s7 = peg$parseclose_paren();
				peg$silentFails--;
				if (s7 === peg$FAILED) s6 = void 0;
				else {
					peg$currPos = s6;
					s6 = peg$FAILED;
				}
				if (s6 !== peg$FAILED) {
					if (input.length > peg$currPos) {
						s7 = input.charAt(peg$currPos);
						peg$currPos++;
					} else {
						s7 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e0);
					}
					if (s7 !== peg$FAILED) {
						s6 = [s6, s7];
						s5 = s6;
					} else {
						peg$currPos = s5;
						s5 = peg$FAILED;
					}
				} else {
					peg$currPos = s5;
					s5 = peg$FAILED;
				}
				while (s5 !== peg$FAILED) {
					s4.push(s5);
					s5 = peg$currPos;
					s6 = peg$currPos;
					peg$silentFails++;
					s7 = peg$parseclose_paren();
					peg$silentFails--;
					if (s7 === peg$FAILED) s6 = void 0;
					else {
						peg$currPos = s6;
						s6 = peg$FAILED;
					}
					if (s6 !== peg$FAILED) {
						if (input.length > peg$currPos) {
							s7 = input.charAt(peg$currPos);
							peg$currPos++;
						} else {
							s7 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e0);
						}
						if (s7 !== peg$FAILED) {
							s6 = [s6, s7];
							s5 = s6;
						} else {
							peg$currPos = s5;
							s5 = peg$FAILED;
						}
					} else {
						peg$currPos = s5;
						s5 = peg$FAILED;
					}
				}
				s3 = input.substring(s3, peg$currPos);
				s4 = peg$parseclose_paren();
				if (s4 !== peg$FAILED) s0 = peg$f12(s1, s3);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsesquare_brace_group() {
			let s0, s1, s2, s3, s4, s5, s6;
			s0 = peg$currPos;
			s1 = peg$parseopen_square_brace();
			if (s1 !== peg$FAILED) {
				s2 = peg$currPos;
				s3 = [];
				s4 = peg$currPos;
				s5 = peg$currPos;
				peg$silentFails++;
				s6 = peg$parseclose_square_brace();
				peg$silentFails--;
				if (s6 === peg$FAILED) s5 = void 0;
				else {
					peg$currPos = s5;
					s5 = peg$FAILED;
				}
				if (s5 !== peg$FAILED) {
					if (input.length > peg$currPos) {
						s6 = input.charAt(peg$currPos);
						peg$currPos++;
					} else {
						s6 = peg$FAILED;
						if (peg$silentFails === 0) peg$fail(peg$e0);
					}
					if (s6 !== peg$FAILED) {
						s5 = [s5, s6];
						s4 = s5;
					} else {
						peg$currPos = s4;
						s4 = peg$FAILED;
					}
				} else {
					peg$currPos = s4;
					s4 = peg$FAILED;
				}
				while (s4 !== peg$FAILED) {
					s3.push(s4);
					s4 = peg$currPos;
					s5 = peg$currPos;
					peg$silentFails++;
					s6 = peg$parseclose_square_brace();
					peg$silentFails--;
					if (s6 === peg$FAILED) s5 = void 0;
					else {
						peg$currPos = s5;
						s5 = peg$FAILED;
					}
					if (s5 !== peg$FAILED) {
						if (input.length > peg$currPos) {
							s6 = input.charAt(peg$currPos);
							peg$currPos++;
						} else {
							s6 = peg$FAILED;
							if (peg$silentFails === 0) peg$fail(peg$e0);
						}
						if (s6 !== peg$FAILED) {
							s5 = [s5, s6];
							s4 = s5;
						} else {
							peg$currPos = s4;
							s4 = peg$FAILED;
						}
					} else {
						peg$currPos = s4;
						s4 = peg$FAILED;
					}
				}
				s2 = input.substring(s2, peg$currPos);
				s3 = peg$parseclose_square_brace();
				if (s3 !== peg$FAILED) s0 = peg$f13(s2);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsedotdot() {
			let s0, s1, s2;
			s0 = peg$currPos;
			s1 = peg$parsedot();
			if (s1 !== peg$FAILED) {
				s2 = peg$parsedot();
				if (s2 !== peg$FAILED) {
					s1 = [s1, s2];
					s0 = s1;
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseunknown() {
			let s0, s1;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) s1 = peg$f14(s1);
			s0 = s1;
			return s0;
		}
		function peg$parsecomment() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f15(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f16(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e1);
			}
			return s0;
		}
		function peg$parse_() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f17(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f18(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parse_comment_() {
			let s0, s1, s2, s3, s4;
			peg$silentFails++;
			s0 = peg$currPos;
			s1 = [];
			s2 = peg$parse_();
			while (s2 !== peg$FAILED) {
				s1.push(s2);
				s2 = peg$parse_();
			}
			s2 = peg$parsecomment();
			if (s2 === peg$FAILED) s2 = null;
			s3 = [];
			s4 = peg$parse_();
			while (s4 !== peg$FAILED) {
				s3.push(s4);
				s4 = peg$parse_();
			}
			s0 = peg$f19(s2);
			peg$silentFails--;
			return s0;
		}
		function peg$parseoperation() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f20(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f21(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e2);
			}
			return s0;
		}
		function peg$parseequals() {
			let s0, s1, s2;
			peg$silentFails++;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f22(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f23(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			peg$silentFails--;
			if (s0 === peg$FAILED) {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e3);
			}
			return s0;
		}
		function peg$parseopen_square_brace() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f24(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f25(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseclose_square_brace() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f26(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f27(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseopen_paren() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f28(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f29(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseclose_paren() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f30(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f31(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseplus() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f32(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f33(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseminus() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f34(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f35(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsepipe() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f36(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f37(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsedot() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f38(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f39(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsecontrols_keyword() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f40(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f41(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseand_keyword() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f42(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f43(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsesvg_keyword() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f44(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f45(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsegroup() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f46(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f47(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsemacro() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f48(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f49(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseforeach_keyword() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f50(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f51(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parseforeach_macro() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f52(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f53(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsein_keyword() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f54(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f55(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		function peg$parsecolon() {
			let s0, s1, s2;
			s0 = peg$currPos;
			if (input.length > peg$currPos) {
				s1 = input.charAt(peg$currPos);
				peg$currPos++;
			} else {
				s1 = peg$FAILED;
				if (peg$silentFails === 0) peg$fail(peg$e0);
			}
			if (s1 !== peg$FAILED) {
				s2 = peg$f56(s1);
				if (s2) s2 = void 0;
				else s2 = peg$FAILED;
				if (s2 !== peg$FAILED) s0 = peg$f57(s1);
				else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
			} else {
				peg$currPos = s0;
				s0 = peg$FAILED;
			}
			return s0;
		}
		if (!options.isWhitespace) try {
			Object.assign(options, {
				isChar: (node, char) => node.type === "string" && node.content === char,
				isOperation: (node) => node.type === "string" && node.content.match(/[a-zA-Z]/),
				isWhitespace: (node) => node.type === "whitespace" || node.type === "parbreak",
				isSameLineComment: (node) => node.type === "comment" && node.sameline,
				isOwnLineComment: (node) => node.type === "comment" && !node.sameline,
				isComment: (node) => node.type === "comment",
				isGroup: (node) => node.type === "group",
				isMacro: (node, name) => node.type === "macro" && node.content === name,
				isAnyMacro: (node) => node.type === "macro"
			});
		} catch (e) {
			console.warn("Error when initializing parser", e);
		}
		peg$result = peg$startRuleFunction();
		const peg$success = peg$result !== peg$FAILED && peg$currPos === input.length;
		function peg$throw() {
			if (peg$result !== peg$FAILED && peg$currPos < input.length) peg$fail(peg$endExpectation());
			throw peg$buildStructuredError(peg$maxFailExpected, peg$maxFailPos < input.length ? peg$getUnicode(peg$maxFailPos) : null, peg$maxFailPos < input.length ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1) : peg$computeLocation(peg$maxFailPos, peg$maxFailPos));
		}
		if (options.peg$library) return (
		/** @type {any} */
		{
			peg$result,
			peg$currPos,
			peg$FAILED,
			peg$maxFailExpected,
			peg$maxFailPos,
			peg$success,
			peg$throw: peg$success ? void 0 : peg$throw
		});
		if (peg$success) return peg$result;
		else peg$throw();
	}
	return {
		StartRules: ["path_spec", "foreach_body"],
		SyntaxError: peg$SyntaxError,
		parse: peg$parse
	};
})();
//#endregion
//#region libs/pegjs-parsers.ts
var LatexPegParser = latex_default;
var AlignEnvironmentPegParser = align_environment_default;
var ArgSpecPegParser = xparse_argspec_default;
var PgfkeysPegParser = pgfkeys_default;
var MacroSubstitutionPegParser = macro_substitutions_default;
var LigaturesPegParser = ligatures_default;
var XColorPegParser = xcolor_expressions_default;
var TabularPegParser = tabular_spec_default;
var SystemePegParser = systeme_environment_default;
var GluePegParser = tex_glue_default;
var TikzPegParser = tikz_default;
//#endregion
//#region index.ts
/**
* ## What is this?
*
* Pegjs grammars to help parse strings into a `unified-latex` Abstract Syntax Tree (AST). Note,
* because of the dynamic nature of LaTeX, to get a full AST with arguments attached to macros, etc.,
* the tree is parsed multiple times.
*
* Also included are functions to decorate a `Ast.Node[]` array so that Pegjs can process it as if it were
* a string. This allows for complex second-pass parsing.
*
* ## When should I use this?
*
* If you are building libraries to parse specific LaTeX syntax (e.g., to parse `tabular` environments or
* `systeme` environments, etc.).
*/
//#endregion
exports.AlignEnvironmentPegParser = AlignEnvironmentPegParser;
exports.ArgSpecPegParser = ArgSpecPegParser;
exports.GluePegParser = GluePegParser;
exports.LatexPegParser = LatexPegParser;
exports.LigaturesPegParser = LigaturesPegParser;
exports.MacroSubstitutionPegParser = MacroSubstitutionPegParser;
exports.PgfkeysPegParser = PgfkeysPegParser;
exports.SystemePegParser = SystemePegParser;
exports.TabularPegParser = TabularPegParser;
exports.TikzPegParser = TikzPegParser;
exports.XColorPegParser = XColorPegParser;
exports.decorateArrayForPegjs = decorateArrayForPegjs;
exports.splitStringsIntoSingleChars = splitStringsIntoSingleChars;

//# sourceMappingURL=index.cjs.map