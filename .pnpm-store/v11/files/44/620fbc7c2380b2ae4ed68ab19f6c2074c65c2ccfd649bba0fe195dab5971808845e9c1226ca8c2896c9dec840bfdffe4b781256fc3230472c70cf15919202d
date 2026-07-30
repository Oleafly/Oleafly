import FlexBasic_default from "../../../Flex/FlexBasic.mjs";
import { styles } from "../style.mjs";
import { useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/chat/ChatItem/components/Actions.tsx
const Actions = ({ actions, placement = "left", variant = "bubble", editing, ref }) => {
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		align: "flex-start",
		className: cx(useMemo(() => {
			if (variant === "bubble") return placement === "left" ? styles.actionsBubbleLeft : styles.actionsBubbleRight;
			return placement === "left" ? styles.actionsDocsLeft : styles.actionsDocsRight;
		}, [placement, variant]), editing && styles.actionsEditing),
		ref,
		role: "menubar",
		children: actions
	});
};
//#endregion
export { Actions as default };

//# sourceMappingURL=Actions.mjs.map