//#region src/DraggablePanel/utils.ts
const isBelowCollapseThreshold = ({ axis, collapseThreshold, size }) => {
	if (collapseThreshold === void 0) return false;
	const currentSize = size[axis];
	if (currentSize === void 0) return false;
	const numericSize = typeof currentSize === "number" ? currentSize : Number.parseFloat(currentSize);
	return Number.isFinite(numericSize) && numericSize <= Math.max(collapseThreshold, 0);
};
const reversePlacement = (placement) => {
	switch (placement) {
		case "bottom": return "top";
		case "top": return "bottom";
		case "right": return "left";
		case "left": return "right";
	}
};
//#endregion
export { isBelowCollapseThreshold, reversePlacement };

//# sourceMappingURL=utils.mjs.map