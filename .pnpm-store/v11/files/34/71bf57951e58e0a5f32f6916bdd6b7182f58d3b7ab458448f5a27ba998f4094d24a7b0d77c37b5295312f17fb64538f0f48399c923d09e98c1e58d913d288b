//#region src/utils/placement.ts
const top = {
	align: "center",
	side: "top"
};
const topLeft = {
	align: "start",
	side: "top"
};
const topRight = {
	align: "end",
	side: "top"
};
const bottom = {
	align: "center",
	side: "bottom"
};
/**
* Map of placement values to Base UI placement config
* Used by Popover and DropdownMenu components
*/
const placementMap = {
	bottom,
	bottomCenter: bottom,
	bottomLeft: {
		align: "start",
		side: "bottom"
	},
	bottomRight: {
		align: "end",
		side: "bottom"
	},
	left: {
		align: "center",
		side: "left"
	},
	leftBottom: {
		align: "end",
		side: "left"
	},
	leftTop: {
		align: "start",
		side: "left"
	},
	right: {
		align: "center",
		side: "right"
	},
	rightBottom: {
		align: "end",
		side: "right"
	},
	rightTop: {
		align: "start",
		side: "right"
	},
	top,
	topCenter: top,
	topLeft,
	topRight
};
/**
* Convert unified Placement to Floating UI placement format
* Used by Tooltip component which uses @floating-ui/react
*
* @param placement - Unified placement value
* @returns Floating UI placement (e.g., 'top-start', 'bottom-end')
*/
const toFloatingUIPlacement = (placement) => {
	if (!placement) return "top";
	switch (placement) {
		case "topLeft": return "top-start";
		case "top":
		case "topCenter": return "top";
		case "topRight": return "top-end";
		case "bottomLeft": return "bottom-start";
		case "bottom":
		case "bottomCenter": return "bottom";
		case "bottomRight": return "bottom-end";
		case "leftTop": return "left-start";
		case "left": return "left";
		case "leftBottom": return "left-end";
		case "rightTop": return "right-start";
		case "right": return "right";
		case "rightBottom": return "right-end";
		default: return "top";
	}
};
//#endregion
export { placementMap, toFloatingUIPlacement };

//# sourceMappingURL=placement.mjs.map