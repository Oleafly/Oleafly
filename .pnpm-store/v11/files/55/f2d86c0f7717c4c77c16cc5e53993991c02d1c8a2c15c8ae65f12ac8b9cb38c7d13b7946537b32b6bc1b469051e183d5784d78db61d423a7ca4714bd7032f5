import { produce } from "immer";
//#region src/chat/EditableMessageList/messageReducer.ts
const messagesReducer = (state, payload) => {
	switch (payload.type) {
		case "addMessage": return [...state, payload.message];
		case "insertMessage": return produce(state, (draftState) => {
			draftState.splice(payload.index, 0, payload.message);
		});
		case "deleteMessage": return state.filter((_, index) => index !== payload.index);
		case "resetMessages": return [];
		case "updateMessage": return produce(state, (draftState) => {
			const { index, message } = payload;
			draftState[index].content = message;
		});
		case "updateMessageRole": return produce(state, (draftState) => {
			const { index, role } = payload;
			draftState[index].role = role;
		});
		case "addUserMessage": return produce(state, (draftState) => {
			draftState.push({
				content: payload.message,
				role: "user"
			});
		});
		case "updateLatestBotMessage": return produce(state, () => {
			const { responseStream } = payload;
			const newMessage = {
				content: responseStream.join(""),
				role: "assistant"
			};
			return [...state.slice(0, -1), newMessage];
		});
		case "setErrorMessage": return produce(state, (draftState) => {
			const { index, error } = payload;
			draftState[index].error = error;
		});
		default: throw new Error("暂未实现的 type，请检查 reducer");
	}
};
//#endregion
export { messagesReducer };

//# sourceMappingURL=messageReducer.mjs.map