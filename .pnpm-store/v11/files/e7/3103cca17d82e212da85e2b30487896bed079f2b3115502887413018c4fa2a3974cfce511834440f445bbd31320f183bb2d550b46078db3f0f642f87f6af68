import { DEFAULT_THEMES } from "../constants.js";
import { getFiletypeFromFileName } from "./getFiletypeFromFileName.js";
import { cleanLastNewline } from "./cleanLastNewline.js";
import { createTransformerWithState } from "./createTransformerWithState.js";
import { formatCSSVariablePrefix } from "./formatCSSVariablePrefix.js";
import { getHighlighterThemeStyles } from "./getHighlighterThemeStyles.js";
import { getLineNodes } from "./getLineNodes.js";
import { iterateOverDiff } from "./iterateOverDiff.js";
import { createDiffSpanDecoration, pushOrJoinSpan } from "./parseDiffDecorations.js";
import { diffChars, diffWordsWithSpace } from "diff";
//#region src/utils/renderDiffWithHighlighter.ts
const DEFAULT_PLAIN_TEXT_OPTIONS = { forcePlainText: false };
function renderDiffWithHighlighter(diff, highlighter, options, { forcePlainText, startingLine, totalLines, expandedHunks, collapsedContextThreshold = 1 } = DEFAULT_PLAIN_TEXT_OPTIONS) {
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
export { renderDiffWithHighlighter };

//# sourceMappingURL=renderDiffWithHighlighter.js.map