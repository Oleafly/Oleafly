//#region src/constants.ts
const DIFFS_TAG_NAME = "diffs-container";
const DIFFS_DEVELOPMENT_BUILD = (() => {
	try {
		return process.env.NODE_ENV === "development";
	} catch {
		return false;
	}
})();
const COMMIT_METADATA_SPLIT = /(?=^From [a-f0-9]+ .+$)/m;
const GIT_DIFF_FILE_BREAK_REGEX = /(?=^diff --git)/gm;
const UNIFIED_DIFF_FILE_BREAK_REGEX = /(?=^---\s+\S)/gm;
const FILE_CONTEXT_BLOB = /(?=^@@ )/gm;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: (.*))?/m;
const SPLIT_WITH_NEWLINES = /(?<=\n)/;
const FILENAME_HEADER_REGEX = /^(---|\+\+\+)\s+([^\t\r\n]+)/;
const FILENAME_HEADER_REGEX_GIT = /^(---|\+\+\+)\s+[ab]\/([^\t\r\n]+)/;
const ALTERNATE_FILE_NAMES_GIT = /^diff --git (?:"a\/(.+?)"|a\/(.+?)) (?:"b\/(.+?)"|b\/(.+?))$/;
const INDEX_LINE_METADATA = /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d+))?$/i;
const MERGE_CONFLICT_START_MARKER_REGEX = /^<{7,}(?:\s.*)?$/;
const MERGE_CONFLICT_BASE_MARKER_REGEX = /^\|{7,}(?:\s.*)?$/;
const MERGE_CONFLICT_SEPARATOR_MARKER_REGEX = /^={7,}$/;
const MERGE_CONFLICT_END_MARKER_REGEX = /^>{7,}(?:\s.*)?$/;
const HEADER_PREFIX_SLOT_ID = "header-prefix";
const HEADER_METADATA_SLOT_ID = "header-metadata";
const CUSTOM_HEADER_SLOT_ID = "header-custom";
const DEFAULT_THEMES = {
	dark: "pierre-dark",
	light: "pierre-light"
};
const THEME_CSS_ATTRIBUTE = "data-theme-css";
const UNSAFE_CSS_ATTRIBUTE = "data-unsafe-css";
const CORE_CSS_ATTRIBUTE = "data-core-css";
const DIFFS_SCROLLBAR_MEASURE_ATTRIBUTE = "data-diffs-scrollbar-measure";
const DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY = "--diffs-scrollbar-gutter-measured";
const DEFAULT_COLLAPSED_CONTEXT_THRESHOLD = 1;
const DEFAULT_TOKENIZE_MAX_LENGTH = 1e5;
const DEFAULT_VIRTUAL_FILE_METRICS = {
	hunkLineCount: 50,
	lineHeight: 20,
	diffHeaderHeight: 44,
	spacing: 8
};
const DEFAULT_CODE_VIEW_FILE_METRICS = {
	...DEFAULT_VIRTUAL_FILE_METRICS,
	hunkLineCount: 1
};
const DEFAULT_CODE_VIEW_LAYOUT = {
	paddingTop: 8,
	paddingBottom: 8,
	gap: 8
};
const DEFAULT_SMOOTH_SCROLL_SETTINGS = {
	omega: .015,
	positionEpsilon: .5,
	velocityEpsilon: .05
};
const DEFAULT_EXPANDED_REGION = Object.freeze({
	fromStart: 0,
	fromEnd: 0
});
const DEFAULT_RENDER_RANGE = {
	startingLine: 0,
	totalLines: Infinity,
	bufferBefore: 0,
	bufferAfter: 0
};
const EMPTY_RENDER_RANGE = {
	startingLine: 0,
	totalLines: 0,
	bufferBefore: 0,
	bufferAfter: 0
};
//#endregion
export { ALTERNATE_FILE_NAMES_GIT, COMMIT_METADATA_SPLIT, CORE_CSS_ATTRIBUTE, CUSTOM_HEADER_SLOT_ID, DEFAULT_CODE_VIEW_FILE_METRICS, DEFAULT_CODE_VIEW_LAYOUT, DEFAULT_COLLAPSED_CONTEXT_THRESHOLD, DEFAULT_EXPANDED_REGION, DEFAULT_RENDER_RANGE, DEFAULT_SMOOTH_SCROLL_SETTINGS, DEFAULT_THEMES, DEFAULT_TOKENIZE_MAX_LENGTH, DEFAULT_VIRTUAL_FILE_METRICS, DIFFS_DEVELOPMENT_BUILD, DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY, DIFFS_SCROLLBAR_MEASURE_ATTRIBUTE, DIFFS_TAG_NAME, EMPTY_RENDER_RANGE, FILENAME_HEADER_REGEX, FILENAME_HEADER_REGEX_GIT, FILE_CONTEXT_BLOB, GIT_DIFF_FILE_BREAK_REGEX, HEADER_METADATA_SLOT_ID, HEADER_PREFIX_SLOT_ID, HUNK_HEADER, INDEX_LINE_METADATA, MERGE_CONFLICT_BASE_MARKER_REGEX, MERGE_CONFLICT_END_MARKER_REGEX, MERGE_CONFLICT_SEPARATOR_MARKER_REGEX, MERGE_CONFLICT_START_MARKER_REGEX, SPLIT_WITH_NEWLINES, THEME_CSS_ATTRIBUTE, UNIFIED_DIFF_FILE_BREAK_REGEX, UNSAFE_CSS_ATTRIBUTE };

//# sourceMappingURL=constants.js.map