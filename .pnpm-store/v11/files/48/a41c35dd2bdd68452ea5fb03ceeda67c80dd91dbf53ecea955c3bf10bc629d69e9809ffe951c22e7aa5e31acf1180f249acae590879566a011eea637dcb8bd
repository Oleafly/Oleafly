import ActionIconGroup from "../../../ActionIconGroup/ActionIconGroup.mjs";
import { useChatListActionsBar } from "./useChatListActionsBar.mjs";
import { jsx } from "react/jsx-runtime";
//#region src/chat/ChatList/components/ChatActionsBar.tsx
const ChatActionsBar = ({ text, ref, ...rest }) => {
	const { regenerate, edit, copy, divider, del } = useChatListActionsBar(text);
	return /* @__PURE__ */ jsx(ActionIconGroup, {
		items: [regenerate, edit],
		menu: [
			edit,
			copy,
			regenerate,
			divider,
			del
		],
		ref,
		...rest
	});
};
//#endregion
export { ChatActionsBar as default };

//# sourceMappingURL=ChatActionsBar.mjs.map