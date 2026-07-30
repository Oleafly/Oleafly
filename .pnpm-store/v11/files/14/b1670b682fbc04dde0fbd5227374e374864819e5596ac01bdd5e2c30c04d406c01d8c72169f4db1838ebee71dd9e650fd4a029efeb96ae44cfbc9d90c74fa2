import dayjs from "dayjs";
//#region src/List/ListItem/time.ts
const getChatItemTime = (updateAt) => {
	const time = dayjs(updateAt);
	if (time.isSame(dayjs(), "day")) return time.format("HH:mm");
	return time.format("MM-DD");
};
//#endregion
export { getChatItemTime };

//# sourceMappingURL=time.mjs.map