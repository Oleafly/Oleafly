"use client";
import { DiffPanel } from "./DiffPanel.mjs";
import { getLobeDiffOptions, registerLobeDiffThemes } from "./theme.mjs";
import { memo, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { useThemeMode } from "antd-style";
import { PatchDiff } from "@pierre/diffs/react";
//#region src/CodeDiff/PatchDiff.tsx
registerLobeDiffThemes();
const countPatchChanges = (patch) => {
	const lines = patch.split("\n");
	let additions = 0;
	let deletions = 0;
	for (const line of lines) if (line.startsWith("+") && !line.startsWith("+++")) additions++;
	else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
	return {
		additions,
		deletions
	};
};
const PatchDiff$1 = memo(({ patch, language, fileName, viewMode = "split", showHeader = true, defaultExpand = true, fullFeatured = true, variant = "filled", className, classNames, styles: customStyles, actionsRender, diffOptions, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	const displayName = useMemo(() => {
		if (fileName) return fileName;
		const match = patch.match(/^(?:-{3}|\+{3})\s+(?:a\/|b\/)?(.+?)(?:\t|$)/m);
		if (match?.[1]) return match[1];
		if (language) return language;
		return "patch";
	}, [
		fileName,
		patch,
		language
	]);
	const { additions, deletions } = useMemo(() => countPatchChanges(patch), [patch]);
	return /* @__PURE__ */ jsx(DiffPanel, {
		actions: useMemo(() => {
			if (!actionsRender) return null;
			return actionsRender({
				originalNode: null,
				patch
			});
		}, [actionsRender, patch]),
		additions,
		body: /* @__PURE__ */ jsx(PatchDiff, {
			options: useMemo(() => getLobeDiffOptions({
				diffOptions,
				isDarkMode,
				viewMode
			}), [
				isDarkMode,
				viewMode,
				diffOptions
			]),
			patch
		}),
		className,
		classNames,
		dataCodeType: "patch-diff",
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
PatchDiff$1.displayName = "PatchDiff";
//#endregion
export { PatchDiff$1 as PatchDiff, PatchDiff$1 as default };

//# sourceMappingURL=PatchDiff.mjs.map