import { visit } from "../../node_modules/.bun/unist-util-visit@5.1.0/node_modules/unist-util-visit/lib/index.mjs";
import { getNow } from "../../utils/getNow.mjs";
//#region src/Markdown/plugins/rehypeStreamAnimated.ts
const WORD_SEGMENT_RE = /\s+|\S+/g;
const wordSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(void 0, { granularity: "word" }) : null;
const segmentWords = (value) => {
	if (!wordSegmenter) return value.match(WORD_SEGMENT_RE) ?? [];
	const segments = [];
	for (const item of wordSegmenter.segment(value)) segments.push(item.segment);
	return segments;
};
const BLOCK_TAGS = /* @__PURE__ */ new Set([
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"li"
]);
const SKIP_TAGS = /* @__PURE__ */ new Set([
	"pre",
	"code",
	"table",
	"svg"
]);
function hasClass(node, cls) {
	const cn = node.properties?.className;
	if (Array.isArray(cn)) return cn.some((c) => String(c).includes(cls));
	return false;
}
const rehypeStreamAnimated = (options = {}) => {
	const { births, fadeDuration = 150, granularity = "char", nowMs, revealed = false, runtime } = options;
	const resolvedRuntime = revealed ? void 0 : runtime ?? (Array.isArray(births) && typeof nowMs === "number" ? {
		births,
		styles: []
	} : void 0);
	const nowOverride = runtime ? void 0 : nowMs;
	return (tree) => {
		let globalCharIndex = 0;
		const now = nowOverride ?? (resolvedRuntime ? getNow() : 0);
		const shouldSkip = (node) => {
			return SKIP_TAGS.has(node.tagName) || hasClass(node, "katex");
		};
		const resolveStyle = (index) => {
			const styles = resolvedRuntime.styles;
			const cached = styles[index];
			if (cached !== void 0) return cached;
			const birthTs = resolvedRuntime.births[index];
			let resolved;
			if (birthTs === void 0) resolved = null;
			else {
				const elapsed = now - birthTs;
				resolved = elapsed >= fadeDuration ? null : `animation-delay:${-elapsed}ms`;
			}
			styles[index] = resolved;
			return resolved;
		};
		const buildSpan = (value, startIndex) => {
			let className = "stream-char";
			let style;
			if (revealed) className = "stream-char stream-char-revealed";
			else if (resolvedRuntime) {
				const resolved = resolveStyle(startIndex);
				if (resolved === null) className = "stream-char stream-char-revealed";
				else style = resolved;
			}
			const properties = { className };
			if (style !== void 0) properties.style = style;
			return {
				children: [{
					type: "text",
					value
				}],
				properties,
				tagName: "span",
				type: "element"
			};
		};
		const wrapText = (node) => {
			const newChildren = [];
			for (const child of node.children) if (child.type === "text") if (granularity === "word") for (const segment of segmentWords(child.value)) {
				const startIndex = globalCharIndex;
				for (const _char of segment) globalCharIndex++;
				if (segment.trim() === "") newChildren.push({
					type: "text",
					value: segment
				});
				else newChildren.push(buildSpan(segment, startIndex));
			}
			else for (const char of child.value) {
				newChildren.push(buildSpan(char, globalCharIndex));
				globalCharIndex++;
			}
			else if (child.type === "element") {
				if (!shouldSkip(child)) wrapText(child);
				newChildren.push(child);
			} else newChildren.push(child);
			node.children = newChildren;
		};
		visit(tree, "element", ((node) => {
			if (shouldSkip(node)) return "skip";
			if (BLOCK_TAGS.has(node.tagName)) {
				wrapText(node);
				return "skip";
			}
		}));
	};
};
//#endregion
export { rehypeStreamAnimated };

//# sourceMappingURL=rehypeStreamAnimated.mjs.map