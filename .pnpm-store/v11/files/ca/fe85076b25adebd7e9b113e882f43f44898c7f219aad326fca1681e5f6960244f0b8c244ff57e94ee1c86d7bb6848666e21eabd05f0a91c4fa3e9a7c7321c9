import dayjs from "dayjs";
//#region src/utils/formatTime.ts
const formatTime = (time) => {
	const now = dayjs();
	const target = dayjs(time);
	if (target.isSame(now, "day")) return target.format("HH:mm:ss");
	else if (target.isSame(now, "year")) return target.format("MM-DD HH:mm:ss");
	else return target.format("YYYY-MM-DD HH:mm:ss");
};
//#endregion
export { formatTime };

//# sourceMappingURL=formatTime.mjs.map