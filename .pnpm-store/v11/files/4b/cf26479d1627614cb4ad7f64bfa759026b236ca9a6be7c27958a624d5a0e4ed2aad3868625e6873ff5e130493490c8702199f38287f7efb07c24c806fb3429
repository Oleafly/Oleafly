"use client";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import { styles, variants } from "./style.mjs";
import { jsx } from "react/jsx-runtime";
import { Tabs } from "antd";
import { cx } from "antd-style";
import { MoreHorizontalIcon } from "lucide-react";
//#region src/Tabs/Tabs.tsx
/**
* @deprecated Use `Tabs` from `@lobehub/ui/base-ui` instead.
*/
const Tabs$1 = ({ className, compact, variant = "rounded", items, classNames, ...rest }) => {
	const hasContent = items?.some((item) => !!item.children);
	const popupClassNames = {
		root: styles.dropdown,
		...typeof classNames === "function" ? void 0 : classNames?.popup
	};
	const mergedClassNames = typeof classNames === "function" ? Object.assign((info) => classNames(info), { popup: popupClassNames }) : {
		...classNames,
		popup: popupClassNames
	};
	return /* @__PURE__ */ jsx(Tabs, {
		className: cx(variants({
			compact,
			underlined: hasContent,
			variant
		}), className),
		items,
		...rest,
		classNames: mergedClassNames,
		more: {
			icon: /* @__PURE__ */ jsx(ActionIcon, { icon: MoreHorizontalIcon }),
			...rest?.more
		}
	});
};
Tabs$1.displayName = "Tabs";
//#endregion
export { Tabs$1 as default };

//# sourceMappingURL=Tabs.mjs.map