import { ShikiStreamTokenizer } from "./tokenizer.js";
//#region src/shiki-stream/stream.ts
/**
* Create a transform stream that takes code chunks and emits themed tokens.
*/
var CodeToTokenTransformStream = class extends TransformStream {
	tokenizer;
	options;
	constructor(options) {
		const tokenizer = new ShikiStreamTokenizer(options);
		const { allowRecalls = false } = options;
		super({
			async transform(chunk, controller) {
				const { stable, unstable: buffer, recall } = await tokenizer.enqueue(chunk);
				if (allowRecalls && recall > 0) controller.enqueue({ recall });
				for (const token of stable) controller.enqueue(token);
				if (allowRecalls) for (const token of buffer) controller.enqueue(token);
			},
			async flush(controller) {
				const { stable } = tokenizer.close();
				if (!allowRecalls) for (const token of stable) controller.enqueue(token);
			}
		});
		this.tokenizer = tokenizer;
		this.options = options;
	}
};
//#endregion
export { CodeToTokenTransformStream };

//# sourceMappingURL=stream.js.map