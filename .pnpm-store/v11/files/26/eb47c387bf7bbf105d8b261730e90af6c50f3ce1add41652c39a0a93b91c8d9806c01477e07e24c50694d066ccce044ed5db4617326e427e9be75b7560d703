//#region src/utils/setWrapperNodeProps.ts
function setPreNodeProperties(pre, { type, diffIndicators, disableBackground, disableLineNumbers, overflow, split, totalLines, customProperties }) {
	if (customProperties != null) for (const key in customProperties) {
		const value = customProperties[key];
		if (value != null) pre.setAttribute(key, `${value}`);
	}
	if (type === "diff") {
		pre.setAttribute("data-diff", "");
		pre.removeAttribute("data-file");
	} else {
		pre.setAttribute("data-file", "");
		pre.removeAttribute("data-diff");
	}
	switch (diffIndicators) {
		case "bars":
		case "classic":
			pre.setAttribute("data-indicators", diffIndicators);
			break;
		case "none":
			pre.removeAttribute("data-indicators");
			break;
	}
	if (disableLineNumbers) pre.setAttribute("data-disable-line-numbers", "");
	else pre.removeAttribute("data-disable-line-numbers");
	if (disableBackground) pre.removeAttribute("data-background");
	else pre.setAttribute("data-background", "");
	if (type === "diff") pre.setAttribute("data-diff-type", split ? "split" : "single");
	else pre.removeAttribute("data-diff-type");
	pre.setAttribute("data-overflow", overflow);
	pre.style.setProperty("--diffs-min-number-column-width-default", `${`${totalLines}`.length}ch`);
	return pre;
}
//#endregion
export { setPreNodeProperties };

//# sourceMappingURL=setWrapperNodeProps.js.map