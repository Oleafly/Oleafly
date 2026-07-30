"use client";
import { isDeepEqual } from "../../utils/isDeepEqual.mjs";
import { useStableValue } from "../../hooks/useStableValue.mjs";
import { useMarkdownContext } from "../components/MarkdownProvider.mjs";
import { useMarkdownComponents } from "../../hooks/useMarkdown/useMarkdownComponents.mjs";
import { useMarkdownContent } from "../../hooks/useMarkdown/useMarkdownContent.mjs";
import { useMarkdownRehypePlugins } from "../../hooks/useMarkdown/useMarkdownRehypePlugins.mjs";
import { useMarkdownRemarkPlugins } from "../../hooks/useMarkdown/useMarkdownRemarkPlugins.mjs";
import { getNow } from "../../utils/getNow.mjs";
import { rehypeStreamAnimated } from "../plugins/rehypeStreamAnimated.mjs";
import { useStreamdownProfiler } from "../streamProfiler/StreamdownProfilerProvider.mjs";
import { CachedMarkdown } from "./CachedMarkdown.mjs";
import { resolveBlockAnimationMeta } from "./streamAnimationMeta.mjs";
import { styles } from "./style.mjs";
import { countChars, useSmoothStreamContent } from "./useSmoothStreamContent.mjs";
import { useStreamQueue } from "./useStreamQueue.mjs";
import { Profiler, createElement, memo, useCallback, useEffect, useId, useMemo, useRef } from "react";
import { jsx } from "react/jsx-runtime";
import { marked } from "marked";
import remend from "remend";
//#region src/Markdown/SyntaxMarkdown/StreamdownRender.tsx
const isSamePlugin = (prevPlugin, nextPlugin) => {
	const prevTuple = Array.isArray(prevPlugin) ? prevPlugin : [prevPlugin];
	const nextTuple = Array.isArray(nextPlugin) ? nextPlugin : [nextPlugin];
	if (prevTuple.length !== nextTuple.length) return false;
	if (prevTuple[0] !== nextTuple[0]) return false;
	return isDeepEqual(prevTuple.slice(1), nextTuple.slice(1));
};
const isSamePlugins = (prevPlugins, nextPlugins) => {
	if (prevPlugins === nextPlugins) return true;
	if (!prevPlugins || !nextPlugins) return !prevPlugins && !nextPlugins;
	if (prevPlugins.length !== nextPlugins.length) return false;
	for (let i = 0; i < prevPlugins.length; i++) if (!isSamePlugin(prevPlugins[i], nextPlugins[i])) return false;
	return true;
};
const useStablePlugins = (plugins) => {
	const stableRef = useRef(plugins);
	if (!isSamePlugins(stableRef.current, plugins)) stableRef.current = plugins;
	return stableRef.current;
};
const StreamdownBlock = memo(({ children, ...rest }) => {
	return /* @__PURE__ */ jsx(CachedMarkdown, {
		...rest,
		children
	});
}, (prevProps, nextProps) => prevProps.children === nextProps.children && prevProps.components === nextProps.components && isSamePlugins(prevProps.rehypePlugins, nextProps.rehypePlugins) && isSamePlugins(prevProps.remarkPlugins, nextProps.remarkPlugins));
StreamdownBlock.displayName = "StreamdownBlock";
const MIN_STREAM_CHAR_PACE_MS = 2;
const MAX_REVEAL_GAP_MS = 160;
const updateBlockAnimation = ({ blocks, charDelay, getBlockState, pluginsCache, renderNow, revealClock, runtimes }) => {
	const blockAnimationMeta = /* @__PURE__ */ new Map();
	const alive = /* @__PURE__ */ new Set();
	let revealedNewChars = false;
	for (const [index, block] of blocks.entries()) {
		alive.add(block.startOffset);
		const state = getBlockState(index);
		if (state === "queued") continue;
		let runtime = runtimes.get(block.startOffset);
		if (!runtime) {
			runtime = {
				births: [],
				charCount: 0,
				rawLength: -1,
				settled: false,
				styles: []
			};
			runtimes.set(block.startOffset, runtime);
		}
		if (runtime.rawLength !== block.content.length) {
			runtime.charCount = countChars(block.content);
			runtime.rawLength = block.content.length;
		}
		const blockCharCount = runtime.charCount;
		const births = runtime.births;
		if (births.length > blockCharCount) {
			births.length = blockCharCount;
			runtime.styles.length = blockCharCount;
		}
		if (births.length < blockCharCount) {
			const newChars = blockCharCount - births.length;
			let pace = charDelay;
			let cap = renderNow + 180;
			if (state === "streaming") {
				revealedNewChars = true;
				const gapMs = Math.min(Math.max(renderNow - revealClock.lastTs, 16), MAX_REVEAL_GAP_MS);
				pace = Math.min(charDelay, Math.max(gapMs / newChars, MIN_STREAM_CHAR_PACE_MS));
				cap = renderNow + gapMs + 180;
			}
			for (let i = births.length; i < blockCharCount; i++) {
				const chained = (i > 0 ? births[i - 1] : renderNow - pace) + pace;
				births.push(Math.min(cap, Math.max(chained, renderNow)));
			}
		}
		let meta;
		if (runtime.settled) meta = {
			charDelay: runtime.charDelay ?? charDelay,
			settled: true
		};
		else {
			meta = resolveBlockAnimationMeta({
				currentCharDelay: charDelay,
				fadeDuration: 180,
				lastElapsedMs: renderNow - (births.length > 0 ? births.at(-1) ?? renderNow : renderNow),
				previousCharDelay: runtime.charDelay,
				state
			});
			runtime.settled = meta.settled;
		}
		runtime.charDelay = meta.charDelay;
		blockAnimationMeta.set(block.startOffset, meta);
	}
	if (revealedNewChars) revealClock.lastTs = renderNow;
	for (const key of runtimes.keys()) if (!alive.has(key)) {
		runtimes.delete(key);
		pluginsCache.delete(key);
	}
	return blockAnimationMeta;
};
const StreamdownBlocks = memo(({ content: smoothedContent, markdownOptions: rest }) => {
	const { streamAnimationGranularity = "char" } = useMarkdownContext();
	const profiler = useStreamdownProfiler();
	const components = useMarkdownComponents();
	const baseRehypePlugins = useStablePlugins(useMarkdownRehypePlugins());
	const remarkPlugins = useStablePlugins(useMarkdownRemarkPlugins());
	const generatedId = useId();
	const processedContentResult = useMemo(() => {
		const start = profiler ? getNow() : 0;
		const value = remend(smoothedContent);
		return {
			durationMs: profiler ? getNow() - start : 0,
			value
		};
	}, [profiler, smoothedContent]);
	const processedContent = processedContentResult.value;
	const blocksResult = useMemo(() => {
		const start = profiler ? getNow() : 0;
		const tokens = marked.lexer(processedContent);
		let offset = 0;
		const value = tokens.map((token) => {
			const block = {
				content: token.raw,
				startOffset: offset
			};
			offset += token.raw.length;
			return block;
		});
		return {
			durationMs: profiler ? getNow() - start : 0,
			value
		};
	}, [processedContent, profiler]);
	const blocks = blocksResult.value;
	const { getBlockState, charDelay } = useStreamQueue(blocks);
	const blockRuntimesRef = useRef(/* @__PURE__ */ new Map());
	const blockPluginsRef = useRef(/* @__PURE__ */ new Map());
	const revealClockRef = useRef({ lastTs: 0 });
	const renderNow = getNow();
	const animationStart = profiler ? getNow() : 0;
	const blockAnimationMeta = updateBlockAnimation({
		blocks,
		charDelay,
		getBlockState,
		pluginsCache: blockPluginsRef.current,
		renderNow,
		revealClock: revealClockRef.current,
		runtimes: blockRuntimesRef.current
	});
	const blockAnimationDurationMs = profiler ? getNow() - animationStart : 0;
	useEffect(() => {
		if (!profiler) return;
		profiler.recordCalculation({
			durationMs: processedContentResult.durationMs,
			name: "content-normalize",
			textLength: processedContent.length
		});
	}, [
		processedContent.length,
		processedContentResult.durationMs,
		profiler
	]);
	useEffect(() => {
		if (!profiler) return;
		profiler.recordCalculation({
			durationMs: blocksResult.durationMs,
			itemCount: blocks.length,
			name: "block-lex",
			textLength: processedContent.length
		});
	}, [
		blocks.length,
		blocksResult.durationMs,
		processedContent.length,
		profiler
	]);
	useEffect(() => {
		if (!profiler) return;
		profiler.recordCalculation({
			durationMs: blockAnimationDurationMs,
			itemCount: blocks.length,
			name: "block-births",
			textLength: processedContent.length
		});
	}, [
		blockAnimationDurationMs,
		blocks.length,
		processedContent.length,
		profiler
	]);
	const resolveBlockPlugins = (startOffset, settled) => {
		if (settled) return baseRehypePlugins;
		const cache = blockPluginsRef.current;
		const entry = cache.get(startOffset);
		if (entry && entry.base === baseRehypePlugins && entry.granularity === streamAnimationGranularity) return entry.value;
		const runtime = blockRuntimesRef.current.get(startOffset);
		const value = [...baseRehypePlugins, [rehypeStreamAnimated, {
			fadeDuration: 180,
			granularity: streamAnimationGranularity,
			runtime
		}]];
		cache.set(startOffset, {
			base: baseRehypePlugins,
			granularity: streamAnimationGranularity,
			value
		});
		return value;
	};
	const handleRootRender = useCallback((_, phase, actualDuration, baseDuration) => {
		profiler?.recordRootCommit({
			actualDuration,
			baseDuration,
			blockCount: blocks.length,
			phase,
			textLength: processedContent.length
		});
	}, [
		blocks.length,
		processedContent.length,
		profiler
	]);
	const handleBlockRender = useCallback((id, phase, actualDuration, baseDuration) => {
		if (!profiler) return;
		const [, indexText, offsetText] = id.split(":");
		const blockIndex = Number(indexText);
		if (!Number.isFinite(blockIndex)) return;
		const block = blocks[blockIndex];
		if (!block) return;
		profiler.recordBlockCommit({
			actualDuration,
			baseDuration,
			blockChars: countChars(block.content),
			blockIndex,
			blockKey: offsetText ?? String(block.startOffset),
			phase,
			state: getBlockState(blockIndex)
		});
	}, [
		blocks,
		getBlockState,
		profiler
	]);
	const content = /* @__PURE__ */ jsx("div", {
		className: styles.animated,
		children: blocks.map((block, index) => {
			const animationMeta = blockAnimationMeta.get(block.startOffset);
			if (!animationMeta) return null;
			const plugins = resolveBlockPlugins(block.startOffset, animationMeta.settled);
			const key = `${generatedId}-${block.startOffset}`;
			if (!profiler) return /* @__PURE__ */ createElement(StreamdownBlock, {
				...rest,
				components,
				key,
				rehypePlugins: plugins,
				remarkPlugins
			}, block.content);
			return /* @__PURE__ */ jsx(Profiler, {
				id: `streamdown-block:${index}:${block.startOffset}`,
				onRender: handleBlockRender,
				children: /* @__PURE__ */ jsx(StreamdownBlock, {
					...rest,
					components,
					rehypePlugins: plugins,
					remarkPlugins,
					children: block.content
				})
			}, key);
		})
	});
	if (!profiler) return content;
	return /* @__PURE__ */ jsx(Profiler, {
		id: "streamdown-root",
		onRender: handleRootRender,
		children: content
	});
});
StreamdownBlocks.displayName = "StreamdownBlocks";
const StreamdownRender = memo(({ children, ...rest }) => {
	const { streamSmoothingPreset = "balanced" } = useMarkdownContext();
	const escapedContent = useMarkdownContent(children || "");
	const smoothedContent = useSmoothStreamContent(typeof escapedContent === "string" ? escapedContent : "", { preset: streamSmoothingPreset });
	const markdownOptions = useStableValue(rest);
	return /* @__PURE__ */ jsx(StreamdownBlocks, {
		content: smoothedContent,
		markdownOptions
	});
});
StreamdownRender.displayName = "StreamdownRender";
//#endregion
export { StreamdownRender, StreamdownRender as default };

//# sourceMappingURL=StreamdownRender.mjs.map