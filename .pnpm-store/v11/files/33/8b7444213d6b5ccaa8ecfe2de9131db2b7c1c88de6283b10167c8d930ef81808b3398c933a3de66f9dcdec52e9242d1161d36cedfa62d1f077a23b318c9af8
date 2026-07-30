"use client";
import { DiffPanel } from "./DiffPanel.mjs";
import { getLobeDiffOptions, registerLobeDiffThemes } from "./theme.mjs";
import { memo, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { useThemeMode } from "antd-style";
import { MultiFileDiff } from "@pierre/diffs/react";
//#region src/CodeDiff/CodeDiff.tsx
registerLobeDiffThemes();
const countContentChanges = (oldContent, newContent) => {
	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");
	const oldSet = new Set(oldLines);
	const newSet = new Set(newLines);
	let deletions = 0;
	let additions = 0;
	for (const line of oldLines) if (!newSet.has(line)) deletions++;
	for (const line of newLines) if (!oldSet.has(line)) additions++;
	return {
		additions,
		deletions
	};
};
const CodeDiff = memo(({ oldContent, newContent, language, fileName, viewMode = "split", showHeader = true, defaultExpand = true, fullFeatured = true, variant = "filled", className, classNames, styles: customStyles, actionsRender, diffOptions, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	const displayName = useMemo(() => {
		if (fileName) return fileName;
		if (language) return language;
		return "diff";
	}, [fileName, language]);
	const { additions, deletions } = useMemo(() => countContentChanges(oldContent, newContent), [oldContent, newContent]);
	const actions = useMemo(() => {
		if (!actionsRender) return null;
		return actionsRender({
			newContent,
			oldContent,
			originalNode: null
		});
	}, [
		actionsRender,
		oldContent,
		newContent
	]);
	const oldFile = useMemo(() => ({
		contents: oldContent,
		lang: language,
		name: fileName || "file"
	}), [
		oldContent,
		language,
		fileName
	]);
	return /* @__PURE__ */ jsx(DiffPanel, {
		actions,
		additions,
		body: /* @__PURE__ */ jsx(MultiFileDiff, {
			newFile: useMemo(() => ({
				contents: newContent,
				lang: language,
				name: fileName || "file"
			}), [
				newContent,
				language,
				fileName
			]),
			oldFile,
			options: useMemo(() => getLobeDiffOptions({
				diffOptions,
				isDarkMode,
				viewMode
			}), [
				isDarkMode,
				viewMode,
				diffOptions
			])
		}),
		className,
		classNames,
		dataCodeType: "code-diff",
		defaultExpand,
		deletions,
		displayName,
		fileName,
		fullFeatured,
		showHeader,
		styles: customStyles,
		variant,
		...rest
	});
});
CodeDiff.displayName = "CodeDiff";
//#endregion
export { CodeDiff, CodeDiff as default };

//# sourceMappingURL=CodeDiff.mjs.map