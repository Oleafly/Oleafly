import { isNumber } from "es-toolkit/compat";
//#region src/Icon/components/utils.ts
const calcSize = (iconSize) => {
	if (isNumber(iconSize)) return { size: iconSize };
	let size;
	let strokeWidth;
	switch (iconSize) {
		case "large":
			size = 24;
			strokeWidth = 2;
			break;
		case "middle":
			size = 20;
			strokeWidth = 2;
			break;
		case "small":
			size = 14;
			strokeWidth = 2;
			break;
		default:
			if (iconSize) {
				size = iconSize?.size || 24;
				strokeWidth = iconSize?.strokeWidth || 2;
			} else {
				size = "1em";
				strokeWidth = 2;
			}
			break;
	}
	return {
		size,
		strokeWidth
	};
};
//#endregion
export { calcSize };

//# sourceMappingURL=utils.mjs.map