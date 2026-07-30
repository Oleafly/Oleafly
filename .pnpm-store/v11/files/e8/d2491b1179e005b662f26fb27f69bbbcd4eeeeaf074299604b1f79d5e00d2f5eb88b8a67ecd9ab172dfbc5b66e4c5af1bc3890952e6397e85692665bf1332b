import { renderToString } from "katex";
//#region src/hooks/useMarkdown/latex.ts
/**
* PlaceholderManager - Manages temporary replacement and restoration of protected content
* Used to protect code blocks and LaTeX expressions during preprocessing
*/
var PlaceholderManager = class {
	constructor(prefix = "PROTECTED") {
		this.placeholders = [];
		this.prefix = prefix;
	}
	add(content) {
		const index = this.placeholders.length;
		this.placeholders.push(content);
		return `<<${this.prefix}_${index}>>`;
	}
	restore(text) {
		return text.replaceAll(new RegExp(`<<${this.prefix}_(\\d+)>>`, "g"), (_, index) => {
			return this.placeholders[Number.parseInt(index)] || "";
		});
	}
	clear() {
		this.placeholders = [];
	}
};
const replaceUnescapedPipes = (formula) => formula.replaceAll(/(?<!\\)\|/g, "\\vert{}");
/**
* Converts LaTeX bracket delimiters to dollar sign delimiters.
* Converts \[...\] to $$...$$ and \(...\) to $...$
* Preserves code blocks during the conversion.
*
* @param text The input string containing LaTeX expressions
* @returns The string with LaTeX bracket delimiters converted to dollar sign delimiters
*/
function convertLatexDelimiters(text) {
	return text.replaceAll(/(```[\s\S]*?```|`.*?`)|\\\[([\s\S]*?[^\\])\\\]|\\\((.*?)\\\)/g, (match, codeBlock, squareBracket, roundBracket) => {
		if (codeBlock !== void 0) return codeBlock;
		else if (squareBracket !== void 0) return `$$${squareBracket}$$`;
		else if (roundBracket !== void 0) return `$${roundBracket}$`;
		return match;
	});
}
/**
* Escapes mhchem commands in LaTeX expressions to ensure proper rendering.
*
* @param text The input string containing LaTeX expressions with mhchem commands
* @returns The string with escaped mhchem commands
*/
function escapeMhchemCommands(text) {
	return text.replaceAll("$\\ce{", "$\\\\ce{").replaceAll("$\\pu{", "$\\\\pu{");
}
/**
* Escapes pipe characters within LaTeX expressions to prevent them from being interpreted
* as table column separators in markdown tables.
*
* @param text The input string containing LaTeX expressions
* @returns The string with pipe characters escaped in LaTeX expressions
*/
function escapeLatexPipes(text) {
	const codeBlocks = [];
	let content = text.replaceAll(/(```[\s\S]*?```|`[^\n`]*`)/g, (match) => {
		codeBlocks.push(match);
		return `<<CODE_${codeBlocks.length - 1}>>`;
	});
	content = content.replaceAll(/\$\$([\s\S]*?)\$\$/g, (match, display) => {
		return `$$${replaceUnescapedPipes(display)}$$`;
	});
	content = content.replaceAll(/(?<!\\)\$(?!\$)([^\n$]*)(?<!\\)\$(?!\$)/g, (match, inline) => {
		return `$${replaceUnescapedPipes(inline)}$`;
	});
	content = content.replaceAll(/<<CODE_(\d+)>>/g, (_, index) => {
		return codeBlocks[Number.parseInt(index)];
	});
	return content;
}
/**
* Escapes underscores within \text{...} commands in LaTeX expressions
* that are not already escaped.
* For example, \text{node_domain} becomes \text{node\_domain},
* but \text{node\_domain} remains \text{node\_domain}.
*
* @param text The input string potentially containing LaTeX expressions
* @returns The string with unescaped underscores escaped within \text{...} commands
*/
function escapeTextUnderscores(text) {
	return text.replaceAll(/\\text\{([^}]*)\}/g, (match, textContent) => {
		return `\\text{${textContent.replaceAll(/(?<!\\)_/g, "\\_")}}`;
	});
}
/**
* Escapes dollar signs that appear to be currency symbols to prevent them from being
* interpreted as LaTeX math delimiters.
*
* This function identifies currency patterns such as:
* - $20, $100, $1,000
* - $20-50, $100+
* - Patterns within markdown tables
*
* @param text The input string containing potential currency symbols
* @returns The string with currency dollar signs escaped
*/
function escapeCurrencyDollars(text) {
	const manager = new PlaceholderManager("PROTECTED");
	let content = text.replaceAll(/(```[\s\S]*?```|`[^\n`]*`|\$\$[\s\S]*?\$\$|(?<!\\)\$(?!\$)(?=[\s\S]*?\\)[\s\S]*?(?<!\\)\$(?!\$)|\$\d+\$|\$-?\d+(?:,-?\d+)+\$|\\\[[\s\S]*?\\\]|\\\(.*?\\\))/g, (match) => manager.add(match));
	content = content.replaceAll(/(?<!\$)\$(\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:-\d{1,3}(?:,\d{3})*(?:\.\d+)?)?\+?)(?!\$)/g, "\\$$$1");
	content = manager.restore(content);
	return content;
}
/**
* Extracts the LaTeX formula after the last $$ delimiter if there's an odd number of $$ delimiters.
*
* @param text The input string containing LaTeX formulas
* @returns The content after the last $$ if there's an odd number of $$, otherwise an empty string
*/
const extractIncompleteFormula = (text) => {
	if ((text.match(/\$\$/g) || []).length % 2 === 1) {
		const match = text.match(/\$\$([\s\S]*)$/);
		return match ? match[1] : "";
	}
	return "";
};
/**
* Checks if the last LaTeX formula in the text is renderable.
* Only validates the formula after the last $$ if there's an odd number of $$.
*
* @param text The input string containing LaTeX formulas
* @returns True if the last formula is renderable or if there's no incomplete formula
*/
const isLastFormulaRenderable = (text) => {
	const formula = extractIncompleteFormula(text);
	if (!formula) return true;
	try {
		renderToString(formula, {
			displayMode: true,
			throwOnError: true
		});
		return true;
	} catch (error) {
		console.error(`LaTeX formula rendering error: ${error}`);
		return false;
	}
};
/**
* Fixes common LaTeX syntax errors automatically
* - Balances unmatched braces
* - Balances \left and \right delimiters
*
* @param text The input string containing LaTeX expressions
* @returns The string with fixed LaTeX expressions
*/
function fixCommonLaTeXErrors(text) {
	return text.replaceAll(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g, (match) => {
		let fixed = match;
		const openBraces = (fixed.match(/(?<!\\)\{/g) || []).length;
		const closeBraces = (fixed.match(/(?<!\\)\}/g) || []).length;
		if (openBraces > closeBraces) {
			const diff = openBraces - closeBraces;
			const closingBraces = "}".repeat(diff);
			fixed = fixed.replace(/(\$\$?)$/, closingBraces + "$1");
		}
		const leftDelims = (fixed.match(/\\left[(.<[{|]/g) || []).length;
		const rightDelims = (fixed.match(/\\right[).>\]|}]/g) || []).length;
		if (leftDelims > rightDelims) {
			const diff = leftDelims - rightDelims;
			const rightDots = "\\right.".repeat(diff);
			fixed = fixed.replace(/(\$\$?)$/, rightDots + "$1");
		}
		return fixed;
	});
}
/**
* Normalizes whitespace in LaTeX expressions
* - Removes extra spaces around $ delimiters
* - Normalizes multiple spaces to single space inside formulas
*
* @param text The input string containing LaTeX expressions
* @returns The string with normalized whitespace
*/
function normalizeLatexSpacing(text) {
	let result = text;
	result = result.replaceAll(/\$\s+/g, "$");
	result = result.replaceAll(/\s+\$/g, "$");
	result = result.replaceAll(/\$\$\s+/g, "$$");
	result = result.replaceAll(/\s+\$\$/g, "$$");
	result = result.replaceAll(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g, (match) => {
		return match.replaceAll(/\s{2,}/g, " ");
	});
	return result;
}
/**
* Validates all LaTeX expressions in the text
* Returns detailed information about validation results
*
* @param text The input string containing LaTeX expressions
* @returns Validation results with errors if any
*/
function validateLatexExpressions(text) {
	const errors = [];
	let totalExpressions = 0;
	const pattern = /\$\$([\s\S]*?)\$\$|(?<!\\)\$(?!\$)([\s\S]*?)(?<!\\)\$(?!\$)/g;
	let match;
	while ((match = pattern.exec(text)) !== null) {
		totalExpressions++;
		const formula = match[1] || match[2];
		const isDisplay = match[0].startsWith("$$");
		try {
			renderToString(formula, {
				displayMode: isDisplay,
				strict: "warn",
				throwOnError: true,
				trust: false
			});
		} catch (error) {
			errors.push({
				formula: formula.slice(0, 50) + (formula.length > 50 ? "..." : ""),
				message: error instanceof Error ? error.message : String(error),
				position: match.index,
				type: isDisplay ? "display" : "inline"
			});
		}
	}
	return {
		errors,
		totalExpressions,
		valid: errors.length === 0
	};
}
/**
* Handles CJK (Chinese, Japanese, Korean) characters mixed with LaTeX
* Optionally adds spaces between CJK characters and LaTeX expressions for better rendering
*
* @param text The input string
* @param addSpaces Whether to add spaces between CJK and LaTeX (default: false)
* @returns The processed string
*/
function handleCJKWithLatex(text, addSpaces = false) {
	if (!addSpaces) return text;
	let result = text;
	result = result.replaceAll(/([\u3040-\u30FF\u4E00-\u9FA5])(\$)/g, "$1 $2");
	result = result.replaceAll(/(\$)([\u3040-\u30FF\u4E00-\u9FA5])/g, "$1 $2");
	return result;
}
/**
* Comprehensive LaTeX preprocessing with configurable options
*
* This is the main preprocessing function that handles:
* - Currency symbol escaping (e.g., $20 → \$20)
* - LaTeX delimiter conversion (\[...\] → $$...$$)
* - Special character escaping (pipes, underscores, mhchem)
* - Optional error fixing and validation
* - Optional CJK character handling
*
* @param text The input string containing LaTeX and Markdown
* @param options Configuration options for fine-grained control
* @returns The preprocessed string
*
* @example
* ```ts
* // Default behavior (same as old preprocessLaTeX)
* preprocessLaTeX('向量$90^\\circ$，非 $0^\\circ$ 和 $180^\\circ$')
*
* // With custom options
* preprocessLaTeX(text, {
*   fixErrors: true,
*   validate: true,
*   handleCJK: true
* })
* ```
*/
function preprocessLaTeX(text, options = {}) {
	const { addCJKSpaces = false, convertBrackets = true, escapeCurrency = true, escapeMhchem = true, escapePipes = true, escapeUnderscores = true, fixErrors = false, handleCJK = false, normalizeSpacing = false, throwOnValidationError = false, validate = false } = options;
	let content = text;
	if (escapeCurrency) content = escapeCurrencyDollars(content);
	if (convertBrackets) content = convertLatexDelimiters(content);
	if (escapeMhchem) content = escapeMhchemCommands(content);
	if (escapePipes) content = escapeLatexPipes(content);
	if (escapeUnderscores) content = escapeTextUnderscores(content);
	if (fixErrors) content = fixCommonLaTeXErrors(content);
	if (normalizeSpacing) content = normalizeLatexSpacing(content);
	if (handleCJK) content = handleCJKWithLatex(content, addCJKSpaces);
	if (validate) {
		const validation = validateLatexExpressions(content);
		if (!validation.valid) {
			const errorMessage = `LaTeX validation failed (${validation.errors.length}/${validation.totalExpressions} expressions have errors):\n${validation.errors.map((e) => `  - [${e.type}] at position ${e.position}: ${e.message}\n    Formula: ${e.formula}`).join("\n")}`;
			if (throwOnValidationError) throw new Error(errorMessage);
			else console.warn(errorMessage);
		}
	}
	return content;
}
//#endregion
export { convertLatexDelimiters, escapeCurrencyDollars, escapeLatexPipes, escapeMhchemCommands, escapeTextUnderscores, fixCommonLaTeXErrors, handleCJKWithLatex, isLastFormulaRenderable, normalizeLatexSpacing, preprocessLaTeX, validateLatexExpressions };

//# sourceMappingURL=latex.mjs.map