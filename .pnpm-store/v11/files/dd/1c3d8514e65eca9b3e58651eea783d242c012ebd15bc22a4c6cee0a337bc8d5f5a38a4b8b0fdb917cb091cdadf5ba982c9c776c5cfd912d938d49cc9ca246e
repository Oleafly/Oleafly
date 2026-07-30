import { isNumber } from "es-toolkit/compat";
//#region src/ActionIcon/components/utils.ts
const calcSize = (iconSize) => {
	let blockSize;
	let borderRadius;
	if (isNumber(iconSize)) {
		const blockSize = iconSize * 1.8;
		return {
			blockSize,
			borderRadius: Math.floor(blockSize / 6)
		};
	}
	switch (iconSize) {
		case "large":
			blockSize = 44;
			borderRadius = 8;
			break;
		case "middle":
			blockSize = 36;
			borderRadius = 6;
			break;
		case "small":
			blockSize = 24;
			borderRadius = 4;
			break;
		default:
			if (iconSize) {
				blockSize = iconSize?.blockSize || 36;
				borderRadius = iconSize?.borderRadius || 6;
			} else {
				blockSize = "1.8em";
				borderRadius = "0.3em";
			}
			break;
	}
	return {
		blockSize,
		borderRadius
	};
};
//#endregion
export { calcSize };

//# sourceMappingURL=utils.mjs.map