"use client";
//#region src/utils/parseTrigger.ts
/**
* Parses trigger prop to determine hover and click behavior
*/
function parseTrigger(trigger) {
	const normalizedTriggers = new Set((Array.isArray(trigger) ? trigger : [trigger]).flatMap((item) => item === "both" ? ["hover", "click"] : [item]));
	return {
		openOnClick: normalizedTriggers.has("click"),
		openOnHover: normalizedTriggers.has("hover")
	};
}
//#endregion
export { parseTrigger };

//# sourceMappingURL=parseTrigger.mjs.map