import FlexBasic_default from "../../../Flex/FlexBasic.mjs";
import { styles } from "../style.mjs";
import { formatTime } from "../../../utils/formatTime.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/chat/ChatItem/components/Title.tsx
const Title = ({ showTitle, placement = "left", time, avatar, titleAddon }) => {
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		align: "center",
		className: placement === "left" ? styles.nameLeft : styles.nameRight,
		direction: placement === "left" ? "horizontal" : "horizontal-reverse",
		gap: 4,
		children: [
			showTitle ? avatar.title || "untitled" : void 0,
			showTitle ? titleAddon : void 0,
			time && /* @__PURE__ */ jsx("time", { children: formatTime(time) })
		]
	});
};
//#endregion
export { Title as default };

//# sourceMappingURL=Title.mjs.map