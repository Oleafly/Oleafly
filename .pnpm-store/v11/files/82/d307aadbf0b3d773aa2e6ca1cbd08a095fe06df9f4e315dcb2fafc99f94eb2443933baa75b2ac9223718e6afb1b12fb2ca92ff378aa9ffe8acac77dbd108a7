import FlexBasic_default from "../../../Flex/FlexBasic.mjs";
import Alert from "../../../Alert/Alert.mjs";
import { styles } from "../style.mjs";
import { jsx } from "react/jsx-runtime";
//#region src/chat/ChatItem/components/ErrorContent.tsx
const ErrorContent = ({ message, error }) => {
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		className: styles.errorContainer,
		children: /* @__PURE__ */ jsx(Alert, {
			showIcon: true,
			closable: false,
			extra: message,
			type: "error",
			...error
		})
	});
};
//#endregion
export { ErrorContent as default };

//# sourceMappingURL=ErrorContent.mjs.map