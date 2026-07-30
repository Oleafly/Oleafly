import FlexBasic_default from "../../../Flex/FlexBasic.mjs";
import Icon from "../../../Icon/Icon.mjs";
import { styles } from "../style.mjs";
import { jsx } from "react/jsx-runtime";
import { Loader2 } from "lucide-react";
//#region src/chat/ChatItem/components/Loading.tsx
const Loading = ({ loading, placement = "left" }) => {
	if (!loading) return null;
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		align: "center",
		className: placement === "left" ? styles.loadingLeft : styles.loadingRight,
		justify: "center",
		children: /* @__PURE__ */ jsx(Icon, {
			spin: true,
			icon: Loader2,
			size: {
				size: 12,
				strokeWidth: 3
			}
		})
	});
};
//#endregion
export { Loading as default };

//# sourceMappingURL=Loading.mjs.map