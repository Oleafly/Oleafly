import Icon from "../Icon/Icon.mjs";
import { isValidElement } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/Menu/utils.tsx
const mapItems = (item) => {
	switch (item?.type) {
		case "divider": return item;
		case "group": {
			const { children, ...rest } = item;
			return {
				children: children ? children?.map((i) => mapItems(i)) : void 0,
				...rest
			};
		}
		default: {
			const { children, icon, ...rest } = item;
			return {
				children: children ? children?.map((i) => mapItems(i)) : void 0,
				icon: icon ? isValidElement(icon) ? icon : /* @__PURE__ */ jsx(Icon, {
					icon,
					size: "small"
				}) : void 0,
				...rest
			};
		}
	}
};
//#endregion
export { mapItems };

//# sourceMappingURL=utils.mjs.map