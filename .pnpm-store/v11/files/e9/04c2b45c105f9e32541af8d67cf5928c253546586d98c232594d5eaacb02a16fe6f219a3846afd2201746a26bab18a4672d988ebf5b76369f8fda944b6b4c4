//#region src/Markdown/SyntaxMarkdown/streamAnimationMeta.ts
const isActiveBlock = (state) => {
	return state === "animating" || state === "streaming";
};
const resolveBlockAnimationMeta = ({ currentCharDelay, fadeDuration, lastElapsedMs, previousCharDelay, state }) => {
	return {
		charDelay: isActiveBlock(state) ? currentCharDelay : previousCharDelay ?? currentCharDelay,
		settled: state === "revealed" && lastElapsedMs >= fadeDuration
	};
};
//#endregion
export { resolveBlockAnimationMeta };

//# sourceMappingURL=streamAnimationMeta.mjs.map