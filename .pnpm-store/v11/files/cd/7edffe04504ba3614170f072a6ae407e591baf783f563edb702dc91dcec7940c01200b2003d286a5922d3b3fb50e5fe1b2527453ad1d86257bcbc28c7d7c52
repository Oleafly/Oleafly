//#region src/shiki-stream/tokenizer.ts
var ShikiStreamTokenizer = class ShikiStreamTokenizer {
	options;
	tokensStable = [];
	tokensUnstable = [];
	lastUnstableCodeChunk = "";
	lastStableGrammarState;
	constructor(options) {
		this.options = options;
	}
	/**
	* Enqueue a chunk of code to the buffer.
	*/
	async enqueue(chunk) {
		const chunkLines = (this.lastUnstableCodeChunk + chunk).split("\n");
		const stable = [];
		let unstable = [];
		const recall = this.tokensUnstable.length;
		chunkLines.forEach((line, i) => {
			const isLastLine = i === chunkLines.length - 1;
			const result = this.options.highlighter.codeToTokens(line, {
				...this.options,
				grammarState: this.lastStableGrammarState
			});
			const tokens = result.tokens[0];
			if (!isLastLine) tokens.push({
				content: "\n",
				offset: 0
			});
			if (!isLastLine) {
				this.lastStableGrammarState = result.grammarState;
				stable.push(...tokens);
			} else {
				unstable = tokens;
				this.lastUnstableCodeChunk = line;
			}
		});
		this.tokensStable.push(...stable);
		this.tokensUnstable = unstable;
		return {
			recall,
			stable,
			unstable
		};
	}
	close() {
		const stable = this.tokensUnstable;
		this.tokensUnstable = [];
		this.lastUnstableCodeChunk = "";
		this.lastStableGrammarState = void 0;
		return { stable };
	}
	clear() {
		this.tokensStable = [];
		this.tokensUnstable = [];
		this.lastUnstableCodeChunk = "";
		this.lastStableGrammarState = void 0;
	}
	clone() {
		const clone = new ShikiStreamTokenizer(this.options);
		clone.lastUnstableCodeChunk = this.lastUnstableCodeChunk;
		clone.tokensUnstable = this.tokensUnstable;
		clone.tokensStable = this.tokensStable;
		clone.lastStableGrammarState = this.lastStableGrammarState;
		return clone;
	}
};
//#endregion
export { ShikiStreamTokenizer };

//# sourceMappingURL=tokenizer.js.map