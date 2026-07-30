import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { createThemeResolver } from "@pierre/theming";
import { diffChars, diffWordsWithSpace } from "diff";
import { transformerStyleToClass } from "@shikijs/transformers";
import { normalizeThemeColors } from "@pierre/theming/color";
(() => {
	try {
		return process.env.NODE_ENV === "development";
	} catch {
		return false;
	}
})();
const SPLIT_WITH_NEWLINES = /(?<=\n)/;
const DEFAULT_THEMES = {
	dark: "pierre-dark",
	light: "pierre-light"
};
Object.freeze({
	fromStart: 0,
	fromEnd: 0
});
//#endregion
//#region src/highlighter/languages/constants.ts
const ResolvedLanguages = /* @__PURE__ */ new Map();
const AttachedLanguages = /* @__PURE__ */ new Set();
//#endregion
//#region src/highlighter/languages/attachResolvedLanguages.ts
function attachResolvedLanguages(resolvedLanguages, highlighter) {
	resolvedLanguages = Array.isArray(resolvedLanguages) ? resolvedLanguages : [resolvedLanguages];
	for (const resolvedLang of resolvedLanguages) {
		if (AttachedLanguages.has(resolvedLang.name)) continue;
		let lang = ResolvedLanguages.get(resolvedLang.name);
		if (lang == null) {
			lang = resolvedLang;
			ResolvedLanguages.set(resolvedLang.name, lang);
		}
		AttachedLanguages.add(lang.name);
		highlighter.loadLanguageSync(lang.data);
	}
}
//#endregion
//#region src/highlighter/themes/constants.ts
const AttachedThemes = /* @__PURE__ */ new Set();
//#endregion
//#region src/highlighter/themes/themeResolver.ts
const themeResolver = createThemeResolver();
//#endregion
//#region src/highlighter/themes/attachResolvedThemes.ts
function attachResolvedThemes(themes, highlighter) {
	themes = Array.isArray(themes) ? themes : [themes];
	for (let themeRef of themes) {
		let resolvedTheme;
		if (typeof themeRef === "string") {
			resolvedTheme = themeResolver.getResolvedTheme(themeRef);
			if (resolvedTheme == null) throw new Error(`loadResolvedThemes: ${themeRef} is not resolved, you must resolve it before calling loadResolvedThemes`);
		} else {
			resolvedTheme = themeRef;
			themeRef = themeRef.name;
			if (themeResolver.getResolvedTheme(themeRef) == null) themeResolver.seedResolvedTheme(themeRef, resolvedTheme);
		}
		if (AttachedThemes.has(themeRef)) continue;
		AttachedThemes.add(themeRef);
		highlighter.loadThemeSync(resolvedTheme);
	}
}
//#endregion
//#region src/utils/getFiletypeFromFileName.ts
const CUSTOM_EXTENSION_TO_FILE_FORMAT = /* @__PURE__ */ new Map();
let customExtensionsVersion = 0;
const EXTENSION_TO_FILE_FORMAT = {
	"1c": "1c",
	abap: "abap",
	as: "actionscript-3",
	ada: "ada",
	adb: "ada",
	ads: "ada",
	adoc: "asciidoc",
	asciidoc: "asciidoc",
	"component.html": "angular-html",
	"component.ts": "angular-ts",
	conf: "nginx",
	htaccess: "apache",
	cls: "tex",
	trigger: "apex",
	apl: "apl",
	applescript: "applescript",
	scpt: "applescript",
	ara: "ara",
	asm: "asm",
	s: "riscv",
	astro: "astro",
	awk: "awk",
	bal: "ballerina",
	sh: "zsh",
	bash: "zsh",
	bat: "cmd",
	cmd: "cmd",
	be: "berry",
	beancount: "beancount",
	bib: "bibtex",
	bicep: "bicep",
	"blade.php": "blade",
	bsl: "bsl",
	c: "c",
	h: "objective-cpp",
	cs: "csharp",
	cpp: "cpp",
	hpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	hh: "cpp",
	cdc: "cdc",
	cairo: "cairo",
	clar: "clarity",
	clj: "clojure",
	cljs: "clojure",
	cljc: "clojure",
	soy: "soy",
	cmake: "cmake",
	"CMakeLists.txt": "cmake",
	cob: "cobol",
	cbl: "cobol",
	cobol: "cobol",
	CODEOWNERS: "codeowners",
	ql: "ql",
	coffee: "coffeescript",
	lisp: "lisp",
	cl: "lisp",
	lsp: "lisp",
	log: "log",
	v: "verilog",
	cql: "cql",
	cr: "crystal",
	css: "css",
	csv: "csv",
	cue: "cue",
	cypher: "cypher",
	cyp: "cypher",
	d: "d",
	dart: "dart",
	dax: "dax",
	desktop: "desktop",
	diff: "diff",
	patch: "diff",
	Dockerfile: "dockerfile",
	dockerfile: "dockerfile",
	env: "dotenv",
	dm: "dream-maker",
	edge: "edge",
	el: "emacs-lisp",
	ex: "elixir",
	exs: "elixir",
	elm: "elm",
	erb: "erb",
	erl: "erlang",
	hrl: "erlang",
	f: "fortran-fixed-form",
	for: "fortran-fixed-form",
	fs: "fsharp",
	fsi: "fsharp",
	fsx: "fsharp",
	f03: "f03",
	f08: "f08",
	f18: "f18",
	f77: "f77",
	f90: "fortran-free-form",
	f95: "fortran-free-form",
	fnl: "fennel",
	fish: "fish",
	ftl: "ftl",
	tres: "gdresource",
	res: "gdresource",
	gd: "gdscript",
	gdshader: "gdshader",
	gs: "genie",
	feature: "gherkin",
	COMMIT_EDITMSG: "git-commit",
	"git-rebase-todo": "git-rebase",
	gjs: "glimmer-js",
	gleam: "gleam",
	gts: "glimmer-ts",
	glsl: "glsl",
	vert: "glsl",
	frag: "glsl",
	shader: "shaderlab",
	gp: "gnuplot",
	plt: "gnuplot",
	gnuplot: "gnuplot",
	go: "go",
	graphql: "graphql",
	gql: "graphql",
	groovy: "groovy",
	gvy: "groovy",
	hack: "hack",
	haml: "haml",
	hbs: "handlebars",
	handlebars: "handlebars",
	hs: "haskell",
	lhs: "haskell",
	hx: "haxe",
	hcl: "hcl",
	hjson: "hjson",
	hlsl: "hlsl",
	fx: "hlsl",
	html: "html",
	htm: "html",
	http: "http",
	rest: "http",
	hxml: "hxml",
	hy: "hy",
	imba: "imba",
	ini: "ini",
	cfg: "ini",
	jade: "pug",
	pug: "pug",
	java: "java",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jinja: "jinja",
	jinja2: "jinja",
	j2: "jinja",
	jison: "jison",
	jl: "julia",
	json: "json",
	json5: "json5",
	jsonc: "jsonc",
	jsonl: "jsonl",
	jsonnet: "jsonnet",
	libsonnet: "jsonnet",
	jssm: "jssm",
	jsx: "jsx",
	kt: "kotlin",
	kts: "kts",
	kql: "kusto",
	tex: "tex",
	ltx: "tex",
	lean: "lean4",
	less: "less",
	liquid: "liquid",
	lit: "lit",
	ll: "llvm",
	logo: "logo",
	lua: "lua",
	luau: "luau",
	Makefile: "makefile",
	mk: "makefile",
	makefile: "makefile",
	md: "markdown",
	markdown: "markdown",
	marko: "marko",
	m: "wolfram",
	mat: "matlab",
	mdc: "mdc",
	mdx: "mdx",
	wiki: "wikitext",
	mediawiki: "wikitext",
	mmd: "mermaid",
	mermaid: "mermaid",
	mips: "mipsasm",
	mojo: "mojo",
	"🔥": "mojo",
	move: "move",
	nar: "narrat",
	nf: "nextflow",
	nim: "nim",
	nims: "nim",
	nimble: "nim",
	nix: "nix",
	nu: "nushell",
	mm: "objective-cpp",
	ml: "ocaml",
	mli: "ocaml",
	mll: "ocaml",
	mly: "ocaml",
	pas: "pascal",
	p: "pascal",
	pl: "prolog",
	pm: "perl",
	t: "perl",
	raku: "raku",
	p6: "raku",
	pl6: "raku",
	php: "php",
	phtml: "php",
	pls: "plsql",
	sql: "sql",
	po: "po",
	polar: "polar",
	pcss: "postcss",
	pot: "pot",
	potx: "potx",
	pq: "powerquery",
	pqm: "powerquery",
	ps1: "powershell",
	psm1: "powershell",
	psd1: "powershell",
	prisma: "prisma",
	pro: "prolog",
	P: "prolog",
	properties: "properties",
	proto: "protobuf",
	pp: "puppet",
	purs: "purescript",
	py: "python",
	pyw: "python",
	pyi: "python",
	qml: "qml",
	qmldir: "qmldir",
	qss: "qss",
	r: "r",
	R: "r",
	rkt: "racket",
	rktl: "racket",
	razor: "razor",
	cshtml: "razor",
	rb: "ruby",
	rbw: "ruby",
	reg: "reg",
	regex: "regexp",
	rel: "rel",
	rs: "rust",
	rst: "rst",
	rake: "ruby",
	gemspec: "ruby",
	jbuilder: "ruby",
	builder: "ruby",
	rabl: "ruby",
	arb: "ruby",
	ru: "ruby",
	podspec: "ruby",
	Gemfile: "ruby",
	Rakefile: "ruby",
	Guardfile: "ruby",
	Capfile: "ruby",
	Berksfile: "ruby",
	Brewfile: "ruby",
	Vagrantfile: "ruby",
	Thorfile: "ruby",
	Appraisals: "ruby",
	Dangerfile: "ruby",
	sas: "sas",
	sass: "sass",
	scala: "scala",
	sc: "scala",
	scm: "scheme",
	ss: "scheme",
	sld: "scheme",
	scss: "scss",
	sdbl: "sdbl",
	shadergraph: "shader",
	st: "smalltalk",
	sol: "solidity",
	sparql: "sparql",
	rq: "sparql",
	spl: "splunk",
	config: "ssh-config",
	do: "stata",
	ado: "stata",
	dta: "stata",
	styl: "stylus",
	stylus: "stylus",
	svelte: "svelte",
	swift: "swift",
	sv: "system-verilog",
	svh: "system-verilog",
	service: "systemd",
	socket: "systemd",
	device: "systemd",
	timer: "systemd",
	talon: "talonscript",
	tasl: "tasl",
	tcl: "tcl",
	templ: "templ",
	tf: "tf",
	tfvars: "tfvars",
	toml: "toml",
	ts: "typescript",
	tsp: "typespec",
	tsv: "tsv",
	tsx: "tsx",
	ttl: "turtle",
	twig: "twig",
	typ: "typst",
	vv: "v",
	vala: "vala",
	vapi: "vala",
	vb: "vb",
	vbs: "vb",
	bas: "vb",
	vh: "verilog",
	vhd: "vhdl",
	vhdl: "vhdl",
	vim: "vimscript",
	vue: "vue",
	"vine.ts": "vue-vine",
	vy: "vyper",
	wasm: "wasm",
	wat: "wasm",
	wy: "文言",
	wgsl: "wgsl",
	wit: "wit",
	wl: "wolfram",
	nb: "wolfram",
	xml: "xml",
	xsl: "xsl",
	xslt: "xsl",
	yaml: "yaml",
	yml: "yml",
	zs: "zenscript",
	zig: "zig",
	zsh: "zsh",
	sty: "tex"
};
function getFiletypeFromFileName(fileName) {
	if (CUSTOM_EXTENSION_TO_FILE_FORMAT.has(fileName)) return CUSTOM_EXTENSION_TO_FILE_FORMAT.get(fileName) ?? "text";
	if (EXTENSION_TO_FILE_FORMAT[fileName] != null) return EXTENSION_TO_FILE_FORMAT[fileName];
	const compoundMatch = fileName.match(/\.([^/\\]+\.[^/\\]+)$/);
	if (compoundMatch != null) {
		if (CUSTOM_EXTENSION_TO_FILE_FORMAT.has(compoundMatch[1])) return CUSTOM_EXTENSION_TO_FILE_FORMAT.get(compoundMatch[1]) ?? "text";
		if (EXTENSION_TO_FILE_FORMAT[compoundMatch[1]] != null) return EXTENSION_TO_FILE_FORMAT[compoundMatch[1]] ?? "text";
	}
	const simpleMatch = fileName.match(/\.([^.]+)$/)?.[1] ?? "";
	if (CUSTOM_EXTENSION_TO_FILE_FORMAT.has(simpleMatch)) return CUSTOM_EXTENSION_TO_FILE_FORMAT.get(simpleMatch) ?? "text";
	return EXTENSION_TO_FILE_FORMAT[simpleMatch] ?? "text";
}
function replaceCustomExtensions(version, map) {
	if (version <= customExtensionsVersion) return false;
	CUSTOM_EXTENSION_TO_FILE_FORMAT.clear();
	for (const key in map) {
		const lang = map[key];
		if (lang != null) CUSTOM_EXTENSION_TO_FILE_FORMAT.set(key, lang);
	}
	customExtensionsVersion = version;
	return true;
}
//#endregion
//#region src/utils/cleanLastNewline.ts
function cleanLastNewline(contents) {
	return contents.replace(/\n$|\r\n$/, "");
}
//#endregion
//#region src/utils/hast_utils.ts
function createTextNodeElement(value) {
	return {
		type: "text",
		value
	};
}
function createHastElement({ tagName, children = [], properties = {} }) {
	return {
		type: "element",
		tagName,
		properties,
		children
	};
}
function findCodeElement(nodes) {
	let firstChild = nodes.children[0];
	while (firstChild != null) {
		if (firstChild.type === "element" && firstChild.tagName === "code") return firstChild;
		if ("children" in firstChild) firstChild = firstChild.children[0];
		else firstChild = null;
	}
}
//#endregion
//#region src/utils/processLine.ts
function processLine(node, line, state) {
	const lineInfo = typeof state.lineInfo === "function" ? state.lineInfo(line) : state.lineInfo[line - 1];
	if (lineInfo == null) {
		const errorMessage = `processLine: line ${line}, contains no state.lineInfo`;
		console.error(errorMessage, {
			node,
			line,
			state
		});
		throw new Error(errorMessage);
	}
	node.tagName = "div";
	node.properties["data-line"] = lineInfo.lineNumber;
	node.properties["data-alt-line"] = lineInfo.altLineNumber;
	node.properties["data-line-type"] = lineInfo.type;
	node.properties["data-line-index"] = lineInfo.lineIndex;
	if (node.children.length === 0) node.children.push(createTextNodeElement("\n"));
	return node;
}
//#endregion
//#region src/utils/wrapTokenFragments.ts
const NO_TOKEN = Symbol("no-token");
const MULTIPLE_TOKENS = Symbol("multiple-tokens");
function wrapTokenFragments(container) {
	const ownTokenChar = getTokenChar(container);
	if (ownTokenChar != null) return ownTokenChar;
	let containerTokenState = NO_TOKEN;
	const wrappedChildren = [];
	let currentTokenChildren = [];
	let currentTokenChar;
	const flushTokenChildren = () => {
		if (currentTokenChildren.length === 0 || currentTokenChar == null) {
			currentTokenChildren = [];
			currentTokenChar = void 0;
			return;
		}
		if (currentTokenChildren.length === 1) {
			const child = currentTokenChildren[0];
			if (child?.type === "element") {
				setTokenChar(child, currentTokenChar);
				for (const grandChild of child.children) stripTokenChar(grandChild);
			} else stripTokenChar(child);
			wrappedChildren.push(child);
			currentTokenChildren = [];
			currentTokenChar = void 0;
			return;
		}
		for (const child of currentTokenChildren) stripTokenChar(child);
		wrappedChildren.push(createHastElement({
			tagName: "span",
			properties: { "data-char": currentTokenChar },
			children: currentTokenChildren
		}));
		currentTokenChildren = [];
		currentTokenChar = void 0;
	};
	const mergeContainerTokenState = (childTokenState) => {
		if (childTokenState === NO_TOKEN) return;
		if (childTokenState === MULTIPLE_TOKENS) {
			containerTokenState = MULTIPLE_TOKENS;
			return;
		}
		if (containerTokenState === NO_TOKEN) {
			containerTokenState = childTokenState;
			return;
		}
		if (containerTokenState !== childTokenState) containerTokenState = MULTIPLE_TOKENS;
	};
	for (const child of container.children) {
		const childTokenState = child.type === "element" ? wrapTokenFragments(child) : NO_TOKEN;
		mergeContainerTokenState(childTokenState);
		if (typeof childTokenState !== "number") {
			flushTokenChildren();
			wrappedChildren.push(child);
			continue;
		}
		if (currentTokenChar != null && currentTokenChar !== childTokenState) flushTokenChildren();
		currentTokenChar ??= childTokenState;
		currentTokenChildren.push(child);
	}
	flushTokenChildren();
	container.children = wrappedChildren;
	return containerTokenState;
}
function getTokenChar(node) {
	const value = node.properties["data-char"];
	if (typeof value === "number") return value;
}
function stripTokenChar(node) {
	if (node.type !== "element") return;
	node.properties["data-char"] = void 0;
	for (const child of node.children) stripTokenChar(child);
}
function setTokenChar(node, char) {
	node.properties["data-char"] = char;
}
//#endregion
//#region src/utils/createTransformerWithState.ts
function createTransformerWithState(useTokenTransformer = false, useCSSClasses = false) {
	const state = { lineInfo: [] };
	const transformers = [{
		line(node) {
			delete node.properties.class;
			return node;
		},
		pre(pre) {
			const code = findCodeElement(pre);
			const children = [];
			if (code != null) {
				let index = 1;
				for (const node of code.children) {
					if (node.type !== "element") continue;
					if (useTokenTransformer) wrapTokenFragments(node);
					children.push(processLine(node, index, state));
					index++;
				}
				code.children = children;
			}
			return pre;
		},
		...useTokenTransformer ? {
			tokens(lines) {
				for (const line of lines) {
					let col = 0;
					for (const token of line) {
						const tokenWithOriginalRange = token;
						tokenWithOriginalRange.__lineChar ??= col;
						col += token.content.length;
					}
				}
			},
			preprocess(_code, options) {
				options.mergeWhitespaces = "never";
			},
			span(hast, _line, _char, _lineElement, token) {
				if (token?.offset != null && token.content != null) {
					const tokenChar = token.__lineChar;
					if (tokenChar != null) hast.properties["data-char"] = tokenChar;
					return hast;
				}
				return hast;
			}
		} : null
	}];
	if (useCSSClasses) transformers.push(tokenStyleNormalizer, toClass);
	return {
		state,
		transformers,
		toClass
	};
}
const toClass = transformerStyleToClass({ classPrefix: "hl-" });
const tokenStyleNormalizer = {
	name: "token-style-normalizer",
	tokens(lines) {
		for (const line of lines) for (const token of line) {
			if (token.htmlStyle != null) continue;
			const style = {};
			if (token.color != null) style.color = token.color;
			if (token.bgColor != null) style["background-color"] = token.bgColor;
			if (token.fontStyle != null && token.fontStyle !== 0) {
				if ((token.fontStyle & 1) !== 0) style["font-style"] = "italic";
				if ((token.fontStyle & 2) !== 0) style["font-weight"] = "bold";
				if ((token.fontStyle & 4) !== 0) style["text-decoration"] = "underline";
			}
			if (Object.keys(style).length > 0) token.htmlStyle = style;
		}
	}
};
//#endregion
//#region src/utils/formatCSSVariablePrefix.ts
function formatCSSVariablePrefix(type) {
	return `--${type === "token" ? "diffs-token" : "diffs"}-`;
}
//#endregion
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
//#region src/utils/getLineNodes.ts
function getLineNodes(nodes) {
	let firstChild = nodes.children[0];
	while (firstChild != null) {
		if (firstChild.type === "element" && firstChild.tagName === "code") return firstChild.children;
		if ("children" in firstChild) firstChild = firstChild.children[0];
		else firstChild = null;
	}
	console.error(nodes);
	throw new Error("getLineNodes: Unable to find children");
}
//#endregion
//#region src/utils/virtualDiffLayout.ts
function getExpandedRegion({ isPartial, rangeSize, expandedHunks, hunkIndex, collapsedContextThreshold }) {
	const normalizedRangeSize = Math.max(rangeSize, 0);
	if (normalizedRangeSize === 0 || isPartial) return {
		fromStart: 0,
		fromEnd: 0,
		rangeSize: normalizedRangeSize,
		collapsedLines: normalizedRangeSize,
		renderAll: false
	};
	if (expandedHunks === true || normalizedRangeSize <= collapsedContextThreshold) return {
		fromStart: normalizedRangeSize,
		fromEnd: 0,
		rangeSize: normalizedRangeSize,
		collapsedLines: 0,
		renderAll: true
	};
	const region = expandedHunks?.get(hunkIndex);
	const fromStart = Math.min(Math.max(region?.fromStart ?? 0, 0), normalizedRangeSize);
	const fromEnd = Math.min(Math.max(region?.fromEnd ?? 0, 0), normalizedRangeSize);
	const expandedCount = fromStart + fromEnd;
	const renderAll = expandedCount >= normalizedRangeSize;
	return {
		fromStart: renderAll ? normalizedRangeSize : fromStart,
		fromEnd: renderAll ? 0 : fromEnd,
		rangeSize: normalizedRangeSize,
		collapsedLines: Math.max(normalizedRangeSize - expandedCount, 0),
		renderAll
	};
}
function getTrailingContextRangeSize({ fileDiff, errorPrefix }) {
	const lastHunk = fileDiff.hunks[fileDiff.hunks.length - 1];
	if (lastHunk == null || fileDiff.isPartial || fileDiff.additionLines.length === 0 || fileDiff.deletionLines.length === 0) return 0;
	const additionRemaining = fileDiff.additionLines.length - (lastHunk.additionLineIndex + lastHunk.additionCount);
	const deletionRemaining = fileDiff.deletionLines.length - (lastHunk.deletionLineIndex + lastHunk.deletionCount);
	if (additionRemaining <= 0 && deletionRemaining <= 0) return 0;
	if (additionRemaining !== deletionRemaining) throw new Error(`${errorPrefix}: trailing context mismatch (additions=${additionRemaining}, deletions=${deletionRemaining}) for ${fileDiff.name}`);
	return Math.min(additionRemaining, deletionRemaining);
}
function getTrailingExpandedRegion({ fileDiff, hunkIndex, expandedHunks, collapsedContextThreshold, errorPrefix }) {
	if (hunkIndex !== fileDiff.hunks.length - 1) return;
	const trailingRangeSize = getTrailingContextRangeSize({
		fileDiff,
		errorPrefix
	});
	if (trailingRangeSize <= 0) return;
	if (expandedHunks === true || trailingRangeSize <= collapsedContextThreshold) return {
		fromStart: trailingRangeSize,
		fromEnd: 0,
		rangeSize: trailingRangeSize,
		collapsedLines: 0,
		renderAll: true
	};
	const region = expandedHunks?.get(fileDiff.hunks.length);
	const fromStart = Math.min(Math.max(region?.fromStart ?? 0, 0), trailingRangeSize);
	return {
		fromStart,
		fromEnd: 0,
		rangeSize: trailingRangeSize,
		collapsedLines: trailingRangeSize - fromStart,
		renderAll: fromStart >= trailingRangeSize
	};
}
//#endregion
//#region src/utils/iterateOverDiff.ts
function iterateOverDiff({ diff, diffStyle, startingLine = 0, totalLines = Infinity, expandedHunks, collapsedContextThreshold = 1, callback }) {
	const iterationStart = getIterationStartState({
		diff,
		diffStyle,
		startingLine,
		expandedHunks,
		collapsedContextThreshold
	});
	const state = {
		viewportStart: startingLine,
		viewportEnd: startingLine + totalLines,
		isWindowedHighlight: startingLine > 0 || totalLines < Infinity,
		splitCount: iterationStart.splitCount,
		unifiedCount: iterationStart.unifiedCount,
		finalHunkIndex: diff.hunks.length - 1,
		shouldBreak() {
			if (!state.isWindowedHighlight) return false;
			const breakUnified = state.unifiedCount >= startingLine + totalLines;
			const breakSplit = state.splitCount >= startingLine + totalLines;
			if (diffStyle === "unified") return breakUnified;
			else if (diffStyle === "split") return breakSplit;
			else return breakUnified && breakSplit;
		},
		shouldSkip(unifiedHeight, splitHeight) {
			if (!state.isWindowedHighlight) return false;
			const skipUnified = state.unifiedCount + unifiedHeight < startingLine;
			const skipSplit = state.splitCount + splitHeight < startingLine;
			if (diffStyle === "unified") return skipUnified;
			else if (diffStyle === "split") return skipSplit;
			else return skipUnified && skipSplit;
		},
		incrementCounts(unifiedValue, splitValue) {
			if (diffStyle === "unified" || diffStyle === "both") state.unifiedCount += unifiedValue;
			if (diffStyle === "split" || diffStyle === "both") state.splitCount += splitValue;
		},
		isInWindow(unifiedHeight, splitHeight) {
			if (!state.isWindowedHighlight) return true;
			const unifiedInWindow = state.isInUnifiedWindow(unifiedHeight);
			const splitInWindow = state.isInSplitWindow(splitHeight);
			if (diffStyle === "unified") return unifiedInWindow;
			else if (diffStyle === "split") return splitInWindow;
			else return unifiedInWindow || splitInWindow;
		},
		isInUnifiedWindow(unifiedHeight) {
			return !state.isWindowedHighlight || state.unifiedCount >= startingLine - unifiedHeight && state.unifiedCount < startingLine + totalLines;
		},
		isInSplitWindow(splitHeight) {
			return !state.isWindowedHighlight || state.splitCount >= startingLine - splitHeight && state.splitCount < startingLine + totalLines;
		},
		emit(props, silent = false) {
			if (!silent) if (diffStyle === "unified") state.incrementCounts(1, 0);
			else if (diffStyle === "split") state.incrementCounts(0, 1);
			else state.incrementCounts(1, 1);
			return callback(props) ?? false;
		}
	};
	hunkIterator: for (let hunkIndex = iterationStart.hunkIndex; hunkIndex < diff.hunks.length; hunkIndex++) {
		const hunk = diff.hunks[hunkIndex];
		if (hunk == null) throw new Error("iterateOverDiff: invalid hunk index");
		if (state.shouldBreak()) break;
		const leadingRegion = getExpandedRegion({
			isPartial: diff.isPartial,
			rangeSize: hunk.collapsedBefore,
			expandedHunks,
			hunkIndex,
			collapsedContextThreshold
		});
		const trailingRegion = hunkIndex === state.finalHunkIndex ? getTrailingExpandedRegion({
			fileDiff: diff,
			hunkIndex,
			expandedHunks,
			collapsedContextThreshold,
			errorPrefix: "iterateOverDiff"
		}) : void 0;
		const expandedLineCount = leadingRegion.fromStart + leadingRegion.fromEnd;
		function getTrailingCollapsedAfter(unifiedLineIndex, splitLineIndex) {
			if (trailingRegion == null || trailingRegion.collapsedLines <= 0 || trailingRegion.fromStart + trailingRegion.fromEnd > 0) return 0;
			if (diffStyle === "unified") return unifiedLineIndex === hunk.unifiedLineStart + hunk.unifiedLineCount - 1 ? trailingRegion.collapsedLines : 0;
			return splitLineIndex === hunk.splitLineStart + hunk.splitLineCount - 1 ? trailingRegion.collapsedLines : 0;
		}
		let consumedCollapsed = leadingRegion.collapsedLines === 0;
		function consumePendingCollapsed() {
			if (consumedCollapsed) return 0;
			consumedCollapsed = true;
			return leadingRegion.collapsedLines;
		}
		if (!state.shouldSkip(expandedLineCount, expandedLineCount)) {
			let unifiedLineIndex = hunk.unifiedLineStart - leadingRegion.rangeSize;
			let splitLineIndex = hunk.splitLineStart - leadingRegion.rangeSize;
			let deletionLineIndex = hunk.deletionLineIndex - leadingRegion.rangeSize;
			let additionLineIndex = hunk.additionLineIndex - leadingRegion.rangeSize;
			let deletionLineNumber = hunk.deletionStart - leadingRegion.rangeSize;
			let additionLineNumber = hunk.additionStart - leadingRegion.rangeSize;
			if (walkContextLines(state, leadingRegion.fromStart, diffStyle, (index) => {
				return state.emit({
					hunkIndex,
					hunk,
					collapsedBefore: 0,
					collapsedAfter: 0,
					type: "context-expanded",
					deletionLine: {
						lineNumber: deletionLineNumber + index,
						lineIndex: deletionLineIndex + index,
						noEOFCR: false,
						unifiedLineIndex: unifiedLineIndex + index,
						splitLineIndex: splitLineIndex + index
					},
					additionLine: {
						unifiedLineIndex: unifiedLineIndex + index,
						splitLineIndex: splitLineIndex + index,
						lineIndex: additionLineIndex + index,
						lineNumber: additionLineNumber + index,
						noEOFCR: false
					}
				});
			})) break hunkIterator;
			unifiedLineIndex = hunk.unifiedLineStart - leadingRegion.fromEnd;
			splitLineIndex = hunk.splitLineStart - leadingRegion.fromEnd;
			deletionLineIndex = hunk.deletionLineIndex - leadingRegion.fromEnd;
			additionLineIndex = hunk.additionLineIndex - leadingRegion.fromEnd;
			deletionLineNumber = hunk.deletionStart - leadingRegion.fromEnd;
			additionLineNumber = hunk.additionStart - leadingRegion.fromEnd;
			if (walkContextLines(state, leadingRegion.fromEnd, diffStyle, (index) => {
				return state.emit({
					hunkIndex,
					hunk,
					collapsedBefore: consumePendingCollapsed(),
					collapsedAfter: 0,
					type: "context-expanded",
					deletionLine: {
						lineNumber: deletionLineNumber + index,
						lineIndex: deletionLineIndex + index,
						noEOFCR: false,
						unifiedLineIndex: unifiedLineIndex + index,
						splitLineIndex: splitLineIndex + index
					},
					additionLine: {
						unifiedLineIndex: unifiedLineIndex + index,
						splitLineIndex: splitLineIndex + index,
						lineIndex: additionLineIndex + index,
						lineNumber: additionLineNumber + index,
						noEOFCR: false
					}
				});
			}, () => {
				consumePendingCollapsed();
			})) break hunkIterator;
		} else {
			state.incrementCounts(expandedLineCount, expandedLineCount);
			consumePendingCollapsed();
		}
		let unifiedLineIndex = hunk.unifiedLineStart;
		let splitLineIndex = hunk.splitLineStart;
		let deletionLineIndex = hunk.deletionLineIndex;
		let additionLineIndex = hunk.additionLineIndex;
		let deletionLineNumber = hunk.deletionStart;
		let additionLineNumber = hunk.additionStart;
		const lastContent = hunk.hunkContent.at(-1);
		for (const content of hunk.hunkContent) {
			if (state.shouldBreak()) break hunkIterator;
			const isLastContent = content === lastContent;
			if (content.type === "context") {
				if (!state.shouldSkip(content.lines, content.lines)) {
					if (walkContextLines(state, content.lines, diffStyle, (index) => {
						const isLastLine = isLastContent && index === content.lines - 1;
						const unifiedRowIndex = unifiedLineIndex + index;
						const splitRowIndex = splitLineIndex + index;
						return state.emit({
							hunkIndex,
							hunk,
							collapsedBefore: consumePendingCollapsed(),
							collapsedAfter: getTrailingCollapsedAfter(unifiedRowIndex, splitRowIndex),
							type: "context",
							deletionLine: {
								lineNumber: deletionLineNumber + index,
								lineIndex: deletionLineIndex + index,
								noEOFCR: isLastLine && hunk.noEOFCRDeletions,
								unifiedLineIndex: unifiedRowIndex,
								splitLineIndex: splitRowIndex
							},
							additionLine: {
								unifiedLineIndex: unifiedRowIndex,
								splitLineIndex: splitRowIndex,
								lineIndex: additionLineIndex + index,
								lineNumber: additionLineNumber + index,
								noEOFCR: isLastLine && hunk.noEOFCRAdditions
							}
						});
					}, () => {
						consumePendingCollapsed();
					})) break hunkIterator;
				} else {
					state.incrementCounts(content.lines, content.lines);
					consumePendingCollapsed();
				}
				unifiedLineIndex += content.lines;
				splitLineIndex += content.lines;
				deletionLineIndex += content.lines;
				additionLineIndex += content.lines;
				deletionLineNumber += content.lines;
				additionLineNumber += content.lines;
			} else {
				const splitCount = Math.max(content.deletions, content.additions);
				const unifiedCount = content.deletions + content.additions;
				if (!state.shouldSkip(unifiedCount, splitCount)) {
					const iterationRanges = getChangeIterationRanges(state, content, diffStyle);
					if ((iterationRanges[0]?.[0] ?? 0) > 0) consumePendingCollapsed();
					for (const [rangeStart, rangeEnd] of iterationRanges) for (let index = rangeStart; index < rangeEnd; index++) {
						const collapsedAfter = getTrailingCollapsedAfter(unifiedLineIndex + index, diffStyle === "unified" ? splitLineIndex + (index < content.deletions ? index : index - content.deletions) : splitLineIndex + index);
						if (state.emit(getChangeLineData({
							hunkIndex,
							hunk,
							collapsedBefore: consumePendingCollapsed(),
							collapsedAfter,
							diffStyle,
							index,
							unifiedLineIndex,
							splitLineIndex,
							additionLineIndex,
							deletionLineIndex,
							additionLineNumber,
							deletionLineNumber,
							content,
							isLastContent,
							unifiedCount,
							splitCount
						}), true)) break hunkIterator;
					}
				}
				consumePendingCollapsed();
				state.incrementCounts(unifiedCount, splitCount);
				unifiedLineIndex += unifiedCount;
				splitLineIndex += splitCount;
				deletionLineIndex += content.deletions;
				additionLineIndex += content.additions;
				deletionLineNumber += content.deletions;
				additionLineNumber += content.additions;
			}
		}
		if (trailingRegion != null) {
			const { collapsedLines, fromStart, fromEnd } = trailingRegion;
			const len = fromStart + fromEnd;
			if (walkContextLines(state, len, diffStyle, (index) => {
				const isLastLine = index === len - 1;
				return state.emit({
					hunkIndex: diff.hunks.length,
					hunk: void 0,
					collapsedBefore: 0,
					collapsedAfter: isLastLine ? collapsedLines : 0,
					type: "context-expanded",
					deletionLine: {
						lineNumber: deletionLineNumber + index,
						lineIndex: deletionLineIndex + index,
						noEOFCR: false,
						unifiedLineIndex: unifiedLineIndex + index,
						splitLineIndex: splitLineIndex + index
					},
					additionLine: {
						unifiedLineIndex: unifiedLineIndex + index,
						splitLineIndex: splitLineIndex + index,
						lineIndex: additionLineIndex + index,
						lineNumber: additionLineNumber + index,
						noEOFCR: false
					}
				});
			}, void 0, () => state.shouldBreak())) break hunkIterator;
		}
	}
}
function getIterationStartState({ diff, diffStyle, startingLine, expandedHunks, collapsedContextThreshold }) {
	if (startingLine <= 0 || diffStyle === "both") return {
		hunkIndex: 0,
		splitCount: 0,
		unifiedCount: 0
	};
	const prefixCounts = getHunkPrefixCounts({
		diff,
		expandedHunks,
		collapsedContextThreshold
	});
	let low = 0;
	let high = diff.hunks.length - 1;
	let result = diff.hunks.length;
	while (low <= high) {
		const mid = low + high >> 1;
		const counts = prefixCounts[mid + 1];
		if (counts == null) throw new Error("iterateOverDiff: invalid hunk prefix index");
		if ((diffStyle === "unified" ? counts.unifiedCount : counts.splitCount) > startingLine) {
			result = mid;
			high = mid - 1;
		} else low = mid + 1;
	}
	if (result >= diff.hunks.length) {
		const counts = prefixCounts[diff.hunks.length];
		if (counts == null) throw new Error("iterateOverDiff: invalid terminal hunk prefix index");
		return {
			hunkIndex: diff.hunks.length,
			splitCount: counts.splitCount,
			unifiedCount: counts.unifiedCount
		};
	}
	const counts = prefixCounts[result];
	if (counts == null) throw new Error("iterateOverDiff: invalid selected hunk prefix index");
	return {
		hunkIndex: result,
		splitCount: counts.splitCount,
		unifiedCount: counts.unifiedCount
	};
}
function getHunkPrefixCounts({ diff, expandedHunks, collapsedContextThreshold }) {
	let splitCount = 0;
	let unifiedCount = 0;
	const finalHunkIndex = diff.hunks.length - 1;
	const prefixCounts = [{
		splitCount: 0,
		unifiedCount: 0
	}];
	for (let index = 0; index < diff.hunks.length; index++) {
		const hunk = diff.hunks[index];
		if (hunk == null) throw new Error("iterateOverDiff: invalid hunk summary index");
		const leadingRegion = getExpandedRegion({
			isPartial: diff.isPartial,
			rangeSize: hunk.collapsedBefore,
			expandedHunks,
			hunkIndex: index,
			collapsedContextThreshold
		});
		const leadingCount = leadingRegion.fromStart + leadingRegion.fromEnd;
		splitCount += leadingCount + hunk.splitLineCount;
		unifiedCount += leadingCount + hunk.unifiedLineCount;
		const trailingRegion = index === finalHunkIndex ? getTrailingExpandedRegion({
			fileDiff: diff,
			hunkIndex: index,
			expandedHunks,
			collapsedContextThreshold,
			errorPrefix: "iterateOverDiff"
		}) : void 0;
		if (trailingRegion != null) {
			const trailingCount = trailingRegion.fromStart + trailingRegion.fromEnd;
			splitCount += trailingCount;
			unifiedCount += trailingCount;
		}
		prefixCounts.push({
			splitCount,
			unifiedCount
		});
	}
	return prefixCounts;
}
function getContextLineIterationBounds(state, count, diffStyle) {
	if (!state.isWindowedHighlight || count <= 0) return [0, count];
	const ranges = [];
	function pushRange(currentCount) {
		const start = Math.max(0, state.viewportStart - currentCount);
		const end = Math.min(count, state.viewportEnd - currentCount);
		if (end > start) ranges.push([start, end]);
	}
	if (diffStyle !== "split") pushRange(state.unifiedCount);
	if (diffStyle !== "unified") pushRange(state.splitCount);
	if (ranges.length === 0) return [0, 0];
	let start = ranges[0][0];
	let end = ranges[0][1];
	for (let index = 1; index < ranges.length; index++) {
		const range = ranges[index];
		start = Math.min(start, range[0]);
		end = Math.max(end, range[1]);
	}
	return [start, end];
}
function walkContextLines(state, count, diffStyle, callback, onSkippedStart, shouldBreak) {
	const [startIndex, endIndex] = getContextLineIterationBounds(state, count, diffStyle);
	if (startIndex > 0) {
		state.incrementCounts(startIndex, startIndex);
		onSkippedStart?.();
	}
	let index = startIndex;
	while (index < count) {
		if (shouldBreak?.() === true) return true;
		if (index >= endIndex) {
			state.incrementCounts(count - index, count - index);
			break;
		}
		if (state.isInWindow(0, 0)) {
			if (callback(index) === true) return true;
		} else state.incrementCounts(1, 1);
		index++;
	}
	return false;
}
function getChangeIterationRanges(state, content, diffStyle) {
	if (!state.isWindowedHighlight) return [[0, diffStyle === "unified" ? content.deletions + content.additions : Math.max(content.deletions, content.additions)]];
	const useUnified = diffStyle !== "split";
	const useSplit = diffStyle !== "unified";
	const iterationSpace = diffStyle === "unified" ? "unified" : "split";
	const iterationRanges = [];
	function getVisibleRange(start, count) {
		if (start + count <= state.viewportStart || start >= state.viewportEnd) return;
		const visibleStart = Math.max(0, state.viewportStart - start);
		const visibleEnd = Math.min(count, state.viewportEnd - start);
		return visibleEnd > visibleStart ? [visibleStart, visibleEnd] : void 0;
	}
	function mapRangeToIteration(range, kind) {
		if (iterationSpace === "split") return range;
		return kind === "additions" ? [range[0] + content.deletions, range[1] + content.deletions] : range;
	}
	function pushRange(range, kind) {
		if (range == null) return;
		const [start, end] = mapRangeToIteration(range, kind);
		if (end > start) iterationRanges.push([start, end]);
	}
	if (useUnified) {
		pushRange(getVisibleRange(state.unifiedCount, content.deletions), "deletions");
		pushRange(getVisibleRange(state.unifiedCount + content.deletions, content.additions), "additions");
	}
	if (useSplit) {
		pushRange(getVisibleRange(state.splitCount, content.deletions), "deletions");
		pushRange(getVisibleRange(state.splitCount, content.additions), "additions");
	}
	if (iterationRanges.length === 0) return iterationRanges;
	iterationRanges.sort((a, b) => a[0] - b[0]);
	const merged = [iterationRanges[0]];
	for (const [start, end] of iterationRanges.slice(1)) {
		const last = merged[merged.length - 1];
		if (start <= last[1]) last[1] = Math.max(last[1], end);
		else merged.push([start, end]);
	}
	return merged;
}
function getChangeLineData({ hunkIndex, hunk, collapsedAfter, collapsedBefore, diffStyle, index, unifiedLineIndex, splitLineIndex, additionLineIndex, deletionLineIndex, additionLineNumber, deletionLineNumber, content, isLastContent, unifiedCount, splitCount }) {
	const unifiedDeletionLineIndex = index < content.deletions ? unifiedLineIndex + index : void 0;
	const unifiedAdditionLineIndex = diffStyle === "unified" ? index >= content.deletions ? unifiedLineIndex + index : void 0 : index < content.additions ? unifiedLineIndex + content.deletions + index : void 0;
	const resolvedSplitLineIndex = diffStyle === "unified" ? splitLineIndex + (index < content.deletions ? index : index - content.deletions) : splitLineIndex + index;
	const deletionLineIndexValue = index < content.deletions ? deletionLineIndex + index : void 0;
	const deletionLineNumberValue = index < content.deletions ? deletionLineNumber + index : void 0;
	const additionLineIndexValue = diffStyle === "unified" ? index >= content.deletions ? additionLineIndex + (index - content.deletions) : void 0 : index < content.additions ? additionLineIndex + index : void 0;
	const additionLineNumberValue = diffStyle === "unified" ? index >= content.deletions ? additionLineNumber + (index - content.deletions) : void 0 : index < content.additions ? additionLineNumber + index : void 0;
	const noEOFCRDeletion = diffStyle === "unified" ? isLastContent && index === content.deletions - 1 && hunk.noEOFCRDeletions : isLastContent && index === splitCount - 1 && hunk.noEOFCRDeletions;
	const noEOFCRAddition = diffStyle === "unified" ? isLastContent && index === unifiedCount - 1 && hunk.noEOFCRAdditions : isLastContent && index === splitCount - 1 && hunk.noEOFCRAdditions;
	const deletionLine = deletionLineIndexValue != null && deletionLineNumberValue != null && unifiedDeletionLineIndex != null ? {
		lineNumber: deletionLineNumberValue,
		lineIndex: deletionLineIndexValue,
		noEOFCR: noEOFCRDeletion,
		unifiedLineIndex: unifiedDeletionLineIndex,
		splitLineIndex: resolvedSplitLineIndex
	} : void 0;
	const additionLine = additionLineIndexValue != null && additionLineNumberValue != null && unifiedAdditionLineIndex != null ? {
		unifiedLineIndex: unifiedAdditionLineIndex,
		splitLineIndex: resolvedSplitLineIndex,
		lineIndex: additionLineIndexValue,
		lineNumber: additionLineNumberValue,
		noEOFCR: noEOFCRAddition
	} : void 0;
	if (deletionLine == null && additionLine != null) return {
		type: "change",
		hunkIndex,
		hunk,
		collapsedAfter,
		collapsedBefore,
		deletionLine: void 0,
		additionLine
	};
	else if (deletionLine != null && additionLine == null) return {
		type: "change",
		hunkIndex,
		hunk,
		collapsedAfter,
		collapsedBefore,
		deletionLine,
		additionLine: void 0
	};
	if (deletionLine == null || additionLine == null) throw new Error("iterateOverDiff: missing change line data");
	return {
		type: "change",
		hunkIndex,
		hunk,
		collapsedAfter,
		collapsedBefore,
		deletionLine,
		additionLine
	};
}
//#endregion
//#region src/utils/parseDiffDecorations.ts
function createDiffSpanDecoration({ line, spanStart, spanLength }) {
	return {
		start: {
			line,
			character: spanStart
		},
		end: {
			line,
			character: spanStart + spanLength
		},
		properties: { "data-diff-span": "" },
		alwaysWrap: true
	};
}
function pushOrJoinSpan({ item, arr, enableJoin, isNeutral = false, isLastItem = false }) {
	const lastItem = arr[arr.length - 1];
	if (lastItem == null || isLastItem || !enableJoin) {
		arr.push([isNeutral ? 0 : 1, item.value]);
		return;
	}
	const isLastItemNeutral = lastItem[0] === 0;
	if (isNeutral === isLastItemNeutral || isNeutral && item.value.length === 1 && !isLastItemNeutral) {
		lastItem[1] += item.value;
		return;
	}
	arr.push([isNeutral ? 0 : 1, item.value]);
}
//#endregion
//#region src/utils/renderDiffWithHighlighter.ts
const DEFAULT_PLAIN_TEXT_OPTIONS$1 = { forcePlainText: false };
function renderDiffWithHighlighter(diff, highlighter, options, { forcePlainText, startingLine, totalLines, expandedHunks, collapsedContextThreshold = 1 } = DEFAULT_PLAIN_TEXT_OPTIONS$1) {
	if (forcePlainText) {
		startingLine ??= 0;
		totalLines ??= Infinity;
	} else {
		startingLine = 0;
		totalLines = Infinity;
	}
	const isWindowedHighlight = startingLine > 0 || totalLines < Infinity;
	const baseThemeType = typeof options.theme === "string" ? highlighter.getTheme(options.theme).type : void 0;
	const themeStyles = getHighlighterThemeStyles({
		theme: options.theme,
		highlighter
	});
	const lineDiffType = forcePlainText && !isWindowedHighlight && (diff.unifiedLineCount > 1e3 || diff.splitLineCount > 1e3) ? "none" : options.lineDiffType;
	const code = {
		deletionLines: [],
		additionLines: []
	};
	const { maxLineDiffLength } = options;
	const shouldGroupAll = !forcePlainText && !diff.isPartial;
	const expandedHunksForIteration = forcePlainText ? expandedHunks : void 0;
	const buckets = /* @__PURE__ */ new Map();
	function getBucketForHunk(hunkIndex) {
		const index = shouldGroupAll ? 0 : hunkIndex;
		const bucket = buckets.get(index) ?? createBucket();
		buckets.set(index, bucket);
		return bucket;
	}
	function appendContent(lineContent, lineIndex, segments, contentWrapper) {
		if (isWindowedHighlight) {
			let segment = segments.at(-1);
			if (segment == null || segment.targetIndex + segment.count !== lineIndex) {
				segment = {
					targetIndex: lineIndex,
					originalOffset: contentWrapper.length,
					count: 0
				};
				segments.push(segment);
			}
			segment.count++;
		}
		contentWrapper.push(lineContent);
	}
	iterateOverDiff({
		diff,
		diffStyle: "both",
		startingLine,
		totalLines,
		expandedHunks: isWindowedHighlight ? expandedHunksForIteration : true,
		collapsedContextThreshold,
		callback: ({ hunkIndex, additionLine, deletionLine, type }) => {
			const bucket = getBucketForHunk(hunkIndex);
			const splitLineIndex = additionLine != null ? additionLine.splitLineIndex : deletionLine.splitLineIndex;
			if (type === "change" && additionLine != null && deletionLine != null) computeLineDiffDecorations({
				additionLine: diff.additionLines[additionLine.lineIndex],
				deletionLine: diff.deletionLines[deletionLine.lineIndex],
				deletionLineIndex: bucket.deletionContent.length,
				additionLineIndex: bucket.additionContent.length,
				deletionDecorations: bucket.deletionDecorations,
				additionDecorations: bucket.additionDecorations,
				lineDiffType,
				maxLineDiffLength
			});
			if (deletionLine != null) {
				appendContent(diff.deletionLines[deletionLine.lineIndex], deletionLine.lineIndex, bucket.deletionSegments, bucket.deletionContent);
				bucket.deletionInfo.push({
					type: type === "change" ? "change-deletion" : type,
					lineNumber: deletionLine.lineNumber,
					altLineNumber: type === "change" ? void 0 : additionLine.lineNumber ?? void 0,
					lineIndex: `${deletionLine.unifiedLineIndex},${splitLineIndex}`
				});
			}
			if (additionLine != null) {
				appendContent(diff.additionLines[additionLine.lineIndex], additionLine.lineIndex, bucket.additionSegments, bucket.additionContent);
				bucket.additionInfo.push({
					type: type === "change" ? "change-addition" : type,
					lineNumber: additionLine.lineNumber,
					altLineNumber: type === "change" ? void 0 : deletionLine.lineNumber ?? void 0,
					lineIndex: `${additionLine.unifiedLineIndex},${splitLineIndex}`
				});
			}
		}
	});
	for (const bucket of buckets.values()) {
		if (bucket.deletionContent.length === 0 && bucket.additionContent.length === 0) continue;
		const deletionFile = {
			name: diff.prevName ?? diff.name,
			contents: bucket.deletionContent.value
		};
		const additionFile = {
			name: diff.name,
			contents: bucket.additionContent.value
		};
		const { deletionLines, additionLines } = renderTwoFiles({
			deletionFile,
			deletionInfo: bucket.deletionInfo,
			deletionDecorations: bucket.deletionDecorations,
			additionFile,
			additionInfo: bucket.additionInfo,
			additionDecorations: bucket.additionDecorations,
			highlighter,
			options,
			languageOverride: forcePlainText ? "text" : diff.lang
		});
		if (shouldGroupAll) {
			code.deletionLines = deletionLines;
			code.additionLines = additionLines;
			continue;
		}
		if (bucket.deletionSegments.length > 0) for (const seg of bucket.deletionSegments) for (let i = 0; i < seg.count; i++) code.deletionLines[seg.targetIndex + i] = deletionLines[seg.originalOffset + i];
		else code.deletionLines.push(...deletionLines);
		if (bucket.additionSegments.length > 0) for (const seg of bucket.additionSegments) for (let i = 0; i < seg.count; i++) code.additionLines[seg.targetIndex + i] = additionLines[seg.originalOffset + i];
		else code.additionLines.push(...additionLines);
	}
	return {
		code,
		themeStyles,
		baseThemeType
	};
}
function computeLineDiffDecorations({ deletionLine, additionLine, deletionLineIndex, additionLineIndex, deletionDecorations, additionDecorations, lineDiffType, maxLineDiffLength }) {
	if (deletionLine == null || additionLine == null || lineDiffType === "none") return;
	deletionLine = cleanLastNewline(deletionLine);
	additionLine = cleanLastNewline(additionLine);
	if (deletionLine.length > maxLineDiffLength || additionLine.length > maxLineDiffLength) return;
	const lineDiff = lineDiffType === "char" ? diffChars(deletionLine, additionLine) : diffWordsWithSpace(deletionLine, additionLine);
	const deletionSpans = [];
	const additionSpans = [];
	const enableJoin = lineDiffType === "word-alt";
	const lastItem = lineDiff.at(-1);
	for (const item of lineDiff) {
		const isLastItem = item === lastItem;
		if (!item.added && !item.removed) {
			pushOrJoinSpan({
				item,
				arr: deletionSpans,
				enableJoin,
				isNeutral: true,
				isLastItem
			});
			pushOrJoinSpan({
				item,
				arr: additionSpans,
				enableJoin,
				isNeutral: true,
				isLastItem
			});
		} else if (item.removed) pushOrJoinSpan({
			item,
			arr: deletionSpans,
			enableJoin,
			isLastItem
		});
		else pushOrJoinSpan({
			item,
			arr: additionSpans,
			enableJoin,
			isLastItem
		});
	}
	let spanIndex = 0;
	for (const span of deletionSpans) {
		if (span[0] === 1) deletionDecorations.push(createDiffSpanDecoration({
			line: deletionLineIndex,
			spanStart: spanIndex,
			spanLength: span[1].length
		}));
		spanIndex += span[1].length;
	}
	spanIndex = 0;
	for (const span of additionSpans) {
		if (span[0] === 1) additionDecorations.push(createDiffSpanDecoration({
			line: additionLineIndex,
			spanStart: spanIndex,
			spanLength: span[1].length
		}));
		spanIndex += span[1].length;
	}
}
function createBucket() {
	return {
		deletionContent: {
			push(value) {
				this.value += value;
				this.length++;
			},
			value: "",
			length: 0
		},
		additionContent: {
			push(value) {
				this.value += value;
				this.length++;
			},
			value: "",
			length: 0
		},
		deletionInfo: [],
		additionInfo: [],
		deletionDecorations: [],
		additionDecorations: [],
		deletionSegments: [],
		additionSegments: []
	};
}
function renderTwoFiles({ deletionFile, additionFile, deletionInfo, additionInfo, highlighter, deletionDecorations, additionDecorations, languageOverride, options: { theme: themeOrThemes = DEFAULT_THEMES, ...options } }) {
	const deletionLang = languageOverride ?? getFiletypeFromFileName(deletionFile.name);
	const additionLang = languageOverride ?? getFiletypeFromFileName(additionFile.name);
	const { state, transformers } = createTransformerWithState(options.useTokenTransformer);
	const hastConfig = (() => {
		return typeof themeOrThemes === "string" ? {
			...options,
			lang: "text",
			theme: themeOrThemes,
			transformers,
			decorations: void 0,
			defaultColor: false,
			cssVariablePrefix: formatCSSVariablePrefix("token"),
			tokenizeTimeLimit: 0
		} : {
			...options,
			lang: "text",
			themes: themeOrThemes,
			transformers,
			decorations: void 0,
			defaultColor: false,
			cssVariablePrefix: formatCSSVariablePrefix("token"),
			tokenizeTimeLimit: 0
		};
	})();
	return {
		deletionLines: (() => {
			if (deletionFile.contents === "") return [];
			hastConfig.lang = deletionLang;
			state.lineInfo = deletionInfo;
			hastConfig.decorations = deletionDecorations;
			return getLineNodes(highlighter.codeToHast(cleanLastNewline(deletionFile.contents), hastConfig));
		})(),
		additionLines: (() => {
			if (additionFile.contents === "") return [];
			hastConfig.lang = additionLang;
			hastConfig.decorations = additionDecorations;
			state.lineInfo = additionInfo;
			return getLineNodes(highlighter.codeToHast(cleanLastNewline(additionFile.contents), hastConfig));
		})()
	};
}
//#endregion
//#region src/utils/iterateOverFile.ts
/**
* Iterates over lines in a file with optional windowing support.
*
* Similar to `iterateOverDiff` but simplified for linear file content.
* Supports viewport windowing for virtualization scenarios.
*
* @param props - Configuration for iteration
* @param props.lines - Pre-split array of lines (use splitFileContents() to create from string)
* @param props.startingLine - Optional starting line index (0-based, default: 0)
* @param props.totalLines - Optional max lines to iterate (default: Infinity)
* @param props.callback - Callback invoked for each line in the window.
*                         Return `true` to stop iteration early.
*
* @example
* ```typescript
* const lines = splitFileContents('line1\nline2\nline3');
* iterateOverFile({
*   lines,
*   startingLine: 0,
*   totalLines: 10,
*   callback: ({ lineIndex, lineNumber, content, isLastLine }) => {
*     console.log(`Line ${lineNumber}: ${content}`);
*     if (content.includes('stop')) return true; // Stop iteration
*   }
* });
* ```
*/
function iterateOverFile({ lines, startingLine = 0, totalLines = Infinity, callback }) {
	const len = Math.min(startingLine + totalLines, lines.length);
	const lastLineIndex = (() => {
		const lastLine = lines.at(-1);
		if (lastLine === "" || lastLine === "\n" || lastLine === "\r\n" || lastLine === "\r") return Math.max(0, lines.length - 2);
		return lines.length - 1;
	})();
	for (let lineIndex = startingLine; lineIndex < len; lineIndex++) {
		const isLastLine = lineIndex === lastLineIndex;
		if (callback({
			lineIndex,
			lineNumber: lineIndex + 1,
			content: lines[lineIndex],
			isLastLine
		}) === true || isLastLine) break;
	}
}
//#endregion
//#region src/utils/splitFileContents.ts
/**
* Splits file contents into lines using the same logic as diff parsing.
* - Preserves trailing newlines on each line
*
* @param contents - The raw file contents string
* @returns Array of lines with newlines preserved
*/
function splitFileContents(contents) {
	return contents !== "" ? contents.split(SPLIT_WITH_NEWLINES) : [];
}
//#endregion
//#region src/utils/renderFileWithHighlighter.ts
const DEFAULT_PLAIN_TEXT_OPTIONS = { forcePlainText: false };
function renderFileWithHighlighter(file, highlighter, { theme = DEFAULT_THEMES, tokenizeMaxLineLength, useTokenTransformer }, { forcePlainText, startingLine, totalLines, lines } = DEFAULT_PLAIN_TEXT_OPTIONS) {
	if (forcePlainText) {
		startingLine ??= 0;
		totalLines ??= Infinity;
	} else {
		startingLine = 0;
		totalLines = Infinity;
	}
	const isWindowedHighlight = startingLine > 0 || totalLines < Infinity;
	const { state, transformers } = createTransformerWithState(useTokenTransformer);
	const lang = forcePlainText ? "text" : file.lang ?? getFiletypeFromFileName(file.name);
	const baseThemeType = typeof theme === "string" ? highlighter.getTheme(theme).type : void 0;
	const themeStyles = getHighlighterThemeStyles({
		theme,
		highlighter
	});
	state.lineInfo = (shikiLineNumber) => ({
		type: "context",
		lineIndex: shikiLineNumber - 1 + startingLine,
		lineNumber: shikiLineNumber + startingLine
	});
	const hastConfig = (() => {
		if (typeof theme === "string") return {
			lang,
			theme,
			transformers,
			defaultColor: false,
			cssVariablePrefix: formatCSSVariablePrefix("token"),
			tokenizeMaxLineLength,
			tokenizeTimeLimit: 0
		};
		return {
			lang,
			themes: theme,
			transformers,
			defaultColor: false,
			cssVariablePrefix: formatCSSVariablePrefix("token"),
			tokenizeMaxLineLength,
			tokenizeTimeLimit: 0
		};
	})();
	const highlightedLines = getLineNodes(highlighter.codeToHast(isWindowedHighlight ? extractWindowedFileContent(lines ?? splitFileContents(file.contents), startingLine, totalLines) : cleanLastNewline(file.contents), hastConfig));
	const code = isWindowedHighlight ? new Array(startingLine) : highlightedLines;
	if (isWindowedHighlight) code.push(...highlightedLines);
	return {
		code,
		themeStyles,
		baseThemeType
	};
}
function extractWindowedFileContent(lines, startingLine, totalLines) {
	let windowContent = "";
	iterateOverFile({
		lines,
		startingLine,
		totalLines,
		callback({ content }) {
			windowContent += content;
		}
	});
	return windowContent;
}
//#endregion
//#region src/worker/worker.ts
let highlighter;
let renderOptions = {
	theme: DEFAULT_THEMES,
	useTokenTransformer: false,
	tokenizeMaxLineLength: 1e3,
	lineDiffType: "word-alt",
	maxLineDiffLength: 1e3
};
const EMPTY_REGEXP = /(?:)/;
self.addEventListener("error", (event) => {
	console.error("[Shiki Worker] Unhandled error:", event.error);
});
self.addEventListener("message", (event) => {
	handleMessage(event.data);
});
async function handleMessage(request) {
	try {
		switch (request.type) {
			case "initialize":
				await handleInitialize(request);
				break;
			case "set-render-options":
				await handleSetRenderOptions(request);
				break;
			case "file":
				await handleRenderFile(request);
				break;
			case "diff":
				await handleRenderDiff(request);
				break;
			default: throw new Error(`Unknown request type: ${request.type}`);
		}
	} catch (error) {
		console.error("Worker error:", error);
		sendError(request.id, error);
	} finally {
		EMPTY_REGEXP.exec("");
	}
}
async function handleInitialize({ id, renderOptions: options, preferredHighlighter, resolvedThemes, resolvedLanguages, customExtensionsVersion, customExtensionMap }) {
	let highlighter = getHighlighter(preferredHighlighter);
	if ("then" in highlighter) highlighter = await highlighter;
	syncCustomExtensionsFromRequest({
		customExtensionsVersion,
		customExtensionMap
	});
	attachResolvedThemes(resolvedThemes, highlighter);
	if (resolvedLanguages != null) attachResolvedLanguages(resolvedLanguages, highlighter);
	renderOptions = options;
	postMessage({
		type: "success",
		id,
		requestType: "initialize",
		sentAt: Date.now()
	});
}
async function handleSetRenderOptions({ id, renderOptions: options, resolvedThemes }) {
	let highlighter = getHighlighter();
	if ("then" in highlighter) highlighter = await highlighter;
	attachResolvedThemes(resolvedThemes, highlighter);
	renderOptions = options;
	postMessage({
		type: "success",
		id,
		requestType: "set-render-options",
		sentAt: Date.now()
	});
}
async function handleRenderFile({ id, file, resolvedLanguages, customExtensionsVersion, customExtensionMap }) {
	let highlighter = getHighlighter();
	if ("then" in highlighter) highlighter = await highlighter;
	syncCustomExtensionsFromRequest({
		customExtensionsVersion,
		customExtensionMap
	});
	if (resolvedLanguages != null) attachResolvedLanguages(resolvedLanguages, highlighter);
	const fileOptions = {
		theme: renderOptions.theme,
		useTokenTransformer: renderOptions.useTokenTransformer,
		tokenizeMaxLineLength: renderOptions.tokenizeMaxLineLength
	};
	sendFileSuccess(id, renderFileWithHighlighter(file, highlighter, fileOptions), fileOptions);
}
async function handleRenderDiff({ id, diff, resolvedLanguages, customExtensionsVersion, customExtensionMap }) {
	let highlighter = getHighlighter();
	if ("then" in highlighter) highlighter = await highlighter;
	syncCustomExtensionsFromRequest({
		customExtensionsVersion,
		customExtensionMap
	});
	if (resolvedLanguages != null) attachResolvedLanguages(resolvedLanguages, highlighter);
	sendDiffSuccess(id, renderDiffWithHighlighter(diff, highlighter, renderOptions), renderOptions);
}
function getHighlighter(preferredHighlighter = "shiki-js") {
	highlighter ??= createHighlighterCore({
		themes: [],
		langs: [],
		engine: preferredHighlighter === "shiki-wasm" ? createOnigurumaEngine(import("shiki/wasm")) : createJavaScriptRegexEngine()
	});
	return highlighter;
}
function syncCustomExtensionsFromRequest({ customExtensionsVersion, customExtensionMap }) {
	if (customExtensionsVersion == null && customExtensionMap == null) return;
	if (customExtensionsVersion == null || customExtensionMap == null) throw new Error("Worker request must include both customExtensionsVersion and customExtensionMap");
	replaceCustomExtensions(customExtensionsVersion, customExtensionMap);
}
function sendFileSuccess(id, result, options) {
	postMessage({
		type: "success",
		requestType: "file",
		id,
		result,
		options,
		sentAt: Date.now()
	});
}
function sendDiffSuccess(id, result, options) {
	postMessage({
		type: "success",
		requestType: "diff",
		id,
		result,
		options,
		sentAt: Date.now()
	});
}
function sendError(id, error) {
	const response = {
		type: "error",
		id,
		error: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : void 0
	};
	postMessage(response);
}
//#endregion

//# sourceMappingURL=worker.js.map